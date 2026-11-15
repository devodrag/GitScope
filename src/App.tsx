import { lazy, memo, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { AlertCircle, CheckCircle2, Radar, X } from 'lucide-react'
import { asError, bootstrap, local, refreshWatched, repositoryName } from './api'
import { WorkspaceContext } from './context'
import { errorText, LanguageContext, translate, type Key } from './i18n'
import { invalidateClientKey } from './query'
import { useSession } from './session'
import type { AppError, Bootstrap, Route, Settings as Preferences, WatchRefresh } from './types'
import { AppShell, CommandPalette } from './components/Shell'
import { ErrorState, IconButton, LoadingSkeleton } from './components/ui'

const loadOverview = () => import('./pages/Overview')
const loadExplore = () => import('./pages/Explore')
const loadRepositories = () => import('./pages/Repository')
const loadSettings = () => import('./pages/Settings')
const Overview = lazy(loadOverview)
const Explore = lazy(loadExplore)
const Repositories = lazy(loadRepositories)
const Profiles = lazy(() => import('./pages/Profiles'))
const Compare = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Compare })))
const Trending = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Trending })))
const Activity = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Activity })))
const Watchlist = lazy(() => import('./pages/Personal').then(module => ({ default: module.Watchlist })))
const Collections = lazy(() => import('./pages/Personal').then(module => ({ default: module.Collections })))
const Manage = lazy(() => import('./pages/Manage'))
const Settings = lazy(loadSettings)

const screens = { overview: Overview, explore: Explore, repositories: Repositories, developers: Profiles, organizations: Profiles, compare: Compare, trending: Trending, activity: Activity, watchlist: Watchlist, collections: Collections, manage: Manage, settings: Settings }

const PageContent = memo(function PageContent({ page }: { page: Route['page'] }) {
  const Screen = screens[page]
  return <Suspense fallback={<LoadingSkeleton />}><div className="page"><Screen /></div></Suspense>
})

type Toast = { id: number; message: string; error: boolean }

export function App() {
  const [data, setData] = useState<Bootstrap>()
  const [startupError, setStartupError] = useState<AppError>()
  const { history, compared, setCompared, resetHistory, navigate, moveHistory } = useSession()
  const [revision, setRevision] = useState(0)
  const [palette, setPalette] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const config = useRef<Preferences | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const toastId = useRef(0)
  const syncGeneration = useRef(0)
  const started = useRef(false)
  const themeMedia = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), [])
  const [systemDark, setSystemDark] = useState(themeMedia.matches)
  const motionMedia = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])
  const [systemReducedMotion, setSystemReducedMotion] = useState(motionMedia.matches)
  const reduceMotion = Boolean(data?.settings.reducedMotion || systemReducedMotion)
  const language = data?.settings.language ?? 'en'
  const effectiveTheme = data?.settings.theme === 'system' || !data ? (systemDark ? 'dark' : 'light') : data.settings.theme
  const route = history.entries[history.cursor]
  const ready = Boolean(data)

  useEffect(() => {
    if (!ready) return
    const load = [loadOverview, loadExplore, loadRepositories, loadSettings]
    let scheduled: number
    const preload = () => {
      const next = load.shift()
      if (!next) return
      void next().catch(() => undefined)
      if (load.length) scheduled = window.requestIdleCallback(preload)
    }
    if (typeof window.requestIdleCallback !== 'function') return
    scheduled = window.requestIdleCallback(preload)
    return () => window.cancelIdleCallback(scheduled)
  }, [ready])

  const notify = useCallback((message: string, error = false) => {
    const id = ++toastId.current
    setToasts(current => [...current.slice(-3), { id, message, error }])
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), error ? 7800 : 3900)
  }, [])
  const perform = useCallback(async <T,>(callback: () => Promise<T>, message?: Key) => {
    const t = (key: Key) => translate(key, language)
    try {
      const result = await callback()
      if (message) notify(t(message))
      return result
    } catch (err) {
      const error = asError(err)
      if (error.code !== 'cancelled') notify(errorText(error.code, t), true)
      return undefined
    }
  }, [language, notify])

  const sync = useCallback(async () => {
    const generation = ++syncGeneration.current
    const result = await bootstrap()
    if (generation !== syncGeneration.current) return
    config.current = result.settings
    setData(result)
    if (!started.current) {
      started.current = true
      resetHistory({ page: result.settings.startup })
    }
  }, [resetHistory])

  const launch = useCallback(() => {
    setStartupError(undefined)
    void sync().catch(error => setStartupError(asError(error)))
  }, [sync])

  useEffect(launch, [launch])
  useEffect(() => {
    const update = () => setSystemDark(themeMedia.matches)
    themeMedia.addEventListener('change', update)
    return () => themeMedia.removeEventListener('change', update)
  }, [themeMedia])
  useEffect(() => {
    const update = () => setSystemReducedMotion(motionMedia.matches)
    motionMedia.addEventListener('change', update)
    return () => motionMedia.removeEventListener('change', update)
  }, [motionMedia])
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
    document.documentElement.dataset.motion = reduceMotion ? 'reduced' : 'full'
    document.documentElement.lang = language
  }, [effectiveTheme, reduceMotion, language])
  useEffect(() => {
    if (!isTauri()) return
    const release = listen('gitscope:release', () => { void perform(sync) })
    const refresh = listen<WatchRefresh>('gitscope:watch-refresh', ({ payload }) => {
      invalidateClientKey('snapshots'); invalidateClientKey('trending')
      if (payload.updated > 0) void perform(sync)
      if (payload.errors[0]) notify(errorText(payload.errors[0].code, key => translate(key, language)), true)
    })
    return () => { for (const pending of [release, refresh]) void pending.then(dispose => dispose()).catch(() => undefined) }
  }, [language, notify, perform, sync])

  const settings = useCallback((patch: Partial<Preferences>) => {
    const pending = saveQueue.current.then(async () => {
      if (!config.current) return
      const value = { ...config.current, ...patch }
      const previous = config.current
      config.current = value
      startTransition(() => setData(current => current ? { ...current, settings: value } : current))
      try {
        await local('settings', value)
      } catch (error) {
        config.current = previous
        setData(current => current ? { ...current, settings: previous } : current)
        throw error
      }
    })
    saveQueue.current = pending.catch(error => notify(errorText(asError(error).code, key => translate(key, language)), true))
    return pending
  }, [language, notify])

  const refresh = useCallback(() => {
    if (route.page === 'watchlist' || route.page === 'collections') {
      void perform(async () => {
        const result = await refreshWatched()
        invalidateClientKey('trending'); invalidateClientKey('snapshots')
        await sync()
        notify(`${translate('refreshDone', language)} · ${result.updated}`)
        if (result.errors[0]) notify(errorText(result.errors[0].code, key => translate(key, language)), true)
      })
    } else {
      if (route.page === 'settings') void perform(sync)
      setRevision(value => value + 1)
    }
  }, [route.page, perform, sync, notify, language])

  const toggleTheme = useCallback(() => { void settings({ theme: effectiveTheme === 'dark' ? 'light' : 'dark' }).catch(() => undefined) }, [settings, effectiveTheme])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key === 'F11' && isTauri()) {
        event.preventDefault()
        const appWindow = getCurrentWindow()
        void perform(async () => appWindow.setFullscreen(!(await appWindow.isFullscreen())))
        return
      }
      if (!event.ctrlKey || event.altKey || event.shiftKey || !started.current) return
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (!document.querySelector('[role=dialog][data-state=open]') || palette) setPalette(current => !current)
        return
      }
      if (document.querySelector('[role=dialog][data-state=open]')) return
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); refresh(); return }
      const pages: Record<string, Route['page']> = { ',': 'settings', '1': 'overview', '2': 'explore', '3': 'repositories', '4': 'compare' }
      const page = pages[event.key]
      if (page) { event.preventDefault(); navigate({ page }) }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [navigate, palette, perform, refresh])

  const watch = useCallback(async (name: string) => {
    const existing = data?.watchlist.some(entry => entry.repo.full_name.toLowerCase() === name.toLowerCase())
    await perform(async () => { await local(existing ? 'unwatch' : 'watch', { name }); await sync() }, existing ? 'removedWatch' : 'addedWatch')
  }, [data?.watchlist, perform, sync])
  const compare = useCallback((input?: string) => {
    const name = input && repositoryName(input)
    if (name && !compared.some(value => value.toLowerCase() === name.toLowerCase())) {
      if (compared.length >= 4) { notify(translate('compareLimit', language), true); return }
      setCompared([...compared, name])
    }
    navigate({ page: 'compare' })
  }, [compared, language, navigate, notify, setCompared])

  const workspace = useMemo(() => data ? { data, route, revision, compared, navigate, settings, refresh, sync, notify, perform, watch, compare, setCompared } : null,
    [data, route, revision, compared, navigate, settings, refresh, sync, notify, perform, watch, compare, setCompared])
  const openPalette = useCallback(() => setPalette(true), [])

  if (!workspace) return <LanguageContext.Provider value={language}><div className="bootstrap"><span className="brand-mark"><Radar size={24} /></span><strong>GitScope</strong>
    {startupError ? <ErrorState error={startupError} retry={launch} /> : <LoadingSkeleton compact />}</div></LanguageContext.Provider>

  const pageKey = JSON.stringify(route)
  return <LanguageContext.Provider value={language}>
    <WorkspaceContext.Provider value={workspace}>
      <AppShell effectiveTheme={effectiveTheme} openPalette={openPalette} onHistory={moveHistory} canBack={history.cursor > 0} canForward={history.cursor < history.entries.length - 1}>
        <PageContent key={pageKey} page={route.page} />
      </AppShell>
      {palette && <CommandPalette close={() => setPalette(false)} toggleTheme={toggleTheme} />}
      <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={`toast ${toast.error ? 'toast-error' : ''}`} key={toast.id}>
        {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span>
        <IconButton label={translate('close', language)} icon={X} variant="quiet" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))} />
      </div>)}</div>
    </WorkspaceContext.Provider>
  </LanguageContext.Provider>
}
