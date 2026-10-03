import { markdownTablePreview } from './tableMarkdown';
import { tableToMarkdown } from './tableMarkdown';
import { clipboardHtmlToMarkdown } from './markdownClipboard';
import Papa from 'papaparse';

export function buildPastedTextAttachment(value) {
  const text = String(value || '');
  if (!text.trim()) return null;
  const isMarkdown = Boolean(markdownTablePreview(text)) || /^#{1,6}\s|^```/m.test(text);
  return {
    file: {
      name: isMarkdown ? 'pasted-content.md' : 'pasted-content.txt',
      type: isMarkdown ? 'text/markdown' : 'text/plain',
      size: new Blob([text]).size,
    },
    // Pasting changes presentation only: never truncate the user's prompt content.
    fileText: text,
    fileTextTruncated: false,
  };
}

export function readClipboardContent(clipboard) {
  const files = Array.from(clipboard?.files || []);
  if (!files.length) {
    Array.from(clipboard?.items || []).forEach(item => {
      if (item.kind !== 'file') return;
      const file = item.getAsFile?.();
      if (file) files.push(file);
    });
  }
  // File/image representations take precedence over their text/HTML fallbacks.
  if (files.length) return { files, text: '' };
  const plain = clipboard?.getData('text/plain') || '';
  const html = clipboard?.getData('text/html') || '';
  if (html && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('table')) {
      doc.querySelectorAll('table').forEach(table => {
        const rows = Array.from(table.rows).map(row => Array.from(row.cells).map(cell => cell.textContent || ''));
        const width = Math.max(0, ...rows.map(row => row.length));
        if (!width) return;
        const columns = Array.from({ length: width }, (_, key) => ({ key, label: rows[0]?.[key] || `Column ${key + 1}` }));
        table.replaceWith(doc.createTextNode(`\n\n${tableToMarkdown(columns, rows.slice(1))}\n\n`));
      });
      return { files, text: clipboardHtmlToMarkdown(doc.body.innerHTML, doc.body.textContent || plain) };
    }
    return { files, text: clipboardHtmlToMarkdown(html, plain || doc.body.textContent || '') };
  }
  if (plain.includes('\t')) {
    const parsed = Papa.parse(plain, { delimiter: '\t', skipEmptyLines: true });
    const rows = parsed.data;
    if (!parsed.errors.length && rows.length > 1 && rows[0].length > 1 && rows.every(row => row.length === rows[0].length)) {
      return { files, text: tableToMarkdown(rows[0].map((label, key) => ({ key, label })), rows.slice(1)) };
    }
  }
  return { files, text: plain };
}
