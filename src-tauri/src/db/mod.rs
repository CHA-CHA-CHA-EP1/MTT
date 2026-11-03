pub mod queries;
pub mod schema;

pub use queries::{Job, Segment};

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use thiserror::Error;

pub type DbPool = Pool<SqliteConnectionManager>;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("pool error: {0}")]
    Pool(#[from] r2d2::Error),
}

pub fn new_pool(path: &str) -> Result<DbPool, DbError> {
    let manager = SqliteConnectionManager::file(path).with_init(|conn| {
        conn.execute_batch(schema::CREATE_TABLES)?;
        // migrations — ignore errors if column already exists
        conn.execute("ALTER TABLE jobs ADD COLUMN summary TEXT", []).ok();
        conn.execute("ALTER TABLE jobs ADD COLUMN recording_window TEXT", []).ok();
        conn.execute("ALTER TABLE jobs ADD COLUMN error_message TEXT", []).ok();
        Ok(())
    });
    let pool = Pool::builder().max_size(5).build(manager)?;
    Ok(pool)
}
