const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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

const FIELD_LABELS = Object.freeze({
  subsystem: "Subsystem",
  fromFunction: "Function (From)",
  fromDetails: "Function (From) Details",
  controlAction: "Control Action",
  controlDetails: "Control Action Details",
  toFunction: "Function (To)",
  toDetails: "Function (To) Details",
});

const aliases = Object.freeze({
  subsystem: ["subsystem", "subsystem allocation"],
  fromFunction: ["from function", "function from", "function (from)", "source function"],
  fromDetails: ["from details", "function from details", "function (from) details", "source details"],
  controlAction: ["control action", "interface", "exchange", "flow"],
  controlDetails: ["control details", "control action details", "interface details", "exchange details"],
  toFunction: ["to function", "function to", "function (to)", "receiving function", "destination function"],
  toDetails: ["to details", "function to details", "function (to) details", "receiving details", "destination details"],
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
    || /\bdecomposition rows?\b/.test(text);
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

export function resolveFunctionalVibeReviewScope(prompt = "", functionalRows = []) {
  const rows = (Array.isArray(functionalRows) ? functionalRows : []).filter((entry) => entry?.rowId && entry?.row);
  if (!rows.length) return { status: "missing_rows", rows: [], queue: [], scopeLabel: "the active functional decomposition" };
  const promptKey = key(prompt);
  const filters = [];
  const ambiguous = [];
  const candidates = [
    ["subsystem", /\bsubsystem\b/],
    ["fromFunction", /\b(?:function from|from function|source function)\b/],
    ["toFunction", /\b(?:function to|to function|receiving function|destination function)\b/],
    ["controlAction", /\b(?:control action|interface|exchange|flow)\b/],
  ];

  candidates.forEach(([field, marker]) => {
    if (!marker.test(promptKey)) return;
    const values = uniqueValues(rows, field);
    const matches = values.filter((value) => mentioned(promptKey, value));
    if (matches.length === 1) filters.push({ field, label: FIELD_LABELS[field], value: matches[0] });
    else if (matches.length > 1) ambiguous.push({ field, label: FIELD_LABELS[field], values: matches });
  });

  const explicitRowNumber = promptKey.match(/\brow\s+(\d+)\b/)?.[1];
  if (explicitRowNumber) {
    const rowIndex = Number(explicitRowNumber) - 1;
    const match = rows.find((entry) => entry.rowIndex === rowIndex);
    return match
      ? { status: "matched", rows: [match], queue: [match.rowId], filters: [{ field: "rowIndex", label: "Row", value: String(rowIndex + 1) }], scopeLabel: `Row ${rowIndex + 1}` }
      : { status: "zero", rows: [], queue: [], filters: [], scopeLabel: `Row ${explicitRowNumber}` };
  }

  if (ambiguous.length) return { status: "ambiguous", rows: [], queue: [], filters, ambiguous };
  const matchedRows = rows.filter((entry) => filters.every((filter) => key(entry.row?.[filter.field]) === key(filter.value)));
  return {
    status: matchedRows.length ? "matched" : "zero",
    rows: matchedRows,
    queue: matchedRows.map((entry) => entry.rowId),
    filters,
    scopeLabel: filters.length
      ? filters.map((filter) => `${filter.label} = ${filter.value}`).join("; ")
      : "all functional-decomposition rows",
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
  const proposedRow = Object.fromEntries(FUNCTIONAL_ROW_FIELDS.map((field) => [field, readAlias(proposedSource, field)]));
  const changedFields = FUNCTIONAL_ROW_FIELDS.filter((field) => clean(currentRow?.[field]) !== proposedRow[field]);
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

