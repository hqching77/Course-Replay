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
  /** queued = waiting for speech recognition to work again (retried automatically). */
  status: 'transcribing' | 'queued'
}

export interface LiveState {
  courseId?: string
  sectionId?: string
  status: 'idle' | 'starting' | 'listening'
  engine: 'server' | 'browser'
  level: number
  pending: PendingChunk[]
  interim: string
  /** Shown once per problem (not once per audio chunk); cleared when it works again. */
  error?: string
  /** Oldest recordings dropped because recognition was down for very long. */
  dropped: number
}

interface LiveControls {
  state: LiveState
  start: (courseId: string, sectionId: string) => Promise<void>
  stop: () => Promise<void>
  /** Retry the queued recordings now instead of waiting for the next automatic retry. */
  retryAll: () => void
  dismissError: () => void
  /** Resolves once in-flight chunks are transcribed (or after `timeoutMs`). */
  settle: (timeoutMs?: number) => Promise<void>
}

const LiveContext = createContext<LiveControls | null>(null)

const insertSegment = (list: TranscriptSegment[], segment: TranscriptSegment) =>
  [...list, segment].sort((a, b) => a.startedAt - b.startedAt)

export function LiveProvider({ courses, setCourses, children }: { courses: Course[]; setCourses: Dispatch<SetStateAction<Course[]>>; children: ReactNode }) {
  const [state, setState] = useState<LiveState>({ status: 'idle', engine: 'server', level: 0, pending: [], interim: '', dropped: 0 })
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

  // While speech recognition is failing, recordings wait here and are retried with backoff
  // (5 s → 10 s → … → 60 s); the user is told once, not once per chunk.
  const outage = useRef(false)
  const warned = useRef(false)
  const retryTimer = useRef<number | null>(null)
  const backoff = useRef(0)
  const queued = useRef<string[]>([])

  const queuedBytes = () => queued.current.reduce((sum, id) => sum + (audioById.current.get(id)?.blob.size || 0), 0)

  const setChunk = (chunkId: string, startedAt: number, status: PendingChunk['status'] | null) => setState((current) => ({
    ...current,
    pending: status === null ? current.pending.filter((item) => item.id !== chunkId)
      : [...current.pending.filter((item) => item.id !== chunkId), { id: chunkId, startedAt, status }],
  }))

  const transcribe = useCallback(async (chunkId: string, probe = false): Promise<boolean> => {
    const chunk = audioById.current.get(chunkId)
    if (!chunk) return true
    if (outage.current && !probe) {
      // Recognition is down: keep the recording for later instead of hitting the service again.
      if (!queued.current.includes(chunkId)) queued.current.push(chunkId)
      setChunk(chunkId, chunk.startedAt, 'queued')
      return false
    }
    inFlight.current++
    setChunk(chunkId, chunk.startedAt, 'transcribing')
    const section = coursesRef.current.find((course) => course.id === chunk.courseId)?.sections.find((item) => item.id === chunk.sectionId)
    const lecture = getSettings().lectureLanguage
    try {
      const result = await filesApi.transcribe(chunk.blob, {
        language: lecture === 'auto' ? undefined : lecture,
        prompt: transcriptText(section?.transcript, 200),
      })
      audioById.current.delete(chunkId)
      queued.current = queued.current.filter((id) => id !== chunkId)
      setChunk(chunkId, chunk.startedAt, null)
      if (result.text.trim()) addSegment(chunk.courseId, chunk.sectionId, { id: chunkId, text: result.text.trim(), startedAt: chunk.startedAt, endedAt: chunk.endedAt })
      if (outage.current) {
        // Working again: clear the warning and catch up on everything that waited.
        outage.current = false
        warned.current = false
        backoff.current = 0
        setState((current) => ({ ...current, error: undefined }))
        void drain()
      }
      return true
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 413)) {
        // Something wrong with this one recording (empty / too large): drop it, it will never work.
        audioById.current.delete(chunkId)
        setChunk(chunkId, chunk.startedAt, null)
        return true
      }
      if (!queued.current.includes(chunkId)) queued.current.push(chunkId)
      queued.current.sort((a, b) => (audioById.current.get(a)?.startedAt || 0) - (audioById.current.get(b)?.startedAt || 0))
      setChunk(chunkId, chunk.startedAt, 'queued')
      // Don't keep more than ~80 MB (about 40 minutes) of audio waiting.
      let dropped = 0
      while (queued.current.length > 1 && queuedBytes() > 80 * 1024 * 1024) {
        const oldest = queued.current.shift()!
        setChunk(oldest, audioById.current.get(oldest)?.startedAt || 0, null)
        audioById.current.delete(oldest)
        dropped++
      }
      const message = error instanceof Error ? error.message : t('语音识别失败')
      const firstWarning = !warned.current
      warned.current = true
      setState((current) => ({ ...current, dropped: current.dropped + dropped, error: firstWarning ? message : current.error }))
      outage.current = true
      scheduleRetry()
      return false
    } finally {
      finishOne()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSegment])

  /** Send everything that waited, oldest first, one at a time (stops if it fails again). */
  const drain = async () => {
    while (queued.current.length && !outage.current) {
      const next = queued.current[0]
      if (!(await transcribe(next, true))) return
    }
  }

  function scheduleRetry() {
    if (retryTimer.current !== null) return
    const delay = [5, 10, 20, 40][backoff.current] ?? 60
    backoff.current++
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null
      const next = queued.current[0]
      if (!next) { outage.current = false; return }
      void transcribe(next, true).then((ok) => { if (ok) void drain() })
    }, delay * 1000)
  }

  const retryNow = () => {
    if (retryTimer.current !== null) { window.clearTimeout(retryTimer.current); retryTimer.current = null }
    backoff.current = 0
    const next = queued.current[0]
    if (next) void transcribe(next, true).then((ok) => { if (ok) void drain() })
  }

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
    // Recordings still waiting from before keep their place; a new session may warn once again.
    warned.current = false
    setState((current) => ({ courseId, sectionId, status: 'starting', engine, level: 0, pending: current.pending, interim: '', error: undefined, dropped: current.dropped }))
    updateSection(setCourses, courseId, sectionId, (current) => ({ ...current, liveStartedAt: current.liveStartedAt ?? Date.now(), liveEndedAt: undefined }))
    // Browser recognition reports the same problem over and over: tell the user once.
    const onError = (message: string) => {
      if (warned.current) return
      warned.current = true
      setState((current) => ({ ...current, error: message }))
    }
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
  useEffect(() => () => {
    void capture.current?.stop()
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
  }, [])

  const value = useMemo<LiveControls>(() => ({
    state,
    start,
    stop,
    retryAll: retryNow,
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
