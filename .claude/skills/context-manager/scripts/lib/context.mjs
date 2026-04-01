import { transaction, generateId } from './database.mjs';
import { validateScope, workspaceExists, buildScopeFilter } from './scope.mjs';
import { resolveProject, projectExists } from './project.mjs';
import { formatTable, formatWarning, formatError } from './formatter.mjs';

// エントリ上限閾値（FR-CLEAN-02）
const SCOPE_LIMITS = {
  global: 100,
  project: 200,
  workspace: 50,
};

// content 文字数の推奨上限
const CONTENT_LENGTH_WARN = 300;

function isSameSource(existingSource, newSource) {
  if (existingSource === null && newSource === null) return true;
  if (existingSource === null || newSource === null) return false;
  return existingSource === newSource;
}

function saveOverwriteHistory(db, contextId, oldContent, oldSource, newSource) {
  db.prepare(`
    INSERT INTO overwrite_history (history_id, context_id, content, source, overwritten_by, overwritten_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(generateId(), contextId, oldContent, oldSource, newSource);
}

/**
 * write 操作
 */
export function handleWrite(db, options) {
  const { category, title, content, tags, source } = options;
  if (!category || !title || !content) {
    return formatError('--category, --title, --content は必須です。');
  }

  // デフォルトスコープ + プロジェクト自動解決
  let scope = options.scope || 'project';
  let projectName = options.project || null;
  let workspaceName = options.workspace || null;

  if ((scope === 'project' || scope === 'workspace') && !projectName) {
    projectName = resolveProject(db, process.cwd());
    if (!projectName) {
      return formatError('プロジェクトが未登録です。先に project --register で登録してください。');
    }
  }

  // プロジェクト存在確認
  if ((scope === 'project' || scope === 'workspace') && !projectExists(db, projectName)) {
    return formatError(`プロジェクト '${projectName}' が存在しません。先に project --register で登録してください。`);
  }

  // スコープ検証
  let validated;
  try {
    validated = validateScope(scope, projectName, workspaceName);
  } catch (e) {
    return formatError(e.message);
  }

  // ワークスペース存在確認
  if (scope === 'workspace' && !workspaceExists(db, validated.project_name, validated.workspace_name)) {
    return formatError(`ワークスペース '${validated.workspace_name}' が存在しません。`);
  }

  const warnings = [];

  const result = transaction(db, () => {
    // 既存エントリ検索
    const existing = db.prepare(`
      SELECT id, content, source FROM contexts
      WHERE scope = ? AND project_name = ? AND workspace_name = ?
        AND category = ? AND title = ?
    `).get(scope, validated.project_name, validated.workspace_name, category, title);

    let id;

    if (existing) {
      id = existing.id;
      // source 比較
      if (!isSameSource(existing.source, source)) {
        saveOverwriteHistory(db, existing.id, existing.content, existing.source, source);
        warnings.push(formatWarning(
          `異なる source による上書きを検出しました（${existing.source || '(なし)'} → ${source || '(なし)'}）。履歴を保存しました。`
        ));
      }
      // source 未指定 × 既存 source あり
      if (source === null && existing.source !== null) {
        warnings.push(formatWarning(
          `既存エントリに source "${existing.source}" が設定されていますが、新規 write では source が指定されていません。`
        ));
      }

      // UPDATE
      db.prepare(`
        UPDATE contexts SET content = ?, source = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(content, source, existing.id);
    } else {
      // INSERT
      id = generateId();
      db.prepare(`
        INSERT INTO contexts (id, scope, project_name, workspace_name, category, title, content, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, scope, validated.project_name, validated.workspace_name, category, title, content, source);
    }

    // タグ処理
    if (tags) {
      db.prepare('DELETE FROM context_tags WHERE context_id = ?').run(id);
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      const insertTag = db.prepare('INSERT INTO context_tags (context_id, tag) VALUES (?, ?)');
      for (const tag of tagList) {
        insertTag.run(id, tag);
      }
    }

    return id;
  });

  // content 文字数チェック
  if (content.length > CONTENT_LENGTH_WARN) {
    warnings.push(formatWarning(
      `content が ${content.length} 文字です（推奨: ${CONTENT_LENGTH_WARN} 以下）。抽象度を上げることを検討してください。`
    ));
  }

  // エントリ上限チェック
  const limit = SCOPE_LIMITS[scope];
  if (limit) {
    const { cnt } = db.prepare(
      'SELECT COUNT(*) AS cnt FROM contexts WHERE scope = ? AND project_name = ? AND workspace_name = ?'
    ).get(scope, validated.project_name, validated.workspace_name);
    if (cnt > limit) {
      warnings.push(formatWarning(
        `${scope} スコープのエントリ数が上限 (${limit}) を超過しています（現在: ${cnt}）。clean の実行を推奨します。`
      ));
    }
  }

  const output = [`コンテキストを保存しました。`, `ID: ${result}`];
  if (warnings.length > 0) {
    output.push('', ...warnings);
  }
  return output.join('\n');
}

/**
 * read 操作
 */
export function handleRead(db, options) {
  const includeArchived = !!options['include-archived'];

  if (options.id) {
    const ids = [].concat(options.id);
    const entry = db.prepare(`
      SELECT c.*, GROUP_CONCAT(t.tag, ', ') AS tags
      FROM contexts c
      LEFT JOIN context_tags t ON c.id = t.context_id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(ids[0]);
    if (!entry) return formatError(`ID "${ids[0]}" が見つかりません。`);
    return formatEntry(entry);
  }

  // カテゴリ / タイトル / スコープ指定
  const scope = options.scope || 'all';
  const projectName = options.project || null;
  const workspaceName = options.workspace || null;
  const { sql: scopeFilter, params: scopeParams } = buildScopeFilter(
    scope, projectName, workspaceName, includeArchived, 'c'
  );

  let where = scopeFilter;
  const params = [...scopeParams];

  if (options.category) {
    where += ' AND c.category = ?';
    params.push(options.category);
  }
  if (options.title) {
    where += ' AND c.title = ?';
    params.push(options.title);
  }

  const entries = db.prepare(`
    SELECT c.*, GROUP_CONCAT(t.tag, ', ') AS tags
    FROM contexts c
    LEFT JOIN context_tags t ON c.id = t.context_id
    WHERE ${where}
    GROUP BY c.id
    ORDER BY c.scope, c.category, c.title
  `).all(...params);

  if (entries.length === 0) return '該当するエントリはありません。';
  return entries.map(formatEntry).join('\n---\n');
}

/**
 * index 操作
 */
export function handleIndex(db, options) {
  const includeArchived = !!options['include-archived'];
  const scope = options.scope || 'all';
  const projectName = options.project || null;
  const workspaceName = options.workspace || null;
  const { sql: scopeFilter, params: scopeParams } = buildScopeFilter(
    scope, projectName, workspaceName, includeArchived, 'c'
  );

  let where = scopeFilter;
  const params = [...scopeParams];

  if (options.category) {
    where += ' AND c.category = ?';
    params.push(options.category);
  }

  const entries = db.prepare(`
    SELECT c.id, c.scope, c.project_name, c.workspace_name,
           c.category, c.title, c.source, c.updated_at, c.verified_at, c.created_at,
           GROUP_CONCAT(t.tag, ', ') AS tags
    FROM contexts c
    LEFT JOIN context_tags t ON c.id = t.context_id
    WHERE ${where}
    GROUP BY c.id
    ORDER BY c.scope, c.category, c.title
  `).all(...params);

  if (entries.length === 0) return '該当するエントリはありません。';

  const now = new Date();
  const headers = ['ID', 'スコープ', 'カテゴリ', 'タイトル', '経過日数', 'タグ', '注釈'];
  const rows = entries.map(e => {
    const days = daysSince(e.updated_at, now);
    const freshnessMark = days > 30 ? ' ⚠' : '';
    const overridden = checkOverridden(db, e, scope, projectName, workspaceName);
    return [
      e.id.slice(0, 8),
      e.scope,
      e.category,
      e.title,
      `(${days}d)${freshnessMark}`,
      e.tags || '',
      overridden ? 'overridden' : '',
    ];
  });

  return formatTable(headers, rows);
}

/**
 * delete 操作
 */
export function handleDelete(db, options) {
  if (!options.id) return formatError('--id は必須です。');
  const ids = [].concat(options.id);
  let deleted = 0;
  transaction(db, () => {
    for (const id of ids) {
      const { changes } = db.prepare('DELETE FROM contexts WHERE id = ?').run(id);
      deleted += changes;
    }
  });
  return `${deleted} 件のエントリを削除しました。`;
}

/**
 * verify 操作
 */
export function handleVerify(db, options) {
  if (!options.id) return formatError('--id は必須です。');
  const ids = [].concat(options.id);
  let verified = 0;
  transaction(db, () => {
    for (const id of ids) {
      const { changes } = db.prepare(`
        UPDATE contexts SET verified_at = datetime('now') WHERE id = ?
      `).run(id);
      verified += changes;
    }
  });
  return `${verified} 件のエントリを検証済みにしました。`;
}

// --- ヘルパー ---

function formatEntry(entry) {
  const lines = [
    `## ${entry.title}`,
    '',
    `- **ID**: ${entry.id}`,
    `- **スコープ**: ${entry.scope}`,
  ];
  if (entry.project_name) lines.push(`- **プロジェクト**: ${entry.project_name}`);
  if (entry.workspace_name) lines.push(`- **ワークスペース**: ${entry.workspace_name}`);
  lines.push(
    `- **カテゴリ**: ${entry.category}`,
    `- **ソース**: ${entry.source || '(なし)'}`,
    `- **作成日時**: ${entry.created_at}`,
    `- **更新日時**: ${entry.updated_at}`,
    `- **検証日時**: ${entry.verified_at || '(未検証)'}`,
  );
  if (entry.tags) lines.push(`- **タグ**: ${entry.tags}`);
  lines.push('', entry.content);
  return lines.join('\n');
}

function daysSince(dateStr, now) {
  const date = new Date(dateStr + 'Z');
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}

/**
 * 下位スコープで同じ category+title が存在するかチェック
 */
function checkOverridden(db, entry, scope, projectName, workspaceName) {
  if (entry.scope === 'workspace') return false;
  if (entry.scope === 'global' && projectName) {
    const overrider = db.prepare(`
      SELECT 1 FROM contexts
      WHERE category = ? AND title = ? AND project_name = ?
        AND scope IN ('project', 'workspace')
    `).get(entry.category, entry.title, projectName);
    if (overrider) return true;
  }
  if (entry.scope === 'project') {
    const overrider = workspaceName
      ? db.prepare(`
          SELECT 1 FROM contexts
          WHERE category = ? AND title = ? AND project_name = ?
            AND workspace_name = ? AND scope = 'workspace'
        `).get(entry.category, entry.title, entry.project_name, workspaceName)
      : db.prepare(`
          SELECT 1 FROM contexts
          WHERE category = ? AND title = ? AND project_name = ?
            AND scope = 'workspace'
        `).get(entry.category, entry.title, entry.project_name);
    if (overrider) return true;
  }
  return false;
}
