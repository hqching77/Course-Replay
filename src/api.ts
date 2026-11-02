import type { Course } from './data'

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

type ApiOptions = { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal }

/** fetch() against the backend with the session token attached; throws ApiError on non-2xx. */
export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  let body = options.body
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  let response: Response
  try {
    response = await fetch(apiUrl(path), { method: options.method || (body ? 'POST' : 'GET'), headers, body, signal: options.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('无法连接服务器，请确认后端已启动', 0)
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof payload.detail === 'string' ? payload.detail : Array.isArray(payload.detail) ? describeValidation(payload.detail) : ''
    throw new ApiError(detail || `请求失败（HTTP ${response.status}）`, response.status)
  }
  return payload as T
}

function describeValidation(items: { loc?: unknown[]; msg?: string }[]) {
  const field = String(items[0]?.loc?.slice(-1)[0] || '')
  const names: Record<string, string> = { username: '用户名需为 2-32 位字母、数字、中文或 _ . @ -', password: '密码至少 6 位', display_name: '昵称不能为空' }
  return names[field] || items[0]?.msg || '输入有误'
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

export const workspaceApi = {
  load: () => apiFetch<{ courses: Course[] }>('/api/workspace').then((payload) => payload.courses),
  putCourse: (course: Course, position: number) => {
    const { sections, ...fields } = course
    return apiFetch<void>('/api/workspace/course', { method: 'PUT', json: { ...fields, position, sectionIds: sections.map((section) => section.id) } })
  },
  putSection: (courseId: string, section: Course['sections'][number], position: number) =>
    apiFetch<void>('/api/workspace/section', { method: 'PUT', json: { courseId, position, section } }),
  deleteCourse: (courseId: string) =>
    apiFetch<void>(`/api/workspace/course?id=${encodeURIComponent(courseId)}`, { method: 'DELETE' }),
}
