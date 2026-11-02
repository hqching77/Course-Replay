import { t } from './i18n'
import type { SyncState } from './workspace'

/** Signed-in user (server sync) or guest (this browser only), as shown in the sidebar and settings. */
export interface AccountView {
  mode: 'account' | 'guest'
  name: string
  username?: string
  syncState: SyncState
  offlineOnly: boolean
  rename: () => void
  signOut: () => void
  showLogin: () => void
}

export function syncLabel(account: AccountView) {
  if (account.mode === 'guest') return account.offlineOnly ? t('离线模式 · 未连接服务器') : t('离线模式 · 仅存本机')
  return account.syncState === 'saving' ? t('同步中…') : account.syncState === 'error' ? t('同步失败，稍后自动重试') : t('已同步到云端')
}
