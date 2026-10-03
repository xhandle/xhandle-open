import { buildPastedTextAttachment, readClipboardContent } from './pastedTextAttachment';

test('all nonempty text pastes become attachments', () => {
  expect(buildPastedTextAttachment('A short prompt').fileText).toBe('A short prompt');
  expect(buildPastedTextAttachment(' '.repeat(5000))).toBeNull();
  expect(buildPastedTextAttachment('x'.repeat(3999)).fileText).toHaveLength(3999);
  expect(buildPastedTextAttachment('x'.repeat(4000)).file.name).toBe('pasted-content.txt');
  expect(buildPastedTextAttachment(Array(50).fill('line').join('\n')).file.name).toBe('pasted-content.txt');
});

test('pasted Markdown retains every row and Unicode character beyond the uploaded-file preview limit', () => {
  const text = '| Name | Details |\n| --- | --- |\n' + '| 車 | A → B |\n'.repeat(10000);
  const attachment = buildPastedTextAttachment(text);
  expect(attachment.file.name).toBe('pasted-content.md');
  expect(attachment.file.type).toBe('text/markdown');
  expect(attachment.file.size).toBe(new Blob([text]).size);
  expect(attachment.fileText).toBe(text);
  expect(attachment.fileTextTruncated).toBe(false);
});

const clipboard = (plain = '', html = '', files = [], items = []) => ({
  getData: type => type === 'text/html' ? html : plain, files, items,
});
test('HTML tables and spreadsheet tabular text become Markdown tables', () => {
  const html = '<p>Review this:</p><table><tr><th>Action</th><th>Details</th></tr><tr><td>A | B</td><td>Keep <b>clear</b></td></tr></table>';
  const rich = readClipboardContent(clipboard('flattened fallback', html));
  expect(rich.text).toContain('Review this:');
  expect(rich.text).toContain('| Action | Details |\n| --- | --- |\n| A \\| B | Keep clear |');
  expect(buildPastedTextAttachment(rich.text).file.name).toBe('pasted-content.md');
  expect(readClipboardContent(clipboard('Action\tDetails\nStop\tHold')).text).toBe('| Action | Details |\n| --- | --- |\n| Stop | Hold |');
});
test('clipboard images and files take precedence over duplicate text representations', () => {
  const file = new File(['image'], 'screenshot.png', {type:'image/png'});
  const item = {kind:'file',getAsFile:()=>file};
  expect(readClipboardContent(clipboard('fallback','',[file],[item]))).toEqual({files:[file],text:''});
  expect(readClipboardContent(clipboard('fallback','',[],[item]))).toEqual({files:[file],text:''});
  expect(readClipboardContent(clipboard('', '', [], [{kind:'file',getAsFile:()=>null}])).files).toEqual([]);
});
