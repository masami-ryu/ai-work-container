import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, closeTestDb } from './helpers.mjs';
import {
  registerProject, addCwd, listProjects, deleteProject,
  resolveProject, projectExists,
} from '../scripts/lib/project.mjs';
import { generateId } from '../scripts/lib/database.mjs';

describe('project', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    if (db) closeTestDb(db);
    db = null;
  });

  it('プロジェクト登録', () => {
    const result = registerProject(db, 'myproj', '/tmp/myproj');
    assert.ok(result.includes('登録しました'));
    assert.ok(projectExists(db, 'myproj'));
  });

  it('重複登録エラー', () => {
    registerProject(db, 'myproj', '/tmp/myproj');
    const result = registerProject(db, 'myproj', '/tmp/other');
    assert.ok(result.includes('既に登録'));
  });

  it('CWD マッピング追加', () => {
    registerProject(db, 'myproj', '/tmp/myproj');
    const result = addCwd(db, 'myproj', '/tmp/myproj2');
    assert.ok(result.includes('追加しました'));
    // 2 つの CWD がマッピングされていること
    const mappings = db.prepare(
      'SELECT cwd FROM project_cwd_mappings WHERE project_name = ?'
    ).all('myproj');
    assert.equal(mappings.length, 2);
  });

  it('CWD 自動解決（完全一致）', () => {
    registerProject(db, 'myproj', '/tmp/myproj');
    const name = resolveProject(db, '/tmp/myproj');
    assert.equal(name, 'myproj');
  });

  it('CWD 自動解決（前方一致）', () => {
    registerProject(db, 'myproj', '/tmp/myproj');
    // worktree パス: /tmp/myproj/worktree-1
    const name = resolveProject(db, '/tmp/myproj/worktree-1');
    assert.equal(name, 'myproj');
  });

  it('CWD 自動解決（パス境界）', () => {
    registerProject(db, 'app', '/repo/app');
    registerProject(db, 'app-docs', '/repo/app-docs');
    // /repo/app-docs は /repo/app のプレフィックス一致してはならない
    const name = resolveProject(db, '/repo/app-docs');
    assert.equal(name, 'app-docs');
  });

  it('CWD 自動解決（最長一致）', () => {
    registerProject(db, 'parent', '/repo');
    registerProject(db, 'child', '/repo/sub');
    addCwd(db, 'child', '/repo/sub');
    // /repo/sub/child は /repo/sub に最長一致
    const name = resolveProject(db, '/repo/sub/child');
    assert.equal(name, 'child');
  });

  it('一覧表示', () => {
    registerProject(db, 'proj1', '/tmp/proj1');
    registerProject(db, 'proj2', '/tmp/proj2');
    const result = listProjects(db);
    assert.ok(result.includes('proj1'));
    assert.ok(result.includes('proj2'));
  });

  it('CASCADE 削除', () => {
    registerProject(db, 'myproj', '/tmp/myproj');
    // コンテキストを追加
    db.prepare(`
      INSERT INTO contexts (id, scope, project_name, workspace_name, category, title, content)
      VALUES (?, 'project', ?, '', 'test', 'test', 'content')
    `).run(generateId(), 'myproj');

    const result = deleteProject(db, 'myproj');
    assert.ok(result.includes('削除しました'));

    // 全データが削除されていること
    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM projects WHERE project_name = ?').get('myproj').c,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM contexts WHERE project_name = ?').get('myproj').c,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM project_cwd_mappings WHERE project_name = ?').get('myproj').c,
      0
    );
  });

  it('CASCADE 削除（親子 WS）', () => {
    registerProject(db, 'myproj', '/tmp/myproj');
    // 親子ワークスペースを作成
    db.prepare(`
      INSERT INTO workspaces (project_name, workspace_name) VALUES (?, ?)
    `).run('myproj', 'parent-ws');
    db.prepare(`
      INSERT INTO workspaces (project_name, workspace_name, parent_workspace_name) VALUES (?, ?, ?)
    `).run('myproj', 'child-ws', 'parent-ws');

    const result = deleteProject(db, 'myproj');
    assert.ok(result.includes('削除しました'));

    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM workspaces WHERE project_name = ?').get('myproj').c,
      0
    );
  });
});
