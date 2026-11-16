/* global globalThis */
import { captureLiveSourcesInline } from './artifactSourceCapture';
import { compareObjects } from './artifactModel';
import { layoutArchitecture } from './architectureLayout';
import { readProjectOverview, readProjectTrace } from './engineeringProjectLoading';
import { readHazardAnalysisAvailability } from './hazardAnalysisSources';

globalThis.onmessage = async ({ data: { operation, payload } }) => {
  try {
    let result;
    const progress = value => globalThis.postMessage({ progress: value });
    if (operation === 'project-overview') result = await readProjectOverview(payload.id, progress);
    else if (operation === 'trace-matrix' || operation === 'trace-config') {
      const { assessMatrix, assessConfiguration } = await import('../traceability/traceabilityRepository');
      const options = { legacy: payload.legacy, models: payload.models, onProgress: count => progress({ percent: 50, stage: `Evaluating ${count} traceability operations` }) };
      result = operation === 'trace-config' ? await assessConfiguration(payload.config, options) : await assessMatrix(payload.id, options);
    }
    else if (operation === 'project-trace') result = await readProjectTrace(payload.id, progress, payload.sourceNodeId, payload.draft);
    else if (operation === 'hazard-availability') result = await readHazardAnalysisAvailability(payload.owners, { getItem: key => payload.storage[key] ?? null });
    else if (operation === 'compare') result = compareObjects(payload.before, payload.after);
    else if (operation === 'layout') result = layoutArchitecture(payload);
    else if (operation === 'sources' || operation === 'source-hash') {
      const sources = await captureLiveSourcesInline(payload.config, { getItem: key => payload.storage[key] ?? null }, { onProgress: progress });
      result = operation === 'source-hash' ? sources.hash : sources;
    } else throw new Error('Unknown artifact background operation.');
    globalThis.postMessage({ result });
  } catch (error) {
    globalThis.postMessage({ error: { name: error.name, message: error.message, code: error.code, artifactStage: error.artifactStage } });
  }
};
