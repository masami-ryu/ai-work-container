/**
 * Markdown テーブルを生成
 * @param {string[]} headers
 * @param {string[][]} rows
 */
export function formatTable(headers, rows) {
  if (rows.length === 0) return '(データなし)';
  const sep = headers.map(() => '---');
  const lines = [
    '| ' + headers.join(' | ') + ' |',
    '| ' + sep.join(' | ') + ' |',
    ...rows.map(r => '| ' + r.join(' | ') + ' |'),
  ];
  return lines.join('\n');
}

/**
 * 箇条書きリストを生成
 * @param {string[]} items
 */
export function formatList(items) {
  if (items.length === 0) return '(データなし)';
  return items.map(i => `- ${i}`).join('\n');
}

/**
 * 警告メッセージ
 * @param {string} message
 */
export function formatWarning(message) {
  return `⚠ ${message}`;
}

/**
 * エラーメッセージ
 * @param {string} message
 */
export function formatError(message) {
  return `❌ ${message}`;
}
