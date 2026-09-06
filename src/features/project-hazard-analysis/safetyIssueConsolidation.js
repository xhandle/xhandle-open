const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function cell(cells = {}, patterns = []) {
  const entry = Object.entries(cells).find(([label]) => patterns.some((pattern) => pattern.test(clean(label))));
  return clean(entry?.[1]);
}

function unique(values = []) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function truncate(value, length = 110) {
  const text = clean(value);
  return text.length > length ? `${text.slice(0, length - 1).trim()}…` : text;
}

function sourceFamilyIdentity(item = {}) {
  const cells = item.cells || {};
  const from = cell(cells, [/^Function \(From\)$/i, /^From Function$/i, /^Controller$/i]);
  const action = cell(cells, [/^Control Action$/i, /^Action$/i]);
  const to = cell(cells, [/^Function \(To\)$/i, /^To Function$/i, /^Controlled Process$/i]);
  const subsystem = cell(cells, [/^Subsystem Allocation$/i, /^Subsystem$/i]);
  // A safety issue is an actionable engineering concern, not a single hazard
  // worksheet permutation. Guide phrases, scenarios, and modes describe the
  // ways one safety-significant interface can become unsafe, so they remain
  // traceable variants inside the issue instead of creating separate issues.
  const architectureParts = [subsystem, from, action, to];
  if (architectureParts.some(Boolean)) {
    return architectureParts.map(normalize).join("::");
  }

  // Imported analyses may not contain xHandle's architecture columns. In that
  // case, use the context-invariant hazard/failure concept as the family.
  return [
    cell(cells, [/^Hazards?$/i, /^Unsafe Control Actions?$/i, /^Failure Mode$/i, /^Hazardous Event$/i]),
    cell(cells, [/^Item \/ Function$/i, /^Function$/i]),
  ].map(normalize).join("::") || `source:${Number(item.sourceIndex) || 0}`;
}

export function buildSafetyIssueSourceFamilies(safetyRows = []) {
  const familiesByKey = new Map();
  (Array.isArray(safetyRows) ? safetyRows : []).forEach((item) => {
    const sourceIndex = Number(item?.sourceIndex);
    if (!Number.isFinite(sourceIndex) || sourceIndex <= 0) return;
    const key = sourceFamilyIdentity(item);
    const family = familiesByKey.get(key) || {
      familyId: `family-${familiesByKey.size + 1}`,
      key,
      sourceIndexes: [],
      rows: [],
    };
    family.sourceIndexes.push(sourceIndex);
    family.rows.push(item);
    familiesByKey.set(key, family);
  });
  return Array.from(familiesByKey.values()).map((family) => ({
    ...family,
    sourceIndexes: Array.from(new Set(family.sourceIndexes)).sort((a, b) => a - b),
  }));
}

function deterministicIssueForFamily(family, index = 0) {
  const firstCells = family.rows[0]?.cells || {};
  const from = cell(firstCells, [/^Function \(From\)$/i, /^From Function$/i, /^Controller$/i]);
  const action = cell(firstCells, [/^Control Action$/i, /^Action$/i]);
  const to = cell(firstCells, [/^Function \(To\)$/i, /^To Function$/i, /^Controlled Process$/i]);
  const guidePhrase = cell(firstCells, [/^Guide Phrase$/i, /^Guide Word$/i, /^Guideword/i]);
  const guidePhrases = unique(family.rows.map((item) => cell(item.cells, [
    /^Guide Phrase$/i,
    /^Guide Word$/i,
    /^Guideword/i,
  ])));
  const hazards = unique(family.rows.map((item) => cell(item.cells, [
    /^Hazards?$/i,
    /^Unsafe Control Actions?$/i,
    /^Failure Mode$/i,
    /^Hazardous Event$/i,
  ])));
  const contexts = unique(family.rows.map((item) => {
    const scenario = cell(item.cells, [/^Operational Scenario$/i, /^Scenario$/i]);
    const mode = cell(item.cells, [/^Operational Mode$/i, /^Mode$/i]);
    return [scenario, mode].filter(Boolean).join(" · ");
  }));
  const interfaceLabel = [from, action, to].filter(Boolean).join(" → ");
  const title = hazards.length === 1
    ? hazards[0]
    : `Unsafe ${action || "system behavior"}${from || to ? ` involving ${from || to}` : ""}`;
  const contextText = contexts.length === 1 ? "one operational context" : `${contexts.length || family.rows.length} operational contexts`;
  const hazardText = hazards.length
    ? ` Documented hazardous outcomes include ${hazards.slice(0, 4).join("; ")}.`
    : "";
  return {
    title: truncate(title || `Consolidated Safety Issue ${index + 1}`),
    description: truncate(
      `${interfaceLabel || "The analyzed function"} presents a consolidated safety concern across ${contextText}`
        + `${guidePhrases.length ? ` and ${guidePhrases.length} unsafe-action variation${guidePhrases.length === 1 ? "" : "s"}` : (guidePhrase ? ` under the guide phrase “${guidePhrase}”` : "")}.`
        + hazardText,
      700
    ),
    likelihood: 3,
    severity: 3,
    status: "Open",
    owner: "",
    dueDate: "",
    tags: "",
    sourceIndexes: family.sourceIndexes,
    contextVariants: [],
  };
}

export function buildDeterministicConsolidatedSafetyIssues(safetyRows = []) {
  return buildSafetyIssueSourceFamilies(safetyRows).map(deterministicIssueForFamily);
}

export function assessLLMConsolidationCoverage(proposedIssues = [], safetyRows = []) {
  const allowedIndexes = new Set((Array.isArray(safetyRows) ? safetyRows : [])
    .map((item) => Number(item?.sourceIndex))
    .filter((sourceIndex) => Number.isFinite(sourceIndex) && sourceIndex > 0));
  const issues = (Array.isArray(proposedIssues) ? proposedIssues : [])
    .map((issue) => ({
      ...issue,
      sourceIndexes: Array.from(new Set((Array.isArray(issue?.sourceIndexes) ? issue.sourceIndexes : [])
        .map(Number)
        .filter((sourceIndex) => allowedIndexes.has(sourceIndex))))
        .sort((left, right) => left - right),
    }))
    .filter((issue) => issue.sourceIndexes.length);
  const represented = new Set(issues.flatMap((issue) => issue.sourceIndexes));
  const missingSourceIndexes = Array.from(allowedIndexes)
    .filter((sourceIndex) => !represented.has(sourceIndex))
    .sort((left, right) => left - right);
  return {
    issues,
    missingSourceIndexes,
    coverageComplete: allowedIndexes.size > 0 && missingSourceIndexes.length === 0,
  };
}

export function enforceSafetyIssueFamilyConsolidation(proposedIssues = [], safetyRows = []) {
  const families = buildSafetyIssueSourceFamilies(safetyRows);
  if (!families.length) return [];
  const allowedIndexes = new Set(families.flatMap((family) => family.sourceIndexes));
  const issues = (Array.isArray(proposedIssues) ? proposedIssues : [])
    .map((issue) => ({
      ...issue,
      sourceIndexes: Array.from(new Set((Array.isArray(issue?.sourceIndexes) ? issue.sourceIndexes : [])
        .map(Number)
        .filter((sourceIndex) => allowedIndexes.has(sourceIndex))))
        .sort((a, b) => a - b),
    }))
    .filter((issue) => issue.sourceIndexes.length);
  if (!issues.length) return buildDeterministicConsolidatedSafetyIssues(safetyRows);

  const parent = issues.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  families.forEach((family) => {
    const familySources = new Set(family.sourceIndexes);
    const touching = issues
      .map((issue, index) => issue.sourceIndexes.some((sourceIndex) => familySources.has(sourceIndex)) ? index : -1)
      .filter((index) => index >= 0);
    touching.slice(1).forEach((index) => union(touching[0], index));
  });

  const components = new Map();
  issues.forEach((issue, index) => {
    const root = find(index);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(issue);
  });

  const representedSources = new Set();
  const consolidated = Array.from(components.values()).map((component) => {
    const componentSources = new Set(component.flatMap((issue) => issue.sourceIndexes));
    const touchedFamilies = families.filter((family) => family.sourceIndexes.some((sourceIndex) => componentSources.has(sourceIndex)));
    touchedFamilies.forEach((family) => family.sourceIndexes.forEach((sourceIndex) => componentSources.add(sourceIndex)));
    const sourceIndexes = Array.from(componentSources).sort((a, b) => a - b);
    sourceIndexes.forEach((sourceIndex) => representedSources.add(sourceIndex));

    const primary = [...component].sort((left, right) => right.sourceIndexes.length - left.sourceIndexes.length)[0];
    const highestRisk = [...component].sort((left, right) => (
      (Number(right.likelihood) || 3) * (Number(right.severity) || 3)
      - (Number(left.likelihood) || 3) * (Number(left.severity) || 3)
    ))[0];
    const exactSingleFamily = touchedFamilies.length === 1
      && sourceIndexes.length === touchedFamilies[0].sourceIndexes.length;
    const familyFallback = exactSingleFamily ? deterministicIssueForFamily(touchedFamilies[0]) : null;
    return {
      ...primary,
      title: familyFallback?.title || primary.title,
      description: familyFallback?.description || primary.description,
      likelihood: Number(highestRisk.likelihood) || 3,
      severity: Number(highestRisk.severity) || 3,
      tags: unique(component.flatMap((issue) => clean(issue.tags).split(","))).join(", "),
      sourceIndexes,
      contextVariants: component.flatMap((issue) => Array.isArray(issue.contextVariants) ? issue.contextVariants : []),
    };
  });

  families.forEach((family, index) => {
    if (family.sourceIndexes.some((sourceIndex) => representedSources.has(sourceIndex))) return;
    consolidated.push(deterministicIssueForFamily(family, index));
  });
  return consolidated;
}
