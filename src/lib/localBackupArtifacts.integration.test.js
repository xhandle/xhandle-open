import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { ARTIFACT_DB, ARTIFACT_STORES, openArtifactDatabase } from '../features/design-management/artifacts/artifactRepository';
import { backupNow, restoreFromBackupFile } from './localBackupService';

test('backup and restore preserve every design artifact store and release database connections', async () => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  localStorage.clear();
  let blob;
  URL.createObjectURL = jest.fn(value => { blob = value; return 'blob:backup-fixture'; });
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const timer = jest.spyOn(global, 'setTimeout');
  try {
    const db = await openArtifactDatabase();
    const tx = db.transaction(ARTIFACT_STORES, 'readwrite');
    for (const store of ARTIFACT_STORES) await tx.objectStore(store).put({ id: store + '-fixture', projectId: 'p', artifactId: 'artifact', text: 'Retained ' + store });
    await tx.done; db.close();
    await backupNow({ mode: 'download' });
    const serialized = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
    });
    const saved = JSON.parse(serialized).data.indexedDB[ARTIFACT_DB];
    expect(Object.keys(saved.stores)).toEqual(ARTIFACT_STORES);
    for (const store of ARTIFACT_STORES) expect(saved.stores[store].records[0].value.text).toBe('Retained ' + store);
    const changed = await openArtifactDatabase(), cleared = changed.transaction(ARTIFACT_STORES, 'readwrite');
    for (const store of ARTIFACT_STORES) await cleared.objectStore(store).clear();
    await cleared.done; changed.close();
    await restoreFromBackupFile({ text: async () => serialized });
    // The app reload is intentionally deferred; keep this isolated test alive.
    timer.mock.calls.forEach((args, index) => { if (args[1] === 150) clearTimeout(timer.mock.results[index].value); });
    const restored = await openArtifactDatabase();
    for (const store of ARTIFACT_STORES) expect((await restored.get(store, store + '-fixture')).text).toBe('Retained ' + store);
    restored.close();
    // A leaked restore connection would block a future application upgrade.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(ARTIFACT_DB, 3);
      request.onblocked = () => reject(new Error('Restore left an open artifact connection'));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
  } finally {
    timer.mock.calls.forEach((args, index) => { if (args[1] === 150) clearTimeout(timer.mock.results[index]?.value); });
    click.mockRestore(); timer.mockRestore();
  }
});
