/**
 * 知识档案: one picture of what the student knows, across ALL courses.
 *
 * Nothing new is stored here — it is computed from what each course already keeps
 * (answers per knowledge point, weak points, exam diagnosis, what was read in 课堂重放).
 * Every AI call (AI 讲师, 课堂助教, 针对练习, building notes) gets a short text version, so
 * e.g. the programming course's tutor knows you already learned matrices in 线性代数.
 */
import type { Course, Section } from './data'
import type { ExamPlan, TopicLevel } from './exam'
import { t } from './i18n'
import { NodeAnswers, SECTION_KEY, sectionNodes } from './study'
import { MistakeKind, WeakPoint } from './weak'

export type Level = 'mastered' | 'known' | 'shaky' | 'weak' | 'studied'

export interface KnowledgeEntry {
  key: string
  courseId: string
  courseTitle: string
  sectionId: string
  sectionTitle: string
  nodeId?: string
  title: string
  level: Level
  answers?: NodeAnswers
  weak?: WeakPoint
  updatedAt: number
}

export const LEVELS: Level[] = ['mastered', 'known', 'shaky', 'weak', 'studied']
export const levelLabel = (level: Level) => ({ mastered: t('已掌握'), known: t('答对过'), shaky: t('不太稳'), weak: t('薄弱'), studied: t('学过，未测') }[level])
// Labels inside AI prompts stay in Chinese (the prompts are Chinese; the reply language is set separately).
const PROMPT_LABEL: Record<Level, string> = { mastered: '已掌握', known: '答对过', shaky: '不太稳', weak: '薄弱', studied: '学过、没测过' } // i18n-ok: AI prompt text
const PROMPT_KIND: Record<MistakeKind, string> = { concept: '概念不清', start: '不会起步', calc: '计算错误', careless: '粗心' } // i18n-ok: AI prompt text

/** Newest information wins: what the student said, then weak points, then the exam check, then answer counts. */
function levelOf(signals: { answers?: NodeAnswers; weak?: WeakPoint; exam?: TopicLevel; studied: boolean }): Level | null {
  const { answers, weak, exam, studied } = signals
  if (answers?.self === 'known') return 'mastered'
  if (answers?.self === 'unknown') return 'weak'
  if (weak?.status === 'weak') return 'weak'
  if (weak?.status === 'improving') return 'shaky'
  if (exam === 'unknown') return 'weak'
  if (exam === 'shaky') return 'shaky'
  if (exam === 'known' || weak?.status === 'mastered') return 'mastered'
  if (answers && (answers.right || answers.wrong)) {
    if (answers.right >= 2 && answers.lastRight) return 'mastered'
    if (answers.right && !answers.wrong) return 'known'
    return answers.lastRight ? 'shaky' : 'weak'
  }
  return studied ? 'studied' : null
}

function sectionEntries(course: Course, section: Section): KnowledgeEntry[] {
  const answers = section.study?.answers || {}
  const studied = new Set(section.study?.studied || [])
  const weakPoints = (course.weakPoints || []).filter((item) => item.sectionId === section.id)
  const exam = new Map((course.exam?.topics || []).filter((topic) => topic.sectionId === section.id).map((topic) => [topic.nodeId, topic.level]))
  const base = { courseId: course.id, courseTitle: course.title, sectionId: section.id, sectionTitle: section.title }
  const entries: KnowledgeEntry[] = []
  for (const node of sectionNodes(section)) {
    const weak = weakPoints.find((item) => item.nodeId === node.id)
    const level = levelOf({ answers: answers[node.id], weak, exam: exam.get(node.id), studied: studied.has(node.id) })
    if (!level) continue
    const updatedAt = Math.max(answers[node.id]?.lastAt || 0, weak?.updatedAt || 0, studied.has(node.id) ? section.study?.lastAt || 0 : 0)
    entries.push({ ...base, key: `${section.id}:${node.id}`, nodeId: node.id, title: node.title, level, answers: answers[node.id], weak, updatedAt })
  }
  // Answers that couldn't be matched to one knowledge point count for the whole section.
  const loose = weakPoints.find((item) => !item.nodeId)
  const level = levelOf({ answers: answers[SECTION_KEY], weak: loose, studied: false })
  if (level) entries.push({ ...base, key: `${section.id}:${SECTION_KEY}`, title: loose?.topic || section.title, level, answers: answers[SECTION_KEY], weak: loose, updatedAt: Math.max(answers[SECTION_KEY]?.lastAt || 0, loose?.updatedAt || 0) })
  return entries
}

/** Every knowledge point with any record, in every course. */
export function knowledgeEntries(courses: Course[]): KnowledgeEntry[] {
  return courses.flatMap((course) => course.sections.flatMap((section) => sectionEntries(course, section)))
}

// ---------------------------------------------------------------------------
// Finding the same idea in another course (no AI: a shared term in the titles)
// ---------------------------------------------------------------------------

const GENERIC = new Set(['基本', '基础', '概念', '定义', '性质', '应用', '计算', '问题', '方法', '原理', '介绍', '简介', '实现', '分析', '理解', '及其', '以及', '什么', '如何', '结构', '类型', '操作', '使用', '总结', '复习', '例题', '练习', '运算', '规则', '常见', '简单', '一般', '主要', '重要', '常用', '进阶', '核心', '前置', '小结', '课程', '本节', '本章', '知识', '内容', '综合', '入门', '思想', '技巧', '过程', '形式', '特点', '作用', '意义', '关系', '区别', '联系', '课堂', '转写', '提问']) // i18n-ok: AI prompt text
const STOP = new Set(['the', 'and', 'with', 'for', 'from', 'into', 'basic', 'basics', 'introduction', 'intro', 'overview', 'summary', 'review', 'part', 'chapter', 'lecture', 'section', 'example', 'examples', 'using', 'what', 'how'])

const clean = (text: string) => text.toLowerCase().replace(/第\s*[0-9一二三四五六七八九十百]+\s*[章讲节课]/g, ' ').replace(/\d+(\.\d+)*/g, ' ')

/** The longest meaningful term both texts share ("矩阵", "fourier"), or '' if none. */
export function sharedTerm(a: string, b: string): string {
  const [short, long] = a.length <= b.length ? [clean(a), clean(b)] : [clean(b), clean(a)]
  let best = ''
  for (const word of short.match(/[a-z][a-z+#]{2,}/g) || []) {
    if (!STOP.has(word) && word.length > best.length && new RegExp(`\\b${word.replace(/[+#]/g, '\\$&')}`).test(long)) best = word
  }
  for (const run of short.match(/[㐀-鿿]{2,}/g) || []) {
    for (let size = Math.min(run.length, 8); size >= 2 && size > best.length; size--) {
      for (let start = 0; start + size <= run.length; start++) {
        const piece = run.slice(start, start + size)
        if (size === 2 && GENERIC.has(piece)) continue
        if (long.includes(piece)) { best = piece; break }
      }
      if (best.length === size) break
    }
  }
  return best
}

export interface Related { entry: KnowledgeEntry; term: string }
const LEVEL_ORDER: Record<Level, number> = { mastered: 0, known: 1, shaky: 2, weak: 3, studied: 4 }

/** Points in OTHER courses that look like the same idea as `text` (a title or a question). */
export function relatedElsewhere(entries: KnowledgeEntry[], courseId: string, text: string, limit = 4): Related[] {
  if (!text.trim()) return []
  return entries
    .filter((entry) => entry.courseId !== courseId && entry.nodeId)
    .map((entry) => ({ entry, term: sharedTerm(entry.title, text) }))
    .filter((item) => item.term)
    .sort((a, b) => b.term.length - a.term.length || LEVEL_ORDER[a.entry.level] - LEVEL_ORDER[b.entry.level] || b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, limit)
}

/** Pairs of points in different courses that share a term, for the 知识档案 page. */
export function crossLinks(entries: KnowledgeEntry[], limit = 12) {
  const pairs: { a: KnowledgeEntry; b: KnowledgeEntry; term: string }[] = []
  const withNodes = entries.filter((entry) => entry.nodeId)
  for (let i = 0; i < withNodes.length; i++) {
    for (let j = i + 1; j < withNodes.length; j++) {
      if (withNodes[i].courseId === withNodes[j].courseId) continue
      const term = sharedTerm(withNodes[i].title, withNodes[j].title)
      if (term) pairs.push({ a: withNodes[i], b: withNodes[j], term })
    }
  }
  return pairs.sort((x, y) => y.term.length - x.term.length || (LEVEL_ORDER[x.a.level] + LEVEL_ORDER[x.b.level]) - (LEVEL_ORDER[y.a.level] + LEVEL_ORDER[y.b.level])).slice(0, limit)
}

// ---------------------------------------------------------------------------
// The text the AI gets
// ---------------------------------------------------------------------------

let source: Course[] = []
/** Called by the app whenever the courses change, so any AI call can read the whole record. */
export function publishCourses(courses: Course[]) { source = courses }

const MAX_CHARS = 3600
const list = (items: string[], max: number) => items.slice(0, max).join('、') + (items.length > max ? ` 等 ${items.length} 个` : '') // i18n-ok: AI prompt text

/**
 * 知识档案 for one AI request: this course in detail, every other course in brief, and the
 * points from other courses that look related to `focus` (the topic / question on screen).
 */
export function learnerMemory(courseId: string | undefined, focus = '', courses: Course[] = source): string {
  const entries = knowledgeEntries(courses)
  if (!entries.length) return ''
  const lines: string[] = []
  const byLevel = (items: KnowledgeEntry[], level: Level) => items.filter((entry) => entry.level === level)
  const current = courses.find((course) => course.id === courseId)
  const mine = entries.filter((entry) => entry.courseId === courseId)

  const related = relatedElsewhere(entries, courseId || '', focus, 6)
  if (related.length) {
    lines.push('和眼前内容可能相关、在其他课程学过的：') // i18n-ok: AI prompt text
    for (const { entry } of related) lines.push(`- ${entry.title}（《${entry.courseTitle}》· ${PROMPT_LABEL[entry.level]}${entry.weak && entry.level !== 'mastered' ? `，${PROMPT_KIND[entry.weak.kind]}` : ''}）`) // i18n-ok: AI prompt text
  }
  if (current && mine.length) {
    lines.push(`本课程《${current.title}》：`) // i18n-ok: AI prompt text
    for (const level of ['mastered', 'known', 'shaky'] as Level[]) {
      const titles = byLevel(mine, level).map((entry) => entry.title)
      if (titles.length) lines.push(`- ${PROMPT_LABEL[level]}：${list(titles, 25)}`) // i18n-ok: AI prompt text
    }
    const weak = byLevel(mine, 'weak').sort((a, b) => b.updatedAt - a.updatedAt)
    if (weak.length) {
      lines.push('- 薄弱：') // i18n-ok: AI prompt text
      for (const entry of weak.slice(0, 8)) {
        const last = entry.weak?.evidence[entry.weak.evidence.length - 1]
        lines.push(`  - ${entry.title}${entry.weak ? `（${PROMPT_KIND[entry.weak.kind]}，错 ${entry.weak.evidence.length} 次${last?.note ? `；最近一次：${last.note.slice(0, 80)}` : ''}）` : ''}`) // i18n-ok: AI prompt text
      }
      if (weak.length > 8) lines.push(`  - 另有 ${weak.length - 8} 个`) // i18n-ok: AI prompt text
    }
    const studied = byLevel(mine, 'studied').map((entry) => entry.title)
    if (studied.length) lines.push(`- 学过、没测过：${list(studied, 20)}`) // i18n-ok: AI prompt text
  }
  const others = courses.filter((course) => course.id !== courseId)
  const otherLines: string[] = []
  for (const course of others) {
    const items = entries.filter((entry) => entry.courseId === course.id)
    if (!items.length) continue
    const parts = LEVELS.map((level) => [level, byLevel(items, level).map((entry) => entry.title)] as const).filter(([, titles]) => titles.length).map(([level, titles]) => `${PROMPT_LABEL[level]} ${list(titles, level === 'studied' ? 10 : 15)}`)
    otherLines.push(`- 《${course.title}》：${parts.join('；')}`) // i18n-ok: AI prompt text
  }
  if (otherLines.length) lines.push(courseId ? '其他课程：' : '各课程：', ...otherLines) // i18n-ok: AI prompt text
  const text = lines.join('\n')
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS - 1) + '…' : text
}

/** A new exam plan starts from what the record already says: mastered → skipped, weak → 不会, shaky → 不太稳. */
export function seedLevels(plan: ExamPlan, course: Course): ExamPlan {
  const levels = new Map(knowledgeEntries([course]).filter((entry) => entry.nodeId).map((entry) => [entry.key, entry.level]))
  const toTopic = (level?: Level): TopicLevel | undefined => level === 'mastered' ? 'known' : level === 'weak' ? 'unknown' : level === 'shaky' ? 'shaky' : undefined
  return { ...plan, topics: plan.topics.map((topic) => topic.level ? topic : { ...topic, level: toTopic(levels.get(topic.key)) }) }
}
