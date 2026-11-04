import { ArrowLeft, BookOpen, Bot, Camera, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Cloud, Eye, FileText, FileUp, Flag, Folder, Lightbulb, ListChecks, MessageCircleQuestion, PenLine, Plus, RefreshCw, Smartphone, Sparkles, Trash2, X } from 'lucide-react'
import QRCode from 'qrcode'
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CloudListing, HomeworkCheck, cloudApi, filesApi, homeworkApi, protectedBlobUrl } from './api'
import { Course } from './data'
import { recordAnswer } from './exam'
import { HwImage, HwItem, HwStep, createItem, historyOf, homeworkContext, itemStatus, itemTitle, lastCheck, newId, shrinkImage, statusLabel, titleFor, topicOf, useHomework } from './homework'
import { t, useLang } from './i18n'
import { Markdown, NotFound, PageHeader } from './ui'
import { updateCourse } from './WeakPanel'
import { kindLabel } from './weak'

type SetCourses = Dispatch<SetStateAction<Course[]>>
type Props = { courses: Course[]; setCourses: SetCourses; notify: (message: string) => void; account: boolean }
type Store = ReturnType<typeof useHomework>
type Draft = { text: string; images: HwImage[] }
type Update = (change: (item: HwItem) => HwItem, debounce?: number) => Promise<void>

const LAST_COURSE = 'course-replay-homework-course'
const CLOUD_LINK = 'course-replay-cloud-link'
const EMPTY: Draft = { text: '', images: [] }
/** Student working is written one step per line; keep those line breaks (but leave $$…$$ blocks alone). */
const keepLines = (text: string) => text.split(/(\$\$[\s\S]*?\$\$)/).map((part) => part.startsWith('$$') ? part : part.replace(/([^\n])\n(?!\n)/g, '$1  \n')).join('')
const verdictText = (verdict: HomeworkCheck['verdict']) => ({ correct: t('正确'), partial: t('部分正确'), wrong: t('错误') }[verdict])
const isPicture = (name: string) => /\.(pdf|png|jpe?g|webp|heic|heif)$/i.test(name)
const isUploadable = (file: File) => file.type.startsWith('image/') || file.type === 'application/pdf' || /\.(pdf|png|jpe?g|webp|heic|heif)$/i.test(file.name)
const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** /homework: open 题目答疑 for the course used last (or the first one). */
export function HomeworkHome({ courses }: { courses: Course[] }) {
  useLang()
  let last = ''
  try { last = localStorage.getItem(LAST_COURSE) || '' } catch { /* ignore */ }
  const course = courses.find((item) => item.id === last) || courses[0]
  if (!course) return <div className="page"><PageHeader title={t('题目答疑')} subtitle={t('先创建一门课程，再把作业题交到这门课里。')} /></div>
  return <Navigate to={`/courses/${course.id}/homework`} replace />
}

// ---------------------------------------------------------------------------
// Pictures and files
// ---------------------------------------------------------------------------

function PageImage({ uploadId, page = 1, width = 900, alt }: { uploadId: string; page?: number; width?: number; alt: string }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let created = ''
    setUrl('')
    setFailed(false)
    protectedBlobUrl(homeworkApi.pagePath(uploadId, page, width), controller.signal)
      .then((value) => { created = value; setUrl(value) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort(); if (created) URL.revokeObjectURL(created) }
  }, [uploadId, page, width])
  return url ? <img src={url} alt={alt} /> : failed ? <span className="hw-image-missing">{t('无法显示')}</span> : <span className="hw-image-loading"><span className="mini-spinner" /></span>
}

function ImageViewer({ image, onClose }: { image: HwImage; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, image.pages || 1)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') setPage((value) => Math.max(1, value - 1))
      if (event.key === 'ArrowRight') setPage((value) => Math.min(pages, value + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pages])
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal import-preview" role="dialog" aria-label={image.name} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">{t('原图')}</span><h2>{image.name}</h2></div><button type="button" className="icon-button" aria-label={t('关闭')} onClick={onClose}><X size={18} /></button></div>
      <div className="import-preview-page"><PageImage uploadId={image.id} page={page} width={1200} alt={image.name} /></div>
      {pages > 1 && <div className="import-preview-nav">
        <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} />{t('上一页')}</button>
        <span>{t('第 {page} / {pages} 页', { page, pages })}</span>
        <button type="button" className="button secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('下一页')}<ChevronRight size={16} /></button>
      </div>}
    </div>
  </div>
}

/** Small thumbnails (a message's pictures); files that aren't pictures show as a name. */
function ImageStrip({ images, onRemove }: { images: HwImage[]; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState<HwImage | null>(null)
  if (!images.length) return null
  return <div className="hw-images">
    {images.map((image) => <div className="hw-image" key={image.id}>
      {isPicture(image.name)
        ? <button type="button" className="hw-image-open" title={t('查看原图')} onClick={() => setOpen(image)}><PageImage uploadId={image.id} width={240} alt={image.name} /></button>
        : <span className="hw-file-chip"><FileText size={15} />{image.name}</span>}
      {onRemove && <button type="button" className="hw-image-remove" aria-label={t('移除')} title={t('移除')} onClick={() => onRemove(image.id)}><X size={12} /></button>}
    </div>)}
    {open && <ImageViewer image={open} onClose={() => setOpen(null)} />}
  </div>
}

/** The question itself: shown large, since it's what the student reads (no copied text). */
function QuestionPictures({ images, onRemove }: { images: HwImage[]; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState<HwImage | null>(null)
  return <div className="hw-question-pictures">
    {images.map((image) => <figure key={image.id}>
      {isPicture(image.name)
        ? <button type="button" className="hw-question-picture" title={t('查看原图')} onClick={() => setOpen(image)}><PageImage uploadId={image.id} width={1100} alt={image.name} /></button>
        : <span className="hw-file-chip"><FileText size={15} />{image.name}</span>}
      <figcaption>{image.name}{image.pages > 1 ? ` · ${t('{n} 页', { n: image.pages })}` : ''}</figcaption>
      {onRemove && <button type="button" className="hw-image-remove" aria-label={t('移除')} title={t('移除')} onClick={() => onRemove(image.id)}><X size={12} /></button>}
    </figure>)}
    {open && <ImageViewer image={open} onClose={() => setOpen(null)} />}
  </div>
}

/** Upload pictures / PDFs (photos are made smaller first). Nothing is read here; the server reads them when asked. */
function useAttach(account: boolean, notify: (message: string) => void) {
  const [busy, setBusy] = useState(false)
  const attach = async (list: File[]): Promise<HwImage[]> => {
    const files = list.filter(isUploadable).slice(0, 8)
    if (!files.length) return []
    if (!account) { notify(t('登录后可以拍照或上传图片。')); return [] }
    setBusy(true)
    try {
      const added: HwImage[] = []
      for (const file of files) {
        const stored = await filesApi.upload(await shrinkImage(file))
        added.push({ id: stored.id, name: file.name === 'image.png' ? t('截图.png') : file.name, pages: stored.pages || 1 })
      }
      return added
    } catch (error) {
      notify(error instanceof Error ? error.message : t('上传失败'))
      return []
    } finally {
      setBusy(false)
    }
  }
  return { busy, attach }
}

function AttachButtons({ onFiles, onCloud, disabled }: { onFiles: (files: File[]) => void; onCloud?: () => void; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  return <div className="hw-upload">
    <button type="button" className="icon-text" disabled={disabled} onClick={() => camera.current?.click()}><Camera size={15} />{t('拍照')}</button>
    <button type="button" className="icon-text" disabled={disabled} onClick={() => picker.current?.click()}><FileUp size={15} />{t('上传图片 / PDF')}</button>
    {onCloud && <button type="button" className="icon-text" disabled={disabled} onClick={onCloud}><Cloud size={15} />{t('从网盘选择')}</button>}
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
    <input ref={picker} type="file" accept="image/*,.pdf,.heic,.heif" multiple hidden onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
  </div>
}

const SUPPORTED_CLOUD = /\.(pdf|png|jpe?g|webp|pptx?|docx?|odt|odp|md|markdown|txt)$/i
const formatSize = (bytes: number | null) => bytes == null ? '' : bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** Pick files from a cloud-drive share link (the link is remembered per course in this browser). */
function CloudPicker({ courseId, onAdd, onClose, notify }: { courseId: string; onAdd: (images: HwImage[]) => void; onClose: () => void; notify: (message: string) => void }) {
  const storageKey = `${CLOUD_LINK}:${courseId}`
  const [link, setLink] = useState(() => { try { return localStorage.getItem(storageKey) || localStorage.getItem(CLOUD_LINK) || '' } catch { return '' } })
  const [listing, setListing] = useState<CloudListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const open = async (path = '') => {
    if (!link.trim()) return
    setLoading(true)
    setError('')
    try {
      setListing(await cloudApi.list(link.trim(), path))
      try { localStorage.setItem(storageKey, link.trim()); localStorage.setItem(CLOUD_LINK, link.trim()) } catch { /* ignore */ }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('打不开这个链接'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (link) void open() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (path: string, name: string) => {
    setAdding(path)
    try {
      const stored = await cloudApi.import(link.trim(), path)
      onAdd([{ id: stored.id, name: stored.filename || name, pages: stored.pages || 1 }])
      setAdded((current) => [...current, path])
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('下载失败'))
    } finally {
      setAdding('')
    }
  }
  const crumbs = listing && listing.kind === 'dir' ? listing.path.split('/').filter(Boolean) : []
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal hw-cloud" role="dialog" aria-label={t('从网盘选择')} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">{t('网盘')}</span><h2>{t('从网盘选择')}</h2></div><button type="button" className="icon-button" aria-label={t('关闭')} onClick={onClose}><X size={18} /></button></div>
      <form className="hw-cloud-link" onSubmit={(event) => { event.preventDefault(); void open() }}>
        <input value={link} onChange={(event) => setLink(event.target.value)} placeholder={t('粘贴网盘的共享链接')} aria-label={t('共享链接')} spellCheck={false} />
        <button className="button secondary compact" disabled={!link.trim() || loading}>{loading ? <RefreshCw className="spin-icon" size={14} /> : <Folder size={14} />}{t('打开')}</button>
      </form>
      {error && <p className="hw-cloud-error">{error}</p>}
      {listing && <>
        {listing.kind === 'dir' && <div className="hw-cloud-crumbs">
          <button type="button" onClick={() => void open('/')}>{t('全部文件')}</button>
          {crumbs.map((part, index) => <span key={index}><ChevronRight size={12} /><button type="button" onClick={() => void open('/' + crumbs.slice(0, index + 1).join('/'))}>{part}</button></span>)}
        </div>}
        <div className="hw-cloud-list">
          {!listing.entries.length && <p className="field-hint">{t('这个文件夹是空的')}</p>}
          {listing.entries.map((entry) => {
            const done = added.includes(entry.path)
            const supported = entry.is_dir || SUPPORTED_CLOUD.test(entry.name)
            return entry.is_dir
              ? <button type="button" key={entry.path} className="hw-cloud-row folder" onClick={() => void open(entry.path)}><Folder size={16} /><span>{entry.name}</span><ChevronRight size={14} /></button>
              : <div key={entry.path} className={`hw-cloud-row ${supported ? '' : 'unsupported'}`}><FileText size={16} /><span>{entry.name}</span><small>{formatSize(entry.size)}</small>
                <button type="button" className={`button compact ${done ? 'ghost' : 'secondary'}`} disabled={!supported || done || Boolean(adding)} onClick={() => void add(entry.path, entry.name)}>
                  {adding === entry.path ? <RefreshCw className="spin-icon" size={13} /> : done ? <Check size={13} /> : <Plus size={13} />}{done ? t('已添加') : supported ? t('添加') : t('不支持')}</button></div>
          })}
        </div>
      </>}
      <div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>{t('完成')}</button></div>
    </div>
  </div>
}

/** What the student writes: their question or their working, with pictures (paste, drop, photo, upload). */
function MessageBox({ courseId, value, onChange, placeholder, account, notify, disabled }: { courseId: string; value: Draft; onChange: (value: Draft) => void; placeholder: string; account: boolean; notify: (message: string) => void; disabled?: boolean }) {
  const latest = useRef(value)
  latest.current = value
  const [preview, setPreview] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [cloud, setCloud] = useState(false)
  const { busy, attach } = useAttach(account, notify)
  const addImages = (added: HwImage[]) => { if (added.length) onChange({ ...latest.current, images: [...latest.current.images, ...added] }) }
  const addFiles = async (files: File[]) => addImages(await attach(files))
  return <div className={`hw-input ${dragging ? 'dragging' : ''}`}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { setDragging(false); if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) } }}>
    <div className="hw-input-bar">
      <div className="hw-text-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!preview} className={preview ? '' : 'active'} onClick={() => setPreview(false)}><PenLine size={13} />{t('编辑')}</button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? 'active' : ''} onClick={() => setPreview(true)} disabled={!value.text.trim()}><Eye size={13} />{t('预览公式')}</button>
      </div>
      {account && <AttachButtons disabled={disabled || busy} onFiles={(files) => void addFiles(files)} onCloud={() => setCloud(true)} />}
    </div>
    <ImageStrip images={value.images} onRemove={(id) => onChange({ ...latest.current, images: latest.current.images.filter((image) => image.id !== id) })} />
    {preview && value.text.trim() ? <div className="hw-preview"><Markdown className="on-dark practice-md">{keepLines(value.text)}</Markdown></div>
      : <textarea aria-label={placeholder} rows={5} value={value.text} placeholder={placeholder} disabled={disabled}
          onChange={(event) => onChange({ ...latest.current, text: event.target.value })}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter(isUploadable)
            if (files.length) { event.preventDefault(); void addFiles(files) }
          }} />}
    {busy && <div className="hw-busy"><RefreshCw className="spin-icon" size={14} />{t('正在上传…')}</div>}
    {cloud && <CloudPicker courseId={courseId} notify={notify} onClose={() => setCloud(false)} onAdd={addImages} />}
  </div>
}

/** Where the question goes before the first message: paste / drop a screenshot, take a photo, upload or pick from the cloud drive. */
function QuestionDrop({ course, images, onChange, account, notify }: { course: Course; images: HwImage[]; onChange: (images: HwImage[]) => void; account: boolean; notify: (message: string) => void }) {
  const latest = useRef(images)
  latest.current = images
  const [dragging, setDragging] = useState(false)
  const [cloud, setCloud] = useState(false)
  const { busy, attach } = useAttach(account, notify)
  const addFiles = async (files: File[]) => {
    const added = await attach(files)
    if (added.length) onChange([...latest.current, ...added])
  }
  return <div tabIndex={0} className={`hw-drop ${dragging ? 'dragging' : ''} ${images.length ? 'filled' : ''}`}
    onPaste={(event) => { const files = Array.from(event.clipboardData.files).filter(isUploadable); if (files.length) { event.preventDefault(); void addFiles(files) } }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { setDragging(false); if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) } }}>
    {images.length > 0 && <QuestionPictures images={images} onRemove={(id) => onChange(latest.current.filter((image) => image.id !== id))} />}
    <div className="hw-drop-bar">
      {!images.length && <span className="hw-drop-hint">{account ? t('粘贴题目截图（Ctrl/⌘+V），或拖进来') : t('登录后可以上传题目图片；也可以直接在下面打字')}</span>}
      {account && <AttachButtons disabled={busy} onFiles={(files) => void addFiles(files)} onCloud={() => setCloud(true)} />}
      {busy && <span className="hw-busy"><RefreshCw className="spin-icon" size={14} />{t('正在上传…')}</span>}
    </div>
    {cloud && <CloudPicker courseId={course.id} notify={notify} onClose={() => setCloud(false)} onAdd={(added) => onChange([...latest.current, ...added])} />}
  </div>
}

function QrPanel({ url }: { url: string }) {
  const [image, setImage] = useState('')
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 200, color: { dark: '#0c0f14', light: '#ffffff' } }).then(setImage).catch(() => setImage('')) }, [url])
  return <div className="hw-qr">
    {image ? <img src={image} alt={t('打开这道题的二维码')} /> : <span className="mini-spinner" />}
    <div>
      <strong>{t('用手机或平板交答案')}</strong>
      <p>{t('用手机扫码打开这道题（同一个账号），拍照上传后会自动出现在这里。')}</p>
      <code>{url}</code>
    </div>
  </div>
}

// ---------------------------------------------------------------------------
// The conversation, one exchange at a time (each can be folded)
// ---------------------------------------------------------------------------

function CheckCard({ check, showSolution }: { check: HomeworkCheck; showSolution?: boolean }) {
  const Icon = check.verdict === 'correct' ? CheckCircle2 : CircleAlert
  return <div className={`hw-step hw-check ${check.verdict}`}>
    <div className="grade-head"><Icon size={16} /><strong>{verdictText(check.verdict)}</strong>{check.kind && <span className="grade-kind">{kindLabel(check.kind)}</span>}</div>
    {check.where && <div className="hw-field"><span>{t('第一处出错')}</span><Markdown className="on-dark practice-md">{check.where}</Markdown></div>}
    {check.why && <div className="hw-field"><span>{check.verdict === 'correct' ? t('做对的关键') : t('为什么错')}</span><Markdown className="on-dark practice-md">{check.why}</Markdown></div>}
    {check.verdict !== 'correct' && check.answer && <div className="hw-field"><span>{t('正确答案')}</span><Markdown className="on-dark practice-md">{check.answer}</Markdown></div>}
    {showSolution && check.solution && <div className="hw-field hw-solution"><span>{t('完整步骤')}</span><Markdown className="on-dark practice-md">{check.solution}</Markdown></div>}
  </div>
}

function StepView({ step, index, steps }: { step: HwStep; index: number; steps: HwStep[] }) {
  if (step.kind === 'answer' || step.kind === 'attempt' || step.kind === 'ask') {
    return <div className="hw-step hw-mine">
      {step.text && <Markdown className="on-dark practice-md">{keepLines(step.text)}</Markdown>}
      <ImageStrip images={step.images || []} />
    </div>
  }
  if (step.kind === 'check' && step.check) return <CheckCard check={step.check} showSolution={step.showSolution} />
  if (step.kind === 'reply') {
    const verdict = step.verdict ? { correct: t('想法对'), partial: t('部分对'), wrong: t('想法有问题') }[step.verdict] : ''
    return <div className={`hw-step hw-reply ${step.verdict || 'question'}`}>
      <span className="hw-step-label"><Bot size={13} />{t('AI 回复')}{verdict && <em>{verdict}</em>}</span>
      <Markdown className="on-dark practice-md">{step.text}</Markdown>
    </div>
  }
  if (step.kind === 'hint') {
    const number = steps.slice(0, index + 1).filter((item) => item.kind === 'hint').length
    return <div className="hw-step hw-hint"><span className="hw-step-label"><Lightbulb size={13} />{t('提示 {n}', { n: number })}</span><Markdown className="on-dark practice-md">{step.text}</Markdown></div>
  }
  if (step.kind === 'feedback') {
    return <div className={`hw-step hw-feedback ${step.onTrack === false ? 'off' : 'on'}`}><span className="hw-step-label">{step.onTrack === false ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}{step.onTrack === false ? t('这一步有问题') : t('这一步对了')}</span><Markdown className="on-dark practice-md">{step.text}</Markdown></div>
  }
  return <div className="hw-step hw-solution-step"><span className="hw-step-label"><ListChecks size={13} />{t('完整解答')}</span><Markdown className="on-dark practice-md">{step.text}</Markdown></div>
}

type Exchange = { id: string; mine?: HwStep; replies: HwStep[] }
const MINE = new Set(['answer', 'attempt', 'ask'])

/** A message and what came back; a hint or solution asked for by button starts its own exchange. */
function groupSteps(steps: HwStep[]): Exchange[] {
  const exchanges: Exchange[] = []
  for (const step of steps) {
    const current = exchanges[exchanges.length - 1]
    if (MINE.has(step.kind)) exchanges.push({ id: step.id, mine: step, replies: [] })
    else if (!current || (current.replies.length && !(step.kind === 'hint' && current.replies[current.replies.length - 1].kind === 'feedback'))) exchanges.push({ id: step.id, replies: [step] })
    else current.replies.push(step)
  }
  return exchanges
}

function exchangeSummary(exchange: Exchange, steps: HwStep[]) {
  const first = (exchange.mine?.text || '').replace(/\s+/g, ' ').trim()
  const label = exchange.mine
    ? ({ answer: t('我的解答'), attempt: t('我的尝试'), ask: t('我的问题') } as Record<string, string>)[exchange.mine.kind]
    : exchange.replies[0]?.kind === 'hint' ? t('提示 {n}', { n: steps.slice(0, steps.indexOf(exchange.replies[0]) + 1).filter((item) => item.kind === 'hint').length }) : t('完整解答')
  const check = exchange.replies.find((step) => step.kind === 'check')?.check
  const reply = exchange.replies.find((step) => step.kind === 'reply')
  const feedback = exchange.replies.find((step) => step.kind === 'feedback')
  const chip = check ? { text: verdictText(check.verdict), tone: check.verdict }
    : reply?.verdict ? { text: { correct: t('想法对'), partial: t('部分对'), wrong: t('想法有问题') }[reply.verdict], tone: reply.verdict }
    : feedback ? { text: feedback.onTrack === false ? t('这一步有问题') : t('这一步对了'), tone: feedback.onTrack === false ? 'wrong' : 'correct' }
    : null
  const images = exchange.mine?.images?.length || 0
  return { label, text: first || (images ? t('{n} 张图', { n: images }) : ''), chip }
}

function ExchangeView({ exchange, steps, open, onToggle }: { exchange: Exchange; steps: HwStep[]; open: boolean; onToggle: () => void }) {
  const { label, text, chip } = exchangeSummary(exchange, steps)
  return <section className={`hw-exchange ${open ? 'open' : ''}`}>
    <button type="button" className="hw-exchange-head" aria-expanded={open} onClick={onToggle}>
      <ChevronDown size={15} className={open ? '' : 'turned'} />
      <strong>{label}</strong>
      {!open && text && <span className="hw-exchange-text">{text}</span>}
      {chip && <em className={`hw-chip ${chip.tone}`}>{chip.text}</em>}
    </button>
    {open && <div className={`hw-exchange-body ${exchange.mine || exchange.replies.length > 1 ? '' : 'solo'}`}>{[exchange.mine, ...exchange.replies].filter(Boolean).map((step) => <StepView key={step!.id} step={step!} index={steps.indexOf(step!)} steps={steps} />)}</div>}
  </section>
}

function ConclusionCard({ item, course }: { item: HwItem; course: Course }) {
  const card = item.conclusion!
  const topic = topicOf(course, card.topic_key || item.topicKey)
  return <section className="panel hw-conclusion">
    <div className="hw-conclusion-head"><Flag size={16} /><strong>{t('这道题的总结')}</strong><span className={`hw-solved ${card.solved ? 'yes' : 'no'}`}>{card.solved ? t('自己做出来了') : item.sawSolution ? t('看了解答') : t('还没完全做对')}</span></div>
    <div className="hw-field"><span>{t('关键')}</span><Markdown className="on-dark practice-md">{card.idea}</Markdown></div>
    {card.method && <div className="hw-field"><span>{t('下次可以这样做')}</span><Markdown className="on-dark practice-md">{card.method}</Markdown></div>}
    {card.stuck && <div className="hw-field"><span>{t('这次卡在')}{card.kind ? ` · ${kindLabel(card.kind)}` : ''}</span><Markdown className="on-dark practice-md">{card.stuck}</Markdown></div>}
    <p className="hw-recorded">{topic ? t('已记入薄弱点和知识档案：{section} · {title}', { section: topic.section.title, title: topic.title }) : t('已记入薄弱点和知识档案')}
      {topic && <> · <Link to={`/courses/${course.id}/sections/${topic.sectionId}/replay`} state={{ focus: topic.nodeId }}><BookOpen size={13} />{t('复习这个知识点')}</Link></>}</p>
  </section>
}

// ---------------------------------------------------------------------------
// One problem (also used, unsaved, for a new one)
// ---------------------------------------------------------------------------

function ProblemView({ course, item, update, isNew, onDelete, onSaveOnly, onDiscard, setCourses, notify, account }: {
  course: Course; item: HwItem; update: Update; isNew?: boolean; onDelete?: () => void; onSaveOnly?: () => void; onDiscard?: () => void
} & Omit<Props, 'courses'>) {
  const [busy, setBusy] = useState('')
  const running = useRef<AbortController | null>(null)
  const [editing, setEditing] = useState(false)
  const [questionText, setQuestionText] = useState(item.question.text)
  const [questionOpen, setQuestionOpen] = useState(true)
  const [openState, setOpenState] = useState<Record<string, boolean>>({})
  const [showQr, setShowQr] = useState(false)
  const status = itemStatus(item)
  const check = lastCheck(item)
  const finished = Boolean(item.conclusion)
  const lastStep = item.steps[item.steps.length - 1]
  const correctNow = item.solved || (lastStep?.kind === 'check' && lastStep.check?.verdict === 'correct')
  const mode = item.mode || 'check'
  const exchanges = groupSteps(item.steps)
  const hasQuestion = Boolean(item.question.images.length || item.question.text.trim())
  const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/courses/${course.id}/homework/${item.id}`

  const run = async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return
    const controller = new AbortController()
    running.current = controller
    setBusy(label)
    try { await work(controller.signal) } catch (error) { if (!aborted(error)) notify(error instanceof Error ? error.message : t('出错了，请重试')) } finally {
      if (running.current === controller) running.current = null
      setBusy('')
    }
  }
  const step = (kind: HwStep['kind'], fields: Partial<HwStep>): HwStep => ({ id: newId('step'), kind, at: Date.now(), text: '', ...fields })
  const setDraft = (draft: Draft) => void update((current) => ({ ...current, draft }), 800)
  const setMode = (next: 'check' | 'guide') => { if (next !== mode) void update((current) => ({ ...current, mode: next })) }
  const draft = item.draft
  const draftEmpty = !draft.text.trim() && !draft.images.length
  /** Without a question picture, the first thing typed is the question. */
  const subjectFor = (message: Draft): HwItem => hasQuestion ? item : { ...item, question: { ...item.question, text: message.text } }
  const sent = (subject: HwItem, message: Draft, named = '') => (current: HwItem): HwItem => ({
    ...current, question: subject.question, title: current.title || named || titleFor(subject, message.text), draft: EMPTY,
  })

  const submitCheck = () => run(t('批改中…'), async (signal) => {
    if (draftEmpty) throw new Error(t('先写下或上传你的解答'))
    const message = draft
    const subject = subjectFor(message)
    const result = await homeworkApi.check(homeworkContext(course, subject, message.text), historyOf(subject), message.text, message.images.map((image) => image.id), signal)
    await update((current) => ({
      ...sent(subject, message, result.title)(current),
      steps: [...current.steps, step('answer', { text: message.text, images: message.images, read: result.read }), step('check', { check: result })],
      topicKey: result.topic_key || current.topicKey, solved: current.solved || result.verdict === 'correct',
    }))
  })

  const askHint = () => run(t('想提示中…'), async (signal) => {
    // No question yet and something typed: that's the question.
    const subject = hasQuestion ? item : subjectFor(draft)
    if (!subject.question.text.trim() && !subject.question.images.length) throw new Error(t('先上传题目，或写下题目'))
    const result = await homeworkApi.guide(homeworkContext(course, subject), historyOf(subject), '', [], signal)
    await update((current) => ({
      ...(hasQuestion ? { ...current, title: current.title || result.title } : sent(subject, draft, result.title)(current)), mode: 'guide',
      steps: [...current.steps, ...(result.hint ? [step('hint', { text: result.hint })] : [])], topicKey: result.topic_key || current.topicKey,
    }))
  })

  const submitAttempt = () => run(t('看你这一步…'), async (signal) => {
    if (draftEmpty) throw new Error(t('先写下或拍下你这一步'))
    const message = draft
    const subject = subjectFor(message)
    const result = await homeworkApi.guide(homeworkContext(course, subject, message.text), historyOf(subject), message.text, message.images.map((image) => image.id), signal)
    await update((current) => ({
      ...sent(subject, message, result.title)(current), solved: current.solved || result.done,
      steps: [...current.steps, step('attempt', { text: message.text, images: message.images, read: result.read }),
        ...(result.feedback ? [step('feedback', { text: result.feedback, onTrack: result.on_track })] : []),
        ...(result.hint ? [step('hint', { text: result.hint })] : [])],
      topicKey: result.topic_key || current.topicKey,
    }))
  })

  const askQuestion = () => run(t('想一想…'), async (signal) => {
    if (draftEmpty) throw new Error(t('先写下你的问题或想法'))
    const message = draft
    const subject = subjectFor(message)
    const result = await homeworkApi.ask(homeworkContext(course, subject, message.text), historyOf(subject), message.text, message.images.map((image) => image.id), signal)
    await update((current) => ({
      ...sent(subject, message, result.title)(current),
      steps: [...current.steps, step('ask', { text: message.text, images: message.images, read: result.read }), step('reply', { text: result.reply, verdict: result.verdict })],
      topicKey: result.topic_key || current.topicKey,
    }))
  })

  const showSolution = () => run(t('准备完整解答…'), async (signal) => {
    // Marking already worked out the full steps: just reveal them.
    if (check?.check?.solution && !check.showSolution) {
      const holder = exchanges.find((exchange) => exchange.replies.includes(check))
      if (holder) setOpenState((current) => ({ ...current, [holder.id]: true }))
      await update((current) => ({ ...current, sawSolution: true, steps: current.steps.map((value) => value.id === check.id ? { ...value, showSolution: true } : value) }))
      return
    }
    const result = await homeworkApi.solve(homeworkContext(course, item), signal)
    await update((current) => ({ ...current, sawSolution: true, steps: [...current.steps, step('solution', { text: `${result.solution}${result.answer ? `\n\n**${t('最终答案')}：** ${result.answer}` : ''}` })] }))
  })

  const finish = () => run(t('写总结…'), async (signal) => {
    const result = await homeworkApi.conclude(homeworkContext(course, item), historyOf(item), item.sawSolution, signal)
    const topic = topicOf(course, result.topic_key || item.topicKey)
    const verdicts = item.steps.filter((value) => value.kind === 'check').map((value) => value.check!.verdict)
    const verdict = result.solved && !result.kind ? 'correct' : result.solved || verdicts.includes('partial') ? 'partial' : 'wrong'
    updateCourse(setCourses, course.id, (current) => recordAnswer(current, {
      sectionId: topic?.sectionId, nodeId: topic?.nodeId, topic: topic?.title || itemTitle(item), verdict, kind: result.kind || undefined,
      source: 'homework', question: (item.question.text || itemTitle(item)).slice(0, 400), note: result.stuck || undefined,
    }))
    await update((current) => ({ ...current, conclusion: { ...result, at: Date.now() }, topicKey: result.topic_key || current.topicKey }))
  })

  const cancel = () => {
    if (busy) { running.current?.abort(); return }
    if (isNew) { onDiscard?.(); return }
    setDraft(EMPTY)
  }
  const saveQuestion = () => {
    if (!questionText.trim()) return
    void update((current) => ({ ...current, question: { ...current.question, text: questionText }, title: titleFor({ ...current, question: { ...current.question, text: questionText } }) }))
    setEditing(false)
  }
  const isOpen = (exchange: Exchange, index: number) => openState[exchange.id] ?? index >= exchanges.length - 2
  const hints = item.steps.filter((value) => value.kind === 'hint').length
  const canReveal = !isNew && (mode === 'check' ? Boolean(check?.check?.solution && !check.showSolution) : hasQuestion)
  const placeholder = !hasQuestion ? t('先放题目（上面），或直接把题目打在这里；也可以写下你的问题或解答')
    : mode === 'check' ? t('写下你的解答，或问一个问题；可以粘贴截图、拍照')
    : t('写下这一步或你的想法；可以粘贴截图、拍照')

  return <div className="hw-problem">
    <section className={`panel hw-card hw-question ${questionOpen ? '' : 'folded'}`}>
      <div className="hw-card-head">
        <button type="button" className="hw-fold" aria-expanded={questionOpen} onClick={() => setQuestionOpen((value) => !value)}><ChevronDown size={16} className={questionOpen ? '' : 'turned'} /><h3>{isNew || (questionOpen && item.question.text.trim() && !item.question.images.length) ? t('题目') : itemTitle(item)}</h3></button>
        {!isNew && <span className={`hw-status ${status}`}>{statusLabel(status)}</span>}
        <div className="hw-card-tools">
          {!isNew && !item.question.images.length && !editing && <button type="button" className="icon-button tiny" title={t('修改题目')} aria-label={t('修改题目')} onClick={() => { setQuestionText(item.question.text); setEditing(true); setQuestionOpen(true) }}><PenLine size={14} /></button>}
          {onDelete && <button type="button" className="icon-button tiny" title={t('删除这道题')} aria-label={t('删除这道题')} onClick={onDelete}><Trash2 size={14} /></button>}
        </div>
      </div>
      {questionOpen && (isNew
        ? <QuestionDrop course={course} images={item.question.images} account={account} notify={notify} onChange={(images) => void update((current) => ({ ...current, question: { ...current.question, images } }))} />
        : editing ? <>
          <textarea className="hw-question-edit" rows={5} value={questionText} onChange={(event) => setQuestionText(event.target.value)} aria-label={t('题目')} />
          <div className="hw-actions"><button className="button ghost compact" onClick={() => setEditing(false)}>{t('取消')}</button><button className="button primary compact" disabled={!questionText.trim()} onClick={saveQuestion}>{t('保存')}</button></div>
        </> : item.question.images.length ? <QuestionPictures images={item.question.images} /> : <Markdown className="on-dark practice-md">{item.question.text}</Markdown>)}
    </section>

    {exchanges.length > 0 && <div className="hw-steps">{exchanges.map((exchange, index) => <ExchangeView key={exchange.id} exchange={exchange} steps={item.steps} open={isOpen(exchange, index)} onToggle={() => setOpenState((current) => ({ ...current, [exchange.id]: !isOpen(exchange, index) }))} />)}</div>}
    {busy && <div className="hw-thinking"><span className="mini-spinner" />{busy}<button type="button" className="button ghost compact" onClick={cancel}><X size={14} />{t('取消')}</button></div>}
    {!finished && correctNow && <section className="panel hw-card hw-done-card"><CheckCircle2 size={20} /><div><strong>{t('做对了！')}</strong><p>{t('写一张总结卡，把这道题的关键和方法记下来。')}</p></div><button className="button primary" disabled={Boolean(busy)} onClick={() => void finish()}><Flag size={16} />{t('结束这道题 · 写总结')}</button></section>}

    {!finished && <section className="panel hw-card hw-composer">
      <div className="hw-card-head">
        <div className="mode-switch hw-mode" role="tablist" aria-label={t('答疑方式')}>
          <button type="button" role="tab" aria-selected={mode === 'check'} className={mode === 'check' ? 'active' : ''} onClick={() => setMode('check')}><Check size={14} />{t('批改')}</button>
          <button type="button" role="tab" aria-selected={mode === 'guide'} className={mode === 'guide' ? 'active' : ''} onClick={() => setMode('guide')}><Lightbulb size={14} />{t('提示引导')}</button>
        </div>
        {account && !isNew && <button type="button" className="button ghost compact hw-qr-toggle" onClick={() => setShowQr((value) => !value)}><Smartphone size={14} />{showQr ? t('收起二维码') : t('用手机 / 平板交答案')}</button>}
      </div>
      {showQr && <QrPanel url={url} />}
      <MessageBox courseId={course.id} value={draft} onChange={setDraft} placeholder={placeholder} account={account} notify={notify} disabled={Boolean(busy)} />
      <div className="hw-actions">
        {mode === 'check'
          ? <button className="button primary" disabled={draftEmpty || Boolean(busy)} onClick={() => void submitCheck()}><Check size={16} />{check ? t('再交一次') : t('提交批改')}</button>
          : <>
            {hints > 0 && <button className="button primary" disabled={draftEmpty || Boolean(busy)} onClick={() => void submitAttempt()}><Check size={16} />{t('提交这一步')}</button>}
            <button className={`button ${hints > 0 ? 'secondary' : 'primary'}`} disabled={Boolean(busy) || (!hasQuestion && !draft.text.trim())} onClick={() => void askHint()}><Sparkles size={16} />{hints ? t('再给一点提示') : t('带我起步')}</button>
          </>}
        <button className="button secondary" disabled={draftEmpty || Boolean(busy)} onClick={() => void askQuestion()}><MessageCircleQuestion size={16} />{t('问一问')}</button>
        {isNew && onSaveOnly && <button className="button ghost" disabled={Boolean(busy) || (!hasQuestion && !draft.text.trim())} onClick={onSaveOnly}>{t('只保存题目')}</button>}
        <span />
        {canReveal && <button className="button ghost" disabled={Boolean(busy)} onClick={() => void showSolution()}><Eye size={16} />{mode === 'check' ? t('看完整步骤') : t('看完整解答')}</button>}
        {item.steps.length > 0 && !correctNow && <button className="button ghost" disabled={Boolean(busy)} onClick={() => void finish()}><Flag size={16} />{t('结束这道题')}</button>}
        {(isNew || !draftEmpty) && !busy && <button className="button ghost" onClick={cancel}><X size={16} />{t('取消')}</button>}
      </div>
      {mode === 'check' && lastStep?.kind === 'check' && check?.check?.hint && <div className="hw-fix-hint"><Lightbulb size={13} /><Markdown className="on-dark">{check.check.hint}</Markdown></div>}
    </section>}
    {item.conclusion && <ConclusionCard item={item} course={course} />}
    {item.conclusion && <div className="hw-actions"><Link className="button secondary" to={`/courses/${course.id}/homework/new`}><Plus size={16} />{t('再交一道题')}</Link></div>}
  </div>
}

/** A new problem lives only here until the first message (or 只保存题目); then it's saved and opened. */
function NewProblem({ course, store, setCourses, notify, account }: { course: Course; store: Store } & Omit<Props, 'courses'>) {
  const navigate = useNavigate()
  const [item, setItem] = useState(() => createItem(course.id, { text: '', images: [] }))
  const latest = useRef(item)
  latest.current = item
  const save = async (next: HwItem) => {
    await store.add({ ...next, updatedAt: Date.now() })
    navigate(`/courses/${course.id}/homework/${next.id}`)
  }
  const update: Update = async (change) => {
    const next = change(latest.current)
    latest.current = next
    if (next.steps.length) await save(next)
    else setItem(next)
  }
  const saveOnly = () => {
    const current = latest.current
    const typed = current.draft.text.trim()
    const next = current.question.images.length || !typed ? current : { ...current, question: { ...current.question, text: typed }, draft: EMPTY }
    void save({ ...next, title: titleFor(next, typed) })
  }
  const discard = () => {
    setItem(createItem(course.id, { text: '', images: [] }))
    navigate(`/courses/${course.id}/homework`)
  }
  return <ProblemView course={course} item={item} update={update} isNew onSaveOnly={saveOnly} onDiscard={discard} setCourses={setCourses} notify={notify} account={account} />
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function HomeworkPage({ courses, setCourses, notify, account }: Props) {
  useLang()
  const { courseId = '', itemId } = useParams()
  const navigate = useNavigate()
  const course = courses.find((item) => item.id === courseId)
  const store = useHomework(courseId, account, notify)
  useEffect(() => { try { localStorage.setItem(LAST_COURSE, courseId) } catch { /* ignore */ } }, [courseId])
  if (!course) return <NotFound />
  const item = itemId && itemId !== 'new' ? store.items.find((value) => value.id === itemId) : undefined
  const atList = !itemId
  const removeItem = async (id: string) => {
    if (!window.confirm(t('删除这道题？'))) return
    await store.remove(id).catch((error) => notify(error instanceof Error ? error.message : t('删除失败')))
    navigate(`/courses/${course.id}/homework`)
  }

  return <div className="page homework-page">
    <div className="back-row"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link><span>/</span><span>{t('题目答疑')}</span></div>
    <PageHeader title={t('题目答疑')} subtitle={t('交作业题：批改你的答案，或者一步步带你做。')}
      actions={<>{courses.length > 1 && <select className="hw-course-select" aria-label={t('选择课程')} value={course.id} onChange={(event) => navigate(`/courses/${event.target.value}/homework`)}>{courses.map((value) => <option key={value.id} value={value.id}>{value.title}</option>)}</select>}
        <Link className="button primary" to={`/courses/${course.id}/homework/new`}><Plus size={17} />{t('新题目')}</Link></>} />
    {store.loadError && <div className="api-error"><X size={16} /><div><strong>{t('读取题目失败')}</strong><p>{store.loadError}</p></div></div>}
    <div className={`homework-layout ${atList ? 'at-list' : 'at-item'}`}>
      <aside className="panel homework-list">
        <div className="homework-list-head"><strong>{t('这门课的题目')}</strong><span>{store.items.length}</span></div>
        {!store.loaded && <p className="field-hint"><span className="mini-spinner" /> {t('加载中…')}</p>}
        {store.loaded && !store.items.length && <p className="field-hint">{t('还没有题目。点「新题目」把作业题交上来。')}</p>}
        {store.items.map((value) => {
          const status = itemStatus(value)
          const verdict = lastCheck(value)?.check?.verdict
          return <Link key={value.id} to={`/courses/${course.id}/homework/${value.id}`} className={`homework-item ${value.id === itemId ? 'active' : ''}`}>
            <strong>{itemTitle(value)}</strong>
            <small><span className={`hw-status ${status}`}>{statusLabel(status)}</span>{status === 'done' ? (value.conclusion?.solved ? ` · ${t('自己做出来了')}` : ` · ${t('记入薄弱点')}`) : verdict ? ` · ${verdictText(verdict)}` : ''}</small>
          </Link>
        })}
      </aside>
      <main className="homework-main">
        {itemId && itemId !== 'new' && !item && store.loaded && <div className="empty-hint">{t('找不到这道题，可能已经被删除了。')}</div>}
        {itemId && itemId !== 'new' && !item && !store.loaded && <div className="empty-hint"><span className="mini-spinner" /></div>}
        {item ? <ProblemView key={item.id} course={course} item={item} update={(change, debounce) => store.update(item.id, change, debounce)} onDelete={() => void removeItem(item.id)} setCourses={setCourses} notify={notify} account={account} />
          : (!itemId || itemId === 'new') && <NewProblem key={course.id} course={course} store={store} setCourses={setCourses} notify={notify} account={account} />}
        {itemId && <Link className="text-button homework-back" to={`/courses/${course.id}/homework`}><ArrowLeft size={14} />{t('全部题目')}</Link>}
      </main>
    </div>
  </div>
}
