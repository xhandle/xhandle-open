/**
 * xHandle: ai test gen traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

// src/components/utils/aiTestGen.js
// LLM integration mirrors askAIPM(): backend proxied chat call, JSON-enforced response.
import { backendURL, buildAIAuthOpts } from "../../../lib/api/backendConfig";

let __idCounter = 1;
/**
 * nextId encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param prefix Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function nextId(prefix = "T") {
  return `${prefix}${__idCounter++}`; // T1, T2, T3...
}

/**
 * safe encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param x Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function safe(x) {
  try { return JSON.stringify(x).slice(0, 20000); } catch { return "[]"; }
}
/**
 * extractJson prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param txt Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function extractJson(txt) {
  if (typeof txt !== "string") return "{}";
  const m = txt.match(/```json\s*([\s\S]*?)```/i);
  if (m) return m[1];
  const i = txt.indexOf("{");
  return i >= 0 ? txt.slice(i) : "{}";
}

/**
 * askAITestGen encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param kind Input consumed by this step of the xHandle workflow.
 * @param payload Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function askAITestGen(kind, payload) {
  const sys = {
    role: "system",
    content:
      "You are a senior systems test engineer. Return concise, strictly valid JSON. Prefer deterministic, implementation-neutral tests."
  };

  let userContent = "";

  if (kind === "generate_tests_single") {
    userContent = `
Return JSON: {
  "tests":[
    {
      "id": "optional short id",
      "name": "string",
      "kind": "Nominal | Boundary | Pairwise | Fault Injection | Temporal",
      "priority": "P1 | P2 | P3",
      "objective": "string",
      "steps": ["step 1", "step 2", "..."],
      "oracle": { "type": "Rule | Threshold | Text", "rule": "string or JSON rule" },
      "params": { "optional": "object" }
    }
  ]
}
Guidance:
- Cover Nominal, Boundary, Pairwise (if parameters), Fault Injection, and Temporal when appropriate.
- Keep steps minimal and deterministic.
- Use engineering language; avoid UI fluff.
- Prefer oracles that are verifiable (Rule/Threshold) when possible.

Project: ${payload.projectName}
SystemContext: ${payload.systemContext || "N/A"}

Requirement: ${safe(payload.requirement)}
RelatedHazards: ${safe(payload.hazardTitles || [])}
`.trim();
  } else {
    throw new Error("Unsupported aiTestGen kind");
  }

  const requestInit = {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [sys, { role: "user", content: userContent }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  };

  let resp;
  try {
    resp = await fetch(`${backendURL}/api/chat`, requestInit);
  } catch (err) {
    const msg = String(err?.message || err);
    const isNetworkFailure = /failed to fetch|networkerror|load failed/i.test(msg);
    if (!isNetworkFailure) throw err;
    // Fallback to CRA dev proxy when direct backend URL is unreachable.
    resp = await fetch("/api/chat", requestInit);
  }

  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => "");
    throw new Error(`LLM proxy error (${resp.status}): ${errTxt}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content || "";
  try { return JSON.parse(extractJson(raw)); }
  catch { return { tests: [] }; }
}

/**
 * normalizeTest prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param raw Input consumed by this step of the xHandle workflow.
 * @param requirementId Stable identifier for the entity this step works with.
 * @param hazardTitles Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizeTest(raw, requirementId, hazardTitles = []) {
  const id = raw.id || nextId("T");
  const kind = String(raw.kind || raw.type || "Nominal");
  const priority = String(raw.priority || "P2");
  const objective = String(
    raw.objective || raw.goal || raw.description || `Validate requirement ${requirementId}`
  );
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map(String).filter(Boolean)
    : (typeof raw.steps === "string" ? raw.steps.split(/\n+/) : []);

  let oracle = null;
  if (raw.oracle && typeof raw.oracle === "object") {
    oracle = {
      type: String(raw.oracle.type || "Rule"),
      rule: raw.oracle.rule ?? raw.oracle.expression ?? raw.oracle.value ?? "Expected state matches requirement acceptance criteria."
    };
  } else if (typeof raw.oracle === "string") {
    oracle = { type: "Text", rule: raw.oracle };
  } else if (raw.acceptance || raw.expected) {
    oracle = { type: "Text", rule: raw.acceptance || raw.expected };
  }

  return {
    id,
    name: raw.name || `${kind} — ${requirementId}`,
    kind,
    priority,
    objective,
    steps,
    oracle,
    params: raw.params || {},
    links: {
      requirementId,
      hazardIds: hazardTitles, // titles for now; swap to IDs upstream if you have them
    },
    design: {
      expectedResult: oracle?.rule || raw.expected || null,
      steps,
    },
  };
}

/**
 * generateTestsForRequirement constructs the traceability view, plan, or verification artifact used downstream for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param requirement Single requirement record being transformed or rendered.
 * @param hazardTitles Input consumed by this step of the xHandle workflow.
 * @param systemContext Context object or text used to enrich this step.
 * @param projectName Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateTestsForRequirement({ requirement, hazardTitles = [], systemContext = "", projectName = "" }) {
  const reqId = requirement?.id || requirement?.tag || requirement?.title || "REQ";
  const out = await askAITestGen("generate_tests_single", {
    projectName,
    systemContext,
    requirement,
    hazardTitles,
  });
  const rawTests = Array.isArray(out?.tests) ? out.tests : [];
  return rawTests.map((t) => normalizeTest(t, reqId, hazardTitles));
}

/**
 * generateTestsBulk constructs the traceability view, plan, or verification artifact used downstream for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param requirements Requirement records participating in this step.
 * @param reqToHazTitles Input consumed by this step of the xHandle workflow.
 * @param systemContext Context object or text used to enrich this step.
 * @param projectName Input consumed by this step of the xHandle workflow.
 * @param onProgress Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateTestsBulk({ requirements = [], reqToHazTitles = new Map(), systemContext = "", projectName = "", onProgress = () => {} }) {
  const all = [];
  for (let i = 0; i < requirements.length; i++) {
    const r = requirements[i];
    onProgress(i + 1, requirements.length, r);
    const normKey = String((r.title || r.name || r.id || "")).toLowerCase().trim().replace(/\s+/g, " ");
    const hazards = reqToHazTitles.get(normKey) || [];
    const ts = await generateTestsForRequirement({
      requirement: r,
      hazardTitles: hazards,
      systemContext,
      projectName,
    });
    all.push(...ts);
  }
  return all;
}
