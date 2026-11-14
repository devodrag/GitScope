use chrono::{Days, Utc};
use futures_util::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const TREND_LANGUAGES: [&str; 14] = [
    "Rust",
    "TypeScript",
    "Python",
    "Go",
    "C++",
    "Java",
    "JavaScript",
    "C",
    "C#",
    "Ruby",
    "Kotlin",
    "Swift",
    "Zig",
    "Lua",
];

use crate::{
    error::{Error, Result},
    github::{ErrorSummary, GitHub, Payload, Repository, Request, check_login, repository_name},
    store::Snapshot,
};

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Search {
    pub kind: String,
    pub query: String,
    pub language: String,
    pub stars: String,
    pub forks: String,
    pub created: String,
    pub updated: String,
    pub topic: String,
    pub license: String,
    pub archived: String,
    pub sort: String,
    pub page: u32,
}

impl Search {
    fn terms(&self) -> Result<String> {
        if self.query.len() > 200 {
            return Err(Error::new("validation"));
        }
        let mut terms = self
            .query
            .split_whitespace()
            .map(|part| {
                // The input is search text; structured qualifiers are added separately.
                if part.contains(':') || part.contains('"') {
                    format!("\"{}\"", part.replace([':', '"'], " "))
                } else {
                    part.into()
                }
            })
            .collect::<Vec<String>>();
        if self.kind != "repositories" {
            terms.push(
                if self.kind == "organizations" {
                    "type:org"
                } else {
                    "type:user"
                }
                .into(),
            );
        } else {
            terms.push("is:public".into());
            if self.language == "__other__" {
                for lang in TREND_LANGUAGES {
                    terms.push(format!("-language:{lang}"));
                }
            }
            let language = if self.language == "__other__" {
                ""
            } else {
                self.language.as_str()
            };
            for (key, value) in [
                ("language", language),
                ("stars", &self.stars),
                ("forks", &self.forks),
                ("created", &self.created),
                ("pushed", &self.updated),
                ("topic", &self.topic),
                ("license", &self.license),
                ("archived", &self.archived),
            ] {
                if value.is_empty() {
                    continue;
                }
                if value.len() > 60
                    || value.contains(['"', ':', '\\'])
                    || value.chars().any(char::is_control)
                {
                    return Err(Error::new("validation"));
                }
                terms.push(if value.contains(' ') {
                    format!("{key}:\"{value}\"")
                } else {
                    format!("{key}:{value}")
                });
            }
        }
        Ok(terms.join(" "))
    }
}

pub async fn search(github: &GitHub, filters: Search, request: &Request) -> Result<Payload<Value>> {
    let terms = filters.terms()?;
    let mut sort = match filters.sort.as_str() {
        "" | "best" => None,
        "stars" => Some("stars"),
        "updated" => Some("updated"),
        "created" => None,
        _ => return Err(Error::new("validation")),
    };
    let endpoint = match filters.kind.as_str() {
        "repositories" => "repositories",
        "users" | "organizations" if !filters.query.trim().is_empty() => {
            sort = None;
            "users"
        }
        _ => return Err(Error::new("validation")),
    };
    let mut qs = vec![
        ("q", terms),
        ("page", filters.page.clamp(1, 50).to_string()),
        ("per_page", "20".into()),
    ];
    if let Some(sort) = sort {
        qs.extend([("sort", sort.into()), ("order", "desc".into())]);
    }
    let mut result: Payload<Value> = github
        .get(&format!("/search/{endpoint}"), &qs, request)
        .await?;
    if filters.kind == "repositories"
        && filters.sort == "created"
        && let Some(items) = result.data["items"].as_array_mut()
    {
        items.sort_by(|a, b| b["created_at"].as_str().cmp(&a["created_at"].as_str()));
    }
    Ok(result)
}

pub async fn repository(
    github: &GitHub,
    name: &str,
    request: &Request,
) -> Result<Payload<Repository>> {
    let name = repository_name(name)?;
    let payload: Payload<Repository> = github.get(&format!("/repos/{name}"), &[], request).await?;
    if !payload.stale
        && payload.fetched_at.div_euclid(86_400) == Utc::now().timestamp().div_euclid(86_400)
    {
        github.store.record(&payload.data, None)?;
    }
    Ok(payload)
}

pub async fn repo_section(
    github: &GitHub,
    name: &str,
    section: &str,
    page: u32,
    request: &Request,
) -> Result<Payload<Value>> {
    let name = repository_name(name)?;
    let per_page = match section {
        "commits" => 30,
        "contributors" => 50,
        "releases" | "events" => 30,
        "languages" => 0,
        _ => return Err(Error::new("validation")),
    };
    let qs = if per_page == 0 {
        vec![]
    } else {
        vec![
            ("per_page", per_page.to_string()),
            ("page", page.clamp(1, 10).to_string()),
        ]
    };
    github
        .get(&format!("/repos/{name}/{section}"), &qs, request)
        .await
}

pub async fn profile(
    github: &GitHub,
    login: &str,
    organization: bool,
    request: &Request,
) -> Result<Payload<Value>> {
    check_login(login)?;
    let root = if organization { "orgs" } else { "users" };
    let mut profile: Payload<Value> = github
        .get(
            &format!("/{root}/{}", login.to_ascii_lowercase()),
            &[],
            request,
        )
        .await?;
    if organization && let Some(map) = profile.data.as_object_mut() {
        map.insert("type".into(), json!("Organization"));
    }
    Ok(profile)
}

pub async fn projects(
    github: &GitHub,
    login: &str,
    organization: bool,
    request: &Request,
) -> Result<ProjectSummary> {
    check_login(login)?;
    let root = if organization { "orgs" } else { "users" };
    let path = format!("/{root}/{}/repos", login.to_ascii_lowercase());
    let mut data = Vec::new();
    let mut stale = false;
    let mut partial = false;
    let mut warning = None;
    for page in 1..=5 {
        let response: Result<Payload<Vec<Repository>>> = github
            .get(
                &path,
                &[
                    ("type", if organization { "public" } else { "owner" }.into()),
                    ("sort", "updated".into()),
                    ("per_page", "100".into()),
                    ("page", page.to_string()),
                ],
                request,
            )
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) if page > 1 && error.code != "cancelled" => {
                partial = true;
                warning = Some(error.into());
                break;
            }
            Err(error) => return Err(error),
        };
        stale |= response.stale;
        warning = warning.or(response.warning);
        partial = response.has_next;
        data.extend(response.data);
        if !response.has_next {
            break;
        }
    }
    let total_stars = data.iter().map(|r| r.stars).sum();
    let total_forks = data.iter().map(|r| r.forks).sum();
    let mut languages = BTreeMap::new();
    for repo in &data {
        if let Some(language) = &repo.language {
            *languages.entry(language.clone()).or_insert(0) += 1;
        }
    }
    data.sort_by(|a, b| {
        b.stars
            .cmp(&a.stars)
            .then_with(|| a.full_name.cmp(&b.full_name))
    });
    let scanned = data.len();
    data.truncate(30);
    Ok(ProjectSummary {
        repositories: data,
        languages,
        scanned,
        total_stars,
        total_forks,
        stale,
        partial,
        warning,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    repositories: Vec<Repository>,
    languages: BTreeMap<String, u32>,
    scanned: usize,
    total_stars: i64,
    total_forks: i64,
    stale: bool,
    partial: bool,
    warning: Option<ErrorSummary>,
}

pub async fn events(
    github: &GitHub,
    login: &str,
    organization: bool,
    request: &Request,
) -> Result<Payload<Value>> {
    check_login(login)?;
    let login = login.to_ascii_lowercase();
    let path = if organization {
        format!("/orgs/{login}/events")
    } else {
        format!("/users/{login}/events/public")
    };
    github
        .get(&path, &[("per_page", "100".into())], request)
        .await
}

pub async fn public_members(
    github: &GitHub,
    login: &str,
    page: u32,
    request: &Request,
) -> Result<Payload<Value>> {
    check_login(login)?;
    github
        .get(
            &format!("/orgs/{}/public_members", login.to_ascii_lowercase()),
            &[
                ("per_page", "30".into()),
                ("page", page.clamp(1, 100).to_string()),
            ],
            request,
        )
        .await
}

pub async fn latest_release(
    github: &GitHub,
    repo: &str,
    request: &Request,
) -> Result<Payload<Value>> {
    github
        .get(
            &format!("/repos/{}/releases/latest", repository_name(repo)?),
            &[],
            request,
        )
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub repo: Repository,
    languages: Option<Payload<Value>>,
    contributors: Option<Payload<Value>>,
    release: Option<Payload<Value>>,
    commits: Option<Payload<Value>>,
    activity: Option<Payload<Value>>,
    errors: Vec<Error>,
}

pub async fn compare(
    github: &GitHub,
    names: Vec<String>,
    request: &Request,
) -> Result<Vec<Comparison>> {
    let names = names
        .iter()
        .map(|name| repository_name(name))
        .collect::<Result<Vec<_>>>()?;
    if !(2..=4).contains(&names.len()) || names.iter().collect::<BTreeSet<_>>().len() != names.len()
    {
        return Err(Error::new("validation"));
    }
    let results = stream::iter(names)
        .map(|name| async move {
            let repo = repository(github, &name, request).await?;
            let path = format!("/repos/{name}/commits");
            let params = [("per_page", "1".into())];
            let (languages, contributors, release, commits, activity) = futures_util::join!(
                repo_section(github, &name, "languages", 1, request),
                repo_section(github, &name, "contributors", 1, request),
                latest_release(github, &name, request),
                github.get(&path, &params, request),
                repo_section(github, &name, "events", 1, request),
            );
            let mut errors = Vec::new();
            if let Some(warning) = &repo.warning {
                errors.push(Error {
                    retry_at: warning.retry_at,
                    ..Error::new("cached")
                });
            }
            let mut optional = |result: Result<Payload<Value>>, empty: Option<&str>| match result {
                Ok(data) => Some(data),
                Err(error) if Some(error.code) == empty => Some(Payload {
                    data: Value::Null,
                    stale: false,
                    has_next: false,
                    fetched_at: crate::store::now(),
                    warning: None,
                }),
                Err(error) => {
                    errors.push(error);
                    None
                }
            };
            Ok(Comparison {
                repo: repo.data,
                languages: optional(languages, None),
                contributors: optional(contributors, None),
                release: optional(release, Some("not_found")),
                commits: optional(commits, Some("empty_repository")),
                activity: optional(activity, None),
                errors,
            })
        })
        .buffered(2)
        .collect::<Vec<Result<Comparison>>>()
        .await;
    results.into_iter().collect()
}

pub fn snapshots(github: &GitHub, name: &str) -> Result<Vec<Snapshot>> {
    github.store.snapshots(&repository_name(name)?)
}

pub async fn trending(
    github: &GitHub,
    days: u64,
    language: String,
    request: &Request,
) -> Result<Value> {
    if !matches!(days, 1 | 7 | 30) {
        return Err(Error::new("validation"));
    }
    let since = Utc::now()
        .date_naive()
        .checked_sub_days(Days::new(days - 1))
        .ok_or_else(|| Error::new("validation"))?
        .to_string();
    let observed = github
        .store
        .growth(&since)?
        .into_iter()
        .filter(
            |(repo, _)| match (language.as_str(), repo.language.as_deref()) {
                ("", _) => true,
                ("__other__", Some(name)) => !TREND_LANGUAGES
                    .iter()
                    .any(|value| value.eq_ignore_ascii_case(name)),
                ("__other__", None) => true,
                (language, Some(actual)) => actual.eq_ignore_ascii_case(language),
                _ => false,
            },
        )
        .map(|(repo, delta)| json!({ "repo":repo, "delta":delta }))
        .collect::<Vec<_>>();
    let discovery = search(
        github,
        Search {
            kind: "repositories".into(),
            created: format!(">={since}"),
            language,
            sort: "stars".into(),
            ..Search::default()
        },
        request,
    )
    .await;
    match discovery {
        Ok(data) => Ok(json!({"observed":observed,"discovery":data})),
        Err(error) if !observed.is_empty() => {
            Ok(json!({"observed":observed,"discoveryError":error}))
        }
        Err(error) => Err(error),
    }
}

pub fn commit_days(commits: &Value) -> BTreeMap<String, u32> {
    let mut days = BTreeMap::new();
    for commit in commits.as_array().into_iter().flatten() {
        if let Some(day) = commit["commit"]["committer"]["date"]
            .as_str()
            .and_then(|date| date.get(..10))
        {
            *days.entry(day.to_owned()).or_insert(0) += 1;
        }
    }
    days
}

pub async fn issue_response_sample(
    github: &GitHub,
    name: &str,
    request: &Request,
) -> Result<(Option<i64>, usize, bool)> {
    let name = repository_name(name)?;
    let path = format!("/repos/{name}/issues");
    let issues: Payload<Value> = github
        .get(
            &path,
            &[
                ("state", "all".into()),
                ("sort", "created".into()),
                ("per_page", "12".into()),
            ],
            request,
        )
        .await?;
    let mut stale = issues.stale;
    let mut times = Vec::new();
    for issue in issues
        .data
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| {
            row.get("pull_request").is_none() && row["comments"].as_u64().unwrap_or_default() > 0
        })
        .take(5)
    {
        let Some(number) = issue["number"].as_u64() else {
            continue;
        };
        let responses: Payload<Value> = github
            .get(
                &format!("{path}/{number}/comments"),
                &[("per_page", "30".into())],
                request,
            )
            .await?;
        stale |= responses.stale;
        let author = issue["user"]["login"].as_str();
        let reply = responses
            .data
            .as_array()
            .into_iter()
            .flatten()
            .find(|comment| {
                matches!(
                    comment["author_association"].as_str(),
                    Some("OWNER" | "MEMBER" | "COLLABORATOR")
                ) && comment["user"]["login"]
                    .as_str()
                    .is_some_and(|login| Some(login) != author)
            });
        let opened = issue["created_at"]
            .as_str()
            .and_then(|date| date.parse::<chrono::DateTime<Utc>>().ok());
        let responded = reply
            .and_then(|comment| comment["created_at"].as_str())
            .and_then(|date| date.parse::<chrono::DateTime<Utc>>().ok());
        if let (Some(opened), Some(responded)) = (opened, responded) {
            times.push((responded - opened).num_minutes().max(0));
        }
    }
    times.sort_unstable();
    let count = times.len();
    let median = (count > 0).then(|| (times[(count - 1) / 2] + times[count / 2]) / 2);
    Ok((median, count, stale))
}

pub fn health(
    repo: &Repository,
    contributors: &Payload<Value>,
    releases: &Payload<Value>,
    responses: Result<(Option<i64>, usize, bool)>,
) -> Value {
    let recency = repo
        .pushed_at
        .as_ref()
        .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
        .map(|date| {
            (100 - (Utc::now().signed_duration_since(date).num_days().max(0) * 100 / 365))
                .clamp(0, 100)
        });
    let count = contributors.data.as_array().map(Vec::len);
    let diversity = count.map(|count| (count * 10).min(100));
    let mut dates = releases
        .data
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["draft"] == false && row["prerelease"] == false)
        .filter_map(|row| {
            row["published_at"]
                .as_str()?
                .parse::<chrono::DateTime<Utc>>()
                .ok()
        })
        .collect::<Vec<_>>();
    dates.sort_unstable_by(|a, b| b.cmp(a));
    let gaps = dates
        .windows(2)
        .map(|pair| (pair[0] - pair[1]).num_days().max(0))
        .collect::<Vec<_>>();
    let gap = (!gaps.is_empty()).then(|| gaps.iter().sum::<i64>() / gaps.len() as i64);
    let cadence = gap.map(|gap| (100 - gap * 100 / 365).clamp(0, 100));
    let consistency = if gaps.len() >= 2 {
        gap.filter(|mean| *mean > 0).map(|mean| {
            let deviation =
                gaps.iter().map(|gap| (gap - mean).abs()).sum::<i64>() / gaps.len() as i64;
            (100 - deviation * 100 / mean).clamp(0, 100)
        })
    } else {
        None
    };
    let (minutes, sampled_issues, cached, error) = match responses {
        Ok((minutes, sampled, cached)) => (minutes, sampled, cached, None),
        Err(error) => (None, 0, false, Some(error)),
    };
    json!({ "issueResponseMinutes":minutes, "issueResponseSample":sampled_issues, "issueResponseError":error,
        "recency":recency, "diversity":diversity, "cadence":cadence, "gapDays":gap,
        "consistency":consistency, "contributorsSample":count, "releasesSample":dates.len(),
        "cached":contributors.stale || releases.stale || cached })
}
