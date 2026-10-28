import { useRef } from 'react';

const EMPTY = [];
export const samePreparationInputs = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));

export function hazardPreparationInputs({ latestRun: run, cbaRows = EMPTY, operationalContexts = EMPTY, selectedOperationalContextId = 'all', organizationContext }) {
  return [run?.generatedSheets?.Summary, cbaRows, operationalContexts, selectedOperationalContextId, organizationContext,
    run?.id, run?.projectId, run?.repoId, run?.analysisAbstraction, run?.functionalModelSnapshotHash,
    run?.architectureSnapshotHash, run?.organizationProfileProvenance, run?.operationalContexts, run?.selectedOperationalContextId];
}

// Owned by the workspace, so hidden panels cannot retain replaced inputs.
export function useHazardPreparationCache(props, scope) {
  const owner = useRef(null);
  const keys = hazardPreparationInputs(props);
  if (!owner.current || owner.current.scope !== scope || !samePreparationInputs(owner.current.keys, keys)) {
    if (owner.current) {
      owner.current.cache.retired = true;
      owner.current.cache.current = null;
    }
    owner.current = { scope, keys, cache: { current: null, retired: false } };
  }
  return owner.current.cache;
}

// Bound only the additional prepared-view data. The application already owns
// the current run; never keep a map of previously visited projects.
export function cacheableHazardPreparation(result, budget = 8 * 1024 * 1024) {
  let bytes = 0;
  for (const row of result.summarySheet || []) {
    bytes += 64 + row.length * 16;
    for (const cell of row) {
      if (cell != null && typeof cell === 'object') return false;
      bytes += typeof cell === 'string' ? cell.length * 2 + 32 : 16;
      if (bytes > budget) return false;
    }
  }
  for (const id of result.functionalTraceIds || []) {
    bytes += String(id).length * 2 + 64;
    if (bytes > budget) return false;
  }
  return bytes <= budget;
}
