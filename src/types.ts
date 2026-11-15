export type Page = 'overview' | 'explore' | 'repositories' | 'developers' | 'organizations' | 'compare' | 'trending' | 'activity' | 'watchlist' | 'collections' | 'manage' | 'settings'
export type Route = { page: Page; subject?: string; query?: string; kind?: SearchKind }
export type SearchKind = 'repositories' | 'users' | 'organizations'
export type Theme = 'light' | 'dark' | 'system'
export type Language = 'en' | 'ru'
export interface Settings {
  theme: Theme; language: Language; compact: boolean; collapsed: boolean; reducedMotion: boolean;
  startup: 'overview' | 'explore' | 'watchlist' | 'trending';
  cacheMb: number; refreshMinutes: number; desktopNotifications: boolean;
  dashboardLogin: string; oauthClientId: string; closeToTray: boolean
}
export interface Person { login: string; avatar_url: string; name?: string | null; html_url?: string }
export interface Profile extends Person {
  bio?: string; description?: string; location?: string; company?: string; public_repos: number;
  followers: number; following: number; type?: string
}
export interface Repository {
  id: number; name: string; full_name: string; html_url: string; description: string | null;
  owner: Person; language: string | null; stargazers_count: number; forks_count: number;
  subscribers_count: number; open_issues_count: number; created_at: string; updated_at: string;
  pushed_at: string | null; archived: boolean; topics: string[];
  license: { name: string; spdx_id: string | null } | null
}
export interface AppError { code: string; detail?: string | null; retryAt?: number | null }
export interface ManageStatus { connected: boolean; login: string; scopes: string }
export interface ManagedRepo {
  full_name: string; name: string; private: boolean; description: string | null;
  html_url: string; pushed_at: string | null; stargazers_count: number; default_branch: string
}
export interface ManagedEntry {
  name: string; path: string; type: 'file' | 'dir'; size: number; sha: string;
  content?: string; encoding?: string; html_url?: string
}
export interface ManagedBranch { name: string; commit: { sha: string } }
export interface ManagedRelease {
  id: number; tag_name: string; name: string | null; body: string | null;
  published_at: string | null; html_url: string; assets: { id: number; name: string; size: number }[]
}
export interface Digest { first: boolean; items: { full: string; name: string; delta: number; stars: number }[]; notices: { repo: string; title: string; url: string }[] }
export interface Payload<T> { data: T; stale: boolean; fetchedAt: number; hasNext: boolean; warning: AppError | null }
export interface SearchResult { total_count: number; incomplete_results: boolean; items: (Repository | Person)[] }
export interface SearchOptions {
  kind: SearchKind; query?: string; language?: string; stars?: string; forks?: string;
  created?: string; updated?: string; topic?: string; license?: string; archived?: string;
  sort?: string; page?: number
}
export interface Event {
  id: string; type: string; actor: Person; repo: { name: string }; created_at: string;
  payload: { action?: string; number?: number; ref?: string; ref_type?: string;
    release?: { html_url?: string; tag_name?: string };
    issue?: { html_url?: string; title?: string };
    pull_request?: { html_url?: string; title?: string };
    comment?: { html_url?: string } }
}
export interface Commit {
  sha: string; html_url: string; author: Person | null;
  commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null }
}
export interface Release {
  id: number; tag_name: string; name: string | null; html_url: string; published_at: string | null;
  body: string | null; prerelease: boolean
}
export interface Contributor extends Person { id: number; contributions: number }
export interface Heatmap { totalContributions: number; weeks: { contributionDays: { date: string; contributionCount: number }[] }[] }
export interface ProjectSummary {
  repositories: Repository[]; languages: Record<string, number>; scanned: number;
  totalStars: number; totalForks: number; stale: boolean; partial: boolean; warning: AppError | null
}
export interface Comparison {
  repo: Repository; languages: Payload<Record<string, number>> | null;
  contributors: Payload<Contributor[]> | null; release: Payload<Release | null> | null;
  commits: Payload<Commit[] | null> | null; activity: Payload<Event[]> | null; errors: AppError[]
}
export interface Watched { repo: Repository; tags: string[]; added: number; collections: number[] }
export interface Collection { id: number; name: string }
export interface Notice { id: number; repo: string; title: string; url: string; created: number; seen: boolean }
export interface Snapshot { day: string; stars: number; forks: number; watchers: number; issues: number }
export interface Trend {
  observed: { repo: Repository; delta: number }[];
  discovery?: Payload<SearchResult>; discoveryError?: AppError
}
export interface Health {
  recency: number | null; diversity: number | null; cadence: number | null;
  gapDays: number | null; consistency: number | null; contributorsSample: number | null;
  releasesSample: number; cached: boolean; issueResponseMinutes: number | null; issueResponseSample: number; issueResponseError: AppError | null
}
export interface Bootstrap {
  settings: Settings; account: Person | null; watchlist: Watched[]; collections: Collection[];
  notifications: Notice[]; oauthConfigured: boolean; version: string; autostart: boolean; releaseBuild: boolean; authError?: AppError | null
}
export interface DeviceCode { userCode: string; url: string; expiresAt: number }
export interface ApiQuota { remaining: number; limit: number; resetAt: number }
export interface ApiStatus {
  authenticated: boolean; core: ApiQuota | null; search: ApiQuota | null; retryAt: number | null
}
export interface WatchRefresh { updated: number; errors: AppError[] }

export interface Queries {
  search: [SearchOptions, Payload<SearchResult>]
  repository: [{ name: string }, Payload<Repository>]
  section: [{ name: string; section: 'commits' | 'contributors' | 'releases' | 'events' | 'languages'; page?: number }, Payload<unknown> & { commitDays?: Record<string, number> }]
  profile: [{ login: string; organization?: boolean }, Payload<Profile>]
  projects: [{ login: string; organization?: boolean }, ProjectSummary]
  events: [{ login: string; organization?: boolean }, Payload<Event[]>]
  members: [{ login: string; page: number }, Payload<Person[]>]
  heatmap: [{ login: string }, Payload<Heatmap | null>]
  compare: [{ names: string[] }, Comparison[]]
  trending: [{ days: number; language: string }, Trend]
  snapshots: [{ name: string }, Snapshot[]]
  health: [{ name: string }, Health]
}
