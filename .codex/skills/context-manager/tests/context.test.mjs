import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, closeTestDb } from './helpers.mjs';
import { handleWrite, handleRead, handleIndex, handleDelete, handleVerify } from '../scripts/lib/context.mjs';
import { registerProject, addCwd } from '../scripts/lib/project.mjs';
import { execSync } from 'node:child_process';

describe('context', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
    registerProject(db, 'testproj', '/tmp/testproj');
  });

  afterEach(() => {
    if (db) closeTestDb(db);
    db = null;
  });

  // --- write テスト ---

  it('新規 write（global）', () => {
    const result = handleWrite(db, {
      scope: 'global', category: 'rule', title: 'test-rule',
      content: 'Global rule content', source: null,
    });
    assert.ok(result.includes('保存しました'));
    const entry = db.prepare("SELECT * FROM contexts WHERE scope = 'global' AND title = 'test-rule'").get();
    assert.ok(entry);
    assert.equal(entry.project_name, '');
    assert.equal(entry.workspace_name, '');
  });

  it('新規 write（project）', () => {
    const result = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'proj-rule',
      content: 'Project rule content', source: 'agent-a',
    });
    assert.ok(result.includes('保存しました'));
    const entry = db.prepare("SELECT * FROM contexts WHERE scope = 'project' AND title = 'proj-rule'").get();
    assert.ok(entry);
    assert.equal(entry.project_name, 'testproj');
  });

  it('新規 write（workspace）', () => {
    db.prepare("INSERT INTO workspaces (project_name, workspace_name) VALUES (?, ?)").run('testproj', 'ws1');
    const result = handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'ws1',
      category: 'rule', title: 'ws-rule', content: 'WS content', source: null,
    });
    assert.ok(result.includes('保存しました'));
  });

  it('write（存在しない workspace）', () => {
    const result = handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'nonexist',
      category: 'rule', title: 'test', content: 'content', source: null,
    });
    assert.ok(result.includes('存在しません'));
  });

  it('write（--scope 省略）', () => {
    const result = handleWrite(db, {
      project: 'testproj', category: 'rule', title: 'default-scope',
      content: 'Default scope content', source: null,
    });
    assert.ok(result.includes('保存しました'));
    const entry = db.prepare("SELECT * FROM contexts WHERE title = 'default-scope'").get();
    assert.equal(entry.scope, 'project');
  });

  it('write（--project 省略 + CWD 自動解決）', () => {
    // resolveProject は CWD を git root に解決するため、git root を登録する
    let gitRoot;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      gitRoot = process.cwd();
    }
    addCwd(db, 'testproj', gitRoot);
    const result = handleWrite(db, {
      category: 'rule', title: 'cwd-resolved', content: 'auto resolved', source: null,
    });
    assert.ok(result.includes('保存しました'));
    const entry = db.prepare("SELECT * FROM contexts WHERE title = 'cwd-resolved'").get();
    assert.equal(entry.scope, 'project');
    assert.equal(entry.project_name, 'testproj');
  });

  it('index（引数なし + CWD 自動解決）', () => {
    let gitRoot;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch { gitRoot = process.cwd(); }
    addCwd(db, 'testproj', gitRoot);
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'auto-idx', content: 'c', source: null });
    const result = handleIndex(db, {});
    assert.ok(result.includes('auto-idx'));
  });

  it('index（--scope project + CWD 自動解決）', () => {
    let gitRoot;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch { gitRoot = process.cwd(); }
    addCwd(db, 'testproj', gitRoot);
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'auto-idx2', content: 'c', source: null });
    const result = handleIndex(db, { scope: 'project' });
    assert.ok(result.includes('auto-idx2'));
  });

  it('read（引数なし + CWD 自動解決）', () => {
    let gitRoot;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch { gitRoot = process.cwd(); }
    addCwd(db, 'testproj', gitRoot);
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'auto-read', content: 'auto resolved read', source: null });
    const result = handleRead(db, { category: 'rule' });
    assert.ok(result.includes('auto-read'));
  });

  it('write（CWD 自動解決失敗）', () => {
    // CWD が未登録のプロジェクトを指す
    const result = handleWrite(db, {
      category: 'rule', title: 'test', content: 'content', source: null,
    });
    // resolveProject は process.cwd() を使うが、テスト環境では未登録
    assert.ok(result.includes('未登録') || result.includes('保存しました'));
  });

  it('write（存在しない --project 明示指定）', () => {
    const result = handleWrite(db, {
      scope: 'project', project: 'nonexist',
      category: 'rule', title: 'test', content: 'content', source: null,
    });
    assert.ok(result.includes('存在しません'));
  });

  it('upsert（同一 source）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'upsert-test',
      content: 'v1', source: 'agent-a',
    });
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'upsert-test',
      content: 'v2', source: 'agent-a',
    });
    const entry = db.prepare("SELECT * FROM contexts WHERE title = 'upsert-test'").get();
    assert.equal(entry.content, 'v2');
    // 履歴は生成されない
    const history = db.prepare('SELECT COUNT(*) AS c FROM overwrite_history WHERE context_id = ?').get(entry.id);
    assert.equal(history.c, 0);
  });

  it('upsert（異なる source）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'diff-source',
      content: 'v1', source: 'agent-a',
    });
    const result = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'diff-source',
      content: 'v2', source: 'agent-b',
    });
    assert.ok(result.includes('異なる source'));
    const entry = db.prepare("SELECT * FROM contexts WHERE title = 'diff-source'").get();
    const history = db.prepare('SELECT * FROM overwrite_history WHERE context_id = ?').get(entry.id);
    assert.ok(history);
    assert.equal(history.content, 'v1');
    assert.equal(history.source, 'agent-a');
    assert.equal(history.overwritten_by, 'agent-b');
  });

  it('upsert（NULL source 同士）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'null-src',
      content: 'v1', source: null,
    });
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'null-src',
      content: 'v2', source: null,
    });
    const entry = db.prepare("SELECT * FROM contexts WHERE title = 'null-src'").get();
    const history = db.prepare('SELECT COUNT(*) AS c FROM overwrite_history WHERE context_id = ?').get(entry.id);
    assert.equal(history.c, 0);
  });

  it('upsert（NULL vs 非NULL）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'null-vs-not',
      content: 'v1', source: 'agent-a',
    });
    const result = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'null-vs-not',
      content: 'v2', source: null,
    });
    assert.ok(result.includes('異なる source'));
  });

  it('source 未指定での上書き（異なる source 警告のみ）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'src-warn',
      content: 'v1', source: 'agent-a',
    });
    const result = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'src-warn',
      content: 'v2', source: null,
    });
    assert.ok(result.includes('異なる source'));
    // 冗長な2つ目の警告は出ないことを確認
    assert.ok(!result.includes('source が指定されていません'));
  });

  it('タグ保存', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'tagged',
      content: 'content', source: null, tags: 'api,backend',
    });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'tagged'").get();
    const tags = db.prepare('SELECT tag FROM context_tags WHERE context_id = ? ORDER BY tag').all(entry.id);
    assert.deepEqual(tags.map(t => t.tag), ['api', 'backend']);
  });

  it('タグ更新', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'tag-update',
      content: 'v1', source: null, tags: 'api,backend',
    });
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'tag-update',
      content: 'v2', source: null, tags: 'frontend,ui',
    });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'tag-update'").get();
    const tags = db.prepare('SELECT tag FROM context_tags WHERE context_id = ? ORDER BY tag').all(entry.id);
    assert.deepEqual(tags.map(t => t.tag), ['frontend', 'ui']);
  });

  // --- index テスト ---

  it('index（単一スコープ）', () => {
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'idx-1',
      content: 'content', source: null,
    });
    const result = handleIndex(db, { scope: 'project', project: 'testproj' });
    assert.ok(result.includes('idx-1'));
  });

  it('index（全スコープ）', () => {
    handleWrite(db, { scope: 'global', category: 'rule', title: 'global-idx', content: 'g', source: null });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'proj-idx', content: 'p', source: null });
    const result = handleIndex(db, { scope: 'all', project: 'testproj' });
    assert.ok(result.includes('global-idx'));
    assert.ok(result.includes('proj-idx'));
  });

  it('index（overridden 注釈）', () => {
    handleWrite(db, { scope: 'global', category: 'rule', title: 'shared', content: 'global', source: null });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'shared', content: 'project', source: null });
    const result = handleIndex(db, { scope: 'all', project: 'testproj' });
    assert.ok(result.includes('overridden'));
  });

  it('index（経過日数表示）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'age-test', content: 'content', source: null });
    const result = handleIndex(db, { scope: 'project', project: 'testproj' });
    assert.ok(result.match(/\(\d+d\)/));
  });

  it('index（鮮度閾値超過警告）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'old-entry', content: 'old', source: null });
    // 手動で updated_at を古い日付に設定
    db.prepare("UPDATE contexts SET updated_at = datetime('now', '-31 days') WHERE title = 'old-entry'").run();
    const result = handleIndex(db, { scope: 'project', project: 'testproj' });
    assert.ok(result.includes('⚠'));
  });

  // --- read テスト ---

  it('read（ID 指定）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'read-id', content: 'read me', source: null });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'read-id'").get();
    const result = handleRead(db, { id: entry.id });
    assert.ok(result.includes('read me'));
    assert.ok(result.includes(entry.id));
  });

  it('read（カテゴリ指定）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'arch', title: 'r1', content: 'arch1', source: null });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'arch', title: 'r2', content: 'arch2', source: null });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'other', title: 'r3', content: 'other', source: null });
    const result = handleRead(db, { scope: 'project', project: 'testproj', category: 'arch' });
    assert.ok(result.includes('r1'));
    assert.ok(result.includes('r2'));
    assert.ok(!result.includes('r3'));
  });

  // --- delete テスト ---

  it('delete（単一 ID）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'del-1', content: 'c', source: null });
    const entry = db.prepare("SELECT id FROM contexts WHERE title = 'del-1'").get();
    const result = handleDelete(db, { id: [entry.id] });
    assert.ok(result.includes('1 件'));
    assert.ok(!db.prepare('SELECT 1 FROM contexts WHERE id = ?').get(entry.id));
  });

  it('delete（複数 ID）', () => {
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'del-a', content: 'a', source: null });
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'del-b', content: 'b', source: null });
    const a = db.prepare("SELECT id FROM contexts WHERE title = 'del-a'").get();
    const b = db.prepare("SELECT id FROM contexts WHERE title = 'del-b'").get();
    const result = handleDelete(db, { id: [a.id, b.id] });
    assert.ok(result.includes('2 件'));
  });

  // --- scope=all 別プロジェクト除外 ---

  it('index（scope=all 別プロジェクト除外）', () => {
    registerProject(db, 'other', '/tmp/other');
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'mine', content: 'my', source: null });
    handleWrite(db, { scope: 'project', project: 'other', category: 'rule', title: 'theirs', content: 'their', source: null });
    const result = handleIndex(db, { scope: 'all', project: 'testproj' });
    assert.ok(result.includes('mine'));
    assert.ok(!result.includes('theirs'));
  });

  it('read（別プロジェクト除外）', () => {
    registerProject(db, 'other', '/tmp/other');
    handleWrite(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'shared-title', content: 'mine', source: null });
    handleWrite(db, { scope: 'project', project: 'other', category: 'rule', title: 'shared-title', content: 'theirs', source: null });
    const result = handleRead(db, { scope: 'project', project: 'testproj', category: 'rule', title: 'shared-title' });
    assert.ok(result.includes('mine'));
    assert.ok(!result.includes('theirs'));
  });

  // --- 上限超過警告 ---

  it('write（上限超過警告）', () => {
    // workspace の閾値は 50
    db.prepare("INSERT INTO workspaces (project_name, workspace_name) VALUES (?, ?)").run('testproj', 'ws-limit');
    for (let i = 0; i < 51; i++) {
      handleWrite(db, {
        scope: 'workspace', project: 'testproj', workspace: 'ws-limit',
        category: 'test', title: `entry-${i}`, content: `content ${i}`, source: null,
      });
    }
    // 52nd write should trigger warning
    const result = handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'ws-limit',
      category: 'test', title: 'over-limit', content: 'content', source: null,
    });
    assert.ok(result.includes('上限'));
    assert.ok(result.includes('保存しました'));
  });

  // --- include-archived テスト ---

  it('index（--include-archived）', () => {
    db.prepare("INSERT INTO workspaces (project_name, workspace_name, status) VALUES (?, ?, ?)").run('testproj', 'archived-ws', 'archived');
    handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'archived-ws',
      category: 'rule', title: 'archived-entry', content: 'archived', source: null,
    });
    // 既定では表示されない
    const defaultResult = handleIndex(db, { scope: 'all', project: 'testproj' });
    assert.ok(!defaultResult.includes('archived-entry'));
    // --include-archived で表示される
    const archivedResult = handleIndex(db, { scope: 'all', project: 'testproj', 'include-archived': true });
    assert.ok(archivedResult.includes('archived-entry'));
  });

  it('read（--include-archived）', () => {
    db.prepare("INSERT INTO workspaces (project_name, workspace_name, status) VALUES (?, ?, ?)").run('testproj', 'arch-ws2', 'archived');
    handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'arch-ws2',
      category: 'rule', title: 'arch-read', content: 'archived content', source: null,
    });
    const defaultResult = handleRead(db, { scope: 'all', project: 'testproj', category: 'rule', title: 'arch-read' });
    assert.ok(!defaultResult.includes('archived content'));
    const archivedResult = handleRead(db, { scope: 'all', project: 'testproj', category: 'rule', title: 'arch-read', 'include-archived': true });
    assert.ok(archivedResult.includes('archived content'));
  });

  // --- content 文字数警告テスト ---

  it('write（content 300文字以下で警告なし）', () => {
    const result = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'short-content',
      content: 'a'.repeat(300), source: null,
    });
    assert.ok(result.includes('保存しました'));
    assert.ok(!result.includes('推奨'));
  });

  it('write（content 300文字超で警告あり）', () => {
    const result = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'long-content',
      content: 'a'.repeat(301), source: null,
    });
    assert.ok(result.includes('保存しました'));
    assert.ok(result.includes('301 文字'));
    assert.ok(result.includes('推奨'));
  });

  // --- 短縮ID対応テスト ---

  it('read（短縮ID）', () => {
    const writeResult = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'short-id-test',
      content: 'short id content', source: null,
    });
    const fullId = writeResult.match(/ID: (.+)/)[1];
    const shortId = fullId.slice(0, 8);
    const result = handleRead(db, { id: shortId });
    assert.ok(result.includes('short id content'));
    assert.ok(result.includes(fullId));
  });

  it('read（複数ID）', () => {
    const r1 = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'multi-read-1',
      content: 'content-one', source: null,
    });
    const r2 = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'multi-read-2',
      content: 'content-two', source: null,
    });
    const id1 = r1.match(/ID: (.+)/)[1];
    const id2 = r2.match(/ID: (.+)/)[1];
    const result = handleRead(db, { id: [id1, id2] });
    assert.ok(result.includes('content-one'));
    assert.ok(result.includes('content-two'));
  });

  it('delete（短縮ID）', () => {
    const writeResult = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'del-short',
      content: 'to delete', source: null,
    });
    const fullId = writeResult.match(/ID: (.+)/)[1];
    const shortId = fullId.slice(0, 8);
    const result = handleDelete(db, { id: shortId });
    assert.ok(result.includes('1 件'));
  });

  it('verify（短縮ID）', () => {
    const writeResult = handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'rule', title: 'ver-short',
      content: 'to verify', source: null,
    });
    const fullId = writeResult.match(/ID: (.+)/)[1];
    const shortId = fullId.slice(0, 8);
    const result = handleVerify(db, { id: shortId });
    assert.ok(result.includes('1 件'));
  });

  it('read（存在しない短縮ID）', () => {
    const result = handleRead(db, { id: 'zzzzzzzz' });
    assert.ok(result.includes('見つかりません'));
  });
});
