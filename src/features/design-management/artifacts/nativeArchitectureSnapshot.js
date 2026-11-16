// Each artifact canvas receives its own in-memory storage. The Projects renderer
// can initialize and fit its view without changing source-project or revision data.
export function nativeArchitectureState(diagram, onPresentationChange) {
  const saved = diagram.snapshot.native;
  const nodes = diagram.snapshot.nodes || [];
  const rows = saved?.rows || diagram.snapshot.edges.map(edge => edge.row || { fromFunction: nodes.find(node => node.id === edge.from)?.label, toFunction: nodes.find(node => node.id === edge.to)?.label, controlAction: edge.label, controlDetails: edge.details });
  const key = `artifact-diagram:${diagram.diagramHash}`;
  const values = new Map(Object.entries(saved?.storage || {}).map(([suffix, value]) => [key + suffix, value]));
  if (!saved) {
    values.set(key, JSON.stringify(nodes.filter(node => node.position).map(node => [node.id, { position: node.position, parentId: node.parentId || null }])));
    values.set(key + ':groups:v1', JSON.stringify(nodes.filter(node => node.group).map(node => ({ ...node, parentNode: node.parentId || undefined, elementType: node.groupType, position: node.position || { x: 0, y: 0 } }))));
  }
  // Source-project bundling is a display preference, not imported evidence.
  // Start with individual relationships, then restore only this artifact's own
  // saved preferences below. Never overwrite its immutable source snapshot.
  values.set(key + ':edge-aggregation:v1', JSON.stringify({ aggregateAll: false, aggregateBidirectionalAll: false }));
  const removed = new Set();
  for (const [suffix, value] of Object.entries(diagram.presentation?.storage || {})) {
    if (value === null && suffix === ':edge-aggregation:v1') continue;
    if (value === null) { values.delete(key + suffix); removed.add(key + suffix); } else values.set(key + suffix, value);
  }
  const notify = () => onPresentationChange?.({ storage: Object.fromEntries([...values, ...[...removed].map(name => [name, null])].filter(([name]) => name.startsWith(key)).map(([name, value]) => [name.slice(key.length), value])) });
  return { key, rows: JSON.parse(JSON.stringify(rows)), autoCategories: saved?.autoCategories ? JSON.parse(JSON.stringify(saved.autoCategories)) : null,
    storage: { getItem: name => values.get(name) ?? null, setItem: (name, value) => { if (values.get(name) === String(value)) return; values.set(name, String(value)); removed.delete(name); notify(); }, removeItem: name => { if (values.delete(name)) { removed.add(name); notify(); } } } };
}
export function nativeElementSource(diagram, target) {
  if (target.type === 'node') return target.id;
  const rows = diagram.snapshot.native?.rows || diagram.snapshot.edges.map(edge => edge.row);
  const ids = target.data?.edgeIds || [target.id];
  const index = rows.findIndex((row, i) => ids.includes(`e:n:${row?.fromFunction?.trim()}->n:${row?.toFunction?.trim()}-${i}`));
  if (index >= 0) {
    const edge = diagram.snapshot.edges.find(edge => JSON.stringify(edge.row) === JSON.stringify(rows[index]));
    if (edge) return edge.id;
  }
  // Aggregated edges retain native row references. Use the exact first supporting
  // relationship for inspection; every member remains listed in the inspector.
  const refs = target.data?.rowRefs || [];
  const match = diagram.snapshot.edges.find(edge => refs.includes(edge.row?.rowRef));
  return match?.id || target.id;
}
