import { REVIEW_STATUSES, REVIEW_UNIT_TYPES } from "./reviewTypes";

const nowISO = () => new Date().toISOString();

export const createReviewId = (...parts) =>
  parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== "")
    .map((part) => String(part).replace(/[^a-zA-Z0-9_.:-]+/g, "-"))
    .join("__");

export function normalizeReviewItem(item = {}) {
  const now = nowISO();
  const id = item.id || createReviewId("review", item.sourceRunId, item.artifactType, item.artifactId, item.reviewUnitType, Date.now());
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
    status: item.status || REVIEW_STATUSES.DRAFT_AI_GENERATED,
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
