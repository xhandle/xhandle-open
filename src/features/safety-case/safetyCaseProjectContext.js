function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function redactRows(rows, limit = 80) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit).map((row, index) => ({
    id: row?.id || row?.ID || row?.key || `artifact-${index}`,
    title: row?.title || row?.Title || row?.name || row?.Name || row?.Requirement || row?.Hazard || row?.Function || `Artifact ${index + 1}`,
    type: row?.type || row?.Type || row?._source || "artifact",
    summary: row?.description || row?.Description || row?.summary || row?.Rationale || row?.Mitigation || "",
    source: row?._source || row?.source || "",
    projectId: row?.projectId || row?.ProjectId || row?.project || row?.Project || "",
    projectName: row?.projectName || row?.ProjectName || "",
    folderId: row?.folderId || row?.FolderId || "",
    folderName: row?.folderName || row?.FolderName || "",
    moduleId: row?.moduleId || row?.ModuleId || "",
    module: row?.module || row?.moduleName || row?.Module || row?.ModuleName || "",
    diagramId: row?.diagramId || row?.DiagramId || "",
    diagramName: row?.diagramName || row?.diagramTitle || row?.DiagramName || row?.DiagramTitle || "",
    parentId: row?.parentId || row?.ParentId || "",
  }));
}

function filterByProject(rows, projectId) {
  if (!projectId || !Array.isArray(rows)) return rows || [];
  const scoped = rows.filter((row) => row?.projectId == null || String(row.projectId) === String(projectId));
  return scoped.length ? scoped : rows;
}

export function loadXHandleProjects() {
  if (typeof localStorage === "undefined") return [];
  const projects = safeParse(localStorage.getItem("xhandle.projects"), []);
  return Array.isArray(projects) ? projects : [];
}

export function buildSafetyCaseProjectContext(sourceProjectId) {
  if (typeof localStorage === "undefined") return {};
  const projects = loadXHandleProjects();
  const activeProjectId = localStorage.getItem("xhandle.activeProjectId") || null;
  const selectedProjectId = sourceProjectId ?? activeProjectId;
  const project = (projects || []).find((item) => String(item.id) === String(selectedProjectId)) || null;
  const cbaRows = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith("cba:")) {
      const rows = safeParse(localStorage.getItem(key), []);
      if (Array.isArray(rows)) cbaRows.push(...rows.map((row) => ({ ...row, _source: key })));
    }
  }
  return {
    project: project ? { id: project.id, name: project.name } : { id: selectedProjectId, name: "Selected Project" },
    hazards: redactRows(filterByProject(safeParse(localStorage.getItem("xhandle:risk-register"), []), selectedProjectId), 80),
    riskSummary: redactRows(filterByProject(safeParse(localStorage.getItem("xhandle:risk-summary"), []), selectedProjectId), 80),
    requirements: redactRows(filterByProject(safeParse(localStorage.getItem("xhandle:requirements"), []), selectedProjectId), 120),
    verification: redactRows(filterByProject(safeParse(localStorage.getItem("xhandle:vnv-center"), []), selectedProjectId), 80),
    codeArchitecture: redactRows(cbaRows, 120),
  };
}

export function generateDeterministicSafetyCase(projectContext = {}) {
  const hasHazards = (projectContext.hazards || []).length > 0 || (projectContext.riskSummary || []).length > 0;
  const hasRequirements = (projectContext.requirements || []).length > 0;
  const hasArchitecture = (projectContext.codeArchitecture || []).length > 0;
  const hasVerification = (projectContext.verification || []).length > 0;
  return [
    {
      type: "context",
      title: "Operational context is defined and bounded",
      description: "The operating environment, intended use, assumptions, and system boundary should be reviewed against project artifacts.",
      status: "needs-review",
      confidence: "medium",
    },
    {
      type: "claim",
      title: "Key hazards have been identified and analyzed",
      description: hasHazards ? "Hazard and risk artifacts are available and should be linked to this claim." : "No hazard artifacts were found. Add hazard analysis evidence before accepting this claim.",
      status: hasHazards ? "needs-review" : "unsupported",
      confidence: hasHazards ? "medium" : "low",
      linkedArtifactIds: (projectContext.hazards || []).slice(0, 12).map((item) => item.id),
    },
    {
      type: "claim",
      title: "Safety requirements mitigate identified hazards",
      description: hasRequirements ? "Requirements artifacts are available and should be traced to hazards and mitigations." : "No requirement artifacts were found. Add safety requirements or mark this claim unsupported.",
      status: hasRequirements ? "needs-review" : "unsupported",
      confidence: hasRequirements ? "medium" : "low",
      linkedArtifactIds: (projectContext.requirements || []).slice(0, 12).map((item) => item.id),
    },
    {
      type: "claim",
      title: "Architecture implements required safety controls",
      description: hasArchitecture ? "Code-based architecture artifacts are available for review and traceability." : "No architecture artifacts were found. Link architecture evidence when available.",
      status: hasArchitecture ? "needs-review" : "unsupported",
      confidence: hasArchitecture ? "medium" : "low",
      linkedArtifactIds: (projectContext.codeArchitecture || []).slice(0, 12).map((item) => item.id),
    },
    {
      type: "claim",
      title: "Verification evidence supports safety requirements",
      description: hasVerification ? "Verification artifacts are available and should be linked to safety requirements." : "No verification evidence was found. Keep this claim unsupported until evidence exists.",
      status: hasVerification ? "needs-review" : "unsupported",
      confidence: hasVerification ? "medium" : "low",
      linkedArtifactIds: (projectContext.verification || []).slice(0, 12).map((item) => item.id),
    },
    {
      type: "claim",
      title: "Residual risk is understood and acceptable",
      description: "Residual risk acceptance should be based on reviewed hazard, mitigation, verification, and stakeholder acceptance evidence.",
      status: "needs-review",
      confidence: "low",
    },
  ];
}

export function generateLifecycleSafetyCase(projectContext = {}, rootId) {
  const hazards = projectContext.hazards || [];
  const riskSummary = projectContext.riskSummary || [];
  const requirements = projectContext.requirements || [];
  const verification = projectContext.verification || [];
  const architecture = projectContext.codeArchitecture || [];
  const hasHazards = hazards.length > 0 || riskSummary.length > 0;
  const hasRequirements = requirements.length > 0;
  const hasArchitecture = architecture.length > 0;
  const hasVerification = verification.length > 0;

  const node = (key, values) => ({ key, ...values });
  const nodes = [
    node("context", {
      type: "context",
      parentId: rootId,
      relationship: "contextualizes",
      title: "Context",
      description: "Operational design domain, system configuration, and risk acceptance criteria define the safety argument boundary.",
      status: "needs-review",
      confidence: "medium",
      metadata: {
        layoutRole: "contextBox",
        displayItems: ["ODD definition", "Vehicle configuration", "Risk acceptance criteria"],
      },
    }),
    node("assumptions", {
      type: "assumption",
      parentId: rootId,
      relationship: "assumes",
      title: "Assumptions",
      description: "Operational and lifecycle assumptions that must remain valid for the safety argument to hold.",
      status: "needs-review",
      confidence: "medium",
      metadata: {
        layoutRole: "assumptionBox",
        displayItems: ["Operating constraints enforced", "Maintenance procedures followed", "Software update governance maintained"],
      },
    }),
    node("strategy", {
      type: "strategy",
      parentId: rootId,
      relationship: "decomposes",
      title: "Safety argument: controlled safety process and lifecycle evidence",
      description: "The top claim is supported by process governance, hazard analysis, risk assessment, safety-informed design, verification, and continuous monitoring.",
      status: "needs-review",
      confidence: "medium",
      metadata: {
        layoutRole: "strategyBar",
        justification: "The argument is decomposed across process control, hazard analysis, risk evaluation, design mitigation, verification, and monitoring.",
      },
    }),
    node("process", {
      type: "claim",
      parentId: null,
      parentKey: "strategy",
      relationship: "supports",
      title: "Goal: Process and governance",
      description: "Safety planning and governance artifacts establish process control for the system lifecycle.",
      status: "needs-review",
      confidence: "medium",
      metadata: {
        layoutRole: "goalColumn",
        justification: "Safety governance evidence establishes that safety activities are planned, reviewed, and controlled.",
      },
    }),
    node("hazard", {
      type: "claim",
      parentId: null,
      parentKey: "strategy",
      relationship: "supports",
      title: "Goal: Hazard analysis",
      description: hasHazards ? "Project hazard artifacts are available and should be reviewed for complete coverage." : "No hazard artifacts were found. Add hazard analysis evidence before accepting this goal.",
      status: hasHazards ? "needs-review" : "unsupported",
      confidence: hasHazards ? "medium" : "low",
      metadata: {
        layoutRole: "goalColumn",
        justification: "Hazard analysis methods should provide coverage of functional, system, and operational hazards for the architecture.",
      },
    }),
    node("risk", {
      type: "claim",
      parentId: null,
      parentKey: "strategy",
      relationship: "supports",
      title: "Goal: Risk assessment",
      description: riskSummary.length ? "Risk assessment artifacts are available and should be aligned to acceptance criteria." : "No risk assessment artifacts were found. Add risk assessment evidence before accepting this goal.",
      status: riskSummary.length ? "needs-review" : "unsupported",
      confidence: riskSummary.length ? "medium" : "low",
      metadata: {
        layoutRole: "goalColumn",
        justification: "Severity and probability classifications should align with the project risk acceptance criteria.",
      },
    }),
    node("design", {
      type: "claim",
      parentId: null,
      parentKey: "strategy",
      relationship: "supports",
      title: "Goal: Safety-informed design",
      description: hasRequirements || hasArchitecture ? "Requirements and architecture artifacts are available for safety design traceability." : "No design evidence was found. Link safety requirements and architecture evidence when available.",
      status: hasRequirements || hasArchitecture ? "needs-review" : "unsupported",
      confidence: hasRequirements || hasArchitecture ? "medium" : "low",
      metadata: {
        layoutRole: "goalColumn",
        justification: "Safety requirements and architecture traces show that design decisions implement the intended mitigations.",
      },
    }),
    node("verification", {
      type: "claim",
      parentId: null,
      parentKey: "strategy",
      relationship: "supports",
      title: "Goal: Verification and validation",
      description: hasVerification ? "Verification artifacts are available and should be traced to safety requirements." : "No verification evidence was found. Keep this goal unsupported until evidence exists.",
      status: hasVerification ? "needs-review" : "unsupported",
      confidence: hasVerification ? "medium" : "low",
      metadata: {
        layoutRole: "goalColumn",
        justification: "Verification and validation evidence should demonstrate the implemented mitigations satisfy safety requirements.",
      },
    }),
  ];

  return {
    nodes,
    crossLinks: [],
  };
}
