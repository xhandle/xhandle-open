export const QUICK_SEARCH_COLLECT = 'xhandle:quick-search-collect';

export const normalizeSearchText = value => String(value || '').replace(/\s+/g, ' ').trim();

export function isSearchVisible(element) {
  if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  return element.getClientRects().length > 0
    || (style.display === 'contents' && isSearchVisible(element.parentElement));
}

// Read the displayed value, not all descendants' textContent (which includes
// every select option and a textarea's original, possibly stale, value).
export function searchCellText(element, visible = isSearchVisible) {
  const parts = [];
  const visit = node => {
    if (node.nodeType === 3) { parts.push(node.textContent); return; }
    if (node.nodeType !== 1 || !visible(node)) return;
    const tag = node.tagName;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'OPTION'].includes(tag)) return;
    if (tag === 'SELECT') {
      parts.push(...Array.from(node.selectedOptions).map(option => option.label));
      return;
    }
    if (tag === 'TEXTAREA') { parts.push(node.value); return; }
    if (tag === 'INPUT') {
      if (['hidden', 'password', 'button', 'submit', 'reset', 'image'].includes(node.type)) return;
      parts.push(['checkbox', 'radio'].includes(node.type)
        ? (node.checked ? 'Checked' : 'Unchecked') : node.value);
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(element);
  return normalizeSearchText(parts.join(' '));
}

export function tableSearchEntries(root = document) {
  const entries = [];
  // A scan is a read-only snapshot; cache visibility only for its duration.
  const visibility = new WeakMap();
  const visible = element => {
    if (!visibility.has(element)) visibility.set(element, isSearchVisible(element));
    return visibility.get(element);
  };
  root.querySelectorAll('table, [role="table"], [role="grid"]').forEach((table, tableIndex) => {
    if (!visible(table) || table.closest('[data-quick-search]')) return;
    const caption = table.querySelector('caption');
    const label = table.getAttribute('aria-label') || (caption && searchCellText(caption, visible))
      || normalizeSearchText(Array.from(table.querySelectorAll('thead th')).slice(0, 3).map(th => searchCellText(th, visible)).join(' · '))
      || `Table ${tableIndex + 1}`;
    table.querySelectorAll('tbody tr, [role="row"]').forEach((row, rowIndex) => {
      if (row.closest('table, [role="table"], [role="grid"]') !== table || !visible(row)) return;
      const cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]')).filter(visible);
      if (!cells.length) return;
      const parts = cells.map(cell => searchCellText(cell, visible));
      const text = parts.filter(Boolean).join(' · ');
      if (text) entries.push({
        id: `table-${tableIndex}-${rowIndex}`, kind: 'Table row',
        label: normalizeSearchText(label), text,
        activate(query) {
          if (!row.isConnected) return;
          const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
          const index = parts.findIndex(part => terms.some(term => part.toLowerCase().includes(term)));
          const cell = cells[Math.max(index, 0)];
          cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          row.classList.remove('xhandle-search-hit');
          void row.offsetWidth;
          row.classList.add('xhandle-search-hit');
        },
      });
    });
  });
  return entries;
}

export function filterSearchEntries(entries, query) {
  const terms = normalizeSearchText(query).toLowerCase().split(' ').filter(Boolean);
  if (!terms.length) return [];
  return entries.filter(entry => {
    const text = `${entry.label} ${entry.text}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
}
