import type { Course } from './data'
import { t } from './i18n'

/**
 * Weak-point record (per course). Every marked answer — 自测题 in 课堂重放, the 考前冲刺
 * diagnosis, targeted practice — goes through applyResult(). A weak point is cleared only
 * after two later correct answers on it.
 */

export type MistakeKind = 'concept' | 'start' | 'calc' | 'careless'
export type WeakStatus = 'weak' | 'improving' | 'mastered'
export type ResultSource = 'selftest' | 'diagnosis' | 'practice' | 'homework'

export interface WeakEvidence {
  at: number
  source: ResultSource
  question: string
  /** What went wrong, in the AI's words (used to aim later practice at it). */
  note?: string
}

export interface WeakPoint {
  id: string
  topic: string
  sectionId?: string
  nodeId?: string
  kind: MistakeKind
  status: WeakStatus
  /** Correct answers in a row since the last mistake. */
  streak: number
  evidence: WeakEvidence[]
  createdAt: number
  updatedAt: number
}

export interface AnswerResult {
  sectionId?: string
  nodeId?: string
  topic: string
  /** unknown = "我不会" in the diagnosis. */
  verdict: 'correct' | 'partial' | 'wrong' | 'unknown'
  kind?: MistakeKind | null
  source: ResultSource
  question: string
  note?: string
}

const CLEARED_AFTER = 2
const MAX_EVIDENCE = 6

export const kindLabel = (kind: MistakeKind) => ({ concept: t('概念不清'), start: t('不会起步'), calc: t('计算错误'), careless: t('粗心') }[kind])
export const statusLabel = (status: WeakStatus) => ({ weak: t('薄弱'), improving: t('好转'), mastered: t('已掌握') }[status])
export const sourceLabel = (source: ResultSource) => ({ selftest: t('自测题'), diagnosis: t('考前诊断'), practice: t('针对练习'), homework: t('作业') }[source])

const normal = (text: string) => text.replace(/\s+/g, '').toLowerCase()

export function findWeakPoint(course: Course, target: { sectionId?: string; nodeId?: string; topic: string }) {
  const list = course.weakPoints || []
  if (target.nodeId) return list.find((item) => item.sectionId === target.sectionId && item.nodeId === target.nodeId)
  return list.find((item) => !item.nodeId && normal(item.topic) === normal(target.topic))
}

export function applyResult(course: Course, result: AnswerResult, now = Date.now()): Course {
  const list = course.weakPoints || []
  const existing = findWeakPoint(course, result)
  if (result.verdict === 'correct') {
    if (!existing || existing.status === 'mastered') return course
    const streak = existing.streak + 1
    const updated: WeakPoint = { ...existing, streak, status: streak >= CLEARED_AFTER ? 'mastered' : 'improving', updatedAt: now }
    return { ...course, weakPoints: list.map((item) => item.id === existing.id ? updated : item) }
  }
  const evidence: WeakEvidence = { at: now, source: result.source, question: result.question.slice(0, 400), note: result.note?.slice(0, 300) }
  const kind: MistakeKind = result.kind || 'concept'
  if (existing) {
    const updated: WeakPoint = { ...existing, kind, status: 'weak', streak: 0, evidence: [...existing.evidence, evidence].slice(-MAX_EVIDENCE), updatedAt: now }
    return { ...course, weakPoints: list.map((item) => item.id === existing.id ? updated : item) }
  }
  const created: WeakPoint = {
    id: `weak-${now}-${Math.random().toString(36).slice(2, 7)}`,
    topic: result.topic.slice(0, 200),
    sectionId: result.sectionId,
    nodeId: result.nodeId,
    kind,
    status: 'weak',
    streak: 0,
    evidence: [evidence],
    createdAt: now,
    updatedAt: now,
  }
  return { ...course, weakPoints: [...list, created] }
}

export function removeWeakPoint(course: Course, id: string): Course {
  return { ...course, weakPoints: (course.weakPoints || []).filter((item) => item.id !== id) }
}

export function markMastered(course: Course, id: string, now = Date.now()): Course {
  return { ...course, weakPoints: (course.weakPoints || []).map((item) => item.id === id ? { ...item, status: 'mastered' as const, streak: CLEARED_AFTER, updatedAt: now } : item) }
}
