import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { ArrowRight, CircleHelp, CloudOff, RefreshCw } from 'lucide-react'
import { User, authApi, serverReachable } from './api'
import { LanguageToggle, t, useLang } from './i18n'

export function SplashScreen({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="splash">
        <span className="brand-mark"><span /></span>
        {children ? null : <span className="mini-spinner" />}
        <p>{text}</p>
        {children && <div className="splash-actions">{children}</div>}
      </div>
    </div>
  )
}

export function AuthScreen({ notice, onSignedIn, onGuest, onRetry }: {
  notice?: string
  onSignedIn: (user: User, token: string) => void
  onGuest: () => void
  onRetry: () => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [serverOk, setServerOk] = useState<boolean | null>(null)
  useLang()

  useEffect(() => {
    let active = true
    void serverReachable().then((ok) => { if (active) setServerOk(ok) })
    return () => { active = false }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !username.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      const result = mode === 'login'
        ? await authApi.login(username.trim(), password)
        : await authApi.register(username.trim(), password, displayName.trim())
      onSignedIn(result.user, result.token)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('请求失败'))
      setBusy(false)
    }
  }

  const switchMode = (next: 'login' | 'register') => { setMode(next); setError('') }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-top">
          <div className="brand auth-brand">
            <span className="brand-mark"><span /></span>
            <span><strong>COURSE</strong><em>REPLAY</em></span>
          </div>
          <LanguageToggle />
        </div>
        <h1>{mode === 'login' ? t('欢迎回来') : t('创建你的账号')}</h1>
        <p className="auth-lead">{t('登录后，课程、课堂提问、笔记和学习进度都保存在服务器上，换设备也能接着学。')}</p>
        {notice && <div className="auth-notice">{notice}</div>}
        {serverOk === false && <div className="api-error"><CloudOff size={18} /><div><strong>{t('连不上服务器')}</strong><p>{t('服务器可能在维护或网络不通，可以稍后重试，或先用离线模式。')}</p></div><button type="button" className="icon-button tiny" aria-label={t('重试')} onClick={onRetry}><RefreshCw size={15} /></button></div>}
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>{t('登录')}</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>{t('注册')}</button>
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>{t('用户名')}<input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder={t('2-32 位，字母、数字或中文')} /></label>
          {mode === 'register' && <label>{t('昵称')}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t('选填，显示在左下角')} maxLength={32} /></label>}
          <label>{t('密码')}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'register' ? t('至少 6 位') : ''} /></label>
          {error && <div className="api-error"><CircleHelp size={18} /><div><strong>{mode === 'login' ? t('登录失败') : t('注册失败')}</strong><p>{error}</p></div></div>}
          <button className="button primary full" disabled={busy || !username.trim() || !password}>{busy ? <RefreshCw className="spin-icon" size={16} /> : null}{mode === 'login' ? t('登录') : t('注册并登录')}{!busy && <ArrowRight size={16} />}</button>
        </form>
        <div className="auth-divider"><span>{t('或者')}</span></div>
        <button type="button" className="button ghost full" onClick={onGuest}>{t('先用离线模式')}</button>
        <small className="auth-foot">{t('离线模式的数据只保存在这个浏览器里，使用 AI 需要登录。')}</small>
      </div>
    </div>
  )
}
