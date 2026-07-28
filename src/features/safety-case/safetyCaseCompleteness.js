export function checkSafetyCaseCompleteness(safetyCase) {
  const nodes = safetyCase?.nodes || [];
  const edges = safetyCase?.edges || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  edges.forEach((edge) => {
    if (!childrenByParent.has(edge.source)) childrenByParent.set(edge.source, []);
    childrenByParent.get(edge.source).push(edge.target);
  });
  nodes.forEach((node) => {
    if (node.parentId && !childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
    if (node.parentId) childrenByParent.get(node.parentId).push(node.id);
  });

  const findings = [];
  const add = (severity, nodeId, title, description) => findings.push({ id: `${severity}-${nodeId || findings.length}-${findings.length}`, severity, nodeId, title, description });

  nodes.forEach((node) => {
    const childIds = new Set([...(childrenByParent.get(node.id) || [])]);
    const hasEvidence = [...childIds].some((id) => byId.get(id)?.type === "evidence" || byId.get(id)?.type === "verificationLink");
    if (node.type === "claim" && childIds.size === 0 && !hasEvidence) add("high", node.id, "Claim has no support", "Claims should be decomposed or supported by evidence.");
    if (node.type === "evidence" && !(node.linkedArtifactIds || []).length) add("medium", node.id, "Evidence is not linked", "Evidence nodes should link to a concrete artifact.");
    if (node.type === "assumption") {
      const hasJustification = [...childIds].some((id) => byId.get(id)?.type === "justification");
      if (!hasJustification) add("medium", node.id, "Assumption lacks justification", "Assumptions should be justified or bounded.");
    }
    if (!String(node.title || "").trim()) add("medium", node.id, "Node title is empty", "Every node needs a reviewable title.");
    if (!String(node.description || "").trim()) add("low", node.id, "Node description is empty", "Descriptions help reviewers understand safety rationale.");
    if (node.type === "requirementLink") {
      const hasVerification = [...childIds].some((id) => byId.get(id)?.type === "verificationLink" || byId.get(id)?.type === "evidence");
      if (!hasVerification) add("medium", node.id, "Requirement lacks verification support", "Requirement links should connect to verification evidence.");
    }
    if (node.type === "hazardLink") {
      const hasMitigation = [...childIds].some((id) => ["requirementLink", "claim", "evidence"].includes(byId.get(id)?.type));
      if (!hasMitigation) add("high", node.id, "Hazard lacks mitigation support", "Hazard links should be supported by controls, requirements, or evidence.");
    }
  });

  const hasParentOrIncoming = new Set(edges.map((edge) => edge.target));
  nodes.forEach((node) => {
    if (!node.parentId && !hasParentOrIncoming.has(node.id) && nodes[0]?.id !== node.id) add("medium", node.id, "Orphan node", "This node is disconnected from the top-level argument.");
  });

  const visiting = new Set();
  const visited = new Set();
  function dfs(id, path = []) {
    if (visiting.has(id)) {
      add("high", id, "Cycle detected", `The support graph contains a cycle: ${[...path, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    (childrenByParent.get(id) || []).forEach((childId) => dfs(childId, [...path, id]));
    visiting.delete(id);
    visited.add(id);
  }
  nodes.forEach((node) => dfs(node.id));

  const unsupportedDescendantIds = new Set(nodes.filter((node) => ["unsupported", "needs-review"].includes(node.status)).map((node) => node.id));
  nodes.filter((node) => !node.parentId || node.id === nodes[0]?.id).forEach((node) => {
    const stack = [...(childrenByParent.get(node.id) || [])];
    let weak = false;
    while (stack.length) {
      const id = stack.pop();
      if (unsupportedDescendantIds.has(id)) weak = true;
      stack.push(...(childrenByParent.get(id) || []));
    }
    if (weak) add("high", node.id, "Top-level claim has weak descendants", "Unsupported or needs-review descendants must be resolved before accepting the top claim.");
  });

  return findings;
}
