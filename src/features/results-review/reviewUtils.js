import {
  REVIEW_STATUSES,
  REVIEW_UNIT_TYPES,
  reviewLifecycleStateForStatus,
} from "./reviewTypes";

const nowISO = () => new Date().toISOString();

export const createReviewId = (...parts) =>
  parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== "")
    .map((part) => String(part).replace(/[^a-zA-Z0-9_.:-]+/g, "-"))
    .join("__");

export function normalizeReviewItem(item = {}) {
  const now = nowISO();
  const id = item.id || createReviewId("review", item.sourceRunId, item.artifactType, item.artifactId, item.reviewUnitType, Date.now());
  const status = item.status || REVIEW_STATUSES.DRAFT_AI_GENERATED;
  return {
    id,
    artifactType: item.artifactType || "unknown_artifact",
    artifactId: item.artifactId || id,
    projectId: item.projectId || "",
    reviewUnitType: item.reviewUnitType || REVIEW_UNIT_TYPES.TABLE_ROW,
    sourceFeature: item.sourceFeature || "unknown",
    sourceMethod: item.sourceMethod || "",
    sourceRunId: item.sourceRunId || "",
    originalContent: item.originalContent ?? null,
    currentContent: item.currentContent ?? item.originalContent ?? null,
    status,
    reviewState: item.reviewState || reviewLifecycleStateForStatus(status),
    reviewerFeedback: item.reviewerFeedback || "",
    reviewerId: item.reviewerId || "",
    reviewedAt: item.reviewedAt || null,
    confidence: item.confidence ?? null,
    riskImpact: item.riskImpact || "",
    traceLinks: Array.isArray(item.traceLinks) ? item.traceLinks : [],
    version: Number.isFinite(Number(item.version)) ? Number(item.version) : 1,
    history: Array.isArray(item.history) ? item.history : [],
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
  };
}

export function contentToText(content) {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export function parseEditedContent(raw, fallback) {
  const text = String(raw ?? "");
  if (!text.trim()) return "";
  try {
    return JSON.parse(text);
  } catch {
    return typeof fallback === "string" ? text : text;
  }
}

export function filterReviewItems(items, filters = {}) {
  const list = Array.isArray(items) ? items : [];
  const ids = Array.isArray(filters.reviewItemIds) ? new Set(filters.reviewItemIds) : null;
  return list.filter((item) => {
    if (ids && !ids.has(item.id)) return false;
    return ["sourceFeature", "sourceMethod", "sourceRunId", "artifactType", "artifactId", "status"].every((key) => {
      if (filters[key] === undefined || filters[key] === null || filters[key] === "") return true;
      return item[key] === filters[key];
    });
  });
}

export function isPendingReviewStatus(status) {
  return status === REVIEW_STATUSES.DRAFT_AI_GENERATED;
}

export function createHistoryEntry(action, details = {}) {
  return {
    id: createReviewId("history", action, Date.now(), Math.random().toString(36).slice(2, 8)),
    action,
    at: nowISO(),
    ...details,
  };
}

const FUNCTIONAL_VIBE_REVIEW_COLUMNS = [
  "subsystem",
  "fromFunction",
  "fromDetails",
  "controlAction",
  "controlDetails",
  "toFunction",
  "toDetails",
  "csci",
  "csc",
  "csu",
  "architectureRationale",
  "lifecyclePhase",
  "interfaceType",
  "hazardAnalysisEligibility",
  "hazardAnalysisEligibilityRationale",
];

function vibeReviewArtifactConfig(domain, workspaceType, projectId, repoId) {
  const codeArchitecture = workspaceType === "code-based-architecture";
  if (domain === "hazard-analysis") {
    return codeArchitecture
      ? {
          artifactType: "code_architecture_hazard_summary_table",
          artifactRoot: `code-architecture-hazard-summary:${projectId}:${repoId || "repo"}`,
          sourceFeature: "Code-Based Architecture Hazard Analysis",
          sourceMethod: "Collaborator hazard vibe review",
        }
      : {
          artifactType: "hazard_summary_table",
          artifactRoot: `hazard-summary:${projectId}`,
          sourceFeature: "AI Hazard Analysis",
          sourceMethod: "Collaborator hazard vibe review",
        };
  }
  return codeArchitecture
    ? {
        artifactType: "code_architecture_functional_decomposition_table",
        artifactRoot: `code-architecture-functional-decomposition:${projectId}:${repoId || "repo"}`,
        sourceFeature: "Code-Based Architecture Functional Decomposition",
        sourceMethod: "Collaborator functional-decomposition vibe review",
      }
    : {
        artifactType: "functional_decomposition_table",
        artifactRoot: `functional-decomposition:${projectId}`,
        sourceFeature: "Prompt Wizard",
        sourceMethod: "Collaborator functional-decomposition vibe review",
      };
}

function reviewStatusForVibeDecision(domain, decision, action) {
  if (action === "undo") return REVIEW_STATUSES.DRAFT_AI_GENERATED;
  if (domain === "functional-decomposition" && decision === "Keep") return REVIEW_STATUSES.APPROVED_AS_IS;
  if (domain === "functional-decomposition" && decision === "Remove") return REVIEW_STATUSES.REJECTED;
  return REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS;
}

function safeReviewValue(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function createVibeReviewDecisionEvidence({
  domain,
  projectId,
  workspaceType = "functional-project",
  repoId = "",
  sourceRunId = "",
  sessionId,
  threadId = "",
  scopeLabel = "",
  reviewTarget = "",
  rowId,
  rowIndex,
  label = "",
  action,
  decision,
  beforeRow,
  afterRow,
  columns,
  rationale = "",
  userFeedback = "",
  reviewerName = "",
  reviewerId = "",
  ai = {},
  timestamp,
} = {}) {
  const reviewedAt = timestamp || nowISO();
  const config = vibeReviewArtifactConfig(domain, workspaceType, projectId, repoId);
  const normalizedRowIndex = Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : null;
  const reviewColumns = Array.isArray(columns) && columns.length
    ? columns
    : FUNCTIONAL_VIBE_REVIEW_COLUMNS.filter((column) => (
        beforeRow?.[column] !== undefined || afterRow?.[column] !== undefined
      ));
  const originalRow = safeReviewValue(beforeRow);
  const currentRow = safeReviewValue(afterRow === undefined ? beforeRow : afterRow);
  const traceUri = domain === "hazard-analysis"
    ? `xhandle://hazard-row/${encodeURIComponent(String(rowId || ""))}?projectId=${encodeURIComponent(String(projectId || ""))}&workspaceType=${encodeURIComponent(workspaceType)}`
    : `xhandle://functional-row/${encodeURIComponent(String(rowId || ""))}?projectId=${encodeURIComponent(String(projectId || ""))}&workspaceType=${encodeURIComponent(workspaceType)}&repoId=${encodeURIComponent(String(repoId || ""))}`;
  const history = createHistoryEntry("collaborator_vibe_review_decision", {
    sessionId,
    threadId,
    scopeLabel,
    reviewTarget,
    domain,
    rowId,
    rowIndex: normalizedRowIndex,
    label,
    reviewAction: action,
    decision,
    rationale,
    userFeedback,
    reviewerName,
    reviewerId,
    provider: ai?.provider || "",
    model: ai?.model || "",
    effort: ai?.effort || "",
    before: originalRow,
    after: currentRow,
    traceUri,
    at: reviewedAt,
  });
  return normalizeReviewItem({
    id: createReviewId("collaborator-vibe-review", config.artifactRoot, rowId || normalizedRowIndex),
    artifactType: config.artifactType,
    artifactId: `${config.artifactRoot}:row:${rowId || normalizedRowIndex || "unknown"}`,
    projectId: String(projectId || ""),
    reviewUnitType: REVIEW_UNIT_TYPES.TABLE_ROW,
    sourceFeature: config.sourceFeature,
    sourceMethod: config.sourceMethod,
    sourceRunId: sourceRunId || "",
    originalContent: { rowIndex: normalizedRowIndex, rowId, columns: reviewColumns, row: originalRow },
    currentContent: { rowIndex: normalizedRowIndex, rowId, columns: reviewColumns, row: currentRow, removed: decision === "Remove" },
    status: reviewStatusForVibeDecision(domain, decision, action),
    reviewerFeedback: userFeedback || rationale || "",
    reviewerId,
    reviewedAt,
    confidence: ai?.confidence ?? null,
    traceLinks: [
      { type: "table_row", rowIndex: normalizedRowIndex, rowId, artifactId: config.artifactRoot },
      { type: "collaborator_thread", threadId, sessionId },
      { type: "source_uri", uri: traceUri },
    ],
    history: [history],
    vibeReview: { domain, sessionId, threadId, scopeLabel, reviewTarget, workspaceType, repoId, rowId, label, action, decision, reviewerName, reviewerId, ai: { ...ai } },
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
  });
}

export function createVibeReviewSessionEvidence({ domain, session, outcome = "in_progress", summary = {} } = {}) {
  const timestamp = session?.updatedAt || nowISO();
  const projectId = String(session?.projectId || "");
  const sessionId = String(session?.id || createReviewId("session", Date.now()));
  const completed = outcome === "completed";
  const stopped = outcome === "stopped" || outcome === "cancelled";
  const currentContent = {
    sessionId,
    threadId: session?.threadId || "",
    reviewName: session?.reviewName || "",
    reviewerName: session?.reviewerName || "",
    reviewerId: session?.reviewerId || "",
    domain,
    outcome,
    state: session?.state || "",
    scope: session?.scopeLabel || "",
    reviewTarget: session?.reviewTarget || "",
    workspaceType: session?.workspaceType || "functional-project",
    repoId: session?.repoId || "",
    sourceRunId: session?.sourceRunId || "",
    queueSize: session?.queue?.length || 0,
    cursor: session?.cursor || 0,
    summary: safeReviewValue(summary),
    decisions: safeReviewValue(session?.decisions || []),
    skipped: safeReviewValue(session?.skips || []),
    failures: safeReviewValue([...(session?.failures || []), ...(session?.missingRows || [])]),
    ai: safeReviewValue(session?.ai || {}),
    startedAt: session?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  return normalizeReviewItem({
    id: createReviewId("collaborator-vibe-review-session", sessionId),
    artifactType: "collaborator_vibe_review_session",
    artifactId: `collaborator-vibe-review-session:${projectId}:${domain}:row:${sessionId}`,
    projectId,
    reviewUnitType: REVIEW_UNIT_TYPES.REVIEW_SESSION,
    sourceFeature: "Collaborator Vibe Review",
    sourceMethod: domain === "hazard-analysis" ? "Hazard-analysis guided review" : "Functional-decomposition guided review",
    sourceRunId: session?.sourceRunId || sessionId,
    originalContent: currentContent,
    currentContent,
    status: completed
      ? REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS
      : stopped
        ? REVIEW_STATUSES.SUPERSEDED
        : REVIEW_STATUSES.DRAFT_AI_GENERATED,
    reviewerFeedback: `${session?.reviewName || session?.scopeLabel || "Vibe review"} — ${outcome}`,
    reviewedAt: completed || stopped ? timestamp : null,
    traceLinks: [
      { type: "reviewed_artifact", domain, projectId, workspaceType: session?.workspaceType || "functional-project", repoId: session?.repoId || "", sourceRunId: session?.sourceRunId || "" },
      { type: "collaborator_thread", threadId: session?.threadId || "", sessionId },
    ],
    reviewerId: session?.reviewerId || "",
    history: [createHistoryEntry("collaborator_vibe_review_session", { outcome, summary: safeReviewValue(summary), reviewerName: session?.reviewerName || "", reviewerId: session?.reviewerId || "", at: timestamp })],
    vibeReview: { domain, sessionId, threadId: session?.threadId || "", reviewName: session?.reviewName || "", reviewerName: session?.reviewerName || "", reviewerId: session?.reviewerId || "", scopeLabel: session?.scopeLabel || "", reviewTarget: session?.reviewTarget || "", outcome },
    createdAt: session?.createdAt || timestamp,
    updatedAt: timestamp,
  });
}

export function mergeVibeReviewEvidenceItems(items = [], incomingItem) {
  const previous = Array.isArray(items) ? items : [];
  if (!incomingItem?.id) return { items: previous, recorded: null };
  const incomingRoot = String(incomingItem.artifactId || "").split(":row:")[0];
  const incomingRowIndex = incomingItem.currentContent?.rowIndex ?? incomingItem.originalContent?.rowIndex;
  const incomingRowId = incomingItem.currentContent?.rowId ?? incomingItem.originalContent?.rowId;
  const matchIndex = previous.findIndex((item) => {
    if (item.id === incomingItem.id) return true;
    if (String(item.artifactId || "").split(":row:")[0] !== incomingRoot) return false;
    const itemRowId = item.currentContent?.rowId ?? item.originalContent?.rowId;
    if (incomingRowId && itemRowId) return String(itemRowId) === String(incomingRowId);
    const itemRowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
    return Number.isFinite(Number(incomingRowIndex)) && Number(itemRowIndex) === Number(incomingRowIndex);
  });
  if (matchIndex < 0) return { items: [...previous, incomingItem], recorded: incomingItem };

  const existing = previous[matchIndex];
  const historyById = new Map((existing.history || []).map((entry) => [entry.id, entry]));
  (incomingItem.history || []).forEach((entry) => historyById.set(entry.id, entry));
  const recorded = {
    ...existing,
    ...incomingItem,
    id: existing.id,
    artifactId: existing.artifactId || incomingItem.artifactId,
    sourceFeature: existing.sourceFeature || incomingItem.sourceFeature,
    originalContent: existing.originalContent ?? incomingItem.originalContent,
    sourceRunId: existing.sourceRunId || incomingItem.sourceRunId,
    traceLinks: Array.from(new Map([...(existing.traceLinks || []), ...(incomingItem.traceLinks || [])]
      .map((link) => [JSON.stringify(link), link])).values()),
    history: Array.from(historyById.values()).sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))),
    version: Math.max(Number(existing.version) || 1, Number(incomingItem.version) || 1) + 1,
    updatedAt: incomingItem.updatedAt || nowISO(),
  };
  const next = [...previous];
  next[matchIndex] = recorded;
  return { items: next, recorded };
}

export function createReviewItemsFromGeneratedTable({
  sourceFeature,
  sourceMethod,
  sourceRunId,
  artifactType = "generated_table",
  artifactId = "generated-table",
  projectId = "",
  rows = [],
  columns = [],
}) {
  return (Array.isArray(rows) ? rows : []).map((row, rowIndex) => {
    const content = { rowIndex, columns, row };
    return normalizeReviewItem({
      id: createReviewId(sourceRunId, artifactType, artifactId, "row", rowIndex),
      artifactType,
      artifactId: `${artifactId}:row:${rowIndex}`,
      reviewUnitType: REVIEW_UNIT_TYPES.TABLE_ROW,
      sourceFeature,
      sourceMethod,
      sourceRunId,
      projectId,
      originalContent: content,
      currentContent: content,
      traceLinks: [{ type: "table_row", rowIndex }],
    });
  });
}

export function createReviewItemsFromGeneratedRequirements({ sourceFeature, sourceRunId, requirements = [] }) {
  return (Array.isArray(requirements) ? requirements : []).map((requirement, index) =>
    normalizeReviewItem({
      id: createReviewId(sourceRunId, "requirement", requirement?.id || index),
      artifactType: "requirement",
      artifactId: requirement?.id || `requirement:${index}`,
      reviewUnitType: REVIEW_UNIT_TYPES.REQUIREMENT,
      sourceFeature,
      sourceRunId,
      originalContent: requirement,
      currentContent: requirement,
      confidence: requirement?.confidence ?? null,
      riskImpact: requirement?.riskImpact || "",
    })
  );
}

export function createReviewItemsFromGeneratedReport({ sourceFeature, sourceRunId, markdown = "" }) {
  const sections = String(markdown || "").split(/(?=^#{1,3}\s+)/m).filter((part) => part.trim());
  const chunks = sections.length ? sections : String(markdown || "").split(/\n{2,}/).filter((part) => part.trim());
  return chunks.flatMap((section, sectionIndex) => {
    const paragraphs = section.split(/\n{2,}/).filter((part) => part.trim());
    return paragraphs.map((paragraph, paragraphIndex) =>
      normalizeReviewItem({
        id: createReviewId(sourceRunId, "report", sectionIndex, paragraphIndex),
        artifactType: "generated_report",
        artifactId: `section:${sectionIndex}:paragraph:${paragraphIndex}`,
        reviewUnitType: paragraphIndex === 0 ? REVIEW_UNIT_TYPES.REPORT_SECTION : REVIEW_UNIT_TYPES.REPORT_PARAGRAPH,
        sourceFeature,
        sourceRunId,
        originalContent: paragraph,
        currentContent: paragraph,
      })
    );
  });
}

export function createReviewItemsFromGeneratedDiagram({ sourceFeature, sourceRunId, nodes = [], edges = [] }) {
  const nodeItems = (Array.isArray(nodes) ? nodes : []).map((node, index) =>
    normalizeReviewItem({
      id: createReviewId(sourceRunId, "diagram-node", node?.id || index),
      artifactType: "diagram_node",
      artifactId: node?.id || `node:${index}`,
      reviewUnitType: REVIEW_UNIT_TYPES.DIAGRAM_NODE,
      sourceFeature,
      sourceRunId,
      originalContent: node,
      currentContent: node,
    })
  );
  const edgeItems = (Array.isArray(edges) ? edges : []).map((edge, index) =>
    normalizeReviewItem({
      id: createReviewId(sourceRunId, "diagram-edge", edge?.id || index),
      artifactType: "diagram_edge",
      artifactId: edge?.id || `edge:${index}`,
      reviewUnitType: REVIEW_UNIT_TYPES.DIAGRAM_EDGE,
      sourceFeature,
      sourceRunId,
      originalContent: edge,
      currentContent: edge,
    })
  );
  return [...nodeItems, ...edgeItems];
}

export function createReviewItemsFromGeneratedSafetyCase({ sourceFeature, sourceRunId, claims = [], arguments: args = [], evidenceLinks = [] }) {
  const mapItem = (kind, unitType) => (item, index) =>
    normalizeReviewItem({
      id: createReviewId(sourceRunId, kind, item?.id || index),
      artifactType: kind,
      artifactId: item?.id || `${kind}:${index}`,
      reviewUnitType: unitType,
      sourceFeature,
      sourceRunId,
      originalContent: item,
      currentContent: item,
    });
  return [
    ...(Array.isArray(claims) ? claims : []).map(mapItem("safety_case_claim", REVIEW_UNIT_TYPES.SAFETY_CASE_CLAIM)),
    ...(Array.isArray(args) ? args : []).map(mapItem("safety_case_argument", REVIEW_UNIT_TYPES.SAFETY_CASE_ARGUMENT)),
    ...(Array.isArray(evidenceLinks) ? evidenceLinks : []).map(mapItem("safety_case_evidence_link", REVIEW_UNIT_TYPES.SAFETY_CASE_EVIDENCE_LINK)),
  ];
}

export function createReviewItemsFromGeneratedTraceabilityLinks({ sourceFeature, sourceRunId, links = [] }) {
  return (Array.isArray(links) ? links : []).map((link, index) =>
    normalizeReviewItem({
      id: createReviewId(sourceRunId, "traceability-link", link?.id || index),
      artifactType: "traceability_link",
      artifactId: link?.id || `traceability-link:${index}`,
      reviewUnitType: REVIEW_UNIT_TYPES.TRACEABILITY_LINK,
      sourceFeature,
      sourceRunId,
      originalContent: link,
      currentContent: link,
    })
  );
}
