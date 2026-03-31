import { execSync } from 'node:child_process';
import { transaction } from './database.mjs';
import { formatTable, formatError } from './formatter.mjs';

/**
 * プロジェクト登録 + CWD マッピング
 */
export function registerProject(db, name, cwd) {
  const existing = db.prepare('SELECT 1 FROM projects WHERE project_name = ?').get(name);
  if (existing) {
    return formatError(`プロジェクト "${name}" は既に登録されています。`);
  }
  transaction(db, () => {
    db.prepare('INSERT INTO projects (project_name) VALUES (?)').run(name);
    if (cwd) {
      db.prepare('INSERT INTO project_cwd_mappings (cwd, project_name) VALUES (?, ?)').run(cwd, name);
    }
  });
  return `プロジェクト "${name}" を登録しました。` + (cwd ? `\nCWD: ${cwd}` : '');
}

/**
 * CWD マッピング追加
 */
export function addCwd(db, name, cwd) {
  const existing = db.prepare('SELECT 1 FROM projects WHERE project_name = ?').get(name);
  if (!existing) {
    return formatError(`プロジェクト "${name}" が見つかりません。`);
  }
  db.prepare(
    'INSERT OR REPLACE INTO project_cwd_mappings (cwd, project_name) VALUES (?, ?)'
  ).run(cwd, name);
  return `CWD "${cwd}" を "${name}" に追加しました。`;
}

/**
 * プロジェクト一覧
 */
export function listProjects(db) {
  const projects = db.prepare(`
    SELECT p.project_name, p.created_at,
           GROUP_CONCAT(m.cwd, ', ') AS cwds
    FROM projects p
    LEFT JOIN project_cwd_mappings m ON p.project_name = m.project_name
    GROUP BY p.project_name
    ORDER BY p.project_name
  `).all();

  if (projects.length === 0) {
    return '登録済みプロジェクトはありません。';
  }

  const headers = ['プロジェクト名', 'CWD', '登録日時'];
  const rows = projects.map(p => [
    p.project_name,
    p.cwds || '(なし)',
    p.created_at,
  ]);
  return formatTable(headers, rows);
}

/**
 * プロジェクト削除（CASCADE 手動実装）
 */
export function deleteProject(db, name) {
  const existing = db.prepare('SELECT 1 FROM projects WHERE project_name = ?').get(name);
  if (!existing) {
    return formatError(`プロジェクト "${name}" が見つかりません。`);
  }
  transaction(db, () => {
    // FK チェックを COMMIT まで遅延（workspaces 自己参照 FK 対策）
    db.exec('PRAGMA defer_foreign_keys = ON');
    // 1. overwrite_history（context_id 経由）
    db.prepare(`
      DELETE FROM overwrite_history WHERE context_id IN (
        SELECT id FROM contexts WHERE project_name = ?
      )
    `).run(name);
    // 2. context_tags（context_id 経由）
    db.prepare(`
      DELETE FROM context_tags WHERE context_id IN (
        SELECT id FROM contexts WHERE project_name = ?
      )
    `).run(name);
    // 3. contexts
    db.prepare('DELETE FROM contexts WHERE project_name = ?').run(name);
    // 4. workspaces（defer_foreign_keys により親子順序を問わず一括削除可能）
    db.prepare('DELETE FROM workspaces WHERE project_name = ?').run(name);
    // 5. project_cwd_mappings
    db.prepare('DELETE FROM project_cwd_mappings WHERE project_name = ?').run(name);
    // 6. projects
    db.prepare('DELETE FROM projects WHERE project_name = ?').run(name);
  });
  return `プロジェクト "${name}" を削除しました。`;
}

/**
 * CWD からプロジェクト自動解決（FR-SKILL-03）
 * 1. git root に解決
 * 2. 完全一致で検索
 * 3. パス境界付き前方一致（最長一致）
 * 4. null を返す
 */
export function resolveProject(db, cwd) {
  if (!cwd) return null;

  // git root に解決
  let resolvedCwd = cwd;
  try {
    resolvedCwd = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // 非 git ディレクトリ → cwd をそのまま使用
  }

  // 完全一致
  const exact = db.prepare(
    'SELECT project_name FROM project_cwd_mappings WHERE cwd = ?'
  ).get(resolvedCwd);
  if (exact) return exact.project_name;

  // パス境界付き前方一致（最長一致）
  const prefix = db.prepare(`
    SELECT project_name FROM project_cwd_mappings
    WHERE ? LIKE cwd || '/%'
    ORDER BY LENGTH(cwd) DESC
    LIMIT 1
  `).get(resolvedCwd);
  if (prefix) return prefix.project_name;

  return null;
}

/**
 * プロジェクト存在チェック
 */
export function projectExists(db, name) {
  return !!db.prepare('SELECT 1 FROM projects WHERE project_name = ?').get(name);
}
