import { Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
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
  MessageSquareText,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Course, CourseAnalysis, KnowledgeNode, KnowledgeTier, TIER_META, deriveKnowledgeMap, knowledgeNodes, loadCourses, loadMastery, saveCourses } from './data'

const MARKDOWN_PLUGINS = { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }
const TIER_ORDER: KnowledgeTier[] = ['prereq', 'core', 'advanced']

function Markdown({ children }: { children: string }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS.remarkPlugins} rehypePlugins={MARKDOWN_PLUGINS.rehypePlugins}>{children}</ReactMarkdown></div>
}

type Notice = { id: number; message: string }
type ResumeTarget = { courseId: string; destination: 'replay' }

const LAST_STUDY_KEY = 'course-replay-last-study'
const DISMISSED_STUDY_KEY = 'course-replay-dismissed-study'
const LEGACY_DISMISSED_KEY = 'course-replay-resume-card-dismissed'

function loadResumeTarget(courses: Course[]): ResumeTarget | null {
  try {
    const stored = localStorage.getItem(LAST_STUDY_KEY)
    const target: ResumeTarget = stored ? JSON.parse(stored) : { courseId: courses.find((course) => course.id === 'programming-linux')?.id || courses[0]?.id || '', destination: 'replay' }
    if (!courses.some((course) => course.id === target.courseId)) return null
    if (localStorage.getItem(DISMISSED_STUDY_KEY) === `${target.courseId}:${target.destination}`) return null
    if (!stored && localStorage.getItem(LEGACY_DISMISSED_KEY) === 'true') return null
    return { courseId: target.courseId, destination: 'replay' }
  } catch {
    return null
  }
}

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

function formatConceptLabel(value: string) {
  const clean = value.replace(/^\s*(?:\d+[.、)）:]|[-*•])\s*/, '').trim()
  return trimText(clean.split(/[：:。；;]/)[0] || clean, 18)
}

function courseSubtitle(course: Course) {
  const description = course.description.trim()
  const analysisWasCopiedIntoDescription = Boolean(course.analysis && description === course.analysis.summary.trim())
  if (analysisWasCopiedIntoDescription || description.length > 180) {
    const readyCount = course.materials.filter((material) => material.status === 'ready').length
    return `已整理 ${readyCount} 份课程材料 · ${course.analysis?.learning_path.length || 0} 个学习阶段 · 随时开始重放`
  }
  return description
}

function App() {
  const [courses, setCourses] = useState<Course[]>(loadCourses)
  const [notices, setNotices] = useState<Notice[]>([])
  const location = useLocation()

  useEffect(() => saveCourses(courses), [courses])

  useEffect(() => {
    const match = location.pathname.match(/^\/courses\/([^/]+)(?:\/(replay))?\/?$/)
    if (!match) return
    let courseId: string
    try {
      courseId = decodeURIComponent(match[1])
    } catch {
      return
    }
    const target: ResumeTarget = { courseId, destination: 'replay' }
    try {
      localStorage.setItem(LAST_STUDY_KEY, JSON.stringify(target))
      localStorage.removeItem(DISMISSED_STUDY_KEY)
      localStorage.removeItem(LEGACY_DISMISSED_KEY)
    } catch {
      return
    }
  }, [location.pathname])

  const notify = (message: string) => {
    const id = Date.now()
    setNotices((items) => [...items, { id, message }])
    window.setTimeout(() => setNotices((items) => items.filter((item) => item.id !== id)), 2600)
  }

  return (
    <div className="app-shell">
      <Sidebar courses={courses} />
      <main className="main-shell">
        <Routes>
          <Route path="/" element={<Dashboard courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId" element={<CourseDetail courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId/replay" element={<Replay courses={courses} setCourses={setCourses} notify={notify} />} />
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

function Sidebar({ courses }: { courses: Course[] }) {
  const location = useLocation()
  const courseMatch = location.pathname.match(/\/courses\/([^/]+)/)
  const courseId = courseMatch?.[1] || loadResumeTarget(courses)?.courseId || courses[0]?.id || ''
  return (
    <aside className="sidebar">
      <Link className="brand" to="/" aria-label="Course Replay 首页">
        <span className="brand-mark"><span /></span>
        <span><strong>COURSE</strong><em>REPLAY</em></span>
      </Link>
      <nav className="nav-main">
        <NavItem to="/" end icon={<LayoutDashboard size={18} />} label="课程空间" />
        <NavItem to={`/courses/${courseId}/replay`} icon={<BrainCircuit size={18} />} label="课堂重放" />
      </nav>
      <div className="sidebar-bottom">
        <NavItem to="/settings" icon={<Settings size={18} />} label="AI 与偏好设置" />
        <div className="profile">
          <div className="avatar">CY</div>
          <div><strong>学习者</strong><span>连续学习 7 天</span></div>
          <button type="button" className="icon-button tiny more-button" aria-label="更多选项"><MoreHorizontal size={17} /></button>
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
  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(() => loadResumeTarget(courses))
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [openCourseMenuId, setOpenCourseMenuId] = useState<string | null>(null)
  const navigate = useNavigate()
  const resumeCourse = resumeTarget ? courses.find((course) => course.id === resumeTarget.courseId) : null
  const avg = Math.round(courses.reduce((sum, item) => sum + item.mastery, 0) / Math.max(courses.length, 1))
  const openCreateModal = () => setShowCreate(true)
  const dismissResume = () => {
    setResumeTarget(null)
    try {
      if (resumeTarget) localStorage.setItem(DISMISSED_STUDY_KEY, `${resumeTarget.courseId}:${resumeTarget.destination}`)
    } catch {
      notify('已关闭继续学习卡片，但浏览器无法保存此设置，刷新后可能会恢复。')
    }
  }
  return (
    <div className="page dashboard-page">
      <PageHeader
        title="下午好，准备继续吗？"
        subtitle="把散落的课件和笔记，重新串成一条能真正掌握的学习路径。"
        actions={<><button className="icon-button" aria-label="搜索"><Search size={19} /></button><button className="button primary" onClick={() => openCreateModal()}><Plus size={18} />创建课程</button></>}
      />

      <section className="hero-card">
        {resumeCourse && resumeTarget ? <>
          <div className="hero-copy">
            <span className="pill lime"><Zap size={13} />继续上次学习</span>
            <h2>{resumeCourse.analysis?.title || resumeCourse.title}</h2>
            <p>{resumeCourse.title} · 继续学习</p>
            <div className="hero-progress-row"><span>课程进度</span><strong>3 / 5</strong></div>
            <div className="hero-progress"><span style={{ width: '58%' }} /></div>
            <div className="hero-actions">
              <Link className="button light" to={`/courses/${resumeCourse.id}/${resumeTarget.destination}`}>继续课堂重放 <ArrowRight size={17} /></Link>
              <button className="button ghost hero-dismiss" onClick={dismissResume}><X size={16} />取消</button>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="hero-node main-node"><BrainCircuit size={29} /><span>化简</span></div>
            <div className="hero-node node-a">A · B</div>
            <div className="hero-node node-b">A + B</div>
            <div className="hero-node node-c">K-map</div>
            <span className="connector connector-a" /><span className="connector connector-b" /><span className="connector connector-c" />
          </div>
        </> : <>
          <div className="hero-copy hero-create-copy">
            <span className="pill lime"><UploadCloud size={13} />开启新的学习</span>
            <h2>创建课程并上传资料</h2>
            <p>导入课件和笔记，为课程搭建专属学习路径。</p>
            <button className="button light" onClick={openCreateModal}>创建课程并上传资料 <ArrowRight size={17} /></button>
          </div>
          <div className="hero-visual hero-upload-visual" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="upload-center"><UploadCloud size={30} /><span>上传资料</span></div>
            <div className="upload-file upload-file-a"><FileText size={15} />课堂课件</div>
            <div className="upload-file upload-file-b"><FileText size={15} />学习笔记</div>
          </div>
        </>}
      </section>

      <section className="metric-grid">
        <Metric icon={<Library size={18} />} label="进行中的课程" value={String(courses.length)} delta="本学期" />
        <Metric icon={<Gauge size={18} />} label="平均掌握度" value={`${avg}%`} delta="较上周 +6%" positive />
        <Metric icon={<Clock3 size={18} />} label="本周学习" value="4h 28m" delta="目标 6 小时" />
        <Metric icon={<Target size={18} />} label="待攻克知识点" value="7" delta="其中 3 个高优先级" />
      </section>

      <section className="section-block">
        <div className="section-heading"><div><h2>我的课程</h2><p>每门课都有独立的材料库与知识路径</p></div><button className="text-button">查看全部 <ArrowRight size={15} /></button></div>
        <div className="course-grid">
          {courses.map((course) => <CourseCard
            key={course.id}
            course={course}
            menuOpen={openCourseMenuId === course.id}
            onToggleMenu={() => setOpenCourseMenuId(openCourseMenuId === course.id ? null : course.id)}
            onEdit={() => { setOpenCourseMenuId(null); setEditingCourse(course) }}
            onDelete={() => { setOpenCourseMenuId(null); setDeletingCourse(course) }}
          />)}
          <button className="new-course-card" onClick={() => openCreateModal()}><span><Plus size={22} /></span><strong>创建新课程</strong><small>导入课件，开始构建知识路径</small></button>
        </div>
      </section>

      {showCreate && <CreateCourseModal onClose={() => setShowCreate(false)} onCreate={(course) => { setCourses([...courses, course]); setShowCreate(false); navigate(`/courses/${course.id}`); notify('课程已创建，可以导入材料了') }} />}
      {editingCourse && <EditCourseModal
        course={editingCourse}
        onClose={() => setEditingCourse(null)}
        onSave={(title, description) => {
          setCourses(courses.map((course) => course.id === editingCourse.id ? { ...course, title, description, updated: '刚刚' } : course))
          setEditingCourse(null)
          notify('课程信息已更新')
        }}
      />}
      {deletingCourse && <DeleteCourseModal
        course={deletingCourse}
        onClose={() => setDeletingCourse(null)}
        onConfirm={() => {
          setCourses(courses.filter((course) => course.id !== deletingCourse.id))
          setDeletingCourse(null)
          notify('课程已删除')
        }}
      />}
    </div>
  )
}

function Metric({ icon, label, value, delta, positive }: { icon: ReactNode; label: string; value: string; delta: string; positive?: boolean }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : ''}>{delta}</small></div></div>
}

function CourseCard({ course, menuOpen, onToggleMenu, onEdit, onDelete }: {
  course: Course
  menuOpen: boolean
  onToggleMenu: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const displayedMastery = ['digital-circuits', 'programming-linux'].includes(course.id) ? loadMastery() : course.mastery
  return (
    <article className="course-card">
      <div className="course-card-top">
        <span className="course-swatch" style={{ background: course.accent }} />
        <div className="course-card-actions">
          <button
            type="button"
            className="icon-button tiny more-button"
            aria-label={`管理课程：${course.title}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={onToggleMenu}
          ><MoreHorizontal size={16} /></button>
          {menuOpen && <div className="course-action-menu" role="menu">
            <button type="button" role="menuitem" onClick={onEdit}><Pencil size={14} />编辑课程</button>
            <button type="button" role="menuitem" className="delete-action" onClick={onDelete}><Trash2 size={14} />删除课程</button>
          </div>}
        </div>
      </div>
      <Link to={`/courses/${course.id}`} className="course-card-content">
        <div className="course-code">{course.code}</div><h3>{course.title}</h3><p>{courseSubtitle(course)}</p>
        <div className="tag-row">{course.tags.map((tag, index) => <span key={`${tag}-${index}`} title={tag}>{formatConceptLabel(tag)}</span>)}</div>
        <div className="card-divider" />
        <div className="course-footer"><div><span>{course.materials.length} 份材料</span><small>最近学习 {course.updated}</small></div><div className="ring" style={{ '--value': `${displayedMastery * 3.6}deg`, '--accent': course.accent } as React.CSSProperties}><span>{displayedMastery}%</span></div></div>
      </Link>
    </article>
  )
}

function CreateCourseModal({ onClose, onCreate }: { onClose: () => void; onCreate: (course: Course) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    const id = `${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
    onCreate({ id, title: title.trim(), description: description.trim() || '一门新的课程，等待导入学习材料。', code: 'NEW · 2026 秋', tags: ['新课程'], mastery: 0, materials: [], updated: '刚刚', accent: '#c7f45d' })
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">NEW COURSE</span><h2>创建一门课程</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>课程名称<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：数字信号处理" /></label><label>课程简介<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="这门课主要学习什么？" /></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()}>创建并导入材料 <ArrowRight size={16} /></button></div></form></div>
}

function EditCourseModal({ course, onClose, onSave }: {
  course: Course
  onClose: () => void
  onSave: (title: string, description: string) => void
}) {
  const [title, setTitle] = useState(course.title)
  const [description, setDescription] = useState(course.description)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    onSave(title.trim(), description.trim())
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">EDIT COURSE</span><h2>编辑课程</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
      <label>课程名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入课程名称" /></label>
      <label>课程介绍<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="输入课程介绍" /></label>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()}>保存修改</button></div>
    </form>
  </div>
}

function DeleteCourseModal({ course, onClose, onConfirm }: {
  course: Course
  onClose: () => void
  onConfirm: () => void
}) {
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-course-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">DELETE COURSE</span><h2 id="delete-course-title">删除课程？</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
      <p className="delete-course-message">确定删除“{course.title}”吗？此操作会从本地课程列表中移除该课程。</p>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button type="button" className="button danger" onClick={onConfirm}>删除课程</button></div>
    </div>
  </div>
}

function useCourse(courses: Course[]) {
  const { courseId = '' } = useParams()
  return courses.find((course) => course.id === courseId) || courses[0]
}

function CourseSubnav({ course }: { course: Course }) {
  return <div className="course-subnav"><NavLink end to={`/courses/${course.id}`}>材料库</NavLink><NavLink to={`/courses/${course.id}/replay`}>课堂重放</NavLink></div>
}

function CourseDetail({ courses, setCourses, notify }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; notify: (message: string) => void }) {
  const course = useCourse(courses)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadControllerRef = useRef<AbortController | null>(null)
  const uploadMaterialIdsRef = useRef<string[]>([])
  const recoveryAttemptedRef = useRef('')
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('正在上传课堂材料')
  const [apiError, setApiError] = useState('')
  const [openMaterialMenu, setOpenMaterialMenu] = useState<string | null>(null)
  const [analysisExpanded, setAnalysisExpanded] = useState(false)
  const courseId = course?.id
  const processingJob = course?.processingJob
  const orphanMaterials = course?.materials.filter((material) => material.status === 'processing') || []
  const orphanSignature = orphanMaterials.map((material) => material.id).join('|')

  useEffect(() => {
    if (!courseId || uploading || processingJob || !orphanMaterials.length) return
    const signature = `${courseId}:${orphanSignature}`
    if (recoveryAttemptedRef.current === signature) return
    recoveryAttemptedRef.current = signature
    let active = true

    const recover = async () => {
      try {
        const response = await fetch('/api/process')
        if (!response.ok) throw new Error('无法读取后台任务')
        const jobs = await response.json() as { job_id: string; status: string; stage: string; progress: number; message: string; filenames: string[] }[]
        if (!active) return
        const names = new Set(orphanMaterials.map((material) => material.name))
        const match = jobs.find((job) => ['queued', 'running'].includes(job.status) && job.filenames.some((name) => names.has(name)))
        if (match) {
          const materialIds = orphanMaterials.filter((material) => match.filenames.includes(material.name)).map((material) => material.id)
          setCourses((current) => current.map((item) => item.id === courseId && !item.processingJob ? {
            ...item,
            processingJob: { jobId: match.job_id, materialIds, progress: match.progress, stage: match.stage, message: match.message },
          } : item))
          return
        }
        const orphanIds = new Set(orphanMaterials.map((material) => material.id))
        setCourses((current) => current.map((item) => item.id === courseId && !item.processingJob ? {
          ...item,
          materials: item.materials.map((material) => orphanIds.has(material.id) ? { ...material, status: 'failed' as const, error: '处理任务已中断，请重新上传' } : material),
        } : item))
      } catch {
        recoveryAttemptedRef.current = ''
      }
    }

    void recover()
    return () => { active = false }
  }, [courseId, orphanSignature, processingJob, setCourses, uploading])

  useEffect(() => {
    if (!courseId || !processingJob?.jobId) return
    let active = true
    const controller = new AbortController()
    const jobId = processingJob.jobId
    const materialIds = processingJob.materialIds

    const failJob = (message: string) => {
      if (!active) return
      setApiError(message)
      setCourses((current) => current.map((item) => item.id === courseId && item.processingJob?.jobId === jobId ? {
        ...item,
        processingJob: undefined,
        materials: item.materials.map((material) => materialIds.includes(material.id) ? { ...material, status: 'failed' as const, error: message } : material),
      } : item))
    }

    const poll = async () => {
      while (active) {
        try {
          const response = await fetch(`/api/process/${jobId}`, { signal: controller.signal })
          const job = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(job.detail || `读取任务状态失败（HTTP ${response.status}）`)
          if (!active) return

          setCourses((current) => current.map((item) => item.id === courseId && item.processingJob?.jobId === jobId ? {
            ...item,
            processingJob: { ...item.processingJob!, progress: job.progress || 0, stage: job.stage || 'queued', message: job.message || '正在处理材料' },
            materials: item.materials.map((material) => materialIds.includes(material.id) ? { ...material, progress: job.progress || 0 } : material),
          } : item))

          if (job.status === 'completed' && job.result) {
            const payload = job.result as {
              analysis: CourseAnalysis
              model: string
              documents: { filename: string; pages: number; processing: string; preview_url: string }[]
            }
            setCourses((current) => current.map((item) => item.id === courseId && item.processingJob?.jobId === jobId ? {
              ...item,
              processingJob: undefined,
              analysis: payload.analysis,
              knowledgeMap: deriveKnowledgeMap(payload.analysis),
              analysisJobId: jobId,
              tags: payload.analysis.key_concepts.slice(0, 3).map(formatConceptLabel),
              materials: item.materials.map((material) => {
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
            } : item))
            setApiError('')
            notify(`材料处理完成，已由 ${payload.model} 生成学习路径`)
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
  }, [courseId, processingJob?.jobId, setCourses])

  if (!course) return <NotFound />

  const processing = uploading || Boolean(processingJob)
  const progress = processingJob?.progress ?? (uploading ? 5 : 0)
  const stageKey = processingJob?.stage ?? 'uploading'
  const processingStage = processingJob?.message ?? uploadMessage

  const cancelProcessing = async () => {
    if (!processing) return
    uploadControllerRef.current?.abort()
    const job = course.processingJob
    if (job?.jobId) void fetch(`/api/process/${job.jobId}`, { method: 'DELETE' }).catch(() => undefined)
    const ids = new Set(job?.materialIds || uploadMaterialIdsRef.current)
    setCourses((current) => current.map((item) => item.id === course.id ? {
      ...item,
      processingJob: undefined,
      materials: item.materials.map((material) => ids.has(material.id) ? { ...material, status: 'cancelled' as const, error: '已由你取消' } : material),
    } : item))
    setUploading(false)
    setApiError('')
    notify('处理已取消，可以重新选择文件')
  }

  const deleteMaterial = (materialId: string) => {
    const job = course.processingJob
    const cancelsJob = Boolean(job?.materialIds.includes(materialId))
    if (cancelsJob && job) void fetch(`/api/process/${job.jobId}`, { method: 'DELETE' }).catch(() => undefined)
    setCourses((current) => current.map((item) => {
      if (item.id !== course.id) return item
      const activeIds = new Set(item.processingJob?.materialIds || [])
      return {
        ...item,
        processingJob: cancelsJob ? undefined : item.processingJob,
        materials: item.materials
          .filter((material) => material.id !== materialId)
          .map((material) => cancelsJob && activeIds.has(material.id) ? { ...material, status: 'cancelled' as const, error: '同批任务已取消' } : material),
      }
    }))
    setOpenMaterialMenu(null)
    notify(cancelsJob ? '材料已删除，同批处理任务已取消' : '材料已删除')
  }

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || processing) return
    const selectedFiles = Array.from(files)
    const additions = selectedFiles.map((file, index) => ({ id: `upload-${Date.now()}-${index}`, name: file.name, meta: `${Math.max(1, Math.round(file.size / 1024))} KB`, type: file.name.split('.').pop()?.toUpperCase() || 'FILE', status: 'processing' as const, progress: 0 }))
    const materialIds = additions.map((item) => item.id)
    uploadMaterialIdsRef.current = materialIds
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, materials: [...item.materials, ...additions], updated: '刚刚' } : item))
    setApiError('')
    setUploading(true)
    setUploadMessage(`正在上传 ${selectedFiles.length} 份材料`)

    const formData = new FormData()
    selectedFiles.forEach((file) => formData.append('files', file))
    try {
      const response = await fetch('/api/process/start', { method: 'POST', body: formData, signal: controller.signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || `上传失败（HTTP ${response.status}）`)
      setCourses((current) => current.map((item) => item.id === course.id ? {
        ...item,
        processingJob: { jobId: payload.job_id, materialIds, progress: 8, stage: 'queued', message: '文件已上传，等待处理' },
      } : item))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : '材料上传失败'
      setApiError(message)
      setCourses((current) => current.map((item) => item.id === course.id ? {
        ...item,
        materials: item.materials.map((material) => materialIds.includes(material.id) ? { ...material, status: 'failed' as const, error: message } : material),
      } : item))
    } finally {
      setUploading(false)
      uploadControllerRef.current = null
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const stages = [
    ['uploading', '上传文件'],
    ['rendering', '准备完整页面'],
    ['model', 'AI 视觉分析'],
    ['finalizing', '保存课程结果'],
  ]
  const activeStageIndex = stageKey === 'queued' ? 0 : stageKey === 'completed' ? stages.length : stages.findIndex(([key]) => key === stageKey)
  const analysis = course.analysis
  const learningSteps = analysis?.learning_path.map(formatLearningStep) || []
  const conceptLabels = analysis?.key_concepts.map(formatConceptLabel) || []
  const nextStep = learningSteps[0]?.title || '先导入课堂材料'

  return <div className="page">
    <div className="back-row"><Link to="/"><ArrowLeft size={16} />全部课程</Link><span>/</span><span>{course.title}</span></div>
    <PageHeader title={course.title} subtitle={courseSubtitle(course)} actions={<Link className="button primary" to={`/courses/${course.id}/replay`}><BrainCircuit size={17} />开始课堂重放</Link>} />
    <CourseSubnav course={course} />
    <div className="overview-strip"><div><span>材料</span><strong>{course.materials.length}</strong><small>份课堂资料</small></div><div><span>知识点</span><strong>{analysis?.key_concepts.length || 0}</strong><small>{analysis ? '来自本次分析' : '等待材料分析'}</small></div><div><span>整体掌握</span><strong>{course.mastery}%</strong><small className="positive">持续更新</small></div><div className="overview-action"><span>下一步</span><strong title={analysis?.learning_path[0]}>{nextStep}</strong><small>{analysis ? '进入课堂重放' : '支持多文件上传'}</small></div></div>
    <div className="materials-layout">
      <section className="panel material-panel">
        <div className="section-heading"><div><h2>课堂材料</h2><p>支持 PDF、PPTX、DOCX、Markdown、TXT 与图片</p></div><button className="button secondary" disabled={processing} onClick={() => inputRef.current?.click()}><UploadCloud size={17} />导入材料</button></div>
        <input ref={inputRef} type="file" multiple hidden accept=".pdf,.ppt,.pptx,.doc,.docx,.odt,.odp,.md,.txt,.png,.jpg,.jpeg,.webp" onChange={(event) => addFiles(event.target.files)} />
        <button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}><span><UploadCloud size={23} /></span><strong>拖入课件、笔记或板书照片</strong><small>或点击选择文件 · 单次可上传多份材料</small></button>
        {processing && <div className="processing-card"><div className="processing-top"><div className="spinner" /><div><strong>{processingStage}</strong><span>整页视觉输入 · 不使用 OCR · 可以随时取消</span></div><b>{Math.min(progress, 100)}%</b></div><div className="thin-progress"><span style={{ width: `${Math.min(progress, 100)}%` }} /></div><div className="processing-stages">{stages.map(([key, label], index) => <span key={key} className={index < activeStageIndex ? 'done' : index === activeStageIndex ? 'active' : ''}>{index < activeStageIndex ? <Check size={12} /> : index + 1}{label}</span>)}</div><button className="button danger compact" onClick={() => void cancelProcessing()}><X size={15} />取消处理</button></div>}
        {apiError && <div className="api-error"><CircleHelp size={18} /><div><strong>材料处理失败</strong><p>{apiError}</p></div></div>}
        {analysis && <article className="analysis-result">
          <div className="analysis-result-head"><span><Sparkles size={16} /></span><div><small>AI STUDY BRIEF · 已自动保存</small><h3>{analysis.title}</h3></div><Link className="button primary compact analysis-action" to={`/courses/${course.id}/replay`}>按路线学习 <ArrowRight size={14} /></Link></div>
          <div className="analysis-study-grid">
            <section className="analysis-summary-block"><span className="analysis-label"><BookOpen size={14} />本课摘要</span><p className={analysisExpanded ? 'expanded' : ''}>{analysis.summary}</p>{analysis.summary.length > 180 && <button className="analysis-toggle" onClick={() => setAnalysisExpanded((value) => !value)}>{analysisExpanded ? '收起摘要' : '展开完整摘要'} <ChevronDown size={13} /></button>}</section>
            <section className="analysis-route-block"><span className="analysis-label"><Network size={14} />推荐学习路线</span><div className="analysis-path">{learningSteps.map((step, index) => <div key={`${step.title}-${index}`}><i>{index + 1}</i><span><strong>{step.title}</strong>{step.detail && <small>{step.detail}</small>}</span></div>)}</div></section>
          </div>
          {conceptLabels.length > 0 && <div className="analysis-concept-block"><span className="analysis-label"><Lightbulb size={14} />核心概念</span><div className="analysis-concepts">{conceptLabels.map((concept, index) => <span title={analysis.key_concepts[index]} key={`${concept}-${index}`}>{concept}</span>)}</div></div>}
        </article>}
        <div className="file-list">
          {course.materials.map((material) => <div className="file-row" key={material.id}>
            <span className={`file-type ${material.type.toLowerCase()}`}><FileText size={18} /></span>
            <div className="file-info"><strong>{material.name}</strong><span title={material.error}>{material.error || material.meta}</span></div>
            {material.previewUrl && <a className="file-preview-link" href={material.previewUrl} target="_blank" rel="noreferrer">查看文档</a>}
            <div className={`status ${material.status}`}>{material.status === 'ready' ? <><CheckCircle2 size={15} />已就绪</> : material.status === 'failed' ? <><X size={14} />失败</> : material.status === 'cancelled' ? <><X size={14} />已取消</> : <><RefreshCw size={14} />AI 处理中{material.progress ? ` · ${material.progress}%` : ''}</>}</div>
            <div className="material-menu-wrap">
              <button className="icon-button tiny" aria-label={`${material.name} 操作`} aria-expanded={openMaterialMenu === material.id} onClick={() => setOpenMaterialMenu((current) => current === material.id ? null : material.id)}><MoreHorizontal size={17} /></button>
              {openMaterialMenu === material.id && <div className="material-menu">
                {material.previewUrl && <a href={material.previewUrl} target="_blank" rel="noreferrer"><FileText size={14} />查看文档</a>}
                {material.status === 'processing' && <button onClick={() => void cancelProcessing()}><X size={14} />取消处理</button>}
                <button className="delete" onClick={() => deleteMaterial(material.id)}><Trash2 size={14} />删除材料</button>
              </div>}
            </div>
          </div>)}
        </div>
      </section>
      <aside className="right-stack">
        <section className="panel knowledge-preview"><div className="panel-kicker"><Network size={16} />知识路径</div><h3>{analysis ? `${learningSteps.length} 个学习阶段 · ${conceptLabels.length} 个概念` : '等待材料分析'}</h3><div className="mini-tree"><span className="tree-root">{analysis?.title || course.title}</span><i /><div>{(learningSteps.slice(0, 3).map((step) => step.title).length ? learningSteps.slice(0, 3).map((step) => step.title) : ['上传材料', 'AI 分析', '开始重放']).map((step, index) => <span title={analysis?.learning_path[index]} key={`${step}-${index}`} className={index === 0 && analysis ? 'active' : ''}>{step}</span>)}</div></div><Link to={`/courses/${course.id}/replay`} className="text-link">查看完整路径 <ArrowRight size={15} /></Link></section>
        <section className="panel provider-note"><div className="provider-top"><span className="online-dot" />CheapRouter 视觉处理</div><p>图片与文档页面直接交给视觉模型，不执行 OCR；API Key 只保存在服务端。</p><Link to="/settings">查看配置</Link></section>
      </aside>
    </div>
  </div>
}

function Replay({ courses, setCourses, notify }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; notify: (message: string) => void }) {
  const course = useCourse(courses)
  const replayPageRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const askInputRef = useRef<HTMLTextAreaElement>(null)
  const [selected, setSelected] = useState('')
  const [activeMaterialId, setActiveMaterialId] = useState('')
  const [chat, setChat] = useState('')
  const [aiMinimized, setAiMinimized] = useState(false)
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [chatQuote, setChatQuote] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [selectionAsk, setSelectionAsk] = useState<{ text: string; left: number; top: number } | null>(null)
  const kmNodes = useMemo<KnowledgeNode[]>(() => {
    if (course?.knowledgeMap?.length) return course.knowledgeMap
    if (course?.analysis?.learning_path.length) return deriveKnowledgeMap(course.analysis)
    return knowledgeNodes.map((node) => ({ id: node.id, title: node.title, tier: 'core' as KnowledgeTier, summary: node.eyebrow, content: `## ${node.title}\n\n上传并分析课程材料后，这里会生成结构化的学习内容。` }))
  }, [course?.analysis, course?.knowledgeMap])
  const orderedNodes = useMemo(() => TIER_ORDER.flatMap((tier) => kmNodes.filter((node) => node.tier === tier)), [kmNodes])
  const groupedNodes = useMemo(() => TIER_ORDER.map((tier) => ({ tier, nodes: kmNodes.filter((node) => node.tier === tier) })).filter((group) => group.nodes.length), [kmNodes])
  const explorationNodes = course?.explorationNodes || []
  const chatHistory = course?.chatHistory || []
  const studyDialogs = course?.studyDialogs || []
  const activeDialogId = course?.activeDialogId || 'main'
  const activeDialog = studyDialogs.find((dialog) => dialog.id === activeDialogId)
  const dialogMessages = chatHistory.filter((message) => (message.dialogId || 'main') === activeDialogId)
  const latestDialogMessageId = dialogMessages[dialogMessages.length - 1]?.id
  const isMainDialog = activeDialogId === 'main'
  const previewMaterials = useMemo(() => course?.materials.filter((material) => material.previewUrl) || [], [course?.materials])
  const activeMaterial = previewMaterials.find((material) => material.id === activeMaterialId) || previewMaterials[0]
  const activeIndex = orderedNodes.findIndex((node) => node.id === selected)
  const activeKnowledge = kmNodes.find((node) => node.id === selected)
  const activeExploration = explorationNodes.find((node) => node.id === selected)
  const explorationAnswer = activeExploration ? [...chatHistory].reverse().find((message) => message.role === 'assistant' && message.nodeId === activeExploration.id)?.content || '' : ''
  const activeContent = activeKnowledge ? activeKnowledge.content
    : activeExploration ? `## ${activeExploration.title}\n\n> ❓ ${activeExploration.question}\n\n${explorationAnswer || '_正在生成回答…_'}`
    : orderedNodes[0]?.content || '## 等待材料分析\n\n上传课件后将在这里生成结构化的学习内容。'
  const currentTitle = activeKnowledge?.title || activeExploration?.title || orderedNodes[Math.max(activeIndex, 0)]?.title || course?.analysis?.title || course?.title || '课程'
  const activeTier = activeKnowledge?.tier
  const tierLabel = activeKnowledge ? TIER_META[activeKnowledge.tier].label : activeExploration ? '探索支线' : '知识节点'
  const tierEyebrow = activeKnowledge ? TIER_META[activeKnowledge.tier].eyebrow : 'EXPLORATION'
  const progressPct = orderedNodes.length ? Math.max(8, ((Math.max(activeIndex, 0) + 1) / orderedNodes.length) * 100) : 8
  const sourceLesson = useMemo(() => {
    if (!course) return null
    let nodeIndex = orderedNodes.findIndex((node) => node.id === selected)
    if (nodeIndex < 0 && activeExploration) {
      let parentId = activeExploration.parentId
      for (let depth = 0; depth < 8 && nodeIndex < 0; depth += 1) {
        nodeIndex = orderedNodes.findIndex((node) => node.id === parentId)
        const parentBranch = explorationNodes.find((node) => node.id === parentId)
        if (!parentBranch) break
        parentId = parentBranch.parentId
      }
    }
    const safeIndex = Math.max(0, nodeIndex)
    const section = course.analysis?.sections?.[safeIndex]
    const totalPages = previewMaterials.reduce((total, material) => total + Math.max(1, material.pages || 1), 0)
    const distributedPage = totalPages > 0
      ? Math.floor((safeIndex / Math.max(1, orderedNodes.length)) * totalPages) + 1
      : 1
    let remainingPage = distributedPage
    let fallbackMaterial = previewMaterials[0]
    for (const material of previewMaterials) {
      const pages = Math.max(1, material.pages || 1)
      if (remainingPage <= pages) { fallbackMaterial = material; break }
      remainingPage -= pages
    }
    const exactMaterial = section?.source_filename
      ? previewMaterials.find((material) => material.name === section.source_filename)
        || previewMaterials.find((material) => material.name.includes(section.source_filename) || section.source_filename.includes(material.name))
      : undefined
    const sourceMaterial = exactMaterial || fallbackMaterial
    const sourcePage = Math.min(
      Math.max(1, exactMaterial ? section?.source_page || 1 : remainingPage),
      Math.max(1, sourceMaterial?.pages || 1),
    )
    return {
      materialId: sourceMaterial?.id,
      page: sourcePage,
      isExactSource: Boolean(exactMaterial && section),
    }
  }, [activeExploration, course, explorationNodes, orderedNodes, previewMaterials, selected])
  const activeSourcePage = activeMaterial?.id === sourceLesson?.materialId ? sourceLesson.page : 1
  const activeSourceUrl = activeMaterial?.previewUrl
    ? `${activeMaterial.previewUrl.split('#')[0]}#page=${activeSourcePage}&view=FitH`
    : undefined

  useEffect(() => {
    const isKnownNode = orderedNodes.some((node) => node.id === selected)
      || explorationNodes.some((node) => node.id === selected)
    if (orderedNodes.length > 0 && !isKnownNode) setSelected(orderedNodes[0].id)
  }, [explorationNodes, orderedNodes, selected])

  useEffect(() => {
    if (previewMaterials.length > 0 && !previewMaterials.some((material) => material.id === activeMaterialId)) setActiveMaterialId(previewMaterials[0].id)
  }, [previewMaterials, activeMaterialId])

  useEffect(() => {
    if (sourceLesson?.materialId) setActiveMaterialId(sourceLesson.materialId)
  }, [sourceLesson?.materialId, selected])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scroller = chatScrollRef.current
      if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeDialogId, aiMinimized, asking, latestDialogMessageId, explorationNodes.length])

  useEffect(() => {
    const dismissSelectionAsk = () => setSelectionAsk(null)
    window.addEventListener('resize', dismissSelectionAsk)
    window.addEventListener('scroll', dismissSelectionAsk, true)
    return () => {
      window.removeEventListener('resize', dismissSelectionAsk)
      window.removeEventListener('scroll', dismissSelectionAsk, true)
    }
  }, [])

  if (!course) return <NotFound />

  const createDialog = () => {
    const dialogId = `dialog-${Date.now()}`
    const dialogNumber = studyDialogs.length + 1
    setCourses((current) => current.map((item) => item.id === course.id ? {
      ...item,
      studyDialogs: [...(item.studyDialogs || []), { id: dialogId, title: `新对话 ${dialogNumber}`, createdAt: Date.now() }],
      activeDialogId: dialogId,
    } : item))
    setChat('')
    setChatQuote(null)
    notify('已开启独立对话')
  }

  const switchDialog = (dialogId: string) => {
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, activeDialogId: dialogId } : item))
    setChat('')
    setChatQuote(null)
  }

  const captureTextSelection = () => {
    requestAnimationFrame(() => {
      const selection = window.getSelection()
      const text = selection?.toString().replace(/\s+/g, ' ').trim() || ''
      if (!selection || selection.rangeCount === 0 || text.length < 2) {
        setSelectionAsk(null)
        return
      }
      const range = selection.getRangeAt(0)
      const ancestor = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement
      if (!ancestor || !replayPageRef.current?.contains(ancestor) || ancestor.closest('textarea, input, select, button')) {
        setSelectionAsk(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (!rect.width && !rect.height) return
      setSelectionAsk({
        text: text.slice(0, 1600),
        left: Math.min(window.innerWidth - 72, Math.max(72, rect.left + rect.width / 2)),
        top: Math.max(12, rect.top - 44),
      })
    })
  }

  const quoteSelectionInChat = () => {
    if (!selectionAsk) return
    setAiMinimized(false)
    setChatQuote(selectionAsk.text)
    setSelectionAsk(null)
    window.getSelection()?.removeAllRanges()
    requestAnimationFrame(() => {
      const input = askInputRef.current
      input?.focus()
      if (input) {
        const end = input.value.length
        input.setSelectionRange(end, end)
      }
    })
  }

  const ask = async () => {
    const prompt = chat.trim()
    const selectedQuote = chatQuote?.trim() || ''
    if ((!prompt && !selectedQuote) || asking) return
    const visibleQuestion = prompt || '请解释这段选中内容'
    const question = selectedQuote
      ? `请结合以下选中内容回答。\n\n选中内容：\n${selectedQuote}\n\n用户问题：\n${visibleQuestion}`
      : visibleQuestion
    const userMessageId = `message-${Date.now()}-user`
    const courseId = course.id
    const requestDialogId = activeDialogId
    const parentId = activeKnowledge ? selected : (activeExploration?.parentId || orderedNodes[0]?.id || 'course-root')
    setChat('')
    setChatQuote(null)
    setAsking(true)
    setCourses((current) => current.map((item) => item.id === courseId ? {
      ...item,
      studyDialogs: (item.studyDialogs || []).map((dialog) => dialog.id === requestDialogId && dialog.title.startsWith('新对话 ') ? { ...dialog, title: trimText(visibleQuestion, 14) } : dialog),
      chatHistory: [...(item.chatHistory || []), { id: userMessageId, role: 'user' as const, content: visibleQuestion, quote: selectedQuote || undefined, dialogId: requestDialogId }],
    } : item))
    try {
      const response = await fetch('/api/study/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          course_title: course.title,
          current_topic: currentTitle,
          summary: course.analysis?.summary || course.description,
          learning_path: course.analysis?.learning_path || kmNodes.map((node) => node.title),
          key_concepts: course.analysis?.key_concepts || course.tags,
          existing_nodes: [...kmNodes.map((node) => node.title), ...explorationNodes.map((node) => node.title)],
          current_dialog_title: activeDialog?.title || '当前节点',
          allow_new_dialog: requestDialogId === 'main',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || `AI 回答失败（HTTP ${response.status}）`)
      const shouldCreateDialog = Boolean(payload.new_dialog) && requestDialogId === 'main'
      const responseDialogId = shouldCreateDialog ? `dialog-${Date.now()}` : requestDialogId
      const dialogTitle = trimText(payload.dialog_title || visibleQuestion, 14)
      const nodeId = !shouldCreateDialog && payload.add_node && payload.node_title ? `branch-${Date.now()}` : undefined
      setCourses((current) => current.map((item) => {
        if (item.id !== courseId) return item
        const movedHistory = shouldCreateDialog
          ? (item.chatHistory || []).map((message) => message.id === userMessageId ? { ...message, dialogId: responseDialogId } : message)
          : (item.chatHistory || [])
        return {
          ...item,
          activeDialogId: shouldCreateDialog ? responseDialogId : item.activeDialogId,
          studyDialogs: shouldCreateDialog
            ? [...(item.studyDialogs || []), { id: responseDialogId, title: dialogTitle, createdAt: Date.now() }]
            : item.studyDialogs,
          explorationNodes: nodeId ? [...(item.explorationNodes || []), { id: nodeId, title: formatConceptLabel(payload.node_title), parentId, question: visibleQuestion }] : item.explorationNodes,
          chatHistory: [...movedHistory, { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: payload.answer || '我暂时无法回答这个问题。', nodeId, dialogId: responseDialogId }],
        }
      }))
      if (shouldCreateDialog) notify(`已将新话题移到独立对话「${dialogTitle}」`)
      if (nodeId) {
        setSelected(nodeId)
        notify(`拓扑图已新增：${formatConceptLabel(payload.node_title)}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 回答失败'
      setCourses((current) => current.map((item) => item.id === courseId ? {
        ...item,
        chatHistory: [...(item.chatHistory || []), { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: message, dialogId: requestDialogId }],
      } : item))
    } finally {
      setAsking(false)
    }
  }
  return <div className="replay-page" ref={replayPageRef} onMouseUp={captureTextSelection} onTouchEnd={captureTextSelection}>
    {selectionAsk && <button className="selection-ask" style={{ left: selectionAsk.left, top: selectionAsk.top }} onMouseDown={(event) => event.preventDefault()} onClick={quoteSelectionInChat}><MessageSquareText size={14} />问 AI</button>}
    <div className="replay-topbar"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link><div className="replay-location"><span>课堂重放</span><ChevronRight size={14} /><strong>{currentTitle}</strong></div><div className="replay-actions"><span className="saved"><Check size={14} />分析与进度已保存</span><button className="icon-button"><PanelLeftClose size={18} /></button></div></div>
    <div className={`replay-grid ${aiMinimized ? 'ai-minimized' : ''}`}>
      <aside className="path-column">
        <div className="path-head"><span className="eyebrow">LIVE KNOWLEDGE MAP</span><h2>课程知识拓扑</h2><div><span>{kmNodes.length} 个知识节点</span><span>{explorationNodes.length} 条探索支线</span></div><div className="thin-progress"><span style={{ width: `${progressPct}%` }} /></div></div>
        <div className="tier-scroll">
          {groupedNodes.map((group) => <section className={`tier-group tier-${group.tier}`} key={group.tier}>
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
        <div className="content-toolbar"><div><span className={`tier-badge tier-${activeTier || 'branch'}`}>{tierLabel}</span><strong>{currentTitle}</strong></div><span>{activeMaterial?.name || (course.analysis ? '已完成分析' : '等待上传')}</span></div>
        <div className="reading-stage">
          <article className="reading-paper">
            <div className="reading-index"><span>{String(Math.max(activeIndex, 0) + 1).padStart(2, '0')}</span><em>{tierEyebrow} · 学习路径</em></div>
            <Markdown>{activeContent}</Markdown>
            {activeMaterial?.previewUrl && <a className="reading-source-link" href={activeSourceUrl} target="_blank" rel="noreferrer"><LinkIcon size={15} /><span><small>对应原始材料</small><strong>{activeMaterial.name} · 第 {activeSourcePage} 页</strong></span><ArrowRight size={16} /></a>}
            {sourceLesson?.isExactSource && <small className="source-confidence"><Check size={12} />AI 已记录该节点的原始页码</small>}
          </article>
        </div>
        <div className="source-strip"><LinkIcon size={15} /><span>材料依据</span>{previewMaterials.length ? previewMaterials.map((material) => <button className={material.id === activeMaterial?.id ? 'active' : ''} key={material.id} onClick={() => setActiveMaterialId(material.id)}>{material.name}</button>) : course.materials.length ? course.materials.map((material) => <button key={material.id} onClick={() => notify(`材料：${material.name}`)}>{material.name}</button>) : <button onClick={() => notify('请先返回材料库上传并完成分析')}>暂无关联材料</button>}</div>
        <div className="content-nav"><button className="button ghost" onClick={() => activeIndex > 0 && setSelected(orderedNodes[activeIndex - 1].id)} disabled={activeIndex <= 0}><ArrowLeft size={16} />上一步</button><span>步骤 {Math.max(activeIndex + 1, 1)} / {orderedNodes.length}</span><button className="button dark" onClick={() => activeIndex > -1 && activeIndex < orderedNodes.length - 1 && setSelected(orderedNodes[activeIndex + 1].id)} disabled={activeIndex < 0 || activeIndex >= orderedNodes.length - 1}>继续：{orderedNodes[activeIndex + 1]?.title || '已到终点'} <ArrowRight size={16} /></button></div>
      </section>

      {!aiMinimized && <aside className="ai-column">
        <div className="ai-head"><div><span className="ai-avatar"><Bot size={19} /></span><div><strong>AI 讲师</strong><small><span className="online-dot" />{isMainDialog ? `基于 ${course.materials.filter((item) => item.status === 'ready').length} 份课程材料` : '独立话题'}</small></div></div><div className="dialog-controls"><select aria-label="切换对话" value={activeDialogId} disabled={asking} onChange={(event) => switchDialog(event.target.value)}><option value="main">当前节点</option>{studyDialogs.map((dialog) => <option key={dialog.id} value={dialog.id}>{dialog.title}</option>)}</select><button type="button" disabled={asking} onClick={createDialog} title="开启新对话"><Plus size={14} /><span>新对话</span></button><div className="ai-head-actions"><button type="button" aria-label="AI 讲师更多选项" aria-expanded={aiMenuOpen} aria-haspopup="menu" className="icon-button tiny more-button" onClick={() => setAiMenuOpen((open) => !open)}><MoreHorizontal size={17} /></button>{aiMenuOpen && <div className="ai-action-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setAiMenuOpen(false); setAiMinimized(true) }}><PanelLeftClose size={14} />最小化</button></div>}</div></div></div>
        <div className="chat-scroll" ref={chatScrollRef}>
          {isMainDialog && <div className="ai-message teacher-intro">
            <p>我们一起学习 <strong>{currentTitle}</strong>。</p>
            <p>哪里不理解，直接问我。也可以选中内容引用提问，我会结合课程材料帮你讲清楚。</p>
          </div>}
          {!isMainDialog && dialogMessages.length === 0 && <div className="dialog-empty"><span><MessageSquareText size={20} /></span><strong>{activeDialog?.title || '新对话'}</strong><p>这是一个独立话题，不会混入上面的节点问答。直接输入你的问题即可。</p></div>}
          {dialogMessages.map((message) => message.role === 'user' ? <div className={`user-message ${message.quote ? 'with-quote' : ''}`} key={message.id}>{message.quote && <div className="message-selection"><span><MessageSquareText size={12} />Selection</span><p>{message.quote}</p></div>}<div className="user-prompt">{message.content}</div></div> : <div className="ai-message compact-message" key={message.id}><Markdown>{message.content}</Markdown>{message.nodeId && <button className="topology-jump" onClick={() => setSelected(message.nodeId!)}><GitBranchIcon />已加入拓扑图 · 点击定位</button>}</div>)}
          {asking && <div className="ai-message compact-message thinking-message"><span className="mini-spinner" /><p>正在结合当前节点判断是否需要扩展知识拓扑…</p></div>}
        </div>
        <div className="ask-box"><div className="quick-prompts"><button onClick={() => setChat(`换一个类比解释“${currentTitle}”`)}>换个类比</button><button onClick={() => setChat(`基于“${currentTitle}”给我一道变式题`)}>来道变式</button><button onClick={() => setChat(`学习“${currentTitle}”前需要补什么基础？`)}>探索前置知识</button></div><div className={`ask-input ${chatQuote ? 'has-selection' : ''}`}>{chatQuote && <div className="composer-selection"><div><p>{chatQuote}</p><span><MessageSquareText size={12} />Selection</span></div><button type="button" aria-label="移除引用" title="移除引用" onClick={() => setChatQuote(null)}><X size={14} /></button></div>}<div className="composer-entry"><textarea ref={askInputRef} value={chat} disabled={asking} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask() } }} placeholder={chatQuote ? '询问关于所选内容的问题…' : isMainDialog ? '针对当前节点追问；也可以选中文字直接问 AI…' : '输入这个独立话题的问题…'} /><button className="composer-send" onClick={() => void ask()} disabled={(!chat.trim() && !chatQuote) || asking}>{asking ? <RefreshCw className="spin-icon" size={16} /> : <ArrowRight size={18} />}</button></div></div><small>{isMainDialog ? '选中文字可引用提问；AI 会判断是否扩展拓扑' : '当前对话与节点问答分开保存'}</small></div>
      </aside>}
    </div>
    {aiMinimized && <button type="button" className="ai-restore-button" aria-label="恢复 AI 讲师" title="恢复 AI 讲师" onClick={() => setAiMinimized(false)}><Bot size={22} /></button>}
  </div>
}

function GitBranchIcon() { return <Network size={14} /> }

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
