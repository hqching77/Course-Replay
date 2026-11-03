import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Merge, RefreshCw, Scissors, UploadCloud, X } from 'lucide-react'
import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ImportPart, ImportProposal, importApi, protectedBlobUrl } from './api'
import { Course, Material, createSection } from './data'
import { t, useLang } from './i18n'
import { NotFound, PageHeader } from './ui'

const ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx,.odt,.odp,.md,.txt,.png,.jpg,.jpeg,.webp'

interface Row {
  key: string
  number: number | null
  label: 'chapter' | 'lecture'
  name: string
  parts: ImportPart[]
  files: string[]
  excluded: string | null
  included: boolean
}

const excludedLabel = (reason: string) => ({
  front: t('封面与前置页'), preface: t('前言'), contents: t('目录'), index: t('索引'),
  references: t('参考文献'), notation: t('符号表'), other: t('附加内容'),
}[reason] || reason)

const methodLabel = (method: ImportProposal['method']) => ({
  bookmarks: t('来自 PDF 书签'), contents: t('来自目录页'), headings: t('来自章节大标题'),
  filenames: t('来自文件名'), manual: t('没找到章节结构，可以手动拆分'),
}[method])

function defaultName(number: number | null, label: string, title: string, excluded: string | null) {
  if (excluded && !title) return excludedLabel(excluded)
  if (number === null) return title || t('未编号')
  const head = label === 'lecture' ? t('第 {n} 讲', { n: number }) : t('第 {n} 章', { n: number })
  return title ? `${head} · ${title}` : head
}

const pagesOf = (parts: ImportPart[]) => parts.reduce((sum, part) => sum + Math.max(0, part.end - part.start + 1), 0)

function formatBytes(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** A page image from the import (needs the sign-in token, so it is fetched, not linked). */
function Thumb({ importId, file, page, caption }: { importId: string; file: number; page: number; caption: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let created = ''
    setUrl('')
    protectedBlobUrl(importApi.thumbPath(importId, file, page), controller.signal).then((value) => { created = value; setUrl(value) }).catch(() => undefined)
    return () => { controller.abort(); if (created) URL.revokeObjectURL(created) }
  }, [importId, file, page])
  return <figure className="import-thumb">{url ? <img src={url} alt={caption} /> : <span className="mini-spinner" />}<figcaption>{caption}</figcaption></figure>
}

/**
 * 导入课本 / 批量导入: upload → the proposed chapters (nothing is split yet) → review and adjust →
 * 确认拆分 creates one 小节 per chapter. 取消 deletes the temporary files.
 */
export function ImportPage({ courses, setCourses, notify }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; notify: (message: string) => void }) {
  useLang()
  const { courseId = '' } = useParams()
  const navigate = useNavigate()
  const course = courses.find((item) => item.id === courseId)
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'pick' | 'analyzing' | 'review' | 'applying'>('pick')
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<ImportProposal | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [upTo, setUpTo] = useState<number | ''>('')

  const book = proposal?.mode === 'book'
  const numbers = useMemo(() => [...new Set(rows.map((row) => row.number).filter((n): n is number => n !== null))].sort((a, b) => a - b), [rows])

  if (!course) return <NotFound />

  const analyze = async (list: FileList | null) => {
    const files = Array.from(list || [])
    if (!files.length) return
    setError('')
    setStep('analyzing')
    try {
      const result = await importApi.analyze(files)
      setProposal(result)
      setRows(result.chapters.map((chapter) => ({
        key: chapter.key, number: chapter.number, label: chapter.label, parts: chapter.parts, files: chapter.files, excluded: chapter.excluded,
        name: defaultName(chapter.number, chapter.label, chapter.title, chapter.excluded), included: !chapter.excluded,
      })))
      setUpTo('')
      setStep('review')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('分析失败'))
      setStep('pick')
    }
  }

  const patch = (key: string, changes: Partial<Row>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...changes } : row))

  // Move the cut between this chapter and its neighbour by one page (book mode).
  const nudge = (index: number, edge: 'start' | 'end', delta: number) => setRows((current) => {
    const next = current.map((row) => ({ ...row, parts: row.parts.map((part) => ({ ...part })) }))
    const row = next[index]
    const part = edge === 'start' ? row.parts[0] : row.parts[row.parts.length - 1]
    const value = part[edge] + delta
    const total = proposal?.total_pages || 1
    if (value < 1 || value > total) return current
    if (edge === 'start' && value > part.end) return current
    if (edge === 'end' && value < part.start) return current
    part[edge] = value
    const neighbour = edge === 'start' ? next[index - 1] : next[index + 1]
    if (neighbour) {
      const touching = edge === 'start' ? neighbour.parts[neighbour.parts.length - 1] : neighbour.parts[0]
      if (edge === 'start' && touching.end === value - 1 - delta) touching.end = value - 1
      if (edge === 'end' && touching.start === value + 1 - delta) touching.start = value + 1
      if (touching.end < touching.start) return current
    }
    return next
  })

  const mergeNext = (index: number) => setRows((current) => {
    const row = current[index]
    const other = current[index + 1]
    if (!other) return current
    const parts = [...row.parts, ...other.parts]
    const merged = book ? parts.reduce<ImportPart[]>((list, part) => {
      const last = list[list.length - 1]
      if (last && last.file_index === part.file_index && last.end + 1 >= part.start) last.end = Math.max(last.end, part.end)
      else list.push({ ...part })
      return list
    }, []) : parts
    return [...current.slice(0, index), { ...row, parts: merged, files: [...row.files, ...other.files], included: row.included || other.included }, ...current.slice(index + 2)]
  })

  const splitAt = (index: number) => {
    const row = rows[index]
    const part = row.parts[0]
    const answer = window.prompt(t('从第几页开始拆成新的一章？（{start}–{end}）', { start: part.start + 1, end: part.end }))
    const page = Number(answer)
    if (!answer || !Number.isInteger(page) || page <= part.start || page > part.end) return
    setRows((current) => [
      ...current.slice(0, index),
      { ...row, parts: [{ ...part, end: page - 1 }, ...row.parts.slice(1)] },
      { ...row, key: `${row.key}-${page}`, number: null, name: t('新章节'), excluded: null, included: true, parts: [{ ...part, start: page }] },
      ...current.slice(index + 1),
    ])
  }

  const moveFile = (fromIndex: number, partIndex: number, toKey: string) => setRows((current) => {
    const from = current[fromIndex]
    const part = from.parts[partIndex]
    const file = from.files[partIndex]
    return current
      .map((row, index) => index === fromIndex ? { ...row, parts: row.parts.filter((_, i) => i !== partIndex), files: row.files.filter((_, i) => i !== partIndex) }
        : row.key === toKey ? { ...row, parts: [...row.parts, part], files: [...row.files, file] } : row)
      .filter((row) => row.parts.length)
  })

  const applyUpTo = (value: number | '') => {
    setUpTo(value)
    setRows((current) => current.map((row) => row.number === null ? row : { ...row, included: value === '' || row.number <= value }))
  }

  const cancel = async () => {
    if (proposal) await importApi.cancel(proposal.import_id).catch(() => undefined)
    navigate(`/courses/${course.id}`)
  }

  const chosen = rows.filter((row) => row.included && row.parts.length)
  const skipped = rows.filter((row) => !row.included)
  const totalPages = chosen.reduce((sum, row) => sum + pagesOf(row.parts), 0)

  const confirm = async () => {
    if (!proposal || !chosen.length) return
    setStep('applying')
    setError('')
    try {
      const result = await importApi.apply(proposal.import_id, chosen.map((row) => ({ title: row.name.trim() || t('未命名章节'), parts: row.parts })))
      const sections = result.chapters.map((chapter, index) => {
        const row = chosen[index]
        const materials: Material[] = chapter.uploads.map((upload) => ({
          id: `material-${upload.id}`,
          name: upload.filename,
          type: (upload.filename.split('.').pop() || 'pdf').toUpperCase(),
          status: 'pending',
          uploadId: upload.id,
          pages: upload.pages || undefined,
          meta: `${upload.pages ? `${t('{n} 页', { n: upload.pages })} · ` : ''}${formatBytes(upload.size)} · ${t('已导入 · 待生成笔记')}`,
        }))
        return { ...createSection(chapter.title), chapter: row?.number ?? null, materials }
      })
      setCourses((current) => current.map((item) => item.id === course.id ? { ...item, sections: [...item.sections, ...sections], updated: t('刚刚') } : item))
      notify(t('已按章创建 {n} 个小节：打开一章，点「开始构建」生成笔记', { n: sections.length }))
      navigate(`/courses/${course.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('拆分失败'))
      setStep('review')
    }
  }

  return <div className="page import-page">
    <div className="back-row"><Link to={`/courses/${course.id}`}><ArrowLeft size={16} />{course.title}</Link><span>/</span><span>{t('导入课本 / 批量导入')}</span></div>
    <PageHeader title={t('导入课本 / 批量导入')} subtitle={t('一本课本 PDF 按书签、目录或章节标题自动分章；一批文件（1.1、1.2…）按文件名分章。拆分前先给你检查，确认后才会创建小节。')} />
    {error && <div className="api-error"><X size={16} /><div><strong>{t('出错了')}</strong><p>{error}</p></div></div>}

    {(step === 'pick' || step === 'analyzing') && <button className="drop-zone import-drop" disabled={step === 'analyzing'} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void analyze(event.dataTransfer.files) }}>
      {step === 'analyzing'
        ? <><span><RefreshCw className="spin-icon" size={22} /></span><strong>{t('正在读取章节结构…')}</strong><small>{t('不用 AI，600 页的课本也只要几秒')}</small></>
        : <><span><UploadCloud size={23} /></span><strong>{t('拖入一本课本 PDF，或一批讲义文件')}</strong><small>{t('例如「线性代数.pdf」，或 1.1.pdf、1.2.pdf … 4.2.pdf')}</small></>}
    </button>}
    <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(event) => { void analyze(event.target.files); event.target.value = '' }} />

    {proposal && (step === 'review' || step === 'applying') && <>
      <section className="panel import-summary">
        <div><span className="eyebrow">{methodLabel(proposal.method)}</span>
          <strong>{proposal.mode === 'book' ? t('{name} · {pages} 页', { name: proposal.files[0]?.name || '', pages: proposal.total_pages }) : t('{n} 个文件', { n: proposal.files.length })}</strong></div>
        {numbers.length > 1 && <label>{t('只导入到')}<select value={upTo} onChange={(event) => applyUpTo(event.target.value === '' ? '' : Number(event.target.value))}><option value="">{t('全部章节')}</option>{numbers.map((n) => <option key={n} value={n}>{t('第 {n} 章', { n })}</option>)}</select></label>}
      </section>

      <div className="import-rows">
        {rows.map((row, index) => {
          const first = row.parts[0]
          const last = row.parts[row.parts.length - 1]
          return <section key={row.key} className={`panel import-row ${row.included ? '' : 'skipped'}`}>
            <div className="import-row-head">
              <label className="import-check"><input type="checkbox" checked={row.included} onChange={(event) => patch(row.key, { included: event.target.checked })} aria-label={t('导入这一章')} /></label>
              <input className="import-title" value={row.name} onChange={(event) => patch(row.key, { name: event.target.value })} aria-label={t('章节名称')} />
              {row.excluded && <span className="import-reason">{t('{reason} · 自动排除', { reason: excludedLabel(row.excluded) })}</span>}
              <div className="import-actions">
                {book && pagesOf(row.parts) > 1 && <button className="icon-button tiny" title={t('在某一页拆开')} aria-label={t('在某一页拆开')} onClick={() => splitAt(index)}><Scissors size={14} /></button>}
                {index < rows.length - 1 && <button className="icon-button tiny" title={t('和下一章合并')} aria-label={t('和下一章合并')} onClick={() => mergeNext(index)}><Merge size={14} /></button>}
              </div>
            </div>
            {book ? <div className="import-range">
              <div className="import-edge">
                <Thumb importId={proposal.import_id} file={first.file_index} page={first.start} caption={t('第一页 · p.{page}', { page: first.start })} />
                <div className="import-nudge"><button className="icon-button tiny" aria-label={t('开始页往前一页')} onClick={() => nudge(index, 'start', -1)}><ChevronLeft size={14} /></button><span>p.{first.start}</span><button className="icon-button tiny" aria-label={t('开始页往后一页')} onClick={() => nudge(index, 'start', 1)}><ChevronRight size={14} /></button></div>
              </div>
              <div className="import-pages">{t('{n} 页', { n: pagesOf(row.parts) })}<small>p.{first.start}–{last.end}</small></div>
              <div className="import-edge">
                <Thumb importId={proposal.import_id} file={last.file_index} page={last.end} caption={t('最后一页 · p.{page}', { page: last.end })} />
                <div className="import-nudge"><button className="icon-button tiny" aria-label={t('结束页往前一页')} onClick={() => nudge(index, 'end', -1)}><ChevronLeft size={14} /></button><span>p.{last.end}</span><button className="icon-button tiny" aria-label={t('结束页往后一页')} onClick={() => nudge(index, 'end', 1)}><ChevronRight size={14} /></button></div>
              </div>
            </div> : <ul className="import-files">
              {row.parts.map((part, partIndex) => {
                const meta = proposal.files[part.file_index]
                return <li key={`${part.file_index}-${partIndex}`}><FileText size={14} /><span>{row.files[partIndex] || meta?.name}</span><small>{meta?.pages ? t('{n} 页', { n: meta.pages }) : formatBytes(meta?.size || 0)}</small>
                  {rows.length > 1 && <select aria-label={t('移到其他章')} value="" onChange={(event) => event.target.value && moveFile(index, partIndex, event.target.value)}><option value="">{t('移到…')}</option>{rows.filter((other) => other.key !== row.key).map((other) => <option key={other.key} value={other.key}>{other.name}</option>)}</select>}
                </li>
              })}
            </ul>}
          </section>
        })}
      </div>

      <div className="import-footer">
        <p>{t('将创建 {n} 个小节，共 {pages} 页', { n: chosen.length, pages: totalPages })}{skipped.length ? t('；不导入：{list}', { list: skipped.map((row) => row.name).slice(0, 6).join('、') + (skipped.length > 6 ? '…' : '') }) : ''}</p>
        <button className="button secondary" disabled={step === 'applying'} onClick={() => void cancel()}>{t('取消')}</button>
        <button className="button primary" disabled={!chosen.length || step === 'applying'} onClick={() => void confirm()}>{step === 'applying' ? <RefreshCw className="spin-icon" size={16} /> : <Scissors size={16} />}{t('确认拆分')}</button>
      </div>
    </>}
  </div>
}
