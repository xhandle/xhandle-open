export const SAFETY_CASE_NODE_TYPES = [
  "claim",
  "strategy",
  "context",
  "assumption",
  "justification",
  "evidence",
  "hazardLink",
  "requirementLink",
  "verificationLink",
  "architectureLink",
];

export const SAFETY_CASE_STATUSES = ["draft", "needs-review", "supported", "unsupported", "accepted"];
export const SAFETY_CASE_CONFIDENCE = ["low", "medium", "high"];
export const SAFETY_CASE_RELATIONSHIPS = ["supports", "decomposes", "contextualizes", "evidences", "assumes", "justifies"];

export const NODE_TYPE_LABELS = {
  claim: "Claim",
  strategy: "Strategy",
  context: "Context",
  assumption: "Assumption",
  justification: "Justification",
  evidence: "Evidence",
  hazardLink: "Hazard Link",
  requirementLink: "Requirement Link",
  verificationLink: "Verification Link",
  architectureLink: "Architecture Link",
};

export const NODE_TYPE_STYLES = {
  claim: "border-[#2D7DFE] bg-[#F4F8FF] text-[#164EA6]",
  strategy: "border-indigo-400 bg-indigo-50 text-indigo-800",
  context: "border-gray-300 bg-gray-50 text-gray-700",
  assumption: "border-amber-400 bg-amber-50 text-amber-800",
  justification: "border-purple-400 bg-purple-50 text-purple-800",
  evidence: "border-emerald-400 bg-emerald-50 text-emerald-800",
  hazardLink: "border-red-400 bg-red-50 text-red-800",
  requirementLink: "border-teal-400 bg-teal-50 text-teal-800",
  verificationLink: "border-cyan-400 bg-cyan-50 text-cyan-800",
  architectureLink: "border-orange-400 bg-orange-50 text-orange-800",
};

export function uuid(prefix = "sc") {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function createSafetyCaseNode(overrides = {}) {
  const timestamp = nowISO();
  return {
    id: overrides.id || uuid("scn"),
    type: overrides.type || "claim",
    title: overrides.title || "New safety case node",
    description: overrides.description || "",
    status: overrides.status || "draft",
    confidence: overrides.confidence || "medium",
    parentId: overrides.parentId ?? null,
    linkedArtifactIds: Array.isArray(overrides.linkedArtifactIds) ? overrides.linkedArtifactIds : [],
    metadata: {
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: overrides.metadata?.createdBy || overrides.createdBy || "user",
      lastModifiedBy: overrides.metadata?.lastModifiedBy || overrides.lastModifiedBy || "user",
      ...(overrides.metadata || {}),
    },
    position: overrides.position || { x: 0, y: 0 },
    collapsed: Boolean(overrides.collapsed),
    notes: overrides.notes || "",
  };
}

export function createSafetyCaseEdge(source, target, relationship = "supports", label = "") {
  return {
    id: uuid("sce"),
    source,
    target,
    relationship,
    label: label || relationship,
  };
}

export function createBlankSafetyCase({ projectId = null, name = "Untitled Safety Case" } = {}) {
  const timestamp = nowISO();
  const root = createSafetyCaseNode({
    type: "claim",
    title: "System is acceptably safe for intended use",
    description: "Top-level safety claim for the system. Refine this claim to match the project's operational context, hazards, and assurance goals.",
    status: "draft",
    confidence: "medium",
    position: { x: 0, y: 0 },
  });
  return {
    id: uuid("safety-case"),
    projectId,
    sourceProjectId: projectId,
    folderId: null,
    name,
    description: "",
    nodes: [root],
    edges: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeSafetyCase(raw) {
  const timestamp = nowISO();
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes.map((node) => createSafetyCaseNode(node)) : [];
  const validIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(raw?.edges)
    ? raw.edges.filter((edge) => validIds.has(edge.source) && validIds.has(edge.target)).map((edge) => ({
        id: edge.id || uuid("sce"),
        source: edge.source,
        target: edge.target,
        relationship: SAFETY_CASE_RELATIONSHIPS.includes(edge.relationship) ? edge.relationship : "supports",
        label: edge.label || edge.relationship || "supports",
      }))
    : [];
  return {
    id: raw?.id || uuid("safety-case"),
    projectId: raw?.projectId ?? null,
    sourceProjectId: raw?.sourceProjectId ?? raw?.projectId ?? null,
    folderId: raw?.folderId ?? null,
    name: raw?.name || "Untitled Safety Case",
    description: raw?.description || "",
    nodes,
    edges,
    createdAt: raw?.createdAt || timestamp,
    updatedAt: raw?.updatedAt || timestamp,
  };
}
