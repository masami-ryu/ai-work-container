import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createFileDb, cleanupFileDb, closeTestDb } from './helpers.mjs';

describe('database', () => {
  let db;

  afterEach(() => {
    if (db) {
      try { closeTestDb(db); } catch { /* already closed */ }
      db = null;
    }
  });

  it('スキーマ初期化: 全テーブルが作成されること', () => {
    db = createTestDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);

    assert.ok(tables.includes('projects'));
    assert.ok(tables.includes('project_cwd_mappings'));
    assert.ok(tables.includes('workspaces'));
    assert.ok(tables.includes('contexts'));
    assert.ok(tables.includes('context_tags'));
    assert.ok(tables.includes('overwrite_history'));
    // contexts_fts は仮想テーブルのため別クエリ
    const vtables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='contexts_fts'"
    ).all();
    if (db.ftsEnabled) {
      assert.equal(vtables.length, 1);
    }
  });

  it('WAL mode が有効であること', () => {
    db = createFileDb();
    const { journal_mode } = db.prepare('PRAGMA journal_mode').get();
    assert.equal(journal_mode, 'wal');
    cleanupFileDb(db);
    db = null;
  });

  it('foreign_keys が有効であること', () => {
    db = createTestDb();
    const { foreign_keys } = db.prepare('PRAGMA foreign_keys').get();
    assert.equal(foreign_keys, 1);
  });

  it('冪等性: 2 回呼んでもエラーにならないこと', () => {
    db = createTestDb();
    closeTestDb(db);
    // 同じパス（:memory: は異なるインスタンスだが initSchema の再実行を確認）
    db = createTestDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    assert.ok(tables.length >= 6);
  });

  it('user_version が 1 であること', () => {
    db = createTestDb();
    const { user_version } = db.prepare('PRAGMA user_version').get();
    assert.equal(user_version, 1);
  });
});
