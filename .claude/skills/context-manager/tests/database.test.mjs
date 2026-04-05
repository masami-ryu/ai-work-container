import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createFileDb, cleanupFileDb, closeTestDb } from './helpers.mjs';
import { resolveShortId, generateId } from '../scripts/lib/database.mjs';
import { registerProject } from '../scripts/lib/project.mjs';
import { handleWrite } from '../scripts/lib/context.mjs';

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

  // --- resolveShortId テスト ---

  it('resolveShortId: フルUUIDはそのまま返す', () => {
    db = createTestDb();
    registerProject(db, 'testproj', '/tmp/testproj');
    const r = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'test', title: 'full-uuid',
      content: 'x', source: null,
    });
    const fullId = r.match(/ID: (.+)/)[1];
    assert.equal(resolveShortId(db, fullId), fullId);
  });

  it('resolveShortId: 短縮IDで一意解決', () => {
    db = createTestDb();
    registerProject(db, 'testproj', '/tmp/testproj');
    const r = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'test', title: 'short-resolve',
      content: 'x', source: null,
    });
    const fullId = r.match(/ID: (.+)/)[1];
    assert.equal(resolveShortId(db, fullId.slice(0, 8)), fullId);
  });

  it('resolveShortId: 該当なしは null', () => {
    db = createTestDb();
    assert.equal(resolveShortId(db, 'zzzzzzzz'), null);
  });

  it('resolveShortId: overwrite_history テーブル対応', () => {
    db = createTestDb();
    registerProject(db, 'testproj', '/tmp/testproj');
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'test', title: 'hist-resolve',
      content: 'v1', source: 'a',
    });
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'test', title: 'hist-resolve',
      content: 'v2', source: 'b',
    });
    const hist = db.prepare('SELECT history_id FROM overwrite_history LIMIT 1').get();
    assert.ok(hist);
    const resolved = resolveShortId(db, hist.history_id.slice(0, 8), 'overwrite_history');
    assert.equal(resolved, hist.history_id);
  });

  it('resolveShortId: 不正なテーブル名はエラー', () => {
    db = createTestDb();
    assert.throws(() => resolveShortId(db, 'abc', 'invalid_table'), /不正なテーブル/);
  });
});
