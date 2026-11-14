# GitScope architecture

## Runtime

The desktop process is Tauri 2 with GTK3 and WebKitGTK 4.1. Vite bundles the
React UI at build time. The shipped process requires the OS webview and Rust
binary. Navigation within the webview is restricted to the local application
origin, with a loopback development origin in debug builds. GitHub links go
to the system browser. The IPC boundary permits named operations with
validated input. The frontend receives display data and structured errors.

| Layer | Responsibility |
| --- | --- |
| React and TypeScript | Views, forms, feature lazy loading and the IPC contract |
| TanStack Query and Zustand | Deduplicated requests, navigation and comparison state |
| Tailwind, Radix dialog primitives, Lucide, Motion and Visx | UI foundations, keyboard focus, iconography, transitions and charts |
| Rust and Tokio | Tauri commands, scheduler, network concurrency and cancellation |
| Reqwest/rustls | GitHub REST/GraphQL, bounded responses, deadlines and retry |
| SQLx and SQLite | Migration, serialized writes, cache, offline state and the persisted GitHub token |

SQLite uses one local SQLx connection with a worker thread, WAL, foreign
keys and a busy timeout. Schema upgrades are transactional. Queries bind
data as parameters. Collection assignment and release notification creation
commit transactionally. Daily snapshots use a case-insensitive repository
key and UTC date. A cache hit from an earlier date does not create a new
historical point. Atomic JSON writes are used for settings-independent window
state and exports.

## Data sources and limits

- Repository details and languages use GitHub REST. The repository language chart uses bytes from the Languages endpoint. Profile language charts count each scanned repository’s primary language.
- Rollups sample up to 500 recently updated public repositories and present the 30 most-starred within that sample. The profile repository count is GitHub’s public count. Stars and forks sum the scanned projects.
- Activity is a page of recently available public events. It can be delayed and has a limited time window. The chart groups returned events by UTC day and starts at the first available event in the selected range.
- The contributions calendar is GitHub GraphQL data available to an authenticated session for user profiles. GitHub determines which counts are visible.
- Commits are from the default branch. The graph groups the displayed page by UTC committer date. Compare labels contributor and event counts as samples and adds a plus when GitHub supplies another page link.
- Search uses the GitHub Search API’s result limit and pagination. Stars and updated sorting are delegated to GitHub. Creation sorting is applied to the current page, as the REST search endpoint offers no global creation sort. The creation-date filter is server-side.
- Trending’s discovery mode ranks repositories created since the selected UTC date by total stars. Observed growth subtracts the oldest local daily snapshot inside the window from the newest and shows positive changes on watched repositories.
- A watchlist entry establishes a latest stable release baseline. Subsequent refreshes notify on a changed stable release, with an SQLite uniqueness constraint per release. A refresh checks the release GitHub designates latest at that moment. Checks run while the app is open.

## Health calculations

Every score uses an independent 0–100 scale. The indicators are GitScope's
calculations using public data.

| Metric | Calculation |
| --- | --- |
| Activity recency | 100 − floor(days since last push × 100 / 365), clamped |
| Contributor diversity | 10 × number of visible contributors on the first page, capped at 100 |
| Release cadence | 100 − floor(mean gap in days × 100 / 365), clamped. Uses the stable releases in the first page |
| Maintenance consistency | 100 − floor(mean absolute deviation of stable release gaps × 100 / mean gap), clamped. Requires at least three stable releases and a nonzero mean |
| Issue responsiveness | Median time between creation and the first visible comment from an OWNER, MEMBER or COLLABORATOR other than the issue author. Samples up to five commented issues from the twelve most recent issue/PR rows, excludes PRs, and reads up to thirty comments per issue |

## Cache and rate limits

REST and GraphQL requests share a concurrency limit of two. Concurrent
requests for the same response reuse the first successful cached result.
Stale or explicitly refreshed REST responses use ETags. Cache lifetimes are
five minutes for Search, ten minutes for activity, an hour for project
listings and contribution calendars, and fifteen minutes for other REST
queries. Scheduled watchlist refreshes respect these lifetimes.
Transport failures, invalid credentials and server limits can use stored
data with a warning and timestamp. Limits are tracked independently for
REST core, Search and GraphQL, with a shared secondary limit. Settings
displays quota headers collected from ordinary responses. Retry-After and
reset timestamps suppress requests until the relevant limit expires. Transient server
failures without Retry-After get at most one retry. Cancelling a TanStack
query cancels its corresponding Rust operation. Cache size is based on
stored response payload bytes. Entries older than thirty days are pruned on
startup or settings changes. Watchlists and snapshots have their own
retention and are preserved by cache clearing.

## Authentication and Linux integration

OAuth Device Flow requires a public client ID. Rust retains the device secret
and OAuth token. The webview receives the user-facing device code and public
account profile. There are no built-in shared credentials. GitHub receives the
public OAuth client ID and the device-code flow requests no additional scopes.
A user can also connect a classic personal access token. Rust validates it at
GitHub's authenticated user endpoint and rejects nonempty scope headers. The
token is stored only in the local SQLite database; the system secret store is
not used. Signing out removes the stored token and clears the GitHub response
cache.

GTK handles clipboard and file selection. The window manager handles window
drag, resize, fullscreen and the titlebar context menu where available.
Position recovery is enabled for X11. Autostart writes an XDG Desktop Entry
only on request in release builds. Desktop notifications use the host
notification service via `notify-send`.

## Visual composition

A compact navigation rail and a black active row lead into four KPI cards.
The asymmetrical two-column layout matches the area a user needs for
activity charts, language breakdowns and compact tables. Dark mode has
its own surface and chart values. The typography uses installed SF Pro when
available, otherwise Inter bundled under OFL-1.1. CSS transitions and
animations honor reduced motion. The interface is available in English and
Russian.
