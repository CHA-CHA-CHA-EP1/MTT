use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};

// --- Models ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Job {
    pub id: String,
    pub project_id: String,
    pub file_path: String,
    pub status: String,
    pub whisper_model: String,
    pub created_at: i64,
    pub recording_window: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Segment {
    pub id: i64,
    pub job_id: String,
    pub idx: i64,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub corrected_text: Option<String>,
    pub suspect: bool,
}

// --- Project queries ---

pub fn insert_project(conn: &Connection, project: &Project) -> Result<()> {
    conn.execute(
        "INSERT INTO projects (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![project.id, project.name, project.created_at],
    )?;
    Ok(())
}

pub fn get_project(conn: &Connection, id: &str) -> Result<Option<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at FROM projects WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at FROM projects ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn rename_project(conn: &Connection, id: &str, name: &str) -> Result<()> {
    conn.execute("UPDATE projects SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Job queries ---

pub fn insert_job(conn: &Connection, job: &Job) -> Result<()> {
    conn.execute(
        "INSERT INTO jobs (id, project_id, file_path, status, whisper_model, created_at, recording_window)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![job.id, job.project_id, job.file_path, job.status, job.whisper_model, job.created_at, job.recording_window],
    )?;
    Ok(())
}

pub fn update_job_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    conn.execute("UPDATE jobs SET status = ?1 WHERE id = ?2", params![status, id])?;
    Ok(())
}

pub fn set_job_error(conn: &Connection, id: &str, message: &str) -> Result<()> {
    conn.execute(
        "UPDATE jobs SET status = 'error', error_message = ?1 WHERE id = ?2",
        params![message, id],
    )?;
    Ok(())
}

/// On app startup, any job still in 'running' or 'pending' means the worker
/// was killed mid-transcription (force-quit, crash). Reset them to 'error'
/// so the user can re-transcribe instead of seeing an infinite spinner.
pub fn reset_interrupted_jobs(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE jobs SET status = 'error', error_message = 'Transcription was interrupted (app closed). Click Re-transcribe to try again.'
         WHERE status IN ('running', 'pending')",
        [],
    )?;
    Ok(())
}

pub fn get_job(conn: &Connection, id: &str) -> Result<Option<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, file_path, status, whisper_model, created_at, recording_window, error_message FROM jobs WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(Job {
            id: row.get(0)?,
            project_id: row.get(1)?,
            file_path: row.get(2)?,
            status: row.get(3)?,
            whisper_model: row.get(4)?,
            created_at: row.get(5)?,
            recording_window: row.get(6)?,
            error_message: row.get(7)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn update_job_file_path(conn: &Connection, id: &str, file_path: &str) -> Result<()> {
    conn.execute("UPDATE jobs SET file_path = ?1 WHERE id = ?2", params![file_path, id])?;
    Ok(())
}

pub fn list_jobs_by_project(conn: &Connection, project_id: &str) -> Result<Vec<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, file_path, status, whisper_model, created_at, recording_window, error_message
         FROM jobs WHERE project_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(Job {
            id: row.get(0)?,
            project_id: row.get(1)?,
            file_path: row.get(2)?,
            status: row.get(3)?,
            whisper_model: row.get(4)?,
            created_at: row.get(5)?,
            recording_window: row.get(6)?,
            error_message: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn delete_job(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn list_all_job_file_paths(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT file_path FROM jobs WHERE file_path != ''")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    Ok(rows.flatten().collect())
}

pub fn get_job_summary(conn: &Connection, job_id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT summary FROM jobs WHERE id = ?1")?;
    let mut rows = stmt.query(params![job_id])?;
    if let Some(row) = rows.next()? {
        Ok(row.get(0)?)
    } else {
        Ok(None)
    }
}

pub fn set_job_summary(conn: &Connection, job_id: &str, summary: &str) -> Result<()> {
    conn.execute("UPDATE jobs SET summary = ?1 WHERE id = ?2", params![summary, job_id])?;
    Ok(())
}

pub fn get_segments_text(conn: &Connection, job_id: &str) -> Result<String> {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(corrected_text, text) FROM segments WHERE job_id = ?1 ORDER BY idx",
    )?;
    let texts: Result<Vec<String>> = stmt.query_map(params![job_id], |r| r.get(0))?.collect();
    Ok(texts?.join(" "))
}

// --- Segment queries ---

pub fn delete_segments_for_job(conn: &Connection, job_id: &str) -> Result<()> {
    conn.execute("DELETE FROM segments WHERE job_id = ?1", params![job_id])?;
    Ok(())
}

pub fn insert_segment(conn: &Connection, seg: &Segment) -> Result<()> {
    conn.execute(
        "INSERT INTO segments (job_id, idx, start, end, text, corrected_text, suspect)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![seg.job_id, seg.idx, seg.start, seg.end, seg.text, seg.corrected_text, seg.suspect as i32],
    )?;
    Ok(())
}

pub fn set_segment_text(conn: &Connection, segment_id: i64, text: Option<String>) -> Result<()> {
    conn.execute(
        "UPDATE segments SET corrected_text = ?1 WHERE id = ?2",
        params![text, segment_id],
    )?;
    Ok(())
}

pub fn update_segment_correction(conn: &Connection, job_id: &str, start_idx: i64, texts: &[String]) -> Result<()> {
    for (offset, text) in texts.iter().enumerate() {
        let idx = start_idx + offset as i64;
        conn.execute(
            "UPDATE segments SET corrected_text = ?1 WHERE job_id = ?2 AND idx = ?3",
            params![text, job_id, idx],
        )?;
    }
    Ok(())
}

pub fn get_segments(conn: &Connection, job_id: &str) -> Result<Vec<Segment>> {
    let mut stmt = conn.prepare(
        "SELECT id, job_id, idx, start, end, text, corrected_text, suspect
         FROM segments WHERE job_id = ?1 ORDER BY idx",
    )?;
    let rows = stmt.query_map(params![job_id], |row| {
        Ok(Segment {
            id: row.get(0)?,
            job_id: row.get(1)?,
            idx: row.get(2)?,
            start: row.get(3)?,
            end: row.get(4)?,
            text: row.get(5)?,
            corrected_text: row.get(6)?,
            suspect: row.get::<_, i32>(7)? != 0,
        })
    })?;
    rows.collect()
}

pub fn get_segments_since(conn: &Connection, job_id: &str, min_idx: i64) -> Result<Vec<Segment>> {
    let mut stmt = conn.prepare(
        "SELECT id, job_id, idx, start, end, text, corrected_text, suspect
         FROM segments WHERE job_id = ?1 AND idx >= ?2 ORDER BY idx",
    )?;
    let rows = stmt.query_map(params![job_id, min_idx], |row| {
        Ok(Segment {
            id: row.get(0)?,
            job_id: row.get(1)?,
            idx: row.get(2)?,
            start: row.get(3)?,
            end: row.get(4)?,
            text: row.get(5)?,
            corrected_text: row.get(6)?,
            suspect: row.get::<_, i32>(7)? != 0,
        })
    })?;
    rows.collect()
}

pub fn search_segments_in_job(conn: &Connection, job_id: &str, query: &str) -> Result<Vec<Segment>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.job_id, s.idx, s.start, s.end, s.text, s.corrected_text, s.suspect
         FROM segments s
         JOIN segments_fts fts ON fts.rowid = s.id
         WHERE segments_fts MATCH ?1 AND s.job_id = ?2
         ORDER BY s.idx",
    )?;
    let rows = stmt.query_map(params![query, job_id], |row| {
        Ok(Segment {
            id: row.get(0)?,
            job_id: row.get(1)?,
            idx: row.get(2)?,
            start: row.get(3)?,
            end: row.get(4)?,
            text: row.get(5)?,
            corrected_text: row.get(6)?,
            suspect: row.get::<_, i32>(7)? != 0,
        })
    })?;
    rows.collect()
}

pub fn search_segments(conn: &Connection, query: &str) -> Result<Vec<Segment>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.job_id, s.idx, s.start, s.end, s.text, s.corrected_text, s.suspect
         FROM segments s
         JOIN segments_fts fts ON fts.rowid = s.id
         WHERE segments_fts MATCH ?1
         ORDER BY s.job_id, s.idx",
    )?;
    let rows = stmt.query_map(params![query], |row| {
        Ok(Segment {
            id: row.get(0)?,
            job_id: row.get(1)?,
            idx: row.get(2)?,
            start: row.get(3)?,
            end: row.get(4)?,
            text: row.get(5)?,
            corrected_text: row.get(6)?,
            suspect: row.get::<_, i32>(7)? != 0,
        })
    })?;
    rows.collect()
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(schema::CREATE_TABLES).unwrap();
        conn
    }

    fn make_project(id: &str) -> Project {
        Project { id: id.into(), name: "Test Project".into(), created_at: 1000 }
    }

    fn make_job(id: &str, project_id: &str) -> Job {
        Job {
            id: id.into(),
            project_id: project_id.into(),
            file_path: "/tmp/test.mp4".into(),
            status: "pending".into(),
            whisper_model: "large-v3".into(),
            created_at: 1000,
            recording_window: None,
            error_message: None,
        }
    }

    #[test]
    fn test_project_crud() {
        let db = setup();
        insert_project(&db, &make_project("p-1")).unwrap();
        let found = get_project(&db, "p-1").unwrap().unwrap();
        assert_eq!(found.name, "Test Project");

        rename_project(&db, "p-1", "Renamed").unwrap();
        let found = get_project(&db, "p-1").unwrap().unwrap();
        assert_eq!(found.name, "Renamed");

        let list = list_projects(&db).unwrap();
        assert_eq!(list.len(), 1);

        delete_project(&db, "p-1").unwrap();
        assert!(get_project(&db, "p-1").unwrap().is_none());
    }

    #[test]
    fn test_delete_project_cascades_jobs() {
        let db = setup();
        insert_project(&db, &make_project("p-1")).unwrap();
        insert_job(&db, &make_job("job-1", "p-1")).unwrap();
        delete_project(&db, "p-1").unwrap();
        assert!(get_job(&db, "job-1").unwrap().is_none());
    }

    #[test]
    fn test_insert_and_get_job() {
        let db = setup();
        insert_project(&db, &make_project("p-1")).unwrap();
        insert_job(&db, &make_job("job-1", "p-1")).unwrap();
        let found = get_job(&db, "job-1").unwrap().unwrap();
        assert_eq!(found.file_path, "/tmp/test.mp4");
        assert_eq!(found.project_id, "p-1");
    }

    #[test]
    fn test_update_job_status() {
        let db = setup();
        insert_project(&db, &make_project("p-1")).unwrap();
        insert_job(&db, &make_job("job-1", "p-1")).unwrap();
        update_job_status(&db, "job-1", "done").unwrap();
        let found = get_job(&db, "job-1").unwrap().unwrap();
        assert_eq!(found.status, "done");
    }

    #[test]
    fn test_list_jobs_by_project() {
        let db = setup();
        insert_project(&db, &make_project("p-1")).unwrap();
        insert_job(&db, &make_job("job-1", "p-1")).unwrap();
        insert_job(&db, &make_job("job-2", "p-1")).unwrap();
        let jobs = list_jobs_by_project(&db, "p-1").unwrap();
        assert_eq!(jobs.len(), 2);
    }

    #[test]
    fn test_insert_and_get_segments() {
        let db = setup();
        insert_project(&db, &make_project("p-1")).unwrap();
        insert_job(&db, &make_job("job-1", "p-1")).unwrap();
        let seg = Segment {
            id: 0,
            job_id: "job-1".into(),
            idx: 0,
            start: 0.0,
            end: 2.5,
            text: "สวัสดีครับ".into(),
            corrected_text: None,
            suspect: false,
        };
        insert_segment(&db, &seg).unwrap();
        let segs = get_segments(&db, "job-1").unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].text, "สวัสดีครับ");
    }
}
