function summarizeText(value, limit = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function summarizeRect(rect) {
  if (!rect) return null;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function summarizeControl(control) {
  if (!control) return null;
  return {
    tag: control.tag,
    type: control.type,
    role: control.role,
    id: control.id,
    name: control.name,
    label: summarizeText(control.label),
    text: summarizeText(control.text),
    inModal: Boolean(control.inModal),
    rect: summarizeRect(control.rect),
  };
}

function summarizePageInfo(pageInfo) {
  const controls = pageInfo.controls || [];
  const fields = pageInfo.fields || [];
  const dialogs = pageInfo.dialogs || [];
  const headings = pageInfo.headings || [];
  const tables = pageInfo.tables || [];

  return {
    url: pageInfo.url,
    title: pageInfo.title,
    viewport: pageInfo.viewport || null,
    frameCount: pageInfo.frameCount ?? null,
    counts: {
      dialogs: dialogs.length,
      controls: controls.length,
      fields: fields.length,
      tables: tables.length,
      headings: headings.length,
    },
    activeElement: summarizeControl(pageInfo.activeElement),
    headings: headings.slice(0, 10).map(heading => ({
      text: summarizeText(heading.text),
      inModal: Boolean(heading.inModal),
      rect: summarizeRect(heading.rect),
    })),
    dialogs: dialogs.slice(0, 6).map(dialog => ({
      tag: dialog.tag,
      role: dialog.role,
      id: dialog.id,
      className: summarizeText(dialog.className, 120),
      headings: (dialog.headings || []).slice(0, 6).map(heading => summarizeText(heading)),
      text: summarizeText(dialog.text, 240),
      rect: summarizeRect(dialog.rect),
    })),
    controls: controls.slice(0, 20).map(summarizeControl),
    tables: tables.slice(0, 6).map(table => ({
      id: table.id,
      className: summarizeText(table.className, 120),
      caption: summarizeText(table.caption, 120),
      headers: (table.headers || []).slice(0, 40).map(header => summarizeText(header, 80)),
      rowCount: (table.rows || []).length,
      firstRows: (table.rows || []).slice(0, 3).map(row => ({
        rowIndex: row.rowIndex,
        cells: (row.cells || []).slice(0, 45).map(cell => summarizeText(cell, 80)),
      })),
    })),
    detailOmittedFromResponse: true,
  };
}

module.exports = {
  summarizeControl,
  summarizePageInfo,
  summarizeRect,
  summarizeText,
};
