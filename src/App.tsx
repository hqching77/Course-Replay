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
  FileText,
  Gauge,
  LayoutDashboard,
  Library,
  Lightbulb,
  Link as LinkIcon,
  ListChecks,
  LogIn,
  LogOut,
  MessageCircleQuestion,
  Mic,
  MoreHorizontal,
  Network,
  NotebookPen,
  PanelLeftClose,
  PenLine,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Course, CourseAnalysis, KnowledgeNode, KnowledgeTier, Section, TIER_META, courseMastery, createSection, deriveKnowledgeMap, knowledgeNodes, loadMastery, normalizeMarkdown, saveMastery } from './data'
import { apiFetch, openProtectedFile } from './api'
import { AccountView, syncLabel } from './account'
import { AuthScreen, SplashScreen } from './AuthScreen'
import { addMaterialFiles, autoSectionTitle, buildInputs, forgetStagedFile, startSectionBuild, titleFromAnalysis } from './build'
import { CLASS_NOTES_ID, classNodeId, classNotesMarkdown, classQuestionMarkdown, formatClock, transcriptMarkdown } from './classNotes'
import { LanguageToggle, t, useLang } from './i18n'
import { LiveProvider, useLive, useStartLiveClass } from './live'
import { LiveChooser, LiveClass } from './LiveClass'
import { SessionControls, displayNameOf, initialsOf, useSession } from './session'
import { SettingsPage } from './SettingsPage'
import { Markdown, NotFound, PageHeader, formatConceptLabel, trimText, updateSection } from './ui'
import { useCourseStore } from './workspace'

const TIER_ORDER: KnowledgeTier[] = ['prereq', 'core', 'advanced']
const TRANSCRIPT_NODE_ID = 'class-transcript'
const ACCEPTED_FILES = '.pdf,.ppt,.pptx,.doc,.docx,.odt,.odp,.md,.txt,.png,.jpg,.jpeg,.webp'

type Notice = { id: number; message: string }
type SetCourses = Dispatch<SetStateAction<Course[]>>
type PageProps = { courses: Course[]; setCourses: SetCourses; notify: (message: string) => void }

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
  return minutes > 0 ? t('{m} 分 {s} 秒', { m: minutes, s: String(seconds).padStart(2, '0') }) : t('{s} 秒', { s: seconds })
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
  return t('{sections} 个小节 · {materials} 份材料 · 随时开始学习', { sections, materials })
}

/** First section id for a course, for "continue learning" style shortcuts. */
function firstSectionId(course: Course | undefined) {
  return course?.sections[0]?.id
}

function sectionStatusLabel(section: Section) {
  return section.status === 'ready' ? t('已构建') : section.status === 'building' ? t('构建中') : section.status === 'failed' ? t('构建失败') : t('待构建')
}

function App() {
  useLang() // re-render the whole app when the language changes
  const controls = useSession()
  const { session } = controls
  if (session.status === 'checking') return <SplashScreen text={t('正在连接…')} />
  if (session.status === 'signed-out') return <AuthScreen notice={session.notice ? t(session.notice) : undefined} onSignedIn={controls.signIn} onGuest={controls.continueAsGuest} onRetry={() => void controls.retry()} />
  // Remount per user so one account's courses never leak into another's.
  return <Workspace key={session.status === 'account' ? session.user.id : 'guest'} controls={controls} />
}

function Workspace({ controls }: { controls: SessionControls }) {
  const { session } = controls
  const store = useCourseStore(session, controls.expire)
  const { courses, setCourses } = store
  const [notices, setNotices] = useState<Notice[]>([])

  const notify = (message: string) => {
    const id = Date.now() + Math.random()
    setNotices((items) => [...items, { id, message }])
    window.setTimeout(() => setNotices((items) => items.filter((item) => item.id !== id)), 2600)
  }

  const account: AccountView = {
    mode: session.status === 'account' ? 'account' : 'guest',
    name: displayNameOf(session),
    username: session.status === 'account' ? session.user.username : undefined,
    syncState: store.syncState,
    offlineOnly: session.status === 'guest' && session.offlineOnly,
    rename: () => {
      const name = window.prompt(t('修改昵称'), displayNameOf(session))
      if (!name || !name.trim() || name.trim() === displayNameOf(session)) return
      controls.rename(name).then(() => notify(t('昵称已更新'))).catch((error) => notify(error instanceof Error ? error.message : t('修改失败')))
    },
    signOut: () => { void store.flush().finally(() => void controls.signOut()) },
    showLogin: controls.showLogin,
  }

  if (store.loadState === 'loading') return <SplashScreen text={t('正在加载你的课程…')} />
  if (store.loadState === 'error') return <SplashScreen text={t('加载课程失败，请检查网络或服务器。')}><button className="button primary" onClick={store.reload}><RefreshCw size={16} />{t('重试')}</button><button className="button ghost" onClick={account.signOut}>{t('退出登录')}</button></SplashScreen>

  const page = { courses, setCourses, notify }
  return (
    <LiveProvider courses={courses} setCourses={setCourses}>
      <div className="app-shell">
        <Sidebar courses={courses} account={account} />
        <main className="main-shell">
          <Routes>
            <Route path="/" element={<Dashboard {...page} />} />
            <Route path="/live" element={<LiveChooser {...page} />} />
            <Route path="/courses/:courseId" element={<CourseSections {...page} />} />
            <Route path="/courses/:courseId/sections/:sectionId" element={<SectionDetail {...page} />} />
            <Route path="/courses/:courseId/sections/:sectionId/live" element={<LiveClass {...page} />} />
            <Route path="/courses/:courseId/sections/:sectionId/replay" element={<Replay {...page} />} />
            <Route path="/courses/:courseId/replay" element={<LegacySectionRedirect courses={courses} suffix="replay" />} />
            <Route path="/settings" element={<SettingsPage notify={notify} account={account} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <div className="toast-stack" aria-live="polite">
          {notices.map((notice) => (
            <div className="toast" key={notice.id}><CheckCircle2 size={17} />{notice.message}</div>
          ))}
        </div>
      </div>
    </LiveProvider>
  )
}

function Sidebar({ courses, account }: { courses: Course[]; account: AccountView }) {
  const location = useLocation()
  const live = useLive()
  const [menuOpen, setMenuOpen] = useState(false)
  const courseId = location.pathname.match(/\/courses\/([^/]+)/)?.[1] || courses[0]?.id || 'programming-linux'
  const sectionId = location.pathname.match(/\/sections\/([^/]+)/)?.[1]
  const base = sectionId ? `/courses/${courseId}/sections/${sectionId}` : `/courses/${courseId}`
  // 上课中: back to the class that's running, otherwise pick a course and start.
  const listening = live.state.status !== 'idle' && live.state.courseId && live.state.sectionId
  const liveTo = listening ? `/courses/${live.state.courseId}/sections/${live.state.sectionId}/live` : '/live'
  return (
    <aside className="sidebar">
      <Link className="brand" to="/" aria-label={t('Course Replay 首页')}>
        <span className="brand-mark"><span /></span>
        <span><strong>COURSE</strong><em>REPLAY</em></span>
      </Link>
      <nav className="nav-main">
        <NavItem to="/" end icon={<LayoutDashboard size={18} />} label={t('课程空间')} />
        <NavItem to={liveTo} icon={<Radio size={18} />} label={t('上课中')} badge={listening ? <span className="live-dot nav-live-dot" /> : undefined} />
        <NavItem to={sectionId ? `${base}/replay` : `/courses/${courseId}`} icon={<BrainCircuit size={18} />} label={t('课堂重放')} />
        <NavItem to="/settings" icon={<UserRound size={18} />} label={t('我的')} className="mobile-only" />
      </nav>
      <div className="sidebar-label">{t('当前学期')}</div>
      <div className="semester-card">
        <div className="semester-row"><span>{t('2026 秋')}</span><ChevronDown size={15} /></div>
        <div className="semester-progress"><span style={{ width: '58%' }} /></div>
        <small>{t('第 8 周 · 共 16 周')}</small>
      </div>
      <div className="sidebar-bottom">
        <LanguageToggle className="sidebar-lang" />
        <NavItem to="/settings" icon={<Settings size={18} />} label={t('AI 与偏好设置')} />
        <div className="profile">
          <div className="avatar">{initialsOf(account.name)}</div>
          <div><strong>{account.name}</strong><span className={`sync-label ${account.syncState}`}>{syncLabel(account)}</span></div>
          <div className="material-menu-wrap profile-menu-wrap">
            <button className="icon-button tiny" aria-label={t('账号操作')} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={17} /></button>
            {menuOpen && <div className="material-menu profile-menu" onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={() => { setMenuOpen(false); account.rename() }}><PenLine size={14} />{t('修改昵称')}</button>
              {account.mode === 'account'
                ? <button className="delete" onClick={() => { setMenuOpen(false); account.signOut() }}><LogOut size={14} />{t('退出登录')}</button>
                : <button onClick={() => { setMenuOpen(false); account.showLogin() }}><LogIn size={14} />{t('登录 / 注册')}</button>}
            </div>}
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavItem({ to, icon, label, end, className, badge }: { to: string; icon: ReactNode; label: string; end?: boolean; className?: string; badge?: ReactNode }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} ${className || ''}`}>{icon}<span>{label}</span>{badge}</NavLink>
}

const COURSE_GRID_CAP = 6

function Dashboard({ courses, setCourses, notify }: PageProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [showAllCourses, setShowAllCourses] = useState(false)
  const navigate = useNavigate()
  const avg = Math.round(courses.reduce((sum, item) => sum + courseMastery(item), 0) / Math.max(courses.length, 1))
  const lead = courses[0]
  const leadReplay = lead && firstSectionId(lead) ? `/courses/${lead.id}/sections/${firstSectionId(lead)}/replay` : lead ? `/courses/${lead.id}` : '/'
  return (
    <div className="page dashboard-page">
      <PageHeader
        title={t('下午好，准备继续吗？')}
        subtitle={t('把散落的课件与笔记，重新串成一条能真正掌握的学习路径。')}
        actions={<><button className="icon-button" aria-label={t('搜索')}><Search size={19} /></button><button className="button primary" onClick={() => setShowCreate(true)}><Plus size={18} />{t('创建课程')}</button></>}
      />

      <section className="hero-card">
        <div className="hero-copy">
          <span className="pill lime"><Zap size={13} />{t('继续上次学习')}</span>
          <h2>{t('Shell、终端与命令执行')}</h2>
          <p>{t('计算机程序设计基础（1）· 补充材料 1')}</p>
          <div className="hero-progress-row"><span>{t('课程进度')}</span><strong>3 / 5</strong></div>
          <div className="hero-progress"><span style={{ width: '58%' }} /></div>
          <Link className="button light" to={leadReplay}>{t('继续课堂重放')} <ArrowRight size={17} /></Link>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="hero-node main-node"><BrainCircuit size={29} /><span>{t('化简')}</span></div>
          <div className="hero-node node-a">A · B</div>
          <div className="hero-node node-b">A + B</div>
          <div className="hero-node node-c">K-map</div>
          <span className="connector connector-a" /><span className="connector connector-b" /><span className="connector connector-c" />
        </div>
      </section>

      <section className="metric-grid">
        <Metric icon={<Library size={18} />} label={t('进行中的课程')} value={String(courses.length)} delta={t('本学期')} />
        <Metric icon={<Gauge size={18} />} label={t('平均掌握度')} value={`${avg}%`} delta={t('较上周 +6%')} positive />
        <Metric icon={<Clock3 size={18} />} label={t('本周学习')} value="4h 28m" delta={t('目标 6 小时')} />
        <Metric icon={<Target size={18} />} label={t('待攻克知识点')} value="7" delta={t('其中 3 个高优先级')} />
      </section>

      <section className="section-block">
        <div className="section-heading"><div><h2>{t('我的课程')}</h2><p>{t('每门课都有独立的知识路径与学习记录')}</p></div>{courses.length > COURSE_GRID_CAP && <button className="text-button" onClick={() => setShowAllCourses((value) => !value)}>{showAllCourses ? t('收起') : t('查看全部 ({n})', { n: courses.length })} <ArrowRight size={15} /></button>}</div>
        <div className="course-grid">
          {(showAllCourses ? courses : courses.slice(0, COURSE_GRID_CAP)).map((course) => <CourseCard key={course.id} course={course}
            onDelete={() => { if (window.confirm(t('确定删除课程「{title}」？该课程下的所有小节与学习记录都会被移除。', { title: course.title }))) { setCourses(courses.filter((item) => item.id !== course.id)); notify(t('课程已删除')) } }}
            onRename={() => { const name = window.prompt(t('重命名课程'), course.title); if (name && name.trim() && name.trim() !== course.title) { setCourses(courses.map((item) => item.id === course.id ? { ...item, title: name.trim() } : item)); notify(t('课程已重命名')) } }} />)}
          <button className="new-course-card" onClick={() => setShowCreate(true)}><span><Plus size={22} /></span><strong>{t('创建新课程')}</strong><small>{t('导入课件，开始构建知识路径')}</small></button>
        </div>
      </section>
      {showCreate && <CreateCourseModal onClose={() => setShowCreate(false)} onCreate={(course) => { setCourses([...courses, course]); setShowCreate(false); notify(t('课程已创建：点「开始上课」就能马上听课')); navigate(`/courses/${course.id}`) }} />}
    </div>
  )
}

function Metric({ icon, label, value, delta, positive }: { icon: ReactNode; label: string; value: string; delta: string; positive?: boolean }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : ''}>{delta}</small></div></div>
}

function CourseCard({ course, onDelete, onRename }: { course: Course; onDelete: () => void; onRename: () => void }) {
  const displayedMastery = courseMastery(course)
  const stats = courseStats(course)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <Link to={`/courses/${course.id}`} className="course-card">
      <div className="course-card-top"><span className="course-swatch" style={{ background: course.accent }} /><div className="material-menu-wrap"><button className="icon-button tiny" aria-label={t('课程操作')} aria-expanded={menuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((value) => !value) }}><MoreHorizontal size={16} /></button>{menuOpen && <div className="material-menu" onMouseLeave={() => setMenuOpen(false)}><button onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); onRename() }}><FileText size={14} />{t('重命名')}</button><button className="delete" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); onDelete() }}><Trash2 size={14} />{t('删除课程')}</button></div>}</div></div>
      <div className="course-code">{t(course.code)}</div><h3>{course.title}</h3><p>{courseSubtitle(course)}</p>
      <div className="tag-row">{course.tags.map((tag, index) => <span key={`${tag}-${index}`} title={tag}>{formatConceptLabel(t(tag))}</span>)}</div>
      <div className="card-divider" />
      <div className="course-footer"><div><span>{t('{sections} 个小节 · {materials} 份材料', { sections: stats.sections, materials: stats.materials })}</span><small>{t('最近学习 {when}', { when: t(course.updated || '刚刚') })}</small></div><div className="ring" style={{ '--value': `${displayedMastery * 3.6}deg`, '--accent': course.accent } as React.CSSProperties}><span>{displayedMastery}%</span></div></div>
    </Link>
  )
}

function CreateCourseModal({ onClose, onCreate }: { onClose: () => void; onCreate: (course: Course) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    // Random id: ids are stored unencrypted, so they must not contain the course name.
    const id = `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    onCreate({ id, title: title.trim(), description: description.trim() || t('一门新的课程，等待新建小节。'), code: t('NEW · 2026 秋'), tags: [t('新课程')], mastery: 0, updated: t('刚刚'), accent: '#c7f45d', sections: [] })
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">NEW COURSE</span><h2>{t('创建一门课程')}</h2></div><button type="button" className="icon-button" aria-label={t('关闭')} onClick={onClose}><X size={18} /></button></div><label>{t('课程名称')}<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('例如：数字信号处理')} /></label><label>{t('课程简介')}<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('这门课主要学习什么？')} /></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{t('取消')}</button><button className="button primary" disabled={!title.trim()}>{t('创建课程')} <ArrowRight size={16} /></button></div></form></div>
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
  return <div className="course-subnav"><NavLink end to={base}>{t('材料与构建')}</NavLink><NavLink to={`${base}/live`}>{t('上课中')}</NavLink><NavLink to={`${base}/replay`}>{t('课堂重放')}</NavLink></div>
}

function LegacySectionRedirect({ courses, suffix }: { courses: Course[]; suffix: string }) {
  const { courseId = '' } = useParams()
  const course = courses.find((item) => item.id === courseId)
  if (!course) return <NotFound />
  const sectionId = course.sections[0]?.id
  return <Navigate to={sectionId ? `/courses/${courseId}/sections/${sectionId}/${suffix}` : `/courses/${courseId}`} replace />
}

function CourseSections({ courses, setCourses, notify }: PageProps) {
  const course = useCourse(courses)
  const navigate = useNavigate()
  const live = useLive()
  const startLiveClass = useStartLiveClass(setCourses)
  if (!course) return <NotFound />
  const stats = courseStats(course)
  // No name to type: "第 3 讲 · 11月2日", renamed from the AI's notes after the first build.
  const createSectionAndOpen = () => {
    const section = { ...createSection(autoSectionTitle(course)), autoTitle: true }
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, sections: [...item.sections, section], updated: t('刚刚') } : item))
    notify(t('已新建「{title}」，上传课件后点开始构建', { title: section.title }))
    navigate(`/courses/${course.id}/sections/${section.id}`)
  }
  const deleteSection = (sectionId: string) => {
    if (live.state.sectionId === sectionId) void live.stop()
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, sections: item.sections.filter((section) => section.id !== sectionId) } : item))
    notify(t('小节已删除'))
  }
  const renameSection = (sectionId: string, currentTitle: string) => {
    const name = window.prompt(t('重命名小节'), currentTitle)
    if (!name || !name.trim() || name.trim() === currentTitle) return
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, sections: item.sections.map((section) => section.id === sectionId ? { ...section, title: name.trim(), autoTitle: false } : section) } : item))
    notify(t('小节已重命名'))
  }
  return <div className="page">
    <div className="back-row"><Link to="/"><ArrowLeft size={16} />{t('全部课程')}</Link><span>/</span><span>{course.title}</span></div>
    <PageHeader title={course.title} subtitle={courseSubtitle(course)} actions={<><button className="button secondary" onClick={createSectionAndOpen}><Plus size={17} />{t('新建小节')}</button><button className="button primary" onClick={() => startLiveClass(course)}><Mic size={17} />{t('开始上课')}</button></>} />
    <div className="overview-strip">
      <div><span>{t('小节')}</span><strong>{course.sections.length}</strong><small>{t('个独立单元')}</small></div>
      <div><span>{t('材料')}</span><strong>{stats.materials}</strong><small>{t('份课堂资料')}</small></div>
      <div><span>{t('知识点')}</span><strong>{stats.stages}</strong><small>{t('跨全部小节')}</small></div>
      <div className="overview-action"><span>{t('整体掌握')}</span><strong>{courseMastery(course)}%</strong><small>{t('各小节平均')}</small></div>
    </div>
    <section className="section-block">
      <div className="section-heading"><div><h2>{t('课程小节')}</h2><p>{t('「开始上课」会自动新建一节课并开始听课；也可以只上传课件生成笔记')}</p></div></div>
      <div className="course-grid section-grid">
        {course.sections.map((section) => <SectionCard key={section.id} courseId={course.id} section={section} live={live.state.sectionId === section.id && live.state.status !== 'idle'} onDelete={() => deleteSection(section.id)} onRename={() => renameSection(section.id, section.title)} />)}
        <button className="new-course-card live-start-card" onClick={() => startLiveClass(course)}><span><Mic size={22} /></span><strong>{t('开始上课')}</strong><small>{t('一键开始听课：实时转写、随时提问')}</small></button>
        <button className="new-course-card" onClick={createSectionAndOpen}><span><Plus size={22} /></span><strong>{t('新建小节')}</strong><small>{t('只上传课件，生成笔记')}</small></button>
      </div>
    </section>
  </div>
}

function SectionCard({ courseId, section, live, onDelete, onRename }: { courseId: string; section: Section; live: boolean; onDelete: () => void; onRename: () => void }) {
  const ready = section.status === 'ready'
  const stageCount = section.knowledgeMap?.length || section.analysis?.learning_path.length || 0
  const [menuOpen, setMenuOpen] = useState(false)
  const lines = section.transcript?.length || 0
  return <Link to={live ? `/courses/${courseId}/sections/${section.id}/live` : `/courses/${courseId}/sections/${section.id}`} className="course-card section-card">
    <div className="course-card-top">{live ? <span className="section-status live"><span className="live-dot" />{t('上课中')}</span> : <span className={`section-status ${section.status}`}>{sectionStatusLabel(section)}</span>}<div className="material-menu-wrap"><button className="icon-button tiny" aria-label={t('小节操作')} aria-expanded={menuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((value) => !value) }}><MoreHorizontal size={16} /></button>{menuOpen && <div className="material-menu" onMouseLeave={() => setMenuOpen(false)}><button onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); onRename() }}><FileText size={14} />{t('重命名')}</button><button className="delete" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); onDelete() }}><Trash2 size={14} />{t('删除小节')}</button></div>}</div></div>
    <h3>{section.title}</h3>
    <p>{section.analysis ? trimText(section.analysis.summary, 92) : lines ? t('已转写 {n} 段课堂内容，下课后可生成笔记。', { n: lines }) : t('上传文件并点击“开始构建”，生成本节的分层讲稿与题目。')}</p>
    <div className="card-divider" />
    <div className="course-footer"><div><span>{t('{materials} 份材料 · {stages} 个知识点', { materials: section.materials.length, stages: stageCount })}</span><small>{ready ? t('可开始学习') : section.status === 'building' ? t('正在构建…') : t('等待构建')}</small></div>{ready && <span className="section-go"><ArrowRight size={16} /></span>}</div>
  </Link>
}

function SectionDetail({ courses, setCourses, notify }: PageProps) {
  const { course, section } = useSection(courses)
  const live = useLive()
  const inputRef = useRef<HTMLInputElement>(null)
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
          const job = await apiFetch<any>(`/api/process/${jobId}`, { signal: controller.signal })
          if (!active) return

          updateSection(setCourses, courseId, sectionId, (current) => current.processingJob?.jobId === jobId ? {
            ...current,
            processingJob: { ...current.processingJob!, progress: job.progress || 0, stage: job.stage || 'queued', message: job.message || '', filesTotal: job.files_total, filesDone: job.files_done, currentFile: job.current_file, pagesTotal: job.pages_total, pagesDone: job.pages_done },
            materials: current.materials.map((material) => materialIds.includes(material.id) ? { ...material, progress: job.progress || 0 } : material),
          } : current)

          if (job.status === 'completed' && job.result) {
            const payload = job.result as {
              analysis: CourseAnalysis
              model: string
              documents: { filename: string; pages: number; processing: string; preview_url: string }[]
            }
            materialIds.forEach(forgetStagedFile)
            updateSection(setCourses, courseId, sectionId, (current) => current.processingJob?.jobId === jobId ? {
              ...current,
              processingJob: undefined,
              status: 'ready',
              analysis: payload.analysis,
              analysisJobId: jobId,
              knowledgeMap: payload.analysis.knowledge_map?.length ? payload.analysis.knowledge_map : undefined,
              // Auto-named sections ("第 3 讲 · 11月2日") take the AI's title once there are notes.
              title: current.autoTitle ? titleFromAnalysis(current.title, payload.analysis.title) : current.title,
              autoTitle: false,
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
                  meta: document ? t('{pages} 页 · {processing}', { pages: document.pages, processing: document.processing }) : material.meta,
                }
              }),
            } : current)
            setCourses((current) => current.map((item) => item.id === courseId ? { ...item, updated: t('刚刚'), tags: item.tags?.length ? item.tags : payload.analysis.key_concepts.slice(0, 3).map(formatConceptLabel) } : item))
            setApiError('')
            notify(t('小节构建完成，已生成分层学习内容'))
            return
          }
          if (job.status === 'failed') return failJob(t(job.error || job.message || '材料处理失败')) // i18n-ok: translated where shown
          if (job.status === 'cancelled') return failJob(t('处理任务已取消'))
          await new Promise((resolve) => window.setTimeout(resolve, 900))
        } catch (error) {
          if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
          return failJob(error instanceof Error ? error.message : t('材料处理失败'))
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
  const inputs = buildInputs(section)
  const pendingCount = section.materials.filter((material) => material.status === 'pending').length
  const canBuild = inputs.any && !inputs.uploading && !building
  const analysis = section.analysis
  const learningSteps = analysis?.learning_path.map(formatLearningStep) || []
  const conceptLabels = analysis?.key_concepts.map(formatConceptLabel) || []
  const transcriptLines = section.transcript?.length || 0
  const questionCount = section.classQuestions?.length || 0
  const liveHere = live.state.sectionId === section.id && live.state.status !== 'idle'

  const stageFiles = (files: FileList | null) => {
    if (!files?.length || building) return
    const selected = Array.from(files)
    setApiError('')
    if (inputRef.current) inputRef.current.value = ''
    void addMaterialFiles(setCourses, course.id, section.id, selected)
  }

  const openDocument = (previewUrl: string) => {
    openProtectedFile(previewUrl).catch((error) => notify(error instanceof Error ? error.message : t('打不开这个文档')))
  }

  const removeMaterial = (materialId: string) => {
    forgetStagedFile(materialId)
    updateSection(setCourses, course.id, section.id, (current) => ({ ...current, materials: current.materials.filter((material) => material.id !== materialId) }))
    setOpenMaterialMenu(null)
    notify(t('文件已移除'))
  }

  const startBuild = async () => {
    if (!inputs.any) {
      setApiError(t('没有可构建的内容：请先上传文件，或在「上课中」录下课堂转写'))
      return
    }
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setStarting(true)
    setApiError('')
    try {
      await startSectionBuild(setCourses, course, section, controller.signal)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setApiError(error instanceof Error ? error.message : t('构建启动失败'))
    } finally {
      setStarting(false)
      uploadControllerRef.current = null
    }
  }

  const cancelBuild = async () => {
    uploadControllerRef.current?.abort()
    const job = section.processingJob
    if (job?.jobId) void apiFetch(`/api/process/${job.jobId}`, { method: 'DELETE' }).catch(() => undefined)
    const ids = new Set(job?.materialIds || [])
    updateSection(setCourses, course.id, section.id, (current) => ({
      ...current,
      processingJob: undefined,
      status: current.analysis ? 'ready' : 'empty',
      materials: current.materials.map((material) => ids.has(material.id) ? { ...material, status: 'pending' as const, error: undefined } : material),
    }))
    setStarting(false)
    setApiError('')
    notify(t('已取消构建'))
  }

  const stages: [string, string][] = [
    ['uploading', t('上传文件')],
    ['rendering', t('逐页渲染')],
    ['model', t('AI 逐文件分析')],
    ['finalizing', t('整理讲稿')],
  ]
  const stageKey = processingJob?.stage ?? 'uploading'
  const activeStageIndex = stageKey === 'queued' ? 0 : stageKey === 'completed' ? stages.length : stages.findIndex(([key]) => key === stageKey)
  const progress = processingJob?.progress ?? (starting ? 5 : 0)
  const filesLine = processingJob?.filesTotal ? t('第 {i} / {n} 个文件', { i: Math.min((processingJob.filesDone || 0) + 1, processingJob.filesTotal), n: processingJob.filesTotal }) : ''
  const pagesLine = processingJob?.pagesTotal ? t('已构建 {done} / {total} 页', { done: processingJob.pagesDone || 0, total: processingJob.pagesTotal }) : (processingJob?.pagesDone ? t('已构建 {done} 页', { done: processingJob.pagesDone }) : '')
  const headline = !processingJob ? t('正在准备构建')
    : stageKey === 'rendering' ? (processingJob.currentFile ? t('正在逐页渲染 {file}', { file: processingJob.currentFile }) : t('正在逐页渲染'))
      : stageKey === 'model' ? (processingJob.filesTotal ? t('AI 正在分析 {n} 个文件和课堂转写', { n: processingJob.filesTotal }) : t('AI 正在根据课堂转写整理笔记'))
        : stageKey === 'finalizing' ? t('正在整理学习路径与关键概念') : t('已提交，等待处理')
  const elapsedSec = processingJob?.startedAt ? Math.max(0, (nowTs - processingJob.startedAt) / 1000) : 0
  const estPages = processingJob?.pagesTotal || (processingJob?.filesTotal || pendingCount || 1) * 8
  const estTotalSec = Math.max(20, estPages * 4 + 15)
  const remainingSec = Math.max(0, estTotalSec - elapsedSec)
  const buildLabel = analysis ? t('重新构建') : t('开始构建')

  return <div className="page">
    <div className="back-row"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link><span>/</span><span>{section.title}</span></div>
    <PageHeader title={section.title} subtitle={analysis ? trimText(analysis.summary, 150) : t('上课时打开「上课中」实时转写、随时提问；也可以只上传课件，点“开始构建”生成分层讲稿。')} actions={<><Link className={`button ${analysis ? 'secondary' : 'primary'}`} to={`/courses/${course.id}/sections/${section.id}/live`}><Radio size={17} />{liveHere ? t('回到课堂') : t('上课中')}</Link>{analysis && <Link className="button primary" to={`/courses/${course.id}/sections/${section.id}/replay`}><BrainCircuit size={17} />{t('开始学习')}</Link>}</>} />
    <SectionSubnav courseId={course.id} sectionId={section.id} />
    <div className="overview-strip"><div><span>{t('材料')}</span><strong>{section.materials.length}</strong><small>{t('本节文件')}</small></div><div><span>{t('课堂转写')}</span><strong>{transcriptLines}</strong><small>{t('段 · 上课中录入')}</small></div><div><span>{t('知识点')}</span><strong>{section.knowledgeMap?.length || analysis?.key_concepts.length || 0}</strong><small>{analysis ? t('来自本次构建') : t('等待构建')}</small></div><div className="overview-action"><span>{t('状态')}</span><strong>{sectionStatusLabel(section)}</strong><small>{analysis ? t('可开始学习') : t('仅处理本小节内容')}</small></div></div>
    <div className="materials-layout">
      <section className="panel material-panel">
        <div className="section-heading"><div><h2>{t('本节材料')}</h2><p>{t('支持 PDF、PPTX、DOCX、Markdown、TXT 与图片 · 上传后保存在服务器')}</p></div><div className="build-actions"><button className="button secondary" disabled={building} onClick={() => inputRef.current?.click()}><UploadCloud size={17} />{t('上传文件')}</button><button className="button primary" disabled={!canBuild} onClick={() => void startBuild()}><Sparkles size={16} />{buildLabel}</button></div></div>
        <input ref={inputRef} type="file" multiple hidden accept={ACCEPTED_FILES} onChange={(event) => stageFiles(event.target.files)} />
        <button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); stageFiles(event.dataTransfer.files) }}><span><UploadCloud size={23} /></span><strong>{t('拖入本小节的课件、笔记或板书照片')}</strong><small>{t('上传（可多份）后点“{action}”，会和课堂转写、课上提问一起整理', { action: buildLabel })}</small></button>
        {building && <div className="processing-card"><div className="processing-top"><div className="spinner" /><div><strong>{headline}</strong><span>{[filesLine].filter(Boolean).join(' · ') || t('整页视觉输入 · 不使用 OCR · 可随时取消')}</span></div><b>{Math.min(progress, 100)}%</b></div><div className="thin-progress"><span style={{ width: `${Math.min(progress, 100)}%` }} /></div><div className="build-meta"><span><Clock3 size={13} />{t('已用 {time}', { time: formatDuration(elapsedSec) })}</span><span><Clock3 size={13} />{remainingSec > 1 ? t('预计剩余 ~{time}', { time: formatDuration(remainingSec) }) : t('即将完成…')}</span>{pagesLine && <span><FileText size={13} />{pagesLine}</span>}</div><div className="processing-stages">{stages.map(([key, label], index) => <span key={key} className={index < activeStageIndex ? 'done' : index === activeStageIndex ? 'active' : ''}>{index < activeStageIndex ? <Check size={12} /> : index + 1}{label}</span>)}</div><button className="button danger compact" onClick={() => void cancelBuild()}><X size={15} />{t('取消构建')}</button></div>}
        {apiError && <div className="api-error"><CircleHelp size={18} /><div><strong>{t('构建失败')}</strong><p>{apiError}</p></div></div>}
        {analysis && <article className="analysis-result">
          <div className="analysis-result-head"><span><Sparkles size={16} /></span><div><small>{t('AI STUDY BRIEF · 本小节已构建')}</small><h3>{analysis.title}</h3></div><Link className="button primary compact analysis-action" to={`/courses/${course.id}/sections/${section.id}/replay`}>{t('按路线学习')} <ArrowRight size={14} /></Link></div>
          <div className="analysis-study-grid">
            <section className="analysis-summary-block"><span className="analysis-label"><BookOpen size={14} />{t('本节摘要')}</span><p className={analysisExpanded ? 'expanded' : ''}>{analysis.summary}</p>{analysis.summary.length > 180 && <button className="analysis-toggle" onClick={() => setAnalysisExpanded((value) => !value)}>{analysisExpanded ? t('收起摘要') : t('展开完整摘要')} <ChevronDown size={13} /></button>}</section>
            <section className="analysis-route-block"><span className="analysis-label"><Network size={14} />{t('推荐学习路线')}</span><div className="analysis-path">{learningSteps.map((step, index) => <div key={`${step.title}-${index}`}><i>{index + 1}</i><span><strong>{step.title}</strong>{step.detail && <small>{step.detail}</small>}</span></div>)}</div></section>
          </div>
          {conceptLabels.length > 0 && <div className="analysis-concept-block"><span className="analysis-label"><Lightbulb size={14} />{t('核心概念')}</span><div className="analysis-concepts">{conceptLabels.map((concept, index) => <span title={analysis.key_concepts[index]} key={`${concept}-${index}`}>{concept}</span>)}</div></div>}
        </article>}
        <div className="file-list">
          {section.materials.length === 0 && <div className="empty-hint">{t('本小节还没有文件。点击上方“上传文件”添加课件，或在「上课中」边听课边录。')}</div>}
          {section.materials.map((material) => <div className="file-row" key={material.id}>
            <span className={`file-type ${material.type.toLowerCase()}`}><FileText size={18} /></span>
            <div className="file-info"><strong>{material.name}</strong><span title={material.error}>{material.error || material.meta}</span></div>
            {material.previewUrl && <button className="file-preview-link" onClick={() => openDocument(material.previewUrl!)}>{t('查看文档')}</button>}
            <div className={`status ${material.status}`}>{material.status === 'ready' ? <><CheckCircle2 size={15} />{t('已就绪')}</> : material.status === 'failed' ? <><X size={14} />{t('失败')}</> : material.status === 'cancelled' ? <><X size={14} />{t('已取消')}</> : material.status === 'pending' ? <><Clock3 size={14} />{t('待构建')}</> : material.status === 'uploading' ? <><RefreshCw className="spin-icon" size={14} />{t('上传中')}</> : <><RefreshCw size={14} />{t('构建中')}{material.progress ? ` · ${material.progress}%` : ''}</>}</div>
            <div className="material-menu-wrap">
              <button className="icon-button tiny" aria-label={t('{name} 操作', { name: material.name })} aria-expanded={openMaterialMenu === material.id} onClick={() => setOpenMaterialMenu((current) => current === material.id ? null : material.id)}><MoreHorizontal size={17} /></button>
              {openMaterialMenu === material.id && <div className="material-menu">
                {material.previewUrl && <button onClick={() => { setOpenMaterialMenu(null); openDocument(material.previewUrl!) }}><FileText size={14} />{t('查看文档')}</button>}
                <button className="delete" onClick={() => removeMaterial(material.id)} disabled={building && material.status === 'processing'}><Trash2 size={14} />{t('移除文件')}</button>
              </div>}
            </div>
          </div>)}
        </div>
      </section>
      <aside className="right-stack">
        <section className="panel knowledge-preview"><div className="panel-kicker"><Network size={16} />{t('本节讲稿')}</div><h3>{analysis ? t('{nodes} 个知识节点 · {concepts} 个概念', { nodes: section.knowledgeMap?.length || learningSteps.length, concepts: conceptLabels.length }) : t('等待构建')}</h3><div className="mini-tree"><span className="tree-root">{analysis?.title || section.title}</span><i /><div>{(learningSteps.slice(0, 3).map((step) => step.title).length ? learningSteps.slice(0, 3).map((step) => step.title) : [t('上传文件'), t('开始构建'), t('开始学习')]).map((step, index) => <span title={analysis?.learning_path[index]} key={`${step}-${index}`} className={index === 0 && analysis ? 'active' : ''}>{step}</span>)}</div></div>{analysis ? <Link to={`/courses/${course.id}/sections/${section.id}/replay`} className="text-link">{t('查看完整讲稿')} <ArrowRight size={15} /></Link> : <span className="text-link muted">{t('构建后可查看')}</span>}</section>
        <section className="panel knowledge-preview class-note-panel"><div className="panel-kicker"><MessageCircleQuestion size={16} />{t('上课记录')}</div><h3>{transcriptLines || questionCount ? t('{lines} 段转写 · {questions} 个提问', { lines: transcriptLines, questions: questionCount }) : t('上课时打开「上课中」')}</h3><p>{transcriptLines || questionCount ? t('构建时会把课堂转写和课上提问一起交给 AI，整理进笔记。') : t('实时把老师讲的话转成文字，听不懂随时问；下课一键生成笔记。')}</p><Link to={`/courses/${course.id}/sections/${section.id}/live`} className="text-link">{liveHere ? t('回到课堂') : t('进入上课中')} <ArrowRight size={15} /></Link></section>
        <section className="panel provider-note"><div className="provider-top"><span className="online-dot" />{t('逐文件构建 · 内容隔离')}</div><p>{t('每个小节只处理自己的文件、课堂转写和提问，构建结果（讲稿、题目、聊天）不会与其它小节混用。图片与文档页面交给视觉模型。')}</p><Link to="/settings">{t('查看配置')}</Link></section>
      </aside>
    </div>
  </div>
}

function Replay({ courses, setCourses, notify }: PageProps) {
  const lang = useLang()
  const { courseId = '', sectionId = '' } = useParams()
  const location = useLocation()
  const course = courses.find((item) => item.id === courseId)
  const section = course?.sections.find((item) => item.id === sectionId)
  // 下课 lands here focused on the in-class notes.
  const [selected, setSelected] = useState(() => (location.state as { focus?: string } | null)?.focus || '')
  const [answer, setAnswer] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [mastery, setMastery] = useState(() => loadMastery(sectionId, section?.mastery ?? 0))
  const [chat, setChat] = useState('')
  const [asking, setAsking] = useState(false)
  const kmNodes = useMemo<KnowledgeNode[]>(() => {
    if (section?.knowledgeMap?.length) return section.knowledgeMap
    if (section?.analysis?.learning_path.length) return deriveKnowledgeMap(section.analysis)
    return knowledgeNodes.map((node) => ({ id: node.id, title: t(node.title), tier: 'core' as KnowledgeTier, summary: t(node.eyebrow), content: `## ${t(node.title)}\n\n${t('上传并构建本小节材料后，这里会生成结构化的学习内容。')}` }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.knowledgeMap, section?.analysis, lang])
  const orderedNodes = useMemo(() => TIER_ORDER.flatMap((tier) => kmNodes.filter((node) => node.tier === tier)), [kmNodes])
  const grouped = useMemo(() => TIER_ORDER.map((tier) => ({ tier, nodes: kmNodes.filter((node) => node.tier === tier) })).filter((group) => group.nodes.length), [kmNodes])
  const explorationNodes = section?.explorationNodes || []
  const chatHistory = section?.chatHistory || []
  const classQuestions = section?.classQuestions || []
  const transcript = section?.transcript || []
  const hasClassGroup = classQuestions.length > 0 || transcript.length > 0
  const isClassNode = (id: string) => id === CLASS_NOTES_ID ? classQuestions.length > 0 : id === TRANSCRIPT_NODE_ID ? transcript.length > 0 : classQuestions.some((item) => classNodeId(item) === id)

  useEffect(() => {
    // After 下课 with no questions, open the transcript instead of an empty note.
    if (selected === CLASS_NOTES_ID && !classQuestions.length && transcript.length) { setSelected(TRANSCRIPT_NODE_ID); return }
    if (orderedNodes.length && !orderedNodes.some((node) => node.id === selected) && !explorationNodes.some((node) => node.id === selected) && !isClassNode(selected)) {
      setSelected(orderedNodes[0].id)
    }
  })

  // The 课上提问 group sits below the knowledge path; bring it into view when it's selected (e.g. right after 下课).
  useEffect(() => {
    if (!selected.startsWith('class-')) return
    const list = document.querySelector('.tier-scroll')
    const node = list?.querySelector('.tier-class .active')
    if (!list || !node) return
    const box = list.getBoundingClientRect()
    const target = node.getBoundingClientRect()
    if (target.top < box.top || target.bottom > box.bottom) list.scrollTop += target.top - box.top - 24
  }, [selected])

  if (!course || !section) return <NotFound />

  const activeIndex = orderedNodes.findIndex((node) => node.id === selected)
  const activeKnowledge = kmNodes.find((node) => node.id === selected)
  const activeExploration = explorationNodes.find((node) => node.id === selected)
  const activeClassQuestion = classQuestions.find((item) => classNodeId(item) === selected)
  const showClassNotes = selected === CLASS_NOTES_ID && classQuestions.length > 0
  const showTranscript = selected === TRANSCRIPT_NODE_ID && transcript.length > 0
  const explorationAnswer = activeExploration ? (chatHistory.find((message) => message.role === 'assistant' && message.nodeId === activeExploration.id)?.content || '') : ''
  const activeContent = activeKnowledge ? activeKnowledge.content
    : activeExploration ? `## ${activeExploration.title}\n\n> ❓ ${normalizeMarkdown(activeExploration.question)}\n\n${explorationAnswer ? normalizeMarkdown(explorationAnswer) : `_${t('正在生成回答…')}_`}`
    : showClassNotes ? classNotesMarkdown(section)
    : showTranscript ? transcriptMarkdown(section)
    : activeClassQuestion ? classQuestionMarkdown(activeClassQuestion, section)
    : (orderedNodes[0]?.content || `## ${t('等待材料分析')}\n\n${t('上传课件后将在这里生成结构化的学习内容。')}`)
  const classTitle = showClassNotes ? t('课堂提问笔记') : showTranscript ? t('课堂转写') : activeClassQuestion ? trimText(activeClassQuestion.question, 28) : ''
  const currentTitle = activeKnowledge?.title || activeExploration?.title || classTitle || orderedNodes[Math.max(activeIndex, 0)]?.title || section.analysis?.title || section.title
  const activeTier = activeKnowledge?.tier || (classTitle ? 'class' : undefined)
  const tierLabel = activeKnowledge ? t(TIER_META[activeKnowledge.tier].label) : activeExploration ? t('探索支线') : classTitle ? t('上课记录') : t('知识节点')
  const tierEyebrow = activeKnowledge ? t(TIER_META[activeKnowledge.tier].eyebrow) : classTitle ? t('IN-CLASS · 上课中') : 'EXPLORATION'
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
      const payload = await apiFetch<any>('/api/study/ask', {
        ai: true,
        json: {
          question,
          course_title: `${course.title} · ${section.title}`,
          current_topic: currentTitle,
          summary: section.analysis?.summary || course.description,
          learning_path: section.analysis?.learning_path || kmNodes.map((node) => node.title),
          key_concepts: section.analysis?.key_concepts || course.tags,
          existing_nodes: [...kmNodes.map((node) => node.title), ...explorationNodes.map((node) => node.title)],
        },
      })
      const nodeId = payload.add_node && payload.node_title ? `branch-${Date.now()}` : undefined
      updateSection(setCourses, course.id, section.id, (current) => ({
        ...current,
        explorationNodes: nodeId ? [...(current.explorationNodes || []), { id: nodeId, title: formatConceptLabel(payload.node_title), parentId, question }] : current.explorationNodes,
        chatHistory: [...(current.chatHistory || []), { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: payload.answer || t('我暂时无法回答这个问题。'), nodeId }],
      }))
      if (nodeId) {
        setSelected(nodeId)
        notify(t('拓扑图已新增：{title}', { title: formatConceptLabel(payload.node_title) }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('AI 回答失败')
      updateSection(setCourses, course.id, section.id, (current) => ({
        ...current,
        chatHistory: [...(current.chatHistory || []), { id: `message-${Date.now()}-assistant`, role: 'assistant' as const, content: message }],
      }))
    } finally {
      setAsking(false)
    }
  }
  const demoOptions: [string, string][] = [['A', t('它们在图形位置上最近')], ['B', t('格雷码顺序使它们仅有一位变量不同')], ['C', t('所有边界上的格子都彼此相邻')], ['D', t('这是为了让化简结果更短')]]
  return <div className="replay-page">
    <div className="replay-topbar"><Link to={`/courses/${course.id}/sections/${section.id}`}><ArrowLeft size={16} />{section.title}</Link><div className="replay-location"><span>{course.title}</span><ChevronRight size={14} /><strong>{currentTitle}</strong></div><div className="replay-actions"><span className="saved"><Check size={14} />{t('分析与进度已保存')}</span><button className="icon-button" aria-label={t('收起侧栏')}><PanelLeftClose size={18} /></button></div></div>
    <div className="replay-grid">
      <aside className="path-column">
        <div className="path-head"><span className="eyebrow">LIVE KNOWLEDGE MAP</span><h2>{t('课程知识拓扑')}</h2><div><span>{t('{n} 个知识节点', { n: kmNodes.length })}</span><span>{t('{n} 条探索支线', { n: explorationNodes.length })}</span></div><div className="thin-progress"><span style={{ width: `${progressPct}%` }} /></div></div>
        <div className="tier-scroll">
          {grouped.map((group) => <section className={`tier-group tier-${group.tier}`} key={group.tier}>
            <header className="tier-label"><span className="tier-dot" /><div><small>{t(TIER_META[group.tier].eyebrow)}</small><strong>{t(TIER_META[group.tier].label)}</strong></div><span className="tier-count">{group.nodes.length}</span></header>
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
          {hasClassGroup && <section className="tier-group tier-class">
            <header className="tier-label"><span className="tier-dot" /><div><small>{t('IN-CLASS · 上课中')}</small><strong>{t('上课记录')}</strong></div><span className="tier-count">{classQuestions.length + (transcript.length ? 1 : 0)}</span></header>
            <div className="tier-nodes"><div className="tier-node-wrap">
              {transcript.length > 0 && <button className={`km-node ${showTranscript ? 'active' : ''}`} onClick={() => setSelected(TRANSCRIPT_NODE_ID)}>
                <span className="km-step"><Mic size={13} /></span>
                <span className="km-text"><strong>{t('课堂转写')}</strong><small>{t('{n} 段{start}', { n: transcript.length, start: section.liveStartedAt ? ` · ${t('{time} 开始', { time: formatClock(section.liveStartedAt) })}` : '' })}</small></span>
              </button>}
              {classQuestions.length > 0 && <button className={`km-node ${showClassNotes ? 'active' : ''}`} onClick={() => setSelected(CLASS_NOTES_ID)}>
                <span className="km-step"><NotebookPen size={13} /></span>
                <span className="km-text"><strong>{t('课堂提问笔记')}</strong><small>{t('{n} 个问题', { n: classQuestions.length })}</small></span>
              </button>}
              {classQuestions.map((item) => <button key={item.id} className={`km-branch class-branch ${selected === classNodeId(item) ? 'active' : ''}`} onClick={() => setSelected(classNodeId(item))}><MessageCircleQuestion size={12} /><span>{item.question}</span></button>)}
            </div></div>
          </section>}
          {asking && <div className="km-pending"><span className="mini-spinner" />{t('正在判断是否扩展支线…')}</div>}
        </div>
        <div className="topology-legend"><span><i className="t-prereq" />{t('前置')}</span><span><i className="t-core" />{t('核心')}</span><span><i className="t-advanced" />{t('进阶')}</span><span><i className="t-branch" />{t('问答支线')}</span>{hasClassGroup && <span><i className="t-class" />{t('上课记录')}</span>}</div>
        <div className="path-tip"><Lightbulb size={16} /><p>{t('内容按「前置 → 核心 → 进阶」分层。点击节点切换学习焦点，向 AI 提问会自动长出探索支线。')}</p></div>
      </aside>

      <section className="content-column">
        <div className="content-toolbar"><div><span className={`tier-badge tier-${activeTier || 'branch'}`}>{tierLabel}</span><strong>{currentTitle}</strong></div><span>{section.materials[0]?.name || (section.analysis ? t('已完成构建') : t('等待构建'))}</span></div>
        <div className="reading-stage">
          <article className="reading-paper">
            <div className="reading-index"><span>{classTitle ? 'Q' : String(Math.max(activeIndex, 0) + 1).padStart(2, '0')}</span><em>{tierEyebrow} · {classTitle ? t('课后笔记') : t('学习路径')}</em></div>
            <Markdown>{activeContent}</Markdown>
          </article>
        </div>
        <div className="source-strip"><LinkIcon size={15} /><span>{t('材料依据')}</span>{section.materials.length ? section.materials.map((material) => <button key={material.id} onClick={() => notify(t('材料：{name}', { name: material.name }))}>{material.name}</button>) : <button onClick={() => notify(t('请先返回小节上传并完成构建'))}>{t('暂无关联材料')}</button>}</div>
        <div className="content-nav"><button className="button ghost" onClick={() => activeIndex > 0 && setSelected(orderedNodes[activeIndex - 1].id)} disabled={activeIndex <= 0}><ArrowLeft size={16} />{t('上一步')}</button><span>{t('步骤 {i} / {n}', { i: Math.max(activeIndex + 1, 1), n: orderedNodes.length })}</span><button className="button dark" onClick={() => activeIndex > -1 && activeIndex < orderedNodes.length - 1 && setSelected(orderedNodes[activeIndex + 1].id)} disabled={activeIndex < 0 || activeIndex >= orderedNodes.length - 1}>{t('继续：{title}', { title: orderedNodes[activeIndex + 1]?.title || t('已到终点') })} <ArrowRight size={16} /></button></div>
      </section>

      <aside className="ai-column">
        <div className="ai-head"><div><span className="ai-avatar"><Bot size={19} /></span><div><strong>{t('AI 讲师')}</strong><small><span className="online-dot" />{t('基于本小节 {n} 份材料', { n: section.materials.filter((item) => item.status === 'ready').length })}</small></div></div><button className="icon-button tiny" aria-label={t('更多')}><MoreHorizontal size={17} /></button></div>
        <div className="chat-scroll">
          <div className="ai-message">{section.analysis ? <Markdown className="on-dark">{normalizeMarkdown(trimText(section.analysis.summary, 320))}</Markdown> : <p>{t('观察这个卡诺图。橙色圈跨过了左右边界——因为卡诺图的列按 00、01、11、10 排列，首尾依然只相差一个变量。')}</p>}<div className="citation-row">{section.materials.slice(0, 2).map((material, index) => <button key={material.id}>[{index + 1}] {material.name}</button>)}</div></div>
          <div className="ai-message question-card"><span className="question-type">{t('理解检验')} · {generatedQuestion ? t('基于材料') : t('单选题')}</span><div className="q-text"><Markdown className="on-dark">{normalizeMarkdown(generatedQuestion || t('为什么卡诺图中最左列与最右列可以视为相邻？'))}</Markdown></div>{generatedQuestion ? <textarea className="review-answer" value={answer || ''} disabled={submitted} onChange={(event) => setAnswer(event.target.value)} placeholder={t('根据刚才看到的材料写下你的理解…')} /> : <div className="answer-list">
            {demoOptions.map(([key, value]) => <button key={key} disabled={submitted} onClick={() => setAnswer(key)} className={`${answer === key ? 'selected' : ''} ${submitted && key === 'B' ? 'correct' : ''} ${submitted && answer === key && key !== 'B' ? 'wrong' : ''}`}><span>{key}</span>{value}{submitted && key === 'B' && <CheckCircle2 size={16} />}</button>)}
          </div>}<button className="button primary full" disabled={!answer?.trim() || submitted} onClick={submitAnswer}>{submitted ? t('回答已保存') : t('提交回答')}</button></div>
          {submitted && <div className="feedback-card"><div className="feedback-title"><CheckCircle2 size={18} /><strong>{generatedQuestion ? t('回答已记录到当前学习进度') : answer === 'B' ? t('回答正确，而且理由匹配') : t('再看一下格雷码的排列规则')}</strong><span>{generatedQuestion ? '+5%' : answer === 'B' ? '+15%' : '-8%'}</span></div><p>{generatedQuestion ? t('这是根据你上传材料生成的开放题；可以继续向 AI 讲师追问并补充答案。') : answer === 'B' ? t('这说明你理解了“逻辑相邻”而不是根据图形位置猜测。') : t('边界相邻的关键不是物理距离，而是只有一位变量发生变化。')}</p><div className="mastery-change"><span>{t('本知识点掌握度')}</span><div><i style={{ width: `${mastery}%` }} /></div><strong>{mastery}%</strong></div><div className="feedback-actions"><button onClick={() => setChat(t('为什么“{title}”是这样？', { title: currentTitle }))}>{t('为什么？深入解释')}</button><button onClick={() => setChat(t('学习“{title}”前需要补什么基础？', { title: currentTitle }))}>{t('补充前置知识')}</button></div></div>}
          {chatHistory.map((message) => message.role === 'user' ? <div className="user-message" key={message.id}>{message.content}</div> : <div className="ai-message compact-message" key={message.id}><Markdown className="on-dark">{normalizeMarkdown(message.content)}</Markdown>{message.nodeId && <button className="topology-jump" onClick={() => setSelected(message.nodeId!)}><GitBranchIcon />{t('已加入拓扑图 · 点击定位')}</button>}</div>)}
          {asking && <div className="ai-message compact-message thinking-message"><span className="mini-spinner" /><p>{t('正在结合当前节点判断是否需要扩展知识拓扑…')}</p></div>}
        </div>
        <div className="ask-box"><div className="quick-prompts"><button onClick={() => setChat(t('换一个类比解释“{title}”', { title: currentTitle }))}>{t('换个类比')}</button><button onClick={() => setChat(t('基于“{title}”给我一道变式题', { title: currentTitle }))}>{t('来道变式')}</button><button onClick={() => setChat(t('学习“{title}”前需要补什么基础？', { title: currentTitle }))}>{t('探索前置知识')}</button></div><div className="ask-input"><textarea value={chat} disabled={asking} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask() } }} placeholder={t('针对当前节点追问；必要时会自动扩展左侧拓扑…')} /><button onClick={() => void ask()} disabled={!chat.trim() || asking} aria-label={t('发送')}>{asking ? <RefreshCw className="spin-icon" size={16} /> : <Send size={17} />}</button></div><small>{t('AI 会判断问题是否值得成为新的知识节点')}</small></div>
      </aside>
    </div>
  </div>
}

function GitBranchIcon() { return <Network size={14} /> }

// ---------------------------------------------------------------------------
// Not routed: 复习工坊 / 我的学习 were taken out of the UI; kept for later.
// (Excluded from the i18n check until they're brought back.)
// ---------------------------------------------------------------------------

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

export default App
