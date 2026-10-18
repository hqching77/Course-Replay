import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, FileText, FolderOpen, GraduationCap, LayoutGrid, List, Monitor, Pencil, Plus, RotateCcw, Search, Settings2, Sparkles, Trash2, WifiOff, X } from 'lucide-react';
import CourseDialog from './CourseDialog';
import { readCourses, saveCourses, type Course, type CourseInput } from './courses';

function loadInitial() {
  try { return { courses: readCourses(), error: '' }; }
  catch { return { courses: [] as Course[], error: '无法读取本地课程，原有数据未改动。请检查浏览器存储后重试。' }; }
}
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)); }

export default function App() {
  const [initial] = useState(loadInitial);
  const [courses, setCourses] = useState<Course[]>(initial.courses);
  const [storageError, setStorageError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Course | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Course | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('grid');
  const navigate = useNavigate();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (deleting) deleteDialog.current?.showModal(); }, [deleting]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  const filtered = useMemo(() => courses.filter(course => `${course.name} ${course.description} ${course.tags.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.updatedAt.localeCompare(a.updatedAt)), [courses, query, sort]);
  function persist(next: Course[]) {
    if (storageError) return false;
    try { saveCourses(next); setCourses(next); return true; } catch { setNotice('保存失败：浏览器存储不可用或空间不足。'); return false; }
  }
  function submit(input: CourseInput) {
    const now = new Date().toISOString();
    const next = editor && editor !== 'new' ? courses.map(course => course.id === editor.id ? { ...course, ...input, updatedAt: now } : course) : [{ ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }, ...courses];
    if (!persist(next)) return false;
    setNotice(editor === 'new' ? '课程已保存在此浏览器' : '课程已更新'); setEditor(null); return true;
  }
  function retryStorage() { const next = loadInitial(); setCourses(next.courses); setStorageError(next.error); }
  return <div className="app-shell">
    <aside className="sidebar">
      <Link to="/" className="brand" aria-label="Course Replay 首页"><span className="brand-mark"><RotateCcw size={23} /></span><span>Course<span className="brand-second">Replay</span></span></Link>
      <div className="workspace-label"><span className="workspace-avatar"><GraduationCap size={18} /></span><div>个人学习空间<small>LOCAL WORKSPACE</small></div></div>
      <span className="nav-label">学习空间</span>
      <nav aria-label="主导航"><NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><BookOpen size={19} /><span>我的课程</span><span className="nav-count">{courses.length}</span></NavLink><button className="nav-item" disabled title="学习记录将在课堂重放接入后开放"><Clock3 size={19} /><span>学习记录</span><small>待开放</small></button><button className="nav-item" disabled title="复习中心将在后续阶段开放"><FileText size={19} /><span>复习中心</span><small>待开放</small></button></nav>
      <div className="sidebar-foot"><div className="sync-state"><span className="status-dot" />本地工作空间<small>课程仅保存在此浏览器</small></div><NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Settings2 size={18} />连接状态</NavLink><div className="profile"><span className="profile-avatar"><GraduationCap size={19} /></span><div>我的学习空间<small>每一步，都更理解一点</small></div></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">学习空间<ChevronRight size={14} /><span>Course Replay</span></div><span className="local-indicator"><Monitor size={14} />本地预览</span></header>
      <main id="main-content">
        {storageError && <div className="error-banner" role="alert">{storageError}<button className="button secondary" onClick={retryStorage}>重试读取</button></div>}
        <Routes>
          <Route path="/" element={<><div className="page-heading"><div><span className="eyebrow">YOUR LEARNING, CONTINUED</span><h1>我的课程<span className="heading-dot">.</span></h1><p>把课堂上的每一个问号，变成真正的理解。</p></div><button className="button primary" disabled={!!storageError} onClick={() => setEditor('new')}><Plus size={18} />新建课程</button></div>
            <section className="stats" aria-label="学习概览"><div className="stat"><span className="stat-icon green"><BookOpen size={20} /></span><div><span>全部课程</span><strong>{courses.length}<small>门</small></strong></div></div><div className="stat"><span className="stat-icon blue"><FolderOpen size={20} /></span><div><span>课程材料</span><strong>—<small>尚未接入</small></strong></div></div><div className="stat"><span className="stat-icon rose"><Sparkles size={20} /></span><div><span>总体掌握度</span><strong>—<small>暂无学习数据</small></strong></div></div></section>
            <section className="course-section" aria-labelledby="courses-title"><div className="section-heading"><h2 id="courses-title">课程库 <span>{courses.length}</span></h2><span className="section-caption">从这里，接着学</span></div><div className="toolbar"><label className="search-field"><Search size={18} /><input aria-label="搜索课程" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索课程名称、标签…" />{query && <button className="icon-button small" aria-label="清除搜索" title="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label><div className="toolbar-end"><label className="sort-control"><ArrowDownWideNarrow size={17} /><select aria-label="课程排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最近更新</option><option value="name">名称排序</option></select></label><div className="view-toggle" role="group" aria-label="显示方式"><button title="网格视图" aria-label="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={17} /></button><button title="列表视图" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18} /></button></div></div></div>
              {filtered.length ? <div className={`course-grid ${view === 'list' ? 'list-view' : ''}`}>{filtered.map(course => <article className="course-card" key={course.id}><div className={`course-cover ${course.color}`}><BookOpen size={31} strokeWidth={1.5} /><span className="cover-label">COURSE NOTES</span><span className="cover-monogram">{course.name.slice(0, 2)}</span></div><div className="course-card-body"><div className="course-title-row"><Link className="course-title" to={`/courses/${course.id}`}>{course.name}</Link><button className="icon-button" aria-label={`编辑 ${course.name}`} title="编辑课程" onClick={() => setEditor(course)}><Pencil size={15} /></button></div><p className="course-description">{course.description || '还没有课程简介'}</p><div className="tags">{course.tags.length ? course.tags.map(tag => <span key={tag}>{tag}</span>) : <span className="muted-tag">未添加标签</span>}</div><div className="course-card-footer"><span><Clock3 size={13} />{formatDate(course.updatedAt)}更新</span><Link to={`/courses/${course.id}`} aria-label={`打开 ${course.name}`} title="打开课程"><ArrowRight size={18} /></Link></div></div></article>)}</div> : <div className="empty-state"><div className="empty-art" aria-hidden="true"><div className="paper paper-back" /><div className="paper paper-front"><BookOpen size={34} strokeWidth={1.3} /><span /><span /><span /></div><span className="art-badge"><Plus size={20} /></span></div><h3>{query ? '没有找到匹配的课程' : '你的下一次理解，从这里开始'}</h3><p>{query ? '换个关键词，或试试课程标签。' : '先为正在学习的课程，留一个专属空间。'}</p>{query ? <button className="button secondary" onClick={() => setQuery('')}>清除搜索</button> : <button className="button primary" disabled={!!storageError} onClick={() => setEditor('new')}><Plus size={17} />创建第一门课程</button>}<span className="empty-footnote">{query ? `${courses.length} 门课程已保存在本地` : '从一门课、一个知识点开始'}</span></div>}
            </section><footer className="page-footer"><span>COURSE REPLAY</span><span>让知识有迹可循，让理解循序发生。</span></footer></>} />
          <Route path="/courses/:courseId" element={<CourseDetail courses={courses} onEdit={setEditor} onDelete={setDeleting} />} />
          <Route path="/settings" element={<><div className="page-heading"><div><span className="eyebrow">CONNECTION</span><h1>连接状态</h1><p>当前运行环境与数据保存位置。</p></div></div><div className="connection-row"><Monitor size={24} /><div><h2>本地课程管理</h2><p>课程名称、简介和标签保存在此浏览器。清除浏览器数据会删除这些课程。</p></div><span className="badge green">已启用</span></div><div className="connection-row"><WifiOff size={24} /><div><h2>后端与 AI 服务</h2><p>尚未连接。材料解析、课堂重放和学习记录暂不可用。</p></div><span className="badge amber">未连接</span></div></>} />
          <Route path="*" element={<div className="empty-state"><CircleHelp size={40} /><h1>页面不存在</h1><Link className="button primary" to="/">返回课程库</Link></div>} />
        </Routes>
      </main>
    </div>
    {editor && <CourseDialog course={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSave={submit} />}
    {deleting && <dialog className="course-dialog delete-dialog" ref={deleteDialog} aria-labelledby="delete-title" onCancel={() => setDeleting(null)}><h2 id="delete-title">删除这门课程？</h2><p>“{deleting.name}”的本地课程信息将被永久删除。</p><div className="dialog-footer"><button className="button secondary" autoFocus onClick={() => setDeleting(null)}>取消</button><button className="button danger" onClick={() => { if (persist(courses.filter(course => course.id !== deleting.id))) { setDeleting(null); setNotice('课程已删除'); navigate('/'); } }}>确认删除</button></div></dialog>}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
  </div>;
}

function CourseDetail({ courses, onEdit, onDelete }: { courses: Course[]; onEdit: (course: Course) => void; onDelete: (course: Course) => void }) {
  const { courseId } = useParams();
  const course = courses.find(item => item.id === courseId);
  if (!course) return <div className="empty-state"><BookOpen size={42} /><h1>找不到这门课程</h1><p>课程可能已删除，或保存在另一个浏览器中。</p><Link to="/" className="button secondary">返回课程库</Link></div>;
  return <><Link className="back-link" to="/"><ArrowLeft size={16} />我的课程</Link><div className="page-heading detail-heading"><div><span className="eyebrow">COURSE WORKSPACE</span><h1>{course.name}</h1><p>{course.description || '还没有课程简介'}</p></div><div className="detail-actions"><button className="button secondary" onClick={() => onEdit(course)}><Pencil size={16} />编辑</button><button className="icon-button delete-action" title="删除课程" aria-label="删除课程" onClick={() => onDelete(course)}><Trash2 size={18} /></button></div></div><div className="tags">{course.tags.map(tag => <span key={tag}>{tag}</span>)}</div><div className="detail-meta"><span className="badge green">本地课程</span><span>创建于 {formatDate(course.createdAt)}</span></div><section className="materials-section"><div className="section-heading"><h2>课程材料</h2><span className="badge amber">等待服务接入</span></div><div className="empty-state compact"><FolderOpen size={42} strokeWidth={1.3} /><h3>这里将收纳你的课堂资料</h3><p>材料上传与解析尚未接入，当前课程信息已在本地保存。</p><Link to="/settings" className="button secondary">查看连接状态<ArrowRight size={16} /></Link></div></section></>;
}
