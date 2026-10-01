export function initialDiagramLayoutPending(storage, key, hasSavedPositions) {
  try {
    const status = storage.getItem(key + ':initial-layout:v1');
    if (status === 'pending') return true;
    if (status === 'complete') return false;
    const pending = !hasSavedPositions;
    storage.setItem(key + ':initial-layout:v1', pending ? 'pending' : 'complete');
    return pending;
  } catch { return !hasSavedPositions; }
}
export function readDiagramViewport(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key + ':viewport:v1'));
    return value && [value.x, value.y, value.zoom].every(Number.isFinite) && value.zoom > 0 ? value : null;
  } catch { return null; }
}
// A CSV replaces the table even when its function names overlap with the old
// table. Keep this request durable if the diagram is not currently mounted.
export function requestImportedDiagramLayout(storage, key) {
  storage.setItem(key + ':csv-import-pending:v1', 'true');
  storage.setItem(key + ':initial-layout:v1', 'pending');
}
