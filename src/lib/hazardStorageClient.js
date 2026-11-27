import { captureHazardSnapshot, createHazardGraphTransport, largeHazardMessage } from './hazardMessageGraph';
import createHazardStorageWorker from './createHazardStorageWorker';
import { refreshProjectHaraSheets } from '../features/project-hazard-analysis/projectHara';

let worker, transport;
let nextId = 0;
const pending = new Map();
export const canUseHazardStorageWorker = () => typeof window !== 'undefined' && typeof Worker !== 'undefined';

function failWorker(error) {
  if (worker) {
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
    worker.terminate();
  }
  worker = null;
  transport?.close(error); transport = null;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}

// Keep one worker for this browsing context: its revision tracking and per-project
// write queues must survive successive saves. No write is retried after a crash.
export function requestHazardStorage(operation, args) {
  const request = requestHazardStorageNow(operation, args);
  storageRequests.add(request);
  return request.finally(() => storageRequests.delete(request));
}
const storageRequests = new Set();
export async function flushHazardStorageRequests() {
  while (storageRequests.size) await Promise.all([...storageRequests]);
}
function requestHazardStorageNow(operation, args) {
  if (pending.size >= 64) return Promise.reject(new Error('Hazard storage is busy; wait for pending saves.'));
  try {
    if (!worker) {
      worker = createHazardStorageWorker();
      const receive = data => {
        const request = pending.get(data.id);
        if (!request) return;
        clearTimeout(request.timer); pending.delete(data.id);
        if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
      };
      transport = createHazardGraphTransport(data => worker.postMessage(data), (id, result) => receive({ id, result }));
      worker.onmessage = ({ data }) => {
        try { if (transport.receive(data)) return; } catch (error) { failWorker(error); return; }
        if (data.event) {
          if (['xhandle:hazard-analysis-write', 'xhandle:hazard-analysis-clear-blocked', 'xhandle:backup-data-changed'].includes(data.event)) {
            window.dispatchEvent(new CustomEvent(data.event, { detail: data.detail }));
          }
          return;
        }
        receive(data);
      };
      worker.onerror = event => failWorker(new Error(event.message || 'Hazard storage worker stopped. Saved checkpoints are retained.'));
      worker.onmessageerror = () => failWorker(new Error('Hazard storage response could not be read.'));
    }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => failWorker(new Error('Hazard storage worker timed out. Saved checkpoints are retained.')), 120000);
      pending.set(id, { resolve, reject, timer });
      // Capture before the caller can edit; large immutable snapshots travel in
      // acknowledged chunks so native cloning cannot block input for seconds.
      try {
        if (largeHazardMessage(args)) {
          const snapshot = captureHazardSnapshot(args);
          transport.send(id, snapshot, { operation }).catch(error => {
            const request = pending.get(id); if (!request) return;
            clearTimeout(request.timer); pending.delete(id); reject(error);
          });
        } else worker.postMessage({ id, operation, args });
      }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  } catch (error) { return Promise.reject(error); }
}

export async function refreshProjectHaraInBackground(summary, options = {}) {
  // Send only the assessed sheet, not every copy of the source workbook.
  return canUseHazardStorageWorker()
    ? requestHazardStorage('refreshProjectHara', [summary, options])
    : refreshProjectHaraSheets({ Summary: summary }, options);
}

export async function refreshHazardWorkbookInBackground(sheets) {
  return { ...sheets, ...await refreshProjectHaraInBackground(sheets?.Summary, { practical: sheets?.haraCompletionPolicy === 'projects-hara-practical-v1',haraItem:sheets?.haraItem }) };
}
