import { Dispatch, SetStateAction } from 'react'
import { apiFetch, filesApi } from './api'
import type { Course, Material, Section } from './data'
import { transcriptText } from './classNotes'
import { formatDate, t } from './i18n'
import { updateSection } from './ui'

type SetCourses = Dispatch<SetStateAction<Course[]>>

// Files that couldn't be uploaded (offline / not signed in) stay in memory until built.
const stagedFiles = new Map<string, File>()

export function forgetStagedFile(materialId: string) {
  stagedFiles.delete(materialId)
}

const sizeLabel = (file: File) => `${Math.max(1, Math.round(file.size / 1024))} KB`

/** "第 3 讲 · 11月2日" / "Lecture 3 · Nov 2" */
export function autoSectionTitle(course: Course, now = Date.now()) {
  return t('第 {n} 讲 · {date}', { n: course.sections.length + 1, date: formatDate(now) })
}

const AUTO_PREFIX = /^(第\s*\d+\s*讲|Lecture\s+\d+)/

/** Keep the lecture number, replace the date with what the AI says the class was about. */
export function titleFromAnalysis(currentTitle: string, aiTitle: string) {
  const prefix = currentTitle.match(AUTO_PREFIX)?.[0]
  const clean = aiTitle.trim()
  if (!clean) return currentTitle
  return prefix ? `${prefix} · ${clean}` : clean
}

/** Add files to a section and upload them right away, so they survive reloads (e.g. slides shared mid-class). */
export async function addMaterialFiles(setCourses: SetCourses, courseId: string, sectionId: string, files: File[]) {
  if (!files.length) return
  const stamp = Date.now()
  const additions: Material[] = files.map((file, index) => ({
    id: `mat-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    name: file.name,
    meta: `${sizeLabel(file)} · ${t('上传中…')}`,
    type: file.name.split('.').pop()?.toUpperCase() || 'FILE',
    status: 'uploading',
    progress: 0,
  }))
  const patchMaterial = (id: string, changes: Partial<Material>) => updateSection(setCourses, courseId, sectionId, (current) => ({
    ...current,
    materials: current.materials.map((material) => material.id === id ? { ...material, ...changes } : material),
  }))
  updateSection(setCourses, courseId, sectionId, (current) => ({ ...current, materials: [...current.materials, ...additions] }))
  await Promise.all(additions.map(async (material, index) => {
    const file = files[index]
    try {
      const uploaded = await filesApi.upload(file)
      patchMaterial(material.id, { status: 'pending', uploadId: uploaded.id, meta: `${sizeLabel(file)} · ${t('已上传 · 待生成笔记')}` })
    } catch {
      stagedFiles.set(material.id, file)
      patchMaterial(material.id, { status: 'pending', meta: `${sizeLabel(file)} · ${t('暂存在本页 · 刷新前请生成笔记')}` })
    }
  }))
}

/** What a build of this section would use. */
export function buildInputs(section: Section) {
  const uploaded = section.materials.filter((material) => material.uploadId && material.status !== 'uploading' && material.status !== 'processing')
  const local = section.materials.filter((material) => !material.uploadId && material.status !== 'processing' && stagedFiles.has(material.id))
  const transcript = transcriptText(section.transcript)
  const uploading = section.materials.some((material) => material.status === 'uploading')
  return { uploaded, local, transcript, uploading, any: uploaded.length + local.length > 0 || Boolean(transcript) }
}

/**
 * Generate notes for a section from everything it has: uploaded files, files
 * still in this page, the class transcript and the questions asked in class.
 */
export async function startSectionBuild(setCourses: SetCourses, course: Course, section: Section, signal?: AbortSignal) {
  const { uploaded, local, transcript } = buildInputs(section)
  const included = [...uploaded, ...local]
  const materialIds = included.map((material) => material.id)
  const form = new FormData()
  if (uploaded.length) form.append('upload_ids', JSON.stringify(uploaded.map((material) => material.uploadId)))
  local.forEach((material) => { const file = stagedFiles.get(material.id); if (file) form.append('files', file) })
  if (transcript) form.append('transcript', transcript)
  const asked = (section.classQuestions || []).map((item) => item.question.trim()).filter(Boolean)
  if (asked.length) form.append('class_questions', JSON.stringify(asked))

  updateSection(setCourses, course.id, section.id, (current) => ({
    ...current,
    status: 'building',
    materials: current.materials.map((material) => materialIds.includes(material.id) ? { ...material, status: 'processing' as const, error: undefined } : material),
  }))
  try {
    const payload = await apiFetch<{ job_id: string }>('/api/process/start', { method: 'POST', body: form, signal, ai: true })
    updateSection(setCourses, course.id, section.id, (current) => ({
      ...current,
      processingJob: { jobId: payload.job_id, materialIds, progress: 8, stage: 'queued', message: '', filesTotal: included.length, filesDone: 0, pagesDone: 0, startedAt: Date.now() },
    }))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : t('构建启动失败')
    updateSection(setCourses, course.id, section.id, (current) => ({
      ...current,
      status: 'failed',
      materials: current.materials.map((material) => materialIds.includes(material.id) ? { ...material, status: 'failed' as const, error: message } : material),
    }))
    throw error
  }
}
