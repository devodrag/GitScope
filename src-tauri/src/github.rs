use std::{
    collections::HashMap,
    future::Future,
    hash::{DefaultHasher, Hash, Hasher},
    sync::Arc,
    time::Duration,
};

use reqwest::{
    Client, StatusCode,
    header::{HeaderMap, IF_NONE_MATCH},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::sync::{Mutex, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::{
    error::{Error, Result},
    store::{Store, decode, now},
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Owner {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct License {
    pub spdx_id: Option<String>,
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Repository {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub html_url: String,
    pub description: Option<String>,
    pub owner: Owner,
    pub language: Option<String>,
    #[serde(rename = "stargazers_count")]
    pub stars: i64,
    #[serde(rename = "forks_count")]
    pub forks: i64,
    #[serde(rename = "open_issues_count")]
    pub issues: i64,
    #[serde(default, rename = "subscribers_count")]
    pub watchers: i64,
    pub created_at: String,
    pub updated_at: String,
    pub pushed_at: Option<String>,
    pub license: Option<License>,
    pub archived: bool,
    #[serde(default)]
    pub topics: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payload<T> {
    pub data: T,
    pub stale: bool,
    pub fetched_at: i64,
    pub has_next: bool,
    pub warning: Option<ErrorSummary>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorSummary {
    pub code: String,
    pub retry_at: Option<i64>,
}

impl From<Error> for ErrorSummary {
    fn from(error: Error) -> Self {
        Self {
            code: error.code.into(),
            retry_at: error.retry_at,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Quota {
    remaining: i64,
    limit: i64,
    reset_at: i64,
}

#[derive(Serialize, Deserialize)]
struct CachedResponse {
    body: Value,
    has_next: bool,
}

#[derive(Clone)]
pub struct GitHub {
    pub client: Client,
    pub store: Store,
    base: String,
    token: Arc<Mutex<Option<String>>>,
    cooldowns: Arc<Mutex<HashMap<&'static str, i64>>>,
    quotas: Arc<Mutex<HashMap<&'static str, Quota>>>,
    cache_locks: Arc<[Mutex<()>; 64]>,
    semaphore: Arc<Semaphore>,
    auth_epoch: Arc<Mutex<u64>>,
}

#[derive(Clone, Default)]
pub struct Request {
    pub refresh: bool,
    pub cancel: CancellationToken,
}

impl GitHub {
    pub fn new(store: Store) -> Result<Self> {
        let client = Client::builder()
            .user_agent(concat!("GitScope/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let url = attempt.url();
                if url.scheme() == "https"
                    && url.host_str() == Some("api.github.com")
                    && attempt.previous().len() < 3
                {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(network_error)?;
        Ok(Self {
            client,
            store,
            base: "https://api.github.com".into(),
            token: Default::default(),
            cooldowns: Default::default(),
            quotas: Default::default(),
            cache_locks: Arc::new(std::array::from_fn(|_| Mutex::new(()))),
            semaphore: Arc::new(Semaphore::new(2)),
            auth_epoch: Default::default(),
        })
    }

    pub async fn set_token(&self, token: Option<String>) {
        let mut epoch = self.auth_epoch.lock().await;
        *self.token.lock().await = token;
        *epoch = epoch.wrapping_add(1);
        self.cooldowns.lock().await.clear();
        self.quotas.lock().await.clear();
    }

    pub async fn rate_status(&self) -> Value {
        let _epoch = self.auth_epoch.lock().await;
        let quotas = self.quotas.lock().await;
        let cooldowns = self.cooldowns.lock().await;
        json!({
            "authenticated": self.token.lock().await.is_some(),
            "core": quotas.get("core"),
            "search": quotas.get("search"),
            "retryAt": cooldowns.get("secondary").filter(|at| **at > now()),
        })
    }

    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
        request: &Request,
    ) -> Result<Payload<T>> {
        self.typed(&format!("{}{path}", self.base), query, None, request)
            .await
    }

    pub async fn contributions(&self, login: &str, request: &Request) -> Result<Payload<Value>> {
        check_login(login)?;
        if self.token.lock().await.is_none() {
            return Err(Error::new("auth_required"));
        }
        let query = "query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}";
        let payload: Payload<Value> = self
            .typed(
                &format!("{}/graphql", self.base),
                &[("login", login.to_ascii_lowercase())],
                Some(json!({"query":query,"variables":{"login":login}})),
                request,
            )
            .await?;
        Ok(Payload {
            data: payload.data["data"]["user"]["contributionsCollection"]["contributionCalendar"]
                .clone(),
            ..payload
        })
    }

    async fn typed<T: DeserializeOwned>(
        &self,
        url: &str,
        query: &[(&str, String)],
        graphql: Option<Value>,
        request: &Request,
    ) -> Result<Payload<T>> {
        let mut url =
            url::Url::parse_with_params(url, query).map_err(|_| Error::new("validation"))?;
        if query.is_empty() {
            url.set_query(None);
        }
        if request.cancel.is_cancelled() {
            return Err(Error::new("cancelled"));
        }
        let events = url.path().ends_with("/events") || url.path().ends_with("/public");
        let (epoch, token) = {
            let epoch = self.auth_epoch.lock().await;
            (*epoch, self.token.lock().await.clone())
        };
        let graphql_request = graphql.is_some();
        let key = if graphql_request {
            format!("graphql:{url}")
        } else {
            url.to_string()
        };
        let cache = self.store.cached(&key, events)?;
        let search = url.path().starts_with("/search/");
        let ttl = if search {
            300
        } else if events {
            600
        } else if graphql_request || url.path().ends_with("/repos") {
            3600
        } else {
            900
        };
        let from_cache =
            |cached: &crate::store::Cached, warning: Option<ErrorSummary>| -> Result<Payload<T>> {
                let value: CachedResponse = decode(&cached.payload)?;
                Ok(Payload {
                    data: convert(value.body)?,
                    stale: warning.is_some(),
                    fetched_at: cached.fetched,
                    has_next: value.has_next,
                    warning,
                })
            };
        if let Some(cached) = &cache
            && !request.refresh
            && now() - cached.fetched < ttl
        {
            return from_cache(cached, None);
        }
        let bucket = if search {
            "search"
        } else if graphql_request {
            "graphql"
        } else {
            "core"
        };
        // Serialize cache misses for one key, then reuse any response written while waiting.
        let mut hash = DefaultHasher::new();
        key.hash(&mut hash);
        let slot = &self.cache_locks[hash.finish() as usize % self.cache_locks.len()];
        let started = now();
        let (_cache_guard, waited) = match slot.try_lock() {
            Ok(guard) => (guard, false),
            Err(_) => (cancellable(&request.cancel, slot.lock()).await?, true),
        };
        if *self.auth_epoch.lock().await != epoch {
            return Err(Error::new("cancelled"));
        }
        let cache = if waited {
            self.store.cached(&key, events)?
        } else {
            cache
        };
        if let Some(cached) = &cache
            && waited
            && ((!request.refresh && now() - cached.fetched < ttl) || cached.fetched >= started)
        {
            return from_cache(cached, None);
        }
        let permit = cancellable(&request.cancel, self.semaphore.acquire())
            .await?
            .map_err(|_| Error::new("cancelled"))?;
        if *self.auth_epoch.lock().await != epoch {
            return Err(Error::new("cancelled"));
        }
        let blocked = {
            let entries = self.cooldowns.lock().await;
            entries
                .get(bucket)
                .copied()
                .unwrap_or_default()
                .max(entries.get("secondary").copied().unwrap_or_default())
        };
        let result = if blocked > now() {
            Err(Error {
                retry_at: Some(blocked),
                ..Error::new("rate_limit")
            })
        } else {
            let mut builder = if let Some(body) = graphql {
                let mut target = url.clone();
                target.set_query(None);
                self.client.post(target).json(&body)
            } else {
                self.client.get(url)
            };
            builder = builder.header("Accept", "application/vnd.github+json");
            if !graphql_request {
                builder = builder.header("X-GitHub-Api-Version", "2022-11-28");
            }
            if let Some(token) = &token {
                builder = builder.bearer_auth(token);
            }
            if !graphql_request
                && let Some(etag) = cache.as_ref().and_then(|cached| cached.etag.as_ref())
            {
                builder = builder.header(IF_NONE_MATCH, etag);
            }
            let retry = builder.try_clone();
            let mut response = cancellable(&request.cancel, builder.send()).await?;
            if let Ok(received) = &response
                && matches!(received.status().as_u16(), 500 | 502 | 503 | 504)
                && !received.headers().contains_key("retry-after")
                && header(received.headers(), "x-ratelimit-remaining") != Some(0)
                && let Some(retry) = retry
            {
                cancellable(
                    &request.cancel,
                    tokio::time::sleep(Duration::from_millis(700)),
                )
                .await?;
                response = cancellable(&request.cancel, retry.send()).await?;
            }
            match response {
                Ok(response) => {
                    self.response(response, cache.as_ref(), bucket, request, epoch)
                        .await
                }
                Err(error) => Err(network_error(error)),
            }
        };
        drop(permit);
        if *self.auth_epoch.lock().await != epoch {
            return Err(Error::new("cancelled"));
        }
        match result {
            Ok((value, etag)) => {
                let encoded = crate::store::encode(&value)?;
                let has_next = value.has_next;
                let data = convert(value.body)?;
                let epoch_guard = self.auth_epoch.lock().await;
                if *epoch_guard != epoch {
                    return Err(Error::new("cancelled"));
                }
                self.store.cache(&key, &encoded, etag.as_deref(), events)?;
                Ok(Payload {
                    data,
                    stale: false,
                    fetched_at: now(),
                    has_next,
                    warning: None,
                })
            }
            Err(error) => {
                if let Some(cached) = &cache
                    && matches!(
                        error.code,
                        "offline"
                            | "timeout"
                            | "rate_limit"
                            | "github_unavailable"
                            | "unauthorized"
                    )
                {
                    return from_cache(cached, Some(error.into()));
                }
                Err(error)
            }
        }
    }

    async fn response(
        &self,
        response: reqwest::Response,
        cache: Option<&crate::store::Cached>,
        bucket: &'static str,
        request: &Request,
        epoch: u64,
    ) -> Result<(CachedResponse, Option<String>)> {
        let status = response.status();
        let headers = response.headers();
        let left = header(headers, "x-ratelimit-remaining");
        let reset = header(headers, "x-ratelimit-reset");
        let retry = header(headers, "retry-after")
            .filter(|seconds| *seconds >= 0)
            .map(|seconds| now().saturating_add(seconds));
        let etag = headers
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let has_next = headers
            .get("link")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|v| v.contains("rel=\"next\""));
        if let (Some(remaining), Some(limit), Some(reset_at)) =
            (left, header(headers, "x-ratelimit-limit"), reset)
        {
            let epoch_guard = self.auth_epoch.lock().await;
            if *epoch_guard == epoch {
                let mut quotas = self.quotas.lock().await;
                if quotas.get(bucket).is_none_or(|quota| {
                    quota.reset_at < reset_at
                        || (quota.reset_at == reset_at && quota.remaining >= remaining)
                }) {
                    quotas.insert(
                        bucket,
                        Quota {
                            remaining,
                            limit,
                            reset_at,
                        },
                    );
                }
            }
        }
        if left == Some(0)
            && let Some(at) = reset
        {
            self.cooldown(epoch, bucket, at).await;
        }
        if status == StatusCode::NOT_MODIFIED {
            return match cache {
                Some(cached) => Ok((decode(&cached.payload)?, cached.etag.clone())),
                None => Err(Error::new("data")),
            };
        }
        let body = cancellable(&request.cancel, read_body(response)).await??;
        if !status.is_success() {
            let message = body["message"].as_str().unwrap_or_default();
            let is_limited = status == StatusCode::TOO_MANY_REQUESTS
                || status == StatusCode::FORBIDDEN
                    && (retry.is_some()
                        || left == Some(0)
                        || message.to_ascii_lowercase().contains("rate limit"));
            if is_limited {
                let primary = reset.filter(|at| left == Some(0) && *at > now());
                let at = match (retry, primary) {
                    (Some(retry), Some(reset)) => retry.max(reset),
                    (Some(at), None) | (None, Some(at)) => at,
                    (None, None) => now() + 60,
                };
                self.cooldown(
                    epoch,
                    if left == Some(0) { bucket } else { "secondary" },
                    at,
                )
                .await;
                return Err(Error {
                    retry_at: Some(at),
                    ..Error::new("rate_limit")
                });
            }
            return Err(Error::new(match status.as_u16() {
                401 => "unauthorized",
                403 => "forbidden",
                404 => "not_found",
                409 => "empty_repository",
                422 => "validation",
                500..=599 => "github_unavailable",
                _ => "github_error",
            }));
        }
        if body.get("errors").is_some() {
            let limited = body["errors"]
                .as_array()
                .is_some_and(|errors| errors.iter().any(|e| e["type"] == "RATE_LIMITED"));
            if limited {
                let at = reset.filter(|at| *at > now()).unwrap_or_else(|| now() + 60);
                self.cooldown(epoch, bucket, at).await;
                return Err(Error {
                    retry_at: Some(at),
                    ..Error::new("rate_limit")
                });
            }
            return Err(Error::new("graphql_unavailable"));
        }
        Ok((CachedResponse { body, has_next }, etag))
    }

    async fn cooldown(&self, epoch: u64, bucket: &'static str, at: i64) {
        let epoch_guard = self.auth_epoch.lock().await;
        if *epoch_guard == epoch {
            let mut cooldowns = self.cooldowns.lock().await;
            let entry = cooldowns.entry(bucket).or_default();
            *entry = (*entry).max(at);
        }
    }

    pub async fn identity(&self, token: &str, require_no_scopes: bool) -> Result<Value> {
        let response = self
            .client
            .get(format!("{}/user", self.base))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let headers = response.headers();
        if status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::FORBIDDEN
                && (header(headers, "x-ratelimit-remaining") == Some(0)
                    || headers.contains_key("retry-after"))
        {
            let retry_at =
                header(headers, "retry-after").map(|seconds| now().saturating_add(seconds));
            let reset_at = header(headers, "x-ratelimit-reset")
                .filter(|_| header(headers, "x-ratelimit-remaining") == Some(0));
            return Err(Error {
                retry_at: Some(retry_at.max(reset_at).unwrap_or_else(|| now() + 60)),
                ..Error::new("rate_limit")
            });
        }
        if !status.is_success() {
            return Err(Error::new(match response.status().as_u16() {
                401 => "unauthorized",
                403 => "forbidden",
                500..=599 => "github_unavailable",
                _ => "github_error",
            }));
        }
        let scopes = headers.get_all("x-oauth-scopes");
        if require_no_scopes {
            // Only inspect scopes after GitHub has authenticated the classic PAT at /user.
            for value in scopes {
                if !value.to_str().is_ok_and(|scopes| scopes.trim().is_empty()) {
                    return Err(Error::new("token_scope"));
                }
            }
        }
        let user = read_body(response).await?;
        Ok(
            json!({ "login": user["login"], "avatar_url": user["avatar_url"], "name": user["name"] }),
        )
    }
}

async fn read_body(mut response: reqwest::Response) -> Result<Value> {
    let success = response.status().is_success();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if body.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err(Error::new("response_size"));
        }
        body.extend_from_slice(&chunk);
    }
    match serde_json::from_slice(&body) {
        Ok(value) => Ok(value),
        Err(_) if !success => Ok(Value::Null),
        Err(error) => Err(Error::detail("data", error)),
    }
}

fn convert<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|e| Error::detail("data", e))
}

fn header(headers: &HeaderMap, key: &str) -> Option<i64> {
    headers.get(key)?.to_str().ok()?.parse().ok()
}

pub fn network_error(error: reqwest::Error) -> Error {
    Error::new(if error.is_timeout() {
        "timeout"
    } else {
        "offline"
    })
}

pub async fn cancellable<T>(
    token: &CancellationToken,
    operation: impl Future<Output = T>,
) -> Result<T> {
    use futures_util::{
        future::{Either, select},
        pin_mut,
    };
    let cancelled = token.cancelled();
    pin_mut!(operation, cancelled);
    match select(cancelled, operation).await {
        Either::Left(_) => Err(Error::new("cancelled")),
        Either::Right((result, _)) => Ok(result),
    }
}

pub fn valid_login(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub fn check_login(value: &str) -> Result<()> {
    if valid_login(value) {
        Ok(())
    } else {
        Err(Error::new("validation"))
    }
}

pub fn repository_name(value: &str) -> Result<String> {
    let repo = value.trim();
    let repo = repo
        .strip_prefix("https://github.com/")
        .unwrap_or(repo)
        .trim_end_matches('/');
    let (owner, name) = repo
        .split_once('/')
        .ok_or_else(|| Error::new("validation"))?;
    check_login(owner)?;
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.len() > 100
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(Error::new("validation"));
    }
    Ok(repo.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classic_identity_accepts_omitted_or_empty_scope_header() {
        use std::{
            io::{BufRead, BufReader, Write},
            net::TcpListener,
            thread,
        };

        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
        let mut github = GitHub::new(store).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        for (status, headers, expected_error) in [
            ("200 OK", "", None),
            ("200 OK", "X-OAuth-Scopes:\r\n", None),
            (
                "200 OK",
                "X-OAuth-Scopes: public_repo\r\n",
                Some("token_scope"),
            ),
            (
                "200 OK",
                "X-OAuth-Scopes:\r\nX-OAuth-Scopes: repo\r\n",
                Some("token_scope"),
            ),
            ("401 Unauthorized", "", Some("unauthorized")),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            github.base = format!("http://{}", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = BufReader::new(&mut stream);
                let mut line = String::new();
                request.read_line(&mut line).unwrap();
                assert!(line.starts_with("GET /user "));
                while !line.trim().is_empty() {
                    line.clear();
                    request.read_line(&mut line).unwrap();
                }
                let body = r#"{"login":"octocat","avatar_url":"","name":"Octocat"}"#;
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                ).unwrap();
            });
            let result = runtime.block_on(github.identity("test-fixture", true));
            server.join().unwrap();
            if let Some(error) = expected_error {
                assert_eq!(result.unwrap_err().code, error);
            } else {
                assert_eq!(result.unwrap()["login"], "octocat");
            }
        }
    }

    #[test]
    fn search_cooldown_leaves_profiles_available_and_core_cooldown_uses_cache() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
        let mut client = GitHub::new(store).unwrap();
        client.base = "http://127.0.0.1:1".into();
        let profile = "/users/octocat";
        client
            .store
            .cache(
                &format!("{}{profile}", client.base),
                r#"{"body":{"login":"octocat"},"has_next":false}"#,
                Some("\"octocat-v1\""),
                false,
            )
            .unwrap();
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let reset = now() + 90;
            client.cooldown(0, "search", reset).await;
            let request = Request {
                refresh: true,
                ..Request::default()
            };
            let search = client
                .get::<Value>("/search/users", &[], &request)
                .await
                .err()
                .unwrap();
            assert_eq!(search.code, "rate_limit");
            assert_eq!(search.retry_at, Some(reset));
            let loaded = client
                .get::<Value>(profile, &[], &Request::default())
                .await
                .unwrap();
            assert!(!loaded.stale);
            assert_eq!(loaded.data["login"], "octocat");

            client.cooldown(0, "core", reset).await;
            client.cooldown(0, "core", reset - 10).await;
            let cached = client.get::<Value>(profile, &[], &request).await.unwrap();
            assert!(cached.stale);
            assert_eq!(cached.data["login"], "octocat");
            assert_eq!(cached.warning.unwrap().retry_at, Some(reset));
            let new_profile = client
                .get::<Value>("/users/new", &[], &request)
                .await
                .err()
                .unwrap();
            assert_eq!(new_profile.code, "rate_limit");
            assert_eq!(new_profile.retry_at, Some(reset));
        });
    }

    #[test]
    fn repository_name_only_accepts_github_paths() {
        assert_eq!(
            repository_name("https://github.com/Rust-Lang/rust/").unwrap(),
            "rust-lang/rust"
        );
        for invalid in [
            "../foo",
            "org/..",
            "org/path/extra",
            "http://github.com/org/repo",
            "org/repo?x=1",
            "org/%2e",
            "org\\repo",
        ] {
            assert!(repository_name(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn unavailable_network_returns_stored_data_and_cancellation_stops_requests() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
        let mut client = GitHub::new(store.clone()).unwrap();
        client.base = "http://127.0.0.1:1".into();
        store
            .cache(
                "http://127.0.0.1:1/repos/test/repo",
                r#"{"body":{"field":42},"has_next":true}"#,
                Some("\"v1\""),
                false,
            )
            .unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let request = Request {
                refresh: true,
                ..Request::default()
            };
            let cached: Payload<Value> =
                client.get("/repos/test/repo", &[], &request).await.unwrap();
            assert!(cached.stale);
            assert!(cached.has_next);
            assert_eq!(cached.data["field"], 42);
            assert_eq!(cached.warning.unwrap().code, "offline");
            request.cancel.cancel();
            let result: Result<Payload<Value>> = client.get("/repos/other", &[], &request).await;
            assert_eq!(result.err().unwrap().code, "cancelled");
        });
    }

    #[test]
    #[ignore = "requires outbound GitHub access"]
    fn github_live_search_profile_and_repository() {
        let dir = tempfile::tempdir().unwrap();
        let client = GitHub::new(Store::open(&dir.path().join("test.sqlite3")).unwrap()).unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let request = &Request::default();
            let search = crate::analytics::search(
                &client,
                crate::analytics::Search {
                    kind: "repositories".into(),
                    query: "ripgrep".into(),
                    language: "Rust".into(),
                    ..Default::default()
                },
                request,
            )
            .await
            .unwrap();
            assert!(
                search.data["items"]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
            );
            let repo = crate::analytics::repository(&client, "BurntSushi/ripgrep", request)
                .await
                .unwrap();
            assert_eq!(repo.data.full_name, "BurntSushi/ripgrep");
            let user = crate::analytics::profile(&client, "octocat", false, request)
                .await
                .unwrap();
            assert_eq!(user.data["login"], "octocat");
            let org = crate::analytics::profile(&client, "github", true, request)
                .await
                .unwrap();
            assert_eq!(org.data["type"], "Organization");
            let projects = crate::analytics::compare(
                &client,
                vec!["BurntSushi/ripgrep".into(), "sharkdp/bat".into()],
                request,
            )
            .await
            .unwrap();
            assert_eq!(projects.len(), 2);
        });
    }
}
