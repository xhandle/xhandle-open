// Bounded, metadata-only diagnostics. Never retain runs, rows, evidence or IDs.
export function beginHazardLoadDiagnostic() {
  const now = () => performance.now();
  const started = now();
  let phaseStarted = started;
  const record = { startedAt: new Date().toISOString(), status: 'loading', phase: 'open-storage', phases: [], chunksRead: 0, chunksTotal: 0 };
  if (typeof window !== 'undefined') {
    const prior = Array.isArray(window.__xhandleHazardLoadDiagnostics) ? window.__xhandleHazardLoadDiagnostics : [];
    window.__xhandleHazardLoadDiagnostics = [...prior.slice(-7), record];
  }
  const phase = name => {
    const at = now();
    record.phases.push({ name: record.phase, milliseconds: Math.round(at - phaseStarted) });
    record.phase = name; phaseStarted = at;
    record.elapsedMs = Math.round(at - started);
  };
  return {
    phase,
    progress: ({completed,total}) => { record.chunksRead = completed; record.chunksTotal = total; record.elapsedMs = Math.round(now() - started); },
    finish: status => { phase('finished'); record.status = status; },
  };
}
