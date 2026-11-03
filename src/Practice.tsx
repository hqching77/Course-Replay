import { CheckCircle2, ChevronDown, CircleAlert, Lightbulb, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GradeResult, PracticeProblem, practiceApi } from './api'
import { t, useLang } from './i18n'
import { Markdown } from './ui'
import { kindLabel } from './weak'

export const verdictLabel = (verdict: GradeResult['verdict']) => ({ correct: t('正确'), partial: t('部分正确'), wrong: t('错误') }[verdict])

/** A marked answer: verdict, what went wrong, the answer — full steps only when asked for. */
export function GradeView({ result, dark = false }: { result: GradeResult; dark?: boolean }) {
  const [steps, setSteps] = useState(false)
  const Icon = result.verdict === 'correct' ? CheckCircle2 : CircleAlert
  return <div className={`grade-view ${result.verdict}`}>
    <div className="grade-head"><Icon size={16} /><strong>{verdictLabel(result.verdict)}</strong>{result.kind && <span className="grade-kind">{kindLabel(result.kind)}</span>}</div>
    {result.feedback && <Markdown className={dark ? 'on-dark' : 'on-dark practice-md'}>{result.feedback}</Markdown>}
    {result.verdict !== 'correct' && result.answer && <div className="grade-answer"><span>{t('正确答案')}</span><Markdown className={dark ? 'on-dark' : 'on-dark practice-md'}>{result.answer}</Markdown></div>}
    {result.solution && <button className="text-button grade-steps-toggle" onClick={() => setSteps((value) => !value)}>{steps ? t('收起完整步骤') : t('看完整步骤')} <ChevronDown size={13} className={steps ? 'flip' : ''} /></button>}
    {steps && <div className="grade-steps"><Markdown className={dark ? 'on-dark' : 'on-dark practice-md'}>{result.solution}</Markdown></div>}
  </div>
}

export interface PracticeTopic {
  title: string
  content: string
  pastQuestions?: string[]
  mistakes?: string[]
}

/**
 * 针对练习: a few problems on one weak topic, each marked by the AI. Every result is reported
 * to onResult (weak points / exam progress are updated by the caller).
 */
export function PracticeDialog({ topic, onClose, onResult }: { topic: PracticeTopic; onClose: () => void; onResult: (result: GradeResult, question: string) => void }) {
  useLang()
  const [problems, setProblems] = useState<PracticeProblem[] | null>(null)
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [hint, setHint] = useState(false)
  const [grading, setGrading] = useState(false)
  const [results, setResults] = useState<(GradeResult | undefined)[]>([])

  useEffect(() => {
    let active = true
    practiceApi.problems({ topic: topic.title, content: topic.content, count: 3, past_questions: topic.pastQuestions?.slice(0, 5), mistakes: topic.mistakes?.slice(-5) })
      .then((payload) => { if (active) setProblems(payload.problems) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : t('出题失败')) })
    return () => { active = false }
  }, [topic])

  const problem = problems?.[index]
  const result = results[index]
  const submit = async () => {
    if (!problem || !answer.trim() || grading) return
    setGrading(true)
    setError('')
    try {
      const graded = await practiceApi.grade({ question: problem.question, answer: answer.trim(), topic: topic.title, reference: `${topic.content.slice(0, 5000)}\n\n${t('参考答案')}：${problem.answer}` })
      setResults((current) => { const next = [...current]; next[index] = graded; return next })
      onResult(graded, problem.question)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('批改失败'))
    } finally {
      setGrading(false)
    }
  }
  const next = () => { setIndex((value) => value + 1); setAnswer(''); setHint(false) }
  const correct = results.filter((item) => item?.verdict === 'correct').length

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal practice-dialog" role="dialog" aria-label={t('针对练习')} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">{t('针对练习')}</span><h2>{topic.title}</h2></div><button type="button" className="icon-button" aria-label={t('关闭')} onClick={onClose}><X size={18} /></button></div>
      {error && <p className="practice-error">{error}</p>}
      {!problems && !error && <p className="practice-loading"><span className="mini-spinner" />{t('正在根据讲稿和你的错误出题…')}</p>}
      {problems && problem && <div className="practice-body">
        <span className="practice-count">{t('第 {i} / {n} 题', { i: index + 1, n: problems.length })}</span>
        <div className="practice-question"><Markdown className="on-dark practice-md">{problem.question}</Markdown></div>
        {problem.hint && !result && (hint ? <div className="practice-hint"><Lightbulb size={14} /><Markdown className="on-dark practice-md">{problem.hint}</Markdown></div> : <button className="text-button" onClick={() => setHint(true)}><Lightbulb size={13} />{t('给我提示')}</button>)}
        {!result && <textarea className="review-answer practice-answer" value={answer} disabled={grading} onChange={(event) => setAnswer(event.target.value)} placeholder={t('写下你的答案或关键步骤…')} />}
        {result && <GradeView result={result} />}
        <div className="modal-actions">
          {!result && <button className="button primary" disabled={!answer.trim() || grading} onClick={() => void submit()}>{grading ? <RefreshCw className="spin-icon" size={15} /> : null}{t('提交批改')}</button>}
          {result && index < problems.length - 1 && <button className="button primary" onClick={next}>{t('下一题')}</button>}
          {result && index === problems.length - 1 && <><span className="practice-score">{t('答对 {c} / {n} 题', { c: correct, n: problems.length })}</span><button className="button primary" onClick={onClose}>{t('完成')}</button></>}
        </div>
      </div>}
    </div>
  </div>
}
