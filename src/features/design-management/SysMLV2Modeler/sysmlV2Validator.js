export function validateSysMLV2Model(model) {
  const findings = [];
  const elements = model?.elements || [];
  const relationships = model?.relationships || [];
  const traceLinks = model?.traceLinks || [];
  const byId = new Map(elements.map((element) => [element.id, element]));

  const add = (finding) => findings.push({
    id: `finding-${findings.length + 1}`,
    severity: "warning",
    elementIds: [],
    relationshipIds: [],
    suggestedFix: "",
    autoFixAvailable: false,
    ...finding,
  });

  const namespace = new Map();
  elements.forEach((element) => {
    const key = `${element.ownerId || element.packageId || "root"}::${String(element.name || "").toLowerCase()}`;
    const list = namespace.get(key) || [];
    list.push(element);
    namespace.set(key, list);
  });
  namespace.forEach((list) => {
    if (list.length > 1) {
      add({
        severity: "error",
        title: "Duplicate names in namespace",
        message: `${list.length} elements share the name "${list[0].name}" in the same owner/package.`,
        elementIds: list.map((el) => el.id),
        suggestedFix: "Rename duplicate elements or move them to separate packages.",
      });
    }
  });

  relationships.forEach((relationship) => {
    if (!byId.has(relationship.sourceId) || !byId.has(relationship.targetId)) {
      add({
        severity: "error",
        title: "Broken relationship endpoint",
        message: `${relationship.label || relationship.type} references a missing source or target.`,
        relationshipIds: [relationship.id],
        suggestedFix: "Reconnect or delete the broken relationship.",
      });
    }
  });

  elements.forEach((element) => {
    if (!String(element.description || "").trim() && !element.heading) {
      add({
        severity: "info",
        title: "Missing description",
        message: `${element.name} has no description.`,
        elementIds: [element.id],
        suggestedFix: "Add a short intent, responsibility, or requirement text.",
      });
    }
    if (element.type === "PartUsage" && !element.metadata?.definitionName && !relationships.some((rel) => rel.type === "specializes" && rel.sourceId === element.id)) {
      add({
        title: "Part usage without definition",
        message: `${element.name} is a part usage with no linked definition.`,
        elementIds: [element.id],
        suggestedFix: "Set metadata.definitionName or add a specializes relationship to a PartDefinition.",
      });
    }
    if (/Requirement/.test(element.type) && !String(element.description || element.metadata?.text || "").trim()) {
      add({
        severity: "error",
        title: "Requirement missing text",
        message: `${element.name} needs requirement text or description.`,
        elementIds: [element.id],
        suggestedFix: "Add a shall statement or requirement rationale.",
      });
    }
    if (/Requirement/.test(element.type) && !relationships.some((rel) => rel.type === "satisfies" && rel.targetId === element.id)) {
      add({
        title: "Requirement is not satisfied",
        message: `${element.name} is not satisfied by any model element.`,
        elementIds: [element.id],
        suggestedFix: "Add a satisfies relationship from a part, action, or state.",
      });
    }
    if (/Requirement/.test(element.type) && !relationships.some((rel) => rel.type === "verifies" && rel.targetId === element.id)) {
      add({
        title: "Requirement is not verified",
        message: `${element.name} has no VerificationCase verifying it.`,
        elementIds: [element.id],
        suggestedFix: "Create a VerificationCase and verifies relationship.",
        autoFixAvailable: true,
      });
    }
    if ((element.ports || []).length && !relationships.some((rel) => rel.type === "connects" && (rel.sourceId === element.id || rel.targetId === element.id))) {
      add({
        title: "Ports are not connected",
        message: `${element.name} has ports but no connection relationship.`,
        elementIds: [element.id],
        suggestedFix: "Add a connects relationship to an interacting part or interface.",
      });
    }
    if (/Interface/.test(element.type) && !relationships.some((rel) => rel.type === "connects" && (rel.sourceId === element.id || rel.targetId === element.id))) {
      add({
        title: "Interface is not used",
        message: `${element.name} is not used by any connection.`,
        elementIds: [element.id],
        suggestedFix: "Connect this interface to source and target model elements.",
      });
    }
    if (/Action/.test(element.type) && !(element.metadata?.inputs?.length || element.metadata?.outputs?.length)) {
      add({
        title: "Action missing inputs/outputs",
        message: `${element.name} has no input or output metadata.`,
        elementIds: [element.id],
        suggestedFix: "Add input/output metadata or allocate it to functional architecture rows.",
      });
    }
    if (element.metadata?.safetyCritical && !traceLinks.some((link) => link.sourceId === element.id && ["hazard", "mitigation"].includes(link.targetType))) {
      add({
        severity: "error",
        title: "Safety-critical element lacks hazard trace",
        message: `${element.name} is marked safety-critical but has no hazard or mitigation trace link.`,
        elementIds: [element.id],
        suggestedFix: "Link this element to related hazards or mitigations.",
      });
    }
    if (/VerificationCase/.test(element.type) && !relationships.some((rel) => rel.type === "verifies" && rel.sourceId === element.id)) {
      add({
        title: "Verification case is not linked",
        message: `${element.name} does not verify any requirement.`,
        elementIds: [element.id],
        suggestedFix: "Add a verifies relationship to a RequirementDefinition or RequirementUsage.",
      });
    }
    if (element.id !== model.rootElementId && !element.ownerId && !element.packageId && !relationships.some((rel) => rel.type === "contains" && rel.targetId === element.id)) {
      add({
        title: "Orphan element",
        message: `${element.name} is not contained by a package/model root.`,
        elementIds: [element.id],
        suggestedFix: "Set owner/package or add a contains relationship.",
        autoFixAvailable: true,
      });
    }
  });

  traceLinks.forEach((link) => {
    if (link.sourceType?.startsWith("sysml") && !byId.has(link.sourceId)) {
      add({
        severity: "error",
        title: "Broken SysML trace link",
        message: `Trace link ${link.label || link.id} references a missing SysML source.`,
        suggestedFix: "Reconnect or delete the trace link.",
      });
    }
  });

  return findings;
}

