import { markdownTablePreview, tableToMarkdown } from './tableMarkdown';

test('copies headers and cells without letting punctuation break table structure', () => {
  const columns = [{ key: 'name', label: 'Function' }, { key: 'detail', label: 'Details' }];
  expect(tableToMarkdown(columns, [{ name: 'A | B', detail: '**literal**\n<node> & \\path' }, { name: 'Empty' }]))
    .toBe('| Function | Details |\n| --- | --- |\n| A \\| B | \\*\\*literal\\*\\* &lt;node&gt; &amp; \\\\path |\n| Empty |  |');
});

test('array-backed hazard rows retain false and zero values', () => {
  expect(tableToMarkdown([{ key: 0, label: 'Applicable' }, { key: 1, label: 'Score' }], [[false, 0]]))
    .toBe('| Applicable | Score |\n| --- | --- |\n| false | 0 |');
});

test('previews only ten data rows while preserving the full copied prompt', () => {
  const markdown = tableToMarkdown([{ key: 'name', label: 'Function' }], Array.from({ length: 50 }, (_, index) => ({ name: `Row ${index + 1}` })));
  const preview = markdownTablePreview(`Please review:\n\n${markdown}\n\nFocus on safety.`);
  expect(preview.truncated).toBe(true);
  expect(preview.markdown.split('\n')).toHaveLength(12);
  expect(preview.markdown).toContain('| Row 10 |');
  expect(preview.markdown).not.toContain('| Row 11 |');
  expect(markdown).toContain('| Row 50 |');
  expect(markdownTablePreview('Ordinary prompt without a table.')).toBeNull();
});

test('copies computed display values only when requested', () => {
  const getValue = jest.fn(({ row }) => row.names.join(', '));
  const columns = [{ label: 'Names', getValue }];
  expect(getValue).not.toHaveBeenCalled();
  expect(tableToMarkdown(columns, [{ row: { names: ['A', 'B'] } }]))
    .toBe('| Names |\n| --- |\n| A, B |');
});
