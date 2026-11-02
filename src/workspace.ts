import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, workspaceApi } from './api'
import { Course, clearLocalCourses, defaultCourses, loadCourses, localCoursesToImport, normalizeCourses, saveCourses } from './data'
import { t } from './i18n'
import type { Session } from './session'

export type SyncState = 'local' | 'saved' | 'saving' | 'error'

type Snapshot = Map<string, { course: Course; position: number }>

function courseFieldsChanged(before: Course, after: Course) {
  return before.title !== after.title
    || before.code !== after.code
    || before.description !== after.description
    || before.mastery !== after.mastery
    || before.updated !== after.updated
    || before.accent !== after.accent
    || JSON.stringify(before.tags) !== JSON.stringify(after.tags)
    || before.sections.length !== after.sections.length
    || before.sections.some((section, index) => section.id !== after.sections[index].id)
}

function hasPendingChanges(current: Course[], snapshot: Snapshot) {
  if (current.length !== snapshot.size) return true
  return current.some((course, position) => {
    const saved = snapshot.get(course.id)
    return !saved || saved.course !== course || saved.position !== position
  })
}

/**
 * Send what changed since the last successful sync. State updates are
 * immutable, so an unchanged course/section keeps its object identity and is
 * skipped; a changed section is sent whole.
 *
 * keepalive (tab hidden / page closing): fire every request at once so they
 * all leave before the page goes away, and only then mark them as synced.
 */
async function pushChanges(current: Course[], snapshot: Snapshot, keepalive = false) {
  const inFlight: Promise<void>[] = []
  const commits: (() => void)[] = []
  const send = async (request: () => Promise<void>) => {
    if (keepalive) inFlight.push(request())
    else await request()
  }
  const commit = (apply: () => void) => {
    if (keepalive) commits.push(apply)
    else apply()
  }
  const currentIds = new Set(current.map((course) => course.id))
  for (const id of [...snapshot.keys()]) {
    if (currentIds.has(id)) continue
    await send(() => workspaceApi.deleteCourse(id, keepalive))
    commit(() => snapshot.delete(id))
  }
  for (const [position, course] of current.entries()) {
    const previous = snapshot.get(course.id)
    if (previous && previous.course === course && previous.position === position) continue
    if (!previous || previous.position !== position || courseFieldsChanged(previous.course, course)) {
      await send(() => workspaceApi.putCourse(course, position, keepalive))
    }
    for (const [index, section] of course.sections.entries()) {
      if (previous?.course.sections.find((item) => item.id === section.id) === section) continue
      await send(() => workspaceApi.putSection(course.id, section, index, keepalive))
    }
    commit(() => snapshot.set(course.id, { course, position }))
  }
  if (keepalive) {
    await Promise.all(inFlight)
    commits.forEach((apply) => apply())
  }
}

/**
 * Course data for the current session: browser storage for guests, the
 * server database (with debounced background sync) for signed-in users.
 */
export function useCourseStore(session: Session, onExpired: () => void) {
  const account = session.status === 'account'
  const [courses, setCourses] = useState<Course[]>(() => (account ? [] : loadCourses()))
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(account ? 'loading' : 'ready')
  const [reloadKey, setReloadKey] = useState(0)
  const [syncState, setSyncState] = useState<'saved' | 'error'>('saved')
  // Bumped after each successful push so the derived status re-renders (the snapshot is a ref).
  const [, setSyncTick] = useState(0)
  const latest = useRef(courses)
  latest.current = courses
  const synced = useRef<Snapshot>(new Map())
  const timer = useRef<number | undefined>(undefined)
  const running = useRef<Promise<void> | null>(null)
  const dirty = useRef(false)
  const clearLocalAfterSync = useRef(false)
  const onExpiredRef = useRef(onExpired)
  onExpiredRef.current = onExpired

  useEffect(() => {
    if (!account) saveCourses(courses)
  }, [account, courses])

  useEffect(() => {
    if (!account) return
    let cancelled = false
    setLoadState('loading')
    workspaceApi.load().then((loaded) => {
      if (cancelled) return
      const remote = normalizeCourses(loaded)
      if (remote.length) {
        synced.current = new Map(remote.map((course, position) => [course.id, { course, position }]))
        setCourses(remote)
      } else {
        // New account: bring over offline data from this browser if the user wants it, else start with the demo.
        const local = localCoursesToImport()
        const importLocal = Boolean(local) && window.confirm(t('这个浏览器里有离线模式的学习数据（{n} 门课程），要导入到当前账号吗？\n选择“取消”则从演示课程开始。', { n: local!.length }))
        clearLocalAfterSync.current = importLocal
        synced.current = new Map()
        setCourses(importLocal ? local! : defaultCourses)
      }
      setLoadState('ready')
    }).catch((error) => {
      if (cancelled) return
      if (error instanceof ApiError && error.status === 401) onExpiredRef.current()
      else setLoadState('error')
    })
    return () => { cancelled = true }
  }, [account, reloadKey])

  const flush = useCallback((keepalive = false): Promise<void> => {
    window.clearTimeout(timer.current)
    if (!account) return Promise.resolve()
    if (running.current) {
      dirty.current = true
      return running.current
    }
    const run = (async () => {
      try {
        do {
          dirty.current = false
          await pushChanges(latest.current, synced.current, keepalive)
        } while (dirty.current)
        if (clearLocalAfterSync.current) {
          clearLocalCourses()
          clearLocalAfterSync.current = false
        }
        setSyncState('saved')
        setSyncTick((tick) => tick + 1)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          onExpiredRef.current()
          return
        }
        setSyncState('error')
        timer.current = window.setTimeout(() => void flush(), 5000)
      }
    })().finally(() => { running.current = null })
    running.current = run
    return run
  }, [account])

  useEffect(() => {
    if (!account || loadState !== 'ready') return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 600)
  }, [account, loadState, courses, flush])

  // Derived on every render so the label never claims "saved" while edits are still queued.
  const pending = account && loadState === 'ready' && hasPendingChanges(courses, synced.current)
  const displayState: SyncState = !account ? 'local' : syncState === 'error' ? 'error' : pending ? 'saving' : 'saved'

  useEffect(() => {
    if (!account || displayState === 'saved') return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [account, displayState])

  useEffect(() => {
    if (!account) return
    // Tab hidden / page closing: send what's left right away, with keepalive so it survives the unload.
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(true) }
    const onPageHide = () => { void flush(true) }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.clearTimeout(timer.current)
    }
  }, [account, flush])

  return {
    courses,
    setCourses,
    loadState,
    syncState: displayState,
    flush,
    reload: () => setReloadKey((value) => value + 1),
  }
}
