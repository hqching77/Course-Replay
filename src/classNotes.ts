import type { ClassQuestion, Section, TranscriptSegment } from './data'
import { normalizeMarkdown } from './data'
import { t } from './i18n'

/** Node ids for the 课上提问 group in 课堂重放. */
export const CLASS_NOTES_ID = 'class-notes'
export const classNodeId = (item: ClassQuestion) => `class-${item.id}`

export function formatClock(timestamp: number) {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** "14:17 · 第 12 分钟" */
export function classQuestionMeta(item: ClassQuestion, startedAt?: number) {
  const parts = [formatClock(item.askedAt)]
  if (startedAt && item.askedAt >= startedAt) parts.push(t('第 {n} 分钟', { n: Math.floor((item.askedAt - startedAt) / 60000) + 1 }))
  if (item.topic) parts.push(t('讲到：{topic}', { topic: item.topic }))
  return parts.join(' · ')
}

export function classAnswerMarkdown(item: ClassQuestion) {
  if (item.status === 'answering') return `_${t('回答生成中…')}_`
  if (item.status === 'failed') return `_${t('上课时没能拿到回答：{error}', { error: item.answer || t('请求失败') })}_`
  return normalizeMarkdown(item.answer)
}

const quoteLines = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n')

export function classQuestionMarkdown(item: ClassQuestion, section: Section) {
  return `## ${t('课上提问')}\n\n${quoteLines(`❓ ${item.question}`)}\n\n*${classQuestionMeta(item, section.liveStartedAt)}*\n\n${classAnswerMarkdown(item)}`
}

/** After-class note: every question asked during class with its answer. */
export function classNotesMarkdown(section: Section) {
  const questions = section.classQuestions || []
  const start = section.liveStartedAt
  const range = start ? `${formatClock(start)}${section.liveEndedAt ? `–${formatClock(section.liveEndedAt)}` : ''}` : ''
  const parts = [
    `## ${t('课堂提问笔记')}`,
    `> ${t('本节课共提出 {n} 个问题。', { n: questions.length })}${range ? ` ${t('上课时间 {range}。', { range })}` : ''}${t('以下是上课时 AI 的即时解答，可以在右侧向 AI 讲师继续追问。')}`,
  ]
  questions.forEach((item, index) => {
    parts.push(`### ${index + 1}. ${item.question.replace(/\s+/g, ' ').trim()}`)
    parts.push(`*${classQuestionMeta(item, start)}*`)
    parts.push(classAnswerMarkdown(item))
  })
  return parts.join('\n\n')
}

/** Plain text of the transcript (optionally only the last `maxChars`), for AI context and builds. */
export function transcriptText(segments: TranscriptSegment[] | undefined, maxChars?: number) {
  const text = (segments || []).map((segment) => segment.text.trim()).filter(Boolean).join('\n')
  return maxChars && text.length > maxChars ? text.slice(-maxChars) : text
}

/** Transcript as a readable note with timestamps, for 课堂重放. */
export function transcriptMarkdown(section: Section) {
  const segments = section.transcript || []
  const lines = segments.map((segment) => `**${formatClock(segment.startedAt)}** ${segment.text.replace(/\s+/g, ' ').trim()}`)
  return [`## ${t('课堂转写')}`, `> ${t('上课时的语音转文字，共 {n} 段。自动识别可能有错字。', { n: segments.length })}`, ...lines].join('\n\n')
}
