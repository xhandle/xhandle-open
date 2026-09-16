import React, { useMemo, useState } from "react";
import { ChevronRight, FileArchive, FileText, Trash2 } from "lucide-react";
import {
  REVIEW_LIFECYCLE_STATES,
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  reviewLifecycleStateForItem,
} from "./reviewTypes";
import { createReviewId } from "./reviewUtils";
import { useResultsReview } from "./ResultsReviewProvider";
import ReviewActivityHistoryModal from "./ReviewActivityHistoryModal";

const SUMMARY_ARTIFACTS_KEY = "xhandle:review-summary-artifacts";

const IN_PROGRESS_STATUSES = new Set([
  REVIEW_STATUSES.NEEDS_REGENERATION,
  REVIEW_STATUSES.NEEDS_MORE_CONTEXT,
]);

const CLOSED_STATUSES = new Set([
  REVIEW_STATUSES.APPROVED_AS_IS,
  REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS,
  REVIEW_STATUSES.REJECTED,
  REVIEW_STATUSES.SUPERSEDED,
]);

function lifecycleForItem(item = {}) {
  const reviewState = reviewLifecycleStateForItem(item);
  if (reviewState === REVIEW_LIFECYCLE_STATES.ARCHIVED) return "archived";
  if (reviewState === REVIEW_LIFECYCLE_STATES.IN_PROGRESS) return "inProgress";
  if (reviewState === REVIEW_LIFECYCLE_STATES.CLOSED) return "closed";
  // Preserve the legacy status fallback for review items created before
  // reviewState was persisted.
  if (IN_PROGRESS_STATUSES.has(item.status)) return "inProgress";
  if (CLOSED_STATUSES.has(item.status)) return "closed";
  return "open";
}

function lifecycleLabel(group) {
  if (!group.total) return "Open";
  if (group.archived === group.total) return "Archived";
  if (group.closed === group.total) return "Closed";
  if (group.inProgress > 0 || group.closed > 0 || group.archived > 0) return "In progress";
  return "Open";
}

function reviewStateForGroup(group = {}) {
  const states = new Set((group.items || []).map(reviewLifecycleStateForItem));
  return states.size === 1 ? Array.from(states)[0] : "mixed";
}

function materialTypeLabel(groupOrItem = {}) {
  const value = String(groupOrItem.artifactType || groupOrItem.reviewUnitType || "").toLowerCase();
  if (value.includes("collaborator_vibe_review_session") || value.includes("review_session")) return "Collaborator Vibe Review Sessions";
  if (value.includes("code_architecture") && value.includes("hazard_summary")) return "Code Architecture Hazard Summary";
  if (value.includes("code_architecture") && value.includes("functional_decomposition")) return "Code Architecture Functional Decomposition";
  if (value.includes("hazard_summary")) return "Hazard Analysis Summary";
  if (value.includes("functional_decomposition")) return "Functional Decomposition Table";
  if (value.includes("requirement")) return "Requirements";
  if (value.includes("report")) return "Report Sections";
  if (value.includes("diagram") && value.includes("edge")) return "Diagram Edges";
  if (value.includes("diagram") && value.includes("node")) return "Diagram Nodes";
  if (value.includes("diagram")) return "Diagram Elements";
  if (value.includes("safety_case") || value.includes("safety-case")) return "Safety Case Elements";
  if (value.includes("trace")) return "Traceability Links";
  if (value.includes("table")) return "Generated Table";
  return "Review Material";
}

function inferProjectId(item = {}) {
  if (item.projectId) return item.projectId;
  const artifactId = String(item.artifactId || "");
  const parts = artifactId.split(":");
  const projectScopedPrefixes = new Set([
    "hazard-summary",
    "functional-decomposition",
    "code-architecture-hazard-summary",
    "code-architecture-functional-decomposition",
  ]);
  if (parts.length >= 2 && projectScopedPrefixes.has(parts[0]) && parts[1]) return parts[1];
  return "";
}

function resolveProjectIdForItem(item = {}, projects = []) {
  const inferredProjectId = inferProjectId(item);
  if (inferredProjectId) return inferredProjectId;

  const searchable = [
    item.id,
    item.artifactId,
    item.sourceRunId,
  ].filter(Boolean).join(" ");

  return projects.find((project) => project?.id && searchable.includes(project.id))?.id || "";
}

function reviewItemBelongsToLiveProject(item, projects = []) {
  if (!projects.length) return false;
  const liveProjectIds = new Set(projects.map((project) => project.id).filter(Boolean));
  const projectId = resolveProjectIdForItem(item, projects);
  return Boolean(projectId && liveProjectIds.has(projectId));
}

function loadSummaryArtifacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUMMARY_ARTIFACTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSummaryArtifact(artifact) {
  const existing = loadSummaryArtifacts();
  const next = [artifact, ...existing.filter((item) => item.id !== artifact.id)].slice(0, 100);
  localStorage.setItem(SUMMARY_ARTIFACTS_KEY, JSON.stringify(next));
  window.dispatchEvent?.(new CustomEvent("xhandle:data-changed", { detail: { key: SUMMARY_ARTIFACTS_KEY } }));
  return artifact;
}

function summarizeItems(items) {
  const counts = items.reduce((acc, item) => {
    const lifecycle = lifecycleForItem(item);
    acc.total += 1;
    acc[lifecycle] += 1;
    acc.byStatus[item.status] = (acc.byStatus[item.status] || 0) + 1;
    return acc;
  }, { total: 0, open: 0, inProgress: 0, closed: 0, archived: 0, byStatus: {} });

  const markdown = [
    "# AI Results Review Summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Total review items: ${counts.total}`,
    `Open: ${counts.open}`,
    `In progress: ${counts.inProgress}`,
    `Closed: ${counts.closed}`,
    `Archived: ${counts.archived}`,
    "",
    "## Status Breakdown",
    ...Object.entries(counts.byStatus).map(([status, count]) => `- ${REVIEW_STATUS_LABELS[status] || status}: ${count}`),
    "",
    "## Review Groups",
    ...groupReviewItems(items).map((group, index) => (
      `${index + 1}. ${materialTypeLabel(group)} - ${group.total} items, ${group.open} open, ${group.inProgress} in progress, ${group.closed} closed`
    )),
  ].join("\n");

  return { counts, markdown };
}

function itemUpdatedTime(item = {}) {
  return Date.parse(item.updatedAt || item.reviewedAt || item.createdAt || "") || 0;
}

function compactReviewIdentifier(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const tail = text.split(":").filter(Boolean).pop() || text;
  return tail.length > 10 ? tail.slice(-8) : tail;
}

function reviewRecordCode(value) {
  const text = String(value || "review");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

function newestReviewItem(group = {}) {
  return (group.items || []).reduce((newest, item) => (
    !newest || itemUpdatedTime(item) > itemUpdatedTime(newest) ? item : newest
  ), null);
}

function reviewRecordName(group = {}) {
  const item = newestReviewItem(group) || {};
  const isVibeReview = group.artifactType === "collaborator_vibe_review_session";
  const suppliedReviewName = String(item.currentContent?.reviewName || item.vibeReview?.reviewName || "").trim();
  if (isVibeReview && suppliedReviewName) return suppliedReviewName;
  const base = isVibeReview ? "Vibe Review" : group.materialType || "Review Record";
  const scope = item.currentContent?.scope || item.vibeReview?.scopeLabel || group.sourceMethod || "";
  const stableId = compactReviewIdentifier(item.currentContent?.sessionId || item.sourceRunId || group.sourceRunId || group.artifactRoot || group.key);
  const recordCode = reviewRecordCode(group.key || group.artifactRoot || stableId);
  const timestamp = item.updatedAt || item.reviewedAt || item.createdAt || group.updatedAt;
  const when = timestamp ? new Date(timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  return [base, scope, [when, stableId, `#${recordCode}`].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
}

function artifactRootForItem(item = {}) {
  return item.artifactId?.split(":row:")?.[0] || item.artifactId || "";
}

function reviewUnitKey(item = {}) {
  const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex;
  if (Number.isFinite(Number(rowIndex))) return `row:${Number(rowIndex)}`;

  const cell = item.currentContent?.cell ?? item.originalContent?.cell;
  if (cell !== undefined && cell !== null) return `cell:${String(cell)}`;

  return item.artifactId || item.id;
}

function groupReviewItems(items, projects = []) {
  const groups = new Map();
  items.forEach((item) => {
    const projectId = resolveProjectIdForItem(item, projects);
    const artifactRoot = artifactRootForItem(item);
    const key = [
      projectId || "workspace",
      item.artifactType || "artifact",
      artifactRoot,
    ].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sourceFeature: item.sourceFeature || "Unknown source",
        sourceMethod: item.sourceMethod || "",
        sourceRunId: item.sourceRunId || "",
        artifactType: item.artifactType || "artifact",
        materialType: materialTypeLabel(item),
        projectId,
        artifactRoot,
        total: 0,
        open: 0,
        inProgress: 0,
        closed: 0,
        archived: 0,
        byStatus: {},
        updatedAt: item.updatedAt || item.createdAt || "",
        items: [],
        itemsByUnit: new Map(),
        sourceRunIds: new Set(),
      });
    }
    const group = groups.get(key);
    const unitKey = reviewUnitKey(item);
    const existing = group.itemsByUnit.get(unitKey);
    if (!existing || itemUpdatedTime(item) >= itemUpdatedTime(existing)) {
      group.itemsByUnit.set(unitKey, item);
    }
    if (item.sourceRunId) group.sourceRunIds.add(item.sourceRunId);
    if (itemUpdatedTime(item) > itemUpdatedTime({ updatedAt: group.updatedAt })) {
      group.updatedAt = item.updatedAt || item.reviewedAt || item.createdAt || "";
      group.sourceFeature = item.sourceFeature || group.sourceFeature;
      group.sourceMethod = item.sourceMethod || group.sourceMethod;
      group.sourceRunId = item.sourceRunId || group.sourceRunId;
    }
  });
  return Array.from(groups.values())
    .map((group) => {
      const latestItems = Array.from(group.itemsByUnit.values())
        .sort((a, b) => reviewUnitKey(a).localeCompare(reviewUnitKey(b), undefined, { numeric: true }));
      const summary = latestItems.reduce((acc, item) => {
        const lifecycle = lifecycleForItem(item);
        acc.total += 1;
        acc[lifecycle] += 1;
        acc.byStatus[item.status] = (acc.byStatus[item.status] || 0) + 1;
        return acc;
      }, { total: 0, open: 0, inProgress: 0, closed: 0, archived: 0, byStatus: {} });

      return {
        ...group,
        ...summary,
        items: latestItems,
        sourceRunIds: Array.from(group.sourceRunIds),
        itemsByUnit: undefined,
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function progressPercent(group) {
  if (!group.total) return 0;
  return Math.round(((group.closed + group.archived) / group.total) * 100);
}

function relatedReviewHistoryItems(group, allItems = []) {
  const groupItems = group?.items || [];
  const artifactType = String(group?.artifactType || "");
  const domain = artifactType.includes("hazard_summary")
    ? "hazard-analysis"
    : artifactType.includes("functional_decomposition")
      ? "functional-decomposition"
      : "";
  if (!domain) return groupItems;
  const codeArchitecture = artifactType.includes("code_architecture");
  const relatedSessions = allItems.filter((item) => {
    if (item.artifactType !== "collaborator_vibe_review_session" || item.projectId !== group.projectId) return false;
    if (item.currentContent?.domain !== domain) return false;
    const sessionIsCodeArchitecture = item.currentContent?.workspaceType === "code-based-architecture";
    if (sessionIsCodeArchitecture !== codeArchitecture) return false;
    if (!codeArchitecture) return true;
    const groupRepoId = String(group.artifactRoot || "").split(":")[2] || "";
    const sessionRepoId = String(item.currentContent?.repoId || "");
    return !groupRepoId || !sessionRepoId || groupRepoId === sessionRepoId;
  });
  return [...groupItems, ...relatedSessions];
}

function projectNameForId(projectId, projects = []) {
  if (!projectId || projectId === "workspace" || projectId === "default") return "Workspace";
  return projects.find((project) => project.id === projectId)?.name || "Workspace";
}

function projectPanelTitle(projectName) {
  if (/project$/i.test(String(projectName || "").trim())) return projectName;
  return `${projectName} Project`;
}

function summarizeGroups(groups) {
  return groups.reduce((acc, group) => {
    acc.total += group.total;
    acc.open += group.open;
    acc.inProgress += group.inProgress;
    acc.closed += group.closed;
    acc.archived += group.archived;
    return acc;
  }, { total: 0, open: 0, inProgress: 0, closed: 0, archived: 0 });
}

function groupProjectPanels(groups, projects) {
  const panels = new Map();
  groups.forEach((group) => {
    const projectId = group.projectId || "workspace";
    if (!panels.has(projectId)) {
      panels.set(projectId, {
        projectId,
        projectName: projectNameForId(projectId, projects),
        groups: [],
        total: 0,
        open: 0,
        inProgress: 0,
        closed: 0,
        archived: 0,
        updatedAt: "",
      });
    }
    const panel = panels.get(projectId);
    panel.groups.push(group);
    panel.total += group.total;
    panel.open += group.open;
    panel.inProgress += group.inProgress;
    panel.closed += group.closed;
    panel.archived += group.archived;
    if (String(group.updatedAt || "") > String(panel.updatedAt || "")) {
      panel.updatedAt = group.updatedAt || "";
    }
  });
  return Array.from(panels.values()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function groupReviewRecordsByType(groups = []) {
  const byType = new Map();
  groups.forEach((group) => {
    const type = group.materialType || "Review Material";
    if (!byType.has(type)) byType.set(type, { type, groups: [], updatedAt: "" });
    const section = byType.get(type);
    section.groups.push(group);
    if (String(group.updatedAt || "") > String(section.updatedAt || "")) section.updatedAt = group.updatedAt || "";
  });
  return Array.from(byType.values())
    .map((section) => ({ ...section, ...summarizeGroups(section.groups) }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.type.localeCompare(b.type));
}

export default function ReviewCenter({
  projects = [],
  onOpenSource,
  onExportCodeArchitectureReviewPackage,
  isExportingCodeArchitectureReviewPackage = false,
}) {
  const review = useResultsReview();
  const [filter, setFilter] = useState("all");
  const [generatedArtifact, setGeneratedArtifact] = useState(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState(() => new Set());
  const [collapsedTypeKeys, setCollapsedTypeKeys] = useState(() => new Set());
  const [historyRecord, setHistoryRecord] = useState(null);
  const [changingGroupKey, setChangingGroupKey] = useState("");

  const items = useMemo(() => (
    (review.reviewItems || []).filter((item) => reviewItemBelongsToLiveProject(item, projects))
  ), [projects, review.reviewItems]);
  const groups = useMemo(() => groupReviewItems(items, projects), [items, projects]);
  const filteredGroups = useMemo(() => groups.filter((group) => {
    if (filter === "all") return true;
    return lifecycleLabel(group).toLowerCase().replace(/\s+/g, "-") === filter;
  }), [filter, groups]);
  const filteredItems = useMemo(() => filteredGroups.flatMap((group) => group.items), [filteredGroups]);
  const projectPanels = useMemo(() => groupProjectPanels(filteredGroups, projects), [filteredGroups, projects]);
  const filteredStats = useMemo(() => summarizeGroups(filteredGroups), [filteredGroups]);

  const generateSummaryArtifact = () => {
    const { counts, markdown } = summarizeItems(filteredItems);
    const createdAt = new Date().toISOString();
    const artifact = {
      id: createReviewId("review-summary", "all-projects", createdAt),
      title: "Review Summary Evidence - All Projects",
      name: "Review Summary Evidence - All Projects",
      type: "review-summary-evidence",
      category: "Notes & Reviews",
      projectId: null,
      projectName: "All Projects",
      source: "Review Center",
      summary: markdown,
      description: `Human-in-the-loop review summary covering ${counts.total} review items.`,
      reviewSummary: counts,
      reviewItemIds: filteredItems.map((item) => item.id),
      sourceRunIds: Array.from(new Set(filteredItems.map((item) => item.sourceRunId).filter(Boolean))),
      createdAt,
      updatedAt: createdAt,
    };
    setGeneratedArtifact(saveSummaryArtifact(artifact));
  };

  const toggleProjectPanel = (projectId) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const toggleTypeGroup = (typeKey) => {
    setCollapsedTypeKeys((current) => {
      const next = new Set(current);
      if (next.has(typeKey)) next.delete(typeKey);
      else next.add(typeKey);
      return next;
    });
  };

  const changeGroupReviewState = async (group, reviewState) => {
    if (!group?.items?.length || !Object.values(REVIEW_LIFECYCLE_STATES).includes(reviewState)) return;
    setChangingGroupKey(group.key);
    try {
      await review.setReviewItemsState(group.items.map((item) => item.id), reviewState);
    } finally {
      setChangingGroupKey("");
    }
  };

  const openReviewRecord = (group, projectName) => {
    const historyItems = relatedReviewHistoryItems(group, items);
    setHistoryRecord({
      ...group,
      projectName,
      recordName: reviewRecordName(group),
      items: historyItems,
      reviewItemIds: group.items.map((item) => item.id),
      deleteItemIds: historyItems.map((item) => item.id),
    });
  };

  const deleteReviewRecord = async (record) => {
    const ids = Array.from(new Set(record?.deleteItemIds || record?.items?.map((item) => item.id) || [])).filter(Boolean);
    if (!ids.length) return false;
    const label = [record?.projectName, record?.materialType].filter(Boolean).join(" · ") || "this review record";
    const confirmed = window.confirm(`Delete ${label}?\n\nThis will permanently remove ${ids.length} review item${ids.length === 1 ? "" : "s"} and the associated QA history. The source artifact will not be deleted.`);
    if (!confirmed) return false;
    await review.deleteReviewItemsByIds(ids);
    setHistoryRecord((current) => current?.key === record?.key ? null : current);
    return true;
  };

  const filterButton = (label, value, count) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`rounded-md border px-3 py-2 text-left ${filter === value ? "border-[#2D7DFE] bg-blue-50 text-blue-900" : "border-gray-200 bg-white hover:bg-gray-50"}`}
    >
      <div className="text-xl font-semibold">{count}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white px-3 py-1 md:px-5 lg:px-7">
      <h1 className="sr-only">Review Center</h1>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {onExportCodeArchitectureReviewPackage && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f66d1] disabled:cursor-wait disabled:opacity-50"
              disabled={isExportingCodeArchitectureReviewPackage}
              onClick={onExportCodeArchitectureReviewPackage}
            >
              <FileArchive size={16} /> {isExportingCodeArchitectureReviewPackage ? "Generating Review App..." : "Generate Code Based Architecture Review App"}
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f66d1] disabled:opacity-50"
            disabled={!filteredItems.length}
            onClick={generateSummaryArtifact}
          >
            <FileText size={16} /> Generate Summary Evidence
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {filterButton("All material groups", "all", groups.length)}
        {filterButton("Open", "open", groups.filter((group) => lifecycleLabel(group) === "Open").length)}
        {filterButton("In progress", "in-progress", groups.filter((group) => lifecycleLabel(group) === "In progress").length)}
        {filterButton("Closed", "closed", groups.filter((group) => lifecycleLabel(group) === "Closed").length)}
        {filterButton("Archived", "archived", groups.filter((group) => lifecycleLabel(group) === "Archived").length)}
      </div>

      {generatedArtifact && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Generated evidence artifact: <span className="font-semibold">{generatedArtifact.title}</span>. It is available to link from Safety Case evidence.
        </div>
      )}

      <div className="mb-4 rounded-md border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm text-gray-700">
        All projects: {filteredStats.total} review items across {filteredGroups.length} review material group{filteredGroups.length === 1 ? "" : "s"} · {filteredStats.open} open · {filteredStats.inProgress} in progress · {filteredStats.closed} closed · {filteredStats.archived} archived
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border border-gray-200 bg-[#F8FAFC] p-2">
        <div className="space-y-2">
          {projectPanels.map((panel) => {
          const expanded = expandedProjectIds.has(panel.projectId);
          return (
            <section key={panel.projectId} className="rounded-md border border-gray-200 bg-[#F8FAFC]">
              <button
                type="button"
                className={`flex w-full items-start justify-between gap-3 bg-white px-4 py-4 text-left hover:bg-gray-50 ${expanded ? "border-b border-gray-200" : ""}`}
                onClick={() => toggleProjectPanel(panel.projectId)}
                aria-expanded={expanded}
              >
                <span className="flex min-w-0 gap-3">
                  <ChevronRight
                    size={18}
                    className={`mt-1 shrink-0 text-gray-500 transition-transform ${expanded ? "rotate-90" : ""}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-lg font-semibold text-gray-950">{projectPanelTitle(panel.projectName)}</span>
                    <span className="mt-1 block text-sm text-gray-600">
                      {panel.total} review items across {panel.groups.length} review material group{panel.groups.length === 1 ? "" : "s"} · {panel.open} open · {panel.inProgress} in progress · {panel.closed} closed · {panel.archived} archived
                    </span>
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
                  {expanded ? "Collapse" : "Expand"}
                </span>
              </button>

              {expanded && (
                <div className="space-y-2 p-3">
                  {groupReviewRecordsByType(panel.groups).map((typeGroup) => {
                    const typeKey = `${panel.projectId}|${typeGroup.type}`;
                    const typeExpanded = !collapsedTypeKeys.has(typeKey);
                    return (
                      <section key={typeKey} className="overflow-hidden rounded-md border border-gray-200 bg-gray-50/70">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100"
                          onClick={() => toggleTypeGroup(typeKey)}
                          aria-expanded={typeExpanded}
                        >
                          <ChevronRight size={14} className={`shrink-0 text-gray-500 transition-transform ${typeExpanded ? "rotate-90" : ""}`} />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900">{typeGroup.type}</span>
                          <span className="shrink-0 text-[10px] text-gray-500">
                            {typeGroup.groups.length} record{typeGroup.groups.length === 1 ? "" : "s"} · {typeGroup.total} item{typeGroup.total === 1 ? "" : "s"}
                          </span>
                        </button>
                        {typeExpanded && (
                          <div className="space-y-1.5 border-t border-gray-200 p-2">
                            {typeGroup.groups.map((group) => {
                      const pct = progressPercent(group);
                      return (
                        <div key={group.key} className="relative overflow-hidden rounded-md border border-gray-200 bg-white px-2.5 py-2 shadow-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-semibold text-gray-950" title={reviewRecordName(group)}>{reviewRecordName(group)}</div>
                              <div className="truncate text-[10px] leading-4 text-gray-500">
                                {group.total} item{group.total === 1 ? "" : "s"} · {group.open} open · {group.inProgress} active · {group.closed} closed · {group.archived} archived
                              </div>
                            </div>
                            <label className="shrink-0">
                              <span className="sr-only">Change review state for {group.materialType}</span>
                              <select
                                aria-label={`Change review state for ${group.materialType}`}
                                className={`h-7 rounded-full border px-2 text-[11px] font-semibold disabled:cursor-wait disabled:opacity-60 ${
                                  lifecycleLabel(group) === "Closed"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : lifecycleLabel(group) === "Archived"
                                      ? "border-slate-300 bg-slate-100 text-slate-700"
                                    : lifecycleLabel(group) === "In progress"
                                      ? "border-orange-200 bg-orange-50 text-orange-800"
                                      : "border-amber-200 bg-amber-50 text-amber-800"
                                }`}
                                value={reviewStateForGroup(group)}
                                disabled={changingGroupKey === group.key}
                                onChange={(event) => changeGroupReviewState(group, event.target.value)}
                              >
                                {reviewStateForGroup(group) === "mixed" && <option value="mixed" disabled>Mixed states</option>}
                                <option value={REVIEW_LIFECYCLE_STATES.OPEN}>{reviewStateForGroup(group) === REVIEW_LIFECYCLE_STATES.OPEN ? "Open" : "Re-open"}</option>
                                <option value={REVIEW_LIFECYCLE_STATES.IN_PROGRESS}>In progress</option>
                                <option value={REVIEW_LIFECYCLE_STATES.CLOSED}>Closed</option>
                                <option value={REVIEW_LIFECYCLE_STATES.ARCHIVED}>Archived</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              className="h-7 shrink-0 rounded-md border border-violet-200 bg-violet-50 px-2 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
                              onClick={() => openReviewRecord(group, panel.projectName)}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="h-7 shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                              onClick={() => onOpenSource?.({ ...group.items[0], projectId: panel.projectId })}
                            >
                              Source
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                              aria-label={`Delete ${reviewRecordName(group)}`}
                              title="Delete review record"
                              onClick={() => {
                                const historyItems = relatedReviewHistoryItems(group, items);
                                deleteReviewRecord({
                                  ...group,
                                  projectName: panel.projectName,
                                  deleteItemIds: historyItems.map((item) => item.id),
                                });
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gray-100"><div className="h-full bg-[#2D7DFE]" style={{ width: `${pct}%` }} /></div>
                        </div>
                      );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          );
          })}

          {!projectPanels.length && (
            <div className="rounded-md border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No review groups match this status.
            </div>
          )}
        </div>
      </div>
      <ReviewActivityHistoryModal
        record={historyRecord}
        onClose={() => setHistoryRecord(null)}
        onOpenSource={(item) => {
          setHistoryRecord(null);
          onOpenSource?.(item);
        }}
        onChangeReviewState={async (reviewState) => {
          const ids = historyRecord?.reviewItemIds || [];
          const changedItems = await review.setReviewItemsState(ids, reviewState);
          if (!changedItems.length) return changedItems;
          const changedById = new Map(changedItems.map((item) => [item.id, item]));
          setHistoryRecord((current) => current ? {
            ...current,
            items: current.items.map((item) => changedById.get(item.id) || item),
          } : current);
          return changedItems;
        }}
        onDelete={() => deleteReviewRecord(historyRecord)}
      />
    </div>
  );
}
