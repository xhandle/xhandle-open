// Presentation only: never changes row identity, evidence or downstream inputs.
const text = value => String(value || '').trim();
const file = value => text(value).replace(/\\/g, '/');
const identity = (path, name) => JSON.stringify([file(path), text(name)]);
const endpoint = (row, side) => ({
  name: text(row[`${side}Function`] || row[side]),
  file: file(row[`${side}File`]),
});
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function projectFunctionalArchitecture(rows = []) {
  const current = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.lineage?.status !== 'historical');
  const callers = new Set(current.map(({ row }) => { const from = endpoint(row, 'from'); return identity(from.file, from.name); }));
  const definitions = new Set();
  for (const { row } of current) {
    const sources = [...(row.sourceEvidence?.functions || []), ...(row.codeEvidence?.sourceFunctions || [])];
    for (const entry of row.codeEvidence?.files || []) {
      if (typeof entry === 'object') for (const fn of entry.sourceFunctions || []) sources.push({ ...fn, filePath: fn.filePath || entry.filePath });
    }
    for (const fn of sources) if (typeof fn === 'object' && fn.filePath && (fn.functionName || fn.name)) definitions.add(identity(fn.filePath, fn.functionName || fn.name));
    const e = row.relationshipEvidence;
    if (e?.targetResolution === 'lexical-definition') definitions.add(identity(row.toFile, row.toFunction || row.to));
  }
  const nodes = new Map(), edges = new Map();
  const ensure = (ep, row, kind = 'function') => {
    const id = `functional:${kind}:${identity(ep.file, ep.name)}`;
    const group = text(row.architecture?.subsystem) || 'Functions';
    if (!nodes.has(id)) nodes.set(id, { id, label: ep.name || 'Unspecified function', file: ep.file, kind,
      group, rowIndices: new Set(), operations: new Set() });
    // Conflicting legacy allocations must not make the layout depend on row order.
    if (compare(group, nodes.get(id).group) < 0) nodes.get(id).group = group;
    return nodes.get(id);
  };
  for (const { row, index } of current) {
    const from = endpoint(row, 'from'), to = endpoint(row, 'to');
    const source = ensure(from, { ...row, architecture: row.fromArchitecture || row.architecture });
    source.rowIndices.add(index);
    const e = row.relationshipEvidence || {};
    const knownTarget = callers.has(identity(to.file, to.name)) || definitions.has(identity(to.file, to.name));
    const boundary = to.file && from.file && to.file !== from.file;
    // Weak legacy evidence must not be interpreted as proof of an internal call.
    const localOperation = e.targetResolution === 'unresolved-runtime-target' && !knownTarget && !boundary;
    if (!to.name || localOperation) { source.operations.add(index); continue; }
    let target;
    if (!knownTarget && !boundary && e.targetResolution === 'import-reference') {
      // Group by the supplied namespace; never use a language/repository allowlist.
      const namespace = to.name.split(/::|\./).filter(Boolean)[0] || to.name;
      target = ensure({ name: `${namespace} interface`, file: from.file }, row, 'interface');
    } else target = ensure(to, { ...row, architecture: row.toArchitecture || row.architecture });
    target.rowIndices.add(index);
    if (source.id === target.id) { source.operations.add(index); continue; }
    const id = `functional-edge:${JSON.stringify([source.id, target.id])}`;
    if (!edges.has(id)) edges.set(id, { id, source: source.id, target: target.id, rowIndices: [], actions: new Set() });
    edges.get(id).rowIndices.push(index);
    edges.get(id).actions.add(text(row.controlAction || row.action));
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => compare(a.id, b.id)).map(n => ({ ...n, rowIndices: [...n.rowIndices], operations: [...n.operations] })),
    edges: [...edges.values()].sort((a, b) => compare(a.id, b.id)).map(e => ({ ...e, actions: [...e.actions].filter(Boolean).sort(compare) })),
    rowCount: current.length,
  };
}
