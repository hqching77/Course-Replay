export type MaterialStatus = 'ready' | 'processing' | 'failed'

export interface Material {
  id: string
  name: string
  meta: string
  type: string
  status: MaterialStatus
  progress?: number
  error?: string
}

export interface Course {
  id: string
  title: string
  code: string
  description: string
  tags: string[]
  mastery: number
  materials: Material[]
  updated: string
  accent: string
}

export const defaultCourses: Course[] = [
  {
    id: 'digital-circuits',
    title: '数字电路基础',
    code: 'EE201 · 2026 秋',
    description: '从数制与逻辑门，到组合逻辑电路的分析与设计。',
    tags: ['电子工程', '必修'],
    mastery: 68,
    updated: '今天 14:32',
    accent: '#c7f45d',
    materials: [
      { id: 'm1', name: '第 3 讲 · 组合逻辑电路.pdf', meta: '24 页 · 8.4 MB', type: 'PDF', status: 'ready' },
      { id: 'm2', name: '课堂板书与例题.pptx', meta: '16 张幻灯片 · 4.1 MB', type: 'PPTX', status: 'ready' },
      { id: 'm3', name: '我的课堂笔记.md', meta: '1,842 字 · 12 KB', type: 'MD', status: 'ready' },
    ],
  },
  {
    id: 'signals',
    title: '信号与系统',
    code: 'EE203 · 2026 秋',
    description: '连续时间系统、卷积与频域分析。',
    tags: ['电子工程'],
    mastery: 41,
    updated: '昨天 21:08',
    accent: '#7dd3fc',
    materials: [
      { id: 'm4', name: 'Chapter 2 · LTI Systems.pdf', meta: '37 页 · 11.2 MB', type: 'PDF', status: 'ready' },
      { id: 'm5', name: '习题课笔记.docx', meta: '8 页 · 240 KB', type: 'DOCX', status: 'ready' },
    ],
  },
  {
    id: 'probability',
    title: '概率论与随机过程',
    code: 'MATH240 · 2026 秋',
    description: '概率模型、随机变量与大数定律。',
    tags: ['数学基础'],
    mastery: 23,
    updated: '10 月 14 日',
    accent: '#fda4af',
    materials: [
      { id: 'm6', name: '随机变量课件.pdf', meta: '31 页 · 7.2 MB', type: 'PDF', status: 'ready' },
    ],
  },
]

export const knowledgeNodes = [
  { id: 'binary', title: '数制与编码', eyebrow: '前置知识', mastery: 88, duration: '8 分钟', done: true },
  { id: 'boolean', title: '布尔代数', eyebrow: '核心概念', mastery: 76, duration: '12 分钟', done: true },
  { id: 'simplify', title: '逻辑函数化简', eyebrow: '当前章节', mastery: 62, duration: '15 分钟', active: true },
  { id: 'combination', title: '组合逻辑设计', eyebrow: '待学习', mastery: 36, duration: '18 分钟' },
  { id: 'hazard', title: '竞争与冒险', eyebrow: '拓展', mastery: 0, duration: '10 分钟' },
]

const COURSES_KEY = 'course-replay-courses-v1'
const MASTERY_KEY = 'course-replay-mastery-v1'

export function loadCourses(): Course[] {
  try {
    const stored = localStorage.getItem(COURSES_KEY)
    return stored ? JSON.parse(stored) : defaultCourses
  } catch {
    return defaultCourses
  }
}

export function saveCourses(courses: Course[]) {
  localStorage.setItem(COURSES_KEY, JSON.stringify(courses))
}

export function loadMastery() {
  const value = Number(localStorage.getItem(MASTERY_KEY))
  return Number.isFinite(value) && value > 0 ? value : 62
}

export function saveMastery(value: number) {
  localStorage.setItem(MASTERY_KEY, String(value))
}
