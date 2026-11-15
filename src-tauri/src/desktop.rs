mod auth;
mod autostart;

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use futures_util::{StreamExt, stream};
use gtk::prelude::*;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::{
    analytics,
    error::{Error, Result},
    github::{GitHub, Request, repository_name},
    store::{Settings, Store, decode},
};

pub struct AppState {
    github: GitHub,
    auth: auth::Auth,
    requests: Mutex<HashMap<String, CancellationToken>>,
    refreshing: AtomicBool,
    auth_ready: tokio::sync::OnceCell<Option<Error>>,
}

#[tauri::command]
async fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> Result<Value> {
    let auth_error = state
        .auth_ready
        .get_or_init(|| async { auth::restore(&state).await.err() })
        .await;
    Ok(json!({
        "authError": auth_error,
        "settings": state.github.store.settings()?,
        "account": state.github.store.account()?,
        "watchlist": state.github.store.watched()?,
        "collections": state.github.store.collections()?,
        "notifications": state.github.store.notices(false)?,
        "oauthConfigured": option_env!("GITSCOPE_GITHUB_CLIENT_ID").is_some_and(|id| !id.is_empty()),
        "version": env!("CARGO_PKG_VERSION"),
        "autostart": autostart::enabled(&app)?,
        "releaseBuild": !cfg!(debug_assertions),
    }))
}

#[tauri::command]
async fn cancel_request(state: State<'_, AppState>, request_id: String) -> Result<()> {
    if let Some(request) = state.requests.lock().await.get(&request_id) {
        request.cancel();
    }
    Ok(())
}

#[tauri::command]
async fn query(
    state: State<'_, AppState>,
    request_id: String,
    endpoint: String,
    args: Value,
    refresh: bool,
) -> Result<Value> {
    let request = Request {
        refresh,
        ..Request::default()
    };
    {
        let mut pending = state.requests.lock().await;
        if request_id.len() > 80 || pending.len() >= 80 || pending.contains_key(&request_id) {
            return Err(Error::new("validation"));
        }
        pending.insert(request_id.clone(), request.cancel.clone());
    }
    let result = query_inner(&state.github, &endpoint, args, &request).await;
    state.requests.lock().await.remove(&request_id);
    result
}

async fn query_inner(
    github: &GitHub,
    endpoint: &str,
    args: Value,
    request: &Request,
) -> Result<Value> {
    let name = || {
        args["name"]
            .as_str()
            .ok_or_else(|| Error::new("validation"))
    };
    let login = || {
        args["login"]
            .as_str()
            .ok_or_else(|| Error::new("validation"))
    };
    let org = args["organization"].as_bool().unwrap_or(false);
    let page = args["page"].as_u64().unwrap_or(1).min(100) as u32;
    Ok(match endpoint {
        "search" => json!(analytics::search(github, decode(&args.to_string())?, request).await?),
        "repository" => json!(analytics::repository(github, name()?, request).await?),
        "section" => {
            let section = args["section"].as_str().unwrap_or_default();
            let result = analytics::repo_section(github, name()?, section, page, request).await?;
            let days = (section == "commits").then(|| analytics::commit_days(&result.data));
            let mut payload = json!(result);
            if let Some(days) = days {
                payload["commitDays"] = json!(days);
            }
            payload
        }
        "profile" => json!(analytics::profile(github, login()?, org, request).await?),
        "projects" => json!(analytics::projects(github, login()?, org, request).await?),
        "events" => json!(analytics::events(github, login()?, org, request).await?),
        "members" => json!(analytics::public_members(github, login()?, page, request).await?),
        "heatmap" => json!(github.contributions(login()?, request).await?),
        "compare" => {
            json!(analytics::compare(github, decode(&args["names"].to_string())?, request).await?)
        }
        "trending" => {
            analytics::trending(
                github,
                args["days"].as_u64().unwrap_or(7),
                args["language"].as_str().unwrap_or_default().to_owned(),
                request,
            )
            .await?
        }
        "snapshots" => json!(analytics::snapshots(github, name()?)?),
        "health" => {
            let repo = analytics::repository(github, name()?, request).await?;
            let (contributors, releases, responses) = futures_util::join!(
                analytics::repo_section(github, name()?, "contributors", 1, request),
                analytics::repo_section(github, name()?, "releases", 1, request),
                analytics::issue_response_sample(github, name()?, request),
            );
            analytics::health(&repo.data, &contributors?, &releases?, responses)
        }
        _ => return Err(Error::new("validation")),
    })
}

#[tauri::command]
async fn local(
    state: State<'_, AppState>,
    app: AppHandle,
    operation: String,
    args: Value,
) -> Result<Value> {
    let store = &state.github.store;
    let name = || repository_name(args["name"].as_str().unwrap_or_default());
    match operation.as_str() {
        "settings" => store.save_settings(&decode(&args.to_string())?)?,
        "reset_settings" => store.save_settings(&Settings::default())?,
        "unwatch" => store.unwatch(&name()?)?,
        "watch" => {
            let result =
                analytics::repository(&state.github, &name()?, &Request::default()).await?;
            store.watch(&result.data)?;
            let first_release = analytics::latest_release(
                &state.github,
                &result.data.full_name,
                &Request::default(),
            )
            .await;
            record_release(&app, store, &result.data, &first_release)?;
        }
        "organize" => store.organize(
            &name()?,
            &decode::<Vec<String>>(&args["tags"].to_string())?,
            &decode::<Vec<i64>>(&args["collections"].to_string())?,
        )?,
        "collection" => store.change_collection(args["id"].as_i64(), args["name"].as_str())?,
        "clear_cache" => store.clear_cache()?,
        "autostart" => autostart::set(
            &app,
            args["enabled"]
                .as_bool()
                .ok_or_else(|| Error::new("validation"))?,
        )?,
        "cache_size" => return Ok(json!(store.cache_bytes()?)),
        "rate_status" => return Ok(state.github.rate_status().await),
        "notices" => {
            return Ok(json!(
                store.notices(args["seen"].as_bool().unwrap_or(false))?
            ));
        }
        "refresh_watched" => return refresh_watched(&state, &app, true).await,
        _ => return Err(Error::new("validation")),
    }
    Ok(Value::Null)
}

async fn refresh_watched(state: &AppState, app: &AppHandle, refresh: bool) -> Result<Value> {
    if state.refreshing.swap(true, Ordering::AcqRel) {
        return Err(Error::new("refresh_running"));
    }
    struct Reset<'a>(&'a AtomicBool);
    impl Drop for Reset<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _reset = Reset(&state.refreshing);
    let store = &state.github.store;
    let request = &Request {
        refresh,
        ..Request::default()
    };
    let results = stream::iter(store.watched()?)
        .map(|watched| async move {
            let name = watched.repo.full_name;
            let repo = analytics::repository(&state.github, &name, request).await?;
            if repo.stale {
                return Err(Error::new("cached"));
            }
            let release = analytics::latest_release(&state.github, &name, request).await;
            record_release(app, store, &repo.data, &release)?;
            match release {
                Ok(data) if data.stale => Err(Error::new("cached")),
                Err(error) if error.code != "not_found" => Err(error),
                _ => Ok(()),
            }
        })
        .buffer_unordered(2)
        .collect::<Vec<_>>()
        .await;
    let errors = results
        .iter()
        .filter_map(|result| result.as_ref().err())
        .collect::<Vec<_>>();
    Ok(json!({ "updated": results.len() - errors.len(), "errors":errors }))
}

fn record_release(
    app: &AppHandle,
    store: &Store,
    repo: &crate::github::Repository,
    release: &Result<crate::github::Payload<Value>>,
) -> Result<()> {
    let first = match release {
        Ok(response) if !response.stale => {
            let data = &response.data;
            let id = data["id"]
                .as_i64()
                .ok_or_else(|| Error::new("data"))?
                .to_string();
            let title = data["name"]
                .as_str()
                .filter(|name| !name.is_empty())
                .or(data["tag_name"].as_str())
                .unwrap_or_default();
            let url = data["html_url"]
                .as_str()
                .ok_or_else(|| Error::new("data"))?;
            store.record(repo, Some(Some((&id, title, url))))?
        }
        Err(error) if error.code == "not_found" => store.record(repo, Some(None))?,
        _ => None,
    };
    if let Some(notice) = first {
        if let Err(error) = app.emit("gitscope:release", &notice) {
            eprintln!("GitScope notification event: {error}");
        }
        let settings = store.settings()?;
        if settings.desktop_notifications {
            let title = if settings.language == "ru" {
                "Новый релиз GitHub"
            } else {
                "New GitHub release"
            };
            if let Err(error) = detached(
                "notify-send",
                &[title, &format!("{} • {}", notice.repo, notice.title)],
            ) {
                eprintln!(
                    "GitScope desktop notifications unavailable: {:?}",
                    error.code
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn auth_begin(state: State<'_, AppState>) -> Result<auth::DevicePrompt> {
    auth::start(&state).await
}
#[tauri::command]
async fn auth_finish(state: State<'_, AppState>) -> Result<Value> {
    auth::finish(&state).await
}
#[tauri::command]
async fn auth_connect_token(state: State<'_, AppState>, token: String) -> Result<Value> {
    auth::connect_token(&state, token).await
}
#[tauri::command]
async fn auth_cancel(state: State<'_, AppState>) -> Result<()> {
    auth::cancel(&state).await;
    Ok(())
}
#[tauri::command]
async fn auth_logout(state: State<'_, AppState>) -> Result<()> {
    auth::logout(&state).await
}

fn detached(program: &str, args: &[&str]) -> Result<()> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| Error::detail("system", e))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn open_url(url: &str) -> Result<()> {
    let parsed = url::Url::parse(url).map_err(|_| Error::new("validation"))?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        return Err(Error::new("validation"));
    }
    detached("xdg-open", &[url])
}

#[tauri::command]
fn open_github(url: String) -> Result<()> {
    open_url(&url)
}

#[tauri::command]
async fn copy_text(window: WebviewWindow, text: String) -> Result<()> {
    if text.len() > 4096 {
        return Err(Error::new("validation"));
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
            clipboard.set_text(&text);
            clipboard.store();
            let _ = tx.send(());
        })
        .map_err(|e| Error::detail("system", e))?;
    rx.await.map_err(|_| Error::new("system"))
}

#[tauri::command]
async fn export_data(
    window: WebviewWindow,
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<bool> {
    let contents = if let Some(name) = name {
        let repository = analytics::repository(&state.github, &name, &Request::default()).await?;
        let history = analytics::snapshots(&state.github, &name)?;
        json!({ "repository":repository, "snapshots":history })
    } else {
        state.github.store.export()?
    };
    let data = serde_json::to_vec_pretty(&contents).map_err(|e| Error::detail("data", e))?;
    let russian = state.github.store.settings()?.language == "ru";
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ui_window = window.clone();
    window
        .run_on_main_thread(move || {
            let parent = ui_window.gtk_window().ok();
            let dialog = gtk::FileChooserNative::new(
                Some(if russian {
                    "Экспорт GitScope"
                } else {
                    "Export GitScope"
                }),
                parent.as_ref(),
                gtk::FileChooserAction::Save,
                Some(if russian {
                    "Сохранить"
                } else {
                    "Save"
                }),
                Some(if russian { "Отмена" } else { "Cancel" }),
            );
            dialog.set_current_name("gitscope-export.json");
            dialog.set_do_overwrite_confirmation(true);
            let path = if dialog.run() == gtk::ResponseType::Accept {
                dialog.filename()
            } else {
                None
            };
            if tx.send(path).is_err() {
                eprintln!("GitScope export request closed");
            }
        })
        .map_err(|e| Error::detail("system", e))?;
    if let Some(path) = rx.await.map_err(|_| Error::new("system"))? {
        write_export(&path, &data)?;
        return Ok(true);
    }
    Ok(false)
}

fn write_export(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| Error::new("validation"))?;
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| Error::detail("system", e))?;
    use std::io::Write;
    file.write_all(bytes)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|e| Error::detail("system", e))?;
    file.persist(path).map_err(|e| Error::detail("system", e))?;
    Ok(())
}

fn desktop_position_supported(window: &WebviewWindow) -> bool {
    window
        .gtk_window()
        .ok()
        .map(|gtk| gtk.display().type_().name().to_string())
        .is_some_and(|name: String| name.contains("X11"))
}

fn restore_window(window: &WebviewWindow, path: &Path, position: bool) {
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let Ok(saved) = serde_json::from_slice::<Value>(&bytes) else {
        return;
    };
    if !position && let (Some(w), Some(h)) = (saved["width"].as_u64(), saved["height"].as_u64()) {
        let _ = window.set_size(tauri::PhysicalSize::new(
            w.clamp(770, 4000) as u32,
            h.clamp(570, 3000) as u32,
        ));
    }
    if position
        && desktop_position_supported(window)
        && let (Some(x), Some(y)) = (saved["x"].as_i64(), saved["y"].as_i64())
        && window.available_monitors().is_ok_and(|monitors| {
            monitors.iter().any(|monitor| {
                let p = monitor.position();
                let size = monitor.size();
                x >= i64::from(p.x)
                    && y >= i64::from(p.y)
                    && x < i64::from(p.x) + i64::from(size.width)
                    && y < i64::from(p.y) + i64::from(size.height)
            })
        })
    {
        let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    }
    if position && saved["maximized"] == true {
        let _ = window.maximize();
    }
}

fn track_window(window: &WebviewWindow, path: PathBuf) {
    let handle = window.clone();
    let mut initial = fs::read(&path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
        .unwrap_or(json!({}));
    if !initial.is_object() {
        initial = json!({});
    }
    let geometry = std::sync::Mutex::new(initial);
    window.on_window_event(move |event| {
        let Ok(mut current) = geometry.lock() else {
            return;
        };
        let maximized = handle.is_maximized().unwrap_or_default();
        let normal = !maximized
            && !handle.is_fullscreen().unwrap_or_default()
            && !handle.is_minimized().unwrap_or_default();
        match event {
            WindowEvent::Resized(size) if normal => {
                current["width"] = json!(size.width);
                current["height"] = json!(size.height);
            }
            WindowEvent::Moved(position) if normal && desktop_position_supported(&handle) => {
                current["x"] = json!(position.x);
                current["y"] = json!(position.y);
            }
            WindowEvent::CloseRequested { .. } => {
                current["maximized"] = json!(maximized);
                if let Err(error) = write_export(&path, current.to_string().as_bytes()) {
                    eprintln!("GitScope window state: {:?}", error.code);
                }
            }
            _ => {}
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("local-navigation")
                .on_navigation(|_, url| {
                    url.scheme() == "tauri" && url.host_str() == Some("localhost")
                        || cfg!(debug_assertions)
                            && url.scheme() == "http"
                            && url.host_str() == Some("127.0.0.1")
                            && url.port() == Some(1420)
                })
                .build(),
        )
        .setup(|app| {
            let path = app.path().app_local_data_dir()?;
            fs::create_dir_all(&path)?;
            // The data directory holds the credential database; keep it private.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
            }
            let failure =
                |error: Error| std::io::Error::other(format!("{} {:?}", error.code, error.detail));
            let store = Store::open(&path.join("gitscope.sqlite3")).map_err(failure)?;
            store
                .prune(store.settings().map_err(failure)?.cache_mb)
                .map_err(failure)?;
            let state = AppState {
                github: GitHub::new(store).map_err(failure)?,
                auth: Default::default(),
                requests: Default::default(),
                refreshing: AtomicBool::new(false),
                auth_ready: Default::default(),
            };
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("Missing main window"))?;
            let geometry = path.join("window.json");
            restore_window(&window, &geometry, false);
            window.with_webview(|webview| {
                webview.inner().connect_button_press_event(|widget, event| {
                    if event.button() == 3
                        && event.position().1 <= 42.0
                        && let Some(window) = widget.window()
                        && window.show_window_menu(&mut std::ops::Deref::deref(event).clone())
                    {
                        return gtk::glib::Propagation::Stop;
                    }
                    gtk::glib::Propagation::Proceed
                });
            })?;
            track_window(&window, geometry.clone());
            app.manage(state);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                state
                    .auth_ready
                    .get_or_init(|| async { auth::restore(&state).await.err() })
                    .await;
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut elapsed = 0;
                loop {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    elapsed += 1;
                    let state = handle.state::<AppState>();
                    let Ok(settings) = state.github.store.settings() else {
                        continue;
                    };
                    if settings.refresh_minutes > 0 && elapsed >= settings.refresh_minutes {
                        elapsed = 0;
                        match refresh_watched(&state, &handle, false).await {
                            Ok(result) => {
                                let _ = handle.emit("gitscope:watch-refresh", &result);
                            }
                            Err(error) if error.code != "refresh_running" => {
                                let _ = handle.emit("gitscope:watch-refresh-error", &error);
                            }
                            Err(_) => {}
                        }
                    }
                }
            });
            window.show()?;
            let restored = window.clone();
            gtk::glib::idle_add_local_once(move || restore_window(&restored, &geometry, true));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            query,
            cancel_request,
            local,
            auth_begin,
            auth_finish,
            auth_connect_token,
            auth_cancel,
            auth_logout,
            open_github,
            copy_text,
            export_data
        ])
        .run(tauri::generate_context!())
        .expect("Could not start GitScope");
}
