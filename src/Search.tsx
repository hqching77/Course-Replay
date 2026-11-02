import { BookOpen, FileText, FolderOpen, Layers, MessageCircleQuestion, Mic, Search, X } from 'lucide-react'
import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { classNodeId } from './classNotes'
import { Course } from './data'
import { t, useLang } from './i18n'
import { sectionNodes } from './study'

export const TRANSCRIPT_NODE_ID = 'class-transcript'
const OPEN_EVENT = 'course-replay:search'
const LIMIT = 40

type Kind = 'course' | 'section' | 'node' | 'question' | 'transcript' | 'file'
interface Entry { kind: Kind; title: string; body: string; where: string; to: string; focus?: string }
interface Hit extends Entry { score: number; snippet: string }

/** Open the search dialog from anywhere (the dashboard button, the sidebar…). */
export function openSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

function plain(markdown: string) {
  return markdown.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`$|\\]/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()
}

function buildIndex(courses: Course[]): Entry[] {
  const entries: Entry[] = []
  for (const course of courses) {
    entries.push({ kind: 'course', title: course.title, body: `${course.description} ${course.tags.join(' ')}`, where: t('课程'), to: `/courses/${course.id}` })
    for (const section of course.sections) {
      const base = `/courses/${course.id}/sections/${section.id}`
      const where = `${course.title} · ${section.title}`
      entries.push({ kind: 'section', title: section.title, body: section.analysis ? `${section.analysis.title} ${section.analysis.summary}` : '', where: course.title, to: base })
      for (const node of sectionNodes(section)) entries.push({ kind: 'node', title: node.title, body: `${node.summary} ${plain(node.content)}`, where, to: `${base}/replay`, focus: node.id })
      for (const item of section.classQuestions || []) entries.push({ kind: 'question', title: item.question, body: plain(item.answer || ''), where, to: `${base}/replay`, focus: classNodeId(item) })
      const transcript = (section.transcript || []).map((line) => line.text).join(' ')
      if (transcript) entries.push({ kind: 'transcript', title: t('课堂转写'), body: transcript, where, to: `${base}/replay`, focus: TRANSCRIPT_NODE_ID })
      for (const material of section.materials) entries.push({ kind: 'file', title: material.name, body: '', where, to: base })
    }
  }
  return entries
}

function snippetAround(text: string, at: number, length: number) {
  const start = Math.max(0, at - 28)
  const end = Math.min(text.length, at + length + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function search(entries: Entry[], query: string): Hit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const hits: Hit[] = []
  for (const entry of entries) {
    const title = entry.title.toLowerCase()
    const body = entry.body.toLowerCase()
    if (!terms.every((term) => title.includes(term) || body.includes(term))) continue
    const inTitle = terms.filter((term) => title.includes(term)).length
    const score = inTitle * 10 + (title.startsWith(terms[0]) ? 5 : 0) + (entry.kind === 'course' || entry.kind === 'section' ? 2 : entry.kind === 'node' ? 1 : 0)
    const bodyAt = body.indexOf(terms.find((term) => body.includes(term)) || '\u0000')
    hits.push({ ...entry, score, snippet: bodyAt >= 0 ? snippetAround(entry.body, bodyAt, terms[0].length) : entry.body.slice(0, 90) })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, LIMIT)
}

function highlight(text: string, query: string): ReactNode {
  const terms = query.trim().split(/\s+/).filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!terms.length) return text
  return text.split(new RegExp(`(${terms.join('|')})`, 'gi')).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)
}

const ICONS: Record<Kind, ReactNode> = {
  course: <FolderOpen size={15} />, section: <Layers size={15} />, node: <BookOpen size={15} />,
  question: <MessageCircleQuestion size={15} />, transcript: <Mic size={15} />, file: <FileText size={15} />,
}

function kindLabel(kind: Kind) {
  return { course: t('课程'), section: t('小节'), node: t('知识点'), question: t('课上提问'), transcript: t('课堂转写'), file: t('文件') }[kind]
}

/** Search across everything the user has: Ctrl/⌘+K or the search button. */
export function SearchDialog({ courses }: { courses: Course[] }) {
  useLang()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const show = () => { setOpen(true); setCursor(0) }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); show() }
    }
    window.addEventListener(OPEN_EVENT, show)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener(OPEN_EVENT, show); window.removeEventListener('keydown', onKey) }
  }, [])
  useEffect(() => { if (open) window.setTimeout(() => input.current?.select(), 0) }, [open])

  const index = useMemo(() => (open ? buildIndex(courses) : []), [open, courses])
  const hits = useMemo(() => search(index, query), [index, query])
  useEffect(() => { setCursor(0) }, [query])
  useEffect(() => { list.current?.querySelector('.search-hit.active')?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  if (!open) return null
  const close = () => setOpen(false)
  const go = (hit: Hit) => {
    close()
    navigate(hit.to, hit.focus ? { state: { focus: hit.focus } } : undefined)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') close()
    else if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((value) => Math.min(value + 1, hits.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((value) => Math.max(value - 1, 0)) }
    else if (event.key === 'Enter' && hits[cursor] && !event.nativeEvent.isComposing) { event.preventDefault(); go(hits[cursor]) }
  }
  return <div className="modal-backdrop search-backdrop" onMouseDown={close}>
    <div className="search-dialog" role="dialog" aria-label={t('搜索')} onMouseDown={(event) => event.stopPropagation()}>
      <div className="search-input"><Search size={18} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder={t('搜索课程、小节、知识点、课堂转写、提问和文件…')} aria-label={t('搜索内容')} /><button className="icon-button tiny" onClick={close} aria-label={t('关闭')}><X size={16} /></button></div>
      <div className="search-results" ref={list}>
        {!query.trim() && <p className="search-empty">{t('输入关键词，例如一个概念、老师讲过的一句话或文件名。')}<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> {t('随时打开搜索')}</p>}
        {query.trim() && !hits.length && <p className="search-empty">{t('没有找到「{query}」', { query: query.trim() })}</p>}
        {hits.map((hit, position) => <button key={`${hit.kind}-${hit.to}-${hit.focus || ''}-${position}`} className={`search-hit ${position === cursor ? 'active' : ''}`} onMouseEnter={() => setCursor(position)} onClick={() => go(hit)}>
          <span className={`search-kind kind-${hit.kind}`}>{ICONS[hit.kind]}</span>
          <span className="search-text"><strong>{highlight(hit.title, query)}</strong>{hit.snippet && <small>{highlight(hit.snippet, query)}</small>}<em>{kindLabel(hit.kind)} · {hit.where}</em></span>
        </button>)}
      </div>
    </div>
  </div>
}
