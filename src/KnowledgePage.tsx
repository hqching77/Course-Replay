import { ArrowLeftRight, BookOpen, Check, ChevronDown, CircleHelp, Search } from 'lucide-react'
import { Dispatch, SetStateAction, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Course } from './data'
import { declareKnowledge } from './exam'
import { t, useLang } from './i18n'
import { KnowledgeEntry, LEVELS, Level, crossLinks, knowledgeEntries, learnerMemory, levelLabel } from './memory'
import { PageHeader } from './ui'
import { updateCourse } from './WeakPanel'
import { kindLabel } from './weak'

type Props = { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>> }

function noteLink(entry: KnowledgeEntry) {
  return `/courses/${entry.courseId}/sections/${entry.sectionId}/replay`
}

function EntryRow({ entry, setCourses }: { entry: KnowledgeEntry; setCourses: Props['setCourses'] }) {
  const answers = entry.answers
  const stats = [
    answers?.right ? t('答对 {n} 次', { n: answers.right }) : '',
    answers?.wrong ? t('答错 {n} 次', { n: answers.wrong }) : '',
    entry.weak && entry.level !== 'mastered' ? kindLabel(entry.weak.kind) : '',
    answers?.self === 'known' ? t('你标记为会了') : answers?.self === 'unknown' ? t('你标记为还不会') : '',
  ].filter(Boolean).join(' · ')
  const declare = (self: 'known' | 'unknown') => updateCourse(setCourses, entry.courseId, (course) => declareKnowledge(course, entry.sectionId, entry.nodeId, self))
  return <div className="knowledge-row">
    <span className={`knowledge-level ${entry.level}`}>{levelLabel(entry.level)}</span>
    <div className="knowledge-text"><strong>{entry.title}</strong><small>{entry.sectionTitle}{stats ? ` · ${stats}` : ''}</small></div>
    <div className="knowledge-actions">
      <Link className="button ghost compact" to={noteLink(entry)} state={entry.nodeId ? { focus: entry.nodeId } : undefined}><BookOpen size={14} />{t('读笔记')}</Link>
      {entry.level !== 'mastered' && <button className="button ghost compact" onClick={() => declare('known')}><Check size={14} />{t('我会了')}</button>}
      {entry.level !== 'weak' && <button className="button ghost compact" onClick={() => declare('unknown')}><CircleHelp size={14} />{t('我还不会')}</button>}
    </div>
  </div>
}

/** 知识档案: everything the app knows about what you know, across all courses. */
export function KnowledgePage({ courses, setCourses }: Props) {
  useLang()
  const entries = useMemo(() => knowledgeEntries(courses), [courses])
  const links = useMemo(() => crossLinks(entries), [entries])
  const [filter, setFilter] = useState<Level | 'all'>('all')
  const [query, setQuery] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const counts = Object.fromEntries(LEVELS.map((level) => [level, entries.filter((entry) => entry.level === level).length])) as Record<Level, number>
  const needle = query.trim().toLowerCase()
  const shown = entries.filter((entry) => (filter === 'all' || entry.level === filter) && (!needle || `${entry.title} ${entry.sectionTitle} ${entry.courseTitle}`.toLowerCase().includes(needle)))
  const groups = courses.map((course) => ({ course, items: shown.filter((entry) => entry.courseId === course.id) })).filter((group) => group.items.length)

  return <div className="page knowledge-page">
    <PageHeader title={t('知识档案')} subtitle={t('你在所有课程里学过、答过的知识点。')} />
    <div className="overview-strip knowledge-overview">
      {(['mastered', 'shaky', 'weak', 'studied'] as Level[]).map((level) => <div key={level}><span>{levelLabel(level)}</span><strong>{counts[level] + (level === 'mastered' ? counts.known : 0)}</strong><small>{level === 'mastered' ? t('含答对过 {n} 个', { n: counts.known }) : level === 'shaky' ? t('答对过也答错过') : level === 'weak' ? t('答错了或你说还不会') : t('读过笔记，还没做过题')}</small></div>)}
    </div>

    {!entries.length && <div className="empty-hint">{t('还没有记录。读笔记、做题之后会出现在这里。')}</div>}

    {links.length > 0 && <section className="section-block">
      <div className="section-heading"><div><h2>{t('跨课程关联')}</h2><p>{t('不同课程里相关的知识点。')}</p></div></div>
      <div className="panel knowledge-links">{links.map(({ a, b, term }) => <div className="knowledge-link" key={`${a.key}|${b.key}`}>
        <em>{term}</em>
        <Link to={noteLink(a)} state={{ focus: a.nodeId }}><span>《{a.courseTitle}》</span>{a.title}<i className={`knowledge-level ${a.level}`}>{levelLabel(a.level)}</i></Link>
        <ArrowLeftRight size={14} />
        <Link to={noteLink(b)} state={{ focus: b.nodeId }}><span>《{b.courseTitle}》</span>{b.title}<i className={`knowledge-level ${b.level}`}>{levelLabel(b.level)}</i></Link>
      </div>)}</div>
    </section>}

    {entries.length > 0 && <section className="section-block">
      <div className="knowledge-toolbar">
        <div className="mode-switch" role="tablist">
          <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>{t('全部')} {entries.length}</button>
          {LEVELS.filter((level) => counts[level]).map((level) => <button key={level} role="tab" aria-selected={filter === level} className={filter === level ? 'active' : ''} onClick={() => setFilter(level)}>{levelLabel(level)} {counts[level]}</button>)}
        </div>
        <label className="knowledge-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索知识点或课程')} aria-label={t('搜索知识点或课程')} /></label>
      </div>
      {groups.map(({ course, items }) => <section className="panel knowledge-course" key={course.id}>
        <div className="knowledge-course-head"><Link to={`/courses/${course.id}`}>{course.title}</Link><span>{t('{n} 个知识点', { n: items.length })}</span></div>
        {items.map((entry) => <EntryRow key={entry.key} entry={entry} setCourses={setCourses} />)}
      </section>)}
      {!groups.length && <div className="empty-hint">{t('没有符合条件的知识点')}</div>}
    </section>}

    {entries.length > 0 && <section className="section-block">
      <button className="text-button" onClick={() => setShowPrompt((value) => !value)}>{t('AI 看到的档案')} <ChevronDown size={13} className={showPrompt ? 'flip' : ''} /></button>
      {showPrompt && <pre className="knowledge-prompt">{learnerMemory(undefined, '', courses)}</pre>}
    </section>}
  </div>
}
