import { lazy, Suspense, useState } from 'react'
import { ArrowLeft, ArrowRight, ChartNoAxesCombined, CircleDot, Download, Eye, GitFork, GitPullRequest, Link2, Star } from 'lucide-react'
import { copyText, exportData, repositoryName } from '../api'
import { useWorkspace } from '../context'
import { useI18n, type Key } from '../i18n'
import { useData } from '../query'
import type { Commit, Contributor, Event, Payload, Release, Repository as Repo, Snapshot } from '../types'
import { ActivityTimeline, formatDate, LanguageBadge } from '../components/data'
import { Avatar, Button, CacheNotice, ChartCard, EmptyState, ErrorState, GithubLink, IconButton, LoadingSkeleton, MetricCard, PageHeading } from '../components/ui'
import { WatchButton } from '../components/data'

const SeriesChart = lazy(() => import('../components/Charts').then(module => ({ default: module.SeriesChart })))
const LanguageDistribution = lazy(() => import('../components/Charts').then(module => ({ default: module.LanguageDistribution })))
const tabs = ['overview', 'growth', 'commits', 'contributors', 'languages', 'releases', 'health'] as const
type Tab = typeof tabs[number]

export function Lookup({ title, description, placeholder, button, submit, type = 'repo' }: {
  title: string; description: string; placeholder: string; button: string; submit: (value: string) => void; type?: 'repo' | 'login'
}) {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const { t } = useI18n()
  return <><PageHeading title={title} description={description} /><section className="panel lookup">
    <form onSubmit={event => {
      event.preventDefault()
      const normalized = type === 'repo' ? repositoryName(value) : /^[a-z0-9-]{1,100}$/i.test(value.trim()) ? value.trim() : null
      setInvalid(!normalized)
      if (normalized) submit(normalized)
    }}>
      <label className="field">{type === 'repo' ? t('repositoryInput') : t('publicProfile')}<input required maxLength={250} placeholder={placeholder} value={value} onChange={event => { setValue(event.target.value); setInvalid(false) }} /></label>
      <Button variant="primary" type="submit">{button}<ArrowRight size={17} /></Button>
    </form>
    {invalid && <ErrorState error={{ code: 'validation' }} inline />}
  </section></>
}

function Growth({ name }: { name: string }) {
  const { revision } = useWorkspace()
  const { t } = useI18n()
  const data = useData('snapshots', { name }, revision)
  const [metric, setMetric] = useState<Exclude<keyof Snapshot, 'day'>>('stars')
  const choices = [['stars', 'starsFilter'], ['forks', 'forksFilter'], ['watchers', 'watchers'], ['issues', 'issues']] as const
  return <ChartCard title={t('growth')} description={t('historySource')} actions={<div className="segmented">{choices.map(([id, label]) => <button key={id} aria-pressed={id === metric} onClick={() => setMetric(id)}>{t(label)}</button>)}</div>}>
    {data.pending ? <LoadingSkeleton /> : data.error ? <ErrorState error={data.error} retry={data.retry} /> : (data.data?.length ?? 0) < 2 ?
      <EmptyState icon={ChartNoAxesCombined} description={t('historyEmpty')} /> :
      <Suspense fallback={<LoadingSkeleton />}><SeriesChart points={(data.data ?? []).map(snapshot => ({ date: snapshot.day, value: snapshot[metric] }))} label={t(choices.find(([value]) => value === metric)![1])} /></Suspense>}
  </ChartCard>
}

function Section({ repo, tab }: { repo: Repo; tab: 'commits' | 'contributors' | 'languages' | 'releases' | 'events' }) {
  const { t, locale } = useI18n()
  const workspace = useWorkspace()
  const [page, setPage] = useState(1)
  const result = useData('section', { name: repo.full_name, section: tab, page }, workspace.revision)
  const content = (result.data as Payload<unknown> | undefined)?.data
  const changes = Object.entries(result.data?.commitDays ?? {}).map(([date, value]) => ({ date, value }))
  return <ChartCard title={t(tab === 'events' ? 'recentActivity' : tab)} description={tab === 'languages' ? t('codeBytes') : tab === 'commits' ? t('commitScope') : undefined}>
    <CacheNotice payload={result.data} />
    {result.pending && !result.data ? <LoadingSkeleton /> : result.error ? <ErrorState error={result.error} retry={result.retry} /> :
      tab === 'languages' ? <Suspense fallback={<LoadingSkeleton />}><LanguageDistribution bytes values={(content ?? {}) as Record<string, number>} /></Suspense> :
      !Array.isArray(content) || !content.length ? <EmptyState /> :
      tab === 'events' ? <ActivityTimeline events={content as Event[]} /> :
      tab === 'commits' ? <>
        {changes.length > 0 && <div className="chart-inset"><Suspense fallback={<LoadingSkeleton compact />}><SeriesChart points={changes} label={t('commits')} bars /></Suspense></div>}
        <ul className="detail-list">{(content as Commit[]).map(commit => <li key={commit.sha}><Avatar person={commit.author} /><div><strong>{commit.commit.message.split('\n')[0]}</strong>
          <small>{commit.author?.login ?? commit.commit.author?.name} · {formatDate(commit.commit.committer?.date, locale, true)}</small></div><GithubLink url={commit.html_url} minimal>{commit.sha.slice(0, 7)}</GithubLink></li>)}</ul>
      </> : tab === 'contributors' ? <ul className="detail-list">{(content as Contributor[]).map(person => <li key={person.id}><Avatar person={person} /><div>
        <button className="plain-link" onClick={() => workspace.navigate({ page: 'developers', subject: person.login })}>{person.login}</button></div>
        <strong>{new Intl.NumberFormat(locale).format(person.contributions)} {t('contributions').toLocaleLowerCase(locale)}</strong></li>)}</ul> :
      <div className="releases">{(content as Release[]).map(release => <article key={release.id}>
        <div className="release-head"><div><strong>{release.name || release.tag_name}</strong><small>{release.tag_name} · {formatDate(release.published_at, locale, true)}{release.prerelease && ` · ${t('prerelease')}`}</small></div>
          <GithubLink url={release.html_url} minimal>{t('openRelease')}</GithubLink></div>
        {release.body && <details><summary>{t('releaseNotes')}</summary><pre>{release.body}</pre></details>}
      </article>)}</div>}
    {(page > 1 || result.data?.hasNext) && <div className="pagination"><IconButton icon={ArrowLeft} label={t('previous')} disabled={page <= 1} onClick={() => setPage(page - 1)} />
      <span>{page}</span><IconButton icon={ArrowRight} label={t('next')} disabled={!result.data?.hasNext || page >= 10} onClick={() => setPage(page + 1)} /></div>}
  </ChartCard>
}

function Health({ name }: { name: string }) {
  const { t, locale } = useI18n()
  const { revision } = useWorkspace()
  const result = useData('health', { name }, revision)
  const metrics: [Key, Key, number | null | undefined][] = [
    ['recency', 'recencyFormula', result.data?.recency], ['diversity', 'diversityFormula', result.data?.diversity],
    ['cadence', 'cadenceFormula', result.data?.cadence], ['consistency', 'consistencyFormula', result.data?.consistency],
  ]
  return <ChartCard title={t('health')} description={t('healthScope')}>
    {result.pending ? <LoadingSkeleton /> : result.error ? <ErrorState error={result.error} retry={result.retry} /> :
      <><ul className="detail-list">{metrics.map(([label, formula, value]) => <li key={label}><div><strong>{t(label)}</strong><small>{t(formula)}</small></div><strong>{value ?? '—'}{value != null && '/100'}</strong></li>)}
        <li><div><strong>{t('responsiveness')}</strong><small>{t(result.data?.issueResponseMinutes != null ? 'responseSample' : 'responsivenessFormula')}{result.data?.issueResponseSample ? ` · n=${result.data.issueResponseSample}` : ''}</small></div>
          <strong>{result.data?.issueResponseMinutes != null ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(result.data.issueResponseMinutes / 60)} ${t('hours')}` : '—'}</strong></li></ul>
        {result.data?.issueResponseError && <ErrorState inline error={result.data.issueResponseError} /> }
        {result.data?.cached && <p className="panel-footnote">{t('cached')}</p>}</>}
  </ChartCard>
}

export default function Repository() {
  const workspace = useWorkspace()
  const { t, locale } = useI18n()
  const name = workspace.route.subject
  const [tab, setTab] = useState<Tab>('overview')
  const result = useData('repository', name ? { name } : null, workspace.revision)
  const repo = result.data?.data
  if (!name) return <Lookup title={t('repositories')} description={t('repositorySubtitle')} placeholder={t('repoPlaceholder')} button={t('openRepo')}
    submit={name => workspace.navigate({ page: 'repositories', subject: name })} />
  if (!repo) return <><PageHeading title={name} /><section className="panel">{result.error ? <ErrorState error={result.error} retry={result.retry} /> : <LoadingSkeleton />}</section></>

  return <>
    <div className="profile-hero panel">
      <Avatar person={repo.owner} large />
      <div className="hero-copy"><span className="muted">{repo.owner.login}</span><h1>{repo.name}</h1><p>{repo.description ?? t('noDescription')}</p>
        <div className="hero-meta"><LanguageBadge language={repo.language} /><span>{repo.license?.spdx_id ?? repo.license?.name ?? '—'}</span>
          <span>{t('updated')} {formatDate(repo.updated_at, locale, true)}</span>{repo.archived && <span className="pill">{t('archived')}</span>}</div>
      </div>
      <div className="hero-actions"><GithubLink url={repo.html_url} /><WatchButton repo={repo} />
        <Button onClick={() => workspace.compare(repo.full_name)}><GitPullRequest size={16} />{t('compare')}</Button>
        <IconButton icon={Link2} label={t('share')} onClick={() => void workspace.perform(() => copyText(repo.html_url), 'copied')} />
        <IconButton icon={Download} label={t('export')} onClick={() => void workspace.perform(async () => { if (await exportData(repo.full_name)) workspace.notify(t('exportDone')) })} />
      </div>
    </div>
    <CacheNotice payload={result.data} />
    {result.error && <ErrorState inline error={result.error} retry={result.retry} />}
    <div className="metrics-grid">
      <MetricCard icon={Star} label={t('starsFilter')} value={repo.stargazers_count} featured />
      <MetricCard icon={GitFork} label={t('forksFilter')} value={repo.forks_count} />
      <MetricCard icon={Eye} label={t('watchers')} value={repo.subscribers_count} />
      <MetricCard icon={CircleDot} label={t('issues')} value={repo.open_issues_count} />
    </div>
    <div className="tabs section-tabs">{tabs.map(id => <Button key={id} variant={id === tab ? 'primary' : 'quiet'} aria-pressed={id === tab} onClick={() => setTab(id)}>{t(id)}</Button>)}</div>
    <div className="repo-tab-content" key={tab}>
      {tab === 'overview' && <div className="overview-grid"><Section repo={repo} tab="events" /><Section repo={repo} tab="languages" /></div>}
      {tab === 'growth' && <Growth name={repo.full_name} />}
      {tab === 'health' && <Health name={repo.full_name} />}
      {tab !== 'overview' && tab !== 'growth' && tab !== 'health' && <Section repo={repo} tab={tab} key={tab} />}
    </div>
  </>
}
