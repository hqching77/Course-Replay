import { BookOpen, Check, ChevronDown, Dumbbell, Target, X } from 'lucide-react'
import { Dispatch, SetStateAction, useState } from 'react'
import { Link } from 'react-router-dom'
import { Course } from './data'
import { nodeContent, recordAnswer } from './exam'
import { t, useLang } from './i18n'
import { Markdown } from './ui'
import { PracticeDialog, PracticeTopic } from './Practice'
import { WeakPoint, kindLabel, markMastered, removeWeakPoint, sourceLabel, statusLabel } from './weak'

type SetCourses = Dispatch<SetStateAction<Course[]>>

export function updateCourse(setCourses: SetCourses, courseId: string, update: (course: Course) => Course) {
  setCourses((current) => current.map((course) => course.id === courseId ? update(course) : course))
}

/** 薄弱点 on the course page: what you got wrong, why, and a way to practise it. */
export function WeakPanel({ course, setCourses }: { course: Course; setCourses: SetCourses }) {
  useLang()
  const [showMastered, setShowMastered] = useState(false)
  const [practice, setPractice] = useState<{ point: WeakPoint; topic: PracticeTopic } | null>(null)
  const list = course.weakPoints || []
  const active = list.filter((item) => item.status !== 'mastered').sort((a, b) => (a.status === b.status ? b.updatedAt - a.updatedAt : a.status === 'weak' ? -1 : 1))
  const mastered = list.filter((item) => item.status === 'mastered')
  const sectionTitle = (id?: string) => course.sections.find((section) => section.id === id)?.title || ''

  const openPractice = (point: WeakPoint) => {
    const section = course.sections.find((item) => item.id === point.sectionId)
    const content = nodeContent(section, point.nodeId) || point.topic
    const pastQuestions = (course.exam?.pastQuestions || []).filter((question) => point.nodeId && question.topicKey === `${point.sectionId}:${point.nodeId}`).map((question) => question.text)
    setPractice({ point, topic: { title: point.topic, content, pastQuestions, mistakes: point.evidence.map((item) => item.note || item.question) } })
  }

  const row = (point: WeakPoint) => {
    const last = point.evidence[point.evidence.length - 1]
    return <div className={`weak-item ${point.status}`} key={point.id}>
      <span className={`weak-status ${point.status}`}>{statusLabel(point.status)}</span>
      <div className="weak-text">
        <strong>{point.topic}</strong>
        <small>{kindLabel(point.kind)}{sectionTitle(point.sectionId) && sectionTitle(point.sectionId) !== point.topic ? ` · ${sectionTitle(point.sectionId)}` : ''} · {t('错 {n} 次', { n: point.evidence.length })}{point.status === 'improving' ? ` · ${t('再答对 {n} 次就算掌握', { n: Math.max(1, 2 - point.streak) })}` : ''}</small>
        {last?.note && <div className="weak-note" title={last.question}><Markdown className="on-dark">{`${sourceLabel(last.source)}：${last.note}`}</Markdown></div>}
      </div>
      <div className="weak-actions">
        {point.nodeId && point.sectionId && <Link className="button ghost compact" to={`/courses/${course.id}/sections/${point.sectionId}/replay`} state={{ focus: point.nodeId }}><BookOpen size={14} />{t('读笔记')}</Link>}
        {point.status !== 'mastered' && <button className="button secondary compact" onClick={() => openPractice(point)}><Dumbbell size={14} />{t('练习')}</button>}
        {point.status !== 'mastered' && <button className="icon-button tiny" title={t('标记为已掌握')} aria-label={t('标记为已掌握')} onClick={() => updateCourse(setCourses, course.id, (current) => markMastered(current, point.id))}><Check size={14} /></button>}
        <button className="icon-button tiny" title={t('删除')} aria-label={t('删除这个薄弱点')} onClick={() => updateCourse(setCourses, course.id, (current) => removeWeakPoint(current, point.id))}><X size={14} /></button>
      </div>
    </div>
  }

  return <section className="section-block weak-block">
    <div className="section-heading"><div><h2><Target size={16} /> {t('薄弱点')}</h2><p>{t('每道批改过的题都会记在这里（自测题、考前诊断、针对练习）；之后连续答对两次才算掌握。')}</p></div></div>
    {active.length ? <div className="weak-list">{active.map(row)}</div> : <div className="empty-hint">{list.length ? t('目前没有薄弱点，继续保持。') : t('还没有记录。在课堂重放里做自测题，或用「考前冲刺」诊断一下，答错的地方会出现在这里。')}</div>}
    {mastered.length > 0 && <button className="text-button weak-mastered-toggle" onClick={() => setShowMastered((value) => !value)}>{t('已掌握 {n} 个', { n: mastered.length })} <ChevronDown size={13} className={showMastered ? 'flip' : ''} /></button>}
    {showMastered && <div className="weak-list mastered">{mastered.map(row)}</div>}
    {practice && <PracticeDialog topic={practice.topic} onClose={() => setPractice(null)} onResult={(result, question) => updateCourse(setCourses, course.id, (current) => recordAnswer(current, {
      sectionId: practice.point.sectionId, nodeId: practice.point.nodeId, topic: practice.point.topic, verdict: result.verdict, kind: result.kind, source: 'practice', question, note: result.feedback,
    }))} />}
  </section>
}
