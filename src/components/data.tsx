import { ArrowUpRight, Bookmark, CircleDot, GitBranch, GitCommit, GitFork, GitPullRequest, Package, Star } from 'lucide-react'
import { useI18n, type Key } from '../i18n'
import { useWorkspace } from '../context'
import type { Event, Repository } from '../types'
import { Avatar, Button, EmptyState, IconButton } from './ui'
import { openGithub } from '../api'

import { formatDate, formatNumber } from '../formats'
export { formatDate, formatNumber } from '../formats'

export function LanguageBadge({ language }: { language?: string | null }) {
  if (!language) return <span className="muted">—</span>
  return <span className="language-badge"><i style={{ background: ({ Rust: '#ac684f', TypeScript: '#5b7cb4', JavaScript: '#bb9f40', Python: '#6989a6', Go: '#598f96', Ruby: '#b86b68' } as Record<string, string>)[language] ?? '#7a8279' }} />{language}</span>
}
export function WatchButton({ repo, icon = false }: { repo: Repository; icon?: boolean }) {
  const workspace = useWorkspace()
  const { t } = useI18n()
  const watched = workspace.data.watchlist.some(entry => entry.repo.id === repo.id)
  const label = t(watched ? 'removeWatch' : 'addWatch')
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget
    button.disabled = true
    void workspace.watch(repo.full_name).finally(() => { button.disabled = false })
  }
  return icon ? <IconButton icon={Bookmark} label={label} aria-pressed={watched} onClick={onClick} /> :
    <Button onClick={onClick} aria-pressed={watched}><Bookmark size={16} fill={watched ? 'currentColor' : 'none'} />{label}</Button>
}
export function RepositoryCard({ repo, children }: { repo: Repository; children?: React.ReactNode }) {
  const { locale, t } = useI18n()
  const workspace = useWorkspace()
  return <article className="repo-card panel">
    <div className="repo-card-head"><Avatar person={repo.owner} /><div className="truncate"><small>{repo.owner.login}</small><button className="plain-link block truncate" onClick={() => workspace.navigate({ page: 'repositories', subject: repo.full_name })}>{repo.name}</button></div><WatchButton repo={repo} icon /></div>
    <p>{repo.description ?? t('noDescription')}</p>
    <div className="repo-card-meta"><LanguageBadge language={repo.language} /><span title={t('starsFilter')}><Star size={15} />{formatNumber(repo.stargazers_count, locale)}</span><span title={t('forksFilter')}><GitFork size={15} />{formatNumber(repo.forks_count, locale)}</span></div>
    <div className="repo-card-dates"><span>{t('created')} {formatDate(repo.created_at, locale, true)}</span><span>{t('updated')} {formatDate(repo.updated_at, locale, true)}</span></div>
    {children}
  </article>
}
export function RepositoryTable({ repositories, canCompare = false }: { repositories: Repository[]; canCompare?: boolean }) {
  const workspace = useWorkspace()
  const { locale, t } = useI18n()
  if (!repositories.length) return <EmptyState />
  return <div className="table-scroll"><table className="repo-table">
    <thead><tr><th>{t('repository')}</th><th>{t('language')}</th><th>{t('starsFilter')}</th><th>{t('forksFilter')}</th><th>{t('updated')}</th>{canCompare && <th><span className="sr-only">{t('compare')}</span></th>}</tr></thead>
    <tbody>{repositories.map(repo => <tr key={repo.id}>
      <td><div className="table-project"><Avatar person={repo.owner} /><div><button className="plain-link" onClick={() => workspace.navigate({ page: 'repositories', subject: repo.full_name })}>{repo.name}</button><small>{repo.owner.login}</small></div></div></td>
      <td><LanguageBadge language={repo.language} /></td>
      <td>{formatNumber(repo.stargazers_count, locale)}</td><td>{formatNumber(repo.forks_count, locale)}</td><td>{formatDate(repo.updated_at, locale)}</td>
      {canCompare && <td><Button onClick={() => workspace.compare(repo.full_name)}>{t('compare')}</Button></td>}
    </tr>)}</tbody>
  </table></div>
}

const eventInfo: Record<string, [Key, typeof Star]> = {
  PushEvent: ['eventPush', GitCommit],
  ReleaseEvent: ['eventRelease', Package],
  PullRequestEvent: ['eventPR', GitPullRequest],
  IssuesEvent: ['eventIssue', CircleDot],
  WatchEvent: ['eventStar', Star],
  ForkEvent: ['eventFork', GitFork],
  CreateEvent: ['eventCreate', GitBranch],
  DeleteEvent: ['eventDelete', GitBranch],
  IssueCommentEvent: ['eventComment', CircleDot],
  CommitCommentEvent: ['eventComment', GitCommit],
}

export function eventLabel(type: string): Key { return eventInfo[type]?.[0] ?? 'eventOther' }

export function eventUrl(event: Event) {
  const payload = event.payload ?? {}
  const base = `https://github.com/${event.repo.name}`
  const number = payload.number
  const ref = payload.ref?.replace(/^refs\/heads\//, '')
  const destination = payload.release?.html_url ?? payload.comment?.html_url ?? payload.pull_request?.html_url ?? payload.issue?.html_url
  if (destination) return destination
  if (event.type === 'PullRequestEvent' && number) return `${base}/pull/${number}`
  if (event.type === 'PushEvent' && ref) return `${base}/commits/${encodeURIComponent(ref)}`
  return base
}

export function ActivityTimeline({ events }: { events: Event[] }) {
  const { t, locale } = useI18n()
  const workspace = useWorkspace()
  if (!events.length) return <EmptyState title={t('noEvents')} />
  return <ol className="timeline">
    {events.map(event => {
      const Icon = eventInfo[event.type]?.[1] ?? CircleDot
      const detail = event.payload?.release?.tag_name ?? event.payload?.pull_request?.title ?? event.payload?.issue?.title
      return <li key={event.id}><span className="timeline-icon"><Icon size={15} /></span><div className="timeline-copy">
        <button className="plain-link" onClick={() => void workspace.perform(() => openGithub(eventUrl(event)))}>{t(eventLabel(event.type))}</button>
        <small>{event.repo.name}{detail ? ` · ${detail}` : ''}</small>
      </div><time dateTime={event.created_at}>{formatDate(event.created_at, locale)}</time>
        <IconButton label={t('openGitHub')} icon={ArrowUpRight} variant="quiet" onClick={() => void workspace.perform(() => openGithub(eventUrl(event)))} /></li>
    })}
  </ol>
}

export function bucketEvents(events: Event[], period: string, now = new Date()) {
  if (!events.length) return []
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const counts = new Map<string, number>()
  for (const event of events) {
    const date = event.created_at.slice(0, 10)
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }
  const observed = [...counts.keys()].sort()
  const earliest = Date.parse(observed[0])
  const days = ({ '7D': 7, '30D': 30, '90D': 90, '1Y': 365 } as Record<string, number>)[period] ?? 365
  const start = Math.max(earliest, today - (days - 1) * 86400000)
  if (!Number.isFinite(start) || start > today) return []
  const points = []
  for (let day = start; day <= today; day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10)
    points.push({ date, value: counts.get(date) ?? 0 })
  }
  return points
}
