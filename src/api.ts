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
    throw new ApiError((detail && t(detail)) || (getLang() === 'en' ? `Request failed (HTTP ${response.status})` : `请求失败（HTTP ${response.status}）`), response.status) // i18n-ok: bilingual
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
    return apiFetch<{ id: string; filename: string; size: number }>('/api/uploads', { method: 'POST', body: form })
  },
  transcribe: (audio: Blob, options: { language?: string; prompt?: string; signal?: AbortSignal } = {}) => {
    const form = new FormData()
    form.append('file', audio, `chunk-${Date.now()}.wav`)
    if (options.language) form.append('language', options.language)
    if (options.prompt) form.append('prompt', options.prompt)
    return apiFetch<{ text: string; model: string; source: string; latency_ms: number }>('/api/transcribe', { method: 'POST', body: form, stt: true, signal: options.signal })
  },
  health: () => apiFetch<HealthInfo>('/api/health'),
  checkAi: () => apiFetch<{ ok: boolean; source: string; base_url: string; model: string | null; latency_ms: number | null; reply: string | null; error: string | null }>('/api/ai/check', { method: 'POST', ai: true }),
}
