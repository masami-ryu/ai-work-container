import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDatabase, closeDatabase } from '../scripts/lib/database.mjs';

/**
 * テスト用 in-memory DB を生成して返す
 */
export function createTestDb() {
  return getDatabase(':memory:');
}

/**
 * WAL mode など :memory: では検証できない機能用
 */
export function createFileDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-test-'));
  const dbPath = join(dir, 'test.db');
  const db = getDatabase(dbPath);
  db._tmpDir = dir;
  return db;
}

export function cleanupFileDb(db) {
  closeDatabase(db);
  if (db._tmpDir) rmSync(db._tmpDir, { recursive: true });
}

/**
 * テスト用 DB をクローズする
 */
export function closeTestDb(db) {
  closeDatabase(db);
}
