import { Dispatch, ReactNode, SetStateAction, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleHelp, FileText, Mic, MicOff, NotebookPen, Pause, Play, RefreshCw, Send, Settings, Sparkles, UploadCloud, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from './api'
import { addMaterialFiles, buildInputs, startSectionBuild } from './build'
import { CLASS_NOTES_ID, classQuestionMeta, formatClock, transcriptText } from './classNotes'
import { ClassQuestion, Course, normalizeMarkdown } from './data'
import { t, useLang } from './i18n'
import { useLive, useStartLiveClass } from './live'
import { Markdown, NotFound, PageHeader, updateSection } from './ui'
import { learnerMemory } from './memory'

type Props = { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; notify: (message: string) => void }

const FOLLOW_UPS = ['没听懂，换个说法', '举个具体例子', '这个公式怎么来的？', '和前面讲的有什么联系？'] // i18n-ok: translated where shown
const ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx,.odt,.odp,.md,.txt,.png,.jpg,.jpeg,.webp'

/** Sidebar 上课中: pick a course and start listening right away. */
export function LiveChooser({ courses, setCourses }: Props) {
  useLang()
  const live = useLive()
  const startLiveClass = useStartLiveClass(setCourses)
  const active = live.state.status !== 'idle' && live.state.courseId && live.state.sectionId
  const activeCourse = active ? courses.find((course) => course.id === live.state.courseId) : undefined
  const activeSection = activeCourse?.sections.find((section) => section.id === live.state.sectionId)
  return <div className="page live-chooser">
    <PageHeader title={t('上课中')} subtitle={t('选一门课，马上开始听课：自动新建本节课、实时转写老师讲的内容，随时提问和上传课件。')} />
    {activeCourse && activeSection && <Link className="live-resume" to={`/courses/${activeCourse.id}/sections/${activeSection.id}/live`}>
      <span className="live-dot" /><div><strong>{t('正在听课：{title}', { title: activeSection.title })}</strong><small>{activeCourse.title}</small></div><ArrowRight size={17} />
    </Link>}
    <div className="live-course-grid">
      {courses.map((course) => <button key={course.id} className="live-course" onClick={() => startLiveClass(course)}>
        <span className="course-swatch" style={{ background: course.accent }} />
        <strong>{course.title}</strong>
        <small>{t('{n} 个小节', { n: course.sections.length })}</small>
        <span className="live-course-go"><Mic size={15} />{t('开始上课')}</span>
      </button>)}
      {!courses.length && <div className="empty-hint">{t('还没有课程。先在课程空间创建一门课。')}</div>}
    </div>
  </div>
}

/**
 * 上课中: live transcript of the lecture, questions answered on the spot,
 * slides uploaded mid-class, and 下课 turns all of it into notes.
 */
export function LiveClass({ courses, setCourses, notify }: Props) {
  useLang()
  const { courseId = '', sectionId = '' } = useParams()
  const course = courses.find((item) => item.id === courseId)
  const section = course?.sections.find((item) => item.id === sectionId)
  const live = useLive()
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<'transcript' | 'questions'>('transcript')
  const [ending, setEnding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const qaRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const latest = useRef({ course, section })
  latest.current = { course, section }

  const isThis = live.state.sectionId === sectionId
  const listening = isThis && live.state.status === 'listening'
  const starting = isThis && live.state.status === 'starting'
  const segments = section?.transcript || []
  const questions = section?.classQuestions || []
  const pending = isThis ? live.state.pending : []
  const waiting = pending.filter((chunk) => chunk.status === 'queued').sort((a, b) => a.startedAt - b.startedAt)

  useEffect(() => {
    const feed = feedRef.current
    if (feed && stickToBottom.current) feed.scrollTo({ top: feed.scrollHeight })
  }, [segments.length, pending.length, live.state.interim, questions.length])

  useEffect(() => {
    const panel = qaRef.current
    if (panel) panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' })
  }, [questions.length])

  if (!course || !section) return <NotFound />

  const patch = (updater: Parameters<typeof updateSection>[3]) => updateSection(setCourses, course.id, section.id, updater)
  const patchQuestion = (id: string, changes: Partial<ClassQuestion>) => patch((current) => ({
    ...current,
    classQuestions: (current.classQuestions || []).map((item) => item.id === id ? { ...item, ...changes } : item),
  }))

  const requestAnswer = async (id: string, question: string, history: ClassQuestion[]) => {
    const current = latest.current.section
    try {
      const payload = await apiFetch<{ answer: string }>('/api/class/ask', {
        ai: true,
        json: {
          question,
          course_title: course.title,
          section_title: section.title,
          current_topic: '',
          summary: current?.analysis?.summary || course.description || '',
          key_concepts: current?.analysis?.key_concepts || [],
          recent: history.filter((item) => item.status === 'answered').slice(-3).map((item) => ({ question: item.question, answer: item.answer })),
          transcript: transcriptText(current?.transcript, 3000),
          learner_memory: learnerMemory(course.id, `${current?.title || section.title}\n${question}`),
        },
      })
      patchQuestion(id, { status: 'answered', answer: payload.answer, answeredAt: Date.now() })
    } catch (error) {
      patchQuestion(id, { status: 'failed', answer: error instanceof Error ? error.message : t('AI 回答失败') })
    }
  }

  const ask = (text?: string) => {
    const question = (text ?? draft).trim()
    if (!question) return
    const askedAt = Date.now()
    const item: ClassQuestion = { id: `cq-${askedAt}-${Math.random().toString(36).slice(2, 6)}`, question, answer: '', status: 'answering', askedAt }
    if (text === undefined) setDraft('')
    patch((current) => ({ ...current, liveStartedAt: current.liveStartedAt ?? askedAt, classQuestions: [...(current.classQuestions || []), item] }))
    void requestAnswer(item.id, question, questions)
  }

  const retry = (item: ClassQuestion) => {
    patchQuestion(item.id, { status: 'answering', answer: '' })
    void requestAnswer(item.id, item.question, questions.filter((other) => other.askedAt < item.askedAt))
  }

  const removeQuestion = (item: ClassQuestion) => {
    if (!window.confirm(t('从课堂提问记录中删除这个问题？'))) return
    patch((current) => ({ ...current, classQuestions: (current.classQuestions || []).filter((other) => other.id !== item.id) }))
  }

  const upload = (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files)
    if (fileRef.current) fileRef.current.value = ''
    void addMaterialFiles(setCourses, course.id, section.id, list).then(() => notify(t('已上传 {n} 个文件，下课生成笔记时会一起整理', { n: list.length })))
  }

  const endClass = async () => {
    setEnding(true)
    if (isThis) {
      await live.stop()
      await live.settle()
    }
    patch((current) => ({ ...current, liveEndedAt: Date.now() }))
    // Wait a tick so the transcript that just arrived is in `latest`.
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    const current = latest.current.section
    const currentCourse = latest.current.course
    if (current && currentCourse && buildInputs(current).any) {
      try {
        await startSectionBuild(setCourses, currentCourse, current)
        notify(t('已下课：正在根据转写、课件和提问生成课堂笔记'))
      } catch (error) {
        notify(error instanceof Error ? error.message : t('构建启动失败'))
      }
      navigate(`/courses/${course.id}/sections/${section.id}`)
      return
    }
    notify(questions.length ? t('已下课：{n} 个课堂提问已写进课后笔记', { n: questions.length }) : t('已下课'))
    navigate(`/courses/${course.id}/sections/${section.id}/replay`, { state: { focus: CLASS_NOTES_ID } })
  }

  // One time-ordered feed: what the teacher said, with your questions marked where you asked them.
  type FeedItem = { at: number; key: string; node: ReactNode }
  const feed: FeedItem[] = [
    ...segments.map((segment) => ({ at: segment.startedAt, key: segment.id, node: <div className="transcript-line" key={segment.id}><time>{formatClock(segment.startedAt)}</time><p>{segment.text}</p></div> })),
    ...questions.map((item, index) => ({ at: item.askedAt, key: item.id, node: <button className="transcript-question" key={item.id} onClick={() => { setTab('questions'); document.getElementById(`qa-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><CircleHelp size={13} /><span>{t('你在这里提问 #{n}：{question}', { n: index + 1, question: item.question })}</span></button> })),
    ...pending.filter((chunk) => chunk.status === 'transcribing').map((chunk) => ({ at: chunk.startedAt, key: chunk.id, node: <div className="transcript-line pending transcribing" key={chunk.id}><time>{formatClock(chunk.startedAt)}</time><p><span className="mini-spinner" />{t('识别中…')}</p></div> })),
    // Recordings waiting for recognition to work again: one quiet line, not one error per chunk.
    ...(waiting.length ? [{ at: waiting[0].startedAt, key: 'waiting', node: <div className="transcript-line pending queued" key="waiting"><time>{formatClock(waiting[0].startedAt)}</time><p>{t('{n} 段录音已保存，等语音识别恢复后自动补上', { n: waiting.length })}{live.state.dropped > 0 ? t('（最早的 {n} 段等太久，已丢弃）', { n: live.state.dropped }) : ''}<button onClick={live.retryAll}><RefreshCw size={11} />{t('立即重试')}</button></p></div> }] : []),
  ].sort((a, b) => a.at - b.at)
  const materials = section.materials
  const status = listening ? 'listening' : starting ? 'starting' : section.liveEndedAt ? 'ended' : 'paused'

  return <div className="replay-page live-page">
    <div className="replay-topbar live-topbar">
      <Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link>
      <div className={`live-status ${status}`}>
        {status === 'listening' && <><span className="live-dot" />{live.state.engine === 'browser' ? t('正在听课 · 浏览器识别') : t('正在听课')}<span className="level-meter" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0.04, live.state.level)})` }} /></span></>}
        {status === 'starting' && <><span className="mini-spinner" />{t('正在打开麦克风…')}</>}
        {status === 'paused' && <><MicOff size={14} />{t('未在听课')}</>}
        {status === 'ended' && <><MicOff size={14} />{t('已下课')}</>}
        <b className="live-section-title">{section.title}</b>
      </div>
      <div className="replay-actions live-actions">
        <button className="button secondary compact" onClick={() => fileRef.current?.click()}><UploadCloud size={14} /><span>{t('上传课件')}</span></button>
        {listening || starting
          ? <button className="button secondary compact" onClick={() => void live.stop()}><Pause size={14} /><span>{t('暂停听课')}</span></button>
          : <button className="button secondary compact" onClick={() => void live.start(course.id, section.id)}><Play size={14} /><span>{segments.length ? t('继续听课') : t('开始听课')}</span></button>}
        <button className="button primary compact" disabled={ending} onClick={() => void endClass()}>{ending ? <RefreshCw className="spin-icon" size={14} /> : <NotebookPen size={14} />}<span>{t('下课 · 生成笔记')}</span></button>
      </div>
    </div>
    <input ref={fileRef} type="file" multiple hidden accept={ACCEPT} onChange={(event) => upload(event.target.files)} />
    {isThis && live.state.error && <div className="live-banner"><CircleHelp size={16} /><p>{live.state.engine === 'browser' ? live.state.error : t('语音识别暂时不可用：{error}。录音会先保存，后台自动重试，恢复后转写会自己补上；这条提示只出现一次。', { error: live.state.error.replace(/[。.]$/, '') })}</p><Link to="/settings"><Settings size={13} />{t('去设置')}</Link><button aria-label={t('关闭')} onClick={live.dismissError}><X size={14} /></button></div>}
    <div className="live-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>{t('实时转写')}</button>
      <button role="tab" aria-selected={tab === 'questions'} className={tab === 'questions' ? 'active' : ''} onClick={() => setTab('questions')}>{t('提问')} {questions.length > 0 && <em>{questions.length}</em>}</button>
    </div>
    <div className={`live-grid live-tab-${tab}`}>
      <section className="live-transcript">
        <div className="live-feed" ref={feedRef} onScroll={(event) => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
          {feed.length === 0 && !live.state.interim && <div className="live-welcome">
            <span className="ai-avatar"><Mic size={20} /></span>
            <h2>{listening ? t('正在听，老师开口就会出现在这里') : t('点「开始听课」，老师讲的内容会实时转成文字')}</h2>
            <p>{t('听不懂随时在右边提问，AI 会结合老师刚讲的内容马上回答。课件可以随时上传；下课后，转写、课件和提问会一起整理成课堂笔记。')}</p>
            {!listening && !starting && <button className="button primary" onClick={() => void live.start(course.id, section.id)}><Mic size={15} />{t('开始听课')}</button>}
          </div>}
          {feed.map((item) => item.node)}
          {isThis && live.state.interim && <div className="transcript-line interim"><time>…</time><p>{live.state.interim}</p></div>}
        </div>
      </section>
      <aside className="live-side">
        {materials.length > 0 && <div className="live-docs">
          <span className="analysis-label"><FileText size={13} />{t('本节课件')}</span>
          <div>{materials.map((material) => <span key={material.id} className={`live-doc ${material.status}`} title={material.error || material.meta}>{material.status === 'uploading' ? <span className="mini-spinner" /> : <FileText size={12} />}{material.name}</span>)}</div>
        </div>}
        <div className="live-qa-list" ref={qaRef}>
          {questions.length === 0 && <div className="live-log-empty">{t('听不懂就直接问。AI 会结合老师刚讲的内容回答，问题会按时间记下来，下课后进入课堂笔记。')}</div>}
          {questions.map((item, index) => <article className="live-qa" id={`qa-${item.id}`} key={item.id}>
            <div className="live-q"><span>#{index + 1} · {classQuestionMeta(item, section.liveStartedAt)}</span><p>{item.question}</p><button className="live-log-delete" aria-label={t('删除这个问题')} onClick={() => removeQuestion(item)}><X size={12} /></button></div>
            <div className={`ai-message live-a ${item.status}`}>
              {item.status === 'answering'
                ? <div className="live-thinking"><span className="mini-spinner" />{t('正在回答…')}</div>
                : item.status === 'failed'
                  ? <div className="live-failed"><p>{item.answer || t('AI 回答失败')}</p><button onClick={() => retry(item)}><RefreshCw size={12} />{t('重试')}</button></div>
                  : <Markdown className="on-dark">{normalizeMarkdown(item.answer)}</Markdown>}
            </div>
          </article>)}
        </div>
        <div className="ask-box live-ask">
          {questions.length > 0 && <div className="quick-prompts">{FOLLOW_UPS.map((prompt) => <button key={prompt} onClick={() => ask(t(prompt))}>{t(prompt)}</button>)}</div>}
          <div className="ask-input"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask() } }} placeholder={t('哪里没听懂？直接问，Enter 发送')} /><button onClick={() => ask()} disabled={!draft.trim()} aria-label={t('发送')}><Send size={17} /></button></div>
          <small><Sparkles size={10} /> {t('回答会参考老师最近讲的内容')}</small>
        </div>
      </aside>
    </div>
  </div>
}
