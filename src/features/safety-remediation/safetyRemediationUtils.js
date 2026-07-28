import {
  SAFETY_FINDING_IMPLEMENTATION_STATUSES,
  SAFETY_FINDING_REVIEW_STATUSES,
  SAFETY_FINDING_VERIFICATION_STATUSES,
} from "./safetyRemediationTypes";

export const nowISO = () => new Date().toISOString();

export function makeSafetyRemediationId(prefix = "sr") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeParseJson(text, fallback = null) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function extractJsonArray(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced.trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch {}
  }
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {}
  }
  return [];
}

export function normalizeText(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

export function getRepoMeta() {
  if (typeof localStorage === "undefined") return {};
  const owner = localStorage.getItem("repoOwner") || "";
  const repo = localStorage.getItem("repoName") || "";
  return {
    owner,
    repo,
    repoId: owner && repo ? `${owner}/${repo}` : repo,
    repoName: owner && repo ? `${owner}/${repo}` : repo,
    repoUrl: owner && repo ? `https://github.com/${owner}/${repo}` : "",
    branch: "main",
  };
}

function priorityFromRiskLevel(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return "medium";
  if (/\bswci\s*1\b|\brac\s*1\b|\bcatastrophic\b|\bcritical\b|\basil\s*d\b|\bhigh\s+risk\b/.test(text)) return "critical";
  if (/\bswci\s*2\b|\brac\s*2\b|\bhazardous\b|\bhigh\b|\basil\s*c\b/.test(text)) return "high";
  if (/\bswci\s*3\b|\brac\s*3\b|\bmajor\b|\bmedium\b|\bmoderate\b|\basil\s*b\b/.test(text)) return "medium";
  if (/\bswci\s*[45]\b|\brac\s*[45]\b|\bminor\b|\blow\b|\basil\s*a\b|\bqm\b/.test(text)) return "low";
  return "medium";
}

export function summarySheetToObjects(summarySheet) {
  if (!Array.isArray(summarySheet) || !Array.isArray(summarySheet[0])) return [];
  const headers = summarySheet[0].map((header, index) => String(header || `Column ${index + 1}`));
  return summarySheet.slice(1).map((row, rowIndex) => {
    const record = { id: `hazard-row-${rowIndex + 1}` };
    headers.forEach((header, index) => {
      record[header] = Array.isArray(row) ? row[index] : "";
    });
    return record;
  });
}

export function architectureElementFromRow(row, index = 0) {
  if (!row) return null;
  const rowRef = row.rowRef || index + 1;
  return {
    id: `cba-row-${rowRef}`,
    type: "architecture_row",
    label: [row.architecture?.subsystem, row.architecture?.csu, row.from, row.action, row.to].filter(Boolean).join(" / ") || `Architecture row ${rowRef}`,
    rowRef,
    row,
    architecture: row.architecture || null,
    codeEvidence: row.codeEvidence || null,
    sourceEvidence: row.sourceEvidence || null,
  };
}

export function codeReferencesFromEvidence({ architectureElement, repoMeta = {} }) {
  const row = architectureElement?.row || {};
  const fns = [
    ...(row.sourceEvidence?.functions || []),
    ...(row.codeEvidence?.sourceFunctions || []),
    ...((row.codeEvidence?.files || []).flatMap((file) => file.sourceFunctions || [])),
  ];
  const unique = new Map();
  const fileRefs = new Map();
  const repoId = repoMeta.repoId || repoMeta.repoName || "";
  const repoName = repoMeta.repoName || repoId;

  const addFileReference = (filePath, source = "file evidence") => {
    const cleanPath = normalizeText(filePath);
    if (!cleanPath) return;
    if (fileRefs.has(cleanPath)) return;
    fileRefs.set(cleanPath, {
      repoId,
      repoName,
      repoPath: repoMeta.repoPath || "",
      repoUrl: repoMeta.repoUrl || "",
      branch: repoMeta.branch || "",
      filePath: cleanPath,
      symbolName: "",
      symbolType: "file",
      startLine: null,
      endLine: null,
      commitSha: "",
      sourceUrl: "",
      architectureNodeId: architectureElement?.id || "",
      confidence: 0.45,
      rationale: `Derived from code-based architecture ${source}; function and line metadata were unavailable.`,
    });
  };

  fns.forEach((fn) => {
    if (!fn?.filePath) return;
    const key = `${fn.filePath}:${fn.functionName || ""}:${fn.startLine || ""}:${fn.endLine || ""}`;
    if (unique.has(key)) return;
    unique.set(key, {
      repoId: repoMeta.repoId || repoMeta.repoName || fn.repo || "",
      repoName: repoMeta.repoName || fn.repo || "",
      repoPath: repoMeta.repoPath || "",
      repoUrl: repoMeta.repoUrl || fn.sourceUrl?.split("/blob/")?.[0] || "",
      branch: fn.branch || repoMeta.branch || "",
      filePath: fn.filePath,
      symbolName: fn.functionName || "",
      symbolType: "function",
      startLine: fn.startLine || null,
      endLine: fn.endLine || null,
      commitSha: fn.commitSha || "",
      sourceUrl: fn.sourceUrl || "",
      architectureNodeId: architectureElement?.id || "",
      confidence: fn.startLine ? 0.82 : 0.55,
      rationale: fn.startLine
        ? "Derived from the code-based architecture source function index."
        : "Derived from architecture file evidence; exact line range was unavailable.",
    });
  });

  addFileReference(row.fromFile, "from-function file evidence");
  addFileReference(row.toFile, "to-function file evidence");
  (row.codeEvidence?.files || []).forEach((file) => addFileReference(file?.filePath || file?.path, "file evidence"));
  (row.sourceEvidence?.files || []).forEach((file) => addFileReference(file?.filePath || file?.path, "source file evidence"));

  (row.codeEvidence?.files || []).forEach((file) => {
    const path = normalizeText(file?.filePath || file?.path);
    if (!path || !fileRefs.has(path)) return;
    fileRefs.set(path, {
      ...fileRefs.get(path),
      branch: file?.branch || fileRefs.get(path).branch,
      commitSha: file?.commitSha || fileRefs.get(path).commitSha || "",
    });
  });

  const functionRefs = Array.from(unique.values());
  const functionFiles = new Set(functionRefs.map((ref) => ref.filePath).filter(Boolean));
  const distinctFileRefs = Array.from(fileRefs.values()).filter((ref) => !functionFiles.has(ref.filePath));
  return [...functionRefs, ...distinctFileRefs].slice(0, 12);
}

export function normalizeSafetyFinding(raw, context = {}) {
  const now = nowISO();
  return {
    id: raw.id || makeSafetyRemediationId("finding"),
    projectId: context.projectId || raw.projectId || "",
    repoId: context.repoId || raw.repoId || "",
    title: normalizeText(raw.title, "AI-generated safety finding"),
    description: normalizeText(raw.description),
    architectureElementId: raw.architectureElementId || context.architectureElementId || "",
    architectureElementLabel: raw.architectureElementLabel || context.architectureElementLabel || "",
    hazardId: raw.hazardId || "",
    hazard: normalizeText(raw.hazard),
    causalFactorId: raw.causalFactorId || "",
    causalFactor: normalizeText(raw.causalFactor || raw.cause),
    severity: normalizeText(raw.severity),
    likelihood: normalizeText(raw.likelihood || raw.exposure || raw.probability || raw.softwareControlCategory),
    riskLevel: normalizeText(raw.riskLevel || raw.risk || raw.softwareCriticalityIndex || raw.swci),
    riskCode: normalizeText(raw.riskCode || raw.rac || raw.RAC || raw.softwareCriticalityIndex || raw.swci || raw.riskLevel || raw.risk),
    affectedCodeRefs: Array.isArray(raw.affectedCodeRefs) ? raw.affectedCodeRefs : [],
    sourceFiles: Array.isArray(raw.sourceFiles) ? raw.sourceFiles : [],
    sourceSymbols: Array.isArray(raw.sourceSymbols) ? raw.sourceSymbols : [],
    sourceLineRanges: Array.isArray(raw.sourceLineRanges) ? raw.sourceLineRanges : [],
    traceSource: raw.traceSource || context.traceSource || "",
    archivedAt: raw.archivedAt || null,
    deletedAt: raw.deletedAt || null,
    folderId: raw.folderId || "",
    folderPath: raw.folderPath || "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    priority: raw.priority || priorityFromRiskLevel(raw.riskCode || raw.rac || raw.RAC || raw.softwareCriticalityIndex || raw.swci || raw.riskLevel || raw.risk),
    owner: raw.owner || "",
    pinned: Boolean(raw.pinned),
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    proposedMitigation: normalizeText(raw.proposedMitigation || raw.mitigation),
    proposedPatchId: raw.proposedPatchId || "",
    reviewStatus: raw.reviewStatus || SAFETY_FINDING_REVIEW_STATUSES.DRAFT_AI_GENERATED,
    implementationStatus: raw.implementationStatus || SAFETY_FINDING_IMPLEMENTATION_STATUSES.NOT_STARTED,
    verificationStatus: raw.verificationStatus || SAFETY_FINDING_VERIFICATION_STATUSES.NOT_STARTED,
    commitSha: raw.commitSha || "",
    appliedAt: raw.appliedAt || null,
    appliedBy: raw.appliedBy || "",
    localBranch: raw.localBranch || "",
    pullRequestUrl: raw.pullRequestUrl || "",
    pullRequestNumber: raw.pullRequestNumber || "",
    testStatus: raw.testStatus || "not_run",
    testEvidence: raw.testEvidence || "",
    implementationNotes: raw.implementationNotes || "",
    hazardAnalysisRunId: raw.hazardAnalysisRunId || context.hazardAnalysisRunId || "",
    hazardAnalysisMethod: raw.hazardAnalysisMethod || context.hazardAnalysisMethod || "",
    hazardAnalysisSourceRunId: raw.hazardAnalysisSourceRunId || context.hazardAnalysisSourceRunId || "",
    hazardRowRef: raw.hazardRowRef || raw.hazardRowId || context.hazardRowRef || "",
    coveredHazardRowRefs: Array.isArray(raw.coveredHazardRowRefs)
      ? raw.coveredHazardRowRefs.filter(Boolean)
      : (raw.hazardRowRef || raw.hazardRowId || context.hazardRowRef ? [raw.hazardRowRef || raw.hazardRowId || context.hazardRowRef] : []),
    coveredHazardRows: Array.isArray(raw.coveredHazardRows) ? raw.coveredHazardRows : [],
    coverageRationale: normalizeText(raw.coverageRationale || context.coverageRationale),
    causalFactorRowRef: raw.causalFactorRowRef || context.causalFactorRowRef || "",
    mitigationRowRef: raw.mitigationRowRef || context.mitigationRowRef || "",
    requirementRowRef: raw.requirementRowRef || context.requirementRowRef || "",
    architectureRowRef: raw.architectureRowRef || context.architectureRowRef || "",
    architectureSnapshotHash: raw.architectureSnapshotHash || context.architectureSnapshotHash || "",
    isBasedOnStaleHazardAnalysis: Boolean(raw.isBasedOnStaleHazardAnalysis || context.isBasedOnStaleHazardAnalysis),
    traceability: raw.traceability || context.traceability || {},
    quality: raw.quality || context.quality || null,
    generatedBy: raw.generatedBy || "ai",
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function decisionToFindingStatus(decision) {
  if (decision === "approve") return SAFETY_FINDING_REVIEW_STATUSES.APPROVED;
  if (decision === "approve_with_changes") return SAFETY_FINDING_REVIEW_STATUSES.APPROVED_WITH_CHANGES;
  if (decision === "reject") return SAFETY_FINDING_REVIEW_STATUSES.REJECTED;
  if (decision === "regenerate") return SAFETY_FINDING_REVIEW_STATUSES.NEEDS_REGENERATION;
  if (decision === "needs_more_info") return SAFETY_FINDING_REVIEW_STATUSES.NEEDS_MORE_INFO;
  return SAFETY_FINDING_REVIEW_STATUSES.DRAFT_AI_GENERATED;
}

export function sanitizeFilename(value, fallback = "xhandle-export") {
  const text = normalizeText(value, fallback).replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
  return text.replace(/^-|-$/g, "") || fallback;
}
