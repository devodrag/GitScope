use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::{AppState, open_url};
use crate::{
    error::{Error, Result},
    github::{cancellable, network_error},
    store::now,
};

#[derive(Default)]
pub struct Auth {
    flow: Mutex<Option<(Device, CancellationToken)>>,
    session: Mutex<()>,
    polling: Mutex<()>,
}

#[derive(Clone)]
struct Device {
    client_id: String,
    code: String,
    interval: u64,
    deadline: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePrompt {
    user_code: String,
    url: String,
    expires_at: i64,
}

pub async fn restore(state: &AppState) -> Result<()> {
    let _session = state.auth.session.lock().await;
    if state.github.store.account()?.is_none() {
        return Ok(());
    }
    match state.github.store.token()? {
        Some(token) => {
            state.github.set_token(Some(token)).await;
            Ok(())
        }
        // The account record is useless without its token, so drop both.
        None => state.github.store.set_account_and_clear_cache(None),
    }
}

pub async fn start(state: &AppState) -> Result<DevicePrompt> {
    let _session = state.auth.session.lock().await;
    if state.github.store.account()?.is_some() {
        return Err(Error::new("validation"));
    }
    let configured = state.github.store.settings()?.oauth_client_id;
    let client_id = if configured.is_empty() {
        option_env!("GITSCOPE_GITHUB_CLIENT_ID")
            .filter(|id| !id.is_empty())
            .ok_or_else(|| Error::new("oauth_config"))?
            .to_string()
    } else {
        configured
    };
    let response = state
        .github
        .client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", &client_id)])
        .send()
        .await
        .map_err(network_error)?;
    let response: Value = response.json().await.map_err(network_error)?;
    let field = |name| {
        response[name]
            .as_str()
            .ok_or_else(|| Error::new("oauth_config"))
    };
    let url = field("verification_uri")?;
    let user_code = field("user_code")?.to_string();
    let deadline = now()
        + response["expires_in"]
            .as_i64()
            .unwrap_or(900)
            .clamp(1, 1800);
    let device = Device {
        client_id,
        code: field("device_code")?.into(),
        interval: response["interval"].as_u64().unwrap_or(5).clamp(1, 90),
        deadline,
    };
    open_url(url)?;
    let mut flow = state.auth.flow.lock().await;
    if let Some((_, token)) = flow.take() {
        token.cancel();
    }
    *flow = Some((device, CancellationToken::new()));
    Ok(DevicePrompt {
        user_code,
        url: url.into(),
        expires_at: deadline,
    })
}

pub async fn cancel(state: &AppState) {
    if let Some((_, token)) = state.auth.flow.lock().await.take() {
        token.cancel();
    }
}

pub async fn finish(state: &AppState) -> Result<Value> {
    let _poll = state
        .auth
        .polling
        .try_lock()
        .map_err(|_| Error::new("oauth_pending"))?;
    let (device, cancel) = state
        .auth
        .flow
        .lock()
        .await
        .clone()
        .ok_or_else(|| Error::new("oauth_expired"))?;
    let mut interval = device.interval;
    loop {
        if now() >= device.deadline {
            return Err(Error::new("oauth_expired"));
        }
        cancellable(
            &cancel,
            tokio::time::sleep(Duration::from_secs(
                interval.min((device.deadline - now()).max(0) as u64),
            )),
        )
        .await?;
        if now() >= device.deadline {
            return Err(Error::new("oauth_expired"));
        }
        let request = state
            .github
            .client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", device.client_id.as_str()),
                ("device_code", device.code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ]);
        let response = cancellable(&cancel, request.send())
            .await?
            .map_err(network_error)?;
        let result: Value = cancellable(&cancel, response.json())
            .await?
            .map_err(network_error)?;
        if let Some(token) = result["access_token"].as_str() {
            if result["scope"]
                .as_str()
                .is_some_and(|scope| !scope.trim().is_empty())
            {
                return Err(Error::new("oauth_scope"));
            }
            let user = cancellable(&cancel, state.github.identity(token, false)).await??;
            let _session = state.auth.session.lock().await;
            if cancel.is_cancelled() {
                return Err(Error::new("cancelled"));
            }
            if user["login"].as_str().is_none() {
                return Err(Error::new("data"));
            }
            return save_account(state, token.to_owned(), user).await;
        }
        match result["error"].as_str() {
            Some("authorization_pending") => {}
            Some("slow_down") => {
                interval = response_interval(&result, interval);
            }
            Some("expired_token") => return Err(Error::new("oauth_expired")),
            Some("access_denied") => return Err(Error::new("oauth_denied")),
            _ => return Err(Error::new("oauth_config")),
        }
    }
}

pub async fn connect_token(state: &AppState, token: String) -> Result<Value> {
    let token = connect_token_validate(&token)?;
    let _session = state.auth.session.lock().await;
    if state.github.store.account()?.is_some() {
        return Err(Error::new("validation"));
    }
    let user = state.github.identity(token, true).await?;
    save_account(state, token.to_owned(), user).await
}

/// Validate a pasted personal access token and classify the rejection reason.
/// Every failure gets a dedicated error code so the dialog can explain exactly
/// what to fix instead of repeating the generic "use ghp_" hint.
fn connect_token_validate(raw: &str) -> Result<&str> {
    let token = raw.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    // Fine-grained and app tokens are the common mix-ups when GitHub defaults
    // its creation page to "Generate new token" without the (classic) suffix.
    if token.starts_with("github_pat_") {
        return Err(Error::new("token_fine_grained"));
    }
    if ["gho_", "ghu_", "ghs_", "ghr_"].iter().any(|p| token.starts_with(p)) {
        return Err(Error::new("token_app"));
    }
    let legacy = token.len() == 40 && token.bytes().all(|b| b.is_ascii_hexdigit());
    let classic = token.starts_with("ghp_")
        && (12..=256).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_');
    if legacy || classic {
        Ok(token)
    } else {
        Err(Error::new("token_format"))
    }
}

async fn save_account(state: &AppState, token: String, user: Value) -> Result<Value> {
    if user["login"].as_str().is_none() {
        return Err(Error::new("data"));
    }
    state.github.store.set_token(Some(&token))?;
    if let Err(error) = state.github.store.set_account_and_clear_cache(Some(&user)) {
        if let Err(rollback) = state.github.store.set_token(None) {
            eprintln!("GitScope could not remove the uncommitted credential: {rollback:?}");
        }
        return Err(error);
    }
    state.github.set_token(Some(token)).await;
    cancel(state).await;
    Ok(user)
}

fn response_interval(result: &Value, previous: u64) -> u64 {
    result["interval"]
        .as_u64()
        .unwrap_or_default()
        .max(previous + 5)
        .min(1800)
}

pub async fn logout(state: &AppState) -> Result<()> {
    let _session = state.auth.session.lock().await;
    cancel(state).await;
    state.github.store.set_token(None)?;
    state.github.set_token(None).await;
    state.github.store.set_account_and_clear_cache(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn code(raw: &str) -> &'static str {
        match connect_token_validate(raw) {
            Ok(_) => "accepted",
            Err(error) => error.code,
        }
    }

    #[test]
    fn token_validation_classifies_rejections_and_accepts_classic() {
        let classic = format!("ghp_{}", "aB3".repeat(12));
        assert_eq!(code(&classic), "accepted");
        assert_eq!(code("  ghp_ABCDEFGHIJKLMNOP  "), "accepted");
        assert_eq!(code("\"ghp_ABCDEFGHIJKLMNOP\""), "accepted");
        assert_eq!(
            code(&format!("github_pat_{}", "aB3".repeat(30))),
            "token_fine_grained"
        );
        assert_eq!(code("gho_ABCDEFGHIJKLMNOP"), "token_app");
        assert_eq!(code("ghs_ABCDEFGHIJKLMNOP"), "token_app");
        assert_eq!(code("0123456789abcdef0123456789abcdef01234567"), "accepted");
        assert_eq!(code("0123456789abcdef0123456789abcdef0123456"), "token_format");
        assert_eq!(code("ghp_short"), "token_format");
        assert_eq!(code("token ghp_ABCDEFGHIJKLMNOP"), "token_format");
        assert_eq!(code(""), "token_format");
    }

    #[test]
    fn token_roundtrip_persists_in_local_database() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
        assert_eq!(store.token().unwrap(), None);
        store.set_token(Some("ghp_ABCDEFGHIJKLMNOP")).unwrap();
        assert_eq!(
            store.token().unwrap().as_deref(),
            Some("ghp_ABCDEFGHIJKLMNOP")
        );
        store.set_token(Some("")).unwrap();
        assert_eq!(store.token().unwrap(), None);
        store.set_token(Some("ghp_XYZ")).unwrap();
        store.set_token(None).unwrap();
        assert_eq!(store.token().unwrap(), None);
    }
}
