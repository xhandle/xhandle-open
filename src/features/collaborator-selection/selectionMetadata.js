const text = value => typeof value === 'string' ? value.slice(0, 240) : '';

// Carry selected identities through routing without copying diagram bodies.
export function compactSelectionMetadata(focus = {}) {
  const selections = currentSelections(focus);

  return selections.slice(0, 8).map(row => {
    const result = {
      kind: text(row.kind), id: text(row.id || row.primary?.rowId), title: text(row.title || row.primary?.title),
      projectId: text(row.projectId), source: text(row.source),
    };
    if (Array.isArray(row.selectedNodes)) {
      result.selectedNodes = row.selectedNodes.slice(0, 12).map(node => ({
        id: text(node.id), label: text(node.label), type: text(node.type), subsystem: text(node.subsystem),
      }));
      result.selectedNodeCount = row.selectedNodes.length;
      result.selectionTruncated = row.selectedNodes.length > 12;
    }
    if (row.selectedEdge) {
      const edge = row.selectedEdge;
      result.selectedEdge = {id: text(edge.id), label: text(edge.label), source: text(edge.source), target: text(edge.target)};
    }
    return result;
  });
}

export function isCurrentSelectionReference(reference, view = {}) {
  const normalized = reference.trim().toLocaleLowerCase();
  const selections = view.selections || [];
  if (selections.length && /^(?:(?:this|that|the selected) (?:element|selection|node|edge|interface|relationship|function|row|cell)|(?:these|those|the selected)(?: two)? (?:elements|nodes|functions|rows|cells)|selected context)$/i.test(normalized)) return true;
  return selections.some(selection => {
    const edge = selection.selectedEdge;
    const identities = [selection.id, selection.title,
      ...(selection.selectedNodes || []).flatMap(node => [node.id, node.label]),
      edge?.id, edge?.label, edge?.source, edge?.target];
    return identities.some(value => typeof value === 'string' && value.trim().toLocaleLowerCase() === normalized);
  });
}

// Only current, explicitly selected UI data belongs in the first model request.
// Keep this separate from the lightweight descriptor used by retrieval planning.
export function currentSelections(focus = {}) {
  const selections = Array.isArray(focus.activeSelections) ? [...focus.activeSelections] : [];
  if (!selections.some(row => row?.kind === 'functional-canvas') && focus.functionalCanvasSelection?.hasSelection) {
    selections.unshift({kind: 'functional-canvas', projectId: focus.viewedProjectId, ...focus.functionalCanvasSelection});
  }
  return selections.filter(row => row && (!focus.viewedProjectId || !row.projectId || row.projectId === focus.viewedProjectId));
}

export function boundedSelectionEvidence(focus = {}) {
  let budget = 12000, entries = 300, truncated = false;
  const seen = new WeakSet();
  const copy = (value, depth = 0) => {
    if (budget <= 0 || entries-- <= 0 || depth > 6) { truncated = true; return undefined; }
    if (typeof value === 'string') {
      const result = value.slice(0, Math.min(1200, budget));
      budget -= result.length;
      if (result.length < value.length) truncated = true;
      return result;
    }
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value !== 'object') return undefined;
    if (seen.has(value)) { truncated = true; return undefined; }
    seen.add(value);
    const result = Array.isArray(value) ? [] : {};
    const keys = Object.keys(value);
    if (keys.length > 24) truncated = true;
    for (const key of keys.slice(0, 24)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      budget -= key.length;
      const item = copy(value[key], depth + 1);
      if (item !== undefined) result[key] = item;
    }
    seen.delete(value);
    return result;
  };
  const selections = currentSelections(focus);
  const fields = ['kind', 'id', 'title', 'projectId', 'source', 'selectedNodes', 'selectedEdge', 'selectedRows', 'values', 'primary', 'selectedCells'];
  const result = selections.slice(0, 8).map(row => {
    const selected = {};
    for (const key of fields) if (row[key] !== undefined) selected[key] = row[key];
    return copy(selected);
  }).filter(Boolean);
  return {selections: result, selectionTruncated: truncated || selections.length > 8};
}

export function selectionEvidenceQuery(userText, focus = {}) {
  if (!/\b(selected|selection|this|these|those|between (?:the )?two)\b/i.test(userText)) return userText;
  const labels = compactSelectionMetadata(focus).flatMap(row => [
    row.title, row.primary?.title, ...(row.selectedNodes || []).map(node => node.label),
    row.selectedEdge?.label, row.selectedEdge?.source, row.selectedEdge?.target,
  ]).filter(Boolean);
  return labels.length ? `${userText}\nCurrent selected subjects: ${[...new Set(labels)].join('; ')}` : userText;
}
