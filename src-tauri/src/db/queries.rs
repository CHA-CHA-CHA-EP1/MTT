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
pub struct Space {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub pinned: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: String,
    pub space_id: String,
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
    pub title: Option<String>,
    pub folder_id: Option<String>,
    pub notes: Option<String>,
    pub duration_secs: Option<f64>,
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

// --- Space queries ---

pub fn insert_space(conn: &Connection, space: &Space) -> Result<()> {
    conn.execute(
        "INSERT INTO spaces (id, name, created_at, pinned) VALUES (?1, ?2, ?3, ?4)",
        params![space.id, space.name, space.created_at, space.pinned],
    )?;
    Ok(())
}

pub fn list_spaces(conn: &Connection) -> Result<Vec<Space>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, pinned FROM spaces ORDER BY pinned DESC, created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Space { id: row.get(0)?, name: row.get(1)?, created_at: row.get(2)?, pinned: row.get::<_, i32>(3)? != 0 })
    })?;
    rows.collect()
}

pub fn get_space(conn: &Connection, id: &str) -> Result<Option<Space>> {
    let mut stmt = conn.prepare("SELECT id, name, created_at, pinned FROM spaces WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(Space { id: row.get(0)?, name: row.get(1)?, created_at: row.get(2)?, pinned: row.get::<_, i32>(3)? != 0 }))
    } else {
        Ok(None)
    }
}

pub fn rename_space(conn: &Connection, id: &str, name: &str) -> Result<()> {
    conn.execute("UPDATE spaces SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

pub fn pin_space(conn: &Connection, id: &str, pinned: bool) -> Result<()> {
    conn.execute("UPDATE spaces SET pinned = ?1 WHERE id = ?2", params![pinned as i32, id])?;
    Ok(())
}

pub fn delete_space(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM spaces WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Folder queries ---

pub fn insert_folder(conn: &Connection, folder: &Folder) -> Result<()> {
    conn.execute(
        "INSERT INTO folders (id, space_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![folder.id, folder.space_id, folder.name, folder.created_at],
    )?;
    Ok(())
}

pub fn list_folders(conn: &Connection, space_id: &str) -> Result<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, space_id, name, created_at FROM folders WHERE space_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![space_id], |row| {
        Ok(Folder { id: row.get(0)?, space_id: row.get(1)?, name: row.get(2)?, created_at: row.get(3)? })
    })?;
    rows.collect()
}

pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> Result<()> {
    conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

pub fn delete_folder(conn: &Connection, id: &str) -> Result<()> {
    // jobs in this folder move to inbox (folder_id = NULL)
    conn.execute("UPDATE jobs SET folder_id = NULL WHERE folder_id = ?1", params![id])?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Job queries ---

pub fn insert_job(conn: &Connection, job: &Job) -> Result<()> {
    conn.execute(
        "INSERT INTO jobs (id, project_id, space_id, file_path, status, whisper_model, created_at, recording_window, title)
         VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![job.id, job.project_id, job.file_path, job.status, job.whisper_model, job.created_at, job.recording_window, job.title],
    )?;
    Ok(())
}

pub fn update_job_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    conn.execute("UPDATE jobs SET status = ?1 WHERE id = ?2", params![status, id])?;
    Ok(())
}

pub fn update_job_duration(conn: &Connection, id: &str, duration_secs: f64) -> Result<()> {
    conn.execute("UPDATE jobs SET duration_secs = ?1 WHERE id = ?2", params![duration_secs, id])?;
    Ok(())
}

pub fn set_job_error(conn: &Connection, id: &str, message: &str) -> Result<()> {
    conn.execute(
        "UPDATE jobs SET status = 'error', error_message = ?1 WHERE id = ?2",
        params![message, id],
    )?;
    Ok(())
}

/// Reset jobs that were mid-transcription when the Python worker crashed.
/// Only touches running/pending — recording status is managed by the recorder separately.
pub fn reset_transcription_jobs_to_error(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE jobs SET status = 'error', error_message = 'Transcription worker crashed. Click Re-transcribe to try again.'
         WHERE status IN ('running', 'pending')",
        [],
    )?;
    Ok(())
}

/// Collect IDs of all jobs that need startup recovery (recording/running/pending).
/// Must be called before spawning the recovery thread so the snapshot is taken
/// before any new jobs are created — the reset then only touches these exact IDs.
pub fn collect_interrupted_job_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM jobs WHERE status IN ('recording', 'running', 'pending')",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// On app startup, reset only the specific jobs that were interrupted (by force-quit or crash).
/// Takes explicit IDs collected before the recovery thread started, so any job created
/// after launch is never touched — no time-based heuristic needed.
pub fn reset_interrupted_jobs(conn: &Connection, job_ids: &[String]) -> Result<()> {
    if job_ids.is_empty() { return Ok(()); }
    for id in job_ids {
        conn.execute(
            "UPDATE jobs SET status = 'error',
                error_message = CASE status
                    WHEN 'recording' THEN 'Recording was interrupted (app closed). Chunks may be recoverable.'
                    ELSE 'Transcription was interrupted (app closed). Click Re-transcribe to try again.'
                END
             WHERE id = ?1 AND status IN ('recording', 'running', 'pending')",
            params![id],
        )?;
    }
    Ok(())
}

pub fn get_job(conn: &Connection, id: &str) -> Result<Option<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, file_path, status, whisper_model, created_at, recording_window, error_message, title, folder_id, notes, duration_secs FROM jobs WHERE id = ?1",
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
            title: row.get(8)?,
            folder_id: row.get(9)?,
            notes: row.get(10)?,
            duration_secs: row.get(11)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn get_job_notes(conn: &Connection, id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT notes FROM jobs WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? { Ok(row.get(0)?) } else { Ok(None) }
}

pub fn save_job_notes(conn: &Connection, id: &str, notes: &str) -> Result<()> {
    conn.execute("UPDATE jobs SET notes = ?1 WHERE id = ?2", params![notes, id])?;
    Ok(())
}

pub fn update_job_file_path(conn: &Connection, id: &str, file_path: &str) -> Result<()> {
    conn.execute("UPDATE jobs SET file_path = ?1 WHERE id = ?2", params![file_path, id])?;
    Ok(())
}

pub fn list_jobs_by_project(conn: &Connection, project_id: &str) -> Result<Vec<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, file_path, status, whisper_model, created_at, recording_window, error_message, title, folder_id, notes, duration_secs
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
            title: row.get(8)?,
            folder_id: row.get(9)?,
            notes: row.get(10)?,
            duration_secs: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn delete_job(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn list_jobs_by_space(conn: &Connection, space_id: &str) -> Result<Vec<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, file_path, status, whisper_model, created_at, recording_window, error_message, title, folder_id, notes, duration_secs
         FROM jobs WHERE space_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![space_id], |row| {
        Ok(Job {
            id: row.get(0)?,
            project_id: row.get(1)?,
            file_path: row.get(2)?,
            status: row.get(3)?,
            whisper_model: row.get(4)?,
            created_at: row.get(5)?,
            recording_window: row.get(6)?,
            error_message: row.get(7)?,
            title: row.get(8)?,
            folder_id: row.get(9)?,
            notes: row.get(10)?,
            duration_secs: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn move_job_to_folder(conn: &Connection, job_id: &str, folder_id: Option<&str>) -> Result<()> {
    conn.execute("UPDATE jobs SET folder_id = ?1 WHERE id = ?2", params![folder_id, job_id])?;
    Ok(())
}

pub fn update_job_title(conn: &Connection, id: &str, title: Option<&str>) -> Result<()> {
    conn.execute("UPDATE jobs SET title = ?1 WHERE id = ?2", params![title, id])?;
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

// --- Recording chunk queries ---

pub fn insert_recording_chunk(conn: &Connection, job_id: &str, chunk_idx: u32, file_path: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO recording_chunks (job_id, chunk_idx, file_path) VALUES (?1, ?2, ?3)",
        params![job_id, chunk_idx, file_path],
    )?;
    Ok(())
}

pub fn get_recording_chunks(conn: &Connection, job_id: &str) -> Result<Vec<(u32, String)>> {
    let mut stmt = conn.prepare(
        "SELECT chunk_idx, file_path FROM recording_chunks WHERE job_id = ?1 ORDER BY chunk_idx",
    )?;
    let rows = stmt.query_map(params![job_id], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

pub fn delete_recording_chunks(conn: &Connection, job_id: &str) -> Result<()> {
    conn.execute("DELETE FROM recording_chunks WHERE job_id = ?1", params![job_id])?;
    Ok(())
}

pub fn jobs_with_pending_chunks(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT rc.job_id FROM recording_chunks rc
         JOIN jobs j ON j.id = rc.job_id
         WHERE j.status = 'recording'",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// Returns IDs of all jobs currently in "recording" status.
/// Used by cleanup_orphaned_tmp to preserve dirs for in-progress recordings
/// (including SCRecordingOutput jobs that have no chunks in DB yet).
pub fn active_recording_job_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM jobs WHERE status = 'recording'")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
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

pub fn insert_segments_batch(conn: &Connection, segments: &[Segment]) -> Result<()> {
    if segments.is_empty() { return Ok(()); }
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO segments (job_id, idx, start, end, text, corrected_text, suspect)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for seg in segments {
            stmt.execute(params![
                seg.job_id, seg.idx, seg.start, seg.end,
                seg.text, seg.corrected_text, seg.suspect as i32
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn set_segment_text(conn: &Connection, segment_id: i64, text: Option<String>) -> Result<()> {
    conn.execute(
        "UPDATE segments SET corrected_text = ?1 WHERE id = ?2",
        params![text, segment_id],
    )?;
    Ok(())
}

/// Guarded write — only sets corrected_text when no prior correction exists.
/// Used by the AI correction path to prevent overwriting user manual edits.
/// Returns rows affected (0 = blocked).
pub fn set_segment_correction_guarded(
    conn: &Connection,
    segment_id: i64,
    job_id: &str,
    text: &str,
) -> Result<usize> {
    let n = conn.execute(
        "UPDATE segments SET corrected_text = ?1 WHERE id = ?2 AND job_id = ?3 AND corrected_text IS NULL",
        params![text, segment_id, job_id],
    )?;
    Ok(n)
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

// --- Unified space search ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub job_id: String,
    pub space_id: String,
    pub job_title: String,
    pub source: String, // "transcript" | "notes"
    pub snippet: String,
    pub start: Option<f64>, // transcript only
}

fn fts_query(raw: &str) -> String {
    raw.split_whitespace()
        .filter_map(|w| {
            let clean: String = w.chars().filter(|c| c.is_alphanumeric() || *c == '_').collect();
            if clean.is_empty() { None } else { Some(format!("{}*", clean)) }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_snippet(text: &str, query: &str, context_chars: usize) -> String {
    let lower = text.to_lowercase();
    let lower_q = query.to_lowercase();
    let chars: Vec<char> = text.chars().collect();
    let lower_chars: Vec<char> = lower.chars().collect();
    let q_chars: Vec<char> = lower_q.chars().collect();
    let pos = (0..lower_chars.len().saturating_sub(q_chars.len()))
        .find(|&i| lower_chars[i..].starts_with(q_chars.as_slice()));
    if let Some(p) = pos {
        let start = p.saturating_sub(context_chars);
        let end = (p + q_chars.len() + context_chars).min(chars.len());
        let snippet: String = chars[start..end].iter().collect();
        let mut result = String::new();
        if start > 0 { result.push('…'); }
        result.push_str(&snippet);
        if end < chars.len() { result.push('…'); }
        result
    } else {
        let s: String = chars.iter().take(context_chars * 2).collect();
        if chars.len() > context_chars * 2 { format!("{}…", s) } else { s }
    }
}

fn job_title_from(title: Option<String>, recording_window: Option<String>, file_path: String) -> String {
    if let Some(t) = title.filter(|s| !s.is_empty()) { return t; }
    if let Some(w) = recording_window.filter(|s| !s.is_empty()) { return w; }
    std::path::Path::new(&file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&file_path)
        .to_string()
}

fn search_impl(conn: &Connection, space_id: Option<&str>, query: &str) -> Result<Vec<SearchResult>> {
    if query.trim().is_empty() { return Ok(vec![]); }
    let mut results = Vec::new();

    // Transcript search via FTS
    let fts_q = fts_query(query);
    if !fts_q.is_empty() {
        let (sql, rows) = if let Some(sid) = space_id {
            let mut stmt = conn.prepare(
                "SELECT s.job_id, j.space_id, s.start, COALESCE(s.corrected_text, s.text),
                        j.title, j.recording_window, j.file_path
                 FROM segments s
                 JOIN segments_fts fts ON fts.rowid = s.id
                 JOIN jobs j ON j.id = s.job_id
                 WHERE segments_fts MATCH ?1 AND j.space_id = ?2
                 ORDER BY rank LIMIT 20",
            )?;
            let r: Vec<_> = stmt.query_map(params![fts_q, sid], |row| {
                Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,f64>(2)?,
                    row.get::<_,String>(3)?, row.get::<_,Option<String>>(4)?,
                    row.get::<_,Option<String>>(5)?, row.get::<_,String>(6)?))
            })?.flatten().collect();
            ((), r)
        } else {
            let mut stmt = conn.prepare(
                "SELECT s.job_id, j.space_id, s.start, COALESCE(s.corrected_text, s.text),
                        j.title, j.recording_window, j.file_path
                 FROM segments s
                 JOIN segments_fts fts ON fts.rowid = s.id
                 JOIN jobs j ON j.id = s.job_id
                 WHERE segments_fts MATCH ?1
                 ORDER BY rank LIMIT 30",
            )?;
            let r: Vec<_> = stmt.query_map(params![fts_q], |row| {
                Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,f64>(2)?,
                    row.get::<_,String>(3)?, row.get::<_,Option<String>>(4)?,
                    row.get::<_,Option<String>>(5)?, row.get::<_,String>(6)?))
            })?.flatten().collect();
            ((), r)
        };
        let _ = sql;
        for (job_id, sid, start, text, title, rec_win, file_path) in rows {
            results.push(SearchResult {
                job_title: job_title_from(title, rec_win, file_path),
                job_id,
                space_id: sid,
                source: "transcript".into(),
                snippet: text,
                start: Some(start),
            });
        }
    }

    // Notes search via LIKE
    let like_q = format!("%{}%", query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let rows: Vec<_> = if let Some(sid) = space_id {
        let mut stmt = conn.prepare(
            "SELECT id, space_id, notes, title, recording_window, file_path
             FROM jobs
             WHERE space_id = ?1 AND notes IS NOT NULL AND notes != ''
                   AND LOWER(notes) LIKE LOWER(?2) ESCAPE '\\' LIMIT 10",
        )?;
        stmt.query_map(params![sid, like_q], |row| {
            Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,String>(2)?,
                row.get::<_,Option<String>>(3)?, row.get::<_,Option<String>>(4)?, row.get::<_,String>(5)?))
        })?.flatten().collect()
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, space_id, notes, title, recording_window, file_path
             FROM jobs
             WHERE notes IS NOT NULL AND notes != ''
                   AND LOWER(notes) LIKE LOWER(?1) ESCAPE '\\' LIMIT 15",
        )?;
        stmt.query_map(params![like_q], |row| {
            Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,String>(2)?,
                row.get::<_,Option<String>>(3)?, row.get::<_,Option<String>>(4)?, row.get::<_,String>(5)?))
        })?.flatten().collect()
    };
    for (job_id, sid, notes, title, rec_win, file_path) in rows {
        results.push(SearchResult {
            job_title: job_title_from(title, rec_win, file_path),
            job_id,
            space_id: sid,
            source: "notes".into(),
            snippet: extract_snippet(&notes, query, 80),
            start: None,
        });
    }

    Ok(results)
}

pub fn search_in_space(conn: &Connection, space_id: &str, query: &str) -> Result<Vec<SearchResult>> {
    search_impl(conn, Some(space_id), query)
}

pub fn search_all_spaces(conn: &Connection, query: &str) -> Result<Vec<SearchResult>> {
    search_impl(conn, None, query)
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
            title: None,
            folder_id: None,
            notes: None,
            duration_secs: None,
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

    fn setup_segment() -> (Connection, i64) {
        let db = setup();
        insert_project(&db, &make_project("p-1")).unwrap();
        insert_job(&db, &make_job("job-1", "p-1")).unwrap();
        let seg = Segment {
            id: 0,
            job_id: "job-1".into(),
            idx: 0,
            start: 0.0,
            end: 2.5,
            text: "raw text".into(),
            corrected_text: None,
            suspect: false,
        };
        insert_segment(&db, &seg).unwrap();
        let segs = get_segments(&db, "job-1").unwrap();
        (db, segs[0].id)
    }

    #[test]
    fn test_guarded_correction_writes_when_null() {
        let (db, id) = setup_segment();
        let n = set_segment_correction_guarded(&db, id, "job-1", "ai fixed").unwrap();
        assert_eq!(n, 1);
        let segs = get_segments(&db, "job-1").unwrap();
        assert_eq!(segs[0].corrected_text.as_deref(), Some("ai fixed"));
    }

    #[test]
    fn test_guarded_correction_blocked_by_manual_edit() {
        let (db, id) = setup_segment();
        set_segment_text(&db, id, Some("user edit".into())).unwrap();
        let n = set_segment_correction_guarded(&db, id, "job-1", "ai fixed").unwrap();
        assert_eq!(n, 0);
        let segs = get_segments(&db, "job-1").unwrap();
        assert_eq!(segs[0].corrected_text.as_deref(), Some("user edit"));
    }

    #[test]
    fn test_guarded_correction_blocked_by_wrong_job_id() {
        let (db, id) = setup_segment();
        let n = set_segment_correction_guarded(&db, id, "job-other", "ai fixed").unwrap();
        assert_eq!(n, 0);
        let segs = get_segments(&db, "job-1").unwrap();
        assert!(segs[0].corrected_text.is_none());
    }

    #[test]
    fn test_guarded_correction_blocked_on_ai_rerun() {
        let (db, id) = setup_segment();
        let first = set_segment_correction_guarded(&db, id, "job-1", "ai fixed v1").unwrap();
        assert_eq!(first, 1);
        let second = set_segment_correction_guarded(&db, id, "job-1", "ai fixed v2").unwrap();
        assert_eq!(second, 0);
        let segs = get_segments(&db, "job-1").unwrap();
        assert_eq!(segs[0].corrected_text.as_deref(), Some("ai fixed v1"));
    }
}
