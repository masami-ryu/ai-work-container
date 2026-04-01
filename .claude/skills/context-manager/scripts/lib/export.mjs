/**
 * export 操作: コンテキストを HTML / JSON / Markdown 形式でエクスポート
 */
import { writeFileSync } from 'node:fs';
import { buildScopeFilter } from './scope.mjs';
import { resolveProject, projectExists } from './project.mjs';
import { formatTable, formatError } from './formatter.mjs';

/**
 * エントリ一覧を取得（index と同等のクエリ + content を含む）
 */
function fetchEntries(db, projectName, includeArchived) {
  const { sql: scopeFilter, params } = buildScopeFilter(
    'all', projectName, null, includeArchived, 'c'
  );
  return db.prepare(`
    SELECT c.*, GROUP_CONCAT(t.tag, ', ') AS tags
    FROM contexts c
    LEFT JOIN context_tags t ON c.id = t.context_id
    WHERE ${scopeFilter}
    GROUP BY c.id
    ORDER BY c.scope, c.category, c.title
  `).all(...params);
}

function daysSince(dateStr) {
  const date = new Date(dateStr + 'Z');
  return Math.floor((Date.now() - date) / (1000 * 60 * 60 * 24));
}

function groupByCategory(entries) {
  const groups = {};
  for (const e of entries) {
    if (!groups[e.category]) groups[e.category] = [];
    groups[e.category].push(e);
  }
  return groups;
}

function uniqueTags(entries) {
  const set = new Set();
  for (const e of entries) {
    if (e.tags) e.tags.split(', ').forEach(t => set.add(t));
  }
  return [...set].sort();
}

// ─── ラベル定義 ───

const LABELS = {
  ja: {
    title: 'コンテキストダッシュボード',
    project: 'プロジェクト',
    scope: 'スコープ',
    entries: 'エントリ数',
    categories: 'カテゴリ数',
    tags: 'タグ数',
    freshness: '鮮度',
    days: '日',
    lastUpdated: '最終更新',
    category: 'カテゴリ',
    id: 'ID',
    titleCol: 'タイトル',
    elapsed: '経過日数',
    tag: 'タグ',
    note: '注釈',
    content: '内容',
    scopeCol: 'スコープ',
    catNames: {
      'tech-stack': '技術スタック',
      architecture: 'アーキテクチャ',
      domain: 'ドメイン知識',
      decision: '技術的決定',
      convention: '開発規約',
      reference: '参照情報',
      insight: '知見',
      caveat: '注意事項',
      todo: 'TODO',
    },
  },
  en: {
    title: 'Context Dashboard',
    project: 'Project',
    scope: 'Scope',
    entries: 'Entries',
    categories: 'Categories',
    tags: 'Tags',
    freshness: 'Freshness',
    days: 'd',
    lastUpdated: 'Last updated',
    category: 'Category',
    id: 'ID',
    titleCol: 'Title',
    elapsed: 'Age',
    tag: 'Tags',
    note: 'Note',
    content: 'Content',
    scopeCol: 'Scope',
    catNames: {
      'tech-stack': 'Tech Stack',
      architecture: 'Architecture',
      domain: 'Domain',
      decision: 'Decisions',
      convention: 'Conventions',
      reference: 'References',
      insight: 'Insights',
      caveat: 'Caveats',
      todo: 'TODO',
    },
  },
};

// ─── カテゴリカラー ───

const CATEGORY_COLORS = {
  'tech-stack':   { bg: 'rgba(108,140,255,.15)', fg: '#6c8cff', icon: '\u2699' },
  architecture:   { bg: 'rgba(167,139,250,.15)', fg: '#a78bfa', icon: '\u25C6' },
  domain:         { bg: 'rgba(74,222,128,.15)',  fg: '#4ade80', icon: '\u25CF' },
  decision:       { bg: 'rgba(251,191,36,.15)',  fg: '#fbbf24', icon: '\u2713' },
  convention:     { bg: 'rgba(34,211,238,.15)',  fg: '#22d3ee', icon: '\u2605' },
  reference:      { bg: 'rgba(251,146,60,.15)',  fg: '#fb923c', icon: '\u2192' },
  insight:        { bg: 'rgba(244,114,182,.15)', fg: '#f472b6', icon: '\u2731' },
  caveat:         { bg: 'rgba(248,113,113,.15)', fg: '#f87171', icon: '\u26A0' },
  todo:           { bg: 'rgba(156,163,175,.15)', fg: '#9ca3af', icon: '\u2610' },
};

function getColor(category) {
  return CATEGORY_COLORS[category] || { bg: 'rgba(156,163,175,.15)', fg: '#9ca3af', icon: '\u2022' };
}

// ─── JSON 形式 ───

function toJSON(entries, projectName) {
  return JSON.stringify({
    project: projectName,
    exportedAt: new Date().toISOString(),
    count: entries.length,
    entries: entries.map(e => ({
      id: e.id,
      scope: e.scope,
      category: e.category,
      title: e.title,
      content: e.content,
      tags: e.tags ? e.tags.split(', ') : [],
      source: e.source,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      verifiedAt: e.verified_at,
    })),
  }, null, 2);
}

// ─── Markdown 形式 ───

function toMarkdown(entries, projectName, lang) {
  const L = LABELS[lang];
  const groups = groupByCategory(entries);
  const tags = uniqueTags(entries);
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`# ${projectName} ${L.title}`);
  lines.push('');
  lines.push(`> ${L.entries}: ${entries.length} | ${L.categories}: ${Object.keys(groups).length} | ${L.tags}: ${tags.length} | ${L.lastUpdated}: ${today}`);
  lines.push('');

  for (const [cat, items] of Object.entries(groups)) {
    const catLabel = L.catNames[cat] || cat;
    lines.push(`## ${catLabel} (${items.length})`);
    lines.push('');
    for (const e of items) {
      const d = daysSince(e.updated_at);
      const tagStr = e.tags ? ` \`${e.tags}\`` : '';
      lines.push(`### ${e.title}`);
      lines.push('');
      lines.push(`- **ID**: \`${e.id.slice(0, 8)}\` | **${L.scopeCol}**: ${e.scope} | **${L.elapsed}**: ${d}${L.days}${tagStr}`);
      lines.push('');
      lines.push(e.content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── HTML 形式 ───

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toHTML(entries, projectName, lang) {
  const L = LABELS[lang];
  const groups = groupByCategory(entries);
  const tags = uniqueTags(entries);
  const today = new Date().toISOString().slice(0, 10);
  const minAge = entries.length > 0
    ? Math.min(...entries.map(e => daysSince(e.updated_at)))
    : 0;

  // カテゴリごとのパネル HTML を生成
  let panelsHTML = '';
  for (const [cat, items] of Object.entries(groups)) {
    const color = getColor(cat);
    const catLabel = L.catNames[cat] || cat;
    let cardsHTML = '';
    for (const e of items) {
      const d = daysSince(e.updated_at);
      const fresh = d > 30 ? ' \u26A0' : '';
      const tagHTML = e.tags
        ? e.tags.split(', ').map(t => `<span class="tag">${esc(t)}</span>`).join('')
        : '';
      const contentLines = esc(e.content).replace(/\n/g, '<br>');
      cardsHTML += `
        <div class="ctx-card">
          <div class="ctx-title">
            <span class="id-badge">${esc(e.id.slice(0, 8))}</span>
            ${esc(e.title)}
            <span class="scope-badge">${esc(e.scope)}</span>
            <span class="age">${d}${L.days}${fresh}</span>
          </div>
          <div class="ctx-content">${contentLines}</div>
          ${tagHTML ? `<div class="ctx-tags">${tagHTML}</div>` : ''}
        </div>`;
    }

    panelsHTML += `
      <div class="panel">
        <div class="panel-header">
          <div class="icon" style="background:${color.bg};color:${color.fg};">${color.icon}</div>
          ${esc(catLabel)} (${items.length})
        </div>
        <div class="panel-body">${cardsHTML}</div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(projectName)} ${esc(L.title)}</title>
<style>
  :root {
    --bg:#0f1117; --surface:#1a1d27; --surface2:#242836; --border:#2e3346;
    --text:#e1e4ed; --text-dim:#8b8fa7; --accent:#6c8cff;
    --accent-glow:rgba(108,140,255,.15);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI','Hiragino Sans',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
  .header{padding:32px 40px 24px;border-bottom:1px solid var(--border)}
  .header h1{font-size:28px;font-weight:700;letter-spacing:-.5px}
  .header h1 span{color:var(--accent)}
  .header .subtitle{color:var(--text-dim);font-size:14px;margin-top:4px}
  .stats{display:flex;gap:16px;padding:20px 40px;flex-wrap:wrap}
  .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 24px;min-width:140px;flex:1}
  .stat-card .label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)}
  .stat-card .value{font-size:32px;font-weight:700;margin-top:4px}
  .stat-card .value.c1{color:#6c8cff} .stat-card .value.c2{color:#4ade80}
  .stat-card .value.c3{color:#a78bfa} .stat-card .value.c4{color:#fbbf24}
  .grid{padding:24px 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:20px}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}
  .panel-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px}
  .panel-header .icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
  .panel-body{padding:16px 20px}
  .ctx-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px;transition:border-color .2s}
  .ctx-card:last-child{margin-bottom:0}
  .ctx-card:hover{border-color:var(--accent)}
  .ctx-title{font-weight:600;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .ctx-content{font-size:12.5px;color:var(--text-dim);line-height:1.7}
  .ctx-tags{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
  .tag{font-size:10px;padding:2px 8px;border-radius:99px;font-weight:500;background:var(--accent-glow);color:var(--accent);border:1px solid rgba(108,140,255,.25)}
  .id-badge{font-size:10px;font-family:monospace;color:var(--text-dim);background:var(--bg);padding:1px 6px;border-radius:4px}
  .scope-badge{font-size:10px;padding:2px 8px;border-radius:99px;background:rgba(167,139,250,.1);color:#a78bfa;border:1px solid rgba(167,139,250,.2)}
  .age{font-size:10px;color:var(--text-dim);margin-left:auto}
  @media(max-width:600px){.grid{padding:16px;grid-template-columns:1fr}.header,.stats{padding-left:16px;padding-right:16px}}
</style>
</head>
<body>
<div class="header">
  <h1><span>${esc(projectName)}</span> ${esc(L.title)}</h1>
  <div class="subtitle">${L.project}: ${esc(projectName)} &mdash; ${L.scope}: all &mdash; ${entries.length} ${L.entries.toLowerCase()} &mdash; ${L.lastUpdated}: ${today}</div>
</div>
<div class="stats">
  <div class="stat-card"><div class="label">${esc(L.entries)}</div><div class="value c1">${entries.length}</div></div>
  <div class="stat-card"><div class="label">${esc(L.categories)}</div><div class="value c2">${Object.keys(groups).length}</div></div>
  <div class="stat-card"><div class="label">${esc(L.tags)}</div><div class="value c3">${tags.length}</div></div>
  <div class="stat-card"><div class="label">${esc(L.freshness)}</div><div class="value c4">${minAge}${L.days}</div></div>
</div>
<div class="grid">
${panelsHTML}
</div>
</body>
</html>`;
}

// ─── ハンドラー ───

export function handleExport(db, options) {
  const format = options.format || 'html';
  const lang = options.lang || 'ja';
  const includeArchived = !!options['include-archived'];

  if (!['html', 'json', 'md'].includes(format)) {
    return formatError(`--format は html, json, md のいずれかを指定してください（指定値: ${format}）`);
  }
  if (!LABELS[lang]) {
    return formatError(`--lang は ja, en のいずれかを指定してください（指定値: ${lang}）`);
  }

  let projectName = options.project || null;
  if (!projectName) {
    projectName = resolveProject(db, process.cwd());
    if (!projectName) {
      return formatError('プロジェクトが未登録です。--project を指定するか、先に project --register で登録してください。');
    }
  }
  if (!projectExists(db, projectName)) {
    return formatError(`プロジェクト '${projectName}' が存在しません。`);
  }

  const entries = fetchEntries(db, projectName, includeArchived);
  if (entries.length === 0) {
    return formatError('エクスポート対象のエントリがありません。');
  }

  let content;
  let ext;
  switch (format) {
    case 'json':
      content = toJSON(entries, projectName);
      ext = 'json';
      break;
    case 'md':
      content = toMarkdown(entries, projectName, lang);
      ext = 'md';
      break;
    case 'html':
    default:
      content = toHTML(entries, projectName, lang);
      ext = 'html';
      break;
  }

  if (options.output) {
    writeFileSync(options.output, content, 'utf-8');
    return `エクスポートしました: ${options.output} (${entries.length} エントリ, ${format} 形式)`;
  }

  // --output 未指定時は標準出力
  return content;
}
