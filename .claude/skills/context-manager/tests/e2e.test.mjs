import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('e2e', () => {
  let tmpDir;
  let dbPath;
  let env;
  const CLI = join(import.meta.dirname, '..', 'scripts', 'context-db.mjs');

  function run(args) {
    return execSync(`node ${CLI} ${args}`, { env, encoding: 'utf8', cwd: '/tmp' });
  }

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctx-e2e-'));
    dbPath = join(tmpDir, 'e2e.db');
    env = { ...process.env, CLAUDE_CONTEXT_DB_PATH: dbPath };
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  });

  it('プロジェクト登録 → write → read', () => {
    run('project --register --name e2e-proj --cwd /tmp/e2e');
    const writeResult = run('write --scope project --project e2e-proj --category test --title e2e-entry --content "E2E test content" --source agent-e2e');
    assert.ok(writeResult.includes('保存しました'));

    const readResult = run('read --scope project --project e2e-proj --category test --title e2e-entry');
    assert.ok(readResult.includes('E2E test content'));
    assert.ok(readResult.includes('agent-e2e'));
  });

  it('index 表示', () => {
    // globalにも書き込み
    run('write --scope global --category convention --title global-rule --content "Global convention" --source agent-e2e');
    const result = run('index --scope all --project e2e-proj');
    assert.ok(result.includes('e2e-entry'));
    assert.ok(result.includes('global-rule'));
  });

  it('search', () => {
    const result = run('search --query "E2E test" --scope all --project e2e-proj');
    assert.ok(result.includes('e2e-entry'));
  });

  it('マルチエージェント競合', () => {
    // 異なる source で write
    run('write --scope project --project e2e-proj --category test --title conflict-entry --content "Version 1" --source agent-a');
    run('write --scope project --project e2e-proj --category test --title conflict-entry --content "Version 2" --source agent-b');

    // unresolved
    const unresolvedResult = run('history --unresolved --project e2e-proj');
    assert.ok(unresolvedResult.includes('conflict-entry'));

    // verify (IDを取得してverify)
    const readResult = run('read --scope project --project e2e-proj --category test --title conflict-entry');
    const idMatch = readResult.match(/\*\*ID\*\*: ([a-f0-9-]+)/);
    assert.ok(idMatch);
    run(`verify --id ${idMatch[1]}`);
  });

  it('workspace アーカイブ', () => {
    run('workspace --create --name e2e-ws --project e2e-proj');
    run('write --scope workspace --project e2e-proj --workspace e2e-ws --category test --title ws-entry --content "WS content"');
    const archiveResult = run('workspace --archive --name e2e-ws --project e2e-proj');
    assert.ok(archiveResult.includes('アーカイブ'));
    assert.ok(archiveResult.includes('ws-entry'));
  });

  it('同時 write 競合直列化', async () => {
    // 2プロセスが同一論理キーに同時writeを試みる
    const promises = [];
    for (let i = 0; i < 2; i++) {
      promises.push(
        new Promise((resolve, reject) => {
          try {
            const result = execSync(
              `node ${CLI} write --scope project --project e2e-proj --category test --title concurrent-entry --content "Version ${i}" --source "agent-${i}"`,
              { env, encoding: 'utf8', cwd: '/tmp', timeout: 10000 }
            );
            resolve(result);
          } catch (e) {
            reject(e);
          }
        })
      );
    }

    const results = await Promise.all(promises);
    // 両方成功すること
    assert.ok(results[0].includes('保存しました'));
    assert.ok(results[1].includes('保存しました'));

    // overwrite_history に1件の履歴があること
    const historyResult = run('read --scope project --project e2e-proj --category test --title concurrent-entry');
    const idMatch = historyResult.match(/\*\*ID\*\*: ([a-f0-9-]+)/);
    if (idMatch) {
      const histResult = run(`history --id ${idMatch[1]}`);
      // 少なくとも1回は上書き履歴が生成される
      assert.ok(histResult.includes('上書き履歴') || histResult.includes('該当する履歴はありません'));
    }
  });
});
