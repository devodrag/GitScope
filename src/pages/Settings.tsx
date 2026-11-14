import { useEffect, useRef, useState } from 'react'
import { Database, Download, Github, Info, Monitor, PersonStanding, Settings as SettingsIcon } from 'lucide-react'
import { asError, beginAuth, cancelAuth, connectToken, copyText, exportData, finishAuth, local, logout } from '../api'
import { useWorkspace } from '../context'
import { useI18n, type Key } from '../i18n'
import { clearClientCache } from '../query'
import type { ApiStatus, AppError, DeviceCode, Settings as Preferences } from '../types'
import { Avatar, Button, ChartCard, ConfirmDialog, ErrorState, GithubLink, Modal, PageHeading, PendingButton } from '../components/ui'

function SettingsSection({ label, icon: Icon, children }: { label: Key; icon: typeof Monitor; children: React.ReactNode }) {
  const { t } = useI18n()
  return <ChartCard title={t(label)} className="settings-section" actions={<span className="state-icon"><Icon size={17} /></span>}>{children}</ChartCard>
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="settings-row"><span>{label}</span><input type="checkbox" role="switch" className="switch" checked={checked} onChange={event => onChange(event.target.checked)} /></label>
}
function Choice({ label, value, choices, onChange }: { label: string; value: string | number; choices: [string | number, string][]; onChange: (value: string) => void }) {
  return <label className="settings-row"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{choices.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
}

function AccountSettings() {
  const { t, locale } = useI18n()
  const workspace = useWorkspace()
  const { account, settings, oauthConfigured } = workspace.data
  const [clientId, setClientId] = useState(settings.oauthClientId)
  const [device, setDevice] = useState<DeviceCode>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError>()
  const [finishing, setFinishing] = useState(false)
  const [tokenDialog, setTokenDialog] = useState(false)
  const tokenInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ApiStatus>()
  const [statusError, setStatusError] = useState<AppError>()
  useEffect(() => {
    let active = true
    void local<ApiStatus>('rate_status').then(value => { if (active) setStatus(value) }, failure => { if (active) setStatusError(asError(failure)) })
    return () => { active = false }
  }, [account, workspace.revision])

  const connect = (token: string) => {
    setError(undefined); setPending(true)
    void connectToken(token).then(async () => {
      clearClientCache()
      await workspace.sync()
      setTokenDialog(false)
    }).catch(failure => setError(asError(failure))).finally(() => setPending(false))
  }
  const runSignIn = () => {
    setError(undefined); setPending(true)
    void (async () => {
      try {
        if (clientId.trim() !== settings.oauthClientId) await workspace.settings({ oauthClientId: clientId.trim() })
        setDevice(await beginAuth())
        setFinishing(true)
        try {
          await finishAuth()
          clearClientCache()
          await workspace.sync()
          workspace.refresh()
          setDevice(undefined)
        } finally { setFinishing(false) }
      } catch (failure) {
        const error = asError(failure)
        if (error.code !== 'cancelled') setError(error)
        setDevice(undefined)
      } finally { setPending(false) }
    })()
  }

  const close = () => {
    setDevice(undefined)
    void workspace.perform(cancelAuth)
  }
  return <SettingsSection label="account" icon={PersonStanding}>
    {account ? <div className="settings-row"><span className="account-summary"><Avatar person={account} /><strong>@{account.login}</strong></span>
      <Button onClick={() => void workspace.perform(async () => { await logout(); clearClientCache(); await workspace.sync(); workspace.refresh() }, 'signedOut')}>{t('signOut')}</Button></div> :
      <><p className="muted">{t('signInHelp')}</p>
        <label className="field">{t('oauthClient')}<input value={clientId} onChange={event => setClientId(event.target.value)} placeholder={oauthConfigured ? 'GITSCOPE_GITHUB_CLIENT_ID' : 'Iv1…'} maxLength={80} />
          <small>{t('oauthHelp')}</small></label>
        <div className="toolbar">
          <PendingButton variant="primary" pending={pending && !tokenDialog} disabled={pending} onClick={runSignIn}><Github size={17} />{t('signIn')}</PendingButton>
          <Button disabled={pending} onClick={() => { setError(undefined); setTokenDialog(true) }}>{t('useToken')}</Button>
        </div>
      </>}
    {(!tokenDialog && error || account && workspace.data.authError) && <ErrorState inline error={error ?? workspace.data.authError!} />}
    {status && <div className="settings-row">
      <span>{t(status.authenticated ? 'apiAuthenticated' : 'apiGuest')}</span>
      {!status.core && !status.search && <small>{t('apiWaiting')}</small>}
    </div>}
    {status && (['core', 'search'] as const).map(bucket => {
      const quota = status[bucket]
      if (!quota || quota.resetAt <= Date.now() / 1000) return null
      const number = new Intl.NumberFormat(locale)
      const time = new Date(quota.resetAt * 1000).toLocaleTimeString(locale, { timeStyle: 'short' })
      return <div className="settings-row" key={bucket}><span>{t(bucket === 'core' ? 'apiCore' : 'apiSearch')}</span><strong title={time}>{number.format(quota.remaining)} / {number.format(quota.limit)}</strong></div>
    })}
    {status?.retryAt && <ErrorState inline error={{ code: 'rate_limit', retryAt: status.retryAt }} />}
    {statusError && <ErrorState inline error={statusError} />}
    {device && <Modal title={t('signIn')} onClose={close}>
      <p>{t('useCode')}</p><div className="device-code"><code>{device.userCode}</code><Button onClick={() => void workspace.perform(() => copyText(device.userCode), 'codeCopied')}>{t('copyCode')}</Button></div>
      {finishing && <p role="status" className="muted">{t('waitingGitHub')}</p>}
      <div className="dialog-actions"><Button onClick={close}>{t('cancel')}</Button><GithubLink url={device.url} /></div>
    </Modal>}
    {tokenDialog && <Modal title={t('useToken')} onClose={() => { if (!pending) { setTokenDialog(false); setError(undefined) } }}>
      <form onSubmit={event => {
        event.preventDefault()
        const input = tokenInput.current
        if (!input || pending) return
        const token = input.value.trim()
        input.value = ''
        connect(token)
      }}>
        <p className="panel-footnote">{t('tokenHelp')}</p>
        <label className="field">{t('tokenLabel')}<input ref={tokenInput} data-initial-focus type="password" autoComplete="off" spellCheck={false} required maxLength={256} disabled={pending} /></label>
        {error && <ErrorState inline error={error} />}
        <div className="dialog-actions">
          <GithubLink url="https://github.com/settings/tokens/new?description=GitScope&scopes=">{t('createToken')}</GithubLink>
          <PendingButton variant="primary" type="submit" pending={pending}>{t('tokenConnect')}</PendingButton>
        </div>
      </form>
    </Modal>}
  </SettingsSection>
}

export default function Settings() {
  const { t, locale } = useI18n()
  const workspace = useWorkspace()
  const { settings, version } = workspace.data
  const [usage, setUsage] = useState<number>()
  const [usageError, setUsageError] = useState<AppError>()
  const [confirm, setConfirm] = useState<'cache' | 'reset'>()
  useEffect(() => {
    let active = true
    void local<number>('cache_size').then(value => { if (active) setUsage(value) }, error => { if (active) setUsageError(asError(error)) })
    return () => { active = false }
  }, [])
  const change = (update: Partial<Preferences>) => { void workspace.settings(update).catch(() => undefined) }
  return <>
    <PageHeading title={t('appSettings')} description={t('appSettingsHint')} />
    <div className="settings-grid">
      <SettingsSection label="appearance" icon={Monitor}>
        <Choice label={t('theme')} value={settings.theme} choices={(['light', 'dark', 'system'] as const).map(key => [key, t(key)])} onChange={value => change({ theme: value as Preferences['theme'] })} />
        <Toggle label={t('reducedMotion')} checked={settings.reducedMotion} onChange={reducedMotion => change({ reducedMotion })} />
        <Toggle label={t('compact')} checked={settings.compact} onChange={compact => change({ compact })} />
        <Toggle label={t('collapse')} checked={settings.collapsed} onChange={collapsed => change({ collapsed })} />
      </SettingsSection>
      <SettingsSection label="general" icon={SettingsIcon}>
        <Choice label={t('language')} value={settings.language} choices={[[ 'en', 'English' ], [ 'ru', 'Русский' ]]} onChange={value => change({ language: value as Preferences['language'] })} />
        <Choice label={t('startupPage')} value={settings.startup} choices={(['overview', 'explore', 'watchlist', 'trending'] as const).map(key => [key, t(key)])} onChange={value => change({ startup: value as Preferences['startup'] })} />
        <Choice label={t('refreshInterval')} value={settings.refreshMinutes} choices={[0, 15, 30, 60, 180].map(value => [value, value ? `${value} ${t('minutes')}` : t('manual')])}
          onChange={value => change({ refreshMinutes: Number(value) })} />
        <p className="panel-footnote">{t('refreshHint')}</p>
        <Toggle label={t('desktopNotices')} checked={settings.desktopNotifications} onChange={desktopNotifications => change({ desktopNotifications })} />
          {workspace.data.releaseBuild && <Toggle label={t('autostart')} checked={workspace.data.autostart} onChange={enabled => void workspace.perform(async () => {
          await local('autostart', { enabled }); await workspace.sync()
        })} />}
      </SettingsSection>
      <AccountSettings />
      <SettingsSection label="data" icon={Database}>
        <div className="settings-row"><span>{t('cacheUsage')}</span><strong>{usage === undefined ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(usage / 1_048_576)} MiB`}</strong></div>
        {usageError && <ErrorState inline error={usageError} />}
        <Choice label={t('cacheLimit')} value={settings.cacheMb} choices={[16, 32, 64, 128].map(value => [value, `${value} MiB`])}
          onChange={value => void workspace.perform(async () => { await workspace.settings({ cacheMb: Number(value) }); setUsage(await local<number>('cache_size')) })} />
        <div className="toolbar"><Button onClick={() => setConfirm('cache')}>{t('clearCache')}</Button>
          <Button onClick={() => void workspace.perform(async () => { if (await exportData()) workspace.notify(t('exportDone')) })}><Download size={16} />{t('export')}</Button>
          <Button onClick={() => setConfirm('reset')}>{t('resetSettings')}</Button></div>
      </SettingsSection>
      <SettingsSection label="about" icon={Info}><div className="settings-row"><strong>GitScope {version}</strong><span>Linux · MIT</span></div><p className="muted">{t('aboutInfo')}</p><GithubLink url="https://github.com/">GitHub</GithubLink></SettingsSection>
    </div>
    {confirm && <ConfirmDialog title={t(confirm === 'cache' ? 'clearCache' : 'resetSettings')} description={t(confirm === 'cache' ? 'confirmCache' : 'confirmReset')}
      onClose={() => setConfirm(undefined)} confirm={async () => {
        await workspace.perform(async () => {
          await local(confirm === 'cache' ? 'clear_cache' : 'reset_settings')
          clearClientCache(); await workspace.sync(); setUsage(await local<number>('cache_size')); setConfirm(undefined)
        }, confirm === 'cache' ? 'cacheCleared' : 'resetDone')
      }} />}
  </>
}
