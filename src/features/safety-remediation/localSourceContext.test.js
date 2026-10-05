import { buildSourceSnippetsForPatch } from './safetyRemediationSourceContext';
import { enrichHazardTableRowsWithSourceContent } from '../code-architecture-hazard-analysis/codeArchitectureHazardSourceAudit';
const source = { sourceType: 'local', sourceId: 'folder-id', snapshotId: 'snapshot-id', folderName: 'folder' };
afterEach(() => jest.restoreAllMocks());
it('uses local embedded evidence without consulting GitHub or the active IDE workspace', async () => {
  global.fetch = jest.fn(() => { throw new Error('Unexpected network access'); });
  const result = await buildSourceSnippetsForPatch({ repoMeta: source, codeReferences: [{ ...source, filePath: 'main.js', symbolName: 'run', startLine: 1, endLine: 1, content: 'function run() {}' }] });
  expect(JSON.stringify(result)).toContain('function run()');
  expect(global.fetch).not.toHaveBeenCalled();
});
it('looks up hazard source using the exact local snapshot without owner/repo', async () => {
  const loadSourceRecord = jest.fn(async () => ({ ...source, path: 'main.js', content: 'function run() {}', sourceFunctions: [{ ...source, filePath: 'main.js', functionName: 'run', startLine: 1, endLine: 1 }] }));
  const result = await enrichHazardTableRowsWithSourceContent([{ from: 'run', fromFile: 'main.js' }], source, { loadSourceRecord, allSourceRecords: [] });
  expect(loadSourceRecord).toHaveBeenCalledWith({ ...source, filePath: 'main.js' });
  expect(result[0].codeEvidence.files[0]).toMatchObject({ ...source, content: 'function run() {}' });
});
