import { transaction, generateId } from './database.mjs';
import { formatTable, formatError } from './formatter.mjs';

/**
 * history 操作のディスパッチ
 */
export function handleHistory(db, options) {
  if (options.restore) {
    return restoreHistory(db, options);
  }
  if (options.purge) {
    return purgeHistory(db, options);
  }
  if (options.unresolved) {
    return listUnresolved(db, options);
  }
  if (options.id) {
    const ids = [].concat(options.id);
    return listHistoryById(db, ids[0]);
  }
  if (options.project) {
    return listHistoryByProject(db, options.project);
  }
  return formatError('history には --id, --unresolved, --project, --restore, --purge のいずれかを指定してください。');
}

function listHistoryById(db, contextId) {
  const entries = db.prepare(`
    SELECT h.history_id, h.content, h.source, h.overwritten_by, h.overwritten_at
    FROM overwrite_history h
    WHERE h.context_id = ?
    ORDER BY h.overwritten_at DESC
  `).all(contextId);

  if (entries.length === 0) return '該当する履歴はありません。';

  const headers = ['履歴ID', 'ソース', '上書き元', '上書き日時', '内容（先頭50文字）'];
  const rows = entries.map(e => [
    e.history_id.slice(0, 8),
    e.source || '(なし)',
    e.overwritten_by || '(なし)',
    e.overwritten_at,
    e.content.slice(0, 50) + (e.content.length > 50 ? '...' : ''),
  ]);
  return `## 上書き履歴: ${contextId.slice(0, 8)}\n\n` + formatTable(headers, rows);
}

function listUnresolved(db, options) {
  const project = options.project || null;
  const params = [];
  let projectFilter = '';
  if (project) {
    projectFilter = 'AND c.project_name = ?';
    params.push(project);
  }

  const entries = db.prepare(`
    SELECT h.history_id, h.context_id, c.category, c.title, c.scope,
           h.source, h.overwritten_by, h.overwritten_at
    FROM overwrite_history h
    JOIN contexts c ON c.id = h.context_id
    WHERE (c.verified_at IS NULL OR h.overwritten_at >= c.verified_at)
      ${projectFilter}
    ORDER BY h.overwritten_at DESC
  `).all(...params);

  if (entries.length === 0) return '未解決の履歴はありません。';

  const headers = ['履歴ID', 'スコープ', 'カテゴリ', 'タイトル', 'ソース', '上書き元', '上書き日時'];
  const rows = entries.map(e => [
    e.history_id.slice(0, 8),
    e.scope,
    e.category,
    e.title,
    e.source || '(なし)',
    e.overwritten_by || '(なし)',
    e.overwritten_at,
  ]);
  return `## 未解決の上書き履歴 (${entries.length}件)\n\n` + formatTable(headers, rows);
}

function listHistoryByProject(db, project) {
  const entries = db.prepare(`
    SELECT h.history_id, h.context_id, c.category, c.title, c.scope,
           h.source, h.overwritten_by, h.overwritten_at
    FROM overwrite_history h
    JOIN contexts c ON c.id = h.context_id
    WHERE c.project_name = ?
    ORDER BY h.overwritten_at DESC
  `).all(project);

  if (entries.length === 0) return '該当する履歴はありません。';

  const headers = ['履歴ID', 'スコープ', 'カテゴリ', 'タイトル', 'ソース', '上書き元', '上書き日時'];
  const rows = entries.map(e => [
    e.history_id.slice(0, 8),
    e.scope,
    e.category,
    e.title,
    e.source || '(なし)',
    e.overwritten_by || '(なし)',
    e.overwritten_at,
  ]);
  return `## プロジェクト "${project}" の上書き履歴 (${entries.length}件)\n\n` + formatTable(headers, rows);
}

function restoreHistory(db, options) {
  const historyIds = options['history-id'];
  if (!historyIds || historyIds.length === 0) {
    return formatError('--history-id は必須です。');
  }
  const historyId = historyIds[0];
  const source = options.source ?? 'system:restore';

  try {
    transaction(db, () => {
      const hist = db.prepare('SELECT * FROM overwrite_history WHERE history_id = ?').get(historyId);
      if (!hist) throw new Error(`履歴エントリが見つかりません: ${historyId}`);

      const ctx = db.prepare('SELECT * FROM contexts WHERE id = ?').get(hist.context_id);
      if (!ctx) throw new Error(`コンテキストエントリが見つかりません: ${hist.context_id}`);

      // 現在値を新たな履歴として退避
      db.prepare(`
        INSERT INTO overwrite_history (history_id, context_id, content, source, overwritten_by, overwritten_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(generateId(), ctx.id, ctx.content, ctx.source, source);

      // 履歴の内容で現在値を復元
      db.prepare(
        "UPDATE contexts SET content = ?, source = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(hist.content, hist.source, ctx.id);
    });
    return `履歴を復元しました。\n履歴ID: ${historyId.slice(0, 8)}`;
  } catch (e) {
    return formatError(e.message);
  }
}

function purgeHistory(db, options) {
  const historyIds = options['history-id'];
  if (!historyIds || historyIds.length === 0) {
    return formatError('--history-id は必須です。');
  }

  try {
    let deleted = 0;
    transaction(db, () => {
      for (const hid of historyIds) {
        const row = db.prepare(`
          SELECT h.history_id, c.verified_at, h.overwritten_at
          FROM overwrite_history h
          JOIN contexts c ON c.id = h.context_id
          WHERE h.history_id = ?
        `).get(hid);
        if (!row) throw new Error(`履歴エントリが見つかりません: ${hid}`);
        if (row.verified_at === null || row.overwritten_at >= row.verified_at) {
          throw new Error(`未解決の履歴は削除できません: ${hid}`);
        }
        db.prepare('DELETE FROM overwrite_history WHERE history_id = ?').run(hid);
        deleted++;
      }
    });
    return `${deleted} 件の履歴を削除しました。`;
  } catch (e) {
    return formatError(e.message);
  }
}
