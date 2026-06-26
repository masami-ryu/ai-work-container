const fs = require('fs');
const path = require('path');

const { findPageTarget, pageTargets } = require('./cdp-targets');
const { classifyCdpSnapshotError } = require('./command-diagnostics');
const { markdownEscape, pushMarkdownTable } = require('./markdown');
const { resolveAllowedOutputPath } = require('./output-path-policy');
const { buildPageSnapshotExpression } = require('./page-snapshot-expression');
const { summarizePageInfo } = require('./page-summary');

function safeOutputPath(workspaceRoot, filename) {
  return resolveAllowedOutputPath({
    workspaceRoot,
    filename,
    baseDir: 'snapshots',
    extensions: ['.md'],
  }).absolutePath;
}

function rectText(rect) {
  return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : '';
}

async function writeCdpFailureSnapshot({ workspaceRoot, filename, target, failure }) {
  const outputPath = safeOutputPath(workspaceRoot, filename);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const lines = [
    '# CDP Page Snapshot Failed',
    '',
    `- Page URL: ${target.url || ''}`,
    `- Page Title: ${target.title || ''}`,
    `- Target ID: ${target.id || ''}`,
    `- Error Code: ${failure.errorCode}`,
    `- Hint: ${failure.hint}`,
    '',
    '## Error',
    '',
    '```text',
    failure.message,
    '```',
    '',
    '<!-- No input values were captured. -->',
    '',
  ];
  await fs.promises.writeFile(outputPath, lines.join('\n'), 'utf8');
  return path.relative(workspaceRoot, outputPath);
}

function buildCdpSnapshotMarkdown(pageInfo, target) {
  const lines = [
    '# CDP Page Snapshot',
    '',
    `- Page URL: ${pageInfo.url || target.url}`,
    `- Page Title: ${pageInfo.title || target.title || ''}`,
    `- Target ID: ${target.id}`,
    `- Frame Count: ${pageInfo.frameCount ?? ''}`,
    `- Viewport: ${pageInfo.viewport ? `${pageInfo.viewport.width}x${pageInfo.viewport.height} scroll(${pageInfo.viewport.scrollX}, ${pageInfo.viewport.scrollY})` : ''}`,
    '',
    '<!-- Input values are intentionally not captured. Visible text and element metadata are captured for automation authoring. -->',
    '',
  ];

  if (pageInfo.activeElement) {
    lines.push('## Active Element', '');
    lines.push(`- tag: ${markdownEscape(pageInfo.activeElement.tag)}`);
    lines.push(`- id: ${markdownEscape(pageInfo.activeElement.id)}`);
    lines.push(`- name: ${markdownEscape(pageInfo.activeElement.name)}`);
    lines.push(`- role: ${markdownEscape(pageInfo.activeElement.role)}`);
    lines.push(`- label: ${markdownEscape(pageInfo.activeElement.label)}`);
    lines.push(`- text: ${markdownEscape(pageInfo.activeElement.text)}`);
    lines.push(`- inModal: ${markdownEscape(pageInfo.activeElement.inModal)}`);
    lines.push('');
  }

  pushMarkdownTable(
    lines,
    'Visible Dialog Or Modal Candidates',
    ['index', 'tag', 'role', 'id', 'class', 'headings', 'text', 'rect'],
    (pageInfo.dialogs || []).map(dialog => [
      dialog.index,
      dialog.tag,
      dialog.role,
      dialog.id,
      dialog.className,
      (dialog.headings || []).join(' / '),
      dialog.text,
      rectText(dialog.rect),
    ]),
  );

  pushMarkdownTable(
    lines,
    'Visible Actionable Elements',
    ['index', 'tag', 'type', 'role', 'id', 'name', 'label', 'text', 'href', 'placeholder', 'optionsPreview', 'inModal', 'rect'],
    (pageInfo.controls || []).map(control => [
      control.index,
      control.tag,
      control.type,
      control.role,
      control.id,
      control.name,
      control.label,
      control.text,
      control.href,
      control.placeholder,
      control.optionsPreview,
      control.inModal,
      rectText(control.rect),
    ]),
  );

  pushMarkdownTable(
    lines,
    'Form Fields',
    ['index', 'tag', 'type', 'id', 'name', 'label', 'placeholder', 'autocomplete', 'optionsPreview', 'visible', 'inModal', 'rect'],
    (pageInfo.fields || []).map(field => [
      field.index,
      field.tag,
      field.type,
      field.id,
      field.name,
      field.label,
      field.placeholder,
      field.autocomplete,
      field.optionsPreview,
      field.visible,
      field.inModal,
      rectText(field.rect),
    ]),
  );

  pushMarkdownTable(
    lines,
    'Headings',
    ['index', 'tag', 'text', 'inModal', 'rect'],
    (pageInfo.headings || []).map(heading => [
      heading.index,
      heading.tag,
      heading.text,
      heading.inModal,
      rectText(heading.rect),
    ]),
  );

  lines.push('## Visible Tables', '');
  if (!pageInfo.tables?.length) {
    lines.push('_No visible tables captured._', '');
  }
  for (const table of pageInfo.tables || []) {
    lines.push(`### Table ${markdownEscape(table.index)}`, '');
    lines.push(`- id: ${markdownEscape(table.id)}`);
    lines.push(`- class: ${markdownEscape(table.className)}`);
    lines.push(`- caption: ${markdownEscape(table.caption)}`);
    lines.push(`- headers: ${markdownEscape((table.headers || []).join(' / '))}`);
    lines.push('');
    lines.push('| row | cells |');
    lines.push('| --- | --- |');
    for (const row of table.rows || []) {
      lines.push(`| ${markdownEscape(row.rowIndex)} | ${markdownEscape((row.cells || []).join(' / '))} |`);
    }
    if (!table.rows?.length) {
      lines.push('| | |');
    }
    lines.push('');
  }

  return lines.join('\n');
}

function createCdpSnapshotRunner({ workspaceRoot, collectCdpTargets, cdpCommand }) {
  return async function runSharedCdpSnapshot(args) {
    const filename = args[0] || 'snapshots/current.md';
    const urlHint = args[1] || 'salonboard.com';
    const outputPath = safeOutputPath(workspaceRoot, filename);
    const cdpInfo = await collectCdpTargets();
    const target = findPageTarget(cdpInfo, urlHint);
    if (!target?.webSocketDebuggerUrl) {
      return {
        code: 1,
        stdout: `${JSON.stringify({ ok: false, error: `No CDP page target found for ${urlHint}`, cdpPageTargets: pageTargets(cdpInfo) }, null, 2)}\n`,
        stderr: '',
        errorCode: 'NO_CDP_TARGET',
      };
    }

    const expression = buildPageSnapshotExpression();
    let result;
    try {
      result = await cdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
    } catch (error) {
      const failure = classifyCdpSnapshotError(error);
      const output = await writeCdpFailureSnapshot({ workspaceRoot, filename, target, failure });
      return {
        code: 1,
        stdout: `${JSON.stringify({
          ok: false,
          mode: 'cdp',
          selectedTarget: target,
          output,
          errorCode: failure.errorCode,
          hint: failure.hint,
          error: failure.message,
        }, null, 2)}\n`,
        stderr: '',
        errorCode: failure.errorCode,
      };
    }

    const pageInfo = result.result?.value || {};
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, buildCdpSnapshotMarkdown(pageInfo, target), 'utf8');

    return {
      code: 0,
      stdout: `${JSON.stringify({
        ok: true,
        mode: 'cdp',
        selectedTarget: target,
        output: path.relative(workspaceRoot, outputPath),
        page: summarizePageInfo(pageInfo),
      }, null, 2)}\n`,
      stderr: '',
    };
  };
}

module.exports = {
  buildCdpSnapshotMarkdown,
  createCdpSnapshotRunner,
  safeOutputPath,
  writeCdpFailureSnapshot,
};
