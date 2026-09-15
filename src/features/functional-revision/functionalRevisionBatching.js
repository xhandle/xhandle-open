const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

export function isSystemicFunctionalRevisionRequest(text = "") {
  const value = normalize(text).toLowerCase();
  const systemicScope = /\b(?:all|every|entire|remaining|throughout|across)\b/.test(value);
  const structuralChange = /\b(?:multi[- ]level|child[- ]level|child functions?|umbrella functions?|broad rows?|consistent abstraction|decompos(?:e|ition))\b/.test(value);
  const replacement = /\b(?:replace|rewrite|restructure|complete|apply the same|superseded)\b/.test(value);
  return structuralChange && (systemicScope || replacement);
}

export function buildFunctionalRevisionBatches(rows = [], { maxRows = 18, maxChars = 18000 } = {}) {
  const groups = [];
  const byOwner = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const owner = normalize(row?.subsystem) || "Unallocated";
    if (!byOwner.has(owner)) {
      const group = { owner, rows: [] };
      byOwner.set(owner, group);
      groups.push(group);
    }
    byOwner.get(owner).rows.push({ ...row, _revisionRowNumber: index + 1 });
  });

  const batches = [];
  let current = [];
  let currentChars = 0;
  const flush = () => {
    if (!current.length) return;
    batches.push(current);
    current = [];
    currentChars = 0;
  };
  groups.forEach((group) => {
    const groupChars = JSON.stringify(group.rows).length;
    if (current.length && (current.length + group.rows.length > maxRows || currentChars + groupChars > maxChars)) flush();
    if (group.rows.length <= maxRows && groupChars <= maxChars) {
      current.push(...group.rows);
      currentChars += groupChars;
      return;
    }
    flush();
    for (let index = 0; index < group.rows.length; index += maxRows) {
      batches.push(group.rows.slice(index, index + maxRows));
    }
  });
  flush();
  return batches;
}

const uniqueObjects = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function mergeFunctionalRevisionPlans(plans = [], failures = []) {
  const successful = (Array.isArray(plans) ? plans : []).filter(Boolean);
  return {
    summary: successful.map((plan) => normalize(plan.summary)).filter(Boolean).join(" ") || "Systemic functional decomposition revision prepared in bounded batches.",
    updateRows: uniqueObjects(successful.flatMap((plan) => plan.updateRows || plan.updates || [])),
    addRows: uniqueObjects(successful.flatMap((plan) => plan.addRows || plan.additions || [])),
    removeRows: uniqueObjects(successful.flatMap((plan) => plan.removeRows || plan.removals || [])),
    renameFunctions: uniqueObjects(successful.flatMap((plan) => plan.renameFunctions || plan.renames || [])),
    questions: [
      ...successful.flatMap((plan) => Array.isArray(plan.questions) ? plan.questions : []),
      ...(Array.isArray(failures) ? failures : []).map((failure) => `Revision batch ${failure.batchNumber} could not be completed: ${failure.message}`),
    ],
  };
}
