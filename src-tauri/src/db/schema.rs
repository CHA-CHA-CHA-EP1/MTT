pub const CREATE_TABLES: &str = "
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS projects (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id               TEXT    PRIMARY KEY,
    project_id       TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path        TEXT    NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'pending',
    whisper_model    TEXT    NOT NULL,
    created_at       INTEGER NOT NULL,
    recording_window TEXT
);

CREATE TABLE IF NOT EXISTS spaces (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id         TEXT    PRIMARY KEY,
    space_id   TEXT    NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recording_chunks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id    TEXT    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    chunk_idx INTEGER NOT NULL,
    file_path TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         TEXT    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    idx            INTEGER NOT NULL,
    start          REAL    NOT NULL,
    end            REAL    NOT NULL,
    text           TEXT    NOT NULL,
    corrected_text TEXT,
    suspect        INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
    text,
    corrected_text,
    content='segments',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
    INSERT INTO segments_fts(rowid, text, corrected_text)
    VALUES (new.id, new.text, new.corrected_text);
END;

CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text, corrected_text)
    VALUES ('delete', old.id, old.text, old.corrected_text);
    INSERT INTO segments_fts(rowid, text, corrected_text)
    VALUES (new.id, new.text, new.corrected_text);
END;

CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text, corrected_text)
    VALUES ('delete', old.id, old.text, old.corrected_text);
END;
";
