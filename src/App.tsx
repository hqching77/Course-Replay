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
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Course, CourseAnalysis, knowledgeNodes, loadCourses, loadMastery, saveCourses, saveMastery } from './data'

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

function rotateList(list: string[], start: number, count: number) {
  if (!list.length) return []
  const from = ((start % list.length) + list.length) % list.length
  return Array.from({ length: Math.min(count, list.length) }, (_, offset) => list[(from + offset) % list.length])
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
          <Route path="/courses/:courseId" element={<CourseDetail courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId/replay" element={<Replay courses={courses} setCourses={setCourses} notify={notify} />} />
          <Route path="/courses/:courseId/review" element={<Review courses={courses} notify={notify} />} />
          <Route path="/courses/:courseId/progress" element={<Progress courses={courses} />} />
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
  const courseMatch = location.pathname.match(/\/courses\/([^/]+)/)
  const courseId = courseMatch?.[1] || 'digital-circuits'
  return (
    <aside className="sidebar">
      <Link className="brand" to="/" aria-label="Course Replay 首页">
        <span className="brand-mark"><span /></span>
        <span><strong>COURSE</strong><em>REPLAY</em></span>
      </Link>
      <nav className="nav-main">
        <NavItem to="/" end icon={<LayoutDashboard size={18} />} label="课程空间" />
        <NavItem to={`/courses/${courseId}/replay`} icon={<BrainCircuit size={18} />} label="课堂重放" />
        <NavItem to={`/courses/${courseId}/review`} icon={<ListChecks size={18} />} label="复习工坊" />
        <NavItem to={`/courses/${courseId}/progress`} icon={<BarChart3 size={18} />} label="我的学习" />
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
  const avg = Math.round(courses.reduce((sum, item) => sum + item.mastery, 0) / Math.max(courses.length, 1))
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
          <Link className="button light" to="/courses/programming-linux/replay">继续课堂重放 <ArrowRight size={17} /></Link>
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
          {courses.map((course) => <CourseCard key={course.id} course={course} />)}
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
          <Link to="/courses/digital-circuits/replay" className="text-link">进入针对性复习 <ArrowRight size={15} /></Link>
        </div>
      </section>
      {showCreate && <CreateCourseModal onClose={() => setShowCreate(false)} onCreate={(course) => { setCourses([...courses, course]); setShowCreate(false); notify('课程已创建，可以导入材料了') }} />}
    </div>
  )
}

function Metric({ icon, label, value, delta, positive }: { icon: ReactNode; label: string; value: string; delta: string; positive?: boolean }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : ''}>{delta}</small></div></div>
}

function CourseCard({ course }: { course: Course }) {
  const displayedMastery = course.id === 'programming-linux' ? loadMastery() : course.mastery
  return (
    <Link to={`/courses/${course.id}`} className="course-card">
      <div className="course-card-top"><span className="course-swatch" style={{ background: course.accent }} /><button className="icon-button tiny" onClick={(event) => event.preventDefault()}><MoreHorizontal size={16} /></button></div>
      <div className="course-code">{course.code}</div><h3>{course.title}</h3><p>{courseSubtitle(course)}</p>
      <div className="tag-row">{course.tags.map((tag, index) => <span key={`${tag}-${index}`} title={tag}>{formatConceptLabel(tag)}</span>)}</div>
      <div className="card-divider" />
      <div className="course-footer"><div><span>{course.materials.length} 份材料</span><small>最近学习 {course.updated}</small></div><div className="ring" style={{ '--value': `${displayedMastery * 3.6}deg`, '--accent': course.accent } as React.CSSProperties}><span>{displayedMastery}%</span></div></div>
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
    onCreate({ id, title: title.trim(), description: description.trim() || '一门新的课程，等待导入学习材料。', code: 'NEW · 2026 秋', tags: ['新课程'], mastery: 0, materials: [], updated: '刚刚', accent: '#c7f45d' })
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">NEW COURSE</span><h2>创建一门课程</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>课程名称<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：数字信号处理" /></label><label>课程简介<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="这门课主要学习什么？" /></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()}>创建并导入材料 <ArrowRight size={16} /></button></div></form></div>
}

function useCourse(courses: Course[]) {
  const { courseId = '' } = useParams()
  return courses.find((course) => course.id === courseId) || courses[0]
}

function CourseSubnav({ course }: { course: Course }) {
  return <div className="course-subnav"><NavLink end to={`/courses/${course.id}`}>材料库</NavLink><NavLink to={`/courses/${course.id}/replay`}>课堂重放</NavLink><NavLink to={`/courses/${course.id}/review`}>复习工坊</NavLink><NavLink to={`/courses/${course.id}/progress`}>学习记录</NavLink></div>
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
  const [selected, setSelected] = useState('simplify')
  const [activeMaterialId, setActiveMaterialId] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [mastery, setMastery] = useState(loadMastery)
  const [chat, setChat] = useState('')
  const [asking, setAsking] = useState(false)
  const replayNodes = useMemo(() => course?.analysis?.learning_path.length ? course.analysis.learning_path.map((rawStep, index) => ({
    id: `analysis-${index}`,
    title: formatLearningStep(rawStep).title,
    eyebrow: index === 0 ? '当前材料' : 'AI 学习路径',
    mastery: index === 0 ? mastery : 0,
    duration: '按材料学习',
    done: index === 0 && mastery >= 75,
  })) : knowledgeNodes, [course?.analysis, mastery])
  const explorationNodes = course?.explorationNodes || []
  const chatHistory = course?.chatHistory || []
  const topology = useMemo(() => {
    const root = { id: 'course-root', title: course?.analysis?.title || course?.title || '课程', kind: 'root', x: 72, y: 18, parentId: undefined as string | undefined }
    const main = replayNodes.map((node, index) => ({ ...node, kind: 'main', x: 72, y: 105 + index * 128, parentId: index === 0 ? root.id : replayNodes[index - 1].id }))
    const branches = explorationNodes.map((node, index) => {
      const parent = [...main, root].find((candidate) => candidate.id === node.parentId) || main[0] || root
      const siblingsBefore = explorationNodes.slice(0, index).filter((item) => item.parentId === node.parentId).length
      return { ...node, kind: 'branch', x: siblingsBefore % 2 === 0 ? 4 : 158, y: parent.y + 60 + Math.floor(siblingsBefore / 2) * 54 }
    })
    const nodes = [root, ...main, ...branches]
    return { nodes, height: Math.max(530, ...nodes.map((node) => node.y + 105)) }
  }, [course?.analysis?.title, course?.title, explorationNodes, replayNodes])
  const previewMaterials = useMemo(() => course?.materials.filter((material) => material.previewUrl) || [], [course?.materials])
  const activeMaterial = previewMaterials.find((material) => material.id === activeMaterialId) || previewMaterials[0]

  useEffect(() => {
    if (replayNodes.length > 0 && !replayNodes.some((node) => node.id === selected)) setSelected(replayNodes[0].id)
  }, [replayNodes, selected])

  useEffect(() => {
    if (previewMaterials.length > 0 && !previewMaterials.some((material) => material.id === activeMaterialId)) setActiveMaterialId(previewMaterials[0].id)
  }, [previewMaterials, activeMaterialId])

  if (!course) return <NotFound />

  const submitAnswer = () => {
    if (!answer) return
    setSubmitted(true)
    if (course.analysis) {
      const next = Math.min(100, mastery + 5)
      setMastery(next)
      saveMastery(next)
    } else if (answer === 'B' && mastery < 77) { setMastery(77); saveMastery(77) }
  }
  const ask = async () => {
    const question = chat.trim()
    if (!question || asking) return
    const userMessageId = `message-${Date.now()}-user`
    const courseId = course.id
    const parentId = topology.nodes.some((node) => node.id === selected) ? selected : replayNodes[0]?.id || 'course-root'
    setChat('')
    setAsking(true)
    setCourses((current) => current.map((item) => item.id === courseId ? {
      ...item,
      chatHistory: [...(item.chatHistory || []), { id: userMessageId, role: 'user' as const, content: question }],
    } : item))
    try {
      const response = await fetch('/api/study/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          course_title: course.title,
          current_topic: topology.nodes.find((node) => node.id === parentId)?.title || currentTitle,
          summary: course.analysis?.summary || course.description,
          learning_path: course.analysis?.learning_path || replayNodes.map((node) => node.title),
          key_concepts: course.analysis?.key_concepts || course.tags,
          existing_nodes: topology.nodes.map((node) => node.title),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || `AI 回答失败（HTTP ${response.status}）`)
      const nodeId = payload.add_node && payload.node_title ? `branch-${Date.now()}` : undefined
      setCourses((current) => current.map((item) => item.id === courseId ? {
        ...item,
        explorationNodes: nodeId ? [...(item.explorationNodes || []), { id: nodeId, title: formatConceptLabel(payload.node_title), parentId, question }] : item.explorationNodes,
        chatHistory: [...(item.chatHistory || []), { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: payload.answer || '我暂时无法回答这个问题。', nodeId }],
      } : item))
      if (nodeId) {
        setSelected(nodeId)
        notify(`拓扑图已新增：${formatConceptLabel(payload.node_title)}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 回答失败'
      setCourses((current) => current.map((item) => item.id === courseId ? {
        ...item,
        chatHistory: [...(item.chatHistory || []), { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: message }],
      } : item))
    } finally {
      setAsking(false)
    }
  }
  const activeIndex = replayNodes.findIndex((node) => node.id === selected)
  const currentTitle = topology.nodes.find((node) => node.id === selected)?.title || replayNodes[Math.max(activeIndex, 0)]?.title || course.analysis?.title || course.title
  const generatedQuestion = course.analysis?.review_questions[0]
  return <div className="replay-page">
    <div className="replay-topbar"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link><div className="replay-location"><span>课堂重放</span><ChevronRight size={14} /><strong>{currentTitle}</strong></div><div className="replay-actions"><span className="saved"><Check size={14} />分析与进度已保存</span><button className="icon-button"><PanelLeftClose size={18} /></button></div></div>
    <div className="replay-grid">
      <aside className="path-column">
        <div className="path-head"><span className="eyebrow">LIVE KNOWLEDGE MAP</span><h2>课程知识拓扑</h2><div><span>{replayNodes.length} 个主线节点</span><span>{explorationNodes.length} 条探索支线</span></div><div className="thin-progress"><span style={{ width: `${Math.max(8, ((Math.max(activeIndex, 0) + 1) / replayNodes.length) * 100)}%` }} /></div></div>
        <div className="topology-scroll">
          <div className="topology-canvas" style={{ height: `${topology.height}px` }}>
            <svg viewBox={`0 0 260 ${topology.height}`} preserveAspectRatio="none" aria-hidden="true">
              {topology.nodes.filter((node) => node.parentId).map((node) => {
                const parent = topology.nodes.find((candidate) => candidate.id === node.parentId)
                if (!parent) return null
                const isBranch = node.kind === 'branch'
                return <path key={`${node.parentId}-${node.id}`} className={isBranch ? 'branch-edge' : 'main-edge'} d={`M ${parent.x + 55} ${parent.y + 38} C ${parent.x + 55} ${node.y - 12}, ${node.x + 50} ${parent.y + 48}, ${node.x + 50} ${node.y}`} />
              })}
              {asking && (() => { const parent = topology.nodes.find((node) => node.id === selected) || topology.nodes[0]; return <path className="pending-edge" d={`M ${parent.x + 55} ${parent.y + 38} C ${parent.x + 55} ${parent.y + 58}, 208 ${parent.y + 50}, 208 ${parent.y + 72}`} /> })()}
            </svg>
            {topology.nodes.map((node, index) => <button key={node.id} style={{ left: node.x, top: node.y }} onClick={() => setSelected(node.id)} className={`topology-node ${node.kind} ${selected === node.id ? 'active' : ''} ${node.kind === 'main' && 'done' in node && node.done ? 'done' : ''}`}><small>{node.kind === 'root' ? '课程' : node.kind === 'branch' ? '探索支线' : `主线 ${index}`}</small><strong>{node.title}</strong>{node.kind === 'branch' && <Network size={12} />}</button>)}
            {asking && (() => { const parent = topology.nodes.find((node) => node.id === selected) || topology.nodes[0]; return <div className="topology-node pending" style={{ left: 158, top: parent.y + 72 }}><span className="mini-spinner" /><strong>判断是否扩展…</strong></div> })()}
          </div>
        </div>
        <div className="topology-legend"><span><i className="main" />课程主线</span><span><i className="branch" />问答新增</span></div>
        <div className="path-tip"><Lightbulb size={16} /><p>点击节点只会切换学习焦点，拓扑图始终保留。必要的新知识会在提问后自动长成支线。</p></div>
      </aside>

      <section className="content-column">
        <div className="content-toolbar"><div><span className="document-badge">{activeMaterial?.type || 'DOC'}</span><strong>{activeMaterial?.name || '还没有可预览的已分析材料'}</strong></div><span>{activeMaterial?.pages ? `${activeMaterial.pages} 页` : course.analysis ? '已完成分析' : '等待上传'}</span></div>
        <div className="slide-stage">
          {activeMaterial?.previewUrl ? (['PNG', 'JPG', 'JPEG', 'WEBP'].includes(activeMaterial.type) ? <img className="material-preview-media" src={activeMaterial.previewUrl} alt={activeMaterial.name} /> : <iframe className="material-preview-frame" src={activeMaterial.previewUrl} title={activeMaterial.name} />) : <div className="slide-paper analysis-slide">
            <div className="slide-index">{String(Math.max(activeIndex, 0) + 1).padStart(2, '0')} <span>AI 分析 · 学习路径</span></div>
            <h2>{replayNodes[Math.max(activeIndex, 0)]?.title || course.analysis?.title || '材料分析结果'}</h2>
            <p className="slide-lead">{course.analysis ? trimText(course.analysis.summary, 150) : '上传课件、笔记或课本并完成分析后，这一步会显示 AI 从材料里读出的内容。'}</p>
            {course.analysis ? <>
              <div className="slide-block"><span>本步要点</span><p>{course.analysis.learning_path[Math.max(activeIndex, 0)] || course.analysis.title}</p></div>
              <div className="slide-block"><span>关键概念</span><div className="slide-chips">{rotateList(course.analysis.key_concepts, Math.max(activeIndex, 0), 3).map((concept, i) => <i key={i}>{formatConceptLabel(concept)}</i>)}</div></div>
              {course.analysis.review_questions.length > 0 && <div className="slide-block"><span>材料检验题</span><p>{course.analysis.review_questions[Math.max(activeIndex, 0) % course.analysis.review_questions.length]}</p></div>}
              <div className="slide-foot"><span>材料依据</span><p>{activeMaterial?.name || course.materials[0]?.name || '未关联材料'}{(activeMaterial || course.materials[0])?.pages ? ` · 共 ${(activeMaterial || course.materials[0])!.pages} 页` : ''} · 第 {Math.max(activeIndex, 0) + 1} / {replayNodes.length} 步</p></div>
            </> : <div className="slide-foot"><span>下一步</span><p>前往材料库上传材料并完成分析，这里会自动填入该知识点对应的分析内容。</p></div>}
          </div>}
        </div>
        <div className="source-strip"><LinkIcon size={15} /><span>已上传材料</span>{previewMaterials.length ? previewMaterials.map((material) => <button className={material.id === activeMaterial?.id ? 'active' : ''} key={material.id} onClick={() => setActiveMaterialId(material.id)}>{material.name}</button>) : <button onClick={() => notify('请先返回材料库上传并完成分析')}>暂无可预览材料</button>}</div>
        <div className="content-nav"><button className="button ghost" onClick={() => activeIndex > 0 && setSelected(replayNodes[activeIndex - 1].id)} disabled={activeIndex <= 0}><ArrowLeft size={16} />上一步</button><span>步骤 {Math.max(activeIndex + 1, 1)} / {replayNodes.length}</span><button className="button dark" onClick={() => activeIndex < replayNodes.length - 1 && setSelected(replayNodes[activeIndex + 1].id)} disabled={activeIndex >= replayNodes.length - 1}>继续：{replayNodes[activeIndex + 1]?.title || '已到终点'} <ArrowRight size={16} /></button></div>
      </section>

      <aside className="ai-column">
        <div className="ai-head"><div><span className="ai-avatar"><Bot size={19} /></span><div><strong>AI 讲师</strong><small><span className="online-dot" />基于 {course.materials.filter((item) => item.status === 'ready').length} 份课程材料</small></div></div><button className="icon-button tiny"><MoreHorizontal size={17} /></button></div>
        <div className="chat-scroll">
          <div className="ai-message"><p>{course.analysis ? trimText(course.analysis.summary, 320) : <>观察这个卡诺图。橙色圈跨过了左右边界——因为卡诺图的列按 <strong>00、01、11、10</strong> 排列，首尾依然只相差一个变量。</>}</p><div className="citation-row">{course.materials.slice(0, 2).map((material, index) => <button key={material.id}>[{index + 1}] {material.name}</button>)}</div></div>
          <div className="ai-message question-card"><span className="question-type">理解检验 · {generatedQuestion ? '基于材料' : '单选题'}</span><p><strong>{generatedQuestion || '为什么卡诺图中最左列与最右列可以视为相邻？'}</strong></p>{generatedQuestion ? <textarea className="review-answer" value={answer || ''} disabled={submitted} onChange={(event) => setAnswer(event.target.value)} placeholder="根据刚才看到的材料写下你的理解…" /> : <div className="answer-list">
            {[['A','它们在图形位置上最近'],['B','格雷码顺序使它们仅有一位变量不同'],['C','所有边界上的格子都彼此相邻'],['D','这是为了让化简结果更短']].map(([key, value]) => <button key={key} disabled={submitted} onClick={() => setAnswer(key)} className={`${answer === key ? 'selected' : ''} ${submitted && key === 'B' ? 'correct' : ''} ${submitted && answer === key && key !== 'B' ? 'wrong' : ''}`}><span>{key}</span>{value}{submitted && key === 'B' && <CheckCircle2 size={16} />}</button>)}
          </div>}<button className="button primary full" disabled={!answer?.trim() || submitted} onClick={submitAnswer}>{submitted ? '回答已保存' : '提交回答'}</button></div>
          {submitted && <div className="feedback-card"><div className="feedback-title"><CheckCircle2 size={18} /><strong>{generatedQuestion ? '回答已记录到当前学习进度' : answer === 'B' ? '回答正确，而且理由匹配' : '再看一下格雷码的排列规则'}</strong><span>{generatedQuestion ? '+5%' : answer === 'B' ? '+15%' : '-8%'}</span></div><p>{generatedQuestion ? '这是根据你上传材料生成的开放题；可以继续向 AI 讲师追问并补充答案。' : answer === 'B' ? '这说明你理解了“逻辑相邻”而不是根据图形位置猜测。' : '边界相邻的关键不是物理距离，而是只有一位变量发生变化。'}</p><div className="mastery-change"><span>本知识点掌握度</span><div><i style={{ width: `${mastery}%` }} /></div><strong>{mastery}%</strong></div><div className="feedback-actions"><button onClick={() => setChat(`为什么“${currentTitle}”是这样？`)}>为什么？深入解释</button><button onClick={() => setChat(`学习“${currentTitle}”前需要补什么基础？`)}>补充前置知识</button></div></div>}
          {chatHistory.map((message) => message.role === 'user' ? <div className="user-message" key={message.id}>{message.content}</div> : <div className="ai-message compact-message" key={message.id}><p>{message.content}</p>{message.nodeId && <button className="topology-jump" onClick={() => setSelected(message.nodeId!)}><GitBranchIcon />已加入拓扑图 · 点击定位</button>}</div>)}
          {asking && <div className="ai-message compact-message thinking-message"><span className="mini-spinner" /><p>正在结合当前节点判断是否需要扩展知识拓扑…</p></div>}
        </div>
        <div className="ask-box"><div className="quick-prompts"><button onClick={() => setChat(`换一个类比解释“${currentTitle}”`)}>换个类比</button><button onClick={() => setChat(`基于“${currentTitle}”给我一道变式题`)}>来道变式</button><button onClick={() => setChat(`学习“${currentTitle}”前需要补什么基础？`)}>探索前置知识</button></div><div className="ask-input"><textarea value={chat} disabled={asking} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask() } }} placeholder="针对当前节点追问；必要时会自动扩展左侧拓扑…" /><button onClick={() => void ask()} disabled={!chat.trim() || asking}>{asking ? <RefreshCw className="spin-icon" size={16} /> : <Send size={17} />}</button></div><small>AI 会判断问题是否值得成为新的知识节点</small></div>
      </aside>
    </div>
  </div>
}

function GitBranchIcon() { return <Network size={14} /> }

function Review({ courses, notify }: { courses: Course[]; notify: (message: string) => void }) {
  const course = useCourse(courses)
  const [tab, setTab] = useState<'quiz' | 'sheet'>('quiz')
  const [generated, setGenerated] = useState(false)
  if (!course) return <NotFound />
  const recommendedConcepts = course.analysis?.key_concepts.slice(0, 3).map(formatConceptLabel) || ['卡诺图边界相邻', '最小项表达', '竞争与冒险']
  return <div className="page"><div className="back-row"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link></div><PageHeader title="复习工坊" subtitle="把薄弱点、错题和必会知识组合成一次高效复习。" actions={<button className="button primary" onClick={() => { setGenerated(true); notify(tab === 'quiz' ? '已根据材料生成复习题' : 'Cheatsheet 已生成') }}><Sparkles size={17} />立即生成</button>} /><CourseSubnav course={course} />
    <div className="review-layout"><section className="panel builder-panel"><div className="mode-switch"><button onClick={() => { setTab('quiz'); setGenerated(false) }} className={tab === 'quiz' ? 'active' : ''}><ListChecks size={18} />复习题单</button><button onClick={() => { setTab('sheet'); setGenerated(false) }} className={tab === 'sheet' ? 'active' : ''}><FileText size={18} />一页 Cheatsheet</button></div><div className="builder-copy"><span className="pill amber"><Sparkles size={13} />{course.analysis ? '根据已上传材料推荐' : '根据你的学习记录推荐'}</span><h2>{tab === 'quiz' ? '生成一次 20 分钟的针对性练习' : '生成一页纸核心知识总结'}</h2><p>{course.analysis ? trimText(course.analysis.summary, 220) : (tab === 'quiz' ? '系统会提高薄弱知识点与历史错题的出现权重。' : '浓缩核心定义、公式、知识联系与易错点，并保留来源引用。')}</p></div><div className="form-grid"><label>知识范围<select><option>{course.analysis?.title || '当前章节：逻辑函数化简'}</option><option>整门课程</option><option>仅薄弱知识点</option></select></label><label>{tab === 'quiz' ? '复习时长' : '内容密度'}<select><option>{tab === 'quiz' ? `材料题 · ${course.analysis?.review_questions.length || 12} 题` : '标准 · 一页 A4'}</option><option>{tab === 'quiz' ? '10 分钟 · 精简模式' : '精简 · 只保留必会项'}</option></select></label><label>难度<select><option>自适应</option><option>基础巩固</option><option>考试挑战</option></select></label><label>内容侧重<select><option>薄弱点优先</option><option>平均覆盖</option><option>错题优先</option></select></label></div><div className="recommend-row"><span><Target size={16} />将重点覆盖</span>{recommendedConcepts.map((concept, index) => <button key={`${concept}-${index}`}>{concept}</button>)}</div></section>
      <aside className={`panel artifact-preview ${generated ? 'generated' : ''}`}>{generated ? tab === 'quiz' ? <QuizPreview questions={course.analysis?.review_questions} title={course.analysis?.title} /> : <SheetPreview analysis={course.analysis} materialCount={course.materials.length} /> : <><span className="artifact-icon">{tab === 'quiz' ? <ListChecks size={30} /> : <FileText size={30} />}</span><h3>生成内容将在这里预览</h3><p>{course.analysis ? '内容将直接使用当前课程已保存的分析结果。' : '上传材料并完成分析后，可根据知识路径继续生成复习内容。'}</p></>}</aside></div>
  </div>
}

function QuizPreview({ questions, title }: { questions?: string[]; title?: string }) { const items = questions?.length ? questions : ['一个四变量卡诺图中，位于四个角的最小项能否合并？']; return <div className="quiz-preview"><div className="preview-head"><span>已生成 · 来自课程材料</span><strong>{title || '期中针对性复习'}</strong><small>{items.length} 题 · AI 分析结果已保存</small></div>{items.slice(0, 3).map((question, index) => <div className="preview-question generated-question" key={`${question}-${index}`}><span>{String(index + 1).padStart(2, '0')} · 开放题</span><p>{question}</p></div>)}<button className="button dark full">开始答题 <ArrowRight size={16} /></button></div> }

function SheetPreview({ analysis, materialCount }: { analysis?: CourseAnalysis; materialCount: number }) { return <div className="sheet-preview"><div className="preview-head"><span>CHEATSHEET · 已保存分析</span><strong>{analysis?.title || '逻辑函数化简'}</strong><small>基于 {materialCount} 份课程材料</small></div><h4>01 · 内容摘要</h4><p>{analysis ? trimText(analysis.summary, 480) : '相邻最小项只有一个变量取值不同，合并后可消去该变量。'}</p><h4>02 · 核心概念</h4><div className="analysis-concepts">{(analysis?.key_concepts.map(formatConceptLabel) || ['相邻项', '格雷码', '函数化简']).map((concept, index) => <span key={`${concept}-${index}`}>{concept}</span>)}</div><h4>03 · 学习路径</h4><p>{(analysis?.learning_path.map((step) => formatLearningStep(step).title) || ['理解概念', '跟随例题', '完成检验']).join(' → ')}</p></div> }

function Progress({ courses }: { courses: Course[] }) {
  const course = useCourse(courses)
  const [mastery] = useState(loadMastery)
  if (!course) return <NotFound />
  const bars = [42, 48, 45, 54, 61, 68, mastery]
  const progressNodes = course.analysis?.learning_path.length ? course.analysis.learning_path.map((step, index) => ({ id: `analysis-${index}`, title: formatLearningStep(step).title, mastery: index === 0 ? mastery : Math.max(0, mastery - index * 12) })) : knowledgeNodes
  const weakConcepts = course.analysis?.key_concepts.slice(0, 2).map(formatConceptLabel) || ['卡诺图边界相邻', '最小项标准形式']
  return <div className="page"><div className="back-row"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link></div><PageHeader title="我的学习" subtitle="看见每一次真正理解，也看见下一步该往哪里走。" /><CourseSubnav course={course} /><section className="progress-hero"><div><span className="eyebrow">OVERALL MASTERY</span><strong>{mastery}%</strong><p>整体掌握度 · 最近 7 天提升 15%</p></div><div className="trend-chart">{bars.map((bar, index) => <span key={index} style={{ height: `${bar}%` }}><i>{index === bars.length - 1 ? `${bar}%` : ''}</i></span>)}</div><div className="streak"><span><Zap size={18} /></span><strong>7 天</strong><small>连续学习</small></div></section><div className="progress-grid"><section className="panel"><div className="section-heading compact"><div><h2>{course.analysis ? '材料学习路径' : '知识点掌握'}</h2><p>{course.analysis ? '来自已保存的 AI 分析' : '按优先级排序'}</p></div></div><div className="mastery-list">{progressNodes.map((node) => <div key={node.id}><span>{node.title}<small>{node.mastery >= 75 ? '已掌握' : node.mastery > 0 ? '继续巩固' : '待学习'}</small></span><div><i style={{ width: `${node.mastery}%` }} /></div><strong>{node.mastery}%</strong></div>)}</div></section><section className="panel weakness-panel"><div className="section-heading compact"><div><h2>优先补强</h2><p>{course.analysis ? '来自材料关键概念' : '来自错题与探索记录'}</p></div></div>{weakConcepts.map((concept, index) => <div className="weak-item" key={`${concept}-${index}`}><span className={`priority ${index === 0 ? 'high' : 'mid'}`}>{index === 0 ? '高' : '中'}</span><div><strong>{concept}</strong><p>{course.analysis ? '建议在课堂重放中结合原文查看' : '来自历史学习记录'}</p></div><Link to={`/courses/${course.id}/replay`}>去复习</Link></div>)}<div className="branch-summary"><Network size={18} /><div><strong>{course.analysis?.learning_path.length || 3} 个学习阶段</strong><p>学习内容已和当前课程材料关联。</p></div></div></section></div></div>
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
