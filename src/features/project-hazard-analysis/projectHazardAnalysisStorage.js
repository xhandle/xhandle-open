import * as local from './projectHazardAnalysisStorageCore';
import { canUseHazardStorageWorker, requestHazardStorage } from '../../lib/hazardStorageClient';
export { HAZARD_WRITE_OUTCOME, PROJECT_HAZARD_ANALYSIS_DB_CONFIG, describeHazardWriteFailure, estimateHazardStorage } from './projectHazardAnalysisStorageCore';

async function call(operation, args) {
  if (!canUseHazardStorageWorker()) return local[operation](...args);
  try { return await requestHazardStorage(operation, args); }
  catch (error) {
    if (['loadProjectHazardReuseState','saveProjectStpaFoundation','clearProjectHazardMethodResults','restoreProjectHazardMethodState'].includes(operation)) throw error;
    // Keep the public discriminated outcomes and boolean compatibility contracts.
    // Never replay a failed worker write: it may already have committed.
    if (operation === 'loadProjectHazardAnalysisRecord') return null;
    if (operation === 'loadProjectHazardAnalysisRecordState') return { status: 'error', record: null, error };
    if (operation === 'saveProjectHazardAnalysisRecord' || operation === 'deleteProjectHazardAnalysisRecord') return false;
    return { outcome: 'unavailable', status: 'unavailable', record: null, revision: null, revisions: [], message: error.message, projectId: args[0] };
  }
}
export function resetLocalRevisionTracking() {
  if (canUseHazardStorageWorker()) requestHazardStorage('resetLocalRevisionTracking', []).catch(() => {});
  else local.resetLocalRevisionTracking();
}
export const checkpointHazardAnalysis = (...args) => call('checkpointHazardAnalysis', args);
export const deleteProjectHazardAnalysisRecord = (...args) => call('deleteProjectHazardAnalysisRecord', args);
export const listHazardAnalysisRevisions = (...args) => call('listHazardAnalysisRevisions', args);
export const loadProjectHazardAnalysisRecord = (...args) => call('loadProjectHazardAnalysisRecord', args);
export const loadProjectHazardAnalysisRecordState = (...args) => call('loadProjectHazardAnalysisRecordState', args);
export const readHazardAnalysisRevision = (...args) => call('readHazardAnalysisRevision', args);
export const releaseHazardCheckpoint = (...args) => call('releaseHazardCheckpoint', args);
export const restoreHazardAnalysisRevision = (...args) => call('restoreHazardAnalysisRevision', args);
export const saveHazardAnalysis = (...args) => call('saveHazardAnalysis', args);
export const saveProjectHazardAnalysisRecord = (...args) => call('saveProjectHazardAnalysisRecord', args);
export const switchProjectHazardMethod = (...args) => call('switchProjectHazardMethod', args);

export const loadProjectHazardReuseState = (...args) => call('loadProjectHazardReuseState', args);
export const saveProjectStpaFoundation = (...args) => call('saveProjectStpaFoundation', args);
export const clearProjectHazardMethodResults = (...args) => call('clearProjectHazardMethodResults', args);
export const restoreProjectHazardMethodState = (...args) => call('restoreProjectHazardMethodState', args);
