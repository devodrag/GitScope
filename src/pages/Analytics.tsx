import { useState } from 'react'
import { ArrowRight, GitCompareArrows, Plus, Search, X } from 'lucide-react'
import { repositoryName } from '../api'
import { useWorkspace } from '../context'
import { useI18n, type Key } from '../i18n'
import { useData } from '../query'
import type { AppError, Comparison, Repository } from '../types'
import { ActivityTimeline, eventLabel, formatDate, formatNumber, RepositoryCard } from '../components/data'
import { Button, CacheNotice, ChartCard, EmptyState, ErrorState, IconButton, LoadingSkeleton, PageHeading } from '../components/ui'

function ComparisonTable({ projects }: { projects: Comparison[] }) {
  const { t, locale } = useI18n()
  const workspace = useWorkspace()
  const fields: [Key, (project: Comparison) => string][] = [
    ['starsFilter', ({ repo }) => formatNumber(repo.stargazers_count, locale, false)],
    ['forksFilter', ({ repo }) => formatNumber(repo.forks_count, locale, false)],
    ['watchers', ({ repo }) => formatNumber(repo.subscribers_count, locale, false)],
    ['issues', ({ repo }) => formatNumber(repo.open_issues_count, locale, false)],
    ['knownContributors', ({ contributors }) => contributors ? `${contributors.data.length}${contributors.hasNext ? '+' : ''}` : '—'],
    ['latestRelease', ({ release }) => release?.data?.tag_name ?? '—'],
    ['lastCommit', ({ commits }) => formatDate(commits?.data?.[0]?.commit.committer?.date, locale, true)],
    ['created', ({ repo }) => formatDate(repo.created_at, locale, true)],
    ['age', ({ repo }) => {
      const days = Math.floor((Date.now() - new Date(repo.created_at).valueOf()) / 86_400_000)
      return Number.isFinite(days) && days >= 0 ? `${days.toLocaleString(locale)} ${t('days')}` : '—'
    }],
    ['languages', ({ languages }) => Object.keys(languages?.data ?? {}).join(', ') || '—'],
    ['recentEvents', ({ activity }) => activity ? `${activity.data.length}${activity.hasNext ? '+' : ''}` : '—'],
  ]
  return <div className="table-scroll"><table className="repo-table compare-table"><thead><tr>
    <th>{t('repository')}</th>{projects.map(project => <th key={project.repo.id}><button className="plain-link" onClick={() => workspace.navigate({ page: 'repositories', subject: project.repo.full_name })}>{project.repo.full_name}</button></th>)}
  </tr></thead><tbody>{fields.map(([key, value]) => <tr key={key}><th scope="row">{t(key)}</th>
    {projects.map(project => <td key={project.repo.id}>{value(project)}</td>)}</tr>)}</tbody></table></div>
}

export function Compare() {
  const workspace = useWorkspace()
  const { t, locale } = useI18n()
  const [input, setInput] = useState('')
  const [published, setPublished] = useState<string[] | null>(null)
  const [error, setError] = useState<AppError>()
  const result = useData('compare', published ? { names: published } : null, workspace.revision)
  const add = () => {
    const repo = repositoryName(input)
    if (!repo || workspace.compared.some(current => current.toLowerCase() === repo.toLowerCase())) { setError({ code: 'validation' }); return }
    if (workspace.compared.length >= 4) { workspace.notify(t('compareLimit'), true); return }
    workspace.setCompared([...workspace.compared, repo]); setInput(''); setError(undefined); setPublished(null)
  }
  const projects = result.data ?? []
  const max = Math.max(1, ...projects.map(project => project.repo.stargazers_count))
  return <>
    <PageHeading title={t('compareTitle')} description={t('compareSubtitle')} />
    <section className="panel compare-controls">
      <form className="toolbar" onSubmit={event => { event.preventDefault(); add() }}>
        <label className="search-field"><Search size={17} /><span className="sr-only">{t('repositoryInput')}</span><input placeholder={t('repoPlaceholder')} value={input} onChange={event => setInput(event.target.value)} maxLength={230} /></label>
        <Button type="submit" disabled={!input.trim() || workspace.compared.length >= 4}><Plus size={17} />{t('addRepo')}</Button>
        <Button variant="primary" disabled={workspace.compared.length < 2} onClick={() => setPublished(workspace.compared)}>{t('startCompare')}<ArrowRight size={17} /></Button>
      </form>
      <div className="chips">{workspace.compared.map(name => <span key={name} className="pill">{name}<IconButton variant="quiet" icon={X} label={`${t('remove')} ${name}`} onClick={() => { workspace.setCompared(workspace.compared.filter(item => item !== name)); setPublished(null) }} /></span>)}</div>
      {error && <ErrorState error={error} inline />}
    </section>
    {!published ? <section className="panel"><EmptyState icon={GitCompareArrows} description={t('compareEmpty')} /></section> : result.pending ? <LoadingSkeleton /> : result.error ? <section className="panel"><ErrorState error={result.error} retry={result.retry} /></section> : <>
      <ChartCard title={t('starsFilter')}><div className="compare-bars">{projects.map(({ repo }) => <div key={repo.id}><span>{repo.full_name}</span>
        <div className="compare-track"><i style={{ width: `${repo.stargazers_count / max * 100}%` }} /></div><strong>{formatNumber(repo.stargazers_count, locale, false)}</strong></div>)}</div></ChartCard>
      <ChartCard title={t('compare')}><ComparisonTable projects={projects} />
        {projects.map(project => <div key={project.repo.id}>
          {project.errors.length > 0 && <div className="inline-state"><span>{project.repo.full_name}</span><ErrorState inline error={project.errors[0]} /></div>}
          {[project.languages, project.contributors, project.release, project.commits, project.activity].some(entry => entry?.stale) && <p className="panel-footnote">{project.repo.full_name} · {t('cached')}</p>}
        </div>)}
      </ChartCard>
    </>}
  </>
}

const languages = ['Rust', 'TypeScript', 'Python', 'Go', 'C++', 'Java', 'JavaScript', 'C', 'C#', 'Ruby', 'Kotlin', 'Swift', 'Zig', 'Lua']

export function Trending() {
  const { revision } = useWorkspace()
  const { t, locale } = useI18n()
  const [days, setDays] = useState(7)
  const [language, setLanguage] = useState('')
  const result = useData('trending', { days, language }, revision)
  return <>
    <PageHeading title={t('trendTitle')} description={t('trendSubtitle')} />
    <div className="toolbar">
      <div className="segmented">{([[1, 'today'], [7, 'week'], [30, 'month']] as const).map(([id, label]) => <button key={id} aria-pressed={id === days} onClick={() => setDays(id)}>{t(label)}</button>)}</div>
      <select aria-label={t('language')} value={language} onChange={event => setLanguage(event.target.value)}><option value="">{t('allLanguages')}</option>{languages.map(value => <option key={value}>{value}</option>)}<option value="__other__">{t('other')}</option></select>
    </div>
    {result.pending ? <LoadingSkeleton /> : result.error ? <section className="panel"><ErrorState error={result.error} retry={result.retry} /></section> : result.data && <>
      {result.data.observed.length > 0 && <ChartCard title={t('observed')} description={t('observedScope')}><div className="card-grid">{result.data.observed.map(({ repo, delta }) =>
        <RepositoryCard repo={repo} key={repo.id}><span className="growth-chip">+{formatNumber(delta, locale, false)} {t('starsFilter').toLocaleLowerCase(locale)}</span></RepositoryCard>)}</div></ChartCard>}
      <ChartCard title={t('discovery')} description={t('discoveryScope')}>
        <CacheNotice payload={result.data.discovery} />
        {result.data.discoveryError && <ErrorState error={result.data.discoveryError} retry={result.retry} />}
        {result.data.discovery && (result.data.discovery.data.items.length ? <div className="card-grid">{(result.data.discovery.data.items as Repository[]).map(repo => <RepositoryCard repo={repo} key={repo.id} />)}</div> : <EmptyState />)}
      </ChartCard>
    </>}
  </>
}

export function Activity() {
  const { t } = useI18n()
  const workspace = useWorkspace()
  const [name, setName] = useState(workspace.route.subject || workspace.data.settings.dashboardLogin || workspace.data.account?.login || 'github')
  const [login, setLogin] = useState(name)
  const [kind, setKind] = useState<'auto' | 'users' | 'organizations'>(workspace.route.kind === 'organizations' || workspace.route.kind === 'users' ? workspace.route.kind : 'auto')
  const [type, setType] = useState('')
  const [repository, setRepository] = useState('')
  const [visible, setVisible] = useState(20)
  const profile = useData('profile', kind === 'auto' ? { login } : null, workspace.revision)
  const result = useData('events', kind === 'auto' && !profile.data ? null : { login, organization: kind === 'organizations' || profile.data?.data.type === 'Organization' }, workspace.revision)
  const all = result.data?.data ?? []
  const repos = [...new Set(all.map(event => event.repo.name))].sort()
  const types = [...new Set(all.map(event => event.type))].sort()
  const filtered = all.filter(event => (!type || event.type === type) && (!repository || event.repo.name === repository))
  const error = profile.error ?? result.error
  return <>
    <PageHeading title={t('activityTitle')} description={t('activityHint')} />
    <section className="panel search-panel">
      <form className="toolbar" onSubmit={event => { event.preventDefault(); setLogin(name.trim()); setType(''); setRepository(''); setVisible(20) }}>
        <label className="search-field"><Search size={17} /><span className="sr-only">{t('publicProfile')}</span><input required pattern="[a-zA-Z0-9-]+" placeholder={t('usernamePlaceholder')} value={name} onChange={event => setName(event.target.value)} /></label>
        <Button type="submit" variant="primary">{t('search')}</Button>
        <select aria-label={t('selectSource')} value={kind} onChange={event => { setKind(event.target.value as typeof kind); setType(''); setRepository(''); setVisible(20) }}>
          <option value="auto">{t('autoProfile')}</option><option value="users">{t('developers')}</option><option value="organizations">{t('organizations')}</option>
        </select>
      </form>
    </section>
    <ChartCard title={t('activity')} description={t('eventWindow')}>
      <div className="toolbar">
        <select aria-label={t('eventType')} value={type} onChange={event => { setType(event.target.value); setVisible(20) }}><option value="">{t('allEvents')}</option>
          {types.map(value => <option key={value} value={value}>{t(eventLabel(value))} · {value}</option>)}</select>
        <select aria-label={t('repository')} value={repository} onChange={event => { setRepository(event.target.value); setVisible(20) }}><option value="">{t('allRepositories')}</option>
          {repos.map(value => <option key={value}>{value}</option>)}</select>
      </div>
      <CacheNotice payload={result.data} />
      {result.pending || profile.pending ? <LoadingSkeleton /> : error ? <ErrorState error={error} retry={profile.error ? profile.retry : result.retry} /> : <ActivityTimeline events={filtered.slice(0, visible)} />}
      {filtered.length > visible && <Button onClick={() => setVisible(value => value + 20)}>{t('more')}</Button>}
    </ChartCard>
  </>
}
