import { Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  File,
  FileText,
  FolderOpen,
  Gauge,
  Layers3,
  LayoutDashboard,
  Library,
  Lightbulb,
  Link as LinkIcon,
  ListChecks,
  MessageSquareText,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Course, CourseAnalysis, KnowledgeNode, KnowledgeTier, Material, Section, TIER_META, courseMastery, createSection, deriveKnowledgeMap, knowledgeNodes, loadCourses, loadMastery, normalizeMarkdown, saveCourses, saveMastery } from './data'

/** Update a single section inside the courses array immutably. */
function updateSection(setCourses: Dispatch<SetStateAction<Course[]>>, courseId: string, sectionId: string, updater: (section: Section) => Section) {
  setCourses((current) => current.map((course) => course.id === courseId ? {
    ...course,
    sections: course.sections.map((section) => section.id === sectionId ? updater(section) : section),
  } : course))
}

const MARKDOWN_PLUGINS = { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }
const TIER_ORDER: KnowledgeTier[] = ['prereq', 'core', 'advanced']

function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS.remarkPlugins} rehypePlugins={MARKDOWN_PLUGINS.rehypePlugins}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

type Notice = { id: number; message: string }

function trimText(value: string, limit: number) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit).trim()}…` : clean
}

function formatLearningStep(value: string) {
  const clean = value.replace(/^\s*(?:第?\d+[.、)）:]|[-*•])\s*/, '').replace(/\s+/g, ' ').trim()
  const separator = clean.search(/[：:。；;]/)
  const rawTitle = separator > 0 ? clean.slice(0, separator) : clean
  const rawDetail = separator > 0 ? clean.slice(separator + 1) : ''
  return {
    title: trimText(rawTitle, 34),
    detail: trimText(rawDetail, 86),
  }
}

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return minutes > 0 ? `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒` : `${seconds} 秒`
}

function rotateList(list: string[], start: number, count: number) {
  if (!list.length) return []
  const from = ((start % list.length) + list.length) % list.length
  return Array.from({ length: Math.min(count, list.length) }, (_, offset) => list[(from + offset) % list.length])
}
function formatConceptLabel(value: string) {
  const clean = value.replace(/^\s*(?:\d+[.、)）:]|[-*•])\s*/, '').trim()
  return trimText(clean.split(/[：:。；;]/)[0] || clean, 18)
}

function courseStats(course: Course) {
  const materials = course.sections.reduce((sum, section) => sum + section.materials.length, 0)
  const stages = course.sections.reduce((sum, section) => sum + (section.knowledgeMap?.length || section.analysis?.learning_path.length || 0), 0)
  return { sections: course.sections.length, materials, stages }
}

function courseSubtitle(course: Course) {
  const description = course.description.trim()
  if (description && description.length <= 180) return description
  const { sections, materials } = courseStats(course)
  return `${sections} 个小节 · ${materials} 份材料 · 随时开始学习`
}

/** First section id for a course, for "continue learning" style shortcuts. */
function firstSectionId(course: Course | undefined) {
  return course?.sections[0]?.id
}

function App() {
  const [courses, setCourses] = useState<Course[]>(loadCourses)
  const [notices, setNotices] = useState<Notice[]>([])

  useEffect(() => saveCourses(courses), [courses])

  const notify = (message: string) => {
    const id = Date.now()
    setNotices((items) => [...items, { id, message }])
    window.setTimeout(() => setNotices((items) => items.filter((item) => item.id !== id)), 2600)
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-shell">
        <Routes>
          <Route path="/" element={<Dashboard courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId" element={<CourseSections courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId/sections/:sectionId" element={<SectionDetail courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId/sections/:sectionId/replay" element={<Replay courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId/replay" element={<LegacySectionRedirect courses={courses} suffix="replay" />} />
          <Route path="/settings" element={<SettingsPage notify={notify} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <div className="toast-stack" aria-live="polite">
        {notices.map((notice) => (
          <div className="toast" key={notice.id}><CheckCircle2 size={17} />{notice.message}</div>
        ))}
      </div>
    </div>
  )
}

function Sidebar() {
  const location = useLocation()
  const courseId = location.pathname.match(/\/courses\/([^/]+)/)?.[1] || 'programming-linux'
  const sectionId = location.pathname.match(/\/sections\/([^/]+)/)?.[1]
  const base = sectionId ? `/courses/${courseId}/sections/${sectionId}` : `/courses/${courseId}`
  return (
    <aside className="sidebar">
      <Link className="brand" to="/" aria-label="Course Replay 首页">
        <span className="brand-mark"><span /></span>
        <span><strong>COURSE</strong><em>REPLAY</em></span>
      </Link>
      <nav className="nav-main">
        <NavItem to="/" end icon={<LayoutDashboard size={18} />} label="课程空间" />
        <NavItem to={sectionId ? `${base}/replay` : `/courses/${courseId}`} icon={<BrainCircuit size={18} />} label="课堂重放" />
      </nav>
      <div className="sidebar-label">当前学期</div>
      <div className="semester-card">
        <div className="semester-row"><span>2026 秋</span><ChevronDown size={15} /></div>
        <div className="semester-progress"><span style={{ width: '58%' }} /></div>
        <small>第 8 周 · 共 16 周</small>
      </div>
      <div className="sidebar-bottom">
        <NavItem to="/settings" icon={<Settings size={18} />} label="AI 与偏好设置" />
        <div className="profile">
          <div className="avatar">CY</div>
          <div><strong>学习者</strong><span>连续学习 7 天</span></div>
          <MoreHorizontal size={17} />
        </div>
      </div>
    </aside>
  )
}

function NavItem({ to, icon, label, end }: { to: string; icon: ReactNode; label: string; end?: boolean }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>{icon}<span>{label}</span></NavLink>
}

function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div><div className="eyebrow">COURSE REPLAY · LEARNING OS</div><h1>{title}</h1><p>{subtitle}</p></div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  )
}

function Dashboard({ courses, setCourses, notify }: { courses: Course[]; setCourses: (courses: Course[]) => void; notify: (message: string) => void }) {
  const [showCreate, setShowCreate] = useState(false)
  const navigate = useNavigate()
  const avg = Math.round(courses.reduce((sum, item) => sum + courseMastery(item), 0) / Math.max(courses.length, 1))
  const lead = courses[0]
  const leadReplay = lead && firstSectionId(lead) ? `/courses/${lead.id}/sections/${firstSectionId(lead)}/replay` : lead ? `/courses/${lead.id}` : '/'
  return (
    <div className="page dashboard-page">
      <PageHeader
        title="下午好，准备继续吗？"
        subtitle="把散落的课件与笔记，重新串成一条能真正掌握的学习路径。"
        actions={<><button className="icon-button" aria-label="搜索"><Search size={19} /></button><button className="button primary" onClick={() => setShowCreate(true)}><Plus size={18} />创建课程</button></>}
      />

      <section className="hero-card">
        <div className="hero-copy">
          <span className="pill lime"><Zap size={13} />继续上次学习</span>
          <h2>Shell、终端与命令执行</h2>
          <p>计算机程序设计基础（1）· 补充材料 1</p>
          <div className="hero-progress-row"><span>课程进度</span><strong>3 / 5</strong></div>
          <div className="hero-progress"><span style={{ width: '58%' }} /></div>
          <Link className="button light" to={leadReplay}>继续课堂重放 <ArrowRight size={17} /></Link>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="hero-node main-node"><BrainCircuit size={29} /><span>化简</span></div>
          <div className="hero-node node-a">A · B</div>
          <div className="hero-node node-b">A + B</div>
          <div className="hero-node node-c">K-map</div>
          <span className="connector connector-a" /><span className="connector connector-b" /><span className="connector connector-c" />
        </div>
      </section>

      <section className="metric-grid">
        <Metric icon={<Library size={18} />} label="进行中的课程" value={String(courses.length)} delta="本学期" />
        <Metric icon={<Gauge size={18} />} label="平均掌握度" value={`${avg}%`} delta="较上周 +6%" positive />
        <Metric icon={<Clock3 size={18} />} label="本周学习" value="4h 28m" delta="目标 6 小时" />
        <Metric icon={<Target size={18} />} label="待攻克知识点" value="7" delta="其中 3 个高优先级" />
      </section>

      <section className="section-block">
        <div className="section-heading"><div><h2>我的课程</h2><p>每门课都有独立的知识路径与学习记录</p></div><button className="text-button">查看全部 <ArrowRight size={15} /></button></div>
        <div className="course-grid">
          {courses.map((course) => <CourseCard key={course.id} course={course} onDelete={() => { if (window.confirm(`确定删除课程「${course.title}」？该课程下的所有小节与学习记录都会被移除。`)) { setCourses(courses.filter((item) => item.id !== course.id)); notify('课程已删除') } }} />)}
          <button className="new-course-card" onClick={() => setShowCreate(true)}><span><Plus size={22} /></span><strong>创建新课程</strong><small>导入课件，开始构建知识路径</small></button>
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel activity-panel">
          <div className="section-heading compact"><div><h2>最近活动</h2></div><button className="icon-button small"><MoreHorizontal size={17} /></button></div>
          <Activity icon={<Check size={15} />} color="green" title="完成「布尔代数」知识检验" meta="数字电路基础 · 今天 14:28" badge="掌握度 +15%" />
          <Activity icon={<MessageSquareText size={15} />} color="blue" title="探索：为什么德摩根定律可以推广？" meta="数字电路基础 · 今天 14:12" />
          <Activity icon={<FileText size={15} />} color="orange" title="生成期中复习题单" meta="信号与系统 · 昨天 21:08" badge="12 道题" />
        </div>
        <div className="panel focus-panel">
          <span className="pill amber"><Sparkles size={13} />AI 学习建议</span>
          <h3>先补上“卡诺图相邻项”</h3>
          <p>最近两次回答都在边界环绕规则上出错。花 6 分钟补齐这个前置知识，再继续组合逻辑设计。</p>
          <Link to={leadReplay} className="text-link">进入针对性复习 <ArrowRight size={15} /></Link>
        </div>
      </section>
      {showCreate && <CreateCourseModal onClose={() => setShowCreate(false)} onCreate={(course) => { setCourses([...courses, course]); setShowCreate(false); notify('课程已创建，去里面新建小节吧'); navigate(`/courses/${course.id}`) }} />}
    </div>
  )
}

function Metric({ icon, label, value, delta, positive }: { icon: ReactNode; label: string; value: string; delta: string; positive?: boolean }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : ''}>{delta}</small></div></div>
}

function CourseCard({ course, onDelete }: { course: Course; onDelete: () => void }) {
  const displayedMastery = courseMastery(course)
  const stats = courseStats(course)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <Link to={`/courses/${course.id}`} className="course-card">
      <div className="course-card-top"><span className="course-swatch" style={{ background: course.accent }} /><div className="material-menu-wrap"><button className="icon-button tiny" aria-label="课程操作" aria-expanded={menuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((value) => !value) }}><MoreHorizontal size={16} /></button>{menuOpen && <div className="material-menu" onMouseLeave={() => setMenuOpen(false)}><button className="delete" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); onDelete() }}><Trash2 size={14} />删除课程</button></div>}</div></div>
      <div className="course-code">{course.code}</div><h3>{course.title}</h3><p>{courseSubtitle(course)}</p>
      <div className="tag-row">{course.tags.map((tag, index) => <span key={`${tag}-${index}`} title={tag}>{formatConceptLabel(tag)}</span>)}</div>
      <div className="card-divider" />
      <div className="course-footer"><div><span>{stats.sections} 个小节 · {stats.materials} 份材料</span><small>最近学习 {course.updated || '刚刚'}</small></div><div className="ring" style={{ '--value': `${displayedMastery * 3.6}deg`, '--accent': course.accent } as React.CSSProperties}><span>{displayedMastery}%</span></div></div>
    </Link>
  )
}

function Activity({ icon, color, title, meta, badge }: { icon: ReactNode; color: string; title: string; meta: string; badge?: string }) {
  return <div className="activity-row"><span className={`activity-icon ${color}`}>{icon}</span><div><strong>{title}</strong><small>{meta}</small></div>{badge && <span className="activity-badge">{badge}</span>}</div>
}

function CreateCourseModal({ onClose, onCreate }: { onClose: () => void; onCreate: (course: Course) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    const id = `${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
    onCreate({ id, title: title.trim(), description: description.trim() || '一门新的课程，等待新建小节。', code: 'NEW · 2026 秋', tags: ['新课程'], mastery: 0, updated: '刚刚', accent: '#c7f45d', sections: [] })
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">NEW COURSE</span><h2>创建一门课程</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>课程名称<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：数字信号处理" /></label><label>课程简介<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="这门课主要学习什么？" /></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()}>创建课程 <ArrowRight size={16} /></button></div></form></div>
}

function useCourse(courses: Course[]) {
  const { courseId = '' } = useParams()
  return courses.find((course) => course.id === courseId)
}

function useSection(courses: Course[]) {
  const { courseId = '', sectionId = '' } = useParams()
  const course = courses.find((item) => item.id === courseId)
  const section = course?.sections.find((item) => item.id === sectionId)
  return { course, section }
}

function SectionSubnav({ courseId, sectionId }: { courseId: string; sectionId: string }) {
  const base = `/courses/${courseId}/sections/${sectionId}`
  return <div className="course-subnav"><NavLink end to={base}>材料与构建</NavLink><NavLink to={`${base}/replay`}>课堂重放</NavLink></div>
}

function LegacySectionRedirect({ courses, suffix }: { courses: Course[]; suffix: string }) {
  const { courseId = '' } = useParams()
  const course = courses.find((item) => item.id === courseId)
  if (!course) return <NotFound />
  const sectionId = course.sections[0]?.id
  return <Navigate to={sectionId ? `/courses/${courseId}/sections/${sectionId}/${suffix}` : `/courses/${courseId}`} replace />
}

function CourseSections({ courses, setCourses, notify }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; notify: (message: string) => void }) {
  const course = useCourse(courses)
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  if (!course) return <NotFound />
  const stats = courseStats(course)
  const createSectionAndOpen = (title: string) => {
    const section = createSection(title)
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, sections: [...item.sections, section], updated: '刚刚' } : item))
    setShowCreate(false)
    notify('小节已创建，上传文件后点击开始构建')
    navigate(`/courses/${course.id}/sections/${section.id}`)
  }
  const deleteSection = (sectionId: string) => {
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, sections: item.sections.filter((section) => section.id !== sectionId) } : item))
    notify('小节已删除')
  }
  return <div className="page">
    <div className="back-row"><Link to="/"><ArrowLeft size={16} />全部课程</Link><span>/</span><span>{course.title}</span></div>
    <PageHeader title={course.title} subtitle={courseSubtitle(course)} actions={<button className="button primary" onClick={() => setShowCreate(true)}><Plus size={17} />新建小节</button>} />
    <div className="overview-strip">
      <div><span>小节</span><strong>{course.sections.length}</strong><small>个独立单元</small></div>
      <div><span>材料</span><strong>{stats.materials}</strong><small>份课堂资料</small></div>
      <div><span>知识点</span><strong>{stats.stages}</strong><small>跨全部小节</small></div>
      <div className="overview-action"><span>整体掌握</span><strong>{courseMastery(course)}%</strong><small>各小节平均</small></div>
    </div>
    <section className="section-block">
      <div className="section-heading"><div><h2>课程小节</h2><p>每个小节独立上传文件、独立构建与学习，内容互不混用</p></div></div>
      <div className="course-grid section-grid">
        {course.sections.map((section) => <SectionCard key={section.id} courseId={course.id} section={section} onDelete={() => deleteSection(section.id)} />)}
        <button className="new-course-card" onClick={() => setShowCreate(true)}><span><Plus size={22} /></span><strong>新建小节</strong><small>上传本节课件，开始构建</small></button>
      </div>
    </section>
    {showCreate && <CreateSectionModal onClose={() => setShowCreate(false)} onCreate={createSectionAndOpen} />}
  </div>
}

function SectionCard({ courseId, section, onDelete }: { courseId: string; section: Section; onDelete: () => void }) {
  const ready = section.status === 'ready'
  const stageCount = section.knowledgeMap?.length || section.analysis?.learning_path.length || 0
  const statusLabel = section.status === 'ready' ? '已构建' : section.status === 'building' ? '构建中' : section.status === 'failed' ? '构建失败' : '待构建'
  return <Link to={`/courses/${courseId}/sections/${section.id}`} className="course-card section-card">
    <div className="course-card-top"><span className={`section-status ${section.status}`}>{statusLabel}</span><button className="icon-button tiny" aria-label="删除小节" onClick={(event) => { event.preventDefault(); onDelete() }}><Trash2 size={15} /></button></div>
    <h3>{section.title}</h3>
    <p>{section.analysis ? trimText(section.analysis.summary, 92) : '上传文件并点击“开始构建”，生成本节的分层讲稿与题目。'}</p>
    <div className="card-divider" />
    <div className="course-footer"><div><span>{section.materials.length} 份材料 · {stageCount} 个知识点</span><small>{ready ? '可开始学习' : section.status === 'building' ? '正在构建…' : '等待构建'}</small></div>{ready && <span className="section-go"><ArrowRight size={16} /></span>}</div>
  </Link>
}

function CreateSectionModal({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string) => void }) {
  const [title, setTitle] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; onCreate(title.trim()) }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">NEW SECTION</span><h2>新建小节</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>小节名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：第 3 章 · 递推与动态规划" /></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()}>创建并上传材料 <ArrowRight size={16} /></button></div></form></div>
}

function SectionDetail({ courses, setCourses, notify }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; notify: (message: string) => void }) {
  const { course, section } = useSection(courses)
  const inputRef = useRef<HTMLInputElement>(null)
  const stagedFilesRef = useRef<Map<string, File>>(new Map())
  const uploadControllerRef = useRef<AbortController | null>(null)
  const [apiError, setApiError] = useState('')
  const [openMaterialMenu, setOpenMaterialMenu] = useState<string | null>(null)
  const [analysisExpanded, setAnalysisExpanded] = useState(false)
  const [starting, setStarting] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const courseId = course?.id
  const sectionId = section?.id
  const processingJob = section?.processingJob

  useEffect(() => {
    if (!courseId || !sectionId || !processingJob?.jobId) return
    let active = true
    const controller = new AbortController()
    const jobId = processingJob.jobId
    const materialIds = processingJob.materialIds

    const failJob = (message: string) => {
      if (!active) return
      setApiError(message)
      updateSection(setCourses, courseId, sectionId, (current) => current.processingJob?.jobId === jobId ? {
        ...current,
        processingJob: undefined,
        status: 'failed',
        materials: current.materials.map((material) => materialIds.includes(material.id) ? { ...material, status: 'failed' as const, error: message } : material),
      } : current)
    }

    const poll = async () => {
      while (active) {
        try {
          const response = await fetch(`/api/process/${jobId}`, { signal: controller.signal })
          const job = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(job.detail || `读取任务状态失败（HTTP ${response.status}）`)
          if (!active) return

          updateSection(setCourses, courseId, sectionId, (current) => current.processingJob?.jobId === jobId ? {
            ...current,
            processingJob: { ...current.processingJob!, progress: job.progress || 0, stage: job.stage || 'queued', message: job.message || '正在处理材料', filesTotal: job.files_total, filesDone: job.files_done, currentFile: job.current_file, pagesTotal: job.pages_total, pagesDone: job.pages_done },
            materials: current.materials.map((material) => materialIds.includes(material.id) ? { ...material, progress: job.progress || 0 } : material),
          } : current)

          if (job.status === 'completed' && job.result) {
            const payload = job.result as {
              analysis: CourseAnalysis
              model: string
              documents: { filename: string; pages: number; processing: string; preview_url: string }[]
            }
            updateSection(setCourses, courseId, sectionId, (current) => current.processingJob?.jobId === jobId ? {
              ...current,
              processingJob: undefined,
              status: 'ready',
              analysis: payload.analysis,
              analysisJobId: jobId,
              knowledgeMap: payload.analysis.knowledge_map?.length ? payload.analysis.knowledge_map : undefined,
              materials: current.materials.map((material) => {
                if (!materialIds.includes(material.id)) return material
                const materialIndex = materialIds.indexOf(material.id)
                const document = payload.documents[materialIndex] || payload.documents.find((entry) => entry.filename === material.name)
                return {
                  ...material,
                  status: 'ready' as const,
                  error: undefined,
                  progress: 100,
                  pages: document?.pages,
                  previewUrl: document?.preview_url,
                  meta: document ? `${document.pages} 页 · ${document.processing}` : material.meta,
                }
              }),
            } : current)
            setCourses((current) => current.map((item) => item.id === courseId ? { ...item, updated: '刚刚', tags: item.tags?.length ? item.tags : payload.analysis.key_concepts.slice(0, 3).map(formatConceptLabel) } : item))
            setApiError('')
            notify('小节构建完成，已生成分层学习内容')
            return
          }
          if (job.status === 'failed') return failJob(job.error || job.message || '材料处理失败')
          if (job.status === 'cancelled') return failJob('处理任务已取消')
          await new Promise((resolve) => window.setTimeout(resolve, 900))
        } catch (error) {
          if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
          return failJob(error instanceof Error ? error.message : '材料处理失败')
        }
      }
    }

    void poll()
    return () => {
      active = false
      controller.abort()
    }
  }, [courseId, sectionId, processingJob?.jobId, setCourses])

  // Tick every second while building so elapsed / ETA stay live.
  const isBuilding = Boolean(processingJob) || starting
  useEffect(() => {
    if (!isBuilding) return
    setNowTs(Date.now())
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isBuilding])

  if (!course || !section) return <NotFound />

  const building = Boolean(processingJob) || starting
  const pendingCount = section.materials.filter((material) => material.status === 'pending').length
  const canBuild = pendingCount > 0 && !building
  const analysis = section.analysis
  const learningSteps = analysis?.learning_path.map(formatLearningStep) || []
  const conceptLabels = analysis?.key_concepts.map(formatConceptLabel) || []

  const stageFiles = (files: FileList | null) => {
    if (!files?.length || building) return
    const selected = Array.from(files)
    const additions: Material[] = selected.map((file, index) => ({ id: `stage-${Date.now()}-${index}`, name: file.name, meta: `${Math.max(1, Math.round(file.size / 1024))} KB · 待构建`, type: file.name.split('.').pop()?.toUpperCase() || 'FILE', status: 'pending', progress: 0 }))
    additions.forEach((material, index) => stagedFilesRef.current.set(material.id, selected[index]))
    updateSection(setCourses, course.id, section.id, (current) => ({ ...current, materials: [...current.materials, ...additions] }))
    setApiError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const removeMaterial = (materialId: string) => {
    stagedFilesRef.current.delete(materialId)
    updateSection(setCourses, course.id, section.id, (current) => ({ ...current, materials: current.materials.filter((material) => material.id !== materialId) }))
    setOpenMaterialMenu(null)
    notify('文件已移除')
  }

  const startBuild = async () => {
    const staged = section.materials.filter((material) => material.status === 'pending' && stagedFilesRef.current.has(material.id))
    if (!staged.length) {
      setApiError('没有可构建的文件：请先上传文件（刷新后未构建的暂存文件会丢失，需重新上传）')
      return
    }
    const materialIds = staged.map((material) => material.id)
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setStarting(true)
    setApiError('')
    updateSection(setCourses, course.id, section.id, (current) => ({
      ...current,
      status: 'building',
      materials: current.materials.map((material) => materialIds.includes(material.id) ? { ...material, status: 'processing' as const, meta: '正在上传…' } : material),
    }))
    const formData = new FormData()
    staged.forEach((material) => { const file = stagedFilesRef.current.get(material.id); if (file) formData.append('files', file) })
    try {
      const response = await fetch('/api/process/start', { method: 'POST', body: formData, signal: controller.signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || `构建启动失败（HTTP ${response.status}）`)
      updateSection(setCourses, course.id, section.id, (current) => ({ ...current, processingJob: { jobId: payload.job_id, materialIds, progress: 8, stage: 'queued', message: '文件已上传，等待处理', filesTotal: staged.length, filesDone: 0, pagesDone: 0, startedAt: Date.now() } }))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : '构建启动失败'
      setApiError(message)
      updateSection(setCourses, course.id, section.id, (current) => ({
        ...current,
        status: 'failed',
        materials: current.materials.map((material) => materialIds.includes(material.id) ? { ...material, status: 'failed' as const, error: message } : material),
      }))
    } finally {
      setStarting(false)
      uploadControllerRef.current = null
    }
  }

  const cancelBuild = async () => {
    uploadControllerRef.current?.abort()
    const job = section.processingJob
    if (job?.jobId) void fetch(`/api/process/${job.jobId}`, { method: 'DELETE' }).catch(() => undefined)
    const ids = new Set(job?.materialIds || [])
    updateSection(setCourses, course.id, section.id, (current) => ({
      ...current,
      processingJob: undefined,
      status: current.analysis ? 'ready' : 'empty',
      materials: current.materials.map((material) => ids.has(material.id) ? { ...material, status: 'pending' as const, meta: '待构建', error: undefined } : material),
    }))
    setStarting(false)
    setApiError('')
    notify('已取消构建')
  }

  const stages: [string, string][] = [
    ['uploading', '上传文件'],
    ['rendering', '逐页渲染'],
    ['model', 'AI 逐文件分析'],
    ['finalizing', '整理讲稿'],
  ]
  const stageKey = processingJob?.stage ?? 'uploading'
  const activeStageIndex = stageKey === 'queued' ? 0 : stageKey === 'completed' ? stages.length : stages.findIndex(([key]) => key === stageKey)
  const progress = processingJob?.progress ?? (starting ? 5 : 0)
  const filesLine = processingJob?.filesTotal ? `第 ${Math.min((processingJob.filesDone || 0) + 1, processingJob.filesTotal)} / ${processingJob.filesTotal} 个文件` : ''
  const pagesLine = processingJob?.pagesTotal ? `已构建 ${processingJob.pagesDone || 0} / ${processingJob.pagesTotal} 页` : (processingJob?.pagesDone ? `已构建 ${processingJob.pagesDone} 页` : '')
  const elapsedSec = processingJob?.startedAt ? Math.max(0, (nowTs - processingJob.startedAt) / 1000) : 0
  const estPages = processingJob?.pagesTotal || (processingJob?.filesTotal || pendingCount || 1) * 8
  const estTotalSec = Math.max(20, estPages * 4 + 15)
  const remainingSec = Math.max(0, estTotalSec - elapsedSec)
  const buildLabel = analysis ? '重新构建' : '开始构建'

  return <div className="page">
    <div className="back-row"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link><span>/</span><span>{section.title}</span></div>
    <PageHeader title={section.title} subtitle={analysis ? trimText(analysis.summary, 150) : '上传本小节的文件，再点击“开始构建”，逐个文件分析生成分层讲稿。'} actions={analysis ? <Link className="button primary" to={`/courses/${course.id}/sections/${section.id}/replay`}><BrainCircuit size={17} />开始学习</Link> : undefined} />
    <SectionSubnav courseId={course.id} sectionId={section.id} />
    <div className="overview-strip"><div><span>材料</span><strong>{section.materials.length}</strong><small>本节文件</small></div><div><span>待构建</span><strong>{pendingCount}</strong><small>已暂存文件</small></div><div><span>知识点</span><strong>{section.knowledgeMap?.length || analysis?.key_concepts.length || 0}</strong><small>{analysis ? '来自本次构建' : '等待构建'}</small></div><div className="overview-action"><span>状态</span><strong>{section.status === 'ready' ? '已构建' : section.status === 'building' ? '构建中' : section.status === 'failed' ? '构建失败' : '待构建'}</strong><small>{analysis ? '可开始学习' : '仅处理本小节文件'}</small></div></div>
    <div className="materials-layout">
      <section className="panel material-panel">
        <div className="section-heading"><div><h2>本节材料</h2><p>支持 PDF、PPTX、DOCX、Markdown、TXT 与图片 · 仅属于本小节</p></div><div className="build-actions"><button className="button secondary" disabled={building} onClick={() => inputRef.current?.click()}><UploadCloud size={17} />上传文件</button><button className="button primary" disabled={!canBuild} onClick={() => void startBuild()}><Sparkles size={16} />{buildLabel}</button></div></div>
        <input ref={inputRef} type="file" multiple hidden accept=".pdf,.ppt,.pptx,.doc,.docx,.odt,.odp,.md,.txt,.png,.jpg,.jpeg,.webp" onChange={(event) => stageFiles(event.target.files)} />
        <button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); stageFiles(event.dataTransfer.files) }}><span><UploadCloud size={23} /></span><strong>拖入本小节的课件、笔记或板书照片</strong><small>先上传（可多份），再点“{buildLabel}”逐个分析 · 刷新前请完成构建</small></button>
        {building && <div className="processing-card"><div className="processing-top"><div className="spinner" /><div><strong>{processingJob?.message || '正在准备构建'}</strong><span>{[filesLine].filter(Boolean).join(' · ') || '整页视觉输入 · 不使用 OCR · 可随时取消'}{processingJob?.currentFile ? ` · ${processingJob.currentFile}` : ''}</span></div><b>{Math.min(progress, 100)}%</b></div><div className="thin-progress"><span style={{ width: `${Math.min(progress, 100)}%` }} /></div><div className="build-meta"><span><Clock3 size={13} />已用 {formatDuration(elapsedSec)}</span><span><Clock3 size={13} />{remainingSec > 1 ? `预计剩余 ~${formatDuration(remainingSec)}` : '即将完成…'}</span>{pagesLine && <span><FileText size={13} />{pagesLine}</span>}</div><div className="processing-stages">{stages.map(([key, label], index) => <span key={key} className={index < activeStageIndex ? 'done' : index === activeStageIndex ? 'active' : ''}>{index < activeStageIndex ? <Check size={12} /> : index + 1}{label}</span>)}</div><button className="button danger compact" onClick={() => void cancelBuild()}><X size={15} />取消构建</button></div>}
        {apiError && <div className="api-error"><CircleHelp size={18} /><div><strong>构建失败</strong><p>{apiError}</p></div></div>}
        {analysis && <article className="analysis-result">
          <div className="analysis-result-head"><span><Sparkles size={16} /></span><div><small>AI STUDY BRIEF · 本小节已构建</small><h3>{analysis.title}</h3></div><Link className="button primary compact analysis-action" to={`/courses/${course.id}/sections/${section.id}/replay`}>按路线学习 <ArrowRight size={14} /></Link></div>
          <div className="analysis-study-grid">
            <section className="analysis-summary-block"><span className="analysis-label"><BookOpen size={14} />本节摘要</span><p className={analysisExpanded ? 'expanded' : ''}>{analysis.summary}</p>{analysis.summary.length > 180 && <button className="analysis-toggle" onClick={() => setAnalysisExpanded((value) => !value)}>{analysisExpanded ? '收起摘要' : '展开完整摘要'} <ChevronDown size={13} /></button>}</section>
            <section className="analysis-route-block"><span className="analysis-label"><Network size={14} />推荐学习路线</span><div className="analysis-path">{learningSteps.map((step, index) => <div key={`${step.title}-${index}`}><i>{index + 1}</i><span><strong>{step.title}</strong>{step.detail && <small>{step.detail}</small>}</span></div>)}</div></section>
          </div>
          {conceptLabels.length > 0 && <div className="analysis-concept-block"><span className="analysis-label"><Lightbulb size={14} />核心概念</span><div className="analysis-concepts">{conceptLabels.map((concept, index) => <span title={analysis.key_concepts[index]} key={`${concept}-${index}`}>{concept}</span>)}</div></div>}
        </article>}
        <div className="file-list">
          {section.materials.length === 0 && <div className="empty-hint">本小节还没有文件。点击上方“上传文件”添加课件后开始构建。</div>}
          {section.materials.map((material) => <div className="file-row" key={material.id}>
            <span className={`file-type ${material.type.toLowerCase()}`}><FileText size={18} /></span>
            <div className="file-info"><strong>{material.name}</strong><span title={material.error}>{material.error || material.meta}</span></div>
            {material.previewUrl && <a className="file-preview-link" href={material.previewUrl} target="_blank" rel="noreferrer">查看文档</a>}
            <div className={`status ${material.status}`}>{material.status === 'ready' ? <><CheckCircle2 size={15} />已就绪</> : material.status === 'failed' ? <><X size={14} />失败</> : material.status === 'cancelled' ? <><X size={14} />已取消</> : material.status === 'pending' ? <><Clock3 size={14} />待构建</> : <><RefreshCw size={14} />构建中{material.progress ? ` · ${material.progress}%` : ''}</>}</div>
            <div className="material-menu-wrap">
              <button className="icon-button tiny" aria-label={`${material.name} 操作`} aria-expanded={openMaterialMenu === material.id} onClick={() => setOpenMaterialMenu((current) => current === material.id ? null : material.id)}><MoreHorizontal size={17} /></button>
              {openMaterialMenu === material.id && <div className="material-menu">
                {material.previewUrl && <a href={material.previewUrl} target="_blank" rel="noreferrer"><FileText size={14} />查看文档</a>}
                <button className="delete" onClick={() => removeMaterial(material.id)} disabled={building && material.status === 'processing'}><Trash2 size={14} />移除文件</button>
              </div>}
            </div>
          </div>)}
        </div>
      </section>
      <aside className="right-stack">
        <section className="panel knowledge-preview"><div className="panel-kicker"><Network size={16} />本节讲稿</div><h3>{analysis ? `${section.knowledgeMap?.length || learningSteps.length} 个知识节点 · ${conceptLabels.length} 个概念` : '等待构建'}</h3><div className="mini-tree"><span className="tree-root">{analysis?.title || section.title}</span><i /><div>{(learningSteps.slice(0, 3).map((step) => step.title).length ? learningSteps.slice(0, 3).map((step) => step.title) : ['上传文件', '开始构建', '开始学习']).map((step, index) => <span title={analysis?.learning_path[index]} key={`${step}-${index}`} className={index === 0 && analysis ? 'active' : ''}>{step}</span>)}</div></div>{analysis ? <Link to={`/courses/${course.id}/sections/${section.id}/replay`} className="text-link">查看完整讲稿 <ArrowRight size={15} /></Link> : <span className="text-link muted">构建后可查看</span>}</section>
        <section className="panel provider-note"><div className="provider-top"><span className="online-dot" />逐文件构建 · 内容隔离</div><p>每个小节只处理自己上传的文件，构建结果（讲稿、题目、聊天）不会与其它小节混用。图片与文档页面交给视觉模型，API Key 仅存服务端。</p><Link to="/settings">查看配置</Link></section>
      </aside>
    </div>
  </div>
}

function Replay({ courses, setCourses, notify }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; notify: (message: string) => void }) {
  const { courseId = '', sectionId = '' } = useParams()
  const course = courses.find((item) => item.id === courseId)
  const section = course?.sections.find((item) => item.id === sectionId)
  const [selected, setSelected] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [mastery, setMastery] = useState(() => loadMastery(sectionId, section?.mastery ?? 0))
  const [chat, setChat] = useState('')
  const [asking, setAsking] = useState(false)
  const kmNodes = useMemo<KnowledgeNode[]>(() => {
    if (section?.knowledgeMap?.length) return section.knowledgeMap
    if (section?.analysis?.learning_path.length) return deriveKnowledgeMap(section.analysis)
    return knowledgeNodes.map((node) => ({ id: node.id, title: node.title, tier: 'core' as KnowledgeTier, summary: node.eyebrow, content: `## ${node.title}\n\n上传并构建本小节材料后，这里会生成结构化的学习内容。` }))
  }, [section?.knowledgeMap, section?.analysis])
  const orderedNodes = useMemo(() => TIER_ORDER.flatMap((tier) => kmNodes.filter((node) => node.tier === tier)), [kmNodes])
  const grouped = useMemo(() => TIER_ORDER.map((tier) => ({ tier, nodes: kmNodes.filter((node) => node.tier === tier) })).filter((group) => group.nodes.length), [kmNodes])
  const explorationNodes = section?.explorationNodes || []
  const chatHistory = section?.chatHistory || []

  useEffect(() => {
    if (orderedNodes.length && !orderedNodes.some((node) => node.id === selected) && !explorationNodes.some((node) => node.id === selected)) {
      setSelected(orderedNodes[0].id)
    }
  }, [orderedNodes, explorationNodes, selected])

  if (!course || !section) return <NotFound />

  const activeIndex = orderedNodes.findIndex((node) => node.id === selected)
  const activeKnowledge = kmNodes.find((node) => node.id === selected)
  const activeExploration = explorationNodes.find((node) => node.id === selected)
  const explorationAnswer = activeExploration ? (chatHistory.find((message) => message.role === 'assistant' && message.nodeId === activeExploration.id)?.content || '') : ''
  const activeContent = activeKnowledge ? activeKnowledge.content
    : activeExploration ? `## ${activeExploration.title}\n\n> ❓ ${normalizeMarkdown(activeExploration.question)}\n\n${explorationAnswer ? normalizeMarkdown(explorationAnswer) : '_正在生成回答…_'}`
    : (orderedNodes[0]?.content || '## 等待材料分析\n\n上传课件后将在这里生成结构化的学习内容。')
  const currentTitle = activeKnowledge?.title || activeExploration?.title || orderedNodes[Math.max(activeIndex, 0)]?.title || section.analysis?.title || section.title
  const activeTier = activeKnowledge?.tier
  const tierLabel = activeKnowledge ? TIER_META[activeKnowledge.tier].label : activeExploration ? '探索支线' : '知识节点'
  const tierEyebrow = activeKnowledge ? TIER_META[activeKnowledge.tier].eyebrow : 'EXPLORATION'
  const progressPct = orderedNodes.length ? Math.max(8, ((Math.max(activeIndex, 0) + 1) / orderedNodes.length) * 100) : 8
  const generatedQuestion = section.analysis?.review_questions[0]

  const submitAnswer = () => {
    if (!answer) return
    setSubmitted(true)
    if (section.analysis) {
      const next = Math.min(100, mastery + 5)
      setMastery(next)
      saveMastery(section.id, next)
      updateSection(setCourses, course.id, section.id, (current) => ({ ...current, mastery: next }))
    } else if (answer === 'B' && mastery < 77) {
      setMastery(77)
      saveMastery(section.id, 77)
      updateSection(setCourses, course.id, section.id, (current) => ({ ...current, mastery: 77 }))
    }
  }
  const ask = async () => {
    const question = chat.trim()
    if (!question || asking) return
    const userMessageId = `message-${Date.now()}-user`
    const parentId = activeKnowledge ? selected : (activeExploration?.parentId || orderedNodes[0]?.id || 'course-root')
    setChat('')
    setAsking(true)
    updateSection(setCourses, course.id, section.id, (current) => ({
      ...current,
      chatHistory: [...(current.chatHistory || []), { id: userMessageId, role: 'user' as const, content: question }],
    }))
    try {
      const response = await fetch('/api/study/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          course_title: `${course.title} · ${section.title}`,
          current_topic: currentTitle,
          summary: section.analysis?.summary || course.description,
          learning_path: section.analysis?.learning_path || kmNodes.map((node) => node.title),
          key_concepts: section.analysis?.key_concepts || course.tags,
          existing_nodes: [...kmNodes.map((node) => node.title), ...explorationNodes.map((node) => node.title)],
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || `AI 回答失败（HTTP ${response.status}）`)
      const nodeId = payload.add_node && payload.node_title ? `branch-${Date.now()}` : undefined
      updateSection(setCourses, course.id, section.id, (current) => ({
        ...current,
        explorationNodes: nodeId ? [...(current.explorationNodes || []), { id: nodeId, title: formatConceptLabel(payload.node_title), parentId, question }] : current.explorationNodes,
        chatHistory: [...(current.chatHistory || []), { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: payload.answer || '我暂时无法回答这个问题。', nodeId }],
      }))
      if (nodeId) {
        setSelected(nodeId)
        notify(`拓扑图已新增：${formatConceptLabel(payload.node_title)}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 回答失败'
      updateSection(setCourses, course.id, section.id, (current) => ({
        ...current,
        chatHistory: [...(current.chatHistory || []), { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: message }],
      }))
    } finally {
      setAsking(false)
    }
  }
  return <div className="replay-page">
    <div className="replay-topbar"><Link to={`/courses/${course.id}/sections/${section.id}`}><ArrowLeft size={16} />{section.title}</Link><div className="replay-location"><span>{course.title}</span><ChevronRight size={14} /><strong>{currentTitle}</strong></div><div className="replay-actions"><span className="saved"><Check size={14} />分析与进度已保存</span><button className="icon-button"><PanelLeftClose size={18} /></button></div></div>
    <div className="replay-grid">
      <aside className="path-column">
        <div className="path-head"><span className="eyebrow">LIVE KNOWLEDGE MAP</span><h2>课程知识拓扑</h2><div><span>{kmNodes.length} 个知识节点</span><span>{explorationNodes.length} 条探索支线</span></div><div className="thin-progress"><span style={{ width: `${progressPct}%` }} /></div></div>
        <div className="tier-scroll">
          {grouped.map((group) => <section className={`tier-group tier-${group.tier}`} key={group.tier}>
            <header className="tier-label"><span className="tier-dot" /><div><small>{TIER_META[group.tier].eyebrow}</small><strong>{TIER_META[group.tier].label}</strong></div><span className="tier-count">{group.nodes.length}</span></header>
            <div className="tier-nodes">
              {group.nodes.map((node) => {
                const globalIndex = orderedNodes.findIndex((candidate) => candidate.id === node.id)
                const children = explorationNodes.filter((child) => child.parentId === node.id)
                return <div className="tier-node-wrap" key={node.id}>
                  <button className={`km-node ${selected === node.id ? 'active' : ''} ${activeIndex > -1 && globalIndex < activeIndex ? 'done' : ''}`} onClick={() => setSelected(node.id)}>
                    <span className="km-step">{String(globalIndex + 1).padStart(2, '0')}</span>
                    <span className="km-text"><strong>{node.title}</strong><small>{node.summary}</small></span>
                  </button>
                  {children.map((child) => <button key={child.id} className={`km-branch ${selected === child.id ? 'active' : ''}`} onClick={() => setSelected(child.id)}><Network size={12} /><span>{child.title}</span></button>)}
                </div>
              })}
            </div>
          </section>)}
          {asking && <div className="km-pending"><span className="mini-spinner" />正在判断是否扩展支线…</div>}
        </div>
        <div className="topology-legend"><span><i className="t-prereq" />前置</span><span><i className="t-core" />核心</span><span><i className="t-advanced" />进阶</span><span><i className="t-branch" />问答支线</span></div>
        <div className="path-tip"><Lightbulb size={16} /><p>内容按「前置 → 核心 → 进阶」分层。点击节点切换学习焦点，向 AI 提问会自动长出探索支线。</p></div>
      </aside>

      <section className="content-column">
        <div className="content-toolbar"><div><span className={`tier-badge tier-${activeTier || 'branch'}`}>{tierLabel}</span><strong>{currentTitle}</strong></div><span>{section.materials[0]?.name || (section.analysis ? '已完成构建' : '等待构建')}</span></div>
        <div className="reading-stage">
          <article className="reading-paper">
            <div className="reading-index"><span>{String(Math.max(activeIndex, 0) + 1).padStart(2, '0')}</span><em>{tierEyebrow} · 学习路径</em></div>
            <Markdown>{activeContent}</Markdown>
          </article>
        </div>
        <div className="source-strip"><LinkIcon size={15} /><span>材料依据</span>{section.materials.length ? section.materials.map((material) => <button key={material.id} onClick={() => notify(`材料：${material.name}`)}>{material.name}</button>) : <button onClick={() => notify('请先返回小节上传并完成构建')}>暂无关联材料</button>}</div>
        <div className="content-nav"><button className="button ghost" onClick={() => activeIndex > 0 && setSelected(orderedNodes[activeIndex - 1].id)} disabled={activeIndex <= 0}><ArrowLeft size={16} />上一步</button><span>步骤 {Math.max(activeIndex + 1, 1)} / {orderedNodes.length}</span><button className="button dark" onClick={() => activeIndex > -1 && activeIndex < orderedNodes.length - 1 && setSelected(orderedNodes[activeIndex + 1].id)} disabled={activeIndex < 0 || activeIndex >= orderedNodes.length - 1}>继续：{orderedNodes[activeIndex + 1]?.title || '已到终点'} <ArrowRight size={16} /></button></div>
      </section>

      <aside className="ai-column">
        <div className="ai-head"><div><span className="ai-avatar"><Bot size={19} /></span><div><strong>AI 讲师</strong><small><span className="online-dot" />基于本小节 {section.materials.filter((item) => item.status === 'ready').length} 份材料</small></div></div><button className="icon-button tiny"><MoreHorizontal size={17} /></button></div>
        <div className="chat-scroll">
          <div className="ai-message">{section.analysis ? <Markdown className="on-dark">{normalizeMarkdown(trimText(section.analysis.summary, 320))}</Markdown> : <p>观察这个卡诺图。橙色圈跨过了左右边界——因为卡诺图的列按 <strong>00、01、11、10</strong> 排列，首尾依然只相差一个变量。</p>}<div className="citation-row">{section.materials.slice(0, 2).map((material, index) => <button key={material.id}>[{index + 1}] {material.name}</button>)}</div></div>
          <div className="ai-message question-card"><span className="question-type">理解检验 · {generatedQuestion ? '基于材料' : '单选题'}</span><div className="q-text"><Markdown className="on-dark">{normalizeMarkdown(generatedQuestion || '为什么卡诺图中最左列与最右列可以视为相邻？')}</Markdown></div>{generatedQuestion ? <textarea className="review-answer" value={answer || ''} disabled={submitted} onChange={(event) => setAnswer(event.target.value)} placeholder="根据刚才看到的材料写下你的理解…" /> : <div className="answer-list">
            {[['A','它们在图形位置上最近'],['B','格雷码顺序使它们仅有一位变量不同'],['C','所有边界上的格子都彼此相邻'],['D','这是为了让化简结果更短']].map(([key, value]) => <button key={key} disabled={submitted} onClick={() => setAnswer(key)} className={`${answer === key ? 'selected' : ''} ${submitted && key === 'B' ? 'correct' : ''} ${submitted && answer === key && key !== 'B' ? 'wrong' : ''}`}><span>{key}</span>{value}{submitted && key === 'B' && <CheckCircle2 size={16} />}</button>)}
          </div>}<button className="button primary full" disabled={!answer?.trim() || submitted} onClick={submitAnswer}>{submitted ? '回答已保存' : '提交回答'}</button></div>
          {submitted && <div className="feedback-card"><div className="feedback-title"><CheckCircle2 size={18} /><strong>{generatedQuestion ? '回答已记录到当前学习进度' : answer === 'B' ? '回答正确，而且理由匹配' : '再看一下格雷码的排列规则'}</strong><span>{generatedQuestion ? '+5%' : answer === 'B' ? '+15%' : '-8%'}</span></div><p>{generatedQuestion ? '这是根据你上传材料生成的开放题；可以继续向 AI 讲师追问并补充答案。' : answer === 'B' ? '这说明你理解了“逻辑相邻”而不是根据图形位置猜测。' : '边界相邻的关键不是物理距离，而是只有一位变量发生变化。'}</p><div className="mastery-change"><span>本知识点掌握度</span><div><i style={{ width: `${mastery}%` }} /></div><strong>{mastery}%</strong></div><div className="feedback-actions"><button onClick={() => setChat(`为什么“${currentTitle}”是这样？`)}>为什么？深入解释</button><button onClick={() => setChat(`学习“${currentTitle}”前需要补什么基础？`)}>补充前置知识</button></div></div>}
          {chatHistory.map((message) => message.role === 'user' ? <div className="user-message" key={message.id}>{message.content}</div> : <div className="ai-message compact-message" key={message.id}><Markdown className="on-dark">{normalizeMarkdown(message.content)}</Markdown>{message.nodeId && <button className="topology-jump" onClick={() => setSelected(message.nodeId!)}><GitBranchIcon />已加入拓扑图 · 点击定位</button>}</div>)}
          {asking && <div className="ai-message compact-message thinking-message"><span className="mini-spinner" /><p>正在结合当前节点判断是否需要扩展知识拓扑…</p></div>}
        </div>
        <div className="ask-box"><div className="quick-prompts"><button onClick={() => setChat(`换一个类比解释“${currentTitle}”`)}>换个类比</button><button onClick={() => setChat(`基于“${currentTitle}”给我一道变式题`)}>来道变式</button><button onClick={() => setChat(`学习“${currentTitle}”前需要补什么基础？`)}>探索前置知识</button></div><div className="ask-input"><textarea value={chat} disabled={asking} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask() } }} placeholder="针对当前节点追问；必要时会自动扩展左侧拓扑…" /><button onClick={() => void ask()} disabled={!chat.trim() || asking}>{asking ? <RefreshCw className="spin-icon" size={16} /> : <Send size={17} />}</button></div><small>AI 会判断问题是否值得成为新的知识节点</small></div>
      </aside>
    </div>
  </div>
}

function GitBranchIcon() { return <Network size={14} /> }

function Review({ courses, notify }: { courses: Course[]; notify: (message: string) => void }) {
  const { course, section } = useSection(courses)
  const [tab, setTab] = useState<'quiz' | 'sheet'>('quiz')
  const [generated, setGenerated] = useState(false)
  if (!course || !section) return <NotFound />
  const analysis = section.analysis
  const recommendedConcepts = analysis?.key_concepts.slice(0, 3).map(formatConceptLabel) || ['卡诺图边界相邻', '最小项表达', '竞争与冒险']
  return <div className="page"><div className="back-row"><Link to={`/courses/${course.id}/sections/${section.id}`}><ArrowLeft size={16} />{section.title}</Link></div><PageHeader title="复习工坊" subtitle="把薄弱点、错题和必会知识组合成一次高效复习。" actions={<button className="button primary" onClick={() => { setGenerated(true); notify(tab === 'quiz' ? '已根据本小节材料生成复习题' : 'Cheatsheet 已生成') }}><Sparkles size={17} />立即生成</button>} /><SectionSubnav courseId={course.id} sectionId={section.id} />
    <div className="review-layout"><section className="panel builder-panel"><div className="mode-switch"><button onClick={() => { setTab('quiz'); setGenerated(false) }} className={tab === 'quiz' ? 'active' : ''}><ListChecks size={18} />复习题单</button><button onClick={() => { setTab('sheet'); setGenerated(false) }} className={tab === 'sheet' ? 'active' : ''}><FileText size={18} />一页 Cheatsheet</button></div><div className="builder-copy"><span className="pill amber"><Sparkles size={13} />{analysis ? '根据本小节材料推荐' : '根据你的学习记录推荐'}</span><h2>{tab === 'quiz' ? '生成一次 20 分钟的针对性练习' : '生成一页纸核心知识总结'}</h2><p>{analysis ? trimText(analysis.summary, 220) : (tab === 'quiz' ? '系统会提高薄弱知识点与历史错题的出现权重。' : '浓缩核心定义、公式、知识联系与易错点，并保留来源引用。')}</p></div><div className="form-grid"><label>知识范围<select><option>{analysis?.title || '当前小节'}</option><option>整门课程</option><option>仅薄弱知识点</option></select></label><label>{tab === 'quiz' ? '复习时长' : '内容密度'}<select><option>{tab === 'quiz' ? `材料题 · ${analysis?.review_questions.length || 12} 题` : '标准 · 一页 A4'}</option><option>{tab === 'quiz' ? '10 分钟 · 精简模式' : '精简 · 只保留必会项'}</option></select></label><label>难度<select><option>自适应</option><option>基础巩固</option><option>考试挑战</option></select></label><label>内容侧重<select><option>薄弱点优先</option><option>平均覆盖</option><option>错题优先</option></select></label></div><div className="recommend-row"><span><Target size={16} />将重点覆盖</span>{recommendedConcepts.map((concept, index) => <button key={`${concept}-${index}`}>{concept}</button>)}</div></section>
      <aside className={`panel artifact-preview ${generated ? 'generated' : ''}`}>{generated ? tab === 'quiz' ? <QuizPreview questions={analysis?.review_questions} title={analysis?.title} /> : <SheetPreview analysis={analysis} materialCount={section.materials.length} /> : <><span className="artifact-icon">{tab === 'quiz' ? <ListChecks size={30} /> : <FileText size={30} />}</span><h3>生成内容将在这里预览</h3><p>{analysis ? '内容将直接使用本小节已构建的分析结果。' : '上传材料并完成构建后，可根据知识路径继续生成复习内容。'}</p></>}</aside></div>
  </div>
}

function QuizPreview({ questions, title }: { questions?: string[]; title?: string }) { const items = questions?.length ? questions : ['一个四变量卡诺图中，位于四个角的最小项能否合并？']; return <div className="quiz-preview"><div className="preview-head"><span>已生成 · 来自课程材料</span><strong>{title || '期中针对性复习'}</strong><small>{items.length} 题 · AI 分析结果已保存</small></div>{items.slice(0, 3).map((question, index) => <div className="preview-question generated-question" key={`${question}-${index}`}><span>{String(index + 1).padStart(2, '0')} · 开放题</span><Markdown>{normalizeMarkdown(question)}</Markdown></div>)}<button className="button dark full">开始答题 <ArrowRight size={16} /></button></div> }

function SheetPreview({ analysis, materialCount }: { analysis?: CourseAnalysis; materialCount: number }) { return <div className="sheet-preview"><div className="preview-head"><span>CHEATSHEET · 已保存分析</span><strong>{analysis?.title || '逻辑函数化简'}</strong><small>基于 {materialCount} 份课程材料</small></div><h4>01 · 内容摘要</h4><Markdown>{analysis ? normalizeMarkdown(trimText(analysis.summary, 480)) : '相邻最小项只有一个变量取值不同，合并后可消去该变量。'}</Markdown><h4>02 · 核心概念</h4><div className="analysis-concepts">{(analysis?.key_concepts.map(formatConceptLabel) || ['相邻项', '格雷码', '函数化简']).map((concept, index) => <span key={`${concept}-${index}`}>{concept}</span>)}</div><h4>03 · 学习路径</h4><p>{(analysis?.learning_path.map((step) => formatLearningStep(step).title) || ['理解概念', '跟随例题', '完成检验']).join(' → ')}</p></div> }

function Progress({ courses }: { courses: Course[] }) {
  const { course, section } = useSection(courses)
  const mastery = loadMastery(section?.id || '', section?.mastery ?? 0)
  if (!course || !section) return <NotFound />
  const analysis = section.analysis
  const bars = [42, 48, 45, 54, 61, 68, mastery]
  const progressNodes = analysis?.learning_path.length ? analysis.learning_path.map((step, index) => ({ id: `analysis-${index}`, title: formatLearningStep(step).title, mastery: index === 0 ? mastery : Math.max(0, mastery - index * 12) })) : knowledgeNodes
  const weakConcepts = analysis?.key_concepts.slice(0, 2).map(formatConceptLabel) || ['卡诺图边界相邻', '最小项标准形式']
  return <div className="page"><div className="back-row"><Link to={`/courses/${course.id}/sections/${section.id}`}><ArrowLeft size={16} />{section.title}</Link></div><PageHeader title="我的学习" subtitle="看见每一次真正理解，也看见下一步该往哪里走。" /><SectionSubnav courseId={course.id} sectionId={section.id} /><section className="progress-hero"><div><span className="eyebrow">OVERALL MASTERY</span><strong>{mastery}%</strong><p>本小节掌握度 · 最近 7 天提升 15%</p></div><div className="trend-chart">{bars.map((bar, index) => <span key={index} style={{ height: `${bar}%` }}><i>{index === bars.length - 1 ? `${bar}%` : ''}</i></span>)}</div><div className="streak"><span><Zap size={18} /></span><strong>7 天</strong><small>连续学习</small></div></section><div className="progress-grid"><section className="panel"><div className="section-heading compact"><div><h2>{analysis ? '材料学习路径' : '知识点掌握'}</h2><p>{analysis ? '来自本小节已保存的 AI 分析' : '按优先级排序'}</p></div></div><div className="mastery-list">{progressNodes.map((node) => <div key={node.id}><span>{node.title}<small>{node.mastery >= 75 ? '已掌握' : node.mastery > 0 ? '继续巩固' : '待学习'}</small></span><div><i style={{ width: `${node.mastery}%` }} /></div><strong>{node.mastery}%</strong></div>)}</div></section><section className="panel weakness-panel"><div className="section-heading compact"><div><h2>优先补强</h2><p>{analysis ? '来自材料关键概念' : '来自错题与探索记录'}</p></div></div>{weakConcepts.map((concept, index) => <div className="weak-item" key={`${concept}-${index}`}><span className={`priority ${index === 0 ? 'high' : 'mid'}`}>{index === 0 ? '高' : '中'}</span><div><strong>{concept}</strong><p>{analysis ? '建议在课堂重放中结合原文查看' : '来自历史学习记录'}</p></div><Link to={`/courses/${course.id}/sections/${section.id}/replay`}>去复习</Link></div>)}<div className="branch-summary"><Network size={18} /><div><strong>{analysis?.learning_path.length || 3} 个学习阶段</strong><p>学习内容已和本小节材料关联。</p></div></div></section></div></div>
}

function SettingsPage({ notify }: { notify: (message: string) => void }) {
  const [checking, setChecking] = useState(false)
  const [health, setHealth] = useState<{ configured: boolean; base_url: string; model: string | null; office_conversion: boolean } | null>(null)

  const checkServer = async (showNotice = true) => {
    setChecking(true)
    try {
      const response = await fetch('/api/health')
      if (!response.ok) throw new Error('API 服务不可用')
      const payload = await response.json()
      setHealth(payload)
      if (showNotice) notify(payload.configured ? 'CheapRouter 服务端配置已就绪' : '后端在线，但还需要填写 .env')
    } catch {
      setHealth(null)
      if (showNotice) notify('无法连接后端，请先运行 npm run dev:api')
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => { void checkServer(false) }, [])

  return <div className="page settings-page"><PageHeader title="AI 与偏好设置" subtitle="模型配置仅保存在服务端；浏览器不会读取或显示完整密钥。" /><div className="settings-grid"><section className="panel settings-section"><div className="settings-head"><span className="settings-icon"><Bot size={20} /></span><div><h2>CheapRouter · OpenAI-compatible</h2><p>直接读取整页图片，不经过 OCR</p></div><span className={`status ${health?.configured ? 'ready' : 'failed'}`}><span className="online-dot" />{health?.configured ? '已配置' : health ? '待配置' : '后端离线'}</span></div><label>Base URL<input value={health?.base_url || 'https://cdn.cheaprouter.cc/v1'} readOnly /></label><div className="field-row"><label>Chat Model<input value={health?.model || ''} readOnly placeholder="在 .env 填写 OPENAI_CHAT_MODEL" /></label><label>Office 文件转换<input value={health?.office_conversion ? 'Microsoft Office / LibreOffice 已就绪' : '未检测到 Office 转换器'} readOnly /></label></div><label>API Key<div className="secret-field"><input value={health?.configured ? '••••••••••••••••••••••••' : ''} readOnly placeholder="在 .env 填写 CHEAPROUTER_API_KEY" /><span>仅服务端可见</span></div></label><div className="settings-actions"><button className="button secondary" disabled={checking} onClick={() => void checkServer()}>{checking ? <RefreshCw className="spin-icon" size={16} /> : <CheckCircle2 size={16} />}{checking ? '检查中' : '检查服务端配置'}</button></div></section><aside className="panel privacy-card"><span><Zap size={20} /></span><h3>整页视觉模式</h3><p>图片直接发送；PDF 渲染为逐页图片；PPTX/DOCX 先转 PDF，再把每一页作为高细节图片交给模型。</p><div><Check size={15} />不执行 OCR</div><div><Check size={15} />密钥不会进入浏览器</div><div><Check size={15} />模型名称由你在 .env 指定</div></aside></div></div>
}

function NotFound() { return <div className="not-found"><BrainCircuit size={40} /><h1>这个学习节点还不存在</h1><p>先回到课程空间选择一门课程吧。</p><Link className="button primary" to="/">返回首页</Link></div> }

export default App
