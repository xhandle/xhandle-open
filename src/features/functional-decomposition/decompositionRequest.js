/**
 * Building the request that produces a functional decomposition.
 *
 * Extracted from XHandleCopilotView so it can be tested: that file imports
 * `react-markdown`, which is ESM and untransformed, so nothing it exports can be
 * imported by a test at all.
 */

export const FUNCTIONAL_DECOMPOSITION_DIRECTIVE = "Generate the complete reviewable seven-column functional decomposition now. Do not ask which project should receive it and do not ask another setup question. The draft does not modify a project.";

export function functionalDecompositionRequestInstruction(selectedLevel, extraInstruction = "") {
  return [
    `Abstraction level selected by the user: ${selectedLevel}.`,
    functionalAbstractionInstruction(selectedLevel),
    extraInstruction ? `\n${extraInstruction}` : "",
    FUNCTIONAL_DECOMPOSITION_DIRECTIVE,
  ].filter(Boolean).join("\n");
}

export function functionalAbstractionInstruction(level) {
  const instructions = {
    system: [
      "Use SYSTEM-LEVEL abstraction.",
      "Treat the system named in the user's request as the enclosing system-of-interest boundary. Do not list that enclosing system itself as a Subsystem, Function From, or Function To.",
      "Decompose that boundary into major internally owned peer subsystems plus relevant external actors, external systems, and physical resources.",
      "For an internally sourced row, the Subsystem cell must name the major internal subsystem that owns Function From; do not populate it with the enclosing system name. For an externally sourced row, use the explicitly named external owner.",
      "Function From and Function To must be major subsystem-level behavioral elements or explicitly named external entities—not internal capabilities, algorithms, implementation modules, payloads, or leaf functions.",
      "Use stable major subsystem concepts that partition the requested system's responsibilities. Do not promote processing steps such as filtering, detection, assessment, command generation, or monitoring into peer subsystems unless the user's domain and context establish them as independently owned major elements.",
      "Describe mission-scale exchanges, commands, information, energy/material flows, and system-boundary interactions.",
      "Aim for a concise context architecture (typically 4–10 meaningful interface rows); this range is guidance, not a rejection criterion.",
    ].join("\n"),
    subsystem: [
      "Use SUBSYSTEM-LEVEL abstraction.",
      "Decompose the requested system or selected subsystem into cohesive internally owned capabilities and show the interfaces among them and across the subsystem boundary.",
      "Endpoints should be capabilities such as sensing, estimation, planning, coordination, monitoring, or actuation management—not broad peer systems and not low-level implementation steps.",
      "Show each capability's distinct responsibility, the information/control it exchanges, and important operational return paths when useful.",
      "Aim for roughly 6–16 meaningful interface rows; this range is guidance, not a rejection criterion.",
    ].join("\n"),
    "detailed-functional": [
      "Use DETAILED FUNCTIONAL abstraction.",
      "Decompose the requested scope into implementable leaf functions with specific transformations, decisions, state handling, validation, monitoring, configuration, and recovery behavior where relevant.",
      "Endpoints must be concrete behaviors that an engineering team could allocate, implement, and test; avoid umbrella labels that still require major decomposition.",
      "State precise input/output or command/status interfaces and receiver effects. Include operational support functions only when they serve the requested mission.",
      "Aim for roughly 10–30 meaningful interface rows; this range is guidance, not a rejection criterion.",
    ].join("\n"),
    "multi-level": [
      "Use MULTI-LEVEL abstraction and make the hierarchy visible in the response.",
      "First provide a short System Context section naming the requested system boundary, major internally owned system elements, and relevant external systems or actors.",
      "Then provide a Decomposition Hierarchy that maps each major system element to its internally owned capabilities and implementable leaf functions.",
      "Finally provide the seven-column functional-decomposition table. Its internal endpoints should primarily be implementable leaf functions; use the Subsystem column to show the owning major system element, and include external endpoints where the architecture crosses its boundary.",
      "Trace at least one coherent mission path from an external stimulus or goal through internal sensing/interpretation, decision/planning, and output/execution behavior. Add status, quality, constraint, configuration, or recovery paths when they are meaningful—not merely to create symmetry.",
      "Before answering, compare every named implementable leaf function in the hierarchy against Function From and Function To in the table. Give every leaf at least one meaningful interface and add any omitted leaf before presenting the result.",
      "Derive every Interface Direction Audit count from the rows actually present in the final table; do not estimate or manually carry over counts from a draft.",
      "Prefer useful breadth and depth (often 3+ major elements, 8+ leaf functions, and 12–30 interface rows), but treat these as quality targets rather than hard acceptance criteria.",
    ].join("\n"),
  };
  return instructions[level] || "";
}

export function inferFunctionalAbstractionLevel(promptText = "") {
  const query = String(promptText || "").toLowerCase();
  const canonicalValue = query.trim();
  if (["system", "subsystem", "detailed-functional", "multi-level"].includes(canonicalValue)) return canonicalValue;
  if (/\b(multi[- ]?level|multiple levels|hierarchical|all levels|level\s*4)\b/.test(query) || /^\s*4\s*$/.test(query)) return "multi-level";
  if (/\b(detailed functional(?:[- ]level)?|detailed[- ]level|implementation[- ]level|implementable|leaf(?:[- ]function)?[- ]level|low[- ]level|level\s*3)\b/.test(query) || /^\s*3\s*$/.test(query)) return "detailed-functional";
  if (/\b(subsystem[- ]level|internal capabilities|level\s*2)\b/.test(query) || /^\s*2\s*$/.test(query)) return "subsystem";
  if (/\b(system[- ]level|top[- ]level|major subsystems|context[- ]level|level\s*1)\b/.test(query) || /^\s*1\s*$/.test(query)) return "system";
  return "";
}
