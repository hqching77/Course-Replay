import { useSyncExternalStore } from 'react'
import { EN } from './i18n-en'

/**
 * Two-language UI. Source strings are the Chinese text itself:
 *   t('课程空间')            → '课程空间' | 'Courses'
 *   t('{n} 个小节', { n: 3 }) → '3 个小节' | '3 sections'
 * English lives in i18n-en.ts; anything missing falls back to Chinese
 * (scripts/check-i18n.mjs lists missing keys).
 */
export type Lang = 'zh' | 'en'

const LANG_KEY = 'course-replay-lang-v1'
const listeners = new Set<() => void>()

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    // ignore
  }
  return 'zh'
}

let current: Lang = readLang()
applyDocumentLang(current)

function applyDocumentLang(lang: Lang) {
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang) {
  if (lang === current) return
  current = lang
  try { localStorage.setItem(LANG_KEY, lang) } catch { /* ignore */ }
  applyDocumentLang(lang)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Re-render the calling component (and, from the root, the whole app) when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang)
}

export function t(source: string, vars?: Record<string, string | number | undefined>): string {
  const template = current === 'en' ? (EN[source] ?? source) : source
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (vars[key] === undefined ? match : String(vars[key])))
}

/** Pick between a Chinese and an English variant directly (for grammar that doesn't template well). */
export function tl(zh: string, en: string): string {
  return current === 'en' ? en : zh
}

export function formatDate(timestamp: number, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(current === 'en' ? 'en-US' : 'zh-CN', options).format(new Date(timestamp))
}

export function LanguageToggle({ className }: { className?: string }) {
  const lang = useLang()
  return (
    <div className={`lang-toggle ${className || ''}`} role="group" aria-label="Language / 语言">
      <button type="button" className={lang === 'zh' ? 'active' : ''} aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button>
      <button type="button" className={lang === 'en' ? 'active' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
    </div>
  )
}
