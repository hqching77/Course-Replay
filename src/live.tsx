import { Dispatch, ReactNode, SetStateAction, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, filesApi } from './api'
import { autoSectionTitle } from './build'
import { transcriptText } from './classNotes'
import { Course, TranscriptSegment, createSection } from './data'
import { t } from './i18n'
import { Capture, startBrowserCapture, startServerCapture } from './recorder'
import { getSettings } from './settings'
import { updateSection } from './ui'

/**
 * The running 上课中 session. It lives above the routes so listening carries on
 * while you look at other pages; finished transcript segments go straight
 * into the section (and from there to the server).
 */

export interface PendingChunk {
  id: string
  startedAt: number
  status: 'transcribing' | 'failed'
  error?: string
}

export interface LiveState {
  courseId?: string
  sectionId?: string
  status: 'idle' | 'starting' | 'listening'
  engine: 'server' | 'browser'
  level: number
  pending: PendingChunk[]
  interim: string
  error?: string
}

interface LiveControls {
  state: LiveState
  start: (courseId: string, sectionId: string) => Promise<void>
  stop: () => Promise<void>
  retry: (chunkId: string) => void
  /** Re-send every chunk that failed (audio is kept until it's transcribed). */
  retryAll: () => void
  dismissError: () => void
  /** Resolves once in-flight chunks are transcribed (or after `timeoutMs`). */
  settle: (timeoutMs?: number) => Promise<void>
}

const LiveContext = createContext<LiveControls | null>(null)

const insertSegment = (list: TranscriptSegment[], segment: TranscriptSegment) =>
  [...list, segment].sort((a, b) => a.startedAt - b.startedAt)

export function LiveProvider({ courses, setCourses, children }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; children: ReactNode }) {
  const [state, setState] = useState<LiveState>({ status: 'idle', engine: 'server', level: 0, pending: [], interim: '' })
  const capture = useRef<Capture | null>(null)
  const target = useRef<{ courseId: string; sectionId: string } | null>(null)
  const audioById = useRef(new Map<string, { blob: Blob; startedAt: number; endedAt: number; courseId: string; sectionId: string }>())
  const coursesRef = useRef(courses)
  coursesRef.current = courses
  const inFlight = useRef(0)
  const waiters = useRef<(() => void)[]>([])

  const addSegment = useCallback((courseId: string, sectionId: string, segment: TranscriptSegment) => {
    updateSection(setCourses, courseId, sectionId, (current) => ({ ...current, transcript: insertSegment(current.transcript || [], segment) }))
  }, [setCourses])

  const finishOne = () => {
    inFlight.current = Math.max(0, inFlight.current - 1)
    if (inFlight.current === 0) { waiters.current.forEach((resolve) => resolve()); waiters.current = [] }
  }

  const transcribe = useCallback(async (chunkId: string) => {
    const chunk = audioById.current.get(chunkId)
    if (!chunk) return
    inFlight.current++
    setState((current) => ({
      ...current,
      pending: [...current.pending.filter((item) => item.id !== chunkId), { id: chunkId, startedAt: chunk.startedAt, status: 'transcribing' }],
    }))
    const section = coursesRef.current.find((course) => course.id === chunk.courseId)?.sections.find((item) => item.id === chunk.sectionId)
    const lecture = getSettings().lectureLanguage
    try {
      const result = await filesApi.transcribe(chunk.blob, {
        language: lecture === 'auto' ? undefined : lecture,
        prompt: transcriptText(section?.transcript, 200),
      })
      audioById.current.delete(chunkId)
      setState((current) => ({ ...current, pending: current.pending.filter((item) => item.id !== chunkId) }))
      if (result.text.trim()) addSegment(chunk.courseId, chunk.sectionId, { id: chunkId, text: result.text.trim(), startedAt: chunk.startedAt, endedAt: chunk.endedAt })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('语音识别失败')
      // Offline / not configured / not signed in: every chunk would fail the same way, so say it once at the top.
      const blocking = error instanceof ApiError && [0, 401, 403, 503].includes(error.status)
      setState((current) => ({
        ...current,
        error: blocking ? message : current.error,
        pending: current.pending.map((item) => item.id === chunkId ? { ...item, status: 'failed', error: message } : item),
      }))
    } finally {
      finishOne()
    }
  }, [addSegment])

  const stop = useCallback(async () => {
    const running = capture.current
    capture.current = null
    if (running) await running.stop()
    setState((current) => ({ ...current, status: 'idle', level: 0, interim: '' }))
  }, [])

  const start = useCallback(async (courseId: string, sectionId: string) => {
    if (capture.current) await stop()
    const settings = getSettings()
    const engine = settings.stt.mode === 'browser' ? 'browser' : 'server'
    target.current = { courseId, sectionId }
    setState({ courseId, sectionId, status: 'starting', engine, level: 0, pending: [], interim: '', error: undefined })
    updateSection(setCourses, courseId, sectionId, (current) => ({ ...current, liveStartedAt: current.liveStartedAt ?? Date.now(), liveEndedAt: undefined }))
    const onError = (message: string) => setState((current) => ({ ...current, error: message }))
    try {
      if (engine === 'browser') {
        capture.current = startBrowserCapture(settings.lectureLanguage === 'en' ? 'en' : 'zh', {
          onFinal: (text, startedAt, endedAt) => addSegment(courseId, sectionId, { id: `seg-${startedAt}-${Math.random().toString(36).slice(2, 6)}`, text, startedAt, endedAt }),
          onInterim: (interim) => setState((current) => ({ ...current, interim })),
          onError,
        })
      } else {
        capture.current = await startServerCapture({
          onChunk: (chunk) => {
            const id = `seg-${chunk.startedAt}-${Math.random().toString(36).slice(2, 6)}`
            audioById.current.set(id, { blob: chunk.audio, startedAt: chunk.startedAt, endedAt: chunk.endedAt, courseId, sectionId })
            void transcribe(id)
          },
          onLevel: (level) => setState((current) => (Math.abs(current.level - level) > 0.02 ? { ...current, level } : current)),
          onError,
        })
      }
      setState((current) => ({ ...current, status: 'listening' }))
    } catch (error) {
      capture.current = null
      setState((current) => ({ ...current, status: 'idle', error: error instanceof Error ? error.message : t('无法开始听课') }))
    }
  }, [addSegment, setCourses, stop, transcribe])

  const settle = useCallback((timeoutMs = 15000) => new Promise<void>((resolve) => {
    if (inFlight.current === 0) { resolve(); return }
    const timer = window.setTimeout(resolve, timeoutMs)
    waiters.current.push(() => { window.clearTimeout(timer); resolve() })
  }), [])

  // Release the microphone when the workspace goes away (sign-out, user switch).
  useEffect(() => () => { void capture.current?.stop() }, [])

  const value = useMemo<LiveControls>(() => ({
    state,
    start,
    stop,
    retry: (chunkId) => { void transcribe(chunkId) },
    retryAll: () => {
      setState((current) => ({ ...current, error: undefined }))
      state.pending.filter((item) => item.status === 'failed').forEach((item) => { void transcribe(item.id) })
    },
    dismissError: () => setState((current) => ({ ...current, error: undefined })),
    settle,
  }), [settle, start, state, stop, transcribe])

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLive() {
  const value = useContext(LiveContext)
  if (!value) throw new Error('useLive must be used inside LiveProvider')
  return value
}

/** One click: new auto-named section → microphone on → live page. */
export function useStartLiveClass(setCourses: Dispatch<SetStateAction<Course[]>>) {
  const live = useLive()
  const navigate = useNavigate()
  return (course: Course) => {
    const section = { ...createSection(autoSectionTitle(course)), autoTitle: true, liveStartedAt: Date.now() }
    setCourses((current) => current.map((item) => item.id === course.id ? { ...item, sections: [...item.sections, section], updated: t('刚刚') } : item))
    // Start the mic inside the click so browsers that require a user gesture (iOS Safari) allow it.
    void live.start(course.id, section.id)
    navigate(`/courses/${course.id}/sections/${section.id}/live`)
  }
}
