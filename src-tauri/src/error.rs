use serde::Serialize;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: &'static str,
    pub detail: Option<String>,
    pub retry_at: Option<i64>,
}

impl Error {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            detail: None,
            retry_at: None,
        }
    }

    pub fn detail(code: &'static str, detail: impl ToString) -> Self {
        Self {
            detail: Some(detail.to_string()),
            ..Self::new(code)
        }
    }
}
