import React, { useEffect, useState } from 'react';
import { requestHazardAnalysisAvailability } from './requestHazardAnalysisAvailability';

export function useHazardAnalysisStatus(owners, enabled) {
  const key = JSON.stringify(owners.map(({ id, workspaceType }) => ({ id: String(id), workspaceType })));
  const [result, setResult] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const update = event => {
      if (event.type === 'storage' && event.key && !['xhandle.projects', 'xhandle.codeArchitectureProjects', 'xhandle.projectData', 'xhandle:code-architecture-hazard-analysis:v1'].includes(event.key)) return;
      if (event.detail?.projectId && !JSON.parse(key).some(owner => owner.id === String(event.detail.projectId))) return;
      setRefresh(value => value + 1);
    };
    const events = ['xhandle:hazard-analysis-write', 'xhandle:code-architecture-hazard-analysis:changed', 'storage', 'focus'];
    events.forEach(event => window.addEventListener(event, update));
    return () => events.forEach(event => window.removeEventListener(event, update));
  }, [enabled, key]);
  useEffect(() => {
    if (!enabled || !JSON.parse(key).length) return;
    const controller = new AbortController();
    setResult(null);
    requestHazardAnalysisAvailability(JSON.parse(key), { signal: controller.signal }).then(summary => {
      if (!controller.signal.aborted) setResult({ key, ...summary });
    }, error => { if (!controller.signal.aborted) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [key, enabled, refresh]);
  if (!enabled) return { ready: true };
  if (!owners.length) return { ready: false, message: 'Choose the source project whose hazard analysis will supply this document.' };
  if (result?.key !== key) return { ready: false, message: 'Checking saved hazard analyses…' };
  return result.error ? { ready: false, error: result.error, retry: () => setRefresh(value => value + 1) } : { ready: true, message: `${result.rows} saved assessment ${result.rows === 1 ? 'row' : 'rows'} from ${result.analyses} hazard ${result.analyses === 1 ? 'analysis' : 'analyses'} available.` };
}

export default function HazardAnalysisNotice({ status }) {
  return <section className="rounded border border-indigo-200 bg-indigo-50 p-3 text-sm" aria-label="Hazard analysis sources">
    <strong>Source: saved hazard analysis</strong>
    <p>Uses hazard analysis performed in Projects or Code-Based Architecture. Hazard Tracking List consolidates the findings into actionable safety issues with stable HTR identifiers. Safety Requirements uses those consolidated HTRs and recorded constraints to create concise requirements with hazard traceability. Missing details remain gaps.</p>
    <p>For code projects, the latest saved analysis for each analyzed repository is included. Repositories without saved results are outside this document’s coverage.</p>
    {status.error ? <p role="alert" className="mt-2 text-red-700">{status.error}</p> : <p role="status" className="mt-2">{status.message}</p>}
    {status.retry && <button type="button" className="mt-2 rounded border px-3 py-1" onClick={status.retry}>Retry hazard analysis check</button>}
  </section>;
}
