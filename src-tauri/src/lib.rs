pub mod analytics;
pub mod error;
pub mod github;
mod sqlite;
pub mod manage;
pub mod store;

#[cfg(feature = "desktop")]
pub mod desktop;
