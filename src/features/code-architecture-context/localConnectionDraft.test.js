import { selectLocalConnectionDraft } from './localConnectionDraft';

const saved = { id: 'saved-repo', sourceType: 'local', sourceId: 'saved-source', folderName: 'Folder',
  selectedExtensions: ['.cpp'], analysisContext: { text: 'Unattended operation', files: [{ name: 'context.txt', content: 'Evidence' }] },
  operationalContext: 'Saved operating context', lastAnalyzedAt: '2026-10-17' };

test('reuse from a blank form restores settings and context attachments', () => {
  const result = selectLocalConnectionDraft({ sourceType: 'local', analysisContextText: '', selectedExtensions: [] },
    { sourceType: 'local', sourceId: saved.sourceId, folderName: 'Folder' }, [saved]);
  expect(result).toMatchObject({ id: saved.id, selectedExtensions: ['.cpp'], analysisContextText: 'Unattended operation',
    analysisContextFiles: saved.analysisContext.files, operationalContext: saved.operationalContext });
});
test('reconnecting the current draft preserves explicit empty edits', () => {
  const draft = { ...saved, analysisContextText: '', analysisContextFiles: [], selectedExtensions: [] };
  expect(selectLocalConnectionDraft(draft, saved, [saved])).toMatchObject({ analysisContextText: '', analysisContextFiles: [], selectedExtensions: [] });
});
test('a separate same-name source does not inherit settings by name', () => {
  const draft = { analysisContextText: 'New context' };
  expect(selectLocalConnectionDraft(draft, { ...saved, sourceId: 'different' }, [saved])).toMatchObject({ analysisContextText: 'New context', sourceId: 'different' });
});
