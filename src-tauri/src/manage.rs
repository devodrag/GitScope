use std::{sync::OnceLock, time::Duration};

use serde_json::{json, Value};

use crate::{
    error::{Error, Result},
    store::Store,
};

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("GitScope/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(600))
            .build()
            .expect("manage client")
    })
}

/// Authenticated GitHub session dedicated to repository management.
/// Held separately from the read-only token: management requires elevated
/// scopes (repo, delete_repo) and lives under its own storage keys.
pub struct Manage {
    pub token: String,
    pub login: String,
    pub scopes: Vec<String>,
}

pub fn auth(store: &Store) -> Result<Manage> {
    let token = store
        .setting("manage_token")?
        .ok_or_else(|| Error::new("manage_off"))?;
    let login = store.setting("manage_login")?.unwrap_or_default();
    let scopes = store
        .setting("manage_scopes")?
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    Ok(Manage {
        token,
        login,
        scopes,
    })
}

/// Validate a classic token: must authenticate and the login must be readable.
pub async fn validate(client: &reqwest::Client, token: &str) -> Result<(String, Vec<String>)> {
    let response = client
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| Error::detail("network", e))?;
    if response.status().as_u16() == 401 {
        return Err(Error::new("manage_unauthorized"));
    }
    if !response.status().is_success() {
        return Err(Error::detail(
            "manage_http",
            format!("status {}", response.status()),
        ));
    }
    let scopes: Vec<String> = response
        .headers()
        .get_all("x-oauth-scopes")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(',').map(str::trim).map(str::to_owned))
        .filter(|scope| !scope.is_empty())
        .collect();
    let user: Value = response.json().await.map_err(|e| Error::detail("network", e))?;
    let login = user["login"]
        .as_str()
        .ok_or_else(|| Error::new("data"))?
        .to_string();
    Ok((login, scopes))
}

fn enc(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn repo_url(full: &str, suffix: &str) -> Result<String> {
    let mut parts = full.split('/');
    let (owner, repo) = match (parts.next(), parts.next(), parts.next()) {
        (Some(o), Some(r), None) if !o.is_empty() && !r.is_empty() => (o, r),
        _ => return Err(Error::new("validation")),
    };
    Ok(format!(
        "https://api.github.com/repos/{}/{}/{suffix}",
        enc(owner),
        enc(repo)
    ))
}

fn content_url(full: &str, path: &str, branch: &str) -> Result<String> {
    let mut parts = full.split('/');
    let (owner, repo) = match (parts.next(), parts.next(), parts.next()) {
        (Some(o), Some(r), None) if !o.is_empty() && !r.is_empty() => (o, r),
        _ => return Err(Error::new("validation")),
    };
    let encoded = path
        .split('/')
        .filter(|segment| !segment.is_empty() && segment != &".")
        .map(enc)
        .collect::<Vec<_>>()
        .join("/");
    Ok(format!(
        "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
        enc(owner),
        enc(repo),
        encoded,
        enc(branch)
    ))
}

pub async fn validate_full(full: &str) -> Result<()> {
    let mut parts = full.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(owner), Some(repo), None)
            if !owner.is_empty()
                && !repo.is_empty()
                && owner.len() <= 100
                && repo.len() <= 100 =>
        {
            Ok(())
        }
        _ => Err(Error::new("validation")),
    }
}

pub async fn call(
    manage: &Manage,
    method: &str,
    url: &str,
    body: Option<Value>,
) -> Result<Value> {
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| Error::new("validation"))?;
    let mut request = client()
        .request(method, url)
        .bearer_auth(&manage.token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(body) = body.as_ref() {
        request = request.json(body);
    }
    let response = request.send().await.map_err(|e| Error::detail("network", e))?;
    let status = response.status().as_u16();
    if status == 204 {
        return Ok(json!({ "ok": true }));
    }
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|value| value["message"].as_str().map(str::to_owned))
            .unwrap_or_else(|| format!("status {status}"));
        let code = match status {
            401 => "manage_unauthorized",
            403 => "manage_forbidden",
            404 => "not_found",
            422 => "manage_validation",
            _ => "manage_http",
        };
        return Err(Error::detail(code, message));
    }
    if response.content_length() == Some(0) {
        return Ok(json!({}));
    }
    response.json().await.map_err(|e| Error::detail("network", e))
}

pub async fn connect(store: &Store, token: &str) -> Result<Value> {
    let client = client();
    let (login, scopes) = validate(client, token).await?;
    store.set_setting("manage_token", Some(token))?;
    store.set_setting("manage_login", Some(&login))?;
    store.set_setting("manage_scopes", Some(&scopes.join(",")))?;
    Ok(json!({ "login": login, "scopes": scopes }))
}

pub fn disconnect(store: &Store) -> Result<()> {
    store.set_setting("manage_token", None)?;
    store.set_setting("manage_login", None)?;
    store.set_setting("manage_scopes", None)
}

pub fn status(store: &Store) -> Result<Value> {
    let token = store.setting("manage_token")?;
    Ok(json!({
        "connected": token.is_some(),
        "login": store.setting("manage_login")?.unwrap_or_default(),
        "scopes": store.setting("manage_scopes")?.unwrap_or_default(),
    }))
}

pub async fn repos(manage: &Manage) -> Result<Value> {
    call(
        manage,
        "GET",
        "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator",
        None,
    )
    .await
}

pub async fn create_repo(
    manage: &Manage,
    name: &str,
    description: &str,
    private: bool,
    auto_init: bool,
) -> Result<Value> {
    if name.is_empty() || name.len() > 100 {
        return Err(Error::new("validation"));
    }
    call(
        manage,
        "POST",
        "https://api.github.com/user/repos",
        Some(json!({
            "name": name,
            "description": description,
            "private": private,
            "auto_init": auto_init,
        })),
    )
    .await
}

pub async fn patch_repo(manage: &Manage, full: &str, fields: Value) -> Result<Value> {
    validate_full(full).await?;
    call(manage, "PATCH", &repo_url(full, "")?, Some(fields)).await
}

pub async fn delete_repo(manage: &Manage, full: &str) -> Result<Value> {
    validate_full(full).await?;
    call(manage, "DELETE", &repo_url(full, "")?, None).await
}

pub async fn tree(manage: &Manage, full: &str, path: &str, branch: &str) -> Result<Value> {
    call(manage, "GET", &content_url(full, path, branch)?, None).await
}

pub async fn save_file(
    manage: &Manage,
    full: &str,
    path: &str,
    branch: &str,
    message: &str,
    content: &str,
    sha: Option<&str>,
) -> Result<Value> {
    if message.trim().is_empty() {
        return Err(Error::new("validation"));
    }
    let mut body = json!({
        "message": message,
        "content": content,
        "branch": branch,
    });
    if let Some(sha) = sha.filter(|sha| !sha.is_empty()) {
        body["sha"] = json!(sha);
    }
    call(manage, "PUT", &content_url(full, path, branch)?, Some(body)).await
}

pub async fn delete_file(
    manage: &Manage,
    full: &str,
    path: &str,
    branch: &str,
    message: &str,
    sha: &str,
) -> Result<Value> {
    call(
        manage,
        "DELETE",
        &content_url(full, path, branch)?,
        Some(json!({ "message": message, "sha": sha, "branch": branch })),
    )
    .await
}

pub async fn branches(manage: &Manage, full: &str) -> Result<Value> {
    call(manage, "GET", &repo_url(full, "branches?per_page=100")?, None).await
}

pub async fn new_branch(manage: &Manage, full: &str, name: &str, from: &str) -> Result<Value> {
    validate_full(&format!("{full}/{name}")).await?;
    let reference = call(
        manage,
        "GET",
        &repo_url(full, &format!("git/ref/heads/{}", enc(from)) )?,
        None,
    )
    .await?;
    let sha = reference["object"]["sha"]
        .as_str()
        .ok_or_else(|| Error::new("not_found"))?
        .to_string();
    call(
        manage,
        "POST",
        &repo_url(full, "git/refs")?,
        Some(json!({ "ref": format!("refs/heads/{name}"), "sha": sha })),
    )
    .await
}

pub async fn releases(manage: &Manage, full: &str) -> Result<Value> {
    call(manage, "GET", &repo_url(full, "releases?per_page=50")?, None).await
}

pub async fn new_release(
    manage: &Manage,
    full: &str,
    tag: &str,
    name: &str,
    body: &str,
    target: &str,
) -> Result<Value> {
    if tag.trim().is_empty() {
        return Err(Error::new("validation"));
    }
    let mut payload = json!({ "tag_name": tag, "name": name, "body": body });
    if !target.trim().is_empty() {
        payload["target_commitish"] = json!(target);
    }
    call(manage, "POST", &repo_url(full, "releases")?, Some(payload)).await
}

pub async fn delete_release(manage: &Manage, full: &str, id: i64) -> Result<Value> {
    call(manage, "DELETE", &repo_url(full, &format!("releases/{id}"))?, None).await
}

pub async fn upload_asset(
    manage: &Manage,
    full: &str,
    id: i64,
    name: &str,
    data_base64: &str,
) -> Result<Value> {
    use base64::Engine as _;
    if name.trim().is_empty() {
        return Err(Error::new("validation"));
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|_| Error::new("validation"))?;
    if data.is_empty() || data.len() > 40 * 1024 * 1024 {
        return Err(Error::new("validation"));
    }
    let response = client()
        .post(format!(
            "https://uploads.github.com/repos/{full}/releases/{id}/assets?name={}",
            enc(name.trim())
        ))
        .bearer_auth(&manage.token)
        .header("Content-Type", "application/octet-stream")
        .body(data)
        .send()
        .await
        .map_err(|e| Error::detail("network", e))?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|value| value["message"].as_str().map(str::to_owned))
            .unwrap_or_else(|| format!("status {status}"));
        let code = match status {
            401 => "manage_unauthorized",
            403 => "manage_forbidden",
            422 => "manage_validation",
            _ => "manage_http",
        };
        return Err(Error::detail(code, message));
    }
    response.json().await.map_err(|e| Error::detail("network", e))
}
