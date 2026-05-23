import { resolveProject } from './project.mjs';
import { formatTable } from './formatter.mjs';

/**
 * clean 操作
 */
export function handleClean(db, options) {
  const days = parseInt(options.days, 10) || 30;
  let project = options.project || null;
  if (!project) {
    project = resolveProject(db, process.cwd());
  }

  const staleEntries = findStaleEntries(db, days, project);
  const resolvedHistory = findResolvedHistory(db, days, project);

  if (staleEntries.length === 0 && resolvedHistory.length === 0) {
    return 'クリーン候補はありません。';
  }

  const lines = ['## クリーン候補', ''];

  if (staleEntries.length > 0) {
    lines.push(`### 鮮度閾値超過エントリ（${staleEntries.length}件）`, '');
    const headers = ['ID', 'スコープ', 'カテゴリ', 'タイトル', '最終更新', '経過日数'];
    const now = new Date();
    const rows = staleEntries.map(e => {
      const days = Math.floor((now - new Date(e.updated_at + 'Z')) / (1000 * 60 * 60 * 24));
      return [
        e.id.slice(0, 8),
        e.scope,
        e.category,
        e.title,
        e.updated_at,
        `${days}d`,
      ];
    });
    lines.push(formatTable(headers, rows));
    lines.push('', 'エントリを削除するには: `node context-db.mjs delete --id <id>`');
  }

  if (resolvedHistory.length > 0) {
    lines.push('', `### 解決済み上書き履歴（${resolvedHistory.length}件）`, '');
    const headers = ['履歴ID', 'カテゴリ', 'タイトル', '上書き日時', '検証日時'];
    const rows = resolvedHistory.map(h => [
      h.history_id.slice(0, 8),
      h.category,
      h.title,
      h.overwritten_at,
      h.verified_at,
    ]);
    lines.push(formatTable(headers, rows));
    lines.push('', '履歴を削除するには: `node context-db.mjs history --purge --history-id <hid>`');
  }

  return lines.join('\n');
}

function findStaleEntries(db, days, project) {
  const modifier = `-${days} days`;
  const params = [];
  let projectFilter = '';
  if (project) {
    projectFilter = 'AND project_name = ?';
    params.push(project);
  }
  params.push(modifier, modifier);

  return db.prepare(`
    SELECT id, scope, project_name, workspace_name, category, title,
           created_at, updated_at, verified_at
    FROM contexts
    WHERE 1=1
      ${projectFilter}
      AND (
        updated_at < datetime('now', ?)
        OR
        (verified_at IS NULL AND created_at < datetime('now', ?))
      )
    ORDER BY updated_at ASC
  `).all(...params);
}

function findResolvedHistory(db, days, project) {
  const modifier = `-${days} days`;
  const params = [modifier];
  let projectFilter = '';
  if (project) {
    projectFilter = 'AND c.project_name = ?';
    params.push(project);
  }

  return db.prepare(`
    SELECT h.history_id, h.context_id, c.category, c.title,
           h.overwritten_at, c.verified_at
    FROM overwrite_history h
    JOIN contexts c ON c.id = h.context_id
    WHERE c.verified_at IS NOT NULL
      AND h.overwritten_at < c.verified_at
      AND h.overwritten_at < datetime('now', ?)
      ${projectFilter}
    ORDER BY h.overwritten_at ASC
  `).all(...params);
}
