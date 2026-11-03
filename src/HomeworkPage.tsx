import { ArrowLeft, BookOpen, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Eye, FileUp, Flag, Lightbulb, ListChecks, PenLine, Plus, RefreshCw, Smartphone, Sparkles, Trash2, X } from 'lucide-react'
import QRCode from 'qrcode'
import { Dispatch, ReactNode, SetStateAction, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { HomeworkCheck, filesApi, homeworkApi, protectedBlobUrl } from './api'
import { Course } from './data'
import { recordAnswer } from './exam'
import { HwImage, HwItem, HwStep, createItem, historyOf, homeworkContext, itemStatus, lastCheck, newId, shrinkImage, statusLabel, titleFrom, topicOf, useHomework } from './homework'
import { t, useLang } from './i18n'
import { Markdown, NotFound, PageHeader } from './ui'
import { updateCourse } from './WeakPanel'
import { kindLabel } from './weak'

type SetCourses = Dispatch<SetStateAction<Course[]>>
type Props = { courses: Course[]; setCourses: SetCourses; notify: (message: string) => void; account: boolean }
type Store = ReturnType<typeof useHomework>

const LAST_COURSE = 'course-replay-homework-course'
const verdictText = (verdict: HomeworkCheck['verdict']) => ({ correct: t('正确'), partial: t('部分正确'), wrong: t('错误') }[verdict])

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
// Photos and PDFs (question or answer)
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

function ImageStrip({ images, onRemove }: { images: HwImage[]; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState<HwImage | null>(null)
  if (!images.length) return null
  return <div className="hw-images">
    {images.map((image) => <div className="hw-image" key={image.id}>
      <button type="button" className="hw-image-open" title={t('查看原图')} onClick={() => setOpen(image)}><PageImage uploadId={image.id} width={240} alt={image.name} /></button>
      {onRemove && <button type="button" className="hw-image-remove" aria-label={t('移除这张图')} title={t('移除这张图')} onClick={() => onRemove(image.id)}><X size={12} /></button>}
    </div>)}
    {open && <ImageViewer image={open} onClose={() => setOpen(null)} />}
  </div>
}

/** 拍照 / 上传: uploads, then the AI copies the content into text the student can check and edit. */
function UploadButtons({ part, account, onDone, notify, disabled }: { part: 'question' | 'answer'; account: boolean; onDone: (images: HwImage[], text: string) => void; notify: (message: string) => void; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const handle = async (list: FileList | null) => {
    const files = Array.from(list || [])
    if (!files.length) return
    try {
      setBusy(t('正在上传…'))
      const uploaded: HwImage[] = []
      for (const file of files.slice(0, 8)) {
        const ready = await shrinkImage(file)
        const stored = await filesApi.upload(ready)
        uploaded.push({ id: stored.id, name: file.name, pages: 1 })
      }
      setBusy(part === 'question' ? t('AI 正在抄题…') : t('AI 正在读你的解答…'))
      let text = ''
      try {
        const read = await homeworkApi.read(uploaded.map((image) => image.id), part)
        text = read.text
        uploaded.forEach((image) => { image.pages = read.pages[image.id] || 1 })
      } catch (error) {
        notify(error instanceof Error ? t('图片已保存，但没读出文字：{error}', { error: error.message }) : t('没读出文字'))
      }
      onDone(uploaded, text)
    } catch (error) {
      notify(error instanceof Error ? error.message : t('上传失败'))
    } finally {
      setBusy('')
    }
  }
  if (!account) return <p className="field-hint">{t('登录后可以拍照或上传图片。')}</p>
  return <div className="hw-upload">
    <button type="button" className="button secondary compact" disabled={disabled || Boolean(busy)} onClick={() => camera.current?.click()}><Camera size={15} />{t('拍照')}</button>
    <button type="button" className="button secondary compact" disabled={disabled || Boolean(busy)} onClick={() => picker.current?.click()}><FileUp size={15} />{t('上传图片 / PDF')}</button>
    {busy && <span className="hw-busy"><RefreshCw className="spin-icon" size={14} />{busy}</span>}
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { void handle(event.target.files); event.target.value = '' }} />
    <input ref={picker} type="file" accept="image/*,.pdf,.heic,.heif" multiple hidden onChange={(event) => { void handle(event.target.files); event.target.value = '' }} />
  </div>
}

/** Text box with a rendered preview (to check formulas the AI copied from a photo). */
function TextWithPreview({ value, onChange, placeholder, label, rows = 6 }: { value: string; onChange: (value: string) => void; placeholder: string; label: string; rows?: number }) {
  const [preview, setPreview] = useState(false)
  return <div className="hw-text">
    <div className="hw-text-tabs" role="tablist" aria-label={label}>
      <button type="button" role="tab" aria-selected={!preview} className={preview ? '' : 'active'} onClick={() => setPreview(false)}><PenLine size={13} />{t('编辑')}</button>
      <button type="button" role="tab" aria-selected={preview} className={preview ? 'active' : ''} onClick={() => setPreview(true)} disabled={!value.trim()}><Eye size={13} />{t('预览公式')}</button>
    </div>
    {preview && value.trim() ? <div className="hw-preview"><Markdown className="on-dark practice-md">{value}</Markdown></div>
      : <textarea aria-label={label} rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
  </div>
}

function QrPanel({ url }: { url: string }) {
  const [image, setImage] = useState('')
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 200, color: { dark: '#0c0f14', light: '#ffffff' } }).then(setImage).catch(() => setImage('')) }, [url])
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(window.location.hostname)
  return <div className="hw-qr">
    {image ? <img src={image} alt={t('打开这道题的二维码')} /> : <span className="mini-spinner" />}
    <div>
      <strong>{t('用手机或平板交答案')}</strong>
      <p>{t('用手机扫码打开这道题（同一个账号），拍照上传后会自动出现在这里。')}</p>
      <code>{url}</code>
      {local && <p className="hw-qr-warning">{t('手机打不开 localhost 地址：请用电脑的局域网地址或线上地址打开本页，再扫码。')}</p>}
    </div>
  </div>
}

// ---------------------------------------------------------------------------
// The conversation
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
  if (step.kind === 'answer' || step.kind === 'attempt') {
    return <div className="hw-step hw-mine">
      <span className="hw-step-label">{step.kind === 'answer' ? t('我的解答') : t('我的尝试')}</span>
      {step.text && <Markdown className="on-dark practice-md">{step.text}</Markdown>}
      <ImageStrip images={step.images || []} />
    </div>
  }
  if (step.kind === 'check' && step.check) return <CheckCard check={step.check} showSolution={step.showSolution} />
  if (step.kind === 'hint') {
    const number = steps.slice(0, index + 1).filter((item) => item.kind === 'hint').length
    return <div className="hw-step hw-hint"><span className="hw-step-label"><Lightbulb size={13} />{t('提示 {n}', { n: number })}</span><Markdown className="on-dark practice-md">{step.text}</Markdown></div>
  }
  if (step.kind === 'feedback') {
    return <div className={`hw-step hw-feedback ${step.onTrack === false ? 'off' : 'on'}`}><span className="hw-step-label">{step.onTrack === false ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}{step.onTrack === false ? t('这一步有问题') : t('这一步对了')}</span><Markdown className="on-dark practice-md">{step.text}</Markdown></div>
  }
  return <div className="hw-step hw-solution-step"><span className="hw-step-label"><ListChecks size={13} />{t('完整解答')}</span><Markdown className="on-dark practice-md">{step.text}</Markdown></div>
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
// One problem
// ---------------------------------------------------------------------------

function ProblemView({ course, item, store, setCourses, notify, account }: { course: Course; item: HwItem; store: Store } & Omit<Props, 'courses'>) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState(false)
  const [questionText, setQuestionText] = useState(item.question.text)
  const [showQr, setShowQr] = useState(false)
  const status = itemStatus(item)
  const check = lastCheck(item)
  const finished = Boolean(item.conclusion)
  const guiding = item.mode === 'guide'
  const lastStep = item.steps[item.steps.length - 1]
  const correctNow = item.solved || (lastStep?.kind === 'check' && lastStep.check?.verdict === 'correct')
  const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/courses/${course.id}/homework/${item.id}`

  const run = async (label: string, work: () => Promise<void>) => {
    if (busy) return
    setBusy(label)
    try { await work() } catch (error) { notify(error instanceof Error ? error.message : t('出错了，请重试')) } finally { setBusy('') }
  }
  const step = (kind: HwStep['kind'], fields: Partial<HwStep>): HwStep => ({ id: newId('step'), kind, at: Date.now(), text: '', ...fields })
  const setDraft = (draft: HwItem['draft']) => void store.update(item.id, (current) => ({ ...current, draft }), 800)
  const draftEmpty = !item.draft.text.trim()

  const submitCheck = () => run(t('批改中…'), async () => {
    if (draftEmpty) throw new Error(t('先写下或上传你的答案'))
    const answer = item.draft
    const result = await homeworkApi.check(homeworkContext(course, item), answer.text, historyOf(item))
    await store.update(item.id, (current) => ({
      ...current, mode: current.mode || 'check', draft: { text: '', images: [] },
      steps: [...current.steps, step('answer', { text: answer.text, images: answer.images }), step('check', { check: result })],
      topicKey: result.topic_key || current.topicKey, solved: current.solved || result.verdict === 'correct',
    }))
  })

  const askHint = () => run(t('想提示中…'), async () => {
    const result = await homeworkApi.guide(homeworkContext(course, item), historyOf(item), '')
    await store.update(item.id, (current) => ({ ...current, mode: current.mode || 'guide', steps: [...current.steps, ...(result.hint ? [step('hint', { text: result.hint })] : [])], topicKey: result.topic_key || current.topicKey }))
  })

  const submitAttempt = () => run(t('看你这一步…'), async () => {
    if (draftEmpty) throw new Error(t('先写下或拍下你这一步'))
    const attempt = item.draft
    const result = await homeworkApi.guide(homeworkContext(course, item), historyOf(item), attempt.text)
    await store.update(item.id, (current) => ({
      ...current, draft: { text: '', images: [] }, solved: current.solved || result.done,
      steps: [...current.steps, step('attempt', { text: attempt.text, images: attempt.images }),
        ...(result.feedback ? [step('feedback', { text: result.feedback, onTrack: result.on_track })] : []),
        ...(result.hint ? [step('hint', { text: result.hint })] : [])],
      topicKey: result.topic_key || current.topicKey,
    }))
  })

  const showSolution = () => run(t('准备完整解答…'), async () => {
    // Marking already worked out the full steps: just reveal them.
    if (check?.check?.solution && !check.showSolution) {
      await store.update(item.id, (current) => ({ ...current, sawSolution: true, steps: current.steps.map((value) => value.id === check.id ? { ...value, showSolution: true } : value) }))
      return
    }
    const result = await homeworkApi.solve(homeworkContext(course, item))
    await store.update(item.id, (current) => ({ ...current, sawSolution: true, steps: [...current.steps, step('solution', { text: `${result.solution}${result.answer ? `\n\n**${t('最终答案')}：** ${result.answer}` : ''}` })] }))
  })

  const finish = () => run(t('写总结…'), async () => {
    const result = await homeworkApi.conclude(homeworkContext(course, item), historyOf(item), item.sawSolution)
    const topic = topicOf(course, result.topic_key || item.topicKey)
    const verdicts = item.steps.filter((value) => value.kind === 'check').map((value) => value.check!.verdict)
    const verdict = result.solved && !result.kind ? 'correct' : result.solved || verdicts.includes('partial') ? 'partial' : 'wrong'
    updateCourse(setCourses, course.id, (current) => recordAnswer(current, {
      sectionId: topic?.sectionId, nodeId: topic?.nodeId, topic: topic?.title || item.title, verdict, kind: result.kind || undefined,
      source: 'homework', question: item.question.text.slice(0, 400), note: result.stuck || undefined,
    }))
    await store.update(item.id, (current) => ({ ...current, conclusion: { ...result, at: Date.now() }, topicKey: result.topic_key || current.topicKey }))
  })

  const saveQuestion = () => {
    if (!questionText.trim()) return
    void store.update(item.id, (current) => ({ ...current, question: { ...current.question, text: questionText }, title: titleFrom(questionText) }))
    setEditing(false)
  }
  const removeItem = async () => {
    if (!window.confirm(t('删除这道题？'))) return
    await store.remove(item.id).catch((error) => notify(error instanceof Error ? error.message : t('删除失败')))
    navigate(`/courses/${course.id}/homework`)
  }

  const draftBox = (label: string, placeholder: string) => <>
    <UploadButtons part="answer" account={account} notify={notify} disabled={Boolean(busy)} onDone={(images, text) => setDraft({ images: [...item.draft.images, ...images], text: [item.draft.text.trim(), text].filter(Boolean).join('\n\n') })} />
    <ImageStrip images={item.draft.images} onRemove={(id) => setDraft({ ...item.draft, images: item.draft.images.filter((image) => image.id !== id) })} />
    <TextWithPreview label={label} value={item.draft.text} placeholder={placeholder} onChange={(text) => setDraft({ ...item.draft, text })} />
  </>

  let composer: ReactNode = null
  if (!finished && !item.steps.length) {
    composer = <div className="hw-start">
      <section className="panel hw-card">
        <div className="hw-card-head"><h3>{t('2 · 我的答案')}</h3>{account && <button type="button" className="button ghost compact hw-qr-toggle" onClick={() => setShowQr((value) => !value)}><Smartphone size={14} />{showQr ? t('收起二维码') : t('用手机 / 平板交答案')}</button>}</div>
        {showQr && <QrPanel url={url} />}
        {draftBox(t('我的答案'), t('写下你的解答，或拍照上传'))}
        <div className="hw-actions"><button className="button primary" disabled={draftEmpty || Boolean(busy)} onClick={() => void submitCheck()}><Check size={16} />{t('批改我的答案')}</button></div>
      </section>
      <section className="panel hw-card hw-guide-card">
        <h3>{t('不会做？')}</h3>
        <p>{t('一步一步来，每次一条提示。')}</p>
        <button className="button secondary" disabled={Boolean(busy)} onClick={() => void askHint()}><Sparkles size={16} />{t('带我起步')}</button>
      </section>
    </div>
  } else if (!finished && correctNow) {
    composer = <section className="panel hw-card hw-done-card"><CheckCircle2 size={20} /><div><strong>{t('做对了！')}</strong><p>{t('写一张总结卡，把这道题的关键和方法记下来。')}</p></div><button className="button primary" disabled={Boolean(busy)} onClick={() => void finish()}><Flag size={16} />{t('结束这道题 · 写总结')}</button></section>
  } else if (!finished && guiding) {
    composer = <section className="panel hw-card">
      <h3>{t('写下你这一步')}</h3>
      {draftBox(t('你这一步'), t('写下这一步，或拍照上传'))}
      <div className="hw-actions">
        <button className="button primary" disabled={draftEmpty || Boolean(busy)} onClick={() => void submitAttempt()}><Check size={16} />{t('提交这一步')}</button>
        <button className="button secondary" disabled={Boolean(busy)} onClick={() => void askHint()}><Lightbulb size={16} />{t('再给一点提示')}</button>
        <button className="button ghost" disabled={draftEmpty || Boolean(busy)} onClick={() => void submitCheck()}>{t('我做完了，批改最终答案')}</button>
        <span />
        <button className="button ghost" disabled={Boolean(busy)} onClick={() => void showSolution()}><Eye size={16} />{t('看完整解答')}</button>
        <button className="button ghost" disabled={Boolean(busy)} onClick={() => void finish()}><Flag size={16} />{t('结束这道题')}</button>
      </div>
    </section>
  } else if (!finished) {
    composer = <section className="panel hw-card">
      <h3>{t('改一改，再交一次')}</h3>
      {draftBox(t('改过的答案'), t('改好后再交一次'))}
      <div className="hw-actions">
        <button className="button primary" disabled={draftEmpty || Boolean(busy)} onClick={() => void submitCheck()}><Check size={16} />{t('再交一次')}</button>
        <button className="button secondary" disabled={Boolean(busy)} onClick={() => void askHint()}><Lightbulb size={16} />{t('给我提示')}</button>
        <span />
        <button className="button ghost" disabled={Boolean(busy)} onClick={() => void showSolution()}><Eye size={16} />{t('看完整步骤')}</button>
        <button className="button ghost" disabled={Boolean(busy)} onClick={() => void finish()}><Flag size={16} />{t('结束这道题')}</button>
      </div>
      {check?.check?.hint && <div className="hw-fix-hint"><Lightbulb size={13} /><Markdown className="on-dark">{check.check.hint}</Markdown></div>}
    </section>
  }

  return <div className="hw-problem">
    <section className="panel hw-card hw-question">
      <div className="hw-card-head"><h3>{t('1 · 题目')}</h3><span className={`hw-status ${status}`}>{statusLabel(status)}</span>
        <div className="hw-card-tools">
          {!editing && <button type="button" className="icon-button tiny" title={t('修改题目')} aria-label={t('修改题目')} onClick={() => { setQuestionText(item.question.text); setEditing(true) }}><PenLine size={14} /></button>}
          <button type="button" className="icon-button tiny" title={t('删除这道题')} aria-label={t('删除这道题')} onClick={() => void removeItem()}><Trash2 size={14} /></button>
        </div></div>
      <ImageStrip images={item.question.images} />
      {editing ? <>
        <TextWithPreview label={t('题目')} value={questionText} onChange={setQuestionText} placeholder={t('题目')} />
        <div className="hw-actions"><button className="button ghost compact" onClick={() => setEditing(false)}>{t('取消')}</button><button className="button primary compact" disabled={!questionText.trim()} onClick={saveQuestion}>{t('保存')}</button></div>
      </> : item.question.text.trim() ? <Markdown className="on-dark practice-md">{item.question.text}</Markdown> : <p className="field-hint">{t('题目只有图片。')}</p>}
    </section>
    {item.steps.length > 0 && <div className="hw-steps">{item.steps.map((value, index) => <StepView key={value.id} step={value} index={index} steps={item.steps} />)}</div>}
    {busy && <div className="hw-thinking"><span className="mini-spinner" />{busy}</div>}
    {composer}
    {item.conclusion && <ConclusionCard item={item} course={course} />}
    {item.conclusion && <div className="hw-actions"><Link className="button secondary" to={`/courses/${course.id}/homework/new`}><Plus size={16} />{t('再交一道题')}</Link></div>}
  </div>
}

// ---------------------------------------------------------------------------
// New problem: the question only (the answer can come later, from another device)
// ---------------------------------------------------------------------------

function NewProblem({ course, store, notify, account }: { course: Course; store: Store; notify: Props['notify']; account: boolean }) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [images, setImages] = useState<HwImage[]>([])
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!text.trim() && !images.length) return
    setSaving(true)
    const item = createItem(course.id, { text: text.trim(), images })
    try {
      await store.add(item)
      navigate(`/courses/${course.id}/homework/${item.id}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setSaving(false)
    }
  }
  return <section className="panel hw-card hw-new">
    <h3>{t('1 · 题目')}</h3>
    <UploadButtons part="question" account={account} notify={notify} onDone={(added, read) => { setImages((current) => [...current, ...added]); setText((current) => [current.trim(), read].filter(Boolean).join('\n\n')) }} />
    <ImageStrip images={images} onRemove={(id) => setImages((current) => current.filter((image) => image.id !== id))} />
    <TextWithPreview label={t('题目')} value={text} onChange={setText} rows={8} placeholder={t('输入题目，或拍照 / 上传图片、PDF')} />
    <div className="hw-actions"><button className="button primary" disabled={(!text.trim() && !images.length) || saving} onClick={() => void save()}>{saving ? <RefreshCw className="spin-icon" size={16} /> : <Check size={16} />}{t('保存题目')}</button></div>
  </section>
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
            <strong>{value.title}</strong>
            <small><span className={`hw-status ${status}`}>{statusLabel(status)}</span>{status === 'done' ? (value.conclusion?.solved ? ` · ${t('自己做出来了')}` : ` · ${t('记入薄弱点')}`) : verdict ? ` · ${verdictText(verdict)}` : ''}</small>
          </Link>
        })}
      </aside>
      <main className="homework-main">
        {itemId && itemId !== 'new' && !item && store.loaded && <div className="empty-hint">{t('找不到这道题，可能已经被删除了。')}</div>}
        {itemId && itemId !== 'new' && !item && !store.loaded && <div className="empty-hint"><span className="mini-spinner" /></div>}
        {item ? <ProblemView key={item.id} course={course} item={item} store={store} setCourses={setCourses} notify={notify} account={account} />
          : (!itemId || itemId === 'new') && <NewProblem course={course} store={store} notify={notify} account={account} />}
        {itemId && <Link className="text-button homework-back" to={`/courses/${course.id}/homework`}><ArrowLeft size={14} />{t('全部题目')}</Link>}
      </main>
    </div>
  </div>
}
