import { useCallback, useEffect, useState } from 'react'
import { ApiError, User, authApi, getToken, serverReachable, setToken } from './api'
import { t } from './i18n'

const GUEST_KEY = 'course-replay-guest-v1'
const GUEST_NAME_KEY = 'course-replay-guest-name-v1'

export type Session =
  | { status: 'checking' }
  | { status: 'signed-out'; notice?: string }
  | { status: 'guest'; displayName: string; offlineOnly: boolean }
  | { status: 'account'; user: User }

function storageGet(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

const guestName = () => storageGet(GUEST_NAME_KEY) || t('学习者')

/**
 * Who is using the app. Signed-in users keep their data on the server; guests
 * ("离线模式") keep it in this browser. With no reachable backend (e.g. the
 * static GitHub Pages build) the app opens straight into offline mode.
 */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'checking' })

  const check = useCallback(async () => {
    setSession({ status: 'checking' })
    if (getToken()) {
      try {
        setSession({ status: 'account', user: await authApi.me() })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setToken(null)
          setSession({ status: 'signed-out', notice: '登录已过期，请重新登录' }) // i18n-ok: translated where shown
        } else {
          setSession({ status: 'signed-out', notice: '暂时连不上服务器。可以稍后重试，或先用离线模式。' }) // i18n-ok: translated where shown
        }
      }
      return
    }
    const reachable = await serverReachable()
    if (!reachable) setSession({ status: 'guest', displayName: guestName(), offlineOnly: true })
    else if (storageGet(GUEST_KEY)) setSession({ status: 'guest', displayName: guestName(), offlineOnly: false })
    else setSession({ status: 'signed-out' })
  }, [])

  useEffect(() => { void check() }, [check])

  const signIn = useCallback((user: User, token: string) => {
    setToken(token)
    storageSet(GUEST_KEY, null)
    setSession({ status: 'account', user })
  }, [])

  const continueAsGuest = useCallback(() => {
    storageSet(GUEST_KEY, '1')
    setSession({ status: 'guest', displayName: guestName(), offlineOnly: false })
  }, [])

  const showLogin = useCallback(() => {
    storageSet(GUEST_KEY, null)
    setSession({ status: 'signed-out' })
  }, [])

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => undefined)
    setToken(null)
    setSession({ status: 'signed-out', notice: '已退出登录' }) // i18n-ok: translated where shown
  }, [])

  const expire = useCallback(() => {
    setToken(null)
    setSession({ status: 'signed-out', notice: '登录已过期，请重新登录' }) // i18n-ok: translated where shown
  }, [])

  const rename = useCallback(async (name: string) => {
    const clean = name.trim().slice(0, 32)
    if (!clean) return
    if (session.status === 'account') {
      const user = await authApi.rename(clean)
      setSession({ status: 'account', user })
    } else if (session.status === 'guest') {
      storageSet(GUEST_NAME_KEY, clean)
      setSession({ ...session, displayName: clean })
    }
  }, [session])

  return { session, retry: check, signIn, continueAsGuest, showLogin, signOut, expire, rename }
}

export type SessionControls = ReturnType<typeof useSession>

export function displayNameOf(session: Session) {
  if (session.status === 'account') return session.user.display_name || session.user.username
  if (session.status === 'guest') return session.displayName
  return t('学习者')
}

export function initialsOf(name: string) {
  const clean = name.trim()
  if (!clean) return '?'
  const latin = clean.match(/[A-Za-z]+/g)
  if (latin && /^[A-Za-z]/.test(clean)) {
    return (latin.length > 1 ? latin[0][0] + latin[1][0] : latin[0].slice(0, 2)).toUpperCase()
  }
  return Array.from(clean)[0]
}
