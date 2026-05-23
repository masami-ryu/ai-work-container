import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const DEFAULT_DB_PATH = join(homedir(), '.codex', 'context', 'context.db');

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  project_name TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_cwd_mappings (
  cwd          TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  FOREIGN KEY (project_name) REFERENCES projects(project_name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspaces (
  project_name          TEXT NOT NULL,
  workspace_name        TEXT NOT NULL,
  parent_workspace_name TEXT,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_name, workspace_name),
  FOREIGN KEY (project_name) REFERENCES projects(project_name) ON DELETE CASCADE,
  FOREIGN KEY (project_name, parent_workspace_name)
    REFERENCES workspaces(project_name, workspace_name) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contexts (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL CHECK (scope IN ('global', 'project', 'workspace')),
  project_name    TEXT NOT NULL DEFAULT '',
  workspace_name  TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  source          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at     TEXT,
  UNIQUE (scope, project_name, workspace_name, category, title),
  CHECK (
    (scope = 'global'    AND project_name = '' AND workspace_name = '') OR
    (scope = 'project'   AND project_name != '' AND workspace_name = '') OR
    (scope = 'workspace' AND project_name != '' AND workspace_name != '')
  )
);

CREATE TABLE IF NOT EXISTS context_tags (
  context_id TEXT NOT NULL,
  tag        TEXT NOT NULL,
  PRIMARY KEY (context_id, tag),
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS overwrite_history (
  history_id     TEXT PRIMARY KEY,
  context_id     TEXT NOT NULL,
  content        TEXT NOT NULL,
  source         TEXT,
  overwritten_by TEXT,
  overwritten_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contexts_scope
  ON contexts(scope, project_name, workspace_name);
CREATE INDEX IF NOT EXISTS idx_contexts_category
  ON contexts(scope, project_name, workspace_name, category);
CREATE INDEX IF NOT EXISTS idx_overwrite_history_context
  ON overwrite_history(context_id, overwritten_at);
`;

const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS contexts_fts USING fts5(
  title,
  content,
  content='contexts',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS contexts_fts_ai AFTER INSERT ON contexts BEGIN
  INSERT INTO contexts_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS contexts_fts_ad AFTER DELETE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS contexts_fts_au AFTER UPDATE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO contexts_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
END;
`;

function initSchema(db) {
  const { user_version } = db.prepare('PRAGMA user_version').get();
  if (user_version >= SCHEMA_VERSION) {
    // FTS の有効/無効状態を再判定
    detectFts(db);
    return;
  }

  db.exec(SCHEMA_SQL);

  // FTS5 trigram 初期化（フォールバック付き）
  detectFts(db);
  if (db.ftsEnabled) {
    // Already created during detect
  }

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function detectFts(db) {
  if (
    process.env.CODEX_CONTEXT_DISABLE_FTS === '1'
    || process.env.CLAUDE_CONTEXT_DISABLE_FTS === '1'
  ) {
    db.ftsEnabled = false;
    return;
  }

  try {
    db.exec(FTS_SQL);
    db.ftsEnabled = true;
  } catch {
    db.ftsEnabled = false;
  }
}

export function getDatabase(dbPath) {
  dbPath = dbPath
    ?? process.env.CODEX_CONTEXT_DB_PATH
    ?? process.env.CLAUDE_CONTEXT_DB_PATH
    ?? DEFAULT_DB_PATH;
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);
  return db;
}

export function closeDatabase(db) {
  db.close();
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function generateId() {
  return randomUUID();
}

const VALID_ID_TABLES = {
  contexts: 'id',
  overwrite_history: 'history_id',
};

/**
 * 短縮ID（先頭8文字等）をフルUUIDに解決する。
 * フルUUID（36文字以上）はそのまま返す。
 * 一意に特定できない場合はエラーをスローする。
 * 該当なしの場合は null を返す。
 */
export function resolveShortId(db, shortId, table = 'contexts') {
  if (shortId.length >= 36) return shortId;
  const column = VALID_ID_TABLES[table];
  if (!column) throw new Error(`不正なテーブル: ${table}`);
  const rows = db.prepare(
    `SELECT ${column} FROM ${table} WHERE ${column} LIKE ? || '%'`
  ).all(shortId);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(`ID "${shortId}" は複数のエントリに一致します（${rows.length}件）。より長いIDを指定してください。`);
  }
  return rows[0][column];
}
