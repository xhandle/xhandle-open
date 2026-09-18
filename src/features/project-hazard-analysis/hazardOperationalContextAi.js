import { buildAIAuthOpts } from "../../components/backendConfig";
import {
  getStoredActiveAIProvider,
  getStoredAIProviderModelPreference,
} from "../../lib/aiProviderConfig";
import { normalizeHazardOperationalContexts } from "./hazardOperationalContexts";

function contextListFromParsedValue(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const knownKeys = [
    "contexts",
    "operationalContexts",
    "operational_contexts",
    "suggestions",
    "items",
  ];
  for (const key of knownKeys) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  const values = Object.values(parsed);
  if (
    values.length
    && values.every((item) => item && typeof item === "object" && !Array.isArray(item))
    && values.some((item) => item.scenario || item.mode)
  ) {
    return values;
  }
  if (parsed.scenario || parsed.mode) return [parsed];
  return null;
}

function extractJsonArray(value) {
  const raw = String(value || "").trim();
  const candidates = [
    raw,
    ...Array.from(raw.matchAll(/\x60{3}(?:json)?\s*([\s\S]*?)\x60{3}/gi), (match) => match[1].trim()),
  ].filter(Boolean);
  const firstObject = raw.indexOf("{");
  const lastObject = raw.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(raw.slice(firstObject, lastObject + 1));
  }
  const firstArray = raw.indexOf("[");
  const lastArray = raw.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(raw.slice(firstArray, lastArray + 1));
  }

  for (const candidate of candidates) {
    try {
      const contexts = contextListFromParsedValue(JSON.parse(candidate));
      if (contexts) return contexts;
    } catch {
      // Try the next bounded JSON candidate before requesting a repair.
    }
  }
  throw new Error("The AI response did not contain an operational-context list.");
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

function cleanRequestedScenario(value) {
  return String(value || "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^\s*scenario\s*:\s*/i, "")
    .split(/\s*\|\s*(?=(?:mode|conditions?|assumptions?)\s*:)/i)[0]
    .trim();
}

export function extractExplicitScenarioRequests(value) {
  const request = String(value || "");
  const directive = /\b(?:create|generate|add|use|include)\s+(?:the\s+)?(?:following|these|specific|exact)\s+(?:\d+\s+)?(?:operational\s+)?scenarios?\b/i.exec(request);
  if (!directive) return [];

  const remainder = request.slice(directive.index + directive[0].length).replace(/^\s*:\s*/, "");
  const lines = remainder.split(/\r?\n/);
  const listed = lines
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .map(cleanRequestedScenario)
    .filter(Boolean);
  const candidates = listed.length
    ? listed
    : String(lines.find((line) => line.trim()) || "")
      .split(/\s*;\s*/)
      .map(cleanRequestedScenario)
      .filter(Boolean);

  const seen = new Set();
  return candidates.slice(0, 50).filter((scenario) => {
    const identity = scenario.toLowerCase();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function parseHazardOperationalContextResponse(value, timestamp = Date.now()) {
  const parsed = extractJsonArray(value);
  if (!Array.isArray(parsed)) throw new Error("The AI response was not an operational-context list.");
  const proposed = parsed.slice(0, 50).map((context, index) => ({
    id: `context-ai-${timestamp}-${index + 1}-${slug(context?.scenario || context?.mode) || "proposal"}`,
    scenario: context?.scenario,
    mode: context?.mode,
    conditions: context?.conditions,
    assumptions: context?.assumptions,
  }));
  const normalized = normalizeHazardOperationalContexts(proposed);
  const seen = new Set();
  return normalized.filter((context) => {
    const identity = `${context.scenario.toLowerCase()}::${context.mode.toLowerCase()}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

async function requestConfiguredAI(prompt, systemPrompt = "") {
  const provider = getStoredActiveAIProvider();
  const model = getStoredAIProviderModelPreference(provider, { includeDefault: true });
  const response = await fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 5000,
      messages: [
        {
          role: "system",
          content: systemPrompt || "You create concise, technically credible operational scenario and mode combinations for safety analysis. Return only the requested JSON.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json();
      detail = body?.error ? `: ${body.error}` : "";
    } catch {}
    throw new Error(`Operational-context generation failed (${response.status})${detail}`);
  }
  const body = await response.json();
  return body?.choices?.[0]?.message?.content?.trim() || "";
}

async function parseOrRepairOperationalContexts(response, originalPrompt) {
  try {
    return parseHazardOperationalContextResponse(response);
  } catch {
    const repairPrompt = [
      "The previous model response did not satisfy the operational-context JSON contract.",
      "",
      "Original generation request:",
      originalPrompt,
      "",
      "Invalid response:",
      String(response || "(empty response)").slice(0, 12000),
      "",
      "Regenerate the answer as one valid JSON object with exactly this shape:",
      '{"contexts":[{"scenario":"concrete operating situation or mission phase","mode":"system operating mode","conditions":"material environmental, temporal, actor, or system-state conditions","assumptions":"explicit assumptions used by the analysis"}]}',
      "",
      "Return every context required by an explicit scenario list in the original request; otherwise return 3 to 8 complete, distinct contexts. Return JSON only—no Markdown fences, preamble, explanation, or trailing commentary.",
    ].join("\n");
    const repaired = await requestConfiguredAI(
      repairPrompt,
      "You repair structured operational-context output. Return exactly one valid JSON object containing a contexts array and no other text.",
    );
    try {
      return parseHazardOperationalContextResponse(repaired);
    } catch {
      throw new Error(
        "The configured AI provider returned malformed operational contexts twice. Please retry with a more specific system or operating-concept description.",
      );
    }
  }
}

export async function generateHazardOperationalContexts({
  description,
  projectName = "",
  functionalRows = [],
  existingContexts = [],
}) {
  const request = String(description || "").trim();
  if (!request) throw new Error("Describe the system or operating concept before generating contexts.");

  const architecture = (Array.isArray(functionalRows) ? functionalRows : [])
    .slice(0, 30)
    .map((row) => ({
      subsystem: String(row?.subsystem || "").trim(),
      functionFrom: String(row?.fromFunction || "").trim(),
      controlAction: String(row?.controlAction || "").trim(),
      functionTo: String(row?.toFunction || "").trim(),
    }));
  const existing = normalizeHazardOperationalContexts(existingContexts).map(({ scenario, mode }) => ({ scenario, mode }));
  const explicitScenarios = extractExplicitScenarioRequests(request);
  const existingScenarioNames = new Set(existing.map(({ scenario }) => scenario.toLowerCase()));
  const requiredScenarios = explicitScenarios.filter((scenario) => !existingScenarioNames.has(scenario.toLowerCase()));
  const explicitScenarioContract = explicitScenarios.length
    ? `\nThe user explicitly requested these scenarios:\n${JSON.stringify(explicitScenarios)}\n\nExplicit-list rules:\n- Treat the listed scenario names as requirements, not suggestions.\n- For each listed scenario that is not already represented in the existing combinations, return exactly one context.\n- Copy each required scenario name exactly, preserving spelling and order.\n- Infer only its mode, conditions, and assumptions from the user description and architecture.\n- Do not replace, merge, generalize, rename, or add scenarios.\n- Required new scenarios: ${JSON.stringify(requiredScenarios)}`
    : "";

  const prompt = `
You are proposing operational contexts for a safety hazard analysis.

User description:
${request.slice(0, 8000)}

Project name: ${String(projectName || "Unspecified project").slice(0, 200)}

Functional architecture evidence:
${JSON.stringify(architecture)}

Existing scenario-mode combinations to avoid duplicating:
${JSON.stringify(existing)}
${explicitScenarioContract}

Return ONLY one valid JSON object containing a "contexts" array with ${explicitScenarios.length ? "exactly the required new scenarios listed above" : "3 to 8 useful, distinct, applicable operational context objects"}. Each context object must contain exactly:
- scenario: a concrete operating situation or mission phase
- mode: the system operating mode active in that scenario
- conditions: concise environmental, temporal, actor, or system-state conditions that materially influence hazards
- assumptions: concise analysis assumptions that must be recorded

Rules:
- Propose scenario-mode combinations, not every theoretical Cartesian product.
- Cover meaningfully different exposure, control authority, degraded-state, transition, startup/shutdown, maintenance, emergency, or fallback conditions when supported by the description.
- Keep the proposal domain-neutral unless the description or architecture establishes a domain.
- Do not generate hazards, mitigations, guide phrases, or functional decomposition rows.
- Do not repeat an existing scenario-mode combination.
- Use this exact top-level shape: {"contexts":[{"scenario":"...","mode":"...","conditions":"...","assumptions":"..."}]}
- Return JSON only, with no Markdown fence, preamble, explanation, or trailing commentary.
  `.trim();

  const response = await requestConfiguredAI(prompt);
  const generated = await parseOrRepairOperationalContexts(response, prompt);
  if (explicitScenarios.length) {
    const byScenario = new Map(generated.map((context) => [context.scenario.toLowerCase(), context]));
    const missing = requiredScenarios.filter((scenario) => !byScenario.has(scenario.toLowerCase()));
    if (missing.length) {
      throw new Error(`The AI did not preserve these explicitly requested scenarios: ${missing.join(", ")}. Please retry.`);
    }
    return requiredScenarios.map((scenario) => byScenario.get(scenario.toLowerCase()));
  }
  if (!generated.length) throw new Error("The AI response did not contain complete scenario and mode combinations.");
  return generated;
}
