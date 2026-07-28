import { makeSafetyRemediationId, extractJsonArray, normalizeSafetyFinding, codeReferencesFromEvidence } from "./safetyRemediationUtils";
import { compactPatchFinding } from "./safetyRemediationSourceContext";
import { buildAIAuthOpts } from "../../components/backendConfig";

async function callSafetyRemediationAI(prompt, { temperature = 0.2 } = {}) {
  const response = await fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prompt, temperature, max_tokens: 3500 }),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const payload = text ? JSON.parse(text) : null;
      message = payload?.error || payload?.message || payload?.detail || text;
    } catch {}
    if ([502, 503, 504].includes(response.status)) {
      throw new Error(message || `AI provider is temporarily unavailable (${response.status}). Try generating the patch again in a moment or choose a different model in Settings.`);
    }
    throw new Error(message || `AI request failed (${response.status})`);
  }
  const json = await response.json();
  return String(json.result || json.choices?.[0]?.message?.content || "").trim();
}

function pickHazardField(row, names) {
  const keys = Object.keys(row || {});
  for (const name of names) {
    const key = keys.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key && row[key]) return String(row[key]);
  }
  return "";
}

function compactHazardAnalysisSheets(generatedSheets = {}) {
  return Object.entries(generatedSheets || {}).reduce((acc, [name, sheet]) => {
    if (!Array.isArray(sheet)) return acc;
    acc[name] = sheet.slice(0, 12);
    return acc;
  }, {});
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI returned an empty response.");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  return JSON.parse(jsonText);
}

function estimatePromptChars({ finding, codeReferences, sourceSnippets, overhead = 7000 }) {
  return JSON.stringify(compactPatchFinding(finding || {})).length +
    JSON.stringify(codeReferences || []).length +
    JSON.stringify(sourceSnippets || []).length +
    overhead;
}

function chunkSourceSnippetsForPatch({ finding, codeReferences = [], sourceSnippets = [], maxPromptChars = 42000 }) {
  const snippets = Array.isArray(sourceSnippets) ? sourceSnippets : [];
  if (!snippets.length) return [];
  const groups = [];
  let current = [];
  for (const snippet of snippets) {
    const next = [...current, snippet];
    if (current.length && estimatePromptChars({ finding, codeReferences, sourceSnippets: next }) > maxPromptChars) {
      groups.push(current);
      current = [snippet];
    } else {
      current = next;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function failurePatchProposal({ finding, reason, codeReferences = [], sourceSnippets = [], sourceDiagnostics = [], missingContext = [] }) {
  const filesChanged = Array.from(new Set((codeReferences || []).map((ref) => ref.filePath).filter(Boolean)));
  const workspaceRoots = Array.from(new Set((sourceSnippets || [])
    .map((snippet) => snippet.workspaceRoot)
    .filter(Boolean)));
  return {
    id: makeSafetyRemediationId("patch"),
    safetyFindingId: finding.id,
    title: `Patch generation failed for ${finding.title}`,
    summary: reason || "xHandle could not generate a source-grounded patch from the available evidence.",
    unifiedDiff: "",
    filesChanged,
    testRecommendations: sourceSnippets.length
      ? ["Review the referenced source snippets and generate the patch again with narrower code references if needed."]
      : ["Rerun code-based architecture analysis with source indexing enabled, then regenerate this patch."],
    safetyRationale: "No patch is proposed because xHandle could not ground the remediation in source code context.",
    generatedBy: "failed",
    reviewStatus: "needs_more_info",
    projectId: finding.projectId || "",
    repoId: finding.repoId || "",
    hazardAnalysisRunId: finding.hazardAnalysisRunId || "",
    hazardAnalysisMethod: finding.hazardAnalysisMethod || "",
    architectureSnapshotHash: finding.architectureSnapshotHash || "",
    sourceContextStatus: sourceSnippets.length ? "available_but_generation_failed" : "missing_source_context",
    sourceDiagnostics,
    workspaceRoots,
    missingContext,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function generatePatchProposalForSnippetGroup({ finding, codeReferences = [], sourceSnippets = [], chunkIndex = 0, chunkCount = 1 }) {
  const prompt = `
Generate a proposed source patch as a unified diff for human review.
Use only the supplied source snippets and safety context. Do not invent files, functions, line ranges, APIs, tests, or behavior not visible in the snippets.
If the snippets are insufficient to make a source-grounded change, return an empty unifiedDiff and explain what source context is missing.
Do not claim the patch has been applied. Do not include shell commands.

Patch context chunk: ${chunkIndex + 1} of ${chunkCount}

Safety finding:
${JSON.stringify(compactPatchFinding(finding), null, 2)}

Code references:
${JSON.stringify(codeReferences, null, 2)}

Available source snippets with line numbers:
${JSON.stringify(sourceSnippets, null, 2)}

Return strict JSON object:
{
  "title": "...",
  "summary": "...",
  "unifiedDiff": "diff --git ...",
  "filesChanged": ["path"],
  "testRecommendations": ["..."],
  "safetyRationale": "...",
  "assumptions": ["..."],
  "missingContext": ["..."]
}

Patch rules:
- The unified diff must modify only files present in Available source snippets.
- The removed lines in the diff must match the supplied source snippets exactly enough for git apply to validate.
- Prefer the smallest change that directly mitigates the hazard.
- Include tests only as recommendations unless a test file is present in the supplied snippets.
- If no safe, source-grounded patch can be made from this chunk, set unifiedDiff to "".
  `.trim();

  const raw = await callSafetyRemediationAI(prompt, { temperature: 0.12 });
  return extractJsonObject(raw);
}

const GENERIC_FINDING_PATTERNS = [
  /\bsystem failure\b/i,
  /\bunsafe behavior\b/i,
  /\bincorrect output\b/i,
  /\bloss of function\b/i,
  /\bdefensive checks?\b/i,
  /\bgeneric validation\b/i,
  /\bappropriate controls?\b/i,
  /\bas needed\b/i,
  /\bshould be confirmed\b/i,
  /\bneeds confirmation\b/i,
  /\breview the referenced code path\b/i,
];

function textForQuality(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function rowSearchText(row = {}) {
  return Object.values(row || {}).map(textForQuality).join(" ").toLowerCase();
}

function sourceTermsFromElement(element = {}) {
  const row = element?.row || {};
  const refs = codeReferencesFromEvidence({ architectureElement: element });
  return [
    element?.label,
    row.from,
    row.action,
    row.to,
    row.architecture?.subsystem,
    row.architecture?.csci,
    row.architecture?.csc,
    row.architecture?.csu,
    ...refs.flatMap((ref) => [ref.filePath, ref.symbolName]),
  ]
    .map((term) => String(term || "").trim())
    .filter((term) => term.length >= 3);
}

function focusedHazardRowsForElement({ element, hazardSummaryRows = [] }) {
  const rows = Array.isArray(hazardSummaryRows) ? hazardSummaryRows : [];
  if (!element || !rows.length) return rows.slice(0, 30);
  const rowRef = String(element.rowRef || element.row?.rowRef || "").trim();
  const terms = sourceTermsFromElement(element).map((term) => term.toLowerCase());
  const scored = rows.map((row, index) => {
    const search = rowSearchText(row);
    let score = 0;
    if (rowRef && search.includes(rowRef.toLowerCase())) score += 4;
    terms.forEach((term) => {
      if (term && search.includes(term)) score += term.includes("/") || term.includes(".") ? 3 : 1;
    });
    return { row, index, score };
  });
  const matched = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return (matched.length ? matched : scored).slice(0, 30).map((item) => item.row);
}

function codeRefsFromHazardRow(hazardRow = {}) {
  return Array.isArray(hazardRow?.affectedCodeRefs) ? hazardRow.affectedCodeRefs.filter(Boolean) : [];
}

function sourceMetaFromHazardRow(hazardRow = {}) {
  return {
    sourceFiles: Array.isArray(hazardRow.sourceFiles) ? hazardRow.sourceFiles : [],
    sourceSymbols: Array.isArray(hazardRow.sourceSymbols) ? hazardRow.sourceSymbols : [],
    sourceLineRanges: Array.isArray(hazardRow.sourceLineRanges) ? hazardRow.sourceLineRanges : [],
    architectureRowRef: hazardRow.architectureRowRef || "",
    architectureElementId: hazardRow.architectureElementId || "",
  };
}

function hazardRowRefForCoverage(row = {}, index = 0) {
  return String(row.hazardRowRef || row.id || row.rowRef || `hazard-row-${index + 1}`).trim();
}

function compactHazardRowForCoverage(row = {}, index = 0) {
  return {
    rowRef: hazardRowRefForCoverage(row, index),
    architectureRowRef: row.architectureRowRef || "",
    architectureElementId: row.architectureElementId || "",
    functionFrom: row.functionFrom || row["Function (From)"] || "",
    controlAction: row.controlAction || row["Control Action"] || "",
    functionTo: row.functionTo || row["Function (To)"] || "",
    hazard: pickHazardField(row, ["Hazard", "Hazards", "Risk", "Effect", "Hazard Description"]),
    causalFactor: pickHazardField(row, ["Cause", "Causal Factor", "Malfunction", "Functional Degradation / Loss", "Failure Mode", "Unsafe Control Action"]),
    mitigation: pickHazardField(row, ["Safety Goal", "Mitigation", "Mitigation Strategy", "Requirement", "System Requirement", "Software Safety Requirement"]),
    severity: pickHazardField(row, ["Severity", "Severity Category", "S", "ASIL Severity"]),
    riskLevel: pickHazardField(row, ["Risk", "Risk Level", "ASIL", "RAC", "Software Criticality Index"]),
    riskCode: pickHazardField(row, ["RAC", "Risk Code", "Risk Level", "ASIL", "Software Criticality Index", "SwCI"]),
    sourceFiles: Array.isArray(row.sourceFiles) ? row.sourceFiles : [],
    sourceSymbols: Array.isArray(row.sourceSymbols) ? row.sourceSymbols : [],
  };
}

function findingCoveredRowRefs(finding = {}) {
  return Array.from(new Set([
    ...(Array.isArray(finding.coveredHazardRowRefs) ? finding.coveredHazardRowRefs : []),
    finding.hazardRowRef,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function findHazardRowForAiItem(item = {}, focusedHazardRows = []) {
  const candidates = [
    item.hazardRowRef,
    ...(Array.isArray(item.coveredHazardRowRefs) ? item.coveredHazardRowRefs : []),
    item.hazardId,
    item.id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (!candidates.length && focusedHazardRows.length === 1) return focusedHazardRows[0];
  return focusedHazardRows.find((row) => {
    const rowIds = [row.id, row.hazardRowRef, row.rowRef, row.architectureRowRef]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return candidates.some((candidate) => rowIds.includes(candidate));
  }) || null;
}

function fieldHasConcreteMechanism(text = "") {
  const value = String(text || "").toLowerCase();
  return /\b(stale|late|early|timeout|invalid|missing|out of range|overflow|underflow|race|state|sensor|command|interface|calibration|actuator|fault|mismatch|resource|lockout|arming|disarming|threshold|checksum|sequence|branch|mode)\b/.test(value);
}

export function scoreSafetyFindingQuality(finding = {}) {
  const issues = [];
  let score = 0;
  const hazard = textForQuality(finding.hazard);
  const causalFactor = textForQuality(finding.causalFactor);
  const mitigation = textForQuality(finding.proposedMitigation);
  const description = textForQuality(finding.description);
  const refs = Array.isArray(finding.affectedCodeRefs) ? finding.affectedCodeRefs : [];
  const combined = [finding.title, description, hazard, causalFactor, mitigation].map(textForQuality).join(" ");
  const genericHits = GENERIC_FINDING_PATTERNS.filter((pattern) => pattern.test(combined)).length;

  if (hazard.length >= 45 && fieldHasConcreteMechanism(hazard)) score += 20;
  else if (hazard.length >= 30) score += 12;
  else issues.push("Hazard is too short or generic.");

  if (causalFactor.length >= 45 && fieldHasConcreteMechanism(causalFactor)) score += 20;
  else if (causalFactor.length >= 30) score += 12;
  else issues.push("Causal factor lacks a concrete mechanism.");

  if (mitigation.length >= 55 && /\bshall|prevent|detect|reject|limit|verify|transition|fallback|safe state|interlock|degrade|recover\b/i.test(mitigation)) score += 20;
  else if (mitigation.length >= 35) score += 10;
  else issues.push("Mitigation is not specific or verifiable enough.");

  if (refs.some((ref) => ref.filePath && ref.symbolName && (ref.startLine || ref.endLine))) score += 15;
  else if (refs.some((ref) => ref.filePath && (ref.symbolName || ref.startLine || ref.endLine))) score += 10;
  else if (refs.some((ref) => ref.filePath)) score += 6;
  else issues.push("No code reference is attached.");

  if (finding.hazardRowRef) score += 5; else issues.push("No hazard row reference.");
  if (Array.isArray(finding.coveredHazardRowRefs) && finding.coveredHazardRowRefs.length) score += 5;
  else issues.push("No hazard row coverage list.");
  if (finding.architectureElementId || finding.architectureRowRef) score += 5; else issues.push("No architecture reference.");
  if (finding.hazardAnalysisRunId || finding.hazardAnalysisSourceRunId) score += 5; else issues.push("No hazard analysis run reference.");

  if (finding.severity || finding.likelihood || finding.riskLevel) score += 5;
  else issues.push("No risk/severity context.");

  if (/confirm|uncertain|assumption|review/i.test(combined)) score += 5;

  if (genericHits) {
    score -= Math.min(25, genericHits * 6);
    issues.push("Contains generic safety wording that should be tightened.");
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    score: boundedScore,
    band: boundedScore >= 75 ? "high" : boundedScore >= 55 ? "medium" : "low",
    issues,
  };
}

function normalizeAndScoreFinding(raw, context) {
  const normalized = normalizeSafetyFinding(raw, context);
  const quality = scoreSafetyFindingQuality(normalized);
  return {
    ...normalized,
    quality,
  };
}

function deterministicFindings({
  element,
  hazardSummaryRows = [],
  projectId,
  repoMeta = {},
  hazardAnalysis = null,
  isBasedOnStaleHazardAnalysis = false,
}) {
  const hazards = focusedHazardRowsForElement({ element, hazardSummaryRows });
  const codeRefs = codeReferencesFromEvidence({ architectureElement: element, repoMeta });
  const base = hazards.length ? hazards : [{}];
  return base.map((hazardRow, index) => {
    const coveredRow = compactHazardRowForCoverage(hazardRow, index);
    const coveredRef = coveredRow.rowRef;
    const hazard = pickHazardField(hazardRow, ["Hazard", "Hazards", "Risk", "Effect", "Hazard Description"]) ||
      `Safety risk associated with ${element?.label || "the selected architecture element"}`;
    const causalFactor = pickHazardField(hazardRow, ["Cause", "Causal Factor", "Malfunction", "Functional Degradation / Loss", "Failure Mode", "Unsafe Control Action"]) ||
      "Causal factor should be confirmed by a human reviewer.";
    const hazardCodeRefs = codeRefsFromHazardRow(hazardRow);
    const sourceMeta = sourceMetaFromHazardRow(hazardRow);
    return normalizeAndScoreFinding({
      id: makeSafetyRemediationId("finding"),
      title: `${element?.label || "Architecture element"} safety remediation`,
      description: "AI generation was unavailable or returned incomplete data, so this draft finding was derived from local hazard and architecture evidence.",
      hazardId: hazardRow.id || `hazard-${index + 1}`,
      hazard,
      causalFactorId: hazardRow.id ? `${hazardRow.id}:cause` : `causal-factor-${index + 1}`,
      causalFactor,
      severity: pickHazardField(hazardRow, ["Severity", "Severity Category", "S", "ASIL Severity"]),
      likelihood: pickHazardField(hazardRow, ["Likelihood", "Exposure", "Probability", "Software Control Category", "E"]),
      riskLevel: pickHazardField(hazardRow, ["Risk", "Risk Level", "ASIL", "Software Criticality Index"]),
      riskCode: pickHazardField(hazardRow, ["RAC", "Risk Code", "Risk Level", "ASIL", "Software Criticality Index", "SwCI"]),
      affectedCodeRefs: hazardCodeRefs.length ? hazardCodeRefs : codeRefs,
      sourceFiles: sourceMeta.sourceFiles,
      sourceSymbols: sourceMeta.sourceSymbols,
      sourceLineRanges: sourceMeta.sourceLineRanges,
      traceSource: hazardCodeRefs.length ? "hazard-row-traceability" : "architecture-evidence-fallback",
      proposedMitigation: pickHazardField(hazardRow, ["Safety Goal", "Mitigation", "Mitigation Strategy", "Requirement", "Software Safety Requirement"]) ||
        "Review the referenced code path and add defensive checks, validation, or tests appropriate to the hazard.",
      hazardAnalysisRunId: hazardAnalysis?.id || "",
      hazardAnalysisMethod: hazardAnalysis?.hazardMethod || "",
      hazardAnalysisSourceRunId: hazardAnalysis?.sourceRunId || "",
      hazardRowRef: coveredRef,
      coveredHazardRowRefs: [coveredRef],
      coveredHazardRows: [coveredRow],
      coverageRationale: "This finding was generated to ensure the hazard summary row has explicit remediation coverage.",
      causalFactorRowRef: coveredRef ? `${coveredRef}:cause` : "",
      mitigationRowRef: coveredRef ? `${coveredRef}:mitigation` : "",
      requirementRowRef: coveredRef ? `${coveredRef}:requirement` : "",
      architectureRowRef: sourceMeta.architectureRowRef || element?.rowRef || "",
      architectureSnapshotHash: hazardAnalysis?.architectureSnapshotHash || "",
      isBasedOnStaleHazardAnalysis,
    }, {
      projectId,
      repoId: repoMeta.repoId || repoMeta.repoName || "",
      architectureElementId: element?.id,
      architectureElementLabel: element?.label,
      hazardAnalysisRunId: hazardAnalysis?.id || "",
      hazardAnalysisMethod: hazardAnalysis?.hazardMethod || "",
      hazardAnalysisSourceRunId: hazardAnalysis?.sourceRunId || "",
      architectureRowRef: sourceMeta.architectureRowRef || element?.rowRef || "",
      architectureSnapshotHash: hazardAnalysis?.architectureSnapshotHash || "",
      isBasedOnStaleHazardAnalysis,
      traceability: { architectureElement: element, hazardAnalysis, hazardRow },
    });
  });
}

function coverageFindingForHazardRow({
  hazardRow,
  index = 0,
  element,
  projectId,
  repoMeta = {},
  hazardAnalysis = null,
  isBasedOnStaleHazardAnalysis = false,
}) {
  const codeRefs = codeReferencesFromEvidence({ architectureElement: element, repoMeta });
  const hazardCodeRefs = codeRefsFromHazardRow(hazardRow);
  const sourceMeta = sourceMetaFromHazardRow(hazardRow);
  const coveredRow = compactHazardRowForCoverage(hazardRow, index);
  const coveredRef = coveredRow.rowRef;
  const hazard = coveredRow.hazard || `Safety risk associated with ${element?.label || "the selected architecture element"}`;
  const causalFactor = coveredRow.causalFactor || "Causal factor should be confirmed by a human reviewer.";
  return normalizeAndScoreFinding({
    id: makeSafetyRemediationId("finding"),
    title: `${element?.label || "Architecture element"} coverage for ${coveredRef}`,
    description: "Draft finding added by xHandle to ensure every hazard-analysis summary row has explicit remediation coverage.",
    hazardId: coveredRef,
    hazard,
    causalFactorId: coveredRef ? `${coveredRef}:cause` : "",
    causalFactor,
    severity: coveredRow.severity,
    likelihood: pickHazardField(hazardRow, ["Likelihood", "Exposure", "Probability", "E"]),
    riskLevel: coveredRow.riskLevel,
    riskCode: coveredRow.riskCode,
    affectedCodeRefs: hazardCodeRefs.length ? hazardCodeRefs : codeRefs,
    sourceFiles: sourceMeta.sourceFiles,
    sourceSymbols: sourceMeta.sourceSymbols,
    sourceLineRanges: sourceMeta.sourceLineRanges,
    traceSource: hazardCodeRefs.length ? "hazard-row-traceability" : "architecture-evidence-fallback",
    proposedMitigation: coveredRow.mitigation ||
      "Review the referenced code path and add a specific, verifiable mitigation for this hazard row.",
    hazardAnalysisRunId: hazardAnalysis?.id || "",
    hazardAnalysisMethod: hazardAnalysis?.hazardMethod || "",
    hazardAnalysisSourceRunId: hazardAnalysis?.sourceRunId || "",
    hazardRowRef: coveredRef,
    coveredHazardRowRefs: [coveredRef],
    coveredHazardRows: [coveredRow],
    coverageRationale: "This finding covers a hazard summary row that was not covered by the AI-generated findings.",
    causalFactorRowRef: coveredRef ? `${coveredRef}:cause` : "",
    mitigationRowRef: coveredRef ? `${coveredRef}:mitigation` : "",
    requirementRowRef: coveredRef ? `${coveredRef}:requirement` : "",
    architectureRowRef: sourceMeta.architectureRowRef || element?.rowRef || "",
    architectureSnapshotHash: hazardAnalysis?.architectureSnapshotHash || "",
    isBasedOnStaleHazardAnalysis,
    generatedBy: "coverage_reconciliation",
  }, {
    projectId,
    repoId: repoMeta.repoId || repoMeta.repoName || "",
    architectureElementId: sourceMeta.architectureElementId || element?.id,
    architectureElementLabel: element?.label,
    hazardAnalysisRunId: hazardAnalysis?.id || "",
    hazardAnalysisMethod: hazardAnalysis?.hazardMethod || "",
    hazardAnalysisSourceRunId: hazardAnalysis?.sourceRunId || "",
    architectureRowRef: sourceMeta.architectureRowRef || element?.rowRef || "",
    architectureSnapshotHash: hazardAnalysis?.architectureSnapshotHash || "",
    isBasedOnStaleHazardAnalysis,
    traceability: { architectureElement: element, hazardAnalysis, hazardRow },
  });
}

function ensureHazardSummaryCoverage({
  findings = [],
  focusedHazardRows = [],
  element,
  projectId,
  repoMeta = {},
  hazardAnalysis = null,
  isBasedOnStaleHazardAnalysis = false,
}) {
  const covered = new Set(findings.flatMap(findingCoveredRowRefs));
  const reconciled = [...findings];
  focusedHazardRows.forEach((row, index) => {
    const rowRef = hazardRowRefForCoverage(row, index);
    if (!rowRef || covered.has(rowRef)) return;
    const coverageFinding = coverageFindingForHazardRow({
      hazardRow: row,
      index,
      element,
      projectId,
      repoMeta,
      hazardAnalysis,
      isBasedOnStaleHazardAnalysis,
    });
    reconciled.push(coverageFinding);
    findingCoveredRowRefs(coverageFinding).forEach((ref) => covered.add(ref));
  });
  return reconciled;
}

export async function generateSafetyFindingsFromArchitectureElement({
  element,
  hazardSummaryRows = [],
  riskRegister = [],
  project,
  repoMeta = {},
  hazardAnalysis = null,
  isBasedOnStaleHazardAnalysis = false,
}) {
  if (!element) return [];
  if (!hazardAnalysis && (!hazardSummaryRows || hazardSummaryRows.length === 0)) {
    throw new Error("Run hazard analysis for this code architecture before generating remediation findings.");
  }
  const coverageHazardRows = Array.isArray(hazardSummaryRows) ? hazardSummaryRows : [];
  const focusedHazardRows = focusedHazardRowsForElement({ element, hazardSummaryRows });
  const codeRefs = codeReferencesFromEvidence({ architectureElement: element, repoMeta });
  const prompt = `
You are generating human-review-required Safety Findings for xHandle.
Use only the supplied local evidence. Do not invent source files or line ranges.
The findings must be grounded in the supplied code-architecture hazard analysis outputs, not only in the architecture description.
Prioritize quality over quantity. Return only findings that can be tied to the selected architecture element and at least one supplied hazard-analysis row.

Selected architecture element:
${JSON.stringify(element, null, 2)}

Resolved code references from the selected architecture element:
${JSON.stringify(codeRefs, null, 2)}

Preferred code references from matching hazard rows:
${JSON.stringify((focusedHazardRows || []).slice(0, 30).map((row) => ({
  id: row.id,
  hazardRowRef: row.hazardRowRef || row.id,
  architectureRowRef: row.architectureRowRef,
  architectureElementId: row.architectureElementId,
  sourceFiles: row.sourceFiles || [],
  sourceSymbols: row.sourceSymbols || [],
  sourceLineRanges: row.sourceLineRanges || [],
  affectedCodeRefs: row.affectedCodeRefs || [],
})), null, 2)}

Code-architecture hazard analysis run:
${JSON.stringify(hazardAnalysis ? {
  id: hazardAnalysis.id,
  sourceRunId: hazardAnalysis.sourceRunId,
  hazardMethod: hazardAnalysis.hazardMethod,
  architectureSnapshotHash: hazardAnalysis.architectureSnapshotHash,
  summaryRows: (hazardAnalysis.summaryRows || []).slice(0, 40),
  methodSpecificSheets: compactHazardAnalysisSheets(hazardAnalysis.generatedSheets || {}),
} : null, null, 2)}

Focused hazard summary rows for this architecture element:
${JSON.stringify((focusedHazardRows || []).slice(0, 30), null, 2)}

Risk register:
${JSON.stringify((riskRegister || []).slice(0, 30), null, 2)}

Return strict JSON array. Each object may include:
title, description, hazardId, hazard, causalFactorId, causalFactor, severity, likelihood, riskLevel, proposedMitigation,
hazardAnalysisRunId, hazardAnalysisMethod, hazardRowRef, coveredHazardRowRefs, coveredHazardRows, coverageRationale, causalFactorRowRef, mitigationRowRef, requirementRowRef,
architectureElementId, architectureRowRef, affectedCodeRefs, quality.

Rules:
- Every finding must be explicitly marked as a draft needing human review by the consuming app.
- Return 1 to 5 findings, sorted by safety importance and evidence strength.
- A single finding may cover multiple hazard summary rows when one mitigation would address the same unsafe mechanism. If so, include every covered row id in coveredHazardRowRefs.
- Do not omit coverage metadata. At minimum, coveredHazardRowRefs must include hazardRowRef.
- Use hazards, causal factors, mitigations, requirements, severity, and risk fields from the supplied hazard-analysis rows. Quote row identifiers in hazardRowRef when available.
- Each hazard must state a concrete unsafe state and consequence, not just "system failure" or "unsafe behavior".
- Each causalFactor must explain a plausible code/architecture mechanism such as stale input, invalid state transition, missing bounds check, timing/sequence fault, interface mismatch, resource exhaustion, sensor fault, actuator fault, or command conflict.
- Each proposedMitigation must be specific, verifiable, and tied to the affected function/file/interface. Avoid generic phrases like "add defensive checks" unless the check condition and safe behavior are named.
- Include affectedCodeRefs by reusing only the supplied code references. Do not invent files, symbols, or line ranges.
- Do not create remediation findings that cannot be tied to a hazard-analysis row unless the row mapping is genuinely unavailable; explain that uncertainty in description and set quality.band to "low".
- Tie findings to the selected architecture element.
- Include a quality object: { "score": 0-100, "band": "high|medium|low", "issues": ["..."] }.
- If evidence is incomplete, say exactly what needs confirmation.
  `.trim();

  try {
    const raw = await callSafetyRemediationAI(prompt);
    const parsed = extractJsonArray(raw);
    if (!parsed.length) throw new Error("AI returned no findings");
    const normalizedFindings = parsed.map((item) => {
      const matchedHazardRow = findHazardRowForAiItem(item, focusedHazardRows);
      const hazardRefs = codeRefsFromHazardRow(matchedHazardRow);
      const sourceMeta = sourceMetaFromHazardRow(matchedHazardRow);
      const itemRefs = Array.isArray(item.affectedCodeRefs) && item.affectedCodeRefs.length ? item.affectedCodeRefs : [];
      const affectedCodeRefs = hazardRefs.length ? hazardRefs : (itemRefs.length ? itemRefs : codeRefs);
      const matchedIndex = matchedHazardRow ? focusedHazardRows.indexOf(matchedHazardRow) : -1;
      const coveredHazardRows = Array.isArray(item.coveredHazardRows) && item.coveredHazardRows.length
        ? item.coveredHazardRows
        : matchedHazardRow
          ? [compactHazardRowForCoverage(matchedHazardRow, matchedIndex)]
          : [];
      const coveredHazardRowRefs = Array.from(new Set([
        ...(Array.isArray(item.coveredHazardRowRefs) ? item.coveredHazardRowRefs : []),
        item.hazardRowRef,
        matchedHazardRow ? hazardRowRefForCoverage(matchedHazardRow, matchedIndex) : "",
      ].map((value) => String(value || "").trim()).filter(Boolean)));
      return normalizeAndScoreFinding({
        ...item,
        affectedCodeRefs,
        sourceFiles: sourceMeta.sourceFiles.length ? sourceMeta.sourceFiles : item.sourceFiles,
        sourceSymbols: sourceMeta.sourceSymbols.length ? sourceMeta.sourceSymbols : item.sourceSymbols,
        sourceLineRanges: sourceMeta.sourceLineRanges.length ? sourceMeta.sourceLineRanges : item.sourceLineRanges,
        architectureRowRef: sourceMeta.architectureRowRef || item.architectureRowRef,
        architectureElementId: sourceMeta.architectureElementId || item.architectureElementId,
        hazardRowRef: item.hazardRowRef || coveredHazardRowRefs[0] || "",
        coveredHazardRowRefs,
        coveredHazardRows,
        coverageRationale: item.coverageRationale || "AI-generated finding mapped to hazard-analysis summary row coverage.",
        traceSource: hazardRefs.length ? "hazard-row-traceability" : (itemRefs.length ? "ai-supplied-hazard-context" : "architecture-evidence-fallback"),
      }, {
      projectId: project?.id || "",
      repoId: repoMeta.repoId || repoMeta.repoName || "",
      architectureElementId: element.id,
      architectureElementLabel: element.label,
      hazardAnalysisRunId: hazardAnalysis?.id || "",
      hazardAnalysisMethod: hazardAnalysis?.hazardMethod || "",
      hazardAnalysisSourceRunId: hazardAnalysis?.sourceRunId || "",
      architectureRowRef: sourceMeta.architectureRowRef || element?.rowRef || "",
      architectureSnapshotHash: hazardAnalysis?.architectureSnapshotHash || "",
      isBasedOnStaleHazardAnalysis,
      traceability: { architectureElement: element, hazardAnalysis, hazardRow: matchedHazardRow },
    });
    });
    return ensureHazardSummaryCoverage({
      findings: normalizedFindings,
      focusedHazardRows: coverageHazardRows,
      element,
      projectId: project?.id || "",
      repoMeta,
      hazardAnalysis,
      isBasedOnStaleHazardAnalysis,
    }).sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0));
  } catch (error) {
    console.warn("[safety-remediation] AI finding generation failed; using deterministic fallback", error);
    return ensureHazardSummaryCoverage({
      findings: deterministicFindings({
      element,
      hazardSummaryRows: focusedHazardRows,
      projectId: project?.id || "",
      repoMeta,
      hazardAnalysis,
      isBasedOnStaleHazardAnalysis,
      }),
      focusedHazardRows: coverageHazardRows,
      element,
      projectId: project?.id || "",
      repoMeta,
      hazardAnalysis,
      isBasedOnStaleHazardAnalysis,
    });
  }
}

export async function generateCodeReferencesForFinding({ finding, architectureElement, codeEvidence, repoMeta = {} }) {
  const deterministicRefs = codeReferencesFromEvidence({
    architectureElement: architectureElement || { id: finding?.architectureElementId, row: { codeEvidence } },
    repoMeta,
  });
  if (deterministicRefs.length) return deterministicRefs;

  const prompt = `
Create best-effort CodeReference objects for this safety finding using only supplied architecture evidence.
Do not invent exact line ranges. Leave startLine/endLine null if unavailable.

Finding:
${JSON.stringify(finding, null, 2)}

Architecture evidence:
${JSON.stringify(codeEvidence || architectureElement || {}, null, 2)}

Return strict JSON array with:
repoId, repoName, repoPath, repoUrl, branch, filePath, symbolName, symbolType, startLine, endLine, architectureNodeId, confidence, rationale.
  `.trim();
  try {
    const raw = await callSafetyRemediationAI(prompt);
    return extractJsonArray(raw);
  } catch (error) {
    console.warn("[safety-remediation] AI code reference generation failed", error);
    return [];
  }
}

export async function generatePatchProposal({ finding, codeReferences = [], sourceSnippets = [], sourceDiagnostics = [] }) {
  const snippets = Array.isArray(sourceSnippets) ? sourceSnippets : [];
  if (!snippets.length) {
    return failurePatchProposal({
      finding,
      codeReferences,
      sourceSnippets: snippets,
      sourceDiagnostics,
      reason: "Patch generation requires source code context, but no indexed source snippets were available for the affected code references.",
    });
  }
  try {
    const snippetGroups = chunkSourceSnippetsForPatch({ finding, codeReferences, sourceSnippets: snippets });
    if (!snippetGroups.length) {
      return failurePatchProposal({
        finding,
        codeReferences,
        sourceSnippets: snippets,
        sourceDiagnostics,
        reason: "Patch generation could not prepare a context chunk small enough for the model.",
      });
    }
    const parsedResults = [];
    for (let index = 0; index < snippetGroups.length; index += 1) {
      const parsed = await generatePatchProposalForSnippetGroup({
        finding,
        codeReferences,
        sourceSnippets: snippetGroups[index],
        chunkIndex: index,
        chunkCount: snippetGroups.length,
      });
      parsedResults.push(parsed);
    }
    const patchResults = parsedResults.filter((item) => String(item?.unifiedDiff || "").trim());
    if (!patchResults.length) {
      const missing = parsedResults.flatMap((item) => Array.isArray(item?.missingContext) ? item.missingContext : []).filter(Boolean);
      return failurePatchProposal({
        finding,
        codeReferences,
        sourceSnippets: snippets,
        sourceDiagnostics,
        missingContext: missing,
        reason: missing.length
          ? `Patch generation needs more source context: ${missing.slice(0, 3).join("; ")}`
          : "The model did not return a source-grounded unified diff for the available snippets.",
      });
    }
    const parsed = patchResults[0];
    return {
      id: makeSafetyRemediationId("patch"),
      safetyFindingId: finding.id,
      title: parsed.title || `Patch proposal for ${finding.title}`,
      summary: parsed.summary || "",
      unifiedDiff: parsed.unifiedDiff || "",
      filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
      testRecommendations: Array.isArray(parsed.testRecommendations) ? parsed.testRecommendations : [],
      safetyRationale: parsed.safetyRationale || "",
      generatedBy: "ai",
      reviewStatus: "draft_ai_generated",
      projectId: finding.projectId || "",
      repoId: finding.repoId || "",
      hazardAnalysisRunId: finding.hazardAnalysisRunId || "",
      hazardAnalysisMethod: finding.hazardAnalysisMethod || "",
      architectureSnapshotHash: finding.architectureSnapshotHash || "",
      sourceContextStatus: snippetGroups.length > 1 ? `chunked_${snippetGroups.length}` : "single_context",
      workspaceRoots: Array.from(new Set(snippets.map((snippet) => snippet.workspaceRoot).filter(Boolean))),
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      missingContext: Array.isArray(parsed.missingContext) ? parsed.missingContext : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn("[safety-remediation] AI patch generation failed", error);
    return failurePatchProposal({
      finding,
      codeReferences,
      sourceSnippets: snippets,
      sourceDiagnostics,
      reason: error?.message || "AI patch generation failed before a source-grounded diff was produced.",
    });
  }
}

export async function generateTestRecommendations({ finding, patchProposal }) {
  if (Array.isArray(patchProposal?.testRecommendations) && patchProposal.testRecommendations.length) {
    return patchProposal.testRecommendations;
  }
  return [
    `Add a regression test for ${finding.title}.`,
    "Verify the affected code path handles the hazardous condition safely.",
  ];
}

export async function generateSafetyRationale({ finding, patchProposal }) {
  return patchProposal?.safetyRationale || finding?.proposedMitigation || "Human review is required before accepting this remediation.";
}
