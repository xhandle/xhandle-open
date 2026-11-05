import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { replaceTextDiagram } from '../../components/reportDiagramModel';
import { GENERATED_REPORT_DB, blockGeneratedReportWrites, deleteGeneratedReport, listGeneratedReports,
  openGeneratedReportDatabase, preserveLegacyGeneratedReport, readGeneratedReport, saveGeneratedReport } from './generatedReportStorage';

beforeEach(() => {
  global.structuredClone = (value) => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  localStorage.clear();
});
afterEach(() => jest.restoreAllMocks());
const input = { report: '# Saved report\n\nEvidence.', reportType: 'Subsystem Design Document', functionalDiagramImage: 'data:image/png;base64,c2F2ZWQ=' };

test('saves separate immutable versions including their own diagram snapshots', async () => {
  const first = await saveGeneratedReport('p', input);
  const second = await saveGeneratedReport('p', { ...input, report: '# New report', functionalDiagramImage: 'data:image/png;base64,bmV3' });
  expect(first.libraryId).not.toBe(second.libraryId);
  expect(await readGeneratedReport('p', first.libraryId)).toMatchObject(input);
  expect(await readGeneratedReport('p', second.libraryId)).toMatchObject({ report: '# New report', functionalDiagramImage: 'data:image/png;base64,bmV3' });
  expect(localStorage.length).toBe(0);
});

test('a graphical conversion saves a new report version and preserves the original ASCII report', async () => {
  const ascii = '+-------+\n| QIBUS |\n+-------+';
  const original = '# Report\n\n```text\n' + ascii + '\n```\n\nFindings.';
  const old = await saveGeneratedReport('p', { ...input, report: original });
  const graph = { title: 'QIBUS', direction: 'LR', notes: [], nodes: [{ id: 'qibus', label: 'QIBUS' }], edges: [] };
  const graphical = replaceTextDiagram(original, ascii, graph);
  const next = await saveGeneratedReport('p', { ...input, report: graphical });
  expect(await listGeneratedReports('p')).toHaveLength(2);
  expect((await readGeneratedReport('p', old.libraryId)).report).toBe(original);
  expect((await readGeneratedReport('p', next.libraryId)).report).toContain('```xhandle-diagram');
  expect((await readGeneratedReport('p', next.libraryId)).functionalDiagramImage).toBe(input.functionalDiagramImage);
});

test('lists metadata without reading report bodies, diagrams, or source-analysis state', async () => {
  const saved = await saveGeneratedReport('p', { ...input, state: { summarySheet: [['PRIVATE SOURCE']] } });
  const read = IDBObjectStore.prototype.get;
  jest.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function(key) {
    if (this.name === 'reports') throw new Error('Library must not read bodies while listing');
    return read.call(this, key);
  });
  const rows = await listGeneratedReports('p');
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(saved.libraryId);
  expect(rows[0].report).toBeUndefined(); expect(rows[0].functionalDiagramImage).toBeUndefined(); expect(rows[0].state).toBeUndefined();
});

test('keeps project libraries and body reads isolated, including numeric project zero', async () => {
  const a = await saveGeneratedReport('a', input);
  await saveGeneratedReport(0, { report: '# Zero' });
  expect(await listGeneratedReports('b')).toEqual([]);
  expect(await readGeneratedReport('b', a.libraryId)).toBeNull();
  expect(await deleteGeneratedReport('b', a.libraryId)).toBe(false);
  expect(await listGeneratedReports(0)).toHaveLength(1);
});

test('legacy migration is idempotent and does not overwrite other versions', async () => {
  const [a, b] = await Promise.all([preserveLegacyGeneratedReport('p', input), preserveLegacyGeneratedReport('p', input)]);
  expect(a.libraryId).toBe(b.libraryId);
  await preserveLegacyGeneratedReport('p', { report: '# Another legacy report' });
  expect(await listGeneratedReports('p')).toHaveLength(2);
  await expect(saveGeneratedReport('p', { report: 'Overwrite' }, { id: a.libraryId })).rejects.toThrow();
  expect((await readGeneratedReport('p', a.libraryId)).report).toBe(input.report);
});

test('a failed write never leaves a library row without its report', async () => {
  const add = IDBObjectStore.prototype.add;
  jest.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(value, key) {
    if (this.name === 'metadata') throw new Error('Simulated quota failure');
    return key === undefined ? add.call(this, value) : add.call(this, value, key);
  });
  await expect(saveGeneratedReport('p', input)).rejects.toThrow('Simulated quota failure');
  const db = await openGeneratedReportDatabase();
  expect(await db.count('metadata')).toBe(0); expect(await db.count('reports')).toBe(0); db.close();
});

test('delete removes report content and retains only a marker preventing stale-cache resurrection', async () => {
  const saved = await saveGeneratedReport('p', input);
  await expect(deleteGeneratedReport('p', saved.libraryId)).resolves.toBe(true);
  expect(await readGeneratedReport('p', saved.libraryId)).toBeNull();
  expect(await listGeneratedReports('p')).toEqual([]);
  expect(await preserveLegacyGeneratedReport('p', saved)).toMatchObject({ deleted: true });
  const db = await openGeneratedReportDatabase();
  const marker = await db.get('metadata', saved.libraryId);
  expect(marker.title).toBeUndefined(); expect(marker.report).toBeUndefined();
  expect(marker.functionalDiagramImage).toBeUndefined(); db.close();
});

test('completed and explicitly incomplete reports retain their status across fresh connections', async () => {
  const saved = await saveGeneratedReport('p', { ...input, status: 'draft' });
  expect((await readGeneratedReport('p', saved.libraryId)).status).toBe('draft');
  expect((await listGeneratedReports('p'))[0].status).toBe('draft');
});

test('permanent project cleanup blocks late report saves and can release the block on failure', async () => {
  await blockGeneratedReportWrites('removed');
  await expect(saveGeneratedReport('removed', input)).rejects.toThrow('no longer available');
  await blockGeneratedReportWrites('removed', false);
  await expect(saveGeneratedReport('removed', input)).resolves.toMatchObject({ report: input.report });
});

test('blocked or missing storage fails visibly rather than claiming a report is saved', async () => {
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  await expect(saveGeneratedReport('p', input)).rejects.toThrow();
});

test('library metadata and documents use a named backup-compatible database', async () => {
  const db = await openGeneratedReportDatabase();
  expect(db.name).toBe(GENERATED_REPORT_DB);
  expect([...db.objectStoreNames]).toEqual(['metadata', 'reports']);
  for (const name of db.objectStoreNames) expect([...db.transaction(name).store.indexNames]).toEqual(['projectId']);
  db.close();
});

test('the existing backup download and restore includes library versions and diagram images', async () => {
  const saved = await saveGeneratedReport('p', input);
  const { backupNow, restoreFromBackupFile } = require('../../lib/localBackupService');
  const { Blob: NodeBlob } = require('buffer');
  let downloaded;
  jest.spyOn(window, 'Blob').mockImplementation((parts, options) => new NodeBlob(parts, options));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn((blob) => { downloaded = blob; return 'blob:fixture'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await backupNow({ mode: 'download' });
  const text = await downloaded.text();
  expect(text).toContain(GENERATED_REPORT_DB);
  expect(text).toContain(input.functionalDiagramImage);
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  const timeout = global.setTimeout;
  jest.spyOn(global, 'setTimeout').mockImplementation((callback, ms, ...args) => ms === 150 ? 0 : timeout(callback, ms, ...args));
  await restoreFromBackupFile({ text: async () => text });
  expect(await readGeneratedReport('p', saved.libraryId)).toMatchObject(input);
});
