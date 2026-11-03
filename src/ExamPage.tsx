import { ArrowLeft, BookOpen, CalendarClock, CheckCircle2, CircleAlert, Dumbbell, FileUp, RefreshCw, Sparkles, Star, Trash2 } from 'lucide-react'
import { Dispatch, FormEvent, SetStateAction, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QuizQuestion, filesApi, practiceApi } from './api'
import { Course } from './data'
import { ExamPlan, ExamTopic, TopicInfo, TopicLevel, buildPlan, createPlan, daysUntil, emphasisByNode, nodeContent, recordAnswer, syncTopics, topicInfo } from './exam'
import { t, useLang } from './i18n'
import { PracticeDialog, PracticeTopic } from './Practice'
import { dayKey, sectionNodes } from './study'
import { Markdown, NotFound, PageHeader } from './ui'
import { updateCourse } from './WeakPanel'

type SetCourses = Dispatch<SetStateAction<Course[]>>
type Props = { courses: Course[]; setCourses: SetCourses; notify: (message: string) => void }

const levelLabel = (level?: TopicLevel) => level === 'known' ? t('已掌握') : level === 'shaky' ? t('不太稳') : level === 'unknown' ? t('不会') : t('未诊断')

function Setup({ course, plan, onSave, onCancel }: { course: Course; plan?: ExamPlan; onSave: (input: { name: string; date: string; sectionIds: string[]; minutesPerDay: number }) => void; onCancel?: () => void }) {
  const withNotes = course.sections.filter((section) => sectionNodes(section).length)
  const withoutNotes = course.sections.filter((section) => !sectionNodes(section).length)
  const [name, setName] = useState(plan?.name || t('期中考试'))
  const [date, setDate] = useState(plan?.date || dayKey(Date.now() + 7 * 86_400_000))
  const [minutes, setMinutes] = useState(plan?.minutesPerDay || 120)
  const [chosen, setChosen] = useState<string[]>(plan?.sectionIds || withNotes.map((section) => section.id))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!chosen.length || !date) return
    onSave({ name: name.trim() || t('考试'), date, sectionIds: chosen, minutesPerDay: Math.max(20, Math.min(600, Number(minutes) || 120)) })
  }
  return <form className="panel exam-setup" onSubmit={submit}>
    <div className="exam-setup-grid">
      <label>{t('考试名称')}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{t('考试日期')}<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>{t('每天能复习多久（分钟）')}<input type="number" min={20} max={600} step={10} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
    </div>
    <fieldset className="exam-scope"><legend>{t('考试范围')}</legend>
      {withNotes.map((section) => <label key={section.id}><input type="checkbox" checked={chosen.includes(section.id)} onChange={(event) => setChosen((current) => event.target.checked ? [...current, section.id] : current.filter((id) => id !== section.id))} /><span>{section.title}</span><small>{t('{n} 个知识点', { n: sectionNodes(section).length })}</small></label>)}
      {withoutNotes.map((section) => <label key={section.id} className="disabled" title={t('先在小节里生成笔记，才能诊断和排进计划')}><input type="checkbox" disabled /><span>{section.title}</span><small>{t('还没有笔记')}</small></label>)}
      {!withNotes.length && <p className="field-hint">{t('这门课还没有生成笔记的小节。先上传课件（或用「批量导入」导入课本）并生成笔记。')}</p>}
    </fieldset>
    <div className="modal-actions">{onCancel && <button type="button" className="button ghost" onClick={onCancel}>{t('取消')}</button>}<button className="button primary" disabled={!chosen.length}><Sparkles size={16} />{plan ? t('保存') : t('开始考前冲刺')}</button></div>
  </form>
}

/** Quick diagnosis: a few multiple-choice questions per knowledge point; known topics are then skipped. */
function Diagnosis({ course, plan, setCourses, notify }: { course: Course; plan: ExamPlan } & Omit<Props, 'courses'>) {
  const [running, setRunning] = useState<{ sectionId: string; questions: QuizQuestion[]; index: number; picked: number | null; tally: Record<string, { right: number; total: number }> } | null>(null)
  const [loading, setLoading] = useState('')
  const sections = course.sections.filter((section) => plan.sectionIds.includes(section.id))
  const topicsOf = (sectionId: string) => plan.topics.filter((topic) => topic.sectionId === sectionId)
  const diagnosed = plan.topics.filter((topic) => topic.level).length

  const setLevel = (keys: string[], level: TopicLevel) => updateCourse(setCourses, course.id, (current) => current.exam ? { ...current, exam: { ...current.exam, topics: current.exam.topics.map((topic) => keys.includes(topic.key) ? { ...topic, level } : topic) } } : current)

  const start = async (sectionId: string) => {
    const section = course.sections.find((item) => item.id === sectionId)
    const pending = topicsOf(sectionId).filter((topic) => !topic.level)
    if (!section || !pending.length) return
    setLoading(sectionId)
    try {
      const questions: QuizQuestion[] = []
      for (let i = 0; i < pending.length; i += 10) {
        const batch = pending.slice(i, i + 10)
        const payload = await practiceApi.quiz(`${course.title} · ${section.title}`, batch.map((topic) => ({ key: topic.key, title: topic.title, content: nodeContent(section, topic.nodeId).slice(0, 2500) })))
        questions.push(...payload.questions)
      }
      if (!questions.length) throw new Error(t('没有生成题目，请重试'))
      setRunning({ sectionId, questions, index: 0, picked: null, tally: {} })
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('出题失败'))
    } finally {
      setLoading('')
    }
  }

  const question = running?.questions[running.index]
  const topicOf = (key: string) => plan.topics.find((topic) => topic.key === key)
  const finishTopicIfDone = (state: NonNullable<typeof running>, key: string) => {
    const remaining = state.questions.slice(state.index + 1).some((item) => item.key === key)
    if (remaining) return
    const tally = state.tally[key]
    if (tally) setLevel([key], tally.right === tally.total ? 'known' : tally.right > 0 ? 'shaky' : 'unknown')
  }

  const pick = (option: number) => {
    if (!running || !question || running.picked !== null) return
    const right = option === question.answer
    const tally = { ...running.tally, [question.key]: { right: (running.tally[question.key]?.right || 0) + (right ? 1 : 0), total: (running.tally[question.key]?.total || 0) + 1 } }
    const next = { ...running, picked: option, tally }
    setRunning(next)
    const topic = topicOf(question.key)
    if (topic) updateCourse(setCourses, course.id, (current) => recordAnswer(current, {
      sectionId: topic.sectionId, nodeId: topic.nodeId, topic: topic.title, verdict: right ? 'correct' : 'wrong', kind: 'concept', source: 'diagnosis', question: question.question, note: right ? undefined : question.explanation,
    }))
    finishTopicIfDone(next, question.key)
  }

  // "我不会" / "我很熟": decide the topic now and skip its remaining questions.
  const decideTopic = (level: TopicLevel) => {
    if (!running || !question) return
    const key = question.key
    const topic = topicOf(key)
    setLevel([key], level)
    if (topic && level === 'unknown') updateCourse(setCourses, course.id, (current) => recordAnswer(current, { sectionId: topic.sectionId, nodeId: topic.nodeId, topic: topic.title, verdict: 'unknown', source: 'diagnosis', question: question.question, note: t('诊断时选了「我不会」') }))
    // Drop this topic's current and remaining questions; the answered ones before it stay in the count.
    const questions = running.questions.filter((item, index) => index < running.index || item.key !== key)
    if (running.index >= questions.length) { setRunning(null); notify(t('这一讲诊断完了，计划已更新')) }
    else setRunning({ ...running, questions, picked: null })
  }

  const next = () => {
    if (!running) return
    if (running.index + 1 >= running.questions.length) { setRunning(null); notify(t('这一讲诊断完了，计划已更新')); return }
    setRunning({ ...running, index: running.index + 1, picked: null })
  }

  if (running && question) {
    const topic = topicOf(question.key)
    return <section className="panel quiz-card">
      <div className="quiz-top"><span className="eyebrow">{t('诊断 · 第 {i} / {n} 题', { i: running.index + 1, n: running.questions.length })}</span><strong>{topic?.title}</strong></div>
      <div className="quiz-question"><Markdown className="on-dark practice-md">{question.question}</Markdown></div>
      <div className="quiz-options">{question.options.map((option, index) => <button key={index} disabled={running.picked !== null} onClick={() => pick(index)} className={running.picked === null ? '' : index === question.answer ? 'correct' : index === running.picked ? 'wrong' : ''}><span>{'ABCD'[index]}</span><Markdown className="on-dark practice-md">{option}</Markdown></button>)}</div>
      {running.picked !== null && <div className={`quiz-feedback ${running.picked === question.answer ? 'correct' : 'wrong'}`}>{running.picked === question.answer ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}<Markdown className="on-dark practice-md">{`${running.picked === question.answer ? t('答对了') : t('答错了')}${question.explanation ? `：${question.explanation}` : ''}`}</Markdown></div>}
      <div className="quiz-actions">
        {running.picked === null && <><button className="button ghost compact" onClick={() => decideTopic('unknown')}>{t('我不会这个')}</button><button className="button ghost compact" onClick={() => decideTopic('known')}>{t('我很熟，跳过')}</button></>}
        <span />
        {running.picked !== null && <button className="button primary compact" onClick={next}>{running.index + 1 >= running.questions.length ? t('完成') : t('下一题')}</button>}
        <button className="button ghost compact" onClick={() => setRunning(null)}>{t('先停在这里')}</button>
      </div>
    </section>
  }

  return <div className="diagnosis">
    <p className="field-hint">{t('每个知识点 2 道选择题：都对 = 已掌握（计划里跳过），对一道 = 不太稳，都错 = 不会。会的就点「我很熟，跳过」，不会的直接点「我不会这个」，省时间。')} {t('已诊断 {done} / {total} 个知识点', { done: diagnosed, total: plan.topics.length })}</p>
    {sections.map((section) => {
      const topics = topicsOf(section.id)
      const pending = topics.filter((topic) => !topic.level).length
      return <section className="panel diagnosis-section" key={section.id}>
        <div className="diagnosis-head"><strong>{section.title}</strong><span>{pending ? t('还有 {n} 个没诊断', { n: pending }) : t('已全部诊断')}</span>
          <button className="button secondary compact" disabled={!pending || Boolean(loading)} onClick={() => void start(section.id)}>{loading === section.id ? <RefreshCw className="spin-icon" size={14} /> : <Sparkles size={14} />}{loading === section.id ? t('出题中…') : t('开始诊断')}</button></div>
        <div className="diagnosis-topics">{topics.map((topic) => <span key={topic.key} className={`level-chip ${topic.level || 'none'}`} title={levelLabel(topic.level)}>{topic.title}<em>{levelLabel(topic.level)}</em></span>)}</div>
      </section>
    })}
  </div>
}

function PlanView({ course, plan, onPractice }: { course: Course; plan: ExamPlan; onPractice: (info: TopicInfo) => void }) {
  const result = useMemo(() => buildPlan(course, plan), [course, plan])
  const [showMastered, setShowMastered] = useState(false)
  const block = (info: TopicInfo) => <div className="plan-block" key={info.topic.key}>
    <div className="plan-block-main"><strong>{info.topic.title}</strong><small>{info.section.title} · {t('{n} 分钟', { n: info.minutes })}</small>
      <div className="plan-tags">{info.tags.map((tag) => <span key={tag} className={tag === t('老师强调过') ? 'stressed' : ''}>{tag === t('老师强调过') && <Star size={10} />}{tag}</span>)}</div></div>
    <div className="plan-block-actions">
      <Link className="button ghost compact" to={`/courses/${course.id}/sections/${info.topic.sectionId}/replay`} state={{ focus: info.topic.nodeId }}><BookOpen size={14} />{t('读笔记')}</Link>
      <button className="button secondary compact" onClick={() => onPractice(info)}><Dumbbell size={14} />{t('练 3 题')}</button>
    </div>
  </div>
  return <div className="plan">
    <p className="field-hint">{t('顺序：不会 → 不太稳 → 其它；老师强调过、往年考过、薄弱点会排得更前。每个知识点练对 2 题就算掌握，计划会自动重新排。')}</p>
    {result.days.map((day, index) => <section className={`panel plan-day ${index === 0 ? 'today' : ''}`} key={day.date}>
      <div className="plan-day-head"><strong>{day.label}</strong><span>{day.review ? t('考前一天') : day.minutes ? t('约 {n} 分钟', { n: day.minutes }) : ''}</span></div>
      {day.review ? <p className="plan-review">{t('不学新内容：把「薄弱点」里剩下的过一遍，再看一遍老师强调过的地方。')}</p>
        : day.blocks.length ? day.blocks.map(block) : <p className="plan-review">{t('这天没有安排，可以复习错题或休息。')}</p>}
    </section>)}
    {result.overflow.length > 0 && <section className="panel plan-overflow"><div className="plan-day-head"><strong><CircleAlert size={14} /> {t('时间不够，这些排不下')}</strong><span>{t('{n} 个知识点', { n: result.overflow.length })}</span></div>{result.overflow.map(block)}<p className="field-hint">{t('点「修改范围和时间」增加每天的复习时间；或者先诊断，会的知识点会被跳过。')}</p></section>}
    {result.mastered.length > 0 && <button className="text-button" onClick={() => setShowMastered((value) => !value)}>{t('已掌握、跳过的 {n} 个知识点', { n: result.mastered.length })}</button>}
    {showMastered && <div className="diagnosis-topics">{result.mastered.map((info) => <span key={info.topic.key} className="level-chip known">{info.topic.title}</span>)}</div>}
  </div>
}

function PastPapers({ course, plan, setCourses, notify }: { course: Course; plan: ExamPlan } & Omit<Props, 'courses'>) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const titles = new Map(plan.topics.map((topic) => [topic.key, topic.title]))
  const upload = async (files: FileList | null) => {
    const list = Array.from(files || [])
    if (!list.length) return
    for (const file of list) {
      setBusy(file.name)
      try {
        const stored = await filesApi.upload(file)
        const sections = new Map(course.sections.map((section) => [section.id, section]))
        const topics = plan.topics.slice(0, 200).map((topic) => ({ key: topic.key, title: `${sections.get(topic.sectionId)?.title || ''} · ${topic.title}` }))
        const result = await practiceApi.pastPaper([stored.id], topics)
        updateCourse(setCourses, course.id, (current) => current.exam ? { ...current, exam: {
          ...current.exam,
          pastPapers: [...(current.exam.pastPapers || []), file.name],
          pastQuestions: [...(current.exam.pastQuestions || []), ...result.questions.map((question) => ({ text: question.text, topicKey: question.topic_key, paper: file.name }))],
        } } : current)
        notify(t('已读完《{name}》：{n} 道题', { name: file.name, n: result.questions.length }))
      } catch (caught) {
        notify(caught instanceof Error ? caught.message : t('读试卷失败'))
      }
    }
    setBusy('')
  }
  const byTopic = new Map<string, string[]>()
  for (const question of plan.pastQuestions || []) {
    const key = question.topicKey || '__none'
    byTopic.set(key, [...(byTopic.get(key) || []), question.text])
  }
  const ranked = [...byTopic.entries()].sort((a, b) => (a[0] === '__none' ? 1 : b[0] === '__none' ? -1 : b[1].length - a[1].length))
  return <div className="past-papers">
    <p className="field-hint">{t('上传往年试卷（PDF 或照片）。AI 把每道题对应到知识点：考得多的知识点在计划里排得更前，针对练习也会照着这些题型出。')}</p>
    <button className="drop-zone" disabled={Boolean(busy)} onClick={() => input.current?.click()}><span>{busy ? <RefreshCw className="spin-icon" size={20} /> : <FileUp size={22} />}</span><strong>{busy ? t('正在读《{name}》…', { name: busy }) : t('上传往年试卷')}</strong><small>{(plan.pastPapers || []).length ? t('已读：{list}', { list: (plan.pastPapers || []).join('、') }) : t('还没有上传')}</small></button>
    <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.doc" onChange={(event) => { void upload(event.target.files); event.target.value = '' }} />
    {ranked.map(([key, questions]) => <section className="panel past-topic" key={key}>
      <div className="plan-day-head"><strong>{key === '__none' ? t('没对上知识点的题') : titles.get(key) || key}</strong><span>{t('{n} 道题', { n: questions.length })}</span></div>
      {questions.slice(0, 4).map((text, index) => <div className="past-question" key={index}><Markdown className="on-dark practice-md">{text}</Markdown></div>)}
    </section>)}
  </div>
}

/** 考前冲刺: diagnose what you don't know, then a day-by-day plan with targeted practice. */
export function ExamPage({ courses, setCourses, notify }: Props) {
  useLang()
  const { courseId = '' } = useParams()
  const course = courses.find((item) => item.id === courseId)
  const [tab, setTab] = useState<'diagnosis' | 'plan' | 'past'>('plan')
  const [editing, setEditing] = useState(false)
  const [practice, setPractice] = useState<{ info: TopicInfo; topic: PracticeTopic } | null>(null)
  if (!course) return <NotFound />
  const plan = course.exam ? { ...course.exam, topics: syncTopics(course.exam, course) } : undefined

  const save = (input: { name: string; date: string; sectionIds: string[]; minutesPerDay: number }) => {
    updateCourse(setCourses, course.id, (current) => {
      if (!current.exam) return { ...current, exam: createPlan(current, input) }
      const updated: ExamPlan = { ...current.exam, ...input }
      return { ...current, exam: { ...updated, topics: syncTopics(updated, current) } }
    })
    setEditing(false)
    if (!course.exam) setTab('diagnosis')
  }

  const openPractice = (info: TopicInfo) => {
    const content = nodeContent(info.section, info.topic.nodeId)
    const weak = (course.weakPoints || []).find((item) => item.sectionId === info.topic.sectionId && item.nodeId === info.topic.nodeId)
    const pastQuestions = (plan?.pastQuestions || []).filter((question) => question.topicKey === info.topic.key).map((question) => question.text)
    setPractice({ info, topic: { title: info.topic.title, content, pastQuestions, mistakes: weak?.evidence.map((item) => item.note || item.question) } })
  }

  const header = <><div className="back-row"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link><span>/</span><span>{t('考前冲刺')}</span></div></>
  if (!plan || editing) return <div className="page exam-page">{header}
    <PageHeader title={t('考前冲刺')} subtitle={t('先用几道题诊断哪些会、哪些不会，再按剩下的天数排出每天要复习什么；会的直接跳过。')} />
    <Setup course={course} plan={plan} onSave={save} onCancel={plan ? () => setEditing(false) : undefined} />
  </div>

  const left = daysUntil(plan.date)
  const infos = topicInfo(course, plan)
  const stressedSections = plan.sectionIds.map((id) => course.sections.find((section) => section.id === id)).filter(Boolean).map((section) => ({ section: section!, count: [...emphasisByNode(section!).values()].reduce((a, b) => a + b, 0) })).filter((item) => item.count)
  return <div className="page exam-page">{header}
    <PageHeader title={plan.name} subtitle={left > 0 ? t('还有 {n} 天 · {date}', { n: left, date: plan.date }) : left === 0 ? t('今天考试 · 加油') : t('考试已经过去了')}
      actions={<><button className="button secondary" onClick={() => setEditing(true)}><CalendarClock size={16} />{t('修改范围和时间')}</button><button className="icon-button" aria-label={t('删除这个考试计划')} title={t('删除这个考试计划')} onClick={() => { if (window.confirm(t('删除「{name}」的复习计划？诊断结果会一起删除，薄弱点会保留。', { name: plan.name }))) updateCourse(setCourses, course.id, (current) => ({ ...current, exam: undefined })) }}><Trash2 size={17} /></button></>} />
    <div className="overview-strip">
      <div><span>{t('知识点')}</span><strong>{plan.topics.length}</strong><small>{t('考试范围内')}</small></div>
      <div><span>{t('已诊断')}</span><strong>{plan.topics.filter((topic: ExamTopic) => topic.level).length}</strong><small>{t('会的会被跳过')}</small></div>
      <div><span>{t('已掌握')}</span><strong>{infos.filter((info) => info.mastered).length}</strong><small>{t('诊断全对或练对 2 题')}</small></div>
      <div className="overview-action"><span>{t('老师强调过')}</span><strong>{stressedSections.reduce((sum, item) => sum + item.count, 0)}</strong><small>{t('处（来自课堂转写）')}</small></div>
    </div>
    <div className="exam-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'diagnosis'} className={tab === 'diagnosis' ? 'active' : ''} onClick={() => setTab('diagnosis')}>{t('1 · 诊断')}</button>
      <button role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>{t('2 · 每日计划')}</button>
      <button role="tab" aria-selected={tab === 'past'} className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>{t('往年试卷')}{(plan.pastQuestions || []).length > 0 && <em>{plan.pastQuestions!.length}</em>}</button>
    </div>
    {tab === 'diagnosis' && <Diagnosis course={{ ...course, exam: plan }} plan={plan} setCourses={setCourses} notify={notify} />}
    {tab === 'plan' && <PlanView course={course} plan={plan} onPractice={openPractice} />}
    {tab === 'past' && <PastPapers course={course} plan={plan} setCourses={setCourses} notify={notify} />}
    {practice && <PracticeDialog topic={practice.topic} onClose={() => setPractice(null)} onResult={(result, question) => updateCourse(setCourses, course.id, (current) => recordAnswer(current.exam ? { ...current, exam: { ...current.exam, topics: syncTopics(current.exam, current) } } : current, {
      sectionId: practice.info.topic.sectionId, nodeId: practice.info.topic.nodeId, topic: practice.info.topic.title, verdict: result.verdict, kind: result.kind, source: 'practice', question, note: result.feedback,
    }))} />}
  </div>
}
