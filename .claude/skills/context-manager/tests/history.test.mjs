import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, closeTestDb } from './helpers.mjs';
import { handleHistory } from '../scripts/lib/history.mjs';
import { handleWrite, handleVerify } from '../scripts/lib/context.mjs';
import { registerProject } from '../scripts/lib/project.mjs';

describe('history', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
    registerProject(db, 'testproj', '/tmp/testproj');
  });

  afterEach(() => {
    if (db) closeTestDb(db);
    db = null;
  });

  function createHistoryEntry() {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'hist-test',
      content: 'v1', source: 'agent-a',
    });
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'hist-test',
      content: 'v2', source: 'agent-b',
    });
    return db.prepare("SELECT id FROM contexts WHERE title = 'hist-test'").get().id;
  }

  it('履歴参照（ID 指定）', () => {
    const ctxId = createHistoryEntry();
    const result = handleHistory(db, { id: [ctxId] });
    assert.ok(result.includes('上書き履歴'));
    assert.ok(result.includes('agent-a'));
  });

  it('未解決一覧', () => {
    createHistoryEntry();
    const result = handleHistory(db, { unresolved: true, project: 'testproj' });
    assert.ok(result.includes('未解決'));
    assert.ok(result.includes('hist-test'));
  });

  it('解決済み判定', () => {
    const ctxId = createHistoryEntry();
    // overwritten_at を過去に設定して verify が確実に解決済みにする
    db.prepare("UPDATE overwrite_history SET overwritten_at = datetime('now', '-1 seconds') WHERE context_id = ?").run(ctxId);
    handleVerify(db, { id: [ctxId] });
    const result = handleHistory(db, { unresolved: true, project: 'testproj' });
    assert.ok(result.includes('未解決の履歴はありません'));
  });

  it('復元', () => {
    const ctxId = createHistoryEntry();
    const hist = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').get(ctxId);
    const result = handleHistory(db, { restore: true, 'history-id': [hist.history_id], source: 'agent-c' });
    assert.ok(result.includes('復元しました'));
    const ctx = db.prepare('SELECT content FROM contexts WHERE id = ?').get(ctxId);
    assert.equal(ctx.content, 'v1');
  });

  it('復元時の履歴退避', () => {
    const ctxId = createHistoryEntry();
    const hist = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').get(ctxId);
    handleHistory(db, { restore: true, 'history-id': [hist.history_id], source: 'agent-c' });
    // 復元で新たな履歴が生成される
    const histories = db.prepare('SELECT * FROM overwrite_history WHERE context_id = ? ORDER BY overwritten_at').all(ctxId);
    assert.equal(histories.length, 2);
    // 新しい履歴は v2 の退避
    assert.equal(histories[1].content, 'v2');
    assert.equal(histories[1].overwritten_by, 'agent-c');
  });

  it('復元後の未解決状態', () => {
    const ctxId = createHistoryEntry();
    // verify してから restore
    handleVerify(db, { id: [ctxId] });
    const hist = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').get(ctxId);
    handleHistory(db, { restore: true, 'history-id': [hist.history_id], source: null });
    // 復元で生成された履歴は未解決
    const result = handleHistory(db, { unresolved: true, project: 'testproj' });
    assert.ok(result.includes('未解決'));
    assert.ok(!result.includes('未解決の履歴はありません'));
  });

  it('restore の overwritten_by', () => {
    const ctxId = createHistoryEntry();
    const hist = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').get(ctxId);
    handleHistory(db, { restore: true, 'history-id': [hist.history_id], source: 'my-agent' });
    const histories = db.prepare('SELECT * FROM overwrite_history WHERE context_id = ? ORDER BY overwritten_at DESC').all(ctxId);
    assert.equal(histories[0].overwritten_by, 'my-agent');
  });

  it('restore の overwritten_by（未指定）', () => {
    const ctxId = createHistoryEntry();
    const hist = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').get(ctxId);
    handleHistory(db, { restore: true, 'history-id': [hist.history_id], source: null });
    const histories = db.prepare('SELECT * FROM overwrite_history WHERE context_id = ? ORDER BY overwritten_at DESC').all(ctxId);
    assert.equal(histories[0].overwritten_by, 'system:restore');
  });

  it('purge（単一 --history-id）', () => {
    const ctxId = createHistoryEntry();
    db.prepare("UPDATE overwrite_history SET overwritten_at = datetime('now', '-1 seconds') WHERE context_id = ?").run(ctxId);
    handleVerify(db, { id: [ctxId] });
    const hist = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').get(ctxId);
    const result = handleHistory(db, { purge: true, 'history-id': [hist.history_id] });
    assert.ok(result.includes('1 件'));
    assert.ok(!db.prepare('SELECT 1 FROM overwrite_history WHERE history_id = ?').get(hist.history_id));
  });

  it('purge（複数 --history-id）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'purge-multi', content: 'v1', source: 'a' });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'purge-multi', content: 'v2', source: 'b' });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'purge-multi', content: 'v3', source: 'c' });
    const ctxId = db.prepare("SELECT id FROM contexts WHERE title = 'purge-multi'").get().id;
    db.prepare("UPDATE overwrite_history SET overwritten_at = datetime('now', '-1 seconds') WHERE context_id = ?").run(ctxId);
    handleVerify(db, { id: [ctxId] });
    const hists = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').all(ctxId);
    const result = handleHistory(db, { purge: true, 'history-id': hists.map(h => h.history_id) });
    assert.ok(result.includes('2 件'));
  });

  it('purge（未解決履歴拒否）', () => {
    const ctxId = createHistoryEntry();
    const hist = db.prepare('SELECT history_id FROM overwrite_history WHERE context_id = ?').get(ctxId);
    const result = handleHistory(db, { purge: true, 'history-id': [hist.history_id] });
    assert.ok(result.includes('未解決'));
  });

  it('purge（存在しない ID）', () => {
    const result = handleHistory(db, { purge: true, 'history-id': ['nonexistent-id'] });
    assert.ok(result.includes('見つかりません'));
  });
});
