pub mod queries;
pub mod schema;

pub use queries::{Job, Segment};

use rusqlite::Connection;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct Db {
    pub conn: Connection,
}

impl Db {
    pub fn new(path: &str) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(schema::CREATE_TABLES)?;
        // migrations — ignore errors if column already exists
        conn.execute("ALTER TABLE jobs ADD COLUMN summary TEXT", []).ok();
        Ok(Self { conn })
    }
}
