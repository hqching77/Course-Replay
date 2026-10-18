export type MaterialStatus = 'ready' | 'processing' | 'failed' | 'cancelled'

export interface CourseAnalysis {
  title: string
  summary: string
  learning_path: string[]
  key_concepts: string[]
  review_questions: string[]
}

export interface ProcessingJob {
  jobId: string
  materialIds: string[]
  progress: number
  stage: string
  message: string
}

export interface ExplorationNode {
  id: string
  title: string
  parentId: string
  question: string
}

export interface StudyMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  nodeId?: string
}

export interface Material {
  id: string
  name: string
  meta: string
  type: string
  status: MaterialStatus
  progress?: number
  error?: string
  previewUrl?: string
  pages?: number
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
  analysis?: CourseAnalysis
  analysisJobId?: string
  processingJob?: ProcessingJob
  explorationNodes?: ExplorationNode[]
  chatHistory?: StudyMessage[]
}

export const defaultCourses: Course[] = [
  {
    id: 'programming-linux',
    title: '计算机程序设计基础（1）',
    code: '30230672-4 · 2026 秋',
    description: '以 Linux 命令、文件系统与 Shell 为主线，完成程序开发的基础准备。',
    tags: ['Linux', '程序设计'],
    mastery: 42,
    updated: '刚刚导入',
    accent: '#7dd3fc',
    materials: [
      { id: 'linux-supplement-1', name: '补充材料 1：Linux基础.pdf', meta: '26 页 · 2.2 MB · 已解析', type: 'PDF', status: 'ready' },
    ],
    analysis: {
      title: 'Linux 命令与 Shell 基础',
      summary: '演示学习路径根据《补充材料 1：Linux基础》已解析的 26 页内容整理，覆盖路径与文件操作、Shell、用户权限、文本处理、脚本及 SSH。',
      learning_path: [
        '路径符号与 pwd、ls、cd',
        '文件与目录操作：mkdir、touch、cp、mv',
        'Shell、终端与命令执行',
        '用户、用户组与文件权限',
        'grep、重定向、管道与 Shell 脚本',
        '环境变量、SSH 与 tmux',
      ],
      key_concepts: ['当前目录与相对路径', 'Shell 与终端的分工', '文件权限 rwx', '标准输入输出重定向', '管道与 grep', 'PATH 环境变量'],
      review_questions: [
        '执行 cd ..、cd ~、pwd 分别会带来什么目录变化？请结合相对路径与主目录解释。',
        '为什么修改 hello.cpp 后需要再次运行 g++ src/hello.cpp -o bin/hello？',
        'Terminal、CLI 和 Shell 分别负责什么？它们在执行一条命令时如何协作？',
        'drwxr-xr-x 中的每一组字符分别表示谁的哪些权限？',
        '比较 >、>> 与管道符 | 的作用及适用场景。',
      ],
    },
  },
]

export const knowledgeNodes = [
  { id: 'filesystem', title: '路径与文件系统', eyebrow: '前置知识', mastery: 72, duration: '8 分钟', done: true },
  { id: 'commands', title: '常用文件操作命令', eyebrow: '核心概念', mastery: 58, duration: '12 分钟', done: true },
  { id: 'shell', title: 'Shell、终端与命令执行', eyebrow: '当前章节', mastery: 42, duration: '15 分钟', active: true },
  { id: 'permissions', title: '用户、用户组与权限', eyebrow: '待学习', mastery: 20, duration: '18 分钟' },
  { id: 'scripts', title: 'Shell 脚本与环境变量', eyebrow: '拓展', mastery: 0, duration: '10 分钟' },
]

const COURSES_KEY = 'course-replay-courses-linux-demo-v1'
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
