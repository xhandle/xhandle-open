const text = value => String(value ?? '').trim();

// Resolve against the rows displayed by this diagram. Functional evidence also
// carries CSU row numbers, which belong to a different table and are not indices
// into the Functional model. Stable element identities take precedence.
export function resolveDiagramDetailRows(rows = [], target) {
  if (!target) return [];
  const entries = rows.map((row, rowIndex) => ({ row, rowIndex, ref: text(row.rowRef ?? rowIndex + 1) }));
  if (target.id && target.type === 'node') {
    const matches = entries.filter(({ row }) =>
      (row.fromNodeId || `n:${row.fromFunction}`) === target.id ||
      (row.toFunction && (row.toNodeId || `n:${row.toFunction}`) === target.id));
    if (matches.length) return matches;
  }
  if (target.id && target.type === 'edge') {
    const matches = entries.filter(({ row }) => row.edgeId === target.id || row.traceId === target.id);
    if (matches.length) return matches;
  }
  const direct = [...(target.rowRefs || []), target.rowRef]
    .filter(value => value !== undefined && value !== null && value !== '');
  const refs = new Set((direct.length ? direct : target.codeEvidence?.rowRefs || []).map(text));
  return entries.filter(({ row, ref }) => refs.has(ref) || (row.traceId && refs.has(text(row.traceId))));
}

export function diagramDetailLinkTarget(target, entries) {
  if (!target) return target;
  const rowRefs = [...new Set(entries.flatMap(({ row, ref }) => [ref, row.traceId, ...(row.functionalModel?.sourceTraceIds || [])]).filter(Boolean))];
  return { ...target, rowRefs, rowRef: entries[0]?.ref || '', codeEvidence: { ...target.codeEvidence, rowRefs } };
}
