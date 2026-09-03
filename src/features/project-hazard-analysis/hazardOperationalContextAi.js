import { buildAIAuthOpts } from "../../components/backendConfig";
import {
  getStoredActiveAIProvider,
  getStoredAIProviderModelPreference,
} from "../../lib/aiProviderConfig";
import { normalizeHazardOperationalContexts } from "./hazardOperationalContexts";

function extractJsonArray(value) {
  const raw = String(value || "").trim();
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  if (first < 0 || last <= first) throw new Error("The AI response did not contain an operational-context list.");
  return JSON.parse(raw.slice(first, last + 1));
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

export function parseHazardOperationalContextResponse(value, timestamp = Date.now()) {
  const parsed = extractJsonArray(value);
  if (!Array.isArray(parsed)) throw new Error("The AI response was not an operational-context list.");
  const proposed = parsed.slice(0, 12).map((context, index) => ({
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

async function requestConfiguredAI(prompt) {
  const provider = getStoredActiveAIProvider();
  const model = getStoredAIProviderModelPreference(provider, { includeDefault: true });
  const response = await fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2200,
      messages: [
        {
          role: "system",
          content: "You create concise, technically credible operational scenario and mode combinations for safety analysis. Return only the requested JSON.",
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

  const prompt = `
You are proposing operational contexts for a safety hazard analysis.

User description:
${request.slice(0, 8000)}

Project name: ${String(projectName || "Unspecified project").slice(0, 200)}

Functional architecture evidence:
${JSON.stringify(architecture)}

Existing scenario-mode combinations to avoid duplicating:
${JSON.stringify(existing)}

Return ONLY a JSON array containing 3 to 8 useful, distinct, applicable operational context objects. Each object must contain exactly:
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
  `.trim();

  const response = await requestConfiguredAI(prompt);
  if (!response) {
    throw new Error("The configured AI provider did not return operational-context suggestions.");
  }
  const generated = parseHazardOperationalContextResponse(response);
  if (!generated.length) throw new Error("The AI response did not contain complete scenario and mode combinations.");
  return generated;
}
