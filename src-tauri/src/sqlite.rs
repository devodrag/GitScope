use std::{path::Path, sync::Mutex, time::Duration};

use futures_executor::block_on;
use sqlx::{
    Connection as _, Executor, Row as _, TypeInfo, ValueRef,
    sqlite::{SqliteConnectOptions, SqliteConnection, SqliteJournalMode},
};

use crate::error::{Error, Result};

pub enum Param<'a> {
    Text(&'a str),
    Integer(i64),
    Null,
}

impl<'a> From<&'a str> for Param<'a> {
    fn from(value: &'a str) -> Self {
        Self::Text(value)
    }
}

impl From<i64> for Param<'_> {
    fn from(value: i64) -> Self {
        Self::Integer(value)
    }
}

pub type Row = Vec<Option<String>>;
pub struct Database(Mutex<SqliteConnection>);
pub struct Connection<'a>(std::cell::RefCell<&'a mut SqliteConnection>);

fn database_error(error: sqlx::Error) -> Error {
    Error::detail("database", error)
}

fn restrict_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    if !path.exists() {
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(path)
            .map_err(|error| Error::detail("database", error))?;
    }
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| Error::detail("database", error))?;
    Ok(())
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        // The database stores the GitHub credential, so make sure the file (and
        // therefore the WAL and shm files SQLite derives from it) is readable
        // only by the owning user, whether it already exists or gets created.
        restrict_permissions(path)?;
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(4));
        let mut raw = block_on(SqliteConnection::connect_with(&options)).map_err(database_error)?;
        let connection = Connection(std::cell::RefCell::new(&mut raw));
        connection.transaction(|db| {
            let version = db.rows("PRAGMA user_version", &[])?;
            match version.first().and_then(|r| r[0].as_deref()) {
                Some("0") => {
                    db.batch(include_str!("../migrations/001_initial.sql"))?;
                    db.batch("PRAGMA user_version=1")
                }
                Some("1") => Ok(()),
                _ => Err(Error::new("database_version")),
            }
        })?;
        Ok(Self(Mutex::new(raw)))
    }

    pub fn with<T>(&self, operation: impl FnOnce(&Connection<'_>) -> Result<T>) -> Result<T> {
        let mut guard = self.0.lock().map_err(|_| Error::new("database"))?;
        operation(&Connection(std::cell::RefCell::new(&mut guard)))
    }
}

impl Connection<'_> {
    pub fn batch(&self, sql: &str) -> Result<()> {
        let mut connection = self.0.borrow_mut();
        block_on(connection.execute(sqlx::raw_sql(sql))).map_err(database_error)?;
        Ok(())
    }

    pub fn transaction<T>(&self, operation: impl FnOnce(&Self) -> Result<T>) -> Result<T> {
        self.batch("BEGIN IMMEDIATE")?;
        match operation(self).and_then(|data| {
            self.batch("COMMIT")?;
            Ok(data)
        }) {
            Ok(data) => Ok(data),
            Err(error) => {
                self.batch("ROLLBACK")?;
                Err(error)
            }
        }
    }

    fn query<'a>(
        sql: &'a str,
        params: &'a [Param<'a>],
    ) -> sqlx::query::Query<'a, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'a>> {
        params
            .iter()
            .fold(sqlx::query(sql), |query, value| match value {
                Param::Text(text) => query.bind(*text),
                Param::Integer(value) => query.bind(*value),
                Param::Null => query.bind(None::<&str>),
            })
    }

    pub fn run(&self, sql: &str, params: &[Param<'_>]) -> Result<u64> {
        let mut connection = self.0.borrow_mut();
        Ok(
            block_on(Self::query(sql, params).execute(&mut **connection))
                .map_err(database_error)?
                .rows_affected(),
        )
    }

    pub fn rows(&self, sql: &str, params: &[Param<'_>]) -> Result<Vec<Row>> {
        let mut connection = self.0.borrow_mut();
        let rows = block_on(Self::query(sql, params).fetch_all(&mut **connection))
            .map_err(database_error)?;
        rows.iter()
            .map(|row| {
                (0..row.len())
                    .map(|index| {
                        let value = row.try_get_raw(index).map_err(database_error)?;
                        if value.is_null() {
                            return Ok(None);
                        }
                        let text = match value.type_info().name() {
                            "INTEGER" | "INT" => row
                                .try_get::<i64, _>(index)
                                .map(|number| number.to_string()),
                            "REAL" => row
                                .try_get::<f64, _>(index)
                                .map(|number| number.to_string()),
                            _ => row.try_get::<String, _>(index),
                        };
                        text.map(Some).map_err(database_error)
                    })
                    .collect()
            })
            .collect()
    }
}
