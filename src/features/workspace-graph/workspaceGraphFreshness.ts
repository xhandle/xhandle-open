import { BACKUP_DATA_CHANGED_EVENT } from '../../lib/localBackupEvents';

// Compare actual source strings, including equal-length edits. Keep only one
// snapshot; localStorage itself is bounded and this avoids hashing it per prompt.
const SOURCE_KEYS = new Set([
  'xhandle.projects', 'xhandle.projectFolders', 'xhandle.projectData',
  'xhandle:req-projects', 'xhandle:requirements', 'xhandle.codeArchitectureProjects',
  'xhandle.designManagement.sysmlV2.models', 'xhandle:vnv-test-case-documents',
]);
export const INDEX_DIRTY_PREFIX='xhandle.workspaceGraph.dirty.';
const subscribers=new Set<()=>void>();
export function subscribeWorkspaceGraphSources(listener:()=>void){ensureListeners();subscribers.add(listener);return()=>{subscribers.delete(listener);};}
let revision = 0;
let listening = false;
let channel: BroadcastChannel | undefined;
let queued = false;

// Observe writes before the first Collaborator question so persisted index
// checkpoints cannot appear fresh after an edit/import. This never scans data
// or starts an indexing worker; the next requested read performs that work.
export function trackWorkspaceGraphSourceChanges() { ensureListeners(); }

export function invalidateWorkspaceGraphSources(group='*') {
  revision += 1;
  try{localStorage.setItem(INDEX_DIRTY_PREFIX+group,`${Date.now()}:${Math.random()}`);}catch{}
  subscribers.forEach(listener=>listener());
  if (channel && !queued) {
    queued = true;
    Promise.resolve().then(() => { queued = false; try { channel?.postMessage('changed'); } catch {} });
  }
}

function ensureListeners() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  if (typeof window.BroadcastChannel === 'function') {
    channel = new window.BroadcastChannel('xhandle-workspace-graph-sources-v1');
    channel.onmessage = () => { revision += 1; subscribers.forEach(listener=>listener()); };
  }
  const changed = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (event.type === 'storage') {
      const key = (event as StorageEvent).key;
      if(key?.startsWith(INDEX_DIRTY_PREFIX)){revision+=1;subscribers.forEach(listener=>listener());return;}
      if (key && !SOURCE_KEYS.has(key) && !key.startsWith('cbaMeta:')) return;
    }
    // App's untyped notification is for localStorage, which is compared exactly
    // below. Avoid reindexing on sidebar changes and delayed render broadcasts.
    if (event.type === 'xhandle:data-changed' && !detail) return;
    const db=detail?.db||detail?.database;
    if (['xhandle-workspace-graph','xhandle-collaborator-attachments','xhandle-recovery','TraceabilityMeta'].includes(db)) return;
    if (event.type === 'xhandle:hazard-save-state' && detail?.run?.finalSaveStatus !== 'saved') return;
    if (event.type === 'xhandle:hazard-analysis-write' && !detail?.ok) return;
    if(db==='xhandle'&&Array.isArray(detail?.stores)&&detail.stores.length&&detail.stores.every((name:string)=>name==='diagram_positions'))return;
    const groups:Record<string,string>={'xhandle-generated-reports':'generatedReports','xhandle-project-hazard-analysis':'durableProjectAnalysis','xhandle-project-reports':'durableProjectAnalysis','xhandle-code-architecture-assurance':'codeArchitectureAssurance','TraceabilityDB':'traceability'};
    const assurance=event.type.includes('assurance')||['software-requirements','system-requirements','subsystem-requirements','design-elements'].includes(detail?.kind);
    const group=event.type==='xhandle:hazard-analysis-write'?'durableProjectAnalysis':detail?.source==='generated-reports'?'generatedReports':assurance?'codeArchitectureAssurance':db==='xhandle' ? (detail?.stores?.includes('code_index')?'codeIndex':'codeArchitecture') : groups[db] ||
      (event.type.includes('hazard')||event.type.includes('remediation')||event.type.includes('review:')?'indexedFeatureStores':event.type.includes('safety-case')?'traceability':'*');
    invalidateWorkspaceGraphSources(group);
  };
  [BACKUP_DATA_CHANGED_EVENT, 'xhandle:data-changed', 'xhandle:workspace-authoritative-data-changed',
    'xhandle:hazard-analysis-write', 'xhandle:hazard-save-state',
    'xhandle:code-architecture-hazard-analysis:changed', 'xhandle:safety-remediation:changed',
    'xhandle:collaborator-review:evidence-changed', 'xhandle:safety-case-updated',
    'xhandle:safety-case-deleted', 'xhandle:safety-case-folders-updated', 'storage',
  ].forEach(name => window.addEventListener(name, changed));
}

export function workspaceGraphSourceSnapshot() {
  ensureListeners();
  const values = new Map<string, string | null>();
  if (typeof window !== 'undefined' && window.localStorage) {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (SOURCE_KEYS.has(key) || key.startsWith('cbaMeta:') || key.startsWith(INDEX_DIRTY_PREFIX))) values.set(key, localStorage.getItem(key));
    }
  }
  return { revision, values };
}

export function sameWorkspaceGraphSources(a: ReturnType<typeof workspaceGraphSourceSnapshot>, b: ReturnType<typeof workspaceGraphSourceSnapshot>) {
  return a.revision === b.revision && a.values.size === b.values.size &&
    Array.from(a.values).every(([key, value]) => b.values.has(key) && b.values.get(key) === value);
}
