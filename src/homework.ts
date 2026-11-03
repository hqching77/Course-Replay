/**
 * 题目答疑 data: one item per problem, saved on its own (not inside the course) so the question can
 * be added on a PC and the answer from a phone or tablet. Signed in: the server, with a version
 * number so two devices can't overwrite each other; offline: this browser's localStorage.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, HomeworkCheck, HomeworkConclusion, HomeworkContext, HomeworkRecord, HomeworkTopic, HomeworkTurn, homeworkApi } from './api'
import type { Course } from './data'
import { rankNodes } from './exam'
import { t } from './i18n'
import { learnerMemory } from './memory'
import { sectionNodes } from './study'

export interface HwImage { id: string; name: string; pages: number }
export type HwStepKind = 'answer' | 'check' | 'hint' | 'attempt' | 'feedback' | 'solution'

export interface HwStep {
  id: string
  kind: HwStepKind
  at: number
  /** answer / attempt / hint / feedback / solution text (Markdown + LaTeX). */
  text: string
  images?: HwImage[]
  check?: HomeworkCheck
  onTrack?: boolean | null
  /** On a check: the student chose to see the full steps. */
  showSolution?: boolean
}

export interface HwItem {
  id: string
  courseId: string
  /** Server version this copy is based on (0 = not on the server yet). */
  version: number
  title: string
  question: { text: string; images: HwImage[] }
  /** The answer (or next step) being written — from any device — before it's sent for marking. */
  draft: { text: string; images: HwImage[] }
  mode: 'check' | 'guide' | null
  steps: HwStep[]
  topicKey: string | null
  sawSolution: boolean
  /** Guide mode reached the right answer. */
  solved: boolean
  conclusion: (HomeworkConclusion & { at: number }) | null
  createdAt: number
  updatedAt: number
}

export type HwStatus = 'question' | 'answered' | 'working' | 'done'

export function itemStatus(item: HwItem): HwStatus {
  if (item.conclusion) return 'done'
  if (item.steps.length) return 'working'
  return item.draft.text.trim() || item.draft.images.length ? 'answered' : 'question'
}

export const statusLabel = (status: HwStatus) => ({ question: t('等你的答案'), answered: t('答案已上传'), working: t('进行中'), done: t('已完成') }[status])

export function lastCheck(item: HwItem) {
  for (let index = item.steps.length - 1; index >= 0; index--) if (item.steps[index].kind === 'check') return item.steps[index]
  return undefined
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function titleFrom(text: string) {
  // Readable without rendering: drop LaTeX commands and environments, keep the symbols.
  const plain = (value: string) => value
    .replace(/\\(begin|end)\{[^}]*\}/g, ' ').replace(/\\\\/g, '; ').replace(/&/g, ' ')
    .replace(/\\(frac|dfrac)\{([^}]*)\}\{([^}]*)\}/g, '($2)/($3)').replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[#>*_`${}\\]/g, '').replace(/\s+/g, ' ').trim()
  const line = text.split('\n').map(plain).find(Boolean) || ''
  return line.length > 40 ? `${line.slice(0, 40)}…` : line || t('未命名题目')
}

export function createItem(courseId: string, question: { text: string; images: HwImage[] }): HwItem {
  const now = Date.now()
  return { id: newId('hw'), courseId, version: 0, title: titleFrom(question.text), question, draft: { text: '', images: [] }, mode: null, steps: [], topicKey: null, sawSolution: false, solved: false, conclusion: null, createdAt: now, updatedAt: now }
}

// ---------------------------------------------------------------------------
// What the AI gets: the question, matching notes, the course's knowledge points, the 知识档案
// ---------------------------------------------------------------------------

export function homeworkTopics(course: Course): HomeworkTopic[] {
  return course.sections.flatMap((section) => sectionNodes(section).map((node) => ({ key: `${section.id}:${node.id}`, title: `${section.title} · ${node.title}` }))).slice(0, 150)
}

export function homeworkContext(course: Course, item: HwItem): HomeworkContext {
  const matched = rankNodes(course, item.question.text, 2)
  const reference = matched.map((node) => node.content.slice(0, 3500)).join('\n\n').slice(0, 7500)
  return { course_title: course.title, question: item.question.text, reference, topics: homeworkTopics(course), learner_memory: learnerMemory(course.id, item.question.text) }
}

/** The conversation so far, for the AI. The correct answer from marking is left out so hints can't leak it. */
export function historyOf(item: HwItem): HomeworkTurn[] {
  return item.steps.map((step): HomeworkTurn => {
    if (step.kind === 'check' && step.check) {
      const { verdict, where, why } = step.check
      return { role: 'check', text: `${verdict}${where ? `；第一处错误：${where}` : ''}${why ? `；${why}` : ''}` } // i18n-ok: AI prompt text
    }
    return { role: step.kind as HomeworkTurn['role'], text: step.text }
  }).slice(-30)
}

export function topicOf(course: Course, key: string | null) {
  if (!key) return null
  const split = key.indexOf(':')
  const sectionId = key.slice(0, split)
  const nodeId = key.slice(split + 1)
  const section = course.sections.find((item) => item.id === sectionId)
  const node = section && sectionNodes(section).find((item) => item.id === nodeId)
  return section && node ? { sectionId, nodeId, section, title: node.title } : null
}

// ---------------------------------------------------------------------------
// Photos: made smaller on the device before uploading (also turns iPhone HEIC into JPEG)
// ---------------------------------------------------------------------------

export async function shrinkImage(file: File, longest = 2200): Promise<File> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 2_500_000 && /image\/(jpe?g|png|webp)/.test(file.type)) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const LOCAL_KEY = 'course-replay-homework-v1'

function loadLocal(): HwItem[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as HwItem[] } catch { return [] }
}
function saveLocal(items: HwItem[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(items)) } catch { /* storage full or blocked */ }
}

function fromRecord(record: HomeworkRecord): HwItem {
  // Older or partial records get defaults for anything missing.
  const data = record.data as unknown as Partial<HwItem>
  return {
    draft: { text: '', images: [] }, steps: [], mode: null, topicKey: null, sawSolution: false, solved: false, conclusion: null,
    ...data, question: data.question || { text: '', images: [] },
    id: record.id, courseId: record.course_id, version: record.version,
  } as HwItem
}

function toData(item: HwItem): Record<string, unknown> {
  const { id: _id, courseId: _courseId, version: _version, ...data } = item
  return data as unknown as Record<string, unknown>
}

const sortItems = (items: HwItem[]) => [...items].sort((a, b) => b.createdAt - a.createdAt)

/**
 * The course's problems. Edits show at once and are saved in the background, one at a time per
 * problem; while the page is open the list is re-read every few seconds, so an answer uploaded
 * from a phone appears on the PC.
 */
export function useHomework(courseId: string, account: boolean, onConflict: (message: string) => void) {
  const [items, setItems] = useState<HwItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const latest = useRef(items)
  latest.current = items
  const pending = useRef(new Map<string, number>()) // item id → debounce timer
  const saving = useRef(new Map<string, Promise<void>>())
  const dirty = useRef(new Set<string>())
  const onConflictRef = useRef(onConflict)
  onConflictRef.current = onConflict

  const refresh = useCallback(async () => {
    if (!account) {
      setItems(sortItems(loadLocal().filter((item) => item.courseId === courseId)))
      setLoaded(true)
      return
    }
    try {
      const records = await homeworkApi.list(courseId)
      setItems((current) => {
        const local = new Map(current.map((item) => [item.id, item]))
        const merged = records.map((record) => {
          const mine = local.get(record.id)
          // Keep local edits that haven't reached the server yet.
          return mine && (dirty.current.has(mine.id) || saving.current.has(mine.id) || mine.version >= record.version) ? mine : fromRecord(record)
        })
        for (const item of current) if (item.version === 0 && !records.some((record) => record.id === item.id)) merged.push(item)
        return sortItems(merged)
      })
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('读取题目失败'))
    } finally {
      setLoaded(true)
    }
  }, [courseId, account])

  useEffect(() => { setLoaded(false); setItems([]); void refresh() }, [refresh])

  useEffect(() => {
    if (!account) return
    const tick = () => { if (document.visibilityState === 'visible') void refresh() }
    const timer = window.setInterval(tick, 5000)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [account, refresh])

  const push = useCallback((id: string) => {
    const previous = saving.current.get(id) || Promise.resolve()
    const run = previous.then(async () => {
      const item = latest.current.find((value) => value.id === id)
      if (!item || !dirty.current.has(id)) return
      dirty.current.delete(id)
      try {
        const saved = await homeworkApi.save(id, item.courseId, toData(item), item.version)
        setItems((current) => current.map((value) => value.id === id ? { ...value, version: saved.version } : value))
        latest.current = latest.current.map((value) => value.id === id ? { ...value, version: saved.version } : value)
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          onConflictRef.current(error.message)
          // Another device saved first: drop this copy and load the server's (version -1 always loses the merge).
          latest.current = latest.current.map((value) => value.id === id ? { ...value, version: -1 } : value)
          setItems(latest.current)
          dirty.current.delete(id)
          await refresh()
        } else {
          dirty.current.add(id)
          onConflictRef.current(error instanceof Error ? error.message : t('保存失败'))
        }
      }
    }).finally(() => { if (saving.current.get(id) === run) saving.current.delete(id) })
    saving.current.set(id, run)
    return run
  }, [refresh])

  /** Change one problem; saved right away, or after `debounce` ms of quiet (typing). */
  const update = useCallback((id: string, change: (item: HwItem) => HwItem, debounce = 0) => {
    const next = latest.current.map((item) => item.id === id ? { ...change(item), updatedAt: Date.now() } : item)
    latest.current = next
    setItems(next)
    if (!account) { saveLocal([...loadLocal().filter((item) => item.courseId !== courseId), ...next]); return Promise.resolve() }
    dirty.current.add(id)
    window.clearTimeout(pending.current.get(id))
    if (debounce) {
      pending.current.set(id, window.setTimeout(() => { pending.current.delete(id); void push(id) }, debounce))
      return Promise.resolve()
    }
    return push(id)
  }, [account, courseId, push])

  const add = useCallback((item: HwItem) => {
    latest.current = sortItems([item, ...latest.current])
    setItems(latest.current)
    if (!account) { saveLocal([...loadLocal(), item]); return Promise.resolve() }
    dirty.current.add(item.id)
    return push(item.id)
  }, [account, push])

  const remove = useCallback(async (id: string) => {
    latest.current = latest.current.filter((item) => item.id !== id)
    setItems(latest.current)
    if (!account) { saveLocal(loadLocal().filter((item) => item.id !== id)); return }
    dirty.current.delete(id)
    await homeworkApi.remove(id)
  }, [account])

  // Typing that hasn't been sent yet: send it when leaving the page.
  useEffect(() => () => { for (const [id, timer] of pending.current) { window.clearTimeout(timer); void push(id) } }, [push])

  return { items, loaded, loadError, refresh, update, add, remove }
}
