export function tableToMarkdown(columns, rows) {
  const cell = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\|`*_[\]])/g, '\\$1')
    .replace(/[\r\n\t]+/g, ' ');
  const line = values => `| ${values.map(cell).join(' | ')} |`;
  return [
    line(columns.map(column => column.label)),
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(row => line(columns.map(column => row[column.key]))),
  ].join('\n');
}

// Bound preview rendering for large pasted analyses; the prompt retains every row.
export function markdownTablePreview(text, limit = 10) {
  const lines = String(text || '').split(/\r?\n/);
  const separator = lines.findIndex((line, index) => index > 0
    && lines[index - 1].trim().startsWith('|')
    && /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line));
  if (separator < 0) return null;
  let end = separator + 1;
  while (end < lines.length && lines[end].trim().startsWith('|')) end += 1;
  const count = end - separator - 1;
  return {
    markdown: lines.slice(separator - 1, Math.min(end, separator + 1 + limit)).join('\n'),
    truncated: count > limit,
  };
}
