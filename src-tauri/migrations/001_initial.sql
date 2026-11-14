CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE github_accounts (login TEXT PRIMARY KEY, profile TEXT NOT NULL);
CREATE TABLE watched_repositories (
    name TEXT PRIMARY KEY COLLATE NOCASE, repo TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]', added INTEGER NOT NULL,
    release_id TEXT, release_initialized INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE collections (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
CREATE TABLE collection_repositories (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE REFERENCES watched_repositories(name) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, name)
);
CREATE INDEX collections_by_repository ON collection_repositories(name);
CREATE TABLE repository_snapshots (
    name TEXT NOT NULL COLLATE NOCASE, day TEXT NOT NULL,
    stars INTEGER NOT NULL, forks INTEGER NOT NULL, watchers INTEGER NOT NULL, issues INTEGER NOT NULL,
    PRIMARY KEY (name, day)
);
CREATE TABLE github_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, etag TEXT, fetched INTEGER NOT NULL);
CREATE INDEX github_cache_age ON github_cache(fetched);
CREATE TABLE activity_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, etag TEXT, fetched INTEGER NOT NULL);
CREATE INDEX activity_cache_age ON activity_cache(fetched);
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY, repo TEXT NOT NULL COLLATE NOCASE, release_id TEXT NOT NULL,
    title TEXT NOT NULL, url TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0,
    UNIQUE(repo, release_id)
);
