import { useSyncExternalStore } from 'react'

/**
 * AI & preferences chosen in 设置, kept in this browser's localStorage.
 * API keys entered here never reach our database: the browser sends them with
 * each AI request and the backend forwards them to the provider.
 */

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  /** Suggested model id; users can type any model their provider offers. */
  model: string
  note?: string
}

export const CHAT_PRESETS: ProviderPreset[] = [
  { id: 'cheaprouter', label: 'CheapRouter', baseUrl: 'https://cdn.cheaprouter.cc/v1', model: '' },
  { id: 'siliconflow', label: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: '' }, // i18n-ok: translated where shown
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: 'text-only' },
  { id: 'dashscope', label: '阿里云百炼 DashScope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '' }, // i18n-ok: translated where shown
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom', label: '自定义', baseUrl: '', model: '' }, // i18n-ok: translated where shown
]

export const STT_PRESETS: ProviderPreset[] = [
  { id: 'siliconflow', label: '硅基流动 SenseVoice', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', note: 'free' }, // i18n-ok: translated where shown
  { id: 'groq', label: 'Groq Whisper Turbo', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', note: '$0.04/h' },
  { id: 'openai', label: 'OpenAI gpt-4o-mini-transcribe', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', note: '$0.18/h' },
  { id: 'custom', label: '自定义', baseUrl: '', model: '' }, // i18n-ok: translated where shown
]

export interface ProviderChoice {
  /** server = the provider configured on the server; custom = the user's own OpenAI-compatible provider. */
  mode: 'server' | 'custom'
  preset: string
  baseUrl: string
  model: string
  apiKey: string
}

export interface SttChoice extends Omit<ProviderChoice, 'mode'> {
  /** browser = the browser's built-in recognition (free; needs Google/Microsoft reachable). */
  mode: 'server' | 'custom' | 'browser'
}

export interface CheckResult {
  at: number
  backend: { ok: boolean; version?: string; database?: string; error?: string }
  chat: { ok: boolean; source?: string; model?: string | null; latencyMs?: number | null; error?: string; needsLogin?: boolean }
  stt: { ok: boolean; source: string; model?: string | null; error?: string }
}

export interface AppSettings {
  chat: ProviderChoice
  stt: SttChoice
  /** Spoken language of lectures, for speech recognition. */
  lectureLanguage: 'auto' | 'zh' | 'en'
  lastCheck?: CheckResult
}

const SETTINGS_KEY = 'course-replay-settings-v1'

export const DEFAULT_SETTINGS: AppSettings = {
  chat: { mode: 'server', preset: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: '', apiKey: '' },
  stt: { mode: 'server', preset: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', apiKey: '' },
  lectureLanguage: 'zh',
}

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      chat: { ...DEFAULT_SETTINGS.chat, ...parsed.chat },
      stt: { ...DEFAULT_SETTINGS.stt, ...parsed.stt },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

let current = readSettings()
const listeners = new Set<() => void>()

export function getSettings(): AppSettings {
  return current
}

export function updateSettings(update: Partial<AppSettings> | ((settings: AppSettings) => AppSettings)) {
  current = typeof update === 'function' ? update(current) : { ...current, ...update }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(current)) } catch { /* ignore */ }
  listeners.forEach((listener) => listener())
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSettings,
    getSettings,
  )
}

/** Headers that switch the backend to the user's own provider (only when they chose one). */
export function chatHeaders(settings = current): Record<string, string> {
  const { chat } = settings
  if (chat.mode !== 'custom' || !chat.apiKey.trim()) return {}
  return { 'X-AI-Key': chat.apiKey.trim(), 'X-AI-Base-URL': chat.baseUrl.trim(), 'X-AI-Model': chat.model.trim() }
}

export function sttHeaders(settings = current): Record<string, string> {
  const { stt } = settings
  if (stt.mode !== 'custom' || !stt.apiKey.trim()) return {}
  return { 'X-STT-Key': stt.apiKey.trim(), 'X-STT-Base-URL': stt.baseUrl.trim(), 'X-STT-Model': stt.model.trim() }
}

export function browserSpeechAvailable() {
  return typeof window !== 'undefined' && Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition)
}
