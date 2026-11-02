import { useSyncExternalStore } from 'react'
import { getLang, t } from './i18n'

/** The user's semester: week 1 starts on `start` (a Monday), `weeks` teaching weeks. */
export interface Semester {
  start: string // YYYY-MM-DD
  weeks: number
  /** Custom name; empty = generated ("2026 秋" / "Fall 2026"). */
  name?: string
}

const KEY = 'course-replay-semester-v1'
const DAY = 86_400_000

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDay(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function firstMondayOnOrAfter(year: number, month: number, day: number) {
  const date = new Date(year, month, day)
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7))
  return date
}

/**
 * Best guess when the user hasn't set one (Tsinghua-style calendar): fall term from the
 * first Monday on/after 14 Sep (2026 → 14 Sep, so 3 Nov is week 8), spring from the first
 * Monday on/after 20 Feb; 16 weeks. Editable in the sidebar.
 */
export function defaultSemester(now = new Date()): Semester {
  const month = now.getMonth()
  const year = month === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const start = month >= 1 && month <= 6 ? firstMondayOnOrAfter(year, 1, 20) : firstMondayOnOrAfter(year, 8, 14)
  return { start: iso(start), weeks: 16 }
}

function read(): Semester {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as Semester | null
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved.start) && saved.weeks > 0) return saved
  } catch {
    // ignore unreadable settings
  }
  return defaultSemester()
}

let current = read()
const listeners = new Set<() => void>()

export function saveSemester(next: Semester | null) {
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: keep it for this session only
  }
  current = next || defaultSemester()
  listeners.forEach((listener) => listener())
}

export function useSemester() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => current)
}

export function isCustomSemester() {
  try { return Boolean(localStorage.getItem(KEY)) } catch { return false }
}

export function semesterName(semester: Semester) {
  if (semester.name?.trim()) return semester.name.trim()
  const start = parseDay(semester.start)
  const spring = start.getMonth() <= 6
  return getLang() === 'en' ? `${spring ? 'Spring' : 'Fall'} ${start.getFullYear()}` : `${start.getFullYear()} ${spring ? '春' : '秋'}` // i18n-ok: generated name per language
}

/** Week number today (1-based), clamped info for the progress bar and a label. */
export function semesterWeek(semester: Semester, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - parseDay(semester.start).getTime()) / DAY)
  const week = Math.floor(days / 7) + 1
  const label = days < 0 ? t('开学前 · 还有 {n} 天', { n: -days })
    : week > semester.weeks ? t('第 {total} 周已结束', { total: semester.weeks })
      : t('第 {week} 周 · 共 {total} 周', { week, total: semester.weeks })
  const fraction = Math.min(1, Math.max(0, (days + 1) / (semester.weeks * 7)))
  return { week, label, fraction, before: days < 0, after: week > semester.weeks }
}
