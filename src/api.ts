import type { Course } from './data'
import { getLang, t } from './i18n'
import { chatHeaders, sttHeaders } from './settings'

// Backend origin. Empty = same origin (Vite dev proxy). Set VITE_API_BASE at build time to point a hosted frontend at a deployed backend.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

const TOKEN_KEY = 'course-replay-auth-token-v1'

export interface User {
  id: string
  username: string
  display_name: string
  created_at: string
  preferences?: { semester?: { start: string; weeks: number; name?: string } }
}

// Server messages with a variable part (file name, size, provider error) → translated template.
const DETAIL_PATTERNS: [RegExp, string][] = [
  [/^不支持的文件格式：(?<name>.+)$/s, '不支持的文件格式：{name}'], // i18n-ok: server message pattern
  [/^文件不能超过 (?<mb>\d+) MB：(?<name>.+)$/s, '文件不能超过 {mb} MB：{name}'], // i18n-ok: server message pattern
  [/^文件不能超过 (?<mb>\d+) MB$/, '文件不能超过 {mb} MB'], // i18n-ok: server message pattern
  [/^本次上传总大小不能超过 (?<mb>\d+) MB$/, '本次上传总大小不能超过 {mb} MB'], // i18n-ok: server message pattern
  [/^音频不能超过 (?<mb>\d+) MB$/, '音频不能超过 {mb} MB'], // i18n-ok: server message pattern
  [/^一次最多导入 (?<n>\d+) 个文件$/, '一次最多导入 {n} 个文件'], // i18n-ok: server message pattern
  [/^AI 回答失败：(?<error>.+)$/s, 'AI 回答失败：{error}'], // i18n-ok: server message pattern
  [/^AI 读试卷失败：(?<error>.+)$/s, 'AI 读试卷失败：{error}'], // i18n-ok: server message pattern
  [/^AI 读图失败：(?<error>.+)$/s, 'AI 读图失败：{error}'], // i18n-ok: server message pattern
  [/^只支持这些网盘的共享链接：(?<hosts>.+)$/s, '只支持这些网盘的共享链接：{hosts}'], // i18n-ok: server message pattern
]

function translateDetail(detail: string) {
  for (const [pattern, key] of DETAIL_PATTERNS) {
    const match = detail.match(pattern)
    if (match) return t(key, match.groups)
  }
  return t(detail)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let authToken: string | null = readStoredToken()

function readStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function getToken() { return authToken }

export function setToken(token: string | null) {
  authToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable (private mode) — the token still lives for this tab
  }
}

/** Absolute URL for a backend path such as a material preview link. */
export function apiUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`
}

/** ai / stt: attach the user's own provider (from 设置) for endpoints that call a model. */
type ApiOptions = { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal; ai?: boolean; stt?: boolean; keepalive?: boolean }

/** fetch() against the backend with the session token attached; throws ApiError on non-2xx. */
export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-UI-Language': getLang() }
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  if (options.ai) Object.assign(headers, chatHeaders())
  if (options.stt) Object.assign(headers, sttHeaders())
  let body = options.body
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  let response: Response
  try {
    response = await fetch(apiUrl(path), { method: options.method || (body ? 'POST' : 'GET'), headers, body, signal: options.signal, keepalive: options.keepalive })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(getLang() === 'en' ? "Can't reach the server — check your connection and try again" : '无法连接服务器，请检查网络后重试', 0) // i18n-ok: bilingual
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof payload.detail === 'string' ? payload.detail : Array.isArray(payload.detail) ? describeValidation(payload.detail) : ''
    throw new ApiError((detail && translateDetail(detail)) || (getLang() === 'en' ? `Request failed (HTTP ${response.status})` : `请求失败（HTTP ${response.status}）`), response.status) // i18n-ok: bilingual
  }
  return payload as T
}

function describeValidation(items: { loc?: unknown[]; msg?: string }[]) {
  const field = String(items[0]?.loc?.slice(-1)[0] || '')
  const en = getLang() === 'en'
  const names: Record<string, string> = en
    ? { username: 'Username must be 2–32 letters, digits, Chinese characters or _ . @ -', password: 'Password must be at least 6 characters', display_name: 'Display name cannot be empty' }
    : { username: '用户名需为 2-32 位字母、数字、中文或 _ . @ -', password: '密码至少 6 位', display_name: '昵称不能为空' } // i18n-ok: bilingual
  return names[field] || items[0]?.msg || (en ? 'Invalid input' : '输入有误') // i18n-ok: bilingual
}

/**
 * Open a file served by the backend (e.g. a document preview) in a new tab.
 * Previews are private to their owner, so the request carries the sign-in token
 * and the tab shows a local copy.
 */
/** An image (or other file) from the backend that needs the sign-in token, as a local blob URL. */
export async function protectedBlobUrl(path: string, signal?: AbortSignal) {
  const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {}
  const response = await fetch(apiUrl(path), { headers, signal })
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status)
  return URL.createObjectURL(await response.blob())
}

export interface ImportPart { file_index: number; start: number; end: number }
export interface ImportChapter { key: string; number: number | null; label: 'chapter' | 'lecture'; title: string; parts: ImportPart[]; pages: number; files: string[]; excluded: string | null }
/** title: the largest text on page 1; preview: pages can be shown (PDFs and images). */
export interface ImportFileMeta { name: string; pages: number | null; size: number; title: string; preview: boolean }
export interface ImportProposal {
  import_id: string
  mode: 'book' | 'files'
  method: 'bookmarks' | 'contents' | 'headings' | 'filenames' | 'manual'
  total_pages: number
  files: ImportFileMeta[]
  chapters: ImportChapter[]
}
export interface AppliedImport { chapters: { title: string; uploads: { id: string; filename: string; size: number; pages: number | null }[] }[] }

export interface QuizQuestion { key: string; question: string; options: string[]; answer: number; explanation: string }
export interface GradeResult { verdict: 'correct' | 'partial' | 'wrong'; kind: 'concept' | 'start' | 'calc' | 'careless' | null; feedback: string; answer: string; solution: string }
export interface PracticeProblem { question: string; answer: string; hint: string }
type TopicPayload = { key: string; title: string; content?: string }

/** Weak points and 考前冲刺: diagnosis questions, marking, targeted practice, past papers. */
export const practiceApi = {
  quiz: (courseTitle: string, topics: TopicPayload[], perTopic = 2) =>
    apiFetch<{ questions: QuizQuestion[] }>('/api/practice/quiz', { ai: true, json: { course_title: courseTitle, topics, per_topic: perTopic } }),
  grade: (payload: { question: string; answer: string; topic?: string; reference?: string }) =>
    apiFetch<GradeResult>('/api/practice/grade', { ai: true, json: payload }),
  problems: (payload: { topic: string; content?: string; count?: number; past_questions?: string[]; mistakes?: string[]; learner_memory?: string }) =>
    apiFetch<{ problems: PracticeProblem[] }>('/api/practice/problems', { ai: true, json: payload }),
  pastPaper: (uploadIds: string[], topics: TopicPayload[]) =>
    apiFetch<{ questions: { text: string; topic_key: string | null }[] }>('/api/practice/past-paper', { ai: true, json: { upload_ids: uploadIds, topics } }),
}

/** 导入课本 / 批量导入: propose chapters (read-only), then split only when the user confirms. */
export const importApi = {
  analyze: (files: File[]) => {
    const form = new FormData()
    files.forEach((file) => form.append('files', file, file.name))
    return apiFetch<ImportProposal>('/api/import/analyze', { method: 'POST', body: form })
  },
  apply: (importId: string, chapters: { title: string; parts: ImportPart[] }[]) => apiFetch<AppliedImport>(`/api/import/${importId}/apply`, { method: 'POST', json: { chapters } }),
  cancel: (importId: string) => apiFetch<void>(`/api/import/${importId}`, { method: 'DELETE' }),
  thumbPath: (importId: string, file: number, page: number, width = 260) => `/api/import/${importId}/thumb?file=${file}&page=${page}&width=${width}`,
}

export async function openProtectedFile(path: string) {
  const tab = window.open('', '_blank') // open now, inside the click, so pop-up blockers allow it
  try {
    const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {}
    const response = await fetch(apiUrl(path), { headers })
    if (!response.ok) throw new ApiError(getLang() === 'en' ? "Couldn't open the document" : '打不开这个文档', response.status) // i18n-ok
    let blob = await response.blob()
    // Show notes (.md / .txt) as readable text instead of downloading them.
    if (blob.type.startsWith('text/')) blob = new Blob([blob], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    if (tab) tab.location.href = url
    else {
      const link = document.createElement('a') // pop-up blocked: download it instead of leaving the app
      link.href = url
      link.download = ''
      link.click()
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (error) {
    tab?.close()
    throw error
  }
}

export async function serverReachable() {
  try {
    const response = await fetch(apiUrl('/api/health'))
    if (!response.ok) return false
    const payload = await response.json().catch(() => null)
    return Boolean(payload && payload.status === 'ok')
  } catch {
    return false
  }
}

// ---- accounts ----

type AuthResponse = { token: string; user: User }

export const authApi = {
  register: (username: string, password: string, displayName: string) =>
    apiFetch<AuthResponse>('/api/auth/register', { json: { username, password, display_name: displayName } }),
  login: (username: string, password: string) =>
    apiFetch<AuthResponse>('/api/auth/login', { json: { username, password } }),
  me: () => apiFetch<User>('/api/auth/me'),
  rename: (displayName: string) => apiFetch<User>('/api/auth/me', { method: 'PATCH', json: { display_name: displayName } }),
  savePreferences: (preferences: User['preferences'] | { semester: null }) => apiFetch<User>('/api/auth/me', { method: 'PATCH', json: { preferences } }),
  logout: () => apiFetch<void>('/api/auth/logout', { method: 'POST' }),
}

// ---- workspace (per-user course data) ----

/** keepalive: let the request finish while the page is closing (bodies up to ~64 KB). */
export const workspaceApi = {
  load: () => apiFetch<{ courses: Course[] }>('/api/workspace').then((payload) => payload.courses),
  putCourse: (course: Course, position: number, keepalive = false) => {
    const { sections, ...fields } = course
    return apiFetch<void>('/api/workspace/course', { method: 'PUT', json: { ...fields, position, sectionIds: sections.map((section) => section.id) }, keepalive })
  },
  putSection: (courseId: string, section: Course['sections'][number], position: number, keepalive = false) =>
    apiFetch<void>('/api/workspace/section', { method: 'PUT', json: { courseId, position, section }, keepalive }),
  deleteCourse: (courseId: string, keepalive = false) =>
    apiFetch<void>(`/api/workspace/course?id=${encodeURIComponent(courseId)}`, { method: 'DELETE', keepalive }),
}

// ---- files and speech ----

export interface HealthInfo {
  status: string
  version: string
  configured: boolean
  base_url: string
  model: string | null
  office_conversion: boolean
  stt_configured: boolean
  stt_base_url: string
  stt_model: string | null
  database: string
  ai_requires_login: boolean
  custom_providers: boolean
}

export const filesApi = {
  /** Store a course file on the server right away so it survives reloads until it's built. */
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<{ id: string; filename: string; size: number; pages: number | null }>('/api/uploads', { method: 'POST', body: form })
  },
  transcribe: (audio: Blob, options: { language?: string; prompt?: string; signal?: AbortSignal } = {}) => {
    const form = new FormData()
    form.append('file', audio, `chunk-${Date.now()}.wav`)
    if (options.language) form.append('language', options.language)
    if (options.prompt) form.append('prompt', options.prompt)
    return apiFetch<{ text: string; model: string; source: string; latency_ms: number }>('/api/transcribe', { method: 'POST', body: form, stt: true, signal: options.signal })
  },
  health: () => apiFetch<HealthInfo>('/api/health'),
  checkStt: () => apiFetch<{ ok: boolean; source: string; base_url: string; model: string; latency_ms: number | null; error: string | null }>('/api/stt/check', { method: 'POST', stt: true }),
  checkAi: () => apiFetch<{ ok: boolean; source: string; base_url: string; model: string | null; latency_ms: number | null; reply: string | null; error: string | null }>('/api/ai/check', { method: 'POST', ai: true }),
}

// ---------------------------------------------------------------------------
// 题目答疑
// ---------------------------------------------------------------------------

export interface HomeworkRecord { id: string; course_id: string; data: Record<string, unknown>; version: number; updated_at: string }
export interface HomeworkTopic { key: string; title: string }
export interface HomeworkContext { course_title: string; question: string; question_uploads: string[]; reference: string; topics: HomeworkTopic[]; learner_memory: string }
export type HomeworkTurn = { role: 'answer' | 'check' | 'hint' | 'attempt' | 'feedback' | 'solution' | 'ask' | 'reply'; text: string }
export interface HomeworkReply { verdict: 'correct' | 'partial' | 'wrong' | null; reply: string; topic_key: string | null; read: string; title: string }
export type MistakeKindValue = 'concept' | 'start' | 'calc' | 'careless'
export interface HomeworkCheck { verdict: 'correct' | 'partial' | 'wrong'; kind: MistakeKindValue | null; where: string; why: string; answer: string; solution: string; hint: string; topic_key: string | null; read?: string; title?: string }
export interface HomeworkGuide { feedback: string; on_track: boolean | null; hint: string; done: boolean; topic_key: string | null; read: string; title: string }
export interface HomeworkConclusion { idea: string; method: string; stuck: string; kind: MistakeKindValue | null; solved: boolean; topic_key: string | null }

const ai = (signal?: AbortSignal) => ({ ai: true, signal })

/** Question / message pictures are sent as upload ids: the server reads them (the student never sees the copy). */
export const homeworkApi = {
  list: (courseId: string) => apiFetch<HomeworkRecord[]>(`/api/homework?course_id=${encodeURIComponent(courseId)}`),
  save: (id: string, courseId: string, data: Record<string, unknown>, version: number) =>
    apiFetch<HomeworkRecord>(`/api/homework/${encodeURIComponent(id)}`, { method: 'PUT', json: { course_id: courseId, data, version } }),
  remove: (id: string) => apiFetch<void>(`/api/homework/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  check: (context: HomeworkContext, history: HomeworkTurn[], answer: string, uploads: string[], signal?: AbortSignal) =>
    apiFetch<HomeworkCheck>('/api/homework/check', { ...ai(signal), json: { ...context, history, answer, answer_uploads: uploads } }),
  guide: (context: HomeworkContext, history: HomeworkTurn[], attempt: string, uploads: string[], signal?: AbortSignal) =>
    apiFetch<HomeworkGuide>('/api/homework/guide', { ...ai(signal), json: { ...context, history, attempt, attempt_uploads: uploads } }),
  ask: (context: HomeworkContext, history: HomeworkTurn[], message: string, uploads: string[], signal?: AbortSignal) =>
    apiFetch<HomeworkReply>('/api/homework/ask', { ...ai(signal), json: { ...context, history, message, message_uploads: uploads } }),
  solve: (context: HomeworkContext, signal?: AbortSignal) => apiFetch<{ solution: string; answer: string }>('/api/homework/solve', { ...ai(signal), json: context }),
  conclude: (context: HomeworkContext, history: HomeworkTurn[], sawSolution: boolean, signal?: AbortSignal) =>
    apiFetch<HomeworkConclusion>('/api/homework/conclude', { ...ai(signal), json: { ...context, history, saw_solution: sawSolution } }),
  pagePath: (uploadId: string, page = 1, width = 900) => `/api/uploads/${encodeURIComponent(uploadId)}/page?page=${page}&width=${width}`,
}

export interface CloudEntry { name: string; path: string; is_dir: boolean; size: number | null; modified: string | null }
export interface CloudListing { kind: 'dir' | 'file'; path: string; entries: CloudEntry[] }
/** Share links from the cloud drive (e.g. https://cloud.tsinghua.edu.cn/d/…/): list a folder, import a file as an upload. */
export const cloudApi = {
  list: (link: string, path = '') => apiFetch<CloudListing>('/api/cloud/list', { json: { link, path } }),
  import: (link: string, path: string) => apiFetch<{ id: string; filename: string; size: number; pages: number | null }>('/api/cloud/import', { json: { link, path } }),
}
