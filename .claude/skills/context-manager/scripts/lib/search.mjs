import { buildScopeFilter } from './scope.mjs';
import { formatTable, formatError } from './formatter.mjs';

/**
 * search 操作のディスパッチ
 */
export function handleSearch(db, options) {
  if (options['list-tags']) {
    return listTags(db, options);
  }
  if (!options.query) {
    return formatError('--query または --list-tags は必須です。');
  }
  return searchContexts(db, options);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeLike(str) {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function generateFallbackSnippet(content, query, maxLen = 128) {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  let snippet;
  if (idx >= 0) {
    const start = Math.max(0, idx - 32);
    const end = Math.min(content.length, idx + query.length + maxLen - 32);
    snippet = (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
  } else {
    snippet = content.slice(0, maxLen) + (content.length > maxLen ? '...' : '');
  }
  return snippet.replace(new RegExp(escapeRegExp(query), 'gi'), '**$&**');
}

function daysSince(dateStr) {
  const date = new Date(dateStr + 'Z');
  return Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
}

function searchContexts(db, options) {
  const query = options.query;
  const includeArchived = !!options['include-archived'];
  const scope = options.scope || 'all';
  const projectName = options.project || null;
  const workspaceName = options.workspace || null;

  let entries;

  if (db.ftsEnabled) {
    entries = searchFts(db, query, scope, projectName, workspaceName, includeArchived, options.category, options.tags);
  } else {
    entries = searchFallback(db, query, scope, projectName, workspaceName, includeArchived, options.category, options.tags);
  }

  if (entries.length === 0) return '該当する検索結果はありません。';

  const lines = [`## 検索結果: "${query}" (${entries.length}件)`, ''];
  for (const e of entries) {
    const scopeLabel = e.scope === 'global' ? 'global'
      : e.scope === 'project' ? `project: ${e.project_name}`
      : `workspace: ${e.project_name}/${e.workspace_name}`;
    const days = daysSince(e.updated_at);
    const freshness = days > 30 ? ' ⚠' : '';
    lines.push(`### [${scopeLabel}] ${e.category} / ${e.title}${freshness}`);
    lines.push(`> ${e.snippet}`);
    lines.push(`📅 ${e.updated_at} (${days}d) | 📝 ${e.source || '(なし)'}`);
    lines.push('');
  }

  return lines.join('\n');
}

function searchFts(db, query, scope, projectName, workspaceName, includeArchived, category, tags) {
  const { sql: scopeFilter, params: scopeParams } = buildScopeFilter(
    scope, projectName, workspaceName, includeArchived, 'c'
  );

  let where = scopeFilter;
  const params = [...scopeParams];

  if (category) {
    where += ' AND c.category = ?';
    params.push(category);
  }

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      const placeholders = tagList.map(() => '?').join(',');
      where += ` AND c.id IN (
        SELECT context_id FROM context_tags
        WHERE tag IN (${placeholders})
        GROUP BY context_id
        HAVING COUNT(DISTINCT tag) = ?
      )`;
      params.push(...tagList, tagList.length);
    }
  }

  // FTS5 MATCH
  const ftsQuery = query;
  const entries = db.prepare(`
    SELECT c.id, c.scope, c.project_name, c.workspace_name,
           c.category, c.title, c.updated_at, c.source,
           snippet(contexts_fts, 1, '**', '**', '...', 32) as snippet
    FROM contexts_fts f
    JOIN contexts c ON c.rowid = f.rowid
    WHERE contexts_fts MATCH ?
      AND ${where}
    ORDER BY rank
  `).all(ftsQuery, ...params);

  return entries;
}

function searchFallback(db, query, scope, projectName, workspaceName, includeArchived, category, tags) {
  const { sql: scopeFilter, params: scopeParams } = buildScopeFilter(
    scope, projectName, workspaceName, includeArchived, 'c'
  );

  let where = scopeFilter;
  const params = [...scopeParams];

  const escapedQuery = escapeLike(query);
  where += " AND (c.title LIKE '%' || ? || '%' ESCAPE '\\' OR c.content LIKE '%' || ? || '%' ESCAPE '\\')";
  params.push(escapedQuery, escapedQuery);

  if (category) {
    where += ' AND c.category = ?';
    params.push(category);
  }

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      const placeholders = tagList.map(() => '?').join(',');
      where += ` AND c.id IN (
        SELECT context_id FROM context_tags
        WHERE tag IN (${placeholders})
        GROUP BY context_id
        HAVING COUNT(DISTINCT tag) = ?
      )`;
      params.push(...tagList, tagList.length);
    }
  }

  const entries = db.prepare(`
    SELECT c.id, c.scope, c.project_name, c.workspace_name,
           c.category, c.title, c.content, c.updated_at, c.source
    FROM contexts c
    WHERE ${where}
    ORDER BY c.updated_at DESC
  `).all(...params);

  // スニペット生成
  return entries.map(e => ({
    ...e,
    snippet: generateFallbackSnippet(e.content, query),
  }));
}

function listTags(db, options) {
  const includeArchived = !!options['include-archived'];
  const scope = options.scope || 'all';
  const projectName = options.project || null;
  const workspaceName = options.workspace || null;
  const { sql: scopeFilter, params: scopeParams } = buildScopeFilter(
    scope, projectName, workspaceName, includeArchived, 'c'
  );

  const tags = db.prepare(`
    SELECT ct.tag, COUNT(*) as count
    FROM context_tags ct
    JOIN contexts c ON c.id = ct.context_id
    WHERE ${scopeFilter}
    GROUP BY ct.tag
    ORDER BY count DESC
  `).all(...scopeParams);

  if (tags.length === 0) return 'タグはありません。';

  const lines = [`## タグ一覧 (${tags.length}件)`, ''];
  lines.push(formatTable(['タグ', '件数'], tags.map(t => [t.tag, String(t.count)])));
  return lines.join('\n');
}
