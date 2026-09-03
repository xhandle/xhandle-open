export const FUNCTIONAL_DECOMPOSITION_SAMPLING = Object.freeze({
  temperature: 0,
  topP: 0.1,
});

export const FUNCTIONAL_DECOMPOSITION_CORE_INSTRUCTIONS = `
Model the requested scope as an operational closed-loop architecture rather than a one-way happy-path pipeline.

- Start with system scope and ownership. Keep suppliers, consumers, users, physical resources, and neighboring systems outside the requested boundary unless user-authored evidence assigns their behavior to it.
- Derive technically meaningful functions from the requested mission and domain. Include supporting lifecycle concerns only when relevant; do not copy a fixed catalog from an example architecture.
- Treat AI-generated planning content as an unverified hypothesis. It may suggest candidates, but it must not override the system name, user-authored evidence, or a reviewed hierarchy.
- Generate the primary mission flow, then perform a closed-loop interface audit for each connected function pair and system boundary. Consider purposeful acknowledgement/completion status, configuration or parameter updates, health/fault reporting, measured feedback, quality/confidence, constraints, recovery, timing, and mode interactions.
- Add a reverse interface with reversed endpoints only when it changes configuration, control, diagnosis, verification, recovery, synchronization, resource use, or operating state. Do not mechanically mirror every row, manufacture symmetry, or add receipt-only acknowledgements.
- Every endpoint must perform behavior or be an explicitly named external actor/system. Never use a payload, command, status message, feedback-loop label, or container such as All Subsystems as a function endpoint.
- For every row, verify that the source produces the named command/data/state, the target consumes it, the receiver details describe its resulting behavior, and the direction follows the operational sequence.
- Keep every function under one subsystem owner. The Subsystem column owns Function From; the overall system boundary is not an internal subsystem.
- Build one coherent end-to-end mission thread and connect warranted safety, health, resource, degraded-mode, recovery, and operator paths through real operational effects rather than arbitrary bridge rows.
- Prefer specific domain terminology and stable Title Case verb-noun function names. Use specific noun-phrase interface names rather than generic send, transfer, process, or data-output labels.
`.trim();

function cleanText(value) {
  return String(value || "").trim();
}

function formatWizardClarifications(value) {
  if (!value || typeof value !== "object") return "";
  const lines = [];
  Object.entries(value).forEach(([section, entries]) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => {
      const question = cleanText(entry?.question);
      const answer = cleanText(entry?.answer);
      if (question && answer) lines.push(`- ${section}: ${question} Answer: ${answer}`);
    });
  });
  return lines.join("\n");
}

export function buildPromptWizardCollaboratorRequest(input) {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return {
        abstractionLevel: "multi-level",
        userRequest: cleanText(input),
        omittedAIGeneratedFields: [],
      };
    }
  }
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const systemName = cleanText(source.systemName || source.system) || "the requested system";
  const abstractionLevel = cleanText(source.abstractionLevel || source.decompositionDepth) || "multi-level";
  const aiGeneratedFields = new Set(
    Array.isArray(source?.evidenceProvenance?.aiGeneratedFields)
      ? source.evidenceProvenance.aiGeneratedFields.map(cleanText).filter(Boolean)
      : []
  );
  const evidence = [
    ["systemOverview", "System overview", source.systemOverview || source.objective],
    ["functionalComponents", "User-specified functions or components", source.functionalComponents || source.components],
    ["interactions", "User-specified interactions", source.interactions],
    ["ops", "Operational scenarios and modes", source.ops || source.operationalScenarios || source?.optional?.operationalScenarios],
  ]
    .filter(([field, , value]) => cleanText(value) && !aiGeneratedFields.has(field))
    .map(([, label, value]) => `${label}:\n${cleanText(value)}`);
  const clarifications = formatWizardClarifications(source.clarifications || source.clarificationResponses);
  if (clarifications) evidence.push(`User-selected clarification answers:\n${clarifications}`);

  return {
    abstractionLevel,
    omittedAIGeneratedFields: Array.from(aiGeneratedFields),
    userRequest: [
      `Create a functional decomposition for ${systemName}.`,
      evidence.length ? `Use this user-authored project context:\n\n${evidence.join("\n\n")}` : "No additional user-authored mission context was supplied.",
      aiGeneratedFields.size
        ? `Do not use the omitted AI-generated wizard drafts (${Array.from(aiGeneratedFields).join(", ")}) as requirements or infer optional product features from them.`
        : "Do not invent an application vertical, customer persona, or optional product feature that is not supported by the request.",
    ].join("\n\n"),
  };
}
