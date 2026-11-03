import { ReactNode, useEffect, useState } from 'react'
import { AudioLines, Bot, CalendarDays, Check, CheckCircle2, CircleAlert, Eye, EyeOff, Languages, LogIn, LogOut, Mic, PenLine, RefreshCw, Server, Zap } from 'lucide-react'
import { ApiError, filesApi } from './api'
import { AccountView, syncLabel } from './account'
import { initialsOf } from './session'
import { LanguageToggle, t, useLang } from './i18n'
import { recordClip, startBrowserCapture } from './recorder'
import { CHAT_PRESETS, CheckResult, ProviderPreset, STT_PRESETS, browserSpeechAvailable, chatHeaders, sttHeaders, updateSettings, useSettings } from './settings'
import { PageHeader } from './ui'
import { semesterName, semesterWeek, useSemester } from './semester'
import { SemesterForm } from './SemesterForm'

function StatusRow({ ok, label, detail, warn }: { ok: boolean; label: string; detail: ReactNode; warn?: boolean }) {
  return <div className={`check-row ${ok ? 'ok' : warn ? 'warn' : 'bad'}`}>
    {ok ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
    <div><strong>{label}</strong><span>{detail}</span></div>
  </div>
}

function ProviderFields({ presets, value, onChange }: {
  presets: ProviderPreset[]
  value: { preset: string; baseUrl: string; model: string; apiKey: string }
  onChange: (changes: Partial<{ preset: string; baseUrl: string; model: string; apiKey: string }>) => void
}) {
  const [showKey, setShowKey] = useState(false)
  const preset = presets.find((item) => item.id === value.preset)
  return <div className="provider-fields">
    <label>{t('服务商')}<select value={value.preset} onChange={(event) => {
      const next = presets.find((item) => item.id === event.target.value)
      onChange({ preset: event.target.value, ...(next && next.id !== 'custom' ? { baseUrl: next.baseUrl, model: next.model || value.model } : {}) })
    }}>{presets.map((item) => <option key={item.id} value={item.id}>{t(item.label)}{item.note ? ` · ${t(item.note)}` : ''}</option>)}</select></label>
    <div className="field-row">
      <label>{t('接口地址 Base URL')}<input value={value.baseUrl} onChange={(event) => onChange({ baseUrl: event.target.value, preset: 'custom' })} placeholder="https://…/v1" spellCheck={false} /></label>
      <label>{t('模型')}<input value={value.model} onChange={(event) => onChange({ model: event.target.value })} placeholder={preset?.model || t('在服务商控制台复制模型名')} spellCheck={false} /></label>
    </div>
    <label>API Key<div className="secret-field"><input type={showKey ? 'text' : 'password'} value={value.apiKey} onChange={(event) => onChange({ apiKey: event.target.value })} placeholder="sk-…" autoComplete="off" spellCheck={false} /><button type="button" aria-label={showKey ? t('隐藏') : t('显示')} onClick={() => setShowKey((shown) => !shown)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
    <p className="field-hint">{t('Key 只保存在这个浏览器里，不会存进数据库。')}</p>
  </div>
}

/** AI 与偏好设置: language, which AI / speech provider to use, and a real end-to-end check. Saved in localStorage. */
export function SettingsPage({ account, notify }: { account: AccountView; notify: (message: string) => void }) {
  useLang()
  const settings = useSettings()
  const semester = useSemester()
  const [checking, setChecking] = useState(false)
  const [micTest, setMicTest] = useState<{ state: 'idle' | 'recording' | 'transcribing' | 'done' | 'error'; text?: string; level?: number }>({ state: 'idle' })
  const check = settings.lastCheck

  const [testing, setTesting] = useState<'chat' | 'stt' | null>(null)

  /** Real round trip to the selected chat model. */
  const testChat = async (): Promise<CheckResult['chat']> => {
    if (settings.chat.mode === 'custom' && !Object.keys(chatHeaders(settings)).length) return { ok: false, source: 'custom', error: t('请先填写自己的 API Key') }
    try {
      const ai = await filesApi.checkAi()
      return { ok: ai.ok, source: ai.source, model: ai.model, latencyMs: ai.latency_ms, error: ai.error || undefined }
    } catch (error) {
      return { ok: false, source: settings.chat.mode, needsLogin: error instanceof ApiError && error.status === 401, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Real round trip to the selected speech-to-text service (a short test clip, no microphone). */
  const testStt = async (): Promise<CheckResult['stt']> => {
    if (settings.stt.mode === 'browser') return { ok: browserSpeechAvailable(), source: 'browser', error: browserSpeechAvailable() ? undefined : t('这个浏览器没有内置语音识别') }
    if (settings.stt.mode === 'custom' && !Object.keys(sttHeaders(settings)).length) return { ok: false, source: 'custom', error: t('请先填写自己的 API Key') }
    try {
      const stt = await filesApi.checkStt()
      return { ok: stt.ok, source: stt.source, model: stt.model, latencyMs: stt.latency_ms, error: stt.error || undefined }
    } catch (error) {
      return { ok: false, source: settings.stt.mode, needsLogin: error instanceof ApiError && error.status === 401, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const testOne = async (which: 'chat' | 'stt') => {
    setTesting(which)
    const result = which === 'chat' ? await testChat() : await testStt()
    const base: CheckResult = check || { at: Date.now(), backend: { ok: true }, chat: { ok: false }, stt: { ok: false, source: settings.stt.mode } }
    updateSettings({ lastCheck: { ...base, at: Date.now(), [which]: result } })
    setTesting(null)
    const name = which === 'chat' ? t('对话 AI') : t('语音转文字')
    notify(result.ok ? t('{name}：测试通过', { name }) : t('{name}：测试没通过，原因见下方', { name }))
  }

  const sourceLabel = (source?: string) => source === 'custom' ? t('自己的接口') : source === 'browser' ? t('浏览器内置识别') : t('服务器默认')
  const chatDetail = (chat: CheckResult['chat']) => chat.ok ? `${sourceLabel(chat.source)} · ${chat.model} · ${chat.latencyMs} ms` : chat.needsLogin ? t('登录后才能测试 AI') : chat.error ? t(chat.error) : t('未通过') // i18n-ok: server message
  const sttDetail = (stt: CheckResult['stt']) => stt.ok ? `${sourceLabel(stt.source)}${stt.model ? ` · ${stt.model}` : ''}${stt.latencyMs ? ` · ${stt.latencyMs} ms` : ''}` : stt.needsLogin ? t('登录后才能测试语音识别') : stt.error ? t(stt.error) : t('未通过') // i18n-ok: server message

  const runCheck = async (showNotice = true) => {
    setChecking(true)
    const result: CheckResult = { at: Date.now(), backend: { ok: false }, chat: { ok: false }, stt: { ok: false, source: settings.stt.mode } }
    try {
      const health = await filesApi.health()
      result.backend = { ok: true, version: health.version, database: health.database }
      ;[result.chat, result.stt] = await Promise.all([testChat(), testStt()])
    } catch (error) {
      result.backend = { ok: false, error: error instanceof Error ? error.message : String(error) }
      result.chat = { ok: false, error: t('后端离线') }
      result.stt = { ok: settings.stt.mode === 'browser' && browserSpeechAvailable(), source: settings.stt.mode, error: settings.stt.mode === 'browser' ? undefined : t('后端离线') }
    }
    updateSettings({ lastCheck: result })
    setChecking(false)
    if (showNotice) notify(result.backend.ok && result.chat.ok && result.stt.ok ? t('检查完成：全部正常') : t('检查完成：有项目需要处理'))
  }

  // Show the saved result immediately; refresh it in the background if it's old.
  useEffect(() => {
    if (!check || Date.now() - check.at > 10 * 60 * 1000) void runCheck(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const testMic = async () => {
    setMicTest({ state: 'recording', level: 0 })
    try {
      if (settings.stt.mode === 'browser') {
        let text = ''
        const capture = startBrowserCapture(settings.lectureLanguage === 'en' ? 'en' : 'zh', {
          onFinal: (value) => { text += value },
          onInterim: () => undefined,
          onError: (message) => setMicTest({ state: 'error', text: message }),
        })
        await new Promise((resolve) => window.setTimeout(resolve, 5000))
        await capture.stop()
        setMicTest((current) => current.state === 'error' ? current : { state: 'done', text: text || t('（没有识别到内容）') })
        return
      }
      const clip = await recordClip(4000, (level) => setMicTest((current) => ({ ...current, level })))
      setMicTest({ state: 'transcribing' })
      const result = await filesApi.transcribe(clip, { language: settings.lectureLanguage === 'auto' ? undefined : settings.lectureLanguage })
      setMicTest({ state: 'done', text: `${result.text || t('（没有识别到内容）')} · ${result.model} · ${result.latency_ms} ms` })
    } catch (error) {
      setMicTest({ state: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const chat = settings.chat
  const stt = settings.stt
  const lastChecked = check ? new Date(check.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  return <div className="page settings-page">
    <PageHeader title={t('AI 与偏好设置')} subtitle={t('语言、学期、对话 AI 和语音转文字。AI 设置和自己的 Key 只保存在这个浏览器里。')} />
    <section className="panel account-panel"><div className="avatar">{initialsOf(account.name)}</div><div className="account-info"><strong>{account.name}</strong><span>{account.mode === 'account' ? `@${account.username} · ${syncLabel(account)}` : syncLabel(account)}</span><p>{account.mode === 'account' ? t('课程、课堂提问、笔记和学习进度都保存在服务器数据库里，换设备登录即可继续。') : t('离线模式：数据只保存在这个浏览器里。登录后可以把这些数据导入账号。')}</p></div><div className="account-actions"><button className="button secondary" onClick={account.rename}><PenLine size={15} />{t('修改昵称')}</button>{account.mode === 'account' ? <button className="button danger" onClick={account.signOut}><LogOut size={15} />{t('退出登录')}</button> : <button className="button primary" onClick={account.showLogin}><LogIn size={15} />{t('登录 / 注册')}</button>}</div></section>

    <div className="settings-columns">
      <section className="panel settings-section">
        <div className="settings-head"><span className="settings-icon"><Languages size={20} /></span><div><h2>{t('语言')}</h2><p>{t('界面和 AI 回答使用的语言')}</p></div><LanguageToggle /></div>
        <label>{t('上课语言（语音识别）')}<select value={settings.lectureLanguage} onChange={(event) => updateSettings({ lectureLanguage: event.target.value as 'auto' | 'zh' | 'en' })}><option value="zh">{t('中文')}</option><option value="en">{t('英文')}</option><option value="auto">{t('自动识别')}</option></select></label>
      </section>

      <section className="panel settings-section">
        <div className="settings-head"><span className="settings-icon"><CalendarDays size={20} /></span><div><h2>{t('学期')}</h2><p>{semesterName(semester)} · {semesterWeek(semester).label}{account.mode === 'account' ? ` · ${t('跟随账号同步')}` : ''}</p></div></div>
        <SemesterForm key={`${semester.start}-${semester.weeks}-${semester.name || ''}`} />
      </section>

      <section className="panel settings-section check-panel">
        <div className="settings-head"><span className="settings-icon"><Server size={20} /></span><div><h2>{t('服务端状态')}</h2><p>{lastChecked ? t('上次检查 {time}', { time: lastChecked }) : t('还没有检查过')}</p></div><button className="button secondary compact" disabled={checking} onClick={() => void runCheck()}>{checking ? <RefreshCw className="spin-icon" size={15} /> : <Check size={15} />}{checking ? t('检查中') : t('检查服务端配置')}</button></div>
        {check ? <div className="check-list">
          <StatusRow ok={check.backend.ok} label={t('后端服务')} detail={check.backend.ok ? `v${check.backend.version} · ${t('数据库')} ${check.backend.database}` : check.backend.error || t('后端离线')} />
          <StatusRow ok={check.chat.ok} warn={check.chat.needsLogin} label={t('对话 AI')} detail={chatDetail(check.chat)} />
          <StatusRow ok={check.stt.ok} warn={check.stt.needsLogin} label={t('语音转文字')} detail={sttDetail(check.stt)} />
        </div> : <p className="field-hint">{t('点「检查服务端配置」会真实调用一次 AI，确认能用。')}</p>}
      </section>

      <section className="panel settings-section">
        <div className="settings-head"><span className="settings-icon"><Bot size={20} /></span><div><h2>{t('对话 AI')}</h2><p>{t('上课提问、AI 讲师和生成课堂笔记都用它')}</p></div></div>
        <div className="mode-options">
          <label className={chat.mode === 'server' ? 'active' : ''}><input type="radio" checked={chat.mode === 'server'} onChange={() => updateSettings((current) => ({ ...current, chat: { ...current.chat, mode: 'server' } }))} /><span><strong>{t('服务器默认')}</strong><small>{t('用服务器配置好的模型，不需要自己的 Key')}</small></span></label>
          <label className={chat.mode === 'custom' ? 'active' : ''}><input type="radio" checked={chat.mode === 'custom'} onChange={() => updateSettings((current) => ({ ...current, chat: { ...current.chat, mode: 'custom' } }))} /><span><strong>{t('自己的接口')}</strong><small>{t('任何 OpenAI 兼容接口；生成笔记需要模型支持图片输入')}</small></span></label>
        </div>
        {chat.mode === 'custom' && <ProviderFields presets={CHAT_PRESETS} value={chat} onChange={(changes) => updateSettings((current) => ({ ...current, chat: { ...current.chat, ...changes } }))} />}
        <div className="section-test">
          <button className="button secondary compact" disabled={testing !== null} onClick={() => void testOne('chat')}>{testing === 'chat' ? <RefreshCw className="spin-icon" size={14} /> : <Zap size={14} />}{testing === 'chat' ? t('测试中…') : t('测试对话 AI')}</button>
          {check && testing !== 'chat' && <StatusRow ok={check.chat.ok} warn={check.chat.needsLogin} label={t('上次测试')} detail={chatDetail(check.chat)} />}
        </div>
      </section>

      <section className="panel settings-section">
        <div className="settings-head"><span className="settings-icon"><AudioLines size={20} /></span><div><h2>{t('语音转文字')}</h2><p>{t('上课中实时把老师讲的话转成文字')}</p></div></div>
        <div className="mode-options">
          <label className={stt.mode === 'server' ? 'active' : ''}><input type="radio" checked={stt.mode === 'server'} onChange={() => updateSettings((current) => ({ ...current, stt: { ...current.stt, mode: 'server' } }))} /><span><strong>{t('服务器默认')}</strong><small>{t('默认：硅基流动 SenseVoiceSmall（免费，国内可用）')}</small></span></label>
          <label className={stt.mode === 'custom' ? 'active' : ''}><input type="radio" checked={stt.mode === 'custom'} onChange={() => updateSettings((current) => ({ ...current, stt: { ...current.stt, mode: 'custom' } }))} /><span><strong>{t('自己的接口')}</strong><small>{t('硅基流动、Groq Whisper（$0.04/小时）、OpenAI 等')}</small></span></label>
          <label className={stt.mode === 'browser' ? 'active' : ''}><input type="radio" checked={stt.mode === 'browser'} onChange={() => updateSettings((current) => ({ ...current, stt: { ...current.stt, mode: 'browser' } }))} /><span><strong>{t('浏览器内置')}</strong><small>{browserSpeechAvailable() ? t('免费、实时；Chrome 需要能访问 Google，国内网络通常不可用') : t('这个浏览器不支持')}</small></span></label>
        </div>
        {stt.mode === 'custom' && <ProviderFields presets={STT_PRESETS} value={stt} onChange={(changes) => updateSettings((current) => ({ ...current, stt: { ...current.stt, ...changes } }))} />}
        <div className="section-test">
          <button className="button secondary compact" disabled={testing !== null} onClick={() => void testOne('stt')}>{testing === 'stt' ? <RefreshCw className="spin-icon" size={14} /> : <Zap size={14} />}{testing === 'stt' ? t('测试中…') : t('测试语音识别')}</button>
          {check && testing !== 'stt' && <StatusRow ok={check.stt.ok} warn={check.stt.needsLogin} label={t('上次测试')} detail={sttDetail(check.stt)} />}
        </div>
        <div className="mic-test">
          <button className="button secondary compact" disabled={micTest.state === 'recording' || micTest.state === 'transcribing'} onClick={() => void testMic()}>{micTest.state === 'recording' ? <span className="live-dot" /> : micTest.state === 'transcribing' ? <RefreshCw className="spin-icon" size={14} /> : <Mic size={14} />}{micTest.state === 'recording' ? t('录音中，请说话…') : micTest.state === 'transcribing' ? t('识别中…') : t('用麦克风说一句试试')}</button>
          {micTest.state === 'recording' && <span className="level-meter"><i style={{ transform: `scaleX(${Math.max(0.04, micTest.level || 0)})` }} /></span>}
          {micTest.text && <p className={micTest.state === 'error' ? 'mic-error' : ''}>{micTest.text}</p>}
        </div>
      </section>
    </div>
  </div>
}
