const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CUSTOM_SCOPE_MARKER = /user(?:\s+|-)specified scope\s*:?\s*(.+)$/i;
const SCOPE_STOP_WORDS = new Set([
  "all", "any", "column", "current", "decomposition", "for", "from", "function", "functional",
  "in", "interface", "interfaces", "is", "item", "items", "matching", "of", "or", "related", "review",
  "row", "rows", "scope", "specified", "that", "the", "these", "this", "through", "to", "user", "value",
  "values", "where", "with", "within", "subsystem", "control", "action", "details",
]);

function customScopeDetails(prompt = "") {
  const raw = clean(String(prompt || "").match(CUSTOM_SCOPE_MARKER)?.[1] || "");
  const normalized = key(raw);
  const rangeMatch = raw.toLowerCase().match(/\brows?\s+(\d+)\s*(?:through|to|-)\s*(\d+)\b/);
  const range = rangeMatch
    ? [Math.min(Number(rangeMatch[1]), Number(rangeMatch[2])), Math.max(Number(rangeMatch[1]), Number(rangeMatch[2]))]
    : null;
  const tokens = Array.from(new Set(normalized.split(" ").filter((token) => (
    token.length >= 2 && !SCOPE_STOP_WORDS.has(token) && !/^\d+$/.test(token)
  ))));
  return { raw, range, tokens };
}

export const FUNCTIONAL_VIBE_REVIEW_ID_FIELD = "_functionalVibeReviewId";

export const FUNCTIONAL_ROW_FIELDS = Object.freeze([
  "subsystem",
  "fromFunction",
  "fromDetails",
  "controlAction",
  "controlDetails",
  "toFunction",
  "toDetails",
]);

export const FUNCTIONAL_ARCHITECTURE_FIELDS = Object.freeze([
  "csci",
  "csc",
  "csu",
  "architectureRationale",
]);

export const FUNCTIONAL_REVIEW_FIELDS = Object.freeze([
  ...FUNCTIONAL_ROW_FIELDS,
  ...FUNCTIONAL_ARCHITECTURE_FIELDS,
]);

const FIELD_LABELS = Object.freeze({
  subsystem: "Subsystem",
  fromFunction: "Function (From)",
  fromDetails: "Function (From) Details",
  controlAction: "Control Action",
  controlDetails: "Control Action Details",
  toFunction: "Function (To)",
  toDetails: "Function (To) Details",
  csci: "CSCI",
  csc: "CSC",
  csu: "CSU",
  architectureRationale: "Architecture Rationale",
});

const aliases = Object.freeze({
  subsystem: ["subsystem", "subsystem allocation"],
  fromFunction: ["from function", "function from", "function (from)", "source function"],
  fromDetails: ["from details", "function from details", "function (from) details", "source details"],
  controlAction: ["control action", "interface", "exchange", "flow"],
  controlDetails: ["control details", "control action details", "interface details", "exchange details"],
  toFunction: ["to function", "function to", "function (to)", "receiving function", "destination function"],
  toDetails: ["to details", "function to details", "function (to) details", "receiving details", "destination details"],
  csci: ["csci", "computer software configuration item"],
  csc: ["csc", "computer software component"],
  csu: ["csu", "computer software unit"],
  architectureRationale: ["architecture rationale", "allocation rationale"],
});

function createRowId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID?.())
    ? `FDR-${crypto.randomUUID()}`
    : `FDR-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ensureFunctionalVibeReviewRowIds(rows = []) {
  let changed = false;
  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    if (clean(row?.[FUNCTIONAL_VIBE_REVIEW_ID_FIELD])) return row;
    changed = true;
    return { ...row, [FUNCTIONAL_VIBE_REVIEW_ID_FIELD]: createRowId() };
  });
  return { rows: nextRows, changed };
}

export function isFunctionalVibeReviewIntent(value = "") {
  const text = key(value);
  const functional = /\bfunctional (?:decomposition|architecture|interfaces?|rows?)\b/.test(text)
    || /\bdecomposition rows?\b/.test(text)
    || /\b(?:csci|csc|csu)(?: column)?(?: items?| rows?| allocations?)?\b/.test(text);
  if (!functional) return false;
  return /\bvi(?:b|v)e review\b/.test(text)
    || /\b(?:walk me through|go through)\b.*\b(?:one at a time|row by row|interface by interface)\b/.test(text)
    || /\breview\b.*\b(?:one at a time|row by row|interface by interface)\b/.test(text);
}

function uniqueValues(rows, field) {
  return Array.from(new Set(rows.map((entry) => clean(entry?.row?.[field])).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

function mentioned(promptKey, value) {
  const candidate = key(value);
  return candidate && (promptKey.includes(candidate) || candidate.split(" ").every((part) => promptKey.includes(part)));
}

function exactlyMentioned(promptKey, value) {
  const candidate = key(value);
  return Boolean(candidate && ` ${promptKey} `.includes(` ${candidate} `));
}

export function resolveFunctionalVibeReviewScope(prompt = "", functionalRows = []) {
  const rows = (Array.isArray(functionalRows) ? functionalRows : []).filter((entry) => entry?.rowId && entry?.row);
  if (!rows.length) return { status: "missing_rows", rows: [], queue: [], scopeLabel: "the active functional decomposition" };
  const promptKey = key(prompt);
  const customScope = customScopeDetails(prompt);
  const filters = [];
  const ambiguous = [];
  const candidates = [
    ["subsystem", /\bsubsystem\b/],
    ["fromFunction", /\b(?:function from|from function|source function)\b/],
    ["toFunction", /\b(?:function to|to function|receiving function|destination function)\b/],
    ["controlAction", /\b(?:control action|interface|exchange|flow)\b/],
    ["csci", /\b(?:csci|computer software configuration item)\b/],
    ["csc", /\b(?:csc|computer software component)\b/],
    ["csu", /\b(?:csu|computer software unit)\b/],
  ];
  const requestedColumn = candidates.find(([, marker]) => marker.test(promptKey))?.[0] || "";

  candidates.forEach(([field, marker]) => {
    if (!marker.test(promptKey)) return;
    const values = uniqueValues(rows, field);
    const exactMatches = values.filter((value) => exactlyMentioned(promptKey, value));
    const matches = exactMatches.length ? exactMatches : values.filter((value) => mentioned(promptKey, value));
    if (matches.length === 1) filters.push({ field, label: FIELD_LABELS[field], value: matches[0] });
    else if (matches.length > 1) ambiguous.push({ field, label: FIELD_LABELS[field], values: matches });
  });

  if (customScope.range) {
    const rangedRows = rows.filter((entry) => {
      const rowNumber = entry.rowIndex + 1;
      return rowNumber >= customScope.range[0] && rowNumber <= customScope.range[1];
    });
    return {
      status: rangedRows.length ? "matched" : "zero",
      rows: rangedRows,
      queue: rangedRows.map((entry) => entry.rowId),
      filters: [{ field: "rowRange", label: "Rows", value: `${customScope.range[0]}-${customScope.range[1]}` }],
      scopeLabel: customScope.raw,
    };
  }

  const explicitRowNumber = promptKey.match(/\brow\s+(\d+)\b/)?.[1];
  if (explicitRowNumber) {
    const rowIndex = Number(explicitRowNumber) - 1;
    const match = rows.find((entry) => entry.rowIndex === rowIndex);
    return match
      ? { status: "matched", rows: [match], queue: [match.rowId], filters: [{ field: "rowIndex", label: "Row", value: String(rowIndex + 1) }], scopeLabel: `Row ${rowIndex + 1}` }
      : { status: "zero", rows: [], queue: [], filters: [], scopeLabel: `Row ${explicitRowNumber}` };
  }

  if (ambiguous.length) return { status: "ambiguous", rows: [], queue: [], filters, ambiguous };
  const matchedRows = rows.filter((entry) => {
    if (!filters.every((filter) => key(entry.row?.[filter.field]) === key(filter.value))) return false;
    if (customScope.tokens.length) {
      const rowText = key(FUNCTIONAL_REVIEW_FIELDS.map((field) => entry.row?.[field] || "").join(" "));
      if (!customScope.tokens.every((token) => rowText.includes(token))) return false;
    }
    return true;
  });
  return {
    status: matchedRows.length ? "matched" : "zero",
    rows: matchedRows,
    queue: matchedRows.map((entry) => entry.rowId),
    filters,
    scopeLabel: customScope.raw || (filters.length
      ? filters.map((filter) => `${filter.label} = ${filter.value}`).join("; ")
      : requestedColumn ? `${FIELD_LABELS[requestedColumn]} column items` : "all functional-decomposition rows"),
  };
}

export function describeFunctionalVibeReviewScope(result = {}) {
  if (result.status === "missing_rows") return "The active project does not contain functional-decomposition rows to review.";
  if (result.status === "ambiguous") {
    const issue = result.ambiguous?.[0];
    return `Which ${issue?.label || "functional-decomposition value"} should I review?${issue?.values?.length ? ` Choose one of: ${issue.values.join(", ")}.` : ""}`;
  }
  if (result.status === "zero") return `No functional-decomposition rows match ${result.scopeLabel || "that scope"}.`;
  return `${result.queue?.length || 0} functional-decomposition row${result.queue?.length === 1 ? "" : "s"} match ${result.scopeLabel}.`;
}

function readAlias(source, field) {
  if (!source || typeof source !== "object") return "";
  const match = Object.keys(source).find((sourceKey) => (
    key(sourceKey) === key(field) || aliases[field].some((alias) => key(sourceKey) === key(alias))
  ));
  return clean(match ? source[match] : "");
}

export function normalizeCodeArchitectureFunctionalReviewRow(row = {}) {
  const architecture = row?.architecture || {};
  return {
    subsystem: clean(architecture.subsystem || row.subsystem),
    fromFunction: clean(row.from || row.fromFunction),
    fromDetails: clean(row.fromDetails || row.fromFunctionDetails),
    controlAction: clean(row.action || row.controlAction),
    controlDetails: clean(row.controlActionDetails || row.controlDetails),
    toFunction: clean(row.to || row.toFunction),
    toDetails: clean(row.toDetails || row.toFunctionDetails),
    csci: clean(architecture.csci || row.csci),
    csc: clean(architecture.csc || row.csc),
    csu: clean(architecture.csu || row.csu),
    architectureRationale: clean(architecture.rationale || row.architectureRationale),
  };
}

export function applyFunctionalReviewToCodeArchitectureRow(row = {}, proposedRow = {}) {
  return {
    ...row,
    from: clean(proposedRow.fromFunction),
    fromDetails: clean(proposedRow.fromDetails),
    action: clean(proposedRow.controlAction),
    controlActionDetails: clean(proposedRow.controlDetails),
    to: clean(proposedRow.toFunction),
    toDetails: clean(proposedRow.toDetails),
    architecture: {
      ...(row.architecture || {}),
      subsystem: clean(proposedRow.subsystem),
      csci: clean(proposedRow.csci ?? row.architecture?.csci ?? row.csci),
      csc: clean(proposedRow.csc ?? row.architecture?.csc ?? row.csc),
      csu: clean(proposedRow.csu ?? row.architecture?.csu ?? row.csu),
      rationale: clean(proposedRow.architectureRationale ?? row.architecture?.rationale ?? row.architectureRationale),
    },
  };
}

export function normalizeFunctionalVibeReviewProposal(raw = {}, currentRow = {}) {
  const source = raw?.proposal || raw?.assessment || raw?.review || raw?.data || raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { valid: false, errors: ["The provider did not return a structured functional review proposal."], proposal: {} };
  }
  const rawDecision = key(source.decision || source.assessment || source.recommendation || source.disposition);
  const decision = /\b(?:keep|sound|accept|approve|valid|no change)\b/.test(rawDecision)
    ? "Keep"
    : /\b(?:revise|update|edit|correct|change)\b/.test(rawDecision)
      ? "Revise"
      : /\b(?:remove|delete|duplicate|redundant|invalid)\b/.test(rawDecision)
        ? "Remove"
        : "Needs Input";
  const proposedSource = source.proposedRow || source.revisedRow || source.revision || source.row || {};
  const proposedRow = Object.fromEntries(FUNCTIONAL_REVIEW_FIELDS.map((field) => [
    field,
    readAlias(proposedSource, field) || (FUNCTIONAL_ARCHITECTURE_FIELDS.includes(field) ? clean(currentRow?.[field]) : ""),
  ]));
  const changedFields = decision === "Revise"
    ? FUNCTIONAL_REVIEW_FIELDS.filter((field) => clean(currentRow?.[field]) !== proposedRow[field])
    : [];
  const errors = [];
  if (decision === "Revise") {
    const missing = FUNCTIONAL_ROW_FIELDS.filter((field) => !proposedRow[field]);
    if (missing.length) errors.push(`The proposed revision omitted: ${missing.map((field) => FIELD_LABELS[field]).join(", ")}.`);
    if (!changedFields.length) errors.push("The proposed revision does not change the row.");
  }
  if (decision === "Needs Input") errors.push("The proposal did not contain a supported Keep, Revise, or Remove decision.");
  const proposal = {
    decision,
    explanation: clean(source.explanation || source.summary || source.assessmentSummary),
    rationale: clean(source.rationale || source.reason || source.engineeringRationale),
    confidence: clean(source.confidence || "Medium"),
    issues: (Array.isArray(source.issues) ? source.issues : []).map(clean).filter(Boolean),
    proposedRow: decision === "Revise" ? proposedRow : null,
    changedFields,
    remainingQuestion: clean(source.remainingQuestion || source.evidenceGap || source.needsInput),
  };
  return { valid: errors.length === 0, errors, proposal };
}

export function functionalRowLabel(row = {}) {
  return [row.fromFunction, row.controlAction, row.toFunction].map(clean).filter(Boolean).join(" → ") || "Functional-decomposition row";
}
