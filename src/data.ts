export type MaterialStatus = 'ready' | 'processing' | 'failed' | 'cancelled'

export interface CourseSection {
  title: string
  content: string
  key_points: string[]
  source_filename: string
  source_page: number
}

export interface CourseAnalysis {
  title: string
  summary: string
  learning_path: string[]
  key_concepts: string[]
  review_questions: string[]
  sections?: CourseSection[]
}

export type KnowledgeTier = 'prereq' | 'core' | 'advanced'

export interface KnowledgeNode {
  id: string
  title: string
  tier: KnowledgeTier
  summary: string
  /** Markdown content with GFM tables and LaTeX support. */
  content: string
}

export const TIER_META: Record<KnowledgeTier, { label: string; eyebrow: string; order: number }> = {
  prereq: { label: '前置知识', eyebrow: 'PREREQUISITE', order: 0 },
  core: { label: '核心知识点', eyebrow: 'CORE · 按讲课逻辑', order: 1 },
  advanced: { label: '进阶应用', eyebrow: 'ADVANCED', order: 2 },
}

function cleanStepText(value: string) {
  return value.replace(/^\s*(?:第?\d+[.、)）:]|[-*•])\s*/, '').replace(/\s+/g, ' ').trim()
}

function splitStep(value: string) {
  const clean = cleanStepText(value)
  const separator = clean.search(/[：:。；;]/)
  return {
    title: (separator > 0 ? clean.slice(0, separator) : clean).trim(),
    detail: (separator > 0 ? clean.slice(separator + 1) : '').trim(),
  }
}

export function deriveKnowledgeMap(analysis: CourseAnalysis): KnowledgeNode[] {
  const steps = analysis.learning_path || []
  const total = steps.length
  if (!total) return []
  const edge = total <= 2 ? 0 : Math.max(1, Math.round(total * 0.2))
  const buckets: string[][] = Array.from({ length: total }, () => [])
  ;(analysis.key_concepts || []).forEach((concept, index) => buckets[index % total].push(concept))
  return steps.map((rawStep, index) => {
    const { title, detail } = splitStep(rawStep)
    const section = analysis.sections?.[index]
    const tier: KnowledgeTier = index < edge ? 'prereq' : index >= total - edge ? 'advanced' : 'core'
    const concepts = section?.key_points?.length ? section.key_points : buckets[index]
    const question = analysis.review_questions?.[index]
    const summary = section?.content ? section.content.slice(0, 72) : detail || concepts.slice(0, 2).join('、') || `第 ${index + 1} 个学习阶段`
    const parts: string[] = [`## ${section?.title || title}`]
    if (section?.content) parts.push(section.content)
    else {
      if (index === 0 && analysis.summary) parts.push(analysis.summary)
      parts.push(`**本步聚焦**：${detail || title}`)
    }
    if (concepts.length) parts.push(`### 学习抓手\n\n${concepts.map((concept) => `- ${concept}`).join('\n')}`)
    if (question) parts.push(`### 自测\n\n> ${question}`)
    if (section?.source_filename) parts.push(`> 材料依据：${section.source_filename} · 第 ${section.source_page} 页`)
    else parts.push(`> 本节内容由「${analysis.title}」的 AI 分析整理，可向右侧 AI 讲师继续追问。`)
    return { id: `analysis-${index}`, title: section?.title || title, tier, summary, content: parts.join('\n\n') }
  })
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
  quote?: string
  nodeId?: string
  dialogId?: string
}

export interface StudyDialog {
  id: string
  title: string
  createdAt: number
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
  studyDialogs?: StudyDialog[]
  activeDialogId?: string
  knowledgeMap?: KnowledgeNode[]
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
      { id: 'linux-supplement-1', name: '补充材料 1：Linux基础.pdf', meta: '26 页 · 2.2 MB · 已解析', type: 'PDF', status: 'ready', pages: 26 },
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
      sections: [
        { title: '路径符号与常用导航命令', content: '先建立 Linux 文件系统的方向感：pwd 确认当前位置，ls 查看目录内容，cd 在绝对路径、相对路径、上级目录与主目录之间切换。理解这些符号后，后续所有命令才不会在错误目录中执行。', key_points: ['pwd 输出当前工作目录', '.. 表示上级目录，~ 表示主目录', '绝对路径从根目录 / 开始'], source_filename: '', source_page: 1 },
        { title: '文件与目录操作', content: 'mkdir 与 touch 分别创建目录和文件；cp 复制，mv 移动或重命名。执行前应先用 pwd 和 ls 验证当前位置，涉及目录复制时注意递归参数，避免把文件放到意外位置。', key_points: ['mkdir 创建目录', 'cp 复制，mv 移动或重命名', '操作前后用 ls 验证结果'], source_filename: '', source_page: 1 },
        { title: 'Shell、终端与命令执行', content: '终端提供输入输出界面，Shell 负责解释命令，CLI 是这种交互方式。输入命令后，Shell 解析名称与参数、查找可执行程序并启动进程，再把输出交回终端显示。', key_points: ['Terminal 是交互窗口', 'Shell 解释并执行命令', 'CLI 描述命令行交互方式'], source_filename: '', source_page: 1 },
        { title: '用户、用户组与文件权限', content: 'Linux 权限按所有者、用户组和其他用户三组表达，每组包含读、写、执行三位。ls -l 可以查看权限，chmod 用于调整权限；修改前要明确对象和最小必要权限。', key_points: ['r、w、x 分别表示读写执行', '权限分为 owner、group、others', '使用 chmod 修改权限'], source_filename: '', source_page: 1 },
        { title: '文本处理、重定向与脚本', content: 'grep 用于筛选文本；> 覆盖写入，>> 追加写入，管道符 | 把前一个命令的输出作为后一个命令的输入。把重复命令组合进 Shell 脚本，可以形成可复用的自动化流程。', key_points: ['grep 按模式筛选文本', '> 覆盖，>> 追加', '管道连接多个命令'], source_filename: '', source_page: 1 },
        { title: '环境变量、SSH 与 tmux', content: 'PATH 决定 Shell 去哪些目录查找命令；SSH 用于安全连接远程主机；tmux 让远程终端会话在断线后继续运行。三者共同支撑稳定、可重复的开发环境。', key_points: ['PATH 控制命令查找范围', 'SSH 建立远程连接', 'tmux 保持持久会话'], source_filename: '', source_page: 1 },
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

const COURSES_KEY = 'course-replay-courses-v1'
const DEV_COURSES_KEY = 'course-replay-courses-linux-demo-v1'
const COURSES_MIGRATED_KEY = 'course-replay-courses-dev-integrated-v1'
const MASTERY_KEY = 'course-replay-mastery-v1'

export function loadCourses(): Course[] {
  try {
    const readCourses = (key: string): Course[] | null => {
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) || 'null')
        return Array.isArray(stored) ? stored : null
      } catch {
        return null
      }
    }
    const saved = readCourses(COURSES_KEY)
    if (localStorage.getItem(COURSES_MIGRATED_KEY) === 'true') return saved || defaultCourses
    const devSaved = readCourses(DEV_COURSES_KEY)
    if (!saved && !devSaved) return defaultCourses
    const combined = new Map((devSaved || []).map((course) => [course.id, course]))
    for (const course of saved || []) {
      combined.set(course.id, { ...combined.get(course.id), ...course })
    }
    return [...combined.values()]
  } catch {
    return defaultCourses
  }
}

export function saveCourses(courses: Course[]) {
  localStorage.setItem(COURSES_KEY, JSON.stringify(courses))
  localStorage.setItem(COURSES_MIGRATED_KEY, 'true')
}

export function loadMastery() {
  const value = Number(localStorage.getItem(MASTERY_KEY))
  return Number.isFinite(value) && value > 0 ? value : 62
}

export function saveMastery(value: number) {
  localStorage.setItem(MASTERY_KEY, String(value))
}
