import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {serialize, deserialize} from 'v8';
import {openDB, unwrap} from 'idb';
import {readStoragePage, deleteStorageRecords} from './storageCategoryItems';

beforeEach(() => {global.indexedDB = new IDBFactory(); global.structuredClone = value => deserialize(serialize(value));});
async function fixture() {
  return openDB('labels', 1, {upgrade(db) {
    db.createObjectStore('hazardAnalysisRuns', {keyPath: 'id'});
    db.createObjectStore('runMetadata', {keyPath: 'id'});
    db.createObjectStore('rows');
  }});
}
test('hazard pages join bounded metadata across projects and preserve deletion keys', async () => {
  const db = await fixture();
  try {
    await db.put('hazardAnalysisRuns', {id: 'uuid-a', payload: 'private analysis'});
    await db.put('hazardAnalysisRuns', {id: 'uuid-b', payload: 'private analysis'});
    await db.put('hazardAnalysisRuns', {id: 'uuid-c', payload: 'private analysis'});
    await db.put('runMetadata', {id: 'uuid-a', projectId: 'p-a', repoId: 'r-a', updatedAt: '2026-10-27T12:00:00Z'});
    await db.put('runMetadata', {id: 'uuid-b', projectId: 'p-b', repoId: 'r-b'});
    const context = {category: 'Hazard analyses', projects: [
      {id: 'p-a', name: 'Localization', repos: [{id: 'r-a', owner: 'org', repo: 'source'}]},
      {id: 'p-b', name: 'Manpads', repos: [{id: 'r-b', repoName: 'second/source'}]},
    ]};
    const raw = unwrap(db);
    const get = jest.spyOn(IDBObjectStore.prototype, 'get');
    const cursor = jest.spyOn(IDBObjectStore.prototype, 'openCursor');
    try {
      const first = await readStoragePage(raw, 'hazardAnalysisRuns', undefined, 1, context);
      expect(first.items[0]).toMatchObject({key: 'uuid-a', label: 'Localization — Hazard analyses'});
      expect(first.items[0].detail).toContain('org/source');
      expect(first.items[0].detail).toContain('Saved ');
      const second = await readStoragePage(raw, 'hazardAnalysisRuns', first.nextKey, 1, context);
      expect(second.items[0]).toMatchObject({key: 'uuid-b', label: 'Manpads — Hazard analyses'});
      const third = await readStoragePage(raw, 'hazardAnalysisRuns', second.nextKey, 1, context);
      expect(third.items[0].detail).toContain('Project unavailable');
      expect(third.nextKey).toBeUndefined();
      expect(get.mock.instances.every(store => store.name === 'runMetadata')).toBe(true);
      expect(cursor).not.toHaveBeenCalled();
      await deleteStorageRecords(raw, 'hazardAnalysisRuns', [second.items[0].key]);
      expect(await db.get('hazardAnalysisRuns', 'uuid-b')).toBeUndefined();
      expect(await db.get('runMetadata', 'uuid-b')).toBeUndefined();
      expect((await db.get('hazardAnalysisRuns', 'uuid-a')).id).toBe('uuid-a');
      expect((await db.get('runMetadata', 'uuid-a')).projectId).toBe('p-a');
    } finally {get.mockRestore(); cursor.mockRestore();}
  } finally {db.close();}
});
test('chunk range skipping retains adjacent keys and sparse-page continuation', async () => {
  const db = await fixture();
  try {
    const tx = db.transaction('rows', 'readwrite');
    for (let i = 0; i < 505; i++) {
      const prefix = String(i).padStart(4, '0') + ':$part:';
      tx.store.put('chunk', prefix + '0');
      tx.store.put('chunk', prefix + '\ufffftail');
    }
    tx.store.put('visible', '0504:$part;adjacent');
    tx.store.put('visible', 'z');
    await tx.done;
    const first = await readStoragePage(unwrap(db), 'rows');
    expect(first.items).toEqual([]); expect(first.nextKey).toBeDefined();
    const second = await readStoragePage(unwrap(db), 'rows', first.nextKey);
    expect(second.items.map(item => item.key)).toEqual(['0504:$part;adjacent', 'z']);
    expect(second.nextKey).toBeUndefined();
  } finally {db.close();}
});
