import {
  SAFETY_FINDING_IMPLEMENTATION_STATUSES,
  SAFETY_FINDING_REVIEW_STATUSES,
  SAFETY_FINDING_VIEWS,
} from "../safetyRemediationTypes";

export const DEFAULT_FINDING_FILTERS = {
  query: "",
  view: SAFETY_FINDING_VIEWS.ACTIVE,
  folderId: "all",
  priority: "all",
  riskCode: "all",
  reviewStatus: "all",
  implementationStatus: "all",
  sortBy: "updated_desc",
};

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (typeof value === "object") return Object.values(value).map(text).join(" ");
  return String(value);
}

function searchableText(finding = {}) {
  return [
    finding.title,
    finding.description,
    finding.hazard,
    finding.causalFactor,
    finding.proposedMitigation,
    finding.architectureElementLabel,
    finding.architectureElementId,
    finding.architectureRowRef,
    finding.folderPath,
    finding.owner,
    finding.priority,
    finding.riskLevel,
    finding.riskCode,
    finding.tags,
    finding.sourceFiles,
    finding.sourceSymbols,
    finding.affectedCodeRefs,
  ].map(text).join(" ").toLowerCase();
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function findingRiskCodes(finding = {}) {
  return Array.from(new Set([
    finding.riskCode,
    finding.riskLevel,
    finding.severity,
    finding.criticality,
    ...(Array.isArray(finding.coveredHazardRows) ? finding.coveredHazardRows.flatMap((row) => [row.riskLevel, row.riskCode, row.rac, row.RAC]) : []),
    ...(Array.isArray(finding.coveredHazardRows) ? finding.coveredHazardRows.flatMap((row) => [row.severity, row.criticality, row.Severity, row.Criticality]) : []),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function visibleInView(finding = {}, view) {
  if (view === SAFETY_FINDING_VIEWS.ARCHIVED) return Boolean(finding.archivedAt) && !finding.deletedAt;
  if (view === SAFETY_FINDING_VIEWS.REMOVED) return Boolean(finding.deletedAt);
  return !finding.archivedAt && !finding.deletedAt;
}

function matchesFolder(finding = {}, folderId) {
  if (!folderId || folderId === "all") return true;
  if (folderId === "needs-review") return finding.reviewStatus === SAFETY_FINDING_REVIEW_STATUSES.DRAFT_AI_GENERATED;
  if (folderId === "patch-proposed") return finding.implementationStatus === SAFETY_FINDING_IMPLEMENTATION_STATUSES.PATCH_PROPOSED;
  if (folderId === "sent-to-vscode") return finding.implementationStatus === SAFETY_FINDING_IMPLEMENTATION_STATUSES.SENT_TO_VSCODE;
  if (folderId === "high-quality") return (finding.quality?.score || 0) >= 75;
  if (folderId === "needs-source") return !Array.isArray(finding.affectedCodeRefs) || finding.affectedCodeRefs.length === 0;
  return finding.folderId === folderId || finding.folderPath === folderId;
}

function compareDate(a, b, key) {
  const av = a?.[key] ? new Date(a[key]).getTime() : 0;
  const bv = b?.[key] ? new Date(b[key]).getTime() : 0;
  return bv - av;
}

export function findingViewCounts(findings = []) {
  return findings.reduce((acc, finding) => {
    if (finding.deletedAt) acc.removed += 1;
    else if (finding.archivedAt) acc.archived += 1;
    else acc.active += 1;
    return acc;
  }, { active: 0, archived: 0, removed: 0 });
}

export function findingFolders(findings = [], view = SAFETY_FINDING_VIEWS.ACTIVE) {
  const visible = findings.filter((finding) => visibleInView(finding, view));
  const custom = new Map();
  visible.forEach((finding) => {
    const id = finding.folderId || finding.folderPath || "";
    if (!id) return;
    custom.set(id, {
      id,
      label: finding.folderPath || finding.folderId,
      count: (custom.get(id)?.count || 0) + 1,
    });
  });
  const virtual = [
    { id: "all", label: "All Findings", count: visible.length },
    { id: "needs-review", label: "Needs Review", count: visible.filter((f) => f.reviewStatus === SAFETY_FINDING_REVIEW_STATUSES.DRAFT_AI_GENERATED).length },
    { id: "patch-proposed", label: "Patch Proposed", count: visible.filter((f) => f.implementationStatus === SAFETY_FINDING_IMPLEMENTATION_STATUSES.PATCH_PROPOSED).length },
    { id: "sent-to-vscode", label: "Sent to VS Code", count: visible.filter((f) => f.implementationStatus === SAFETY_FINDING_IMPLEMENTATION_STATUSES.SENT_TO_VSCODE).length },
    { id: "high-quality", label: "High Quality", count: visible.filter((f) => (f.quality?.score || 0) >= 75).length },
    { id: "needs-source", label: "Needs Source", count: visible.filter((f) => !Array.isArray(f.affectedCodeRefs) || f.affectedCodeRefs.length === 0).length },
  ];
  return [...virtual, ...Array.from(custom.values()).sort((a, b) => a.label.localeCompare(b.label))];
}

export function filterAndSortFindings(findings = [], filters = DEFAULT_FINDING_FILTERS) {
  const query = String(filters.query || "").trim().toLowerCase();
  const rows = findings.filter((finding) => {
    if (!visibleInView(finding, filters.view || SAFETY_FINDING_VIEWS.ACTIVE)) return false;
    if (!matchesFolder(finding, filters.folderId || "all")) return false;
    if (filters.priority && filters.priority !== "all" && norm(finding.priority) !== norm(filters.priority)) return false;
    if (filters.riskCode && filters.riskCode !== "all" && !findingRiskCodes(finding).some((code) => norm(code) === norm(filters.riskCode))) return false;
    if (filters.reviewStatus && filters.reviewStatus !== "all" && finding.reviewStatus !== filters.reviewStatus) return false;
    if (filters.implementationStatus && filters.implementationStatus !== "all" && finding.implementationStatus !== filters.implementationStatus) return false;
    if (query && !searchableText(finding).includes(query)) return false;
    return true;
  });

  return rows.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if (filters.sortBy === "created_desc") return compareDate(a, b, "createdAt");
    if (filters.sortBy === "quality_desc") return (b.quality?.score || 0) - (a.quality?.score || 0);
    if (filters.sortBy === "priority_desc") {
      const order = { critical: 4, high: 3, medium: 2, low: 1 };
      return (order[norm(b.priority)] || 0) - (order[norm(a.priority)] || 0);
    }
    if (filters.sortBy === "title_asc") return String(a.title || "").localeCompare(String(b.title || ""));
    if (filters.sortBy === "manual") return (a.sortOrder || 0) - (b.sortOrder || 0);
    return compareDate(a, b, "updatedAt");
  });
}

export function findingRiskFilterOptions(findings = [], view = SAFETY_FINDING_VIEWS.ACTIVE) {
  const counts = new Map();
  findings.filter((finding) => visibleInView(finding, view)).forEach((finding) => {
    findingRiskCodes(finding).forEach((code) => {
      counts.set(code, (counts.get(code) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: "base" }));
}
