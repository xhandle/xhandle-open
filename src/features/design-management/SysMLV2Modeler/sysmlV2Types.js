export const SYSML_ELEMENT_TYPES = [
  "Package",
  "PartDefinition",
  "PartUsage",
  "AttributeDefinition",
  "AttributeUsage",
  "PortDefinition",
  "PortUsage",
  "InterfaceDefinition",
  "InterfaceUsage",
  "ConnectionDefinition",
  "ConnectionUsage",
  "RequirementDefinition",
  "RequirementUsage",
  "ActionDefinition",
  "ActionUsage",
  "StateDefinition",
  "StateUsage",
  "ConstraintDefinition",
  "ConstraintUsage",
  "AnalysisCase",
  "VerificationCase",
  "ViewDefinition",
  "ViewUsage",
];

export const SYSML_RELATIONSHIP_TYPES = [
  "contains",
  "specializes",
  "subsets",
  "redefines",
  "references",
  "connects",
  "allocates",
  "satisfies",
  "verifies",
  "derives",
  "refines",
  "traces",
  "exposes",
  "imports",
];

export const SYSML_DIAGRAM_VIEWS = [
  { id: "structure", label: "Structure View" },
  { id: "package", label: "Package / Containment View" },
  { id: "interface", label: "Interface View" },
  { id: "requirements", label: "Requirement Satisfaction View" },
  { id: "behavior", label: "Behavior / Action View" },
  { id: "verification", label: "Verification View" },
  { id: "safety", label: "Safety Traceability View" },
];

export const SYSML_TRACE_TARGET_TYPES = [
  "sysmlElement",
  "sysmlRelationship",
  "designItem",
  "functionalArchitectureRow",
  "hazard",
  "mitigation",
  "requirement",
  "consolidatedRequirement",
  "testCase",
  "verificationArtifact",
];

export const SYSML_TRACE_RELATIONSHIP_TYPES = [
  "tracesTo",
  "derivedFrom",
  "satisfies",
  "verifies",
  "mitigates",
  "allocatedTo",
  "refines",
  "impacts",
];

export function makeSysMLId(prefix = "sysml") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function createEmptySysMLModel({ name = "UntitledSystemModel", description = "" } = {}) {
  const createdAt = nowISO();
  return {
    id: makeSysMLId("model"),
    name,
    description,
    version: 1,
    activeView: "structure",
    rootElementId: null,
    elements: [],
    relationships: [],
    traceLinks: [],
    diagrams: {
      structure: { positions: {} },
      package: { positions: {} },
      interface: { positions: {} },
      requirements: { positions: {} },
      behavior: { positions: {} },
      verification: { positions: {} },
      safety: { positions: {} },
    },
    metadata: {
      notation: "SysML v2-style internal representation",
      conformance: "Supported textual subset, not a full OMG SysML v2 parser/runtime.",
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function createSysMLElement({
  type = "PartDefinition",
  name = "NewElement",
  description = "",
  ownerId = null,
  packageId = null,
  attributes = [],
  ports = [],
  constraints = [],
  metadata = {},
  traceLinks = [],
  diagram = {},
} = {}) {
  const createdAt = nowISO();
  const safeType = SYSML_ELEMENT_TYPES.includes(type) ? type : "PartDefinition";
  return {
    id: makeSysMLId("el"),
    type: safeType,
    name: String(name || safeType).trim() || safeType,
    qualifiedName: "",
    description,
    ownerId,
    packageId,
    attributes: Array.isArray(attributes) ? attributes : [],
    ports: Array.isArray(ports) ? ports : [],
    constraints: Array.isArray(constraints) ? constraints : [],
    metadata,
    traceLinks: Array.isArray(traceLinks) ? traceLinks : [],
    diagram,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createSysMLRelationship({
  type = "traces",
  sourceId,
  targetId,
  label = "",
  description = "",
  metadata = {},
} = {}) {
  const createdAt = nowISO();
  const safeType = SYSML_RELATIONSHIP_TYPES.includes(type) ? type : "traces";
  return {
    id: makeSysMLId("rel"),
    type: safeType,
    sourceId,
    targetId,
    label: label || safeType,
    description,
    metadata,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createSysMLTraceLink({
  sourceType = "sysmlElement",
  sourceId,
  targetType = "requirement",
  targetId,
  relationshipType = "tracesTo",
  label = "",
  rationale = "",
} = {}) {
  const createdAt = nowISO();
  return {
    id: makeSysMLId("trace"),
    sourceType,
    sourceId,
    targetType,
    targetId,
    relationshipType,
    label,
    rationale,
    createdAt,
    updatedAt: createdAt,
  };
}

