import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow, type Window } from '@tauri-apps/api/window'
import {
  Activity, ArrowDownRight, Bell, Bookmark, Building2, ChevronLeft, ChevronRight, CircleUserRound, Code2, Compass,
  FolderClosed, GitCompareArrows, Github, LayoutGrid, Minus, Moon, PanelLeftClose, PanelLeftOpen, Radar, RefreshCw,
  Search, Settings, Square, Sun, TrendingUp, UsersRound, X, KeyRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { copyText, local, openGithub, repositoryName } from '../api'
import { useWorkspace } from '../context'
import { useI18n, type Key } from '../i18n'
import type { Page, Theme } from '../types'
import { Avatar, Button, EmptyState, IconButton, Modal } from './ui'
import { formatDate } from './data'

const navGroups: [Key, [Page, LucideIcon][]][] = [
  ['workspace', [['overview', LayoutGrid], ['explore', Compass], ['repositories', Code2], ['developers', UsersRound], ['organizations', Building2]]],
  ['analytics', [['compare', GitCompareArrows], ['trending', TrendingUp], ['activity', Activity]]],
  ['personal', [['watchlist', Bookmark], ['collections', FolderClosed]]],
  ['manage-group', [['manage', KeyRound]]],
]

export function ThemeToggle({ effectiveTheme }: { effectiveTheme: Theme }) {
  const workspace = useWorkspace()
  const { t } = useI18n()
  return <IconButton label={t('toggleTheme')} icon={effectiveTheme === 'dark' ? Sun : Moon}
    onClick={() => void workspace.settings({ theme: effectiveTheme === 'dark' ? 'light' : 'dark' }).catch(() => undefined)} />
}

function Sidebar() {
  const { t } = useI18n()
  const workspace = useWorkspace()
  const { collapsed } = workspace.data.settings
  const entry = (page: Page, Icon: LucideIcon) => <button key={page} type="button" className={`nav-button ${workspace.route.page === page ? 'nav-active' : ''}`}
    title={collapsed ? t(page) : undefined} aria-label={t(page)} aria-current={workspace.route.page === page ? 'page' : undefined}
    onClick={() => workspace.navigate({ page })}>
    <Icon size={18} strokeWidth={1.7} /><span>{t(page)}</span>{page === 'watchlist' && workspace.data.watchlist.length > 0 && <small>{workspace.data.watchlist.length}</small>}
  </button>
  return <aside className="sidebar">
    <button className="brand" onClick={() => workspace.navigate({ page: 'overview' })} aria-label="GitScope">
      <span className="brand-mark"><Radar size={23} strokeWidth={1.75} /></span><span>GitScope</span>
    </button>
    <nav aria-label={t('workspace')} className="primary-nav">{navGroups.map(([group, entries]) => <div className="nav-group" key={group}><div className="nav-heading">{t(group)}</div>{entries.map(([page, Icon]) => entry(page, Icon))}</div>)}</nav>
    <div className="sidebar-bottom">
      {entry('settings', Settings)}
      <button className="sidebar-account" title={t('profile')} aria-label={t('profile')} onClick={() => workspace.navigate({ page: 'settings' })}>
        <Avatar person={workspace.data.account} /><span><strong>{workspace.data.account?.login ?? t('guest')}</strong><small><i />{t('publicMode')}</small></span>
      </button>
    </div>
  </aside>
}

function Titlebar({ onBack, onForward, canBack, canForward }: { onBack: () => void; onForward: () => void; canBack: boolean; canForward: boolean }) {
  const workspace = useWorkspace()
  const { t } = useI18n()
  const native = isTauri()
  const current = native ? getCurrentWindow() : null
  return <header className="titlebar" data-tauri-drag-region>
    <div className="titlebar-navigation">
      <IconButton icon={workspace.data.settings.collapsed ? PanelLeftOpen : PanelLeftClose} variant="quiet" label={t('toggleSidebar')}
        onClick={() => void workspace.settings({ collapsed: !workspace.data.settings.collapsed }).catch(() => undefined)} />
      <div className="history-buttons"><IconButton icon={ChevronLeft} label={t('back')} variant="quiet" onClick={onBack} disabled={!canBack} />
        <IconButton icon={ChevronRight} label={t('forward')} variant="quiet" onClick={onForward} disabled={!canForward} /></div>
    </div>
    <div className="titlebar-center" data-tauri-drag-region>GitScope</div>
    {current && <div className="window-buttons">
      <IconButton icon={Minus} label={t('minimize')} variant="quiet" onClick={() => void workspace.perform(() => current.minimize())} />
      <IconButton icon={Square} label={t('maximize')} variant="quiet" onClick={() => void workspace.perform(() => current.toggleMaximize())} />
      <IconButton icon={X} label={t('close')} variant="quiet" className="close-window" onClick={() => void workspace.perform(() => current.close())} />
    </div>}
  </header>
}

function Notifications({ close }: { close: () => void }) {
  const { t, locale } = useI18n()
  const workspace = useWorkspace()
  return <Modal title={t('notifications')} onClose={close} className="notice-modal">
    {workspace.data.notifications.length ? <>
      <ul className="detail-list">{workspace.data.notifications.map(notice => <li key={notice.id}>
        <span className={`state-icon ${notice.seen ? '' : 'notice-unread'}`}><Bell size={16} /></span>
        <div><button className="plain-link" onClick={() => void workspace.perform(() => openGithub(notice.url))}>{notice.title}</button><small>{notice.repo} · {formatDate(new Date(notice.created * 1000).toISOString(), locale, true)}</small></div>
      </li>)}</ul>
      <div className="dialog-actions"><Button onClick={() => void workspace.perform(async () => { await local('notices', { seen: true }); await workspace.sync() })}>{t('markRead')}</Button></div>
    </> : <EmptyState icon={Bell} description={t('noNotices')} />}
  </Modal>
}

function GlobalSearch({ open }: { open: () => void }) {
  const { t } = useI18n()
  return <button className="global-search" aria-haspopup="dialog" onClick={open}><Search size={17} /><span>{t('searchAnything')}</span><kbd>Ctrl K</kbd></button>
}

export function AppShell({ children, effectiveTheme, openPalette, onHistory, canBack, canForward }: {
  children: ReactNode; effectiveTheme: Theme; openPalette: () => void;
  onHistory: (direction: number) => void; canBack: boolean; canForward: boolean
}) {
  const workspace = useWorkspace()
  const { t } = useI18n()
  const [notices, setNotices] = useState(false)
  const main = useRef<HTMLElement>(null)
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = 0 }, [workspace.route])
  const resizers: [string, Parameters<Window['startResizeDragging']>[0]][] = [
    ['top', 'North'], ['right', 'East'], ['bottom', 'South'], ['left', 'West'],
    ['top-left', 'NorthWest'], ['top-right', 'NorthEast'], ['bottom-left', 'SouthWest'], ['bottom-right', 'SouthEast'],
  ]
  return <div className={`app-shell ${workspace.data.settings.collapsed ? 'collapsed' : ''} ${workspace.data.settings.compact ? 'compact' : ''}`}>
    <Titlebar onBack={() => onHistory(-1)} onForward={() => onHistory(1)} canBack={canBack} canForward={canForward} />
    <div className="desktop-body">
      <Sidebar />
      <section className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb"><span>{t('workspace')}</span><ChevronRight size={13} /><strong>{t(workspace.route.page)}</strong></div>
          <div className="workspace-controls">
            <GlobalSearch open={openPalette} />
            <IconButton icon={RefreshCw} label={t('refresh')} onClick={workspace.refresh} />
            <span className="bell-wrap"><IconButton icon={Bell} label={t('notifications')} onClick={() => setNotices(true)} />
              {workspace.data.notifications.some(notice => !notice.seen) && <i />}</span>
            <ThemeToggle effectiveTheme={effectiveTheme} />
            <button className="avatar-button" onClick={() => workspace.navigate({ page: 'settings' })} title={t('profile')} aria-label={t('profile')}><Avatar person={workspace.data.account} /></button>
          </div>
        </header>
        <main ref={main} id="main-content" className="workspace-main">{children}</main>
      </section>
    </div>
    {isTauri() && resizers.map(([side, direction]) => <div aria-hidden="true" className={`resizer resizer-${side}`} key={side}
      onPointerDown={event => { if (event.button === 0) void workspace.perform(() => getCurrentWindow().startResizeDragging(direction)) }} />)}
    {notices && <Notifications close={() => setNotices(false)} />}
  </div>
}

export function CommandPalette({ close, toggleTheme }: { close: () => void; toggleTheme: () => void }) {
  const { t } = useI18n()
  const workspace = useWorkspace()
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = value.trim()
  const possibleRepo = repositoryName(input)
  const commands: { id: string; Icon: LucideIcon; label: string; run: () => void }[] = navGroups.flatMap(([, pages]) => pages.map(([id, Icon]) => ({
    id, Icon, label: t(id), run: () => workspace.navigate({ page: id }),
  })))
  commands.push(
    { id: 'manage', Icon: KeyRound, label: t('manage'), run: () => workspace.navigate({ page: 'manage' }) },
    { id: 'settings', Icon: Settings, label: t('settings'), run: () => workspace.navigate({ page: 'settings' }) },
    { id: 'theme', Icon: Moon, label: t('toggleTheme'), run: toggleTheme },
    { id: 'refresh', Icon: RefreshCw, label: t('refresh'), run: workspace.refresh },
  )
  const filtered = commands.filter(command => !input || command.label.toLowerCase().includes(input.toLowerCase()))
  const choices = input ? [
    ...(possibleRepo ? [
      { id: 'open-repo', Icon: Code2, label: `${t('openRepo')} · ${possibleRepo}`, run: () => workspace.navigate({ page: 'repositories', subject: possibleRepo }) },
      { id: 'watch-repo', Icon: Bookmark, label: `${t('addWatch')} · ${possibleRepo}`, run: () => { void workspace.perform(async () => { await local('watch', { name: possibleRepo }); await workspace.sync() }, 'addedWatch') } },
      { id: 'copy-repo', Icon: Github, label: t('share'), run: () => { void workspace.perform(() => copyText(`https://github.com/${possibleRepo}`), 'copied') } },
    ] : []),
    { id: 'find-repo', Icon: Search, label: t('findRepositories'), run: () => workspace.navigate({ page: 'explore', query: input, kind: 'repositories' }) },
    { id: 'find-users', Icon: CircleUserRound, label: t('findDevelopers'), run: () => workspace.navigate({ page: 'explore', query: input, kind: 'users' }) },
    { id: 'find-org', Icon: Building2, label: t('findOrganizations'), run: () => workspace.navigate({ page: 'explore', query: input, kind: 'organizations' }) },
    ...filtered,
  ] : filtered
  const selected = Math.min(cursor, choices.length - 1)
  function activate(index: number) { const choice = choices[index]; if (choice) { close(); choice.run() } }
  return <Modal title={t('palette')} onClose={close} className="command-dialog">
    <label className="search-field"><Search size={19} /><span className="sr-only">{t('palettePrompt')}</span>
      <input data-initial-focus value={value} placeholder={t('palettePrompt')} maxLength={220} role="combobox" aria-expanded="true" aria-controls="palette-results"
        aria-activedescendant={choices[selected] ? `command-${choices[selected].id}` : undefined}
        onChange={event => { setValue(event.target.value); setCursor(0) }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); activate(selected) }
          if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !choices.length) return
          event.preventDefault()
          const next = (selected + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
          setCursor(next)
          list.current?.children[next]?.scrollIntoView({ block: 'nearest' })
        }} />
    </label>
    <div ref={list} className="command-list" id="palette-results" role="listbox" aria-label={t('palette')}>
      {choices.map(({ id, Icon, label }, index) => <button role="option" id={`command-${id}`} tabIndex={-1} aria-selected={index === selected} key={id}
        onMouseMove={() => setCursor(index)} onClick={() => activate(index)}><Icon size={17} /><span>{label}</span>{index === selected && <ArrowDownRight size={16} />}</button>)}
    </div>
  </Modal>
}
