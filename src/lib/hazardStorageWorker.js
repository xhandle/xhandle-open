/* global globalThis */
import { createHazardGraphTransport, largeHazardMessage } from './hazardMessageGraph';
import * as storage from '../features/project-hazard-analysis/projectHazardAnalysisStorageCore';
import { refreshProjectHaraSheets } from '../features/project-hazard-analysis/projectHara';
import { recoveryRecord } from './recoveryDatabase';

const operations = Object.fromEntries([
  'checkpointHazardAnalysis', 'deleteProjectHazardAnalysisRecord', 'listHazardAnalysisRevisions',
  'loadProjectHazardAnalysisRecord', 'loadProjectHazardAnalysisRecordState', 'readHazardAnalysisRevision',
  'releaseHazardCheckpoint', 'restoreHazardAnalysisRevision', 'saveHazardAnalysis',
  'saveProjectHazardAnalysisRecord', 'switchProjectHazardMethod', 'resetLocalRevisionTracking',
].map(name => [name, storage[name]]));
operations.recoveryRecord = recoveryRecord;
operations.refreshProjectHara = summary => refreshProjectHaraSheets({ Summary: summary });
const waiting = [], ready = new Map();
const drain = () => {
  while (waiting.length && ready.has(waiting[0])) {
    const id = waiting.shift(), request = ready.get(id); ready.delete(id);
    dispatch(id, request.operation, request.args);
  }
};
const transport = createHazardGraphTransport(data => globalThis.postMessage(data), (id, args, meta) => {
  ready.set(id, { operation: meta.operation, args }); drain();
}, id => waiting.push(id));
async function dispatch(id, operation, args) {
  try {
    if (!Object.hasOwn(operations, operation)) throw new Error('Unknown hazard storage operation.');
    const result = await operations[operation](...args);
    if (largeHazardMessage(result)) await transport.send(id, result);
    else globalThis.postMessage({ id, result });
  } catch (error) { globalThis.postMessage({ id, error: error.message || String(error) }); }
}
globalThis.onmessage = ({ data }) => {
  try {
    if (transport.receive(data)) return;
    waiting.push(data.id); ready.set(data.id, data); drain();
  } catch (error) { globalThis.postMessage({ id: data.id, error: error.message }); }
};
