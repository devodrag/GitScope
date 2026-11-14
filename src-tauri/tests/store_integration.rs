use gitscope::{
    github::Repository,
    store::{Settings, Store},
};

fn repo() -> Repository {
    Repository {
        id: 1,
        name: "test".into(),
        full_name: "fixture/test".into(),
        html_url: "https://github.com/fixture/test".into(),
        stars: 10,
        ..Repository::default()
    }
}

#[test]
fn preferences_and_collections_are_durable() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    let store = Store::open(&path).unwrap();
    let settings = Settings {
        theme: "dark".into(),
        language: "ru".into(),
        ..Settings::default()
    };
    store.save_settings(&settings).unwrap();
    store.watch(&repo()).unwrap();
    store.change_collection(None, Some("Research")).unwrap();
    store
        .organize("FIXTURE/TEST", &["rust".into()], &[1])
        .unwrap();
    assert_eq!(
        store
            .change_collection(None, Some("research"))
            .unwrap_err()
            .code,
        "duplicate"
    );
    assert!(
        store
            .organize("fixture/test", &["lost".into()], &[500])
            .is_err()
    );
    drop(store);

    let opened = Store::open(&path).unwrap();
    assert_eq!(opened.settings().unwrap().theme, "dark");
    assert_eq!(opened.settings().unwrap().language, "ru");
    let before = opened.export().unwrap();
    assert_eq!(before["watchlist"][0]["tags"][0], "rust");
    assert_eq!(before["watchlist"][0]["collections"][0], 1);
    opened.change_collection(Some(1), Some("Updated")).unwrap();
    assert_eq!(
        opened.export().unwrap()["collections"][0]["name"],
        "Updated"
    );
    opened.change_collection(Some(1), None).unwrap();
    let after = opened.export().unwrap();
    assert_eq!(after["watchlist"].as_array().unwrap().len(), 1);
    assert!(
        after["watchlist"][0]["collections"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    opened.unwatch("fixture/test").unwrap();
    assert!(opened.watched().unwrap().is_empty());
}

#[test]
fn snapshots_and_release_notifications_have_transactional_baselines() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let mut repo = repo();
    store.watch(&repo).unwrap();
    let url = "https://github.com/fixture/test/releases";
    assert!(
        store
            .record(&repo, Some(Some(("1", "First", url))))
            .unwrap()
            .is_none()
    );
    repo.stars = 14;
    assert!(
        store
            .record(&repo, Some(Some(("2", "Second", url))))
            .unwrap()
            .is_some()
    );
    assert!(
        store
            .record(&repo, Some(Some(("2", "Second", url))))
            .unwrap()
            .is_none()
    );
    let points = store.snapshots("FIXTURE/test").unwrap();
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].stars, 14);
    assert_eq!(store.notices(false).unwrap().len(), 1);
    store.notices(true).unwrap();
    assert_eq!(store.export().unwrap()["notifications"][0]["seen"], true);
}

#[test]
fn cached_data_and_settings_have_independent_lifecycles() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    store.watch(&repo()).unwrap();
    store
        .cache("core", "{\"value\":1}", Some("\"v1\""), false)
        .unwrap();
    store.cache("events", "[]", None, true).unwrap();
    assert_eq!(
        store
            .cached("core", false)
            .unwrap()
            .unwrap()
            .etag
            .as_deref(),
        Some("\"v1\"")
    );
    assert_eq!(store.cache_bytes().unwrap(), 13);
    assert!(
        store
            .save_settings(&Settings {
                refresh_minutes: -1,
                ..Settings::default()
            })
            .is_err()
    );
    store.clear_cache().unwrap();
    assert_eq!(store.cache_bytes().unwrap(), 0);
    assert_eq!(store.watched().unwrap().len(), 1);
}
