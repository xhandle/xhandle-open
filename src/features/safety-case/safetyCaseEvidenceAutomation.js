import { belongsToProject } from "./safetyCaseEvidenceSources";

const RULE_VERSION = 1;
const legacyRoles = { "Goal: Safety-informed design": "design", "Goal: Verification and validation": "verification" };

export function evidenceRole(safetyCase, node) {
  return node.metadata?.evidenceRole || (
    safetyCase.nodes.some((item) => item.metadata?.template === "lifecycleSafetyCase") && node.metadata?.layoutRole === "goalColumn"
      ? legacyRoles[node.title] : null
  );
}

export function automaticEvidenceForNode(safetyCase, nodeId) {
  const node = safetyCase.nodes.find((item) => item.id === nodeId);
  if (!node || evidenceRole(safetyCase, node) === "none") return [];
  const excluded = new Set(node?.metadata?.excludedAutomaticEvidenceIds || []);
  const projectId = safetyCase.sourceProjectId ?? safetyCase.projectId;
  if (String(safetyCase.evidenceAutomation?.projectId) !== String(projectId)) return [];
  const byId = new Map((safetyCase.evidenceAutomation?.artifacts || []).filter((item) => belongsToProject(item, projectId)).map((item) => [item.id, item]));
  return (safetyCase.evidenceAutomation?.allocations || [])
    .filter((item) => item.nodeId === nodeId && byId.has(item.artifactId) && !excluded.has(item.artifactId))
    .map((item) => ({ ...byId.get(item.artifactId), ...item, id: item.artifactId }));
}

export function reconcileSafetyCaseEvidence(safetyCase, snapshot, timestamp = new Date().toISOString()) {
  const projectId = safetyCase.sourceProjectId ?? safetyCase.projectId;
  if (!projectId || String(snapshot.projectId) !== String(projectId)) return safetyCase.evidenceAutomation || null;
  const previous = safetyCase.evidenceAutomation?.projectId === String(projectId) ? safetyCase.evidenceAutomation : null;
  if (!snapshot.complete) {
    return { ...previous, projectId: String(projectId), complete: false, errors: snapshot.errors, ruleVersion: RULE_VERSION };
  }
  const current = snapshot.artifacts.filter((item) => belongsToProject(item, projectId));
  // Keep the last observed description/revision when a source disappears.
  const artifacts = new Map((previous?.projectId === String(projectId) ? previous.artifacts || [] : []).map((item) => [item.id, { ...item, available: false }]));
  current.forEach((item) => artifacts.set(item.id, { ...item, available: true }));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const oldAllocations = new Map((previous?.allocations || []).map((item) => [`${item.nodeId}:${item.artifactId}`, item]));
  const allocations = [];
  for (const node of safetyCase.nodes) {
    const role = evidenceRole(safetyCase, node);
    if (role === "none") continue;
    const manualTargets = new Set(node.linkedArtifactIds || []);
    const excluded = new Set(node.metadata?.excludedAutomaticEvidenceIds || []);
    const eligible = (artifact) => (role === "design" && artifact.type === "requirement")
      || (role === "verification" && artifact.type === "test_case" && Boolean(artifact.requirementId))
      || (node.type === "requirementLink" && artifact.type === "test_case" && Boolean(artifact.requirementId) && (
        manualTargets.has(artifact.requirementId) || manualTargets.has(currentById.get(artifact.requirementId)?.rawId)
      ));
    for (const artifact of artifacts.values()) {
      const old = oldAllocations.get(`${node.id}:${artifact.id}`);
      if (excluded.has(artifact.id) || (!eligible(artifact) && !(old && (role === "verification" || node.type === "requirementLink")) )) continue;
      const live = currentById.get(artifact.id);
      if (!live && !old) continue;
      const acknowledged = node.metadata?.reviewedAutomaticEvidenceRevisions?.[artifact.id] === artifact.revision;
      const changed = !acknowledged && old && (old.revision !== artifact.revision || ["changed", "missing", "untraced"].includes(old.state));
      const state = !live ? "missing" : !eligible(artifact) ? "untraced" : artifact.outcome === "failed" ? "failed" : artifact.outcome === "planned" ? "planned" : changed ? "changed" : "current";
      allocations.push({
        nodeId: node.id, artifactId: artifact.id, revision: artifact.revision, state, origin: "automatic", ruleVersion: RULE_VERSION,
        rationale: artifact.type === "requirement" ? "Project requirement collected for the safety design argument; mitigation adequacy needs review."
          : `Test ${artifact.rawId} explicitly targets project requirement ${artifact.targetId}. ${artifact.outcome === "passed" ? "A passing status and evidence are recorded; applicability needs review." : "This is not passing verification evidence."}`,
      });
    }
  }
  const result = {
    projectId: String(projectId), complete: true, paused: false, errors: [], ruleVersion: RULE_VERSION,
    artifacts: [...artifacts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    allocations, untracedTestCount: current.filter((item) => item.type === "test_case" && !item.requirementId).length,
  };
  // Stable checkpoints: unchanged scans do not write or emit new source events.
  const { lastSyncedAt, ...oldContent } = previous || {};
  return JSON.stringify(oldContent) === JSON.stringify(result) ? previous : { ...result, lastSyncedAt: timestamp };
}
