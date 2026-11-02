import { Dispatch, ReactNode, SetStateAction } from 'react'
import { BrainCircuit } from 'lucide-react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { Course, Section } from './data'
import { t } from './i18n'

/** Update a single section inside the courses array immutably. */
export function updateSection(setCourses: Dispatch<SetStateAction<Course[]>>, courseId: string, sectionId: string, updater: (section: Section) => Section) {
  setCourses((current) => current.map((course) => course.id === courseId ? {
    ...course,
    sections: course.sections.map((section) => section.id === sectionId ? updater(section) : section),
  } : course))
}

const MARKDOWN_PLUGINS = { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS.remarkPlugins} rehypePlugins={MARKDOWN_PLUGINS.rehypePlugins}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

export function trimText(value: string, limit: number) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit).trim()}…` : clean
}

export function formatConceptLabel(value: string) {
  const clean = value.replace(/^\s*(?:\d+[.、)）:]|[-*•])\s*/, '').trim()
  return trimText(clean.split(/[：:。；;]/)[0] || clean, 18)
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div><div className="eyebrow">COURSE REPLAY · LEARNING OS</div><h1>{title}</h1><p>{subtitle}</p></div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  )
}

export function NotFound() {
  return <div className="not-found"><BrainCircuit size={40} /><h1>{t('这个学习节点还不存在')}</h1><p>{t('先回到课程空间选择一门课程吧。')}</p><Link className="button primary" to="/">{t('返回首页')}</Link></div>
}
