export const ACTIVE_FUNCTIONAL_PROJECTS_KEY = "xhandle.projects";
export const ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY = "xhandle.codeArchitectureProjects";

export function classifyStoredWorkspaceProjects(workspaceProjects = [], functionalProjects = [], codeArchitectureProjects = []) {
  const activeFunctionalIds = new Set(functionalProjects.map((project) => String(project?.id || "")).filter(Boolean));
  const activeCodeIds = new Set(codeArchitectureProjects.map((project) => String(project?.id || "")).filter(Boolean));
  return (workspaceProjects || [])
    .filter((project) => (
      project?.sourceStore === `localStorage:${ACTIVE_FUNCTIONAL_PROJECTS_KEY}` ||
      project?.sourceStore === `localStorage:${ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY}`
    ))
    .map((project) => {
      const workspaceType = project.sourceStore === `localStorage:${ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY}`
        ? "code-architecture"
        : "functional";
      const active = workspaceType === "code-architecture"
        ? activeCodeIds.has(String(project.id))
        : activeFunctionalIds.has(String(project.id));
      return { ...project, workspaceType, active, recoverable: !active && !!project.sourceData };
    })
    .sort((a, b) => Number(a.active) - Number(b.active) || String(a.name || "").localeCompare(String(b.name || "")));
}

const STORAGE_SEGMENTS = [
  { id: "projects", label: "Projects & diagrams", color: "#3b82f6", match: /project|requirement|functional|diagram/i },
  { id: "code", label: "Code architecture", color: "#8b5cf6", match: /code|source|repository|baseline/i },
  { id: "analysis", label: "Analysis & reviews", color: "#f59e0b", match: /analysis|review|hazard|safety|remediation|evidence|traceability|verification/i },
  { id: "settings", label: "Settings", color: "#10b981", match: /setting|preference|credential|workspace/i },
];

export function buildBrowserStorageSummary(inventory) {
  const items = Array.isArray(inventory?.items) ? inventory.items : [];
  const buckets = new Map(STORAGE_SEGMENTS.map((segment) => [segment.id, { ...segment, bytes: 0 }]));
  const other = { id: "other", label: "Other xHandle data", color: "#64748b", bytes: 0 };
  items.forEach((item) => {
    const searchable = `${item?.id || ""} ${item?.label || ""} ${item?.description || ""}`;
    const segment = STORAGE_SEGMENTS.find((candidate) => candidate.match.test(searchable));
    const target = segment ? buckets.get(segment.id) : other;
    target.bytes += Math.max(0, Number(item?.bytes || 0));
  });
  const measuredBytes = items.reduce((total, item) => total + Math.max(0, Number(item?.bytes || 0)), 0);
  const reportedUsageBytes = Math.max(0, Number(inventory?.usageBytes || 0));
  const usedBytes = Math.max(measuredBytes, reportedUsageBytes);
  const unclassifiedBrowserBytes = Math.max(0, usedBytes - measuredBytes);
  if (unclassifiedBrowserBytes) other.bytes += unclassifiedBrowserBytes;
  const quotaBytes = Math.max(0, Number(inventory?.quotaBytes || 0));
  const availableBytes = quotaBytes ? Math.max(0, quotaBytes - usedBytes) : null;
  const segments = [...buckets.values(), other].filter((segment) => segment.bytes > 0);
  return { usedBytes, measuredBytes, quotaBytes, availableBytes, segments };
}
