function buildPageSnapshotExpression() {
  return String.raw`(() => {
    const MAX_TEXT = 180;
    const MAX_LONG_TEXT = 360;
    const MODAL_SELECTOR = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal',
      '.ui-dialog',
      '[class*="modal" i]',
      '[id*="modal" i]',
      '[class*="dialog" i]',
      '[id*="dialog" i]',
      '[class*="popup" i]',
      '[id*="popup" i]'
    ].join(',');

    const normalizeText = (value, limit = MAX_TEXT) => String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);

    const isVisible = element => {
      if (!element || !element.getClientRects) return false;
      const rects = element.getClientRects();
      if (!rects.length) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.contentVisibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    };

    const rectInfo = element => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };

    const ariaLabelledBy = element => {
      const ids = String(element.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .filter(Boolean);
      return normalizeText(ids
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(label => label.innerText || label.textContent)
        .join(' '));
    };

    const associatedLabel = element => {
      if (element.id) {
        const direct = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        if (direct) return normalizeText(direct.innerText || direct.textContent);
      }
      const wrapping = element.closest('label');
      return wrapping ? normalizeText(wrapping.innerText || wrapping.textContent) : '';
    };

    const elementText = element => normalizeText(
      element.getAttribute('aria-label')
        || ariaLabelledBy(element)
        || associatedLabel(element)
        || element.innerText
        || element.textContent
        || element.getAttribute('title')
        || element.getAttribute('alt')
    );

    const isActionable = element => {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role');
      if (['a', 'button', 'input', 'textarea', 'select'].includes(tag)) return true;
      return ['button', 'link', 'checkbox', 'radio', 'combobox', 'textbox', 'menuitem', 'tab'].includes(role);
    };

    const isPanelCandidate = element => {
      if (!isVisible(element)) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 80) return false;
      const style = window.getComputedStyle(element);
      const zIndex = Number.parseInt(style.zIndex, 10);
      const floating = ['fixed', 'absolute', 'sticky'].includes(style.position) || Number.isFinite(zIndex) && zIndex > 0;
      const hasControls = Boolean(element.querySelector('a,button,input,textarea,select,[role]'));
      const hasHeading = Boolean(element.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]'));
      const hasFormFields = Boolean(element.querySelector('input,textarea,select'));
      return hasControls && (floating || hasHeading && hasFormFields);
    };

    const uniqueElements = elements => Array.from(new Set(elements));
    const elementArea = element => {
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const rawModalCandidates = uniqueElements([
      ...Array.from(document.querySelectorAll(MODAL_SELECTOR)),
      ...Array.from(document.querySelectorAll('body *')).filter(isPanelCandidate)
    ]).filter(isVisible);
    const modalCandidates = rawModalCandidates
      .sort((left, right) => elementArea(left) - elementArea(right))
      .filter((candidate, index, candidates) => !candidates
        .slice(0, index)
        .some(selected => candidate.contains(selected)))
      .slice(0, 20);
    const hasModalAncestor = element => modalCandidates
      .some(candidate => candidate === element || candidate.contains(element));

    const optionsPreview = element => {
      if (element.tagName.toLowerCase() !== 'select') return '';
      return Array.from(element.options)
        .slice(0, 20)
        .map(option => normalizeText(option.textContent))
        .filter(Boolean)
        .join(' / ');
    };

    const controlInfo = (element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || '',
      role: element.getAttribute('role') || '',
      id: element.getAttribute('id') || '',
      name: element.getAttribute('name') || '',
      label: associatedLabel(element) || ariaLabelledBy(element) || element.getAttribute('aria-label') || '',
      text: elementText(element),
      title: element.getAttribute('title') || '',
      href: element.tagName.toLowerCase() === 'a' ? element.getAttribute('href') || '' : '',
      placeholder: element.getAttribute('placeholder') || '',
      autocomplete: element.getAttribute('autocomplete') || '',
      optionsPreview: optionsPreview(element),
      visible: isVisible(element),
      inModal: hasModalAncestor(element),
      rect: rectInfo(element)
    });

    const fieldInfo = (element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || '',
      id: element.getAttribute('id') || '',
      name: element.getAttribute('name') || '',
      label: associatedLabel(element) || ariaLabelledBy(element) || element.getAttribute('aria-label') || '',
      placeholder: element.getAttribute('placeholder') || '',
      autocomplete: element.getAttribute('autocomplete') || '',
      optionsPreview: optionsPreview(element),
      visible: isVisible(element),
      inModal: hasModalAncestor(element),
      rect: rectInfo(element)
    });

    const dialogInfo = (element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || '',
      id: element.getAttribute('id') || '',
      className: normalizeText(element.getAttribute('class') || ''),
      text: normalizeText(element.innerText || element.textContent, MAX_LONG_TEXT),
      headings: Array.from(element.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
        .filter(isVisible)
        .slice(0, 12)
        .map(heading => normalizeText(heading.innerText || heading.textContent))
        .filter(Boolean),
      rect: rectInfo(element)
    });

    const cellText = element => normalizeText(element.innerText || element.textContent);
    const tableInfo = (table, index) => ({
      index,
      id: table.getAttribute('id') || '',
      className: normalizeText(table.getAttribute('class') || ''),
      caption: normalizeText(table.caption?.innerText || table.caption?.textContent || ''),
      headers: Array.from(table.querySelectorAll('thead th, tr:first-child th'))
        .slice(0, 40)
        .map(cellText)
        .filter(Boolean),
      rows: Array.from(table.querySelectorAll('tr'))
        .filter(isVisible)
        .slice(0, 30)
        .map((row, rowIndex) => ({
          rowIndex,
          cells: Array.from(row.children)
            .filter(cell => ['TD', 'TH'].includes(cell.tagName))
            .slice(0, 45)
            .map(cellText)
        }))
    });

    const active = document.activeElement && document.activeElement !== document.body
      ? controlInfo(document.activeElement, 0)
      : null;

    return {
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },
      activeElement: active,
      dialogs: modalCandidates.map(dialogInfo),
      controls: Array.from(document.querySelectorAll('a,button,input,textarea,select,[role]'))
        .filter(element => isVisible(element) && isActionable(element))
        .slice(0, 240)
        .map(controlInfo),
      fields: Array.from(document.querySelectorAll('input, textarea, select'))
        .slice(0, 240)
        .map(fieldInfo),
      tables: Array.from(document.querySelectorAll('table'))
        .filter(isVisible)
        .slice(0, 12)
        .map(tableInfo),
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
        .filter(isVisible)
        .slice(0, 40)
        .map((element, index) => ({
          index,
          tag: element.tagName.toLowerCase(),
          text: normalizeText(element.innerText || element.textContent),
          inModal: hasModalAncestor(element),
          rect: rectInfo(element)
        })),
      frameCount: window.frames.length
    };
  })()`;
}

module.exports = {
  buildPageSnapshotExpression,
};
