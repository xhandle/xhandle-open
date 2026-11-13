import React, { useEffect, useState } from 'react';
import { ARTIFACT_CHANGED, listArtifacts } from './artifactRepository';
import { captureLiveSources } from './artifactSources';
import { matchesHazardTrackingSource } from './hazardTrackingSources';

export function useConsolidatedHazardStatus(config, owner, enabled) {
  const [result, setResult] = useState(null), [refresh, setRefresh] = useState(0);
  const key = JSON.stringify({ config, owner });
  useEffect(() => {
    if (!enabled) return;
    const update = () => setRefresh(value => value + 1);
    for (const event of [ARTIFACT_CHANGED, 'focus', 'storage']) window.addEventListener(event, update);
    return () => { for (const event of [ARTIFACT_CHANGED, 'focus', 'storage']) window.removeEventListener(event, update); };
  }, [enabled]);
  useEffect(() => {
    const { config, owner } = JSON.parse(key);
    if (!enabled || !owner || !config.system.trim()) return;
    const controller = new AbortController();
    const input = { ...config, projectId: owner.id, workspaceType: owner.workspaceType, sources: [], architectureSources: [], notes: '' };
    const save = value => { if (!controller.signal.aborted) setResult({ key, ...value }); };
    (async () => {
      const candidates = (await listArtifacts()).filter(meta => matchesHazardTrackingSource(meta, input));
      const selected = input.hazardTrackingArtifactId ? candidates.find(meta => meta.id === input.hazardTrackingArtifactId) : candidates.length === 1 ? candidates[0] : null;
      save({ candidates, selectedId: selected?.id, message: 'Checking consolidated hazard tracking records…' });
      if (!selected) { save({ candidates, error: candidates.length ? 'Choose the Hazard Tracking List to use.' : 'Create and consolidate a Hazard Tracking List for this project and system first.' }); return; }
      if (!input.folderId) { save({ candidates, selectedId: selected.id, message: 'Choose a destination folder.' }); return; }
      try {
        const sources = await captureLiveSources({ ...input, hazardTrackingArtifactId: selected.id }, localStorage, { signal: controller.signal });
        save({ ready: true, candidates, selectedId: selected.id, message: `${sources.entries.length} consolidated ${sources.entries.length === 1 ? 'HTR' : 'HTRs'} available.` });
      } catch (error) { save({ candidates, selectedId: selected.id, error: error.message }); }
    })().catch(error => save({ error: error.message }));
    return () => controller.abort();
  }, [key, enabled, refresh]);
  if (!enabled) return { ready: true };
  if (!owner || !config.system.trim()) return { ready: false, message: 'Choose the owning project and system to find its consolidated Hazard Tracking List.' };
  return result?.key === key ? result : { ready: false, message: 'Checking consolidated Hazard Tracking Lists…' };
}

export default function ConsolidatedHazardNotice({ status, onChange }) {
  return <section className="rounded border border-indigo-200 bg-indigo-50 p-3 text-sm" aria-label="Consolidated hazard sources">
    <strong>Source: consolidated Hazard Tracking List</strong>
    <p>Creates concise, actionable safety requirements from issue summaries and recorded safety constraints. Full HTL inventories are excluded from generation. Requirements retain their HTR links; missing responsibility or acceptance criteria remain gaps.</p>
    {!!status.candidates?.length && <label>Hazard Tracking List<select value={status.selectedId || ''} onChange={event => onChange(event.target.value)}><option value="">Choose Hazard Tracking List</option>{status.candidates.map(meta => <option key={meta.id} value={meta.id}>{meta.title}</option>)}</select></label>}
    <p role={status.error ? 'alert' : 'status'} className={status.error ? 'mt-2 text-red-700' : 'mt-2'}>{status.error || status.message}</p>
  </section>;
}
