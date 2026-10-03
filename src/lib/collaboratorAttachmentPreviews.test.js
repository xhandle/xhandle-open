import { openRecoveryDatabase } from './durableRecovery';
import { retainAttachmentPreviews, loadAttachmentPreview, deleteAttachmentPreviews } from './collaboratorAttachmentPreviews';
jest.mock('./durableRecovery', () => ({ openRecoveryDatabase: jest.fn() }));
jest.mock('./localBackupEvents', () => ({ notifyBackupDataChanged: jest.fn() }));

let disk;
beforeEach(() => {
  disk = new Map();
  let sequence = 0;
  Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => `preview-${++sequence}` } });
  openRecoveryDatabase.mockImplementation(async () => ({
    close: jest.fn(),
    transaction: () => ({
      done: Promise.resolve(),
      store: { get: async id => disk.get(id), put: async (value, id) => disk.set(id, value), delete: async id => disk.delete(id) },
    }),
  }));
});
const message = { role: 'user', content: 'prompt', attachments: [{ name: 'diagram.png', kind: 'image' }] };
it('stores image content separately and preserves only a reference in chat history', async () => {
  const saved = retainAttachmentPreviews(message, [{ imageDataUrl: 'data:image/png;base64,aGVsbG8=' }]);
  expect(JSON.stringify(saved)).not.toContain('data:image');
  expect((await loadAttachmentPreview(saved.attachments[0])).imageDataUrl).toContain('aGVsbG8=');
  await deleteAttachmentPreviews(saved.attachments);
  expect(await loadAttachmentPreview(saved.attachments[0])).toBeNull();
});
it('keeps complete large text and independent snapshots of edited attachments', async () => {
  const contexts = [{ fileText: 'x'.repeat(90000) }];
  const first = retainAttachmentPreviews(message, contexts);
  contexts[0].fileText = 'edited';
  const second = retainAttachmentPreviews(message, contexts);
  expect((await loadAttachmentPreview(first.attachments[0])).text).toHaveLength(90000);
  expect((await loadAttachmentPreview(second.attachments[0])).text).toBe('edited');
  await deleteAttachmentPreviews([...first.attachments, ...second.attachments]);
});
it('offers session preview if persistence fails and handles legacy chips', async () => {
  openRecoveryDatabase.mockRejectedValue(new Error('Storage unavailable'));
  const saved = retainAttachmentPreviews(message, [{ text: 'still viewable' }]);
  expect((await loadAttachmentPreview(saved.attachments[0])).text).toBe('still viewable');
  expect(await loadAttachmentPreview({ name: 'legacy.txt' })).toBeNull();
  await deleteAttachmentPreviews(saved.attachments);
});
