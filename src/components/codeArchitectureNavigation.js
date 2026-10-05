// Resolve persisted links against the current decomposition, never a stale row position.
const text = value => String(value ?? '').trim();
const unique = rows => rows.length === 1 ? rows[0] : null;
export function resolveArchitectureTarget(target, rows = []) {
  if (!target) return null;
  const candidates = rows.map((row, rowIndex) => ({ row, rowIndex }));
  const traceId = text(target.traceId || target.row?.traceId);
  let match = traceId ? unique(candidates.filter(({ row }) => text(row.traceId) === traceId)) : null;
  if (traceId && !match) return null; // An explicit missing/ambiguous identity is not a license to guess.
  const isEdge = target.type === 'edge' || target.mode === 'edge';
  const nodeKey = target.mode === 'to' ? 'toNodeId' : 'fromNodeId';
  if (!match && target.edgeId && isEdge) match = unique(candidates.filter(({ row }) => row.edgeId === target.edgeId));
  const from = text(target.fromFunction || target.row?.from || target.row?.fromFunction);
  const action = text(target.controlAction || target.row?.action || target.row?.controlAction);
  const to = text(target.toFunction || target.row?.to || target.row?.toFunction);
  if (!match && from && action && to) {
    let matches = candidates.filter(({ row }) =>
      text(row.fromFunction ?? row.from) === from && text(row.controlAction ?? row.action) === action &&
      text(row.toFunction ?? row.to) === to);
    if (matches.length > 1) {
      const files = value => text(value).split(/[,;]+/).map(part => part.trim()).filter(Boolean);
      matches = matches.filter(({ row }) => ['fromFile', 'toFile'].every(key => {
        const expected = files(target[key] || target.row?.[key]);
        return !expected.length || files(row[key]).some(file => expected.includes(file));
      }));
    }
    match = unique(matches);
  }
  if (!match && !isEdge && target.nodeId) {
    const matches = candidates.filter(({ row }) => row[nodeKey] === target.nodeId);
    // A node may participate in several interfaces; any gives the same current node ID.
    match = matches[0] || null;
  }
  if (!match) return null;
  const { row, rowIndex } = match;
  const fromName = text(row.fromFunction ?? row.from);
  const toName = text(row.toFunction ?? row.to);
  const fromId = row.fromNodeId || `n:${fromName}`;
  const toId = row.toNodeId || `n:${toName}`;
  return { ...target, resolutionStatus: row.lineage?.status === "historical" ? "historical" : row.lineage ? "current" : "legacy", type: isEdge ? 'edge' : 'node', row, rowIndex, traceId: row.traceId, rowRef: row.rowRef,
    fromFunction: fromName, toFunction: toName, controlAction: row.controlAction ?? row.action,
    fromFile: row.fromFile, toFile: row.toFile,
    nodeId: isEdge ? '' : target.mode === 'to' ? toId : fromId,
    functionName: target.mode === 'to' ? toName : fromName,
    edgeId: isEdge ? row.edgeId || `e:${fromId}->${toId}-${rowIndex}` : '',
  };
}

// One owner per request. Cancellation also prevents completion of an old request.
export function retryDiagramFocus(getDiagram, target, onDone, interval = 100) {
  let cancelled = false;
  let timer;
  let attempts = 0;
  const attempt = () => {
    if (cancelled) return;
    if (getDiagram()?.focusArchitectureTarget?.(target) === true) {
      if (!cancelled) onDone?.();
    } else if (++attempts < 300) timer = setTimeout(attempt, interval);
  };
  timer = setTimeout(attempt, 0);
  return () => { cancelled = true; clearTimeout(timer); };
}
