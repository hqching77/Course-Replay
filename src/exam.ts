import type { Course, KnowledgeTier, Section } from './data'
import { getLang, t } from './i18n'
import { dayKey, sectionNodes } from './study'
import { AnswerResult, applyResult } from './weak'

/**
 * 考前冲刺: what to revise, in what order, day by day. Everything is computed from the
 * course's own data — diagnosis results, weak points, the teacher's emphasis in the class
 * transcript, past papers, class questions and what was never studied — so the plan
 * reshuffles by itself as topics get mastered.
 */

export type TopicLevel = 'known' | 'shaky' | 'unknown'

export interface ExamTopic {
  key: string // `${sectionId}:${nodeId}`
  sectionId: string
  nodeId: string
  title: string
  tier: KnowledgeTier
  level?: TopicLevel
  /** Correct answers in targeted practice (two → mastered, as for weak points). */
  practiceCorrect?: number
  practiced?: number
}

export interface PastQuestion { text: string; topicKey: string | null; paper: string }

export interface ExamPlan {
  id: string
  name: string
  date: string // YYYY-MM-DD
  sectionIds: string[]
  minutesPerDay: number
  topics: ExamTopic[]
  pastPapers?: string[]
  pastQuestions?: PastQuestion[]
  createdAt: number
}

export const topicKey = (sectionId: string, nodeId: string) => `${sectionId}:${nodeId}`
const TIER_RANK: Record<KnowledgeTier, number> = { prereq: 0, core: 1, advanced: 2 }

/** Topics for the sections in scope; keeps diagnosis/practice results of topics that still exist. */
export function syncTopics(plan: ExamPlan, course: Course): ExamTopic[] {
  const previous = new Map(plan.topics.map((topic) => [topic.key, topic]))
  return course.sections.filter((section) => plan.sectionIds.includes(section.id)).flatMap((section) =>
    sectionNodes(section).map((node) => {
      const key = topicKey(section.id, node.id)
      const old = previous.get(key)
      return { ...old, key, sectionId: section.id, nodeId: node.id, title: node.title, tier: node.tier }
    }))
}

export function createPlan(course: Course, input: { name: string; date: string; sectionIds: string[]; minutesPerDay: number }): ExamPlan {
  const plan: ExamPlan = { id: `exam-${Date.now()}`, ...input, topics: [], createdAt: Date.now() }
  return { ...plan, topics: syncTopics(plan, course) }
}

export function daysUntil(date: string, now = new Date()) {
  const [year, month, day] = date.split('-').map(Number)
  const exam = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((exam.getTime() - today.getTime()) / 86_400_000)
}

// ---------------------------------------------------------------------------
// What the teacher stressed (no AI: phrases in the class transcript)
// ---------------------------------------------------------------------------

const EMPHASIS = /要考|必考|会考|考试(会|要|一定|肯定)|考点|重点|很重要|非常重要|特别重要|最重要|一定要(掌握|会|记住|搞懂)|务必|记住|易错|常考|容易错|期中|期末|will be on the (exam|test|midterm|final)|on the (exam|test|midterm|final)|important|remember this/i

export function emphasisLines(section: Section) {
  return (section.transcript || []).filter((line) => EMPHASIS.test(line.text))
}

function grams(text: string) {
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
  const result = new Set<string>()
  for (const word of clean.split(' ').filter(Boolean)) {
    if (/^[a-z0-9]+$/.test(word)) { if (word.length > 2) result.add(word); continue }
    for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2))
  }
  return result
}

type NodeGrams = { id: string; grams: Set<string> }
const nodeGrams = (section: Section): NodeGrams[] => sectionNodes(section).map((node) => ({ id: node.id, grams: grams(`${node.title} ${node.summary}`) }))

/** Best node by shared words; `focus` (the line itself) counts double against its context. */
function bestNode(nodes: NodeGrams[], text: Set<string>, focus?: Set<string>) {
  let best = ''
  let bestScore = 0
  let bestShared = 0
  for (const node of nodes) {
    let shared = 0
    let score = 0
    node.grams.forEach((gram) => {
      if (text.has(gram)) { shared++; score++ }
      if (focus?.has(gram)) score++
    })
    if (score > bestScore) { best = node.id; bestScore = score; bestShared = shared }
  }
  return bestShared >= 2 ? best : ''
}

/** The knowledge point a piece of text (a question, a transcript line) is about, by shared words; '' when unclear. */
export function matchNode(section: Section, text: string) {
  return bestNode(nodeGrams(section), grams(text))
}

/** How often the teacher stressed each knowledge point: emphasis lines matched to node titles by shared words. */
export function emphasisByNode(section: Section): Map<string, number> {
  const counts = new Map<string, number>()
  const lines = section.transcript || []
  const nodes = nodeGrams(section)
  lines.forEach((line, index) => {
    if (!EMPHASIS.test(line.text)) return
    const window = grams(lines.slice(Math.max(0, index - 1), index + 3).map((item) => item.text).join(' '))
    const key = bestNode(nodes, window, grams(line.text)) || '__section'
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return counts
}

// ---------------------------------------------------------------------------
// Priorities and the day-by-day plan
// ---------------------------------------------------------------------------

export interface TopicInfo {
  topic: ExamTopic
  section: Section
  score: number
  /** 0 = 不会, 1 = 不太稳 (or not diagnosed but strongly signalled), 2 = the rest. */
  band: number
  minutes: number
  tags: string[]
  mastered: boolean
}

export function topicInfo(course: Course, plan: ExamPlan): TopicInfo[] {
  const sections = new Map(course.sections.map((section) => [section.id, section]))
  const emphasis = new Map(plan.sectionIds.map((id) => [id, sections.get(id) ? emphasisByNode(sections.get(id)!) : new Map<string, number>()]))
  const past = new Map<string, number>()
  for (const question of plan.pastQuestions || []) if (question.topicKey) past.set(question.topicKey, (past.get(question.topicKey) || 0) + 1)
  const weak = new Map((course.weakPoints || []).filter((item) => item.nodeId).map((item) => [topicKey(item.sectionId || '', item.nodeId!), item]))

  return plan.topics.flatMap((topic) => {
    const section = sections.get(topic.sectionId)
    if (!section) return []
    const weakPoint = weak.get(topic.key)
    const stressed = emphasis.get(topic.sectionId)?.get(topic.nodeId) || 0
    const pastCount = past.get(topic.key) || 0
    const studied = section.study?.studied?.includes(topic.nodeId)
    const asked = (section.classQuestions || []).length > 0
    const practicedOut = (topic.practiceCorrect || 0) >= 2
    const mastered = (topic.level === 'known' || practicedOut) && (!weakPoint || weakPoint.status === 'mastered')
    const tags: string[] = []
    if (topic.level === 'unknown') tags.push(t('不会'))
    else if (topic.level === 'shaky') tags.push(t('不太稳'))
    else if (!topic.level) tags.push(t('还没诊断'))
    // Signals that move a topic up: still a weak point, stressed in class, seen in past papers.
    let boost = 0
    if (weakPoint && weakPoint.status !== 'mastered') { boost += weakPoint.status === 'weak' ? 2 : 1; tags.push(t('薄弱点')) }
    if (stressed) { boost += Math.min(2, stressed); tags.push(t('老师强调过')) }
    if (pastCount) { boost += Math.min(2, pastCount * 0.7); tags.push(t('往年考过 {n} 次', { n: pastCount })) }
    const score = boost + (asked ? 0.3 : 0) + (studied ? 0 : 0.5)
    const band = topic.level === 'unknown' ? 0 : topic.level === 'shaky' ? 1 : boost >= 2 ? 1 : 2
    const minutes = (topic.level === 'unknown' ? 40 : topic.level === 'shaky' ? 25 : 30) + (stressed || pastCount ? 5 : 0)
    return [{ topic, section, score, band, minutes, tags, mastered }]
  })
}

export interface PlanDay { date: string; label: string; blocks: TopicInfo[]; minutes: number; review?: boolean }

/** Spread the not-yet-mastered topics over the days before the exam, most important first. */
export function buildPlan(course: Course, plan: ExamPlan, now = new Date()) {
  const infos = topicInfo(course, plan)
  const sectionOrder = new Map(course.sections.map((section, index) => [section.id, index]))
  const nodeOrder = new Map<string, number>()
  course.sections.forEach((section) => sectionNodes(section).forEach((node, index) => nodeOrder.set(topicKey(section.id, node.id), index)))
  // 不会 → 不太稳 → the rest; within a band the stronger signals first, then lecture order.
  const todo = infos.filter((info) => !info.mastered).sort((a, b) =>
    a.band - b.band
    || b.score - a.score
    || (sectionOrder.get(a.topic.sectionId) || 0) - (sectionOrder.get(b.topic.sectionId) || 0)
    || TIER_RANK[a.topic.tier] - TIER_RANK[b.topic.tier]
    || (nodeOrder.get(a.topic.key) || 0) - (nodeOrder.get(b.topic.key) || 0))

  const left = Math.max(1, daysUntil(plan.date, now))
  const dates = Array.from({ length: left }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index)
    return { date: dayKey(date), label: index === 0 ? t('今天') : index === 1 ? t('明天') : date.toLocaleDateString(getLang() === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }) }
  })
  // With three or more days left, the day before the exam is for going over mistakes.
  const reviewDay = dates.length >= 3 ? dates.pop()! : null
  const days: PlanDay[] = dates.map((item) => ({ ...item, blocks: [], minutes: 0 }))
  const overflow: TopicInfo[] = []
  let day = 0
  for (const info of todo) {
    while (day < days.length && days[day].minutes > 0 && days[day].minutes + info.minutes > plan.minutesPerDay * 1.1) day++
    if (day >= days.length) { overflow.push(info); continue }
    days[day].blocks.push(info)
    days[day].minutes += info.minutes
  }
  if (reviewDay) days.push({ ...reviewDay, blocks: [], minutes: Math.min(plan.minutesPerDay, 90), review: true })
  return { days, overflow, mastered: infos.filter((info) => info.mastered), total: infos.length }
}

// ---------------------------------------------------------------------------
// Recording answers (weak points + exam progress together)
// ---------------------------------------------------------------------------

/** One marked answer → weak-point record, and the exam topic's progress if it is in the plan. */
export function recordAnswer(course: Course, result: AnswerResult): Course {
  let next = applyResult(course, result)
  if (next.exam && result.sectionId && result.nodeId && result.source === 'practice') {
    const key = topicKey(result.sectionId, result.nodeId)
    next = { ...next, exam: { ...next.exam, topics: next.exam.topics.map((topic) => {
      if (topic.key !== key) return topic
      const correct = result.verdict === 'correct'
      const practiceCorrect = correct ? (topic.practiceCorrect || 0) + 1 : 0
      const level: TopicLevel | undefined = practiceCorrect >= 2 ? 'known' : correct ? topic.level : topic.level === 'known' ? 'shaky' : topic.level || 'shaky'
      return { ...topic, practiced: (topic.practiced || 0) + 1, practiceCorrect, level }
    }) } }
  }
  return next
}

/** The lecture text of a knowledge point, for questions and marking. */
export function nodeContent(section: Section | undefined, nodeId: string | undefined) {
  if (!section || !nodeId) return ''
  return sectionNodes(section).find((node) => node.id === nodeId)?.content || ''
}
