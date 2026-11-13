import { useSyncExternalStore } from 'react';
import { pauseError } from './generationRecovery';

let sequence = 0;
const runs = new Map(), snapshots = new Map(), listeners = new Set();
const idle = Object.freeze({ running: false, progress: '', error: '' });
const emit = (key, value) => { snapshots.set(key, value); listeners.forEach(listener => listener()); };
export const subscribeGenerationRuns = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const generationRunEntries = () => [...snapshots.entries()];
export const generationRunState = key => snapshots.get(key) || idle;
export const pauseGenerationRun = key => runs.get(key)?.controller.abort();
export const useGenerationRun = key => useSyncExternalStore(subscribeGenerationRuns, () => generationRunState(key), () => idle);

// The application, rather than a mounted editor, owns the request lifetime.
// Browser reload closes the run; durable jobs/parts are resumed on explicit request.
export function startGenerationRun(key, work, metadata = {}) {
  if (runs.has(key)) return runs.get(key).promise;
  const controller = new AbortController();
  const run = { controller, promise: null };
  const execute = async () => {
    if (controller.signal.aborted) throw pauseError();
    return work({ signal: controller.signal, onProgress: (progress, details = {}) => emit(key, { ...generationRunState(key), running: true, status: 'running', progress, details: { ...generationRunState(key).details, ...details }, error: '' }) });
  };
  // Start after registering so repeated clicks share exactly the same promise.
  run.promise = Promise.resolve().then(async () => {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) return execute();
    return navigator.locks.request(`xhandle:design-generation:${key}`, { ifAvailable: true }, lock => {
      if (!lock) throw new Error('This generation is already running in another tab. Return to that tab to monitor or pause it.');
      return execute();
    });
  }).then(value => { emit(key, { ...generationRunState(key), running: false, status: 'success', progress: 'Draft generation complete. Ready for review.', details: { ...generationRunState(key).details, stage: 'complete' } }); return value; }, error => {
    emit(key, { ...generationRunState(key), running: false, status: error.name === 'AbortError' ? 'paused' : 'error', details: { ...generationRunState(key).details, stage: error.name === 'AbortError' ? 'paused' : 'error' }, progress: '', error: error.name === 'AbortError' ? 'Paused. Completed work is saved.' : error.message });
    throw error;
  }).finally(() => { if (runs.get(key) === run) runs.delete(key); });
  runs.set(key, run); emit(key, { runId: ++sequence, title: metadata.title || 'Engineering artifact generation', startedAt: Date.now(), running: true, status: 'running', progress: 'Starting generation…', details: { stage: 'preparing' }, error: '' });
  // Work continues without an editor subscriber; avoid an unhandled rejection if
  // its caller disappears. The returned promise still rejects for active callers.
  run.promise.catch(() => {});
  return run.promise;
}
