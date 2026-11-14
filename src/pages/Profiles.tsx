import { lazy, Suspense, useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, Layers, MapPin, Star, Users } from 'lucide-react'
import { useWorkspace } from '../context'
import { useI18n } from '../i18n'
import { useData } from '../query'
import { ActivityTimeline, RepositoryTable } from '../components/data'
import { Avatar, CacheNotice, ChartCard, EmptyState, ErrorState, GithubLink, IconButton, LoadingSkeleton, MetricCard, PageHeading } from '../components/ui'
import { DeveloperCard } from './Explore'
import { Lookup } from './Repository'

const LanguageDistribution = lazy(() => import('../components/Charts').then(module => ({ default: module.LanguageDistribution })))
const ContributionHeatmap = lazy(() => import('../components/Charts').then(module => ({ default: module.ContributionHeatmap })))

export default function Profiles() {
  const workspace = useWorkspace()
  const { t } = useI18n()
  const login = workspace.route.subject?.toLowerCase()
  const organization = workspace.route.page === 'organizations'
  const page = organization ? 'organizations' : 'developers'
  const revision = workspace.revision
  const profile = useData('profile', login ? { login, organization } : null, revision)
  const active = profile.data?.data
  const args = active && login ? { login, organization } : null
  const projects = useData('projects', args, revision)
  const recent = useData('events', args, revision)
  const calendar = useData('heatmap', args && workspace.data.account && !organization ? { login: args.login } : null, revision)
  const [memberPage, setMemberPage] = useState(1)
  const members = useData('members', args && organization ? { login: args.login, page: memberPage } : null, revision)
  if (!login) return <Lookup type="login" title={t(page)} description={t(organization ? 'orgSubtitle' : 'developersSubtitle')} placeholder={t('usernamePlaceholder')}
    button={t('openProfile')} submit={subject => workspace.navigate({ page, subject })} />
  if (!active) return <><PageHeading title={login} /><section className="panel">{profile.error ? <ErrorState error={profile.error} retry={profile.retry} /> : <LoadingSkeleton />}</section></>
  return <>
    <section className="profile-hero panel"><Avatar person={active} large /><div className="hero-copy"><span className="muted">@{active.login}</span><h1>{active.name ?? active.login}</h1>
      <p>{active.bio ?? active.description ?? t('noDescription')}</p><div className="hero-meta">
        {active.location && <span><MapPin size={14} />{active.location}</span>}{active.company && <span><Building2 size={14} />{active.company}</span>}</div>
    </div><div className="hero-actions"><GithubLink url={active.html_url ?? `https://github.com/${active.login}`} /></div></section>
    <CacheNotice payload={profile.data} />
    {projects.data?.partial && <div className="inline-state">{t('partialProjects')}</div>}
    {projects.data?.stale && <div className="inline-state">{t('cached')}</div>}
    {projects.data?.warning && <ErrorState inline error={projects.data.warning} />}
    <div className="metrics-grid">
      <MetricCard icon={Star} label={t('stars')} value={projects.data?.totalStars} note={t('acrossRepos')} featured />
      <MetricCard icon={Layers} label={t('publicRepos')} value={active.public_repos} />
      <MetricCard icon={Users} label={t('followers')} value={active.followers} />
      <MetricCard icon={Users} label={t('following')} value={active.following} />
    </div>
    <div className="overview-grid">
      <ChartCard title={t('topRepos')}>{projects.pending ? <LoadingSkeleton /> : projects.error ? <ErrorState error={projects.error} retry={projects.retry} /> : <RepositoryTable repositories={projects.data?.repositories ?? []} canCompare={organization} />}</ChartCard>
      <ChartCard title={t('languages')} description={t('primaryLanguages')}>{projects.pending ? <LoadingSkeleton /> :
        projects.data ? <Suspense fallback={<LoadingSkeleton />}><LanguageDistribution values={projects.data.languages} /></Suspense> : <EmptyState />}</ChartCard>
    </div>
    {!organization && <ChartCard title={t('contributionCalendar')} description={t('pastYear')}>{calendar.pending ? <LoadingSkeleton compact /> : calendar.error ? <ErrorState error={calendar.error} retry={calendar.retry} /> :
      calendar.data?.data ? <Suspense fallback={<LoadingSkeleton compact />}><CacheNotice payload={calendar.data} /><ContributionHeatmap calendar={calendar.data.data} /></Suspense> : <EmptyState description={!workspace.data.account ? t('requiresSignIn') : undefined} />}</ChartCard>}
    {organization && <ChartCard title={t('publicMembers')}>
      <CacheNotice payload={members.data} />
      {members.pending ? <LoadingSkeleton /> : members.error ? <ErrorState error={members.error} retry={members.retry} /> :
        members.data?.data.length ? <div className="card-grid">{members.data.data.map(person => <DeveloperCard key={person.login} person={person} />)}</div> : <EmptyState />}
      {(memberPage > 1 || members.data?.hasNext) && <div className="pagination"><IconButton label={t('previous')} icon={ArrowLeft} disabled={memberPage <= 1} onClick={() => setMemberPage(memberPage - 1)} />
        <span>{memberPage}</span><IconButton label={t('next')} icon={ArrowRight} disabled={!members.data?.hasNext || memberPage >= 100} onClick={() => setMemberPage(memberPage + 1)} /></div>}
    </ChartCard>}
    <ChartCard title={t('recentActivity')} description={t('eventWindow')}><CacheNotice payload={recent.data} />
      {recent.pending ? <LoadingSkeleton /> : recent.error ? <ErrorState error={recent.error} retry={recent.retry} /> : <ActivityTimeline events={recent.data?.data.slice(0, 10) ?? []} />}</ChartCard>
  </>
}
