import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, closeTestDb } from './helpers.mjs';
import { handleSearch } from '../scripts/lib/search.mjs';
import { handleWrite } from '../scripts/lib/context.mjs';
import { handleWorkspace } from '../scripts/lib/workspace.mjs';
import { registerProject } from '../scripts/lib/project.mjs';

describe('search', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
    registerProject(db, 'testproj', '/tmp/testproj');
  });

  afterEach(() => {
    if (db) closeTestDb(db);
    db = null;
  });

  function seedEntries() {
    handleWrite(db, {
      scope: 'global', category: 'convention', title: 'api-versioning',
      content: 'OpenAPI のバージョニングは URL パスに含める。', source: null, tags: 'api',
    });
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'decision', title: 'api-design',
      content: 'REST API は OpenAPI 3.1 で定義する。', source: 'agent-a', tags: 'api,backend',
    });
    handleWrite(db, {
      scope: 'project', project: 'testproj', category: 'insight', title: 'database-perf',
      content: 'データベースのパフォーマンス最適化にはインデックス設計が重要。', source: 'agent-b', tags: 'database,performance',
    });
  }

  it('FTS5 利用可否判定', () => {
    // db.ftsEnabled は initSchema で設定済み
    assert.equal(typeof db.ftsEnabled, 'boolean');
  });

  it('日本語検索', () => {
    seedEntries();
    const result = handleSearch(db, { query: 'パフォーマンス', scope: 'all', project: 'testproj' });
    assert.ok(result.includes('database-perf'));
  });

  it('英語検索', () => {
    seedEntries();
    const result = handleSearch(db, { query: 'OpenAPI', scope: 'all', project: 'testproj' });
    assert.ok(result.includes('api-design'));
  });

  it('スコープフィルタ', () => {
    seedEntries();
    const result = handleSearch(db, { query: 'OpenAPI', scope: 'global' });
    assert.ok(result.includes('api-versioning'));
    assert.ok(!result.includes('api-design'));
  });

  it('カテゴリフィルタ', () => {
    seedEntries();
    const result = handleSearch(db, { query: 'OpenAPI', scope: 'all', project: 'testproj', category: 'decision' });
    assert.ok(result.includes('api-design'));
    assert.ok(!result.includes('api-versioning'));
  });

  it('タグ AND 検索', () => {
    seedEntries();
    const result = handleSearch(db, { query: 'API', scope: 'all', project: 'testproj', tags: 'api,backend' });
    assert.ok(result.includes('api-design'));
    assert.ok(!result.includes('api-versioning'));
  });

  it('タグ一覧', () => {
    seedEntries();
    const result = handleSearch(db, { 'list-tags': true, scope: 'all', project: 'testproj' });
    assert.ok(result.includes('api'));
    assert.ok(result.includes('backend'));
    assert.ok(result.includes('database'));
  });

  it('タグ一覧（archived 除外）', () => {
    handleWorkspace(db, { create: true, name: 'arch-ws', project: 'testproj' });
    handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'arch-ws',
      category: 'test', title: 'arch-tag-entry', content: 'content', source: null, tags: 'unique-arch-tag',
    });
    handleWorkspace(db, { archive: true, name: 'arch-ws', project: 'testproj' });

    const result = handleSearch(db, { 'list-tags': true, scope: 'all', project: 'testproj' });
    assert.ok(!result.includes('unique-arch-tag'));
  });

  it('タグ一覧（--include-archived）', () => {
    handleWorkspace(db, { create: true, name: 'arch-ws2', project: 'testproj' });
    handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'arch-ws2',
      category: 'test', title: 'arch-tag-entry2', content: 'content', source: null, tags: 'unique-arch-tag2',
    });
    handleWorkspace(db, { archive: true, name: 'arch-ws2', project: 'testproj' });

    const result = handleSearch(db, { 'list-tags': true, scope: 'all', project: 'testproj', 'include-archived': true });
    assert.ok(result.includes('unique-arch-tag2'));
  });

  it('フォールバック検索', () => {
    // FTS無効化のため新しいDBを作成
    const origEnv = process.env.CLAUDE_CONTEXT_DISABLE_FTS;
    process.env.CLAUDE_CONTEXT_DISABLE_FTS = '1';
    try {
      const fbDb = createTestDb();
      assert.equal(fbDb.ftsEnabled, false);
      registerProject(fbDb, 'fbproj', '/tmp/fbproj');
      handleWrite(fbDb, {
        scope: 'project', project: 'fbproj', category: 'test', title: 'fallback-test',
        content: 'フォールバック検索のテストコンテンツです。', source: null,
      });
      const result = handleSearch(fbDb, { query: 'フォールバック', scope: 'project', project: 'fbproj' });
      assert.ok(result.includes('fallback-test'));
      closeTestDb(fbDb);
    } finally {
      if (origEnv === undefined) {
        delete process.env.CLAUDE_CONTEXT_DISABLE_FTS;
      } else {
        process.env.CLAUDE_CONTEXT_DISABLE_FTS = origEnv;
      }
    }
  });

  it('検索ハイライト', () => {
    seedEntries();
    const result = handleSearch(db, { query: 'OpenAPI', scope: 'all', project: 'testproj' });
    // FTS5 snippet() は **太字** でハイライトする
    assert.ok(result.includes('**OpenAPI**') || result.includes('**openapi**'));
  });

  it('フォールバックスニペット', () => {
    const origEnv = process.env.CLAUDE_CONTEXT_DISABLE_FTS;
    process.env.CLAUDE_CONTEXT_DISABLE_FTS = '1';
    try {
      const fbDb = createTestDb();
      registerProject(fbDb, 'fbproj2', '/tmp/fbproj2');
      handleWrite(fbDb, {
        scope: 'project', project: 'fbproj2', category: 'test', title: 'fb-snippet',
        content: 'これはフォールバックスニペットのテストです。前後のコンテキストが含まれるべきです。', source: null,
      });
      const result = handleSearch(fbDb, { query: 'フォールバック', scope: 'project', project: 'fbproj2' });
      assert.ok(result.includes('**フォールバック**'));
      closeTestDb(fbDb);
    } finally {
      if (origEnv === undefined) {
        delete process.env.CLAUDE_CONTEXT_DISABLE_FTS;
      } else {
        process.env.CLAUDE_CONTEXT_DISABLE_FTS = origEnv;
      }
    }
  });

  it('検索結果の経過日数表示', () => {
    seedEntries();
    const result = handleSearch(db, { query: 'OpenAPI', scope: 'all', project: 'testproj' });
    assert.ok(result.match(/\(\d+d\)/));
  });

  it('タグ一覧（CLIサブモード）', () => {
    seedEntries();
    const result = handleSearch(db, { 'list-tags': true, scope: 'all', project: 'testproj' });
    assert.ok(result.includes('タグ一覧'));
    assert.ok(result.includes('件'));
  });

  it('search（--include-archived）', () => {
    handleWorkspace(db, { create: true, name: 'search-arch-ws', project: 'testproj' });
    handleWrite(db, {
      scope: 'workspace', project: 'testproj', workspace: 'search-arch-ws',
      category: 'test', title: 'search-archived-entry', content: 'アーカイブされた検索テスト', source: null,
    });
    handleWorkspace(db, { archive: true, name: 'search-arch-ws', project: 'testproj' });

    // デフォルトでは検索結果に含まれない
    const defaultResult = handleSearch(db, { query: 'アーカイブされた', scope: 'all', project: 'testproj' });
    assert.ok(!defaultResult.includes('search-archived-entry'));

    // --include-archived で含まれる
    const archivedResult = handleSearch(db, { query: 'アーカイブされた', scope: 'all', project: 'testproj', 'include-archived': true });
    assert.ok(archivedResult.includes('search-archived-entry'));
  });
});
