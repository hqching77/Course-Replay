import { Course, KnowledgeNode, Section, deriveKnowledgeMap } from './data'

/**
 * Real study activity for a 小节, synced with the section. The dashboard, course
 * cards and progress numbers are all computed from this plus the class transcript.
 */
export interface SectionStudy {
  /** Knowledge points read in 课堂重放 long enough to count as studied. */
  studied?: string[]
  lastNodeId?: string
  lastAt?: number
  /** Seconds spent in 课堂重放 per local day (YYYY-MM-DD). */
  review?: Record<string, number>
}

const DAY = 86_400_000
const KEEP_DAYS = 400
/** A gap longer than this between transcript lines starts a new class session. */
const CLASS_GAP = 10 * 60_000

export function dayKey(time: number | Date) {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The knowledge points a section's replay shows (same ids as the replay page). */
export function sectionNodes(section: Section): KnowledgeNode[] {
  if (section.knowledgeMap?.length) return section.knowledgeMap
  if (section.analysis?.learning_path.length) return deriveKnowledgeMap(section.analysis)
  return []
}

export function recordReview(section: Section, seconds: number, nodeId: string | undefined, now = Date.now()): Section {
  const study = section.study || {}
  const review = { ...(study.review || {}) }
  const key = dayKey(now)
  review[key] = (review[key] || 0) + Math.round(seconds)
  const oldest = dayKey(now - KEEP_DAYS * DAY)
  for (const day of Object.keys(review)) if (day < oldest) delete review[day]
  return { ...section, study: { ...study, review, lastAt: now, lastNodeId: nodeId || study.lastNodeId } }
}

export function markStudied(section: Section, nodeId: string, now = Date.now()): Section {
  const study = section.study || {}
  if (study.studied?.includes(nodeId)) return section
  return { ...section, study: { ...study, studied: [...(study.studied || []), nodeId], lastNodeId: nodeId, lastAt: now } }
}

/** Studied / total knowledge points; null when the section has no notes yet. */
export function sectionProgress(section: Section) {
  const nodes = sectionNodes(section)
  if (!nodes.length) return null
  const studied = new Set(section.study?.studied || [])
  const done = nodes.filter((node) => studied.has(node.id)).length
  return { done, total: nodes.length, percent: Math.round((done / nodes.length) * 100) }
}

/** Average progress of the course's sections that have notes (0 when none). */
export function courseProgress(course: Course) {
  const scored = course.sections.map(sectionProgress).filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (!scored.length) return 0
  return Math.round(scored.reduce((sum, item) => sum + item.percent, 0) / scored.length)
}

/** Class time per day, from the live transcript (lines closer than 10 min form one session). */
export function classSecondsByDay(section: Section) {
  const totals = new Map<string, number>()
  const lines = [...(section.transcript || [])].sort((a, b) => a.startedAt - b.startedAt)
  let start = 0
  let end = 0
  const close = () => { if (end > start) totals.set(dayKey(start), (totals.get(dayKey(start)) || 0) + (end - start) / 1000) }
  for (const line of lines) {
    const lineEnd = Math.max(line.endedAt || line.startedAt, line.startedAt)
    if (start && line.startedAt - end <= CLASS_GAP) end = Math.max(end, lineEnd)
    else { close(); start = line.startedAt; end = lineEnd }
  }
  if (start) close()
  return totals
}

/** Monday 00:00 of the week containing `now`. */
export function weekStart(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date
}

export function weekStudy(courses: Course[], now = new Date()) {
  const from = dayKey(weekStart(now))
  const to = dayKey(now)
  let review = 0
  let inClass = 0
  for (const course of courses) {
    for (const section of course.sections) {
      for (const [day, seconds] of Object.entries(section.study?.review || {})) if (day >= from && day <= to) review += seconds
      for (const [day, seconds] of classSecondsByDay(section)) if (day >= from && day <= to) inClass += seconds
    }
  }
  return { review, inClass, total: review + inClass }
}

/** Knowledge points not studied yet, across all sections with notes. */
export function pendingNodes(courses: Course[]) {
  let total = 0
  let pending = 0
  let pendingCore = 0
  for (const course of courses) {
    for (const section of course.sections) {
      const studied = new Set(section.study?.studied || [])
      for (const node of sectionNodes(section)) {
        total += 1
        if (studied.has(node.id)) continue
        pending += 1
        if (node.tier === 'core') pendingCore += 1
      }
    }
  }
  return { total, pending, pendingCore, studied: total - pending }
}

/** Latest activity in a section: replay study, the class transcript, or creation. */
export function sectionActivity(section: Section) {
  const lastLine = section.transcript?.length ? Math.max(...section.transcript.map((line) => line.endedAt || line.startedAt)) : 0
  return Math.max(section.study?.lastAt || 0, lastLine, section.liveEndedAt || 0, section.liveStartedAt || 0)
}

export function courseActivity(course: Course) {
  return course.sections.reduce((latest, section) => Math.max(latest, sectionActivity(section)), 0)
}

/** Where to pick up: the section studied most recently (replay or class). */
export function lastStudied(courses: Course[]) {
  let best: { course: Course; section: Section; at: number } | null = null
  for (const course of courses) {
    for (const section of course.sections) {
      const at = sectionActivity(section)
      if (at && (!best || at > best.at)) best = { course, section, at }
    }
  }
  return best
}
