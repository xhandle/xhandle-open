import { requestArtifactWorker } from './requestArtifactWorker';
import { layoutArchitecture } from './architectureLayout';

const displayLabel = value => { const text = String(value || ''); return text.length > 240 ? `${text.slice(0, 240)}…` : text; };

export function requestArchitectureLayout(diagram, options) {
  // Layout needs topology and labels, never saved source rows or evidence.
  const display = { snapshot: {
    nodes: diagram.snapshot.nodes.map(({ id, label, parentId, group }) => ({ id, label: displayLabel(label), parentId, group })),
    edges: diagram.snapshot.edges.map(({ id, from, to, label }) => ({ id, from, to, label: displayLabel(label) })),
  } };
  if (typeof Worker === 'undefined') return Promise.resolve(layoutArchitecture(display));
  return requestArtifactWorker('layout', display, options);
}
