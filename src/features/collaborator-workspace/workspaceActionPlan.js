const MUTATION_VERBS = "add|append|assign|create|change|correct|delete|edit|link|make|mark|move|remove|rename|replace|set|unlink|update";
const WORKSPACE_NOUNS = "artifact|cell|code architecture|decomposition|edge|finding|function|hazard|issue|model|node|note|project|report|requirement|risk|row|safety case|table|traceability|it|that|this";

export const WORKSPACE_ACTION_OPERATIONS = new Set([
  "create",
  "update",
  "delete",
  "link",
  "unlink",
]);

export function isWorkspaceMutationIntent(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  const hasVerb = new RegExp(`\\b(?:${MUTATION_VERBS})\\b`, "i").test(text);
  const hasWorkspaceNoun = new RegExp(`\\b(?:${WORKSPACE_NOUNS})s?\\b`, "i").test(text);
  const hypothetical = /^(?:what\s+if|what\s+would|how\s+would|why\s+would|would\s+(?:it|this|that)|could\s+(?:it|this|that)|should\s+(?:we|i))\b/i.test(text);
  return hasVerb && hasWorkspaceNoun && !hypothetical;
}

export function isWorkspaceUndoIntent(value = "") {
  return /^(?:please\s+)?(?:undo|revert)(?:\s+(?:that|it|the\s+(?:last|previous)\s+(?:change|action|edit)))?[.!]?$/i.test(String(value || "").trim());
}

export function extractWorkspaceActionJson(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch {}
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { return null; }
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeTarget(target = {}) {
  return {
    artifactId: cleanString(target.artifactId),
    type: cleanString(target.type),
    projectId: cleanString(target.projectId),
    sourceId: cleanString(target.sourceId),
    title: cleanString(target.title),
  };
}

export function normalizeWorkspaceActionPlan(rawPlan, candidates = []) {
  const raw = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const candidateById = new Map((candidates || []).filter(Boolean).map((item) => [String(item.id), item]));
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).map((item, index) => {
    const operation = cleanString(item?.operation).toLowerCase();
    const target = normalizeTarget(item?.target);
    const candidate = candidateById.get(target.artifactId);
    if (candidate) {
      target.type = target.type || cleanString(candidate.type);
      target.projectId = target.projectId || cleanString(candidate.projectId);
      target.sourceId = target.sourceId || cleanString(candidate.sourceId);
      target.title = target.title || cleanString(candidate.title);
    }
    return {
      id: cleanString(item?.id) || `workspace-action-${Date.now()}-${index + 1}`,
      operation,
      target,
      field: cleanString(item?.field),
      value: item?.value,
      record: item?.record && typeof item.record === "object" ? item.record : null,
      relationship: item?.relationship && typeof item.relationship === "object" ? item.relationship : null,
      reason: cleanString(item?.reason),
    };
  });
  return {
    intent: cleanString(raw.intent).toLowerCase() || (actions.length ? "mutate" : "clarify"),
    summary: cleanString(raw.summary),
    clarification: cleanString(raw.clarification),
    actions,
  };
}

export function validateWorkspaceActionPlan(plan, candidates = []) {
  const errors = [];
  const candidateIds = new Set((candidates || []).map((item) => String(item?.id || "")).filter(Boolean));
  if (!plan || typeof plan !== "object") return ["The model did not return an action plan."];
  if (!["mutate", "clarify", "read"].includes(plan.intent)) errors.push("The plan intent is invalid.");
  if (plan.intent === "clarify" && !plan.clarification) errors.push("The clarification question is missing.");
  if (plan.intent === "mutate" && !plan.actions.length) errors.push("No workspace actions were proposed.");
  plan.actions.forEach((action, index) => {
    const prefix = `Action ${index + 1}`;
    if (!WORKSPACE_ACTION_OPERATIONS.has(action.operation)) errors.push(`${prefix} has an unsupported operation.`);
    if (action.operation !== "create" && !action.target.artifactId) errors.push(`${prefix} does not identify a stable artifact.`);
    if (action.target.artifactId && candidateIds.size && !candidateIds.has(action.target.artifactId)) {
      errors.push(`${prefix} references an artifact that was not in the retrieved source set.`);
    }
    if (action.operation === "update" && !action.field && !action.record) errors.push(`${prefix} does not identify a field or replacement record.`);
    if (action.operation === "create" && !action.target.type) errors.push(`${prefix} does not identify an artifact type.`);
    if (action.operation === "create" && !action.record) errors.push(`${prefix} does not include the new record.`);
    if (["link", "unlink"].includes(action.operation) && !action.relationship?.toArtifactId) errors.push(`${prefix} does not identify the related artifact.`);
    if (action.relationship?.toArtifactId && candidateIds.size && !candidateIds.has(String(action.relationship.toArtifactId))) {
      errors.push(`${prefix} references a related artifact that was not in the retrieved source set.`);
    }
  });
  return errors;
}

export function workspacePlanRequiresConfirmation(plan) {
  return Boolean(plan?.actions?.length);
}

export function summarizeWorkspaceAction(action) {
  const target = action?.target?.title || action?.target?.type || "workspace artifact";
  if (action?.operation === "update") {
    return action.field ? `Update ${target}: ${action.field}` : `Update ${target}`;
  }
  if (action?.operation === "create") return `Create ${target}`;
  if (action?.operation === "delete") return `Delete ${target}`;
  if (action?.operation === "link") return `Link ${target}`;
  if (action?.operation === "unlink") return `Unlink ${target}`;
  return `${action?.operation || "Change"} ${target}`;
}

export function buildWorkspaceActionPlannerMessages({ userText, candidates = [], projects = [], relationships = [], activeView = null, history = [] } = {}) {
  const bounded = (value, max) => {
    if (value == null) return value;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length <= max ? value : `${text.slice(0, max)}...`;
  };
  // Keep edit planning responsive and predictable even when the workspace contains
  // large reports or analysis tables. Retrieval order is relevance-ranked, so the
  // planner receives the strongest matches first and a bounded evidence payload.
  const SOURCE_BUDGET = 60000;
  let remainingSourceBudget = SOURCE_BUDGET;
  const sources = [];
  for (const artifact of candidates.slice(0, 32)) {
    if (remainingSourceBudget < 600) break;
    const source = {
      artifactId: artifact.id,
      type: artifact.type,
      projectId: artifact.projectId || "",
      sourceId: artifact.sourceId || "",
      title: artifact.title || "",
      summary: bounded(artifact.summary || "", Math.min(1800, remainingSourceBudget)),
      content: bounded(artifact.content || "", Math.min(6000, remainingSourceBudget)),
      structuredData: bounded(artifact.structuredData ?? null, Math.min(6000, remainingSourceBudget)),
    };
    const serializedLength = JSON.stringify(source).length;
    if (serializedLength > remainingSourceBudget) {
      source.content = bounded(source.content || "", Math.max(0, remainingSourceBudget - 600));
      source.structuredData = null;
    }
    remainingSourceBudget -= JSON.stringify(source).length;
    sources.push(source);
  }
  return [
    {
      role: "system",
      content: [
        "You are xHandle's governed workspace action planner.",
        "Translate the user's requested workspace edit into a strict JSON plan. Never execute it and never claim it succeeded.",
        "Use only the retrieved source artifacts. For update/delete/link/unlink, copy the exact artifactId from a source. Never invent an ID or use a displayed row number as identity.",
        "If the target, field, intended value, project, or delete scope is ambiguous, return intent=clarify with one concise question and no actions.",
        "Preserve unrelated fields and records. Prefer the smallest change that fulfills the request.",
        "Supported operations: create, update, delete, link, unlink.",
        "Create/update/delete adapters cover projects; functional-decomposition rows; hazard-analysis rows; risks and consolidated safety issues; requirements; safety-issue reports; code-architecture edges; SysML models/elements; review items; and safety cases/nodes. Existing notes, evidence, findings, remediation, and verification records can be updated or deleted through their durable IndexedDB source. Requirement trace links support link/unlink. Repository source files themselves are read-only and must be edited in the repository.",
        "For update, provide either field plus value, or record containing a shallow patch. For create, provide target.type, target.projectId when known, and record.",
        "For link/unlink, target must be an existing requirement and relationship must include the exact toArtifactId plus a relationship type. These operations edit the requirement's durable links collection.",
        "Return JSON only using this schema:",
        '{"intent":"mutate|clarify|read","summary":"short proposed-change summary","clarification":"question when needed","actions":[{"operation":"create|update|delete|link|unlink","target":{"artifactId":"exact existing id or empty for create","type":"artifact type","projectId":"project id","sourceId":"source id","title":"title"},"field":"field name or empty","value":null,"record":null,"relationship":null,"reason":"grounded reason"}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        request: String(userText || ""),
        activeView,
        projectCatalog: (projects || []).slice(0, 20).map((project) => ({
          id: project.id,
          name: project.name || project.title || "",
          type: project.type || project.projectType || "",
        })),
        retrievedRelationships: (relationships || []).slice(0, 40).map((relationship) => ({
          id: relationship.id,
          type: relationship.type,
          fromArtifactId: relationship.fromArtifactId,
          toArtifactId: relationship.toArtifactId,
        })),
        recentConversation: (history || []).slice(-6).map((message) => ({ role: message.role, content: String(message.content || "").slice(0, 1800) })),
        retrievedSources: sources,
      }),
    },
  ];
}
