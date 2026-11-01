function markdownEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function pushMarkdownTable(lines, title, headers, rows) {
  lines.push(`## ${title}`, '');
  lines.push(`| ${headers.map(markdownEscape).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  if (rows.length === 0) {
    lines.push(`| ${headers.map(() => '').join(' | ')} |`);
  } else {
    for (const row of rows) {
      lines.push(`| ${row.map(markdownEscape).join(' | ')} |`);
    }
  }
  lines.push('');
}

module.exports = {
  markdownEscape,
  pushMarkdownTable,
};
