export const UNSPECIFIED_HAZARD_CONTEXT_ID = "context-unspecified";

export const UNSPECIFIED_HAZARD_CONTEXT = Object.freeze({
  id: UNSPECIFIED_HAZARD_CONTEXT_ID,
  scenario: "Unspecified scenario",
  mode: "Unspecified mode",
  conditions: "",
  assumptions: "",
});

function clean(value) {
  return String(value || "").trim();
}

export function normalizeHazardOperationalContexts(contexts = []) {
  const seen = new Set();
  return (Array.isArray(contexts) ? contexts : [])
    .map((context, index) => ({
      id: clean(context?.id) || `context-${index + 1}`,
      scenario: clean(context?.scenario),
      mode: clean(context?.mode),
      conditions: clean(context?.conditions),
      assumptions: clean(context?.assumptions),
    }))
    .filter((context) => {
      if (!context.scenario || !context.mode || seen.has(context.id)) return false;
      seen.add(context.id);
      return true;
    });
}

export function getEffectiveHazardOperationalContexts(contexts = []) {
  const normalized = normalizeHazardOperationalContexts(contexts);
  return normalized.length ? normalized : [UNSPECIFIED_HAZARD_CONTEXT];
}

export function getHazardOperationalContextLabel(context = UNSPECIFIED_HAZARD_CONTEXT) {
  return `${clean(context?.scenario) || "Unspecified scenario"} · ${clean(context?.mode) || "Unspecified mode"}`;
}

export function buildHazardOperationalContextPrompt(contexts = []) {
  const effective = getEffectiveHazardOperationalContexts(contexts);
  return effective.map((context, index) => [
    `Operational context ${index + 1}: ${getHazardOperationalContextLabel(context)}`,
    context.conditions ? `Operating conditions: ${context.conditions}` : "",
    context.assumptions ? `Assumptions: ${context.assumptions}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

export function getHazardContextRowKey(functionalRowIndex, guidePhraseIndex, contextId) {
  const base = `${Number(functionalRowIndex) || 0}:guide:${Number(guidePhraseIndex) || 0}`;
  const normalizedContextId = clean(contextId) || UNSPECIFIED_HAZARD_CONTEXT_ID;
  return `${base}:context:${encodeURIComponent(normalizedContextId)}`;
}

export function getLegacyHazardRowKey(functionalRowIndex, guidePhraseIndex) {
  return `${Number(functionalRowIndex) || 0}:guide:${Number(guidePhraseIndex) || 0}`;
}

export function isUnspecifiedHazardContext(context = {}) {
  return clean(context?.id) === UNSPECIFIED_HAZARD_CONTEXT_ID;
}
