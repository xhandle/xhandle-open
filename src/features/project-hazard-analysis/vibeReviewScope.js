const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const VIBE_REVIEW_COLUMNS = Object.freeze({
  safetySignificant: ["Safety Significant", "Safety Significance"],
  safetyClassification: ["Safety Classification", "Classification"],
  guidePhraseApplicable: ["Guide Phrase Applicable", "Applicability"],
  subsystem: ["Subsystem Allocation", "Subsystem"],
  from: ["Function (From)", "From Function", "Controller"],
  to: ["Function (To)", "To Function", "Controlled Process"],
  controlAction: ["Control Action", "Action", "Unsafe Control Action"],
  guidePhrase: ["Guide Phrase", "Guideword", "Guide Word"],
  scenario: ["Operational Scenario", "Scenario", "Operating Scenario", "Operational Context"],
  mode: ["Operational Mode", "Mode", "System Mode"],
  rawRowId: ["Raw Analysis Row ID", "Raw Row ID", "Analysis Row ID", "Row ID"],
});

export function isHazardVibeReviewIntent(value = "") {
  const text = key(value);
  if (!/\b(?:review|walk|go)\b/.test(text)) return false;
  return /\bvi(?:b|v)e review\b/.test(text)
    || /\breview (?:these |the )?(?:hazard|safety)(?: analysis)? (?:results?|rows?)\b/.test(text)
    || /\breview\b.*\b(?:safety significance|safety significant|safety classification|needs review)\b/.test(text)
    || /\bwalk me through\b.*\b(?:hazard|safety significance|needs review)\b/.test(text)
    || /\bgo through\b.*\b(?:hazard|safety significance|needs review)\b/.test(text);
}

export function indexVibeReviewHeaders(headers = []) {
  const result = {};
  Object.entries(VIBE_REVIEW_COLUMNS).forEach(([name, aliases]) => {
    result[name] = headers.findIndex((header) => aliases.some((alias) => key(header) === key(alias)));
  });
  return result;
}

function uniqueValues(summary, columnIndex) {
  if (columnIndex < 0) return [];
  return Array.from(new Set(summary.slice(1).map((row) => clean(row?.[columnIndex])).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

function valueMention(promptKey, value) {
  const candidate = key(value);
  return candidate && (promptKey.includes(candidate) || candidate.split(" ").every((part) => promptKey.includes(part)));
}

function safetySignificanceMatches(promptKey, values) {
  const byKey = new Map(values.map((value) => [key(value), value]));
  // "Propose Yes or No" describes the review interaction, not additional row
  // filters. Prefer the explicit review-state phrase when it is present.
  if (/\bneeds? review\b/.test(promptKey) && byKey.has("needs review")) {
    return [byKey.get("needs review")];
  }
  const explicitValue = promptKey.match(
    /\bsafety (?:significant|significance)(?:\s+(?:is|equals|equal to|marked|set to|of))?\s*[:=]?\s*(yes|no)\b/,
  )?.[1];
  return explicitValue && byKey.has(explicitValue) ? [byKey.get(explicitValue)] : [];
}

export function resolveHazardVibeReviewScope(prompt = "", summary = []) {
  if (!Array.isArray(summary?.[0])) return { status: "missing_summary", filters: [], rows: [], nearbyValues: {} };
  const headers = summary[0];
  const indexes = indexVibeReviewHeaders(headers);
  const promptKey = key(prompt);
  const filters = [];
  const ambiguous = [];
  const unmatched = [];
  const nearbyValues = {};
  const explicitColumns = [
    ["safetySignificant", /\bsafety significant|safety significance\b/],
    ["safetyClassification", /\bsafety classification|classification\b/],
    ["guidePhraseApplicable", /\bguide phrase applicable|applicability\b/],
    ["subsystem", /\bsubsystem(?: allocation)?\b/],
    ["from", /\bfunction from|from function|controller\b/],
    ["to", /\bfunction to|to function|controlled process\b/],
    ["controlAction", /\bcontrol action|unsafe control action|uca\b/],
    ["guidePhrase", /\bguide phrase|guideword\b/],
    ["scenario", /\boperational scenario|scenario|operational context\b/],
    ["mode", /\boperational mode|system mode\b/],
    ["rawRowId", /\braw analysis row id|raw row id|analysis row id|row id\b/],
  ];

  explicitColumns.forEach(([name, marker]) => {
    if (!marker.test(promptKey) || indexes[name] < 0) return;
    // "Guide Phrase Applicable" is one field, not a request to also filter
    // the distinct Guide Phrase column.
    if (name === "guidePhrase" && /\bguide phrase applicable|guide phrase applicability\b/.test(promptKey)) return;
    const values = uniqueValues(summary, indexes[name]);
    nearbyValues[name] = values;
    let matches = values.filter((value) => valueMention(promptKey, value));
    if (name === "safetySignificant") {
      matches = safetySignificanceMatches(promptKey, values);
    }
    if (matches.length === 1) filters.push({ field: name, header: headers[indexes[name]], value: matches[0] });
    else if (matches.length > 1) ambiguous.push({ field: name, values: matches });
    else unmatched.push({ field: name, values: values.slice(0, 8) });
  });

  // "Needs Review rows" is sufficiently canonical even when the column is omitted.
  if (!filters.some((filter) => filter.field === "safetySignificant")
    && !filters.some((filter) => key(filter.value) === "needs review")
    && indexes.safetySignificant >= 0 && /\bneeds? review\b/.test(promptKey)) {
    const actual = uniqueValues(summary, indexes.safetySignificant).find((value) => key(value) === "needs review");
    if (actual) filters.push({ field: "safetySignificant", header: headers[indexes.safetySignificant], value: actual });
  }

  if (ambiguous.length) return { status: "ambiguous", filters, ambiguous, rows: [], nearbyValues, indexes };
  if (unmatched.length) return { status: "zero", filters, unmatched, rows: [], queue: [], nearbyValues,
    indexes, scopeLabel: `the requested ${unmatched.map((item) => item.field).join(" and ")} value` };
  const explicitlyAllRows = /\b(?:all|every)\b.*\b(?:hazard(?: analysis)?|results?|rows?|line items?)\b/.test(promptKey)
    || /\b(?:hazard(?: analysis)?|results?|rows?|line items?)\b.*\b(?:all|every)\b/.test(promptKey);
  if (!filters.length && !explicitlyAllRows) {
    return { status: "needs_scope", filters, rows: [], queue: [], nearbyValues, indexes };
  }
  const matchedRows = summary.slice(1).map((row, offset) => ({ row, rowIndex: offset + 1 })).filter(({ row }) => (
    filters.every((filter) => key(row?.[indexes[filter.field]]) === key(filter.value))
  ));
  const seen = new Set();
  const rows = matchedRows.filter(({ row }) => {
    const id = clean(row?.[indexes.rawRowId]);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return {
    status: rows.length ? "matched" : "zero",
    filters,
    rows,
    queue: rows.map(({ row }) => clean(row[indexes.rawRowId])),
    nearbyValues,
    indexes,
    scopeLabel: filters.length ? filters.map((filter) => `${filter.header} = ${filter.value}`).join("; ") : "all hazard-analysis rows",
  };
}

export function describeScopeResolution(result = {}) {
  if (result.status === "needs_scope") {
    return "What part of the hazard analysis should I review? For example: Safety Significant = Needs Review, Guide Phrase Applicable = Needs Review, a subsystem, a function, a control action, a scenario/mode, a Raw Analysis Row ID, or explicitly all rows.";
  }
  if (result.status === "ambiguous") {
    const issue = result.ambiguous?.[0];
    return `Which ${issue?.field || "hazard-analysis value"} should I use?${issue?.values?.length ? ` Choose one of: ${issue.values.join(", ")}.` : ""}`;
  }
  if (result.status === "zero") {
    const nearby = Object.values(result.nearbyValues || {}).flat().slice(0, 8);
    return `No hazard-analysis rows match ${result.scopeLabel || "that scope"}.${nearby.length ? ` Available nearby values: ${nearby.join(", ")}.` : ""}`;
  }
  return `${result.queue?.length || 0} row${result.queue?.length === 1 ? "" : "s"} match ${result.scopeLabel || "the requested scope"}.`;
}
