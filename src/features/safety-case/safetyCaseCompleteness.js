import { automaticEvidenceForNode } from "./safetyCaseEvidenceAutomation";

const SUPPORT_RELATIONSHIPS = new Set(["supports", "decomposes", "evidences"]);
const SUPPORT_TYPES = new Set(["claim", "strategy", "evidence", "verificationLink", "requirementLink", "hazardLink", "architectureLink"]);

export function checkSafetyCaseCompleteness(safetyCase, { evidenceById } = {}) {
  const nodes = safetyCase?.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map(nodes.map((node) => [node.id, new Set()]));
  const support = new Map(nodes.map((node) => [node.id, new Set()]));
  const incoming = new Set();
  const explicitPairs = new Set();
  const addChild = (parent, child, relationship) => {
    if (!byId.has(parent) || !byId.has(child)) return;
    children.get(parent).add(child);
    incoming.add(child);
    if (SUPPORT_RELATIONSHIPS.has(relationship) && SUPPORT_TYPES.has(byId.get(child).type)) support.get(parent).add(child);
  };
  (safetyCase?.edges || []).forEach((edge) => {
    explicitPairs.add(JSON.stringify([edge.source, edge.target]));
    addChild(edge.source, edge.target, edge.relationship || "supports");
  });
  nodes.forEach((node) => {
    if (node.parentId && !explicitPairs.has(JSON.stringify([node.parentId, node.id]))) addChild(node.parentId, node.id, "supports");
  });
  const findings = [];
  const add = (severity, nodeId, title, description) => findings.push({ id: `finding-${findings.length}`, severity, nodeId, title, description });
  if (!nodes.length) add("high", null, "Safety case is empty", "Add a safety argument and concrete evidence.");
  nodes.forEach((node) => {
    const childIds = children.get(node.id);
    const supportIds = support.get(node.id);
    if (node.type === "claim" && !supportIds.size && !(node.linkedArtifactIds || []).length
      && !automaticEvidenceForNode(safetyCase, node.id).some((item) => item.state === "current")) {
      add("high", node.id, "Claim has no support", "Claims need supporting argument or concrete evidence; context alone is insufficient.");
    }
    const ids = node.linkedArtifactIds || [];
    if (["evidence", "verificationLink"].includes(node.type) && !ids.length) add("medium", node.id, "Evidence is not linked", "Link a concrete artifact.");
    if (ids.length) {
      if (!evidenceById) add("medium", node.id, "Evidence requires validation", "Linked artifacts have not been resolved against their source.");
      else ids.forEach((id) => {
        const artifact = evidenceById.get(id);
        if (!artifact) add("high", node.id, "Linked evidence is missing", `Artifact ${id} could not be resolved.`);
        else {
          const isVerification = artifact.type === "test_case" || artifact.category === "Verification & Validation";
          const raw = artifact.raw || artifact;
          const passing = ["pass", "passed"].includes(String(raw.status || "").toLowerCase()) && Boolean(String(raw.evidence || "").trim());
          if (["failed", "planned"].includes(artifact.outcome) || (isVerification && !artifact.outcome && !passing)) add("high", node.id, "Verification is not passing evidence", `${artifact.title}: a recorded passing result with evidence is required.`);
        }
      });
    }
    if (node.type === "assumption" && ![...childIds].some((id) => byId.get(id)?.type === "justification")) add("medium", node.id, "Assumption lacks justification", "Assumptions should be justified or bounded.");
    if (!String(node.title || "").trim()) add("medium", node.id, "Node title is empty", "Every node needs a reviewable title.");
    if (!String(node.description || "").trim()) add("low", node.id, "Node description is empty", "Describe the safety rationale.");
    if (node.type === "requirementLink" && ![...supportIds].some((id) => ["verificationLink", "evidence"].includes(byId.get(id)?.type))
      && !automaticEvidenceForNode(safetyCase, node.id).some((item) => item.state === "current")) add("medium", node.id, "Requirement lacks verification support", "Connect requirements to current passing verification evidence.");
    if (node.type === "hazardLink" && ![...supportIds].some((id) => ["requirementLink", "claim", "evidence"].includes(byId.get(id)?.type))) add("high", node.id, "Hazard lacks mitigation support", "Connect hazards to controls, requirements, or evidence.");
    if (!incoming.has(node.id) && nodes[0]?.id !== node.id) add("medium", node.id, "Orphan node", "This node is disconnected from the top-level argument.");
  });

  // Iterative colour traversal handles imported cycles and very deep graphs.
  const colour = new Map();
  for (const node of nodes) {
    if (colour.has(node.id)) continue;
    const stack = [{ id: node.id, exit: false }];
    while (stack.length) {
      const frame = stack.pop();
      if (frame.exit) { colour.set(frame.id, 2); continue; }
      if (colour.get(frame.id) === 1) { add("high", frame.id, "Cycle detected", "The argument contains a cycle. Remove cyclic relationships before review."); continue; }
      if (colour.get(frame.id) === 2) continue;
      colour.set(frame.id, 1);
      stack.push({ id: frame.id, exit: true });
      [...children.get(frame.id)].reverse().forEach((id) => stack.push({ id, exit: false }));
    }
  }
  if (nodes.some((node) => !["supported", "accepted"].includes(node.status))) add("high", nodes[0]?.id, "Argument requires review", "Draft, unsupported, or needs-review nodes remain in the argument.");
  const automation = safetyCase?.evidenceAutomation;
  if (automation) {
    if (!automation.complete) add("high", nodes[0]?.id, "Evidence collection is incomplete", (automation.errors || []).join(" ") || "Collection has not completed.");
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    (automation.allocations || []).forEach((item) => {
      const node = nodeById.get(item.nodeId);
      if (!node || node.metadata?.excludedAutomaticEvidenceIds?.includes(item.artifactId)) return;
      if (item.state !== "current") add("high", item.nodeId, `Automatic evidence is ${item.state}`, "Review source changes, missing artifacts, and verification outcomes before relying on this evidence.");
    });
    if (automation.untracedTestCount) add("medium", nodes[0]?.id, "Tests have unresolved requirement targets", `${automation.untracedTestCount} tests could not be traced to a collected project requirement.`);
  }
  return findings;
}

export function safetyCaseOverallStatus(safetyCase, options) {
  // Human-entered statuses alone do not establish that evidence was resolved.
  return checkSafetyCaseCompleteness(safetyCase, options).some((item) => item.severity !== "low") ? "Needs Review" : "Supported";
}
