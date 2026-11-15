use std::{path::Path, sync::Arc};

use chrono::Utc;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    error::{Error, Result},
    github::Repository,
    sqlite::{Connection, Database, Param, Row},
};

#[derive(Clone)]
pub struct Store(Arc<Database>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub language: String,
    pub compact: bool,
    pub collapsed: bool,
    pub reduced_motion: bool,
    pub startup: String,
    pub cache_mb: i64,
    pub refresh_minutes: i64,
    pub desktop_notifications: bool,
    pub dashboard_login: String,
    pub oauth_client_id: String,
    pub close_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: "en".into(),
            compact: false,
            collapsed: false,
            reduced_motion: false,
            startup: "overview".into(),
            cache_mb: 32,
            refresh_minutes: 60,
            desktop_notifications: true,
            dashboard_login: String::new(),
            oauth_client_id: String::new(),
            close_to_tray: true,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.theme.as_str(), "light" | "dark" | "system")
            || !matches!(self.language.as_str(), "en" | "ru")
            || !matches!(
                self.startup.as_str(),
                "overview" | "explore" | "watchlist" | "trending"
            )
            || !matches!(self.cache_mb, 16 | 32 | 64 | 128)
            || !matches!(self.refresh_minutes, 0 | 15 | 30 | 60 | 180)
            || (!self.dashboard_login.is_empty()
                && !crate::github::valid_login(&self.dashboard_login))
            || self.oauth_client_id.len() > 80
            || !self
                .oauth_client_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err(Error::new("validation"));
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Watched {
    pub repo: Repository,
    tags: Vec<String>,
    added: i64,
    collections: Vec<i64>,
}

#[derive(Serialize)]
pub struct Collection {
    id: i64,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: i64,
    pub repo: String,
    pub title: String,
    pub url: String,
    pub created: i64,
    seen: bool,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub day: String,
    pub stars: i64,
    pub forks: i64,
    pub watchers: i64,
    pub issues: i64,
}

pub struct Cached {
    pub payload: String,
    pub etag: Option<String>,
    pub fetched: i64,
}

pub fn now() -> i64 {
    Utc::now().timestamp()
}

pub fn encode<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| Error::detail("data", e))
}

pub fn decode<T: DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value).map_err(|e| Error::detail("data", e))
}

fn string(row: &Row, column: usize) -> &str {
    row[column].as_deref().unwrap_or_default()
}

fn number(row: &Row, column: usize) -> i64 {
    string(row, column).parse().unwrap_or_default()
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Ok(Self(Arc::new(Database::open(path)?)))
    }

    pub fn settings(&self) -> Result<Settings> {
        self.0.with(read_settings)
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        settings.validate()?;
        let value = encode(settings)?;
        self.0.with(|db| db.transaction(|db| {
            let previous = read_settings(db)?;
            db.run("INSERT INTO app_settings VALUES ('preferences', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", &[value.as_str().into()])?;
            if settings.cache_mb < previous.cache_mb {
                enforce_cache_size(db, settings.cache_mb)?;
            }
            Ok(())
        }))
    }

    pub fn account(&self) -> Result<Option<Value>> {
        self.0.with(|db| {
            db.rows("SELECT profile FROM github_accounts LIMIT 1", &[])?
                .first()
                .map(|row| decode(string(row, 0)))
                .transpose()
        })
    }

    pub fn set_account_and_clear_cache(&self, account: Option<&Value>) -> Result<()> {
        self.0.with(|db| {
            db.transaction(|db| {
                if account.is_none()
                    || !db
                        .rows("SELECT 1 FROM github_accounts LIMIT 1", &[])?
                        .is_empty()
                {
                    db.batch("DELETE FROM github_cache; DELETE FROM activity_cache")?;
                }
                db.batch("DELETE FROM github_accounts")?;
                if let Some(profile) = account {
                    let login = profile["login"]
                        .as_str()
                        .ok_or_else(|| Error::new("data"))?;
                    let encoded = encode(profile)?;
                    db.run(
                        "INSERT INTO github_accounts VALUES (?,?)",
                        &[login.into(), encoded.as_str().into()],
                    )?;
                }
                Ok(())
            })
        })
    }

    /// The GitHub access token, stored in the local database next to the account.
    pub fn token(&self) -> Result<Option<String>> {
        self.0.with(|db| {
            Ok(db
                .rows("SELECT value FROM app_settings WHERE key='github_token'", &[])?
                .first()
                .and_then(|row| row[0].as_deref())
                .filter(|value| !value.is_empty())
                .map(str::to_owned))
        })
    }

    /// Generic key-value access for service-level settings (digest marker,
    /// management credentials).
    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        self.0.with(|db| {
            Ok(db
                .rows("SELECT value FROM app_settings WHERE key=?", &[key.into()])?
                .first()
                .and_then(|row| row[0].as_deref())
                .filter(|value| !value.is_empty())
                .map(str::to_owned))
        })
    }

    pub fn set_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        self.0.with(|db| {
            match value.filter(|value| !value.is_empty()) {
                Some(value) => db.run(
                    "INSERT INTO app_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    &[key.into(), value.into()],
                )?,
                None => db.run("DELETE FROM app_settings WHERE key=?", &[key.into()])?,
            };
            Ok(())
        })
    }

    pub fn set_token(&self, token: Option<&str>) -> Result<()> {
        self.0.with(|db| {
            match token.filter(|token| !token.is_empty()) {
                Some(token) => db.run(
                    "INSERT INTO app_settings VALUES ('github_token', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    &[token.into()],
                ),
                None => db.run("DELETE FROM app_settings WHERE key='github_token'", &[]),
            }
            .map(|_| ())
        })
    }

    pub fn watch(&self, repo: &Repository) -> Result<()> {
        let encoded = encode(repo)?;
        self.0.with(|db| {
            db.run(
                "INSERT INTO watched_repositories (name,repo,added) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET repo=excluded.repo",
                &[repo.full_name.as_str().into(), encoded.as_str().into(), now().into()],
            )?;
            Ok(())
        })
    }

    pub fn unwatch(&self, name: &str) -> Result<()> {
        self.0.with(|db| {
            db.run(
                "DELETE FROM watched_repositories WHERE name=?",
                &[name.into()],
            )?;
            Ok(())
        })
    }

    pub fn watched(&self) -> Result<Vec<Watched>> {
        self.0.with(|db| {
            let rows = db.rows(
                "SELECT repo,tags,added,name FROM watched_repositories ORDER BY added DESC,name",
                &[],
            )?;
            rows.into_iter()
                .map(|row| {
                    let collections = db
                        .rows(
                            "SELECT collection_id FROM collection_repositories WHERE name=?",
                            &[string(&row, 3).into()],
                        )?
                        .iter()
                        .map(|row| number(row, 0))
                        .collect();
                    Ok(Watched {
                        repo: decode(string(&row, 0))?,
                        tags: decode(string(&row, 1))?,
                        added: number(&row, 2),
                        collections,
                    })
                })
                .collect()
        })
    }

    pub fn organize(&self, name: &str, tags: &[String], collections: &[i64]) -> Result<()> {
        if tags.len() > 24
            || tags
                .iter()
                .any(|tag| tag.trim().is_empty() || tag.chars().count() > 40)
            || collections.len() > 100
        {
            return Err(Error::new("validation"));
        }
        let tags = encode(&tags)?;
        self.0.with(|db| {
            db.transaction(|db| {
                if db.run(
                    "UPDATE watched_repositories SET tags=? WHERE name=?",
                    &[tags.as_str().into(), name.into()],
                )? == 0
                {
                    return Err(Error::new("not_found"));
                }
                db.run(
                    "DELETE FROM collection_repositories WHERE name=?",
                    &[name.into()],
                )?;
                for id in collections {
                    db.run(
                        "INSERT INTO collection_repositories VALUES (?,?) ON CONFLICT DO NOTHING",
                        &[(*id).into(), name.into()],
                    )?;
                }
                Ok(())
            })
        })
    }

    pub fn collections(&self) -> Result<Vec<Collection>> {
        self.0.with(|db| {
            Ok(db
                .rows("SELECT id,name FROM collections ORDER BY name", &[])?
                .iter()
                .map(|row| Collection {
                    id: number(row, 0),
                    name: string(row, 1).into(),
                })
                .collect())
        })
    }

    pub fn change_collection(&self, id: Option<i64>, name: Option<&str>) -> Result<()> {
        self.0.with(|db| {
            if let Some(name) = name.map(str::trim) {
                if name.is_empty() || name.chars().count() > 60 {
                    return Err(Error::new("validation"));
                }
                let duplicates = db.rows(
                    "SELECT id FROM collections WHERE name=? AND id!=?",
                    &[name.into(), id.unwrap_or(-1).into()],
                )?;
                if !duplicates.is_empty() {
                    return Err(Error::new("duplicate"));
                }
                if let Some(id) = id {
                    db.run(
                        "UPDATE collections SET name=? WHERE id=?",
                        &[name.into(), id.into()],
                    )?;
                } else {
                    db.run("INSERT INTO collections(name) VALUES (?)", &[name.into()])?;
                }
            } else if let Some(id) = id {
                db.run("DELETE FROM collections WHERE id=?", &[id.into()])?;
            } else {
                return Err(Error::new("validation"));
            }
            Ok(())
        })
    }

    pub fn record(
        &self,
        repo: &Repository,
        release: Option<Option<(&str, &str, &str)>>,
    ) -> Result<Option<Notice>> {
        let name = repo.full_name.as_str();
        let day = Utc::now().date_naive().to_string();
        let encoded = encode(repo)?;
        self.0.with(|db| db.transaction(|db| {
            db.run(
                "INSERT INTO repository_snapshots VALUES (?,?,?,?,?,?) ON CONFLICT(name,day) DO UPDATE SET stars=excluded.stars,forks=excluded.forks,watchers=excluded.watchers,issues=excluded.issues",
                &[name.into(), day.as_str().into(), repo.stars.into(), repo.forks.into(), repo.watchers.into(), repo.issues.into()],
            )?;
            let watched = db.rows("SELECT release_id,release_initialized FROM watched_repositories WHERE name=?", &[name.into()])?;
            let Some(previous) = watched.first() else { return Ok(None) };
            db.run("UPDATE watched_repositories SET repo=? WHERE name=?", &[encoded.as_str().into(), name.into()])?;
            let Some(release) = release else { return Ok(None) };
            let release_id = release.map(|(id, _, _)| id);
            db.run("UPDATE watched_repositories SET release_id=?, release_initialized=1 WHERE name=?", &[release_id.map_or(Param::Null, Param::Text), name.into()])?;
            let Some((id, title, url)) = release else { return Ok(None) };
            if number(previous, 1) == 0 || previous[0].as_deref() == Some(id) { return Ok(None); }

            let inserted = db.run("INSERT INTO notifications(repo,release_id,title,url,created) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",
                &[name.into(), id.into(), title.into(), url.into(), now().into()])?;
            if inserted == 0 { return Ok(None); }
            Ok(db.rows("SELECT id,repo,title,url,created,seen FROM notifications WHERE repo=? AND release_id=?", &[name.into(), id.into()])?.first().map(notice))
        }))
    }

    pub fn snapshots(&self, name: &str) -> Result<Vec<Snapshot>> {
        self.0.with(|db| Ok(db.rows("SELECT day,stars,forks,watchers,issues FROM repository_snapshots WHERE name=? ORDER BY day", &[name.into()])?
            .iter().map(snapshot).collect()))
    }

    pub fn growth(&self, since: &str) -> Result<Vec<(Repository, i64)>> {
        self.0.with(|db| {
            let rows = db.rows(
                "SELECT w.repo, newest.stars - oldest.stars AS delta
                 FROM watched_repositories w
                 JOIN repository_snapshots oldest ON oldest.name=w.name AND oldest.day=(SELECT MIN(day) FROM repository_snapshots WHERE name=w.name AND day>=?)
                 JOIN repository_snapshots newest ON newest.name=w.name AND newest.day=(SELECT MAX(day) FROM repository_snapshots WHERE name=w.name)
                 WHERE newest.day>oldest.day AND delta>0 ORDER BY delta DESC LIMIT 30",
                &[since.into()],
            )?;
            rows.iter().map(|row| Ok((decode(string(row, 0))?, number(row, 1)))).collect()
        })
    }

    pub fn notices(&self, mark_seen: bool) -> Result<Vec<Notice>> {
        self.0.with(|db| {
            if mark_seen { db.run("UPDATE notifications SET seen=1", &[])?; }
            Ok(db.rows("SELECT id,repo,title,url,created,seen FROM notifications ORDER BY id DESC LIMIT 100", &[])?.iter().map(notice).collect())
        })
    }

    pub fn cached(&self, key: &str, events: bool) -> Result<Option<Cached>> {
        let table = cache_table(events);
        self.0.with(|db| {
            Ok(db
                .rows(
                    &format!("SELECT payload,etag,fetched FROM {table} WHERE key=?"),
                    &[key.into()],
                )?
                .first()
                .map(|r| Cached {
                    payload: string(r, 0).into(),
                    etag: r[1].clone(),
                    fetched: number(r, 2),
                }))
        })
    }

    pub fn cache(&self, key: &str, payload: &str, etag: Option<&str>, events: bool) -> Result<()> {
        let table = cache_table(events);
        self.0.with(|db| {
            db.run(&format!("INSERT INTO {table} VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,etag=excluded.etag,fetched=excluded.fetched"),
                &[key.into(), payload.into(), etag.map_or(Param::Null, Param::Text), now().into()])?;
            trim_cache(db)
        })
    }

    pub fn cache_bytes(&self) -> Result<i64> {
        self.0.with(cache_size)
    }

    pub fn clear_cache(&self) -> Result<()> {
        self.0.with(|db| {
            db.transaction(|db| db.batch("DELETE FROM github_cache; DELETE FROM activity_cache"))
        })
    }

    pub fn prune(&self, mb: i64) -> Result<()> {
        self.0.with(|db| {
            db.transaction(|db| {
                let cutoff = now() - 30 * 86400;
                for table in ["github_cache", "activity_cache"] {
                    db.run(
                        &format!("DELETE FROM {table} WHERE fetched<?"),
                        &[cutoff.into()],
                    )?;
                }
                enforce_cache_size(db, mb)
            })
        })
    }

    pub fn export(&self) -> Result<Value> {
        let snapshots = self.0.with(|db| Ok(db.rows("SELECT name,day,stars,forks,watchers,issues FROM repository_snapshots ORDER BY name,day", &[])?
            .iter().map(|row| json!({ "repository": string(row, 0), "metrics": snapshot(&row[1..].to_vec()) })).collect::<Vec<_>>()))?;
        Ok(json!({
            "version": 1, "settings": self.settings()?, "watchlist": self.watched()?,
            "collections": self.collections()?, "snapshots": snapshots, "notifications": self.notices(false)?
        }))
    }
}

fn cache_table(events: bool) -> &'static str {
    if events {
        "activity_cache"
    } else {
        "github_cache"
    }
}

fn cache_size(db: &Connection) -> Result<i64> {
    const SIZE: &str = "SELECT (SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM github_cache)+(SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM activity_cache)";
    Ok(db.rows(SIZE, &[])?.first().map_or(0, |r| number(r, 0)))
}

fn read_settings(db: &Connection) -> Result<Settings> {
    let rows = db.rows(
        "SELECT value FROM app_settings WHERE key='preferences'",
        &[],
    )?;
    rows.first()
        .map_or_else(|| Ok(Settings::default()), |row| decode(string(row, 0)))
}

fn trim_cache(db: &Connection) -> Result<()> {
    enforce_cache_size(db, read_settings(db)?.cache_mb)
}

fn enforce_cache_size(db: &Connection, mb: i64) -> Result<()> {
    let budget = mb * 1024 * 1024;
    if cache_size(db)? <= budget {
        return Ok(());
    }
    let victims = db.rows("SELECT key,kind FROM (
        SELECT key,kind,SUM(bytes) OVER (ORDER BY fetched DESC,kind,key ROWS UNBOUNDED PRECEDING) AS used FROM (
            SELECT key,0 AS kind,fetched,length(CAST(payload AS BLOB)) AS bytes FROM github_cache
            UNION ALL SELECT key,1,fetched,length(CAST(payload AS BLOB)) FROM activity_cache))
        WHERE used>?", &[budget.into()])?;
    for row in victims {
        let table = cache_table(number(&row, 1) == 1);
        db.run(
            &format!("DELETE FROM {table} WHERE key=?"),
            &[string(&row, 0).into()],
        )?;
    }
    Ok(())
}

fn snapshot(row: &Row) -> Snapshot {
    Snapshot {
        day: string(row, 0).into(),
        stars: number(row, 1),
        forks: number(row, 2),
        watchers: number(row, 3),
        issues: number(row, 4),
    }
}

fn notice(row: &Row) -> Notice {
    Notice {
        id: number(row, 0),
        repo: string(row, 1).into(),
        title: string(row, 2).into(),
        url: string(row, 3).into(),
        created: number(row, 4),
        seen: number(row, 5) != 0,
    }
}
