import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { ArrowRight, ArrowUpRight, CalendarDays, GitFork, Github, Layers, Network, Star, UserRound } from 'lucide-react'
import { digestSeen, nightDigest } from '../api'
import type { Digest } from '../types'
import { useWorkspace } from '../context'
import { useI18n } from '../i18n'
import { useData } from '../query'
import { ActivityTimeline, bucketEvents, RepositoryTable } from '../components/data'
import { Avatar, Button, CacheNotice, ChartCard, EmptyState, ErrorState, LoadingSkeleton, MetricCard, Modal, PageHeading } from '../components/ui'

const SeriesChart = lazy(() => import('../components/Charts').then(module => ({ default: module.SeriesChart })))
const LanguageDistribution = lazy(() => import('../components/Charts').then(module => ({ default: module.LanguageDistribution })))
const ContributionHeatmap = lazy(() => import('../components/Charts').then(module => ({ default: module.ContributionHeatmap })))

export function ProfileSelector({ value, onChange, onClose }: { value: string; onChange: (login: string) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n()
  const [login, setLogin] = useState(value)
  const [busy, setBusy] = useState(false)
  return <Modal title={t('selectProfile')} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault()
      setBusy(true)
      void onChange(login.trim()).then(onClose).catch(() => setBusy(false))
    }}>
      <label className="field">{t('publicProfile')}<input data-initial-focus placeholder={t('usernamePlaceholder')} required maxLength={100} pattern="[a-zA-Z0-9-]+" value={login} onChange={event => setLogin(event.target.value)} /></label>
      <div className="dialog-actions"><Button onClick={onClose}>{t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy}>{t('applyProfile')}</Button></div>
    </form>
  </Modal>
}

export default function Overview() {
  const { t, locale } = useI18n()
  const workspace = useWorkspace()
  const { data, revision } = workspace
  const login = (data.settings.dashboardLogin || data.account?.login || 'github').toLowerCase()
  const [period, setPeriod] = useState('30D')
  const [selector, setSelector] = useState(false)
  const [ready, setReady] = useState(false)
  const [digest, setDigest] = useState<Digest | null>(null)
  const [digestHidden, setDigestHidden] = useState(false)
  useEffect(() => {
    if (!isTauri()) return
    nightDigest().then(setDigest).catch(() => undefined)
  }, [])
  const knownOrganization = login === 'github'
  const profile = useData('profile', { login, organization: false }, revision)
  const organization = knownOrganization || profile.data?.data.type === 'Organization'
  const source = profile.data || knownOrganization ? { login, organization } : null
  const projects = useData('projects', source, revision)
  const events = useData('events', source, revision)
  const series = useMemo(() => bucketEvents(events.data?.data ?? [], period), [events.data, period])
  const heatmap = useData('heatmap', data.account && ready && profile.data && !organization ? { login } : null, revision)
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 220)
    return () => window.clearTimeout(timer)
  }, [])
  const scanNote = projects.data?.partial ? `${t('scannedRepos')} · ${new Intl.NumberFormat(locale).format(projects.data.scanned)}` : t('acrossRepos')
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  const periodLabels: Record<string, string> = { '7D': locale === 'ru-RU' ? '7Д' : '7D', '30D': locale === 'ru-RU' ? '30Д' : '30D', '90D': locale === 'ru-RU' ? '90Д' : '90D', '1Y': locale === 'ru-RU' ? '1Г' : '1Y', All: t('all') }

  return <>
    <PageHeading title={t('greeting')} description={t('dashboardSubtitle')} actions={
      <Button onClick={() => setSelector(true)} className="profile-select">
        {profile.data ? <Avatar person={profile.data.data} /> : <Github size={17} />}
        <span>{login}</span><span className="muted"><ArrowUpRight size={15} /></span>
      </Button>
    }><div className="today"><CalendarDays size={15} />{date}</div></PageHeading>
    {digest && !digestHidden && (digest.items.length > 0 || digest.notices.length > 0) &&
      <div className="card" style={{ borderColor: 'rgba(127,217,127,.45)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{t('digestTitle')}</h3>
          <Button onClick={() => { void digestSeen(); setDigestHidden(true) }}>{t('digestSeen')}</Button>
        </div>
        <div style={{ marginTop: 10 }}>
          {digest.items.map(item => <div key={item.full} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <b>{item.full}</b>
            <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>{item.delta >= 0 ? '+' : ''}{new Intl.NumberFormat(locale).format(item.delta)} ★</span>
            <span className="muted">{new Intl.NumberFormat(locale).format(item.stars)} total</span>
          </div>)}
          {digest.notices.map((notice, index) => <div key={index} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <b>{notice.repo}</b>
            <a href={notice.url} target="_blank" rel="noreferrer">{notice.title}</a>
          </div>)}
        </div>
      </div>}
    {profile.error && <ErrorState inline error={profile.error} retry={profile.retry} />}
    <CacheNotice payload={profile.data} />
    {projects.error && <ErrorState inline error={projects.error} retry={projects.retry} />}
    {projects.data?.warning && <ErrorState inline error={projects.data.warning} />}
    {projects.data?.stale && <div className="inline-state">{t('cached')}</div>}

    <div className="metrics-grid" aria-busy={Boolean(profile.pending || projects.pending)}>
      <MetricCard icon={Star} label={t('stars')} value={projects.data?.totalStars} note={scanNote} featured />
      <MetricCard icon={GitFork} label={t('forks')} value={projects.data?.totalForks} note={scanNote} />
      <MetricCard icon={Layers} label={t('publicRepos')} value={profile.data?.data.public_repos} note={t('ownedProjects')} />
      <MetricCard icon={Network} label={t('contributions')} value={heatmap.data?.data?.totalContributions} note={organization ? t('noData') : data.account ? t('pastYear') : t('requiresSignIn')} />
    </div>

    <div className="overview-grid">
      <ChartCard title={t('activityTrend')} description={t('activitySubtitle')} className="activity-panel" actions={<div className="segmented">
        {Object.keys(periodLabels).map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{periodLabels[value]}</button>)}
      </div>}>
        <div className="chart-inset">
          {events.pending || (profile.pending && !source) ? <LoadingSkeleton /> : events.error ? <ErrorState error={events.error} retry={events.retry} /> :
            events.data?.data.length ? <Suspense fallback={<LoadingSkeleton />}><SeriesChart points={series} label={t('activityTrend')} bars={period !== 'All'} /></Suspense> :
              <EmptyState title={t('noEvents')} />}
        </div>
        <CacheNotice payload={events.data} />
        <p className="panel-footnote">{t('eventWindow')}</p>
      </ChartCard>
      <ChartCard title={t('languages')} description={t('primaryLanguages')} className="language-panel">
        {projects.pending || (profile.pending && !source) ? <LoadingSkeleton /> : projects.error ? <ErrorState error={projects.error} retry={projects.retry} /> :
          projects.data ? <Suspense fallback={<LoadingSkeleton />}><LanguageDistribution values={projects.data.languages} /></Suspense> : <EmptyState />}
      </ChartCard>
      <ChartCard title={t('topRepos')} actions={<Button variant="quiet" onClick={() => workspace.navigate({ page: organization ? 'organizations' : 'developers', subject: login })}>{t('allRepos')}<ArrowUpRight size={15} /></Button>}>
        {projects.pending || (profile.pending && !source) ? <LoadingSkeleton compact /> : <RepositoryTable repositories={projects.data?.repositories.slice(0, 6) ?? []} />}
      </ChartCard>
      <ChartCard title={t('recentActivity')} actions={<Button variant="quiet" aria-label={t('allActivity')} onClick={() => workspace.navigate({ page: 'activity', subject: login, kind: organization ? 'organizations' : 'users' })}><ArrowUpRight size={16} /></Button>}>
        {events.pending || (profile.pending && !source) ? <LoadingSkeleton compact /> : <ActivityTimeline events={events.data?.data.slice(0, 5) ?? []} />}
      </ChartCard>
    </div>
    <ChartCard title={t('contributionCalendar')} description={t('pastYear')}>
      {heatmap.pending ? <LoadingSkeleton compact /> : heatmap.error ? <ErrorState inline error={heatmap.error} retry={heatmap.retry} /> :
        heatmap.data?.data ? <Suspense fallback={<LoadingSkeleton compact />}><CacheNotice payload={heatmap.data} /><ContributionHeatmap calendar={heatmap.data.data} /></Suspense> :
          <EmptyState icon={UserRound} description={organization ? t('noData') : t('requiresSignIn')} action={!data.account && !organization && <Button onClick={() => workspace.navigate({ page: 'settings' })}>{t('signIn')}<ArrowRight size={15} /></Button>} />}
    </ChartCard>
    {selector && <ProfileSelector value={login} onClose={() => setSelector(false)} onChange={dashboardLogin => workspace.settings({ dashboardLogin })} />}
  </>
}
