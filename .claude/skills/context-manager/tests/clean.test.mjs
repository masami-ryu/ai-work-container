import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, closeTestDb } from './helpers.mjs';
import { handleClean } from '../scripts/lib/clean.mjs';
import { handleWrite, handleVerify } from '../scripts/lib/context.mjs';
import { registerProject } from '../scripts/lib/project.mjs';

describe('clean', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
    registerProject(db, 'testproj', '/tmp/testproj');
  });

  afterEach(() => {
    if (db) closeTestDb(db);
    db = null;
  });

  it('verify（単一 ID）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'verify-test',
      content: 'content', source: null,
    });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'verify-test'").get();
    handleVerify(db, { id: [entry.id] });
    const updated = db.prepare('SELECT verified_at FROM contexts WHERE id = ?').get(entry.id);
    assert.ok(updated.verified_at);
  });

  it('verify（複数 ID）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'v-multi-1', content: 'c1', source: null });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'v-multi-2', content: 'c2', source: null });
    const e1 = db.prepare("SELECT id FROM contexts WHERE title = 'v-multi-1'").get();
    const e2 = db.prepare("SELECT id FROM contexts WHERE title = 'v-multi-2'").get();
    handleVerify(db, { id: [e1.id, e2.id] });
    assert.ok(db.prepare('SELECT verified_at FROM contexts WHERE id = ?').get(e1.id).verified_at);
    assert.ok(db.prepare('SELECT verified_at FROM contexts WHERE id = ?').get(e2.id).verified_at);
  });

  it('verify + 履歴解決', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'vh-test', content: 'v1', source: 'a' });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'vh-test', content: 'v2', source: 'b' });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'vh-test'").get();
    // 履歴の overwritten_at を過去にして verify で解決済みにする
    db.prepare("UPDATE overwrite_history SET overwritten_at = datetime('now', '-1 seconds') WHERE context_id = ?").run(entry.id);
    handleVerify(db, { id: [entry.id] });
    // 解決済みの履歴が clean 対象になるか確認（ただし最近なので対象外）
    const result = handleClean(db, { project: 'testproj', days: '0' });
    assert.ok(result.includes('解決済み') || result.includes('クリーン候補はありません'));
  });

  it('鮮度チェック（updated_at 超過）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'old-entry',
      content: 'old content', source: null,
    });
    db.prepare("UPDATE contexts SET updated_at = datetime('now', '-31 days') WHERE title = 'old-entry'").run();
    const result = handleClean(db, { project: 'testproj' });
    assert.ok(result.includes('old-entry'));
    assert.ok(result.includes('鮮度閾値超過'));
  });

  it('鮮度チェック（verified_at 未設定 + created_at 古い）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'unverified-old',
      content: 'content', source: null,
    });
    db.prepare("UPDATE contexts SET created_at = datetime('now', '-31 days'), updated_at = datetime('now') WHERE title = 'unverified-old'").run();
    const result = handleClean(db, { project: 'testproj' });
    assert.ok(result.includes('unverified-old'));
  });

  it('鮮度チェック（created_at 古い + updated_at 最近）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'old-created-new-update',
      content: 'content', source: null,
    });
    // created_at は古いが updated_at は最近
    db.prepare("UPDATE contexts SET created_at = datetime('now', '-31 days') WHERE title = 'old-created-new-update'").run();
    const result = handleClean(db, { project: 'testproj' });
    // verified_at は未設定かつ created_at が古い → 検出される
    assert.ok(result.includes('old-created-new-update'));
  });

  it('解決済み履歴のクリーン', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'hist-clean', content: 'v1', source: 'a' });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'hist-clean', content: 'v2', source: 'b' });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'hist-clean'").get();
    // 履歴を古くする
    db.prepare("UPDATE overwrite_history SET overwritten_at = datetime('now', '-31 days') WHERE context_id = ?").run(entry.id);
    // verify して解決済みにする
    handleVerify(db, { id: [entry.id] });
    const result = handleClean(db, { project: 'testproj' });
    assert.ok(result.includes('解決済み上書き履歴'));
  });

  it('解決済み履歴（最近）の除外', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'hist-recent', content: 'v1', source: 'a' });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'hist-recent', content: 'v2', source: 'b' });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'hist-recent'").get();
    // overwritten_at は最近のまま、でも verify より前にする
    db.prepare("UPDATE overwrite_history SET overwritten_at = datetime('now', '-1 seconds') WHERE context_id = ?").run(entry.id);
    handleVerify(db, { id: [entry.id] });
    const result = handleClean(db, { project: 'testproj' });
    // 最近の解決済み履歴は clean 対象外
    assert.ok(!result.includes('hist-recent'));
  });

  it('未解決履歴の除外', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'unresolved', content: 'v1', source: 'a' });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'unresolved', content: 'v2', source: 'b' });
    // verify しない（未解決のまま）
    db.prepare("UPDATE overwrite_history SET overwritten_at = datetime('now', '-31 days')").run();
    const result = handleClean(db, { project: 'testproj' });
    // 未解決履歴は clean 対象外
    assert.ok(!result.includes('解決済み上書き履歴'));
  });
});
