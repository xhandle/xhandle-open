import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import { checkSafetyCaseCompleteness as deterministicCompleteness } from "./safetyCaseCompleteness";
import { SAFETY_CASE_CONFIDENCE, SAFETY_CASE_NODE_TYPES, SAFETY_CASE_RELATIONSHIPS, SAFETY_CASE_STATUSES } from "./safetyCaseTypes";

const SYSTEM_PROMPT = "You are a senior systems safety engineer helping maintain a structured safety case. You must not invent evidence. If project artifacts do not support a claim, mark the claim as unsupported or needs-review. Return only valid JSON matching the requested schema.";

function extractJson(text) {
  const raw = typeof text === "string" ? text : JSON.stringify(text);
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  return JSON.parse(body);
}

async function callSafetyCaseModel(userPayload) {
  const response = await fetch(`${backendURL}/api/chat`, {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });
  if (!response.ok) throw new Error(response.status === 401 ? "No AI key is configured for Collaborator." : `Safety Case AI failed: ${response.status}`);
  const data = await response.json();
  return data.answer || data.content || data.message || data.choices?.[0]?.message?.content || "";
}

export function validateSafetyCaseAIUpdate(raw) {
  const parsed = typeof raw === "string" ? extractJson(raw) : raw;
  const nodesToAdd = Array.isArray(parsed.nodesToAdd) ? parsed.nodesToAdd : [];
  const nodesToUpdate = Array.isArray(parsed.nodesToUpdate) ? parsed.nodesToUpdate : [];
  const edgesToAdd = Array.isArray(parsed.edgesToAdd) ? parsed.edgesToAdd : [];
  const clean = {
    summary: String(parsed.summary || "Safety Case AI suggestions are ready."),
    nodesToAdd: nodesToAdd.filter((node) => SAFETY_CASE_NODE_TYPES.includes(node.type)).map((node) => ({
      type: node.type,
      title: String(node.title || "Untitled suggestion"),
      description: String(node.description || ""),
      status: SAFETY_CASE_STATUSES.includes(node.status) ? node.status : "needs-review",
      confidence: SAFETY_CASE_CONFIDENCE.includes(node.confidence) ? node.confidence : "low",
      parentId: node.parentId || null,
      linkedArtifactIds: Array.isArray(node.linkedArtifactIds) ? node.linkedArtifactIds : [],
    })),
    nodesToUpdate: nodesToUpdate.filter((item) => item.id && item.changes && typeof item.changes === "object").map((item) => ({
      id: item.id,
      changes: Object.fromEntries(Object.entries(item.changes).filter(([key, value]) => {
        if (key === "status") return SAFETY_CASE_STATUSES.includes(value);
        if (key === "confidence") return SAFETY_CASE_CONFIDENCE.includes(value);
        return ["title", "description", "linkedArtifactIds"].includes(key);
      })),
    })),
    edgesToAdd: edgesToAdd.filter((edge) => edge.source && edge.target).map((edge) => ({
      source: edge.source,
      target: edge.target,
      relationship: SAFETY_CASE_RELATIONSHIPS.includes(edge.relationship) ? edge.relationship : "supports",
      label: String(edge.label || edge.relationship || "supports"),
    })),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
  return clean;
}

async function askForUpdate(task, payload) {
  const text = await callSafetyCaseModel({
    task,
    schema: {
      summary: "string",
      nodesToAdd: [],
      nodesToUpdate: [],
      edgesToAdd: [],
      warnings: [],
    },
    ...payload,
  });
  return validateSafetyCaseAIUpdate(text);
}

export function identifyUnsupportedClaims(safetyCase) {
  return (safetyCase?.nodes || []).filter((node) => node.type === "claim" && ["unsupported", "needs-review"].includes(node.status));
}

export function identifyMissingAssumptions(safetyCase) {
  return deterministicCompleteness(safetyCase).filter((finding) => /assumption|context|empty/i.test(`${finding.title} ${finding.description}`));
}

export function checkSafetyCaseCompleteness(safetyCase, projectContext) {
  return Promise.resolve({
    summary: "Completeness check completed.",
    findings: deterministicCompleteness(safetyCase, projectContext),
  });
}

export function generateSafetyCaseFromProject(projectContext) {
  return askForUpdate("Generate an initial top-down safety case from available project context. Create unsupported nodes where evidence is missing.", { projectContext });
}

export function suggestChildClaims(node, safetyCase, projectContext) {
  return askForUpdate("Suggest conservative child claims below the selected node.", { node, safetyCase, projectContext });
}

export function suggestEvidence(node, safetyCase, projectContext) {
  return askForUpdate("Suggest evidence or evidence gaps for the selected node without inventing evidence.", { node, safetyCase, projectContext });
}

export function improveClaimWording(node, safetyCase) {
  return askForUpdate("Improve selected claim wording while preserving meaning and traceability.", { node, safetyCase });
}

export function summarizeSafetyCase(safetyCase) {
  return askForUpdate("Summarize the safety argument and identify weak areas.", { safetyCase });
}
