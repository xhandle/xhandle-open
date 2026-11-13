import sha from "sha.js";
import { openTraceabilityDB, createTraceabilityTransaction, TRACEABILITY_STORES } from "../../components/utils/traceabilityDb";

export const VERIFICATION_DOCUMENTS_KEY = "xhandle:vnv-test-case-documents";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function evidenceRevision(value) {
  return sha("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function belongsToProject(record, projectId) {
  const ids = [record?.projectId, record?.sourceProjectId, record?.ProjectId].filter((id) => id != null && id !== "");
  return Boolean(projectId && ids.length && ids.every((id) => String(id) === String(projectId)));
}

function readArray(key) {
  const value = JSON.parse(localStorage.getItem(key) || "[]");
  if (!Array.isArray(value)) throw new Error(`${key} is not a record collection.`);
  return value;
}

export function requirementEvidence(row, source = "TraceabilityDB:Requirements") {
  return {
    id: `${source}:${row.id}`, rawId: String(row.id), projectId: String(row.projectId),
    title: row.title || row.Requirement || String(row.id),
    summary: row.description || row.attributes?.Description || "",
    category: "Requirements", type: "requirement", sourceLabel: "Project requirements",
    description: `Requirement ${row.id}`, revision: evidenceRevision(row), outcome: "requirement",
    source, status: row.status || "", version: row.version ?? null,
  };
}

export function verificationEvidence(test, document, requirement) {
  const status = String(test.status || "Draft").toLowerCase();
  const recordedEvidence = typeof test.evidence === "string" ? test.evidence.trim() : "";
  const outcome = ["fail", "failed", "blocked"].includes(status) ? "failed"
    : ["pass", "passed"].includes(status) && recordedEvidence ? "passed" : "planned";
  const source = `localStorage:${VERIFICATION_DOCUMENTS_KEY}`;
  return {
    id: `${source}:${encodeURIComponent(document.id)}:${encodeURIComponent(test.id)}`,
    rawId: String(test.id), projectId: String(document.sourceProjectId ?? document.projectId),
    title: test.title || String(test.id), summary: test.objective || "",
    description: `${document.name || document.id} / ${test.id}`,
    source, sourceLabel: "Project test case document", category: "Verification & Validation", type: "test_case",
    requirementId: requirement?.id || null, targetId: String(test.requirementId || ""),
    revision: evidenceRevision({ test, requirementRevision: requirement?.revision || null }),
    outcome, status: test.status || "Draft", recordedEvidence,
  };
}

// Explicit source adapters intentionally avoid the capped, heuristic evidence picker
// and graph relevance search. A failed source makes the snapshot incomplete; it
// must never be interpreted as evidence deletion.
export async function collectSafetyCaseEvidence(projectId) {
  if (!projectId) return { projectId: null, artifacts: [], complete: false, errors: ["Choose a source project."] };
  const errors = [];
  const requirements = new Map();
  try {
    const db = await openTraceabilityDB();
    const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirements, "readonly");
    if (!tx) throw new Error("Requirements store unavailable.");
    const rows = await tx.store.index("by_project").getAll(projectId);
    await tx.done;
    rows.filter((row) => row?.id && belongsToProject(row, projectId)).forEach((row) => {
      requirements.set(String(row.id), requirementEvidence(row));
    });
  } catch (error) { errors.push(`Requirements: ${error.message}`); }
  const artifacts = [...requirements.values()];
  try {
    const documents = readArray(VERIFICATION_DOCUMENTS_KEY);
    const identities = new Set();
    for (const document of documents) {
      if (!belongsToProject(document, projectId)) continue;
      if (!document.id || !Array.isArray(document.testCases)) throw new Error("A test document is missing its ID or test collection.");
      for (const test of document.testCases) {
        if (!test?.id) throw new Error("A test is missing its stable ID.");
        const explicitOwner = test.sourceProjectId ?? test.projectId ?? test.ProjectId;
        if (explicitOwner != null && !belongsToProject(test, projectId)) continue;
        const targetIsRequirement = !test.targetType || /^(requirement|system requirement|software requirement|subsystem requirement)$/i.test(test.targetType);
        const requirement = targetIsRequirement ? requirements.get(String(test.requirementId)) : null;
        const artifact = verificationEvidence(test, document, requirement);
        if (identities.has(artifact.id)) throw new Error(`Duplicate test identity: ${test.id}`);
        identities.add(artifact.id);
        artifacts.push(artifact);
      }
    }
  } catch (error) { errors.push(`Verification documents: ${error.message}`); }
  return { projectId: String(projectId), artifacts: artifacts.sort((a, b) => a.id.localeCompare(b.id)), complete: errors.length === 0, errors };
}
