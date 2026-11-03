import { FormEvent, useState } from 'react'
import { t, useLang } from './i18n'
import { Semester, defaultSemester, isCustomSemester, saveSemester, semesterName, semesterWeek, startForCurrentWeek, useSemester } from './semester'

/**
 * Set the semester the way students know it: "this is week 8" (or the week-1 Monday),
 * plus how many weeks the school's term has. Used in the sidebar and in 设置.
 */
export function SemesterForm({ onDone }: { onDone?: () => void }) {
  useLang()
  const semester = useSemester()
  const [draft, setDraft] = useState<Semester>({ ...semester, name: semester.name || '' })
  const week = semesterWeek(draft).week
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.start)) return
    saveSemester({ start: draft.start, weeks: Math.min(30, Math.max(1, Math.round(Number(draft.weeks) || 16))), name: draft.name?.trim() || undefined })
    onDone?.()
  }
  return <form className="semester-form" onSubmit={save}>
    <div className="semester-form-row">
      <label>{t('现在是第几周')}<input type="number" min={1} max={30} value={week >= 1 ? week : ''} placeholder="—" onChange={(event) => { const value = Number(event.target.value); if (value >= 1) setDraft({ ...draft, start: startForCurrentWeek(value) }) }} /></label>
      <label>{t('共几周')}<input type="number" min={1} max={30} required value={draft.weeks} onChange={(event) => setDraft({ ...draft, weeks: Number(event.target.value) })} /></label>
    </div>
    <label>{t('第 1 周的周一')}<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
    <label>{t('学期名称')}<input value={draft.name || ''} maxLength={40} placeholder={semesterName({ ...draft, name: '' })} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <small className="semester-form-hint">{t('填现在是第几周，第 1 周的日期会自动算出。')}</small>
    <div className="semester-actions">
      {isCustomSemester() && <button type="button" className="text-button" onClick={() => { saveSemester(null); setDraft({ ...defaultSemester(), name: '' }); onDone?.() }}>{t('恢复默认')}</button>}
      <button type="submit" className="button primary compact">{t('保存')}</button>
    </div>
  </form>
}
