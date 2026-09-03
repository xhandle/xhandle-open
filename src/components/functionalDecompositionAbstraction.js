export const DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL = "multi-level";

export const FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS = [
  {
    value: "system",
    label: "System level",
    description: "Major subsystems and external systems",
  },
  {
    value: "subsystem",
    label: "Subsystem level",
    description: "Internal capabilities and subsystem interfaces",
  },
  {
    value: "detailed-functional",
    label: "Detailed functional level",
    description: "Implementable leaf functions and interfaces",
  },
  {
    value: "multi-level",
    label: "Multi-level",
    description: "System context followed by detailed functional decomposition",
    recommended: true,
  },
];

export function normalizeFunctionalAbstractionLevel(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (["system", "system-level", "system level"].includes(normalized)) return "system";
  if (["subsystem", "subsystem-level", "subsystem level"].includes(normalized)) return "subsystem";
  if (["detailed", "detail", "detailed-functional", "detailed functional", "detailed functional level"].includes(normalized)) {
    return "detailed-functional";
  }
  if (["multi", "multilevel", "multi-level", "multi level"].includes(normalized)) return "multi-level";
  return DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL;
}

export function getFunctionalAbstractionLevelOption(value) {
  const normalized = normalizeFunctionalAbstractionLevel(value);
  return FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS.find((option) => option.value === normalized)
    || FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS.find((option) => option.value === DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL);
}

export function getFunctionalAbstractionPromptGuidance(value) {
  const normalized = normalizeFunctionalAbstractionLevel(value);
  const guidance = {
    system: [
      "SYSTEM-LEVEL DEPTH: describe the system through major subsystem capabilities and genuine external systems or actors.",
      "Use broad capability functions owned by the major subsystems; do not descend into implementable algorithms, device handlers, or leaf control loops.",
      "Represent the principal system-boundary inputs/outputs and the major cross-subsystem mission and feedback flows.",
      "A substantial system normally needs about 8-16 unique interface rows, adjusted to the evidence and complexity.",
    ],
    subsystem: [
      "SUBSYSTEM-LEVEL DEPTH: decompose each major subsystem into its internal capabilities and show meaningful interfaces within and across subsystem boundaries.",
      "Use capability-level functions rather than overall subsystem labels or implementable leaf algorithms.",
      "Include the primary mission flow plus warranted feedback, mode, health, fault, resource, operator, and external interfaces.",
      "A substantial system normally needs about 14-28 unique interface rows, adjusted to the evidence and complexity.",
    ],
    "detailed-functional": [
      "DETAILED FUNCTIONAL DEPTH: produce implementable leaf functions and the concrete interfaces between them.",
      "Use precise verb-noun functions with bounded responsibilities, explicit inputs/outputs, owned state, timing, constraints, and receiver effects.",
      "Keep each leaf allocated to one subsystem and include the operational feedback, monitoring, degraded-mode, and safety paths necessary to implement the behavior.",
      "A substantial system normally needs about 20-40 unique interface rows, adjusted to the evidence and complexity.",
    ],
    "multi-level": [
      "MULTI-LEVEL DEPTH: first infer the system context, external actors/systems, major subsystem hierarchy, and capability allocation; then produce the detailed functional decomposition.",
      "Because the output table is flat, place only concrete leaf functions at Function From and Function To. Use Subsystem to identify each source leaf's immediate owning subsystem.",
      "Do not mix hierarchy containers, subsystem labels, payload names, and leaf functions as peer endpoints. Represent genuine external actors/systems only on boundary rows.",
      "Cover the end-to-end mission thread and the cross-subsystem feedback, mode, health, fault, resource, operator, degraded-operation, recovery, and safety paths warranted by the evidence.",
      "A substantial multi-subsystem system normally needs about 24-45 unique leaf-interface rows, adjusted to the evidence and complexity.",
    ],
  };
  return guidance[normalized].join(" ");
}
