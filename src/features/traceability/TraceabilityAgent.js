/**
 * xHandle: traceability agent traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

// components/TraceabilityAgent.js
// Agentic Traceability Auditor: build graph → find gaps → propose fixes → produce patches
// Works in "dryRun" (suggestions only) or "apply" (returns patches to commit via your store).

/**
 * EXPECTED INPUTS (pass from your app):
 * - requirements: Array<{ id, title, module, attributes, links: Array<{toId, type}>, status }>
 * - functions: Array<{ id, label, from?: string, to?: string }>   // from your functional decomposition rows
 * - hazardsSummaryRows: Array<Record<string,string>>               // "Summary" sheet rows (STPA/FMEA/What-If)
 *
 * OUTPUTS:
 * - coverage: { reqCoveredPct, hazardMitigatedPct, mitigationVerifiedPct, functionCoveredPct }
 * - gaps: { reqNoHazard:[], hazardNoMitigation:[], mitigationNoVerification:[], functionNoRequirement:[] }
 * - suggestions: Array<PatchSuggestion>  (when runTraceabilityAgent)
 * - patches: Array<Patch>                (when apply = true)
 */

import { v4 as uuidv4 } from "uuid";
import { backendURL, buildAIAuthOpts } from "../../lib/api/backendConfig";
import { logger } from "../../lib/utils/logger";

/* -------------------------- Provider-aware LLM caller -------------------------- */
/**
 * Universal fetchLLMResponse that supports BOTH call styles:
 *   1) fetchLLMResponse("prompt string", { model, temperature, max_tokens })
 *   2) fetchLLMResponse({ prompt, model, temperature, max_tokens, retries, system })
 *
 * The traceability agent always goes through xHandle's backend chat proxy so the
 * frontend can stay provider-agnostic while the server routes requests to the
 * active AI provider selected in Settings.
 */
async function fetchLLMResponse(arg1, opts = {}) {
  // Normalize arguments
  let prompt, model, temperature, max_tokens, retries, system, userId;
  if (typeof arg1 === "string") {
    prompt = arg1;
    model = opts.model ?? "gpt-4o";
    temperature = opts.temperature ?? 0.2;
    max_tokens = opts.max_tokens ?? 1200;
    retries = opts.retries ?? 2;
    system = opts.system ?? "You are a helpful, concise technical assistant.";
    userId = opts.userId;
  } else {
    prompt = arg1.prompt;
    model = arg1.model ?? "gpt-4o";
    temperature = arg1.temperature ?? 0.2;
    max_tokens = arg1.max_tokens ?? 1200;
    retries = arg1.retries ?? 2;
    system = arg1.system ?? "You are a helpful, concise technical assistant.";
    userId = arg1.userId;
  }

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature,
    max_tokens,
    ...(userId ? { userId } : {}),
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${backendURL}/api/chat`, {
        method: "POST",
        ...buildAIAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM Error (${res.status}): ${err}`);
      }

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || "";
      return content.trim();
    } catch (error) {
      logger.warn(`🔁 LLM retry ${attempt + 1} failed`, error);
      if (attempt === retries) throw error;
      // simple backoff
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

/* -------------------------- Graph Builder -------------------------- */

export function buildTraceabilityGraph({ requirements = [], functions = [], hazardsSummaryRows = [] }) {
  // Normalize hazards summary into common fields
  const normalizedHazards = hazardsSummaryRows.map((row, i) => normalizeHazardRow(row, i));

  // Index requirements by id and by (loose) title for matching
  const reqById = new Map(requirements.map(r => [r.id, r]));
  const reqByTitle = indexByNormalizedTitle(requirements);

  // Build nodes
  const nodes = {
    requirement: new Map(),  // id -> { id, title }
    hazard: new Map(),       // hid -> { id, label, sourceRowIdx }
    mitigation: new Map(),   // mid -> { id, label, sourceRowIdx }
    test: new Map(),         // tid -> { id, title }
    func: new Map(),         // fid -> { id, label }
  };

  // Seed requirement & test nodes from requirements list
  requirements.forEach(r => {
    const isTest = (r.module || "").toLowerCase() === "test";
    if (isTest) nodes.test.set(r.id, { id: r.id, title: r.title });
    else nodes.requirement.set(r.id, { id: r.id, title: r.title });
  });

  // Seed function nodes from functional rows
  functions.forEach(f => {
    const id = f.id || uuidv4();
    nodes.func.set(id, { id, label: f.label || f.name || `Fn-${id.slice(0,6)}` });
  });

  // Add hazard + mitigation "virtual" nodes from summary rows
  normalizedHazards.forEach((h) => {
    const hid = `HZ:${h.key}`;
    const mid = `MT:${h.key}`;
    nodes.hazard.set(hid, { id: hid, label: h.hazardLike, sourceRowIdx: h._row });
    nodes.mitigation.set(mid, { id: mid, label: h.mitigationLike || h.mitigation, sourceRowIdx: h._row });
  });

  // Edges (typed)
  const edges = {
    req_to_hazard: new Set(),      // `${reqId}->${hazId}`
    hazard_to_mitigation: new Set(),
    mitigation_to_test: new Set(),
    func_to_req: new Set(),
  };

  // Existing links on requirements are left as-is (we focus our inference on Summary-driven links).

  // Heuristic function->requirement (by title overlap / attribute hints)
  const funcToReqMatches = guessFuncReqMatches(functions, requirements);
  funcToReqMatches.forEach(({ funcId, reqId }) => edges.func_to_req.add(`${funcId}->${reqId}`));

  // Infer edges from hazards summary:
  normalizedHazards.forEach((h) => {
    const hid = `HZ:${h.key}`;
    const mid = `MT:${h.key}`;

    // Map "System Requirement" (or equivalent) column to an existing requirement if possible
    const reqTitles = h.reqCandidates.filter(Boolean);
    const matchedReqIds = new Set();
    reqTitles.forEach(t => {
      const matchId = reqByTitle.get(normalizeTitle(t));
      if (matchId && nodes.requirement.has(matchId)) {
        edges.req_to_hazard.add(`${matchId}->${hid}`);
        matchedReqIds.add(matchId);
      }
    });

    // Hazard -> Mitigation if mitigation present in row
    if (h.mitigationLike) {
      edges.hazard_to_mitigation.add(`${hid}->${mid}`);
    }

    // Try to find tests that verify those matched reqs (by module === 'Test' and title mention)
    if (matchedReqIds.size) {
      nodes.test.forEach((tNode, tid) => {
        for (const rid of matchedReqIds) {
          const rTitle = (reqById.get(rid)?.title || "").toLowerCase();
          if (tNode.title.toLowerCase().includes(rTitle.slice(0, 12))) {
            edges.mitigation_to_test.add(`${mid}->${tid}`);
          }
        }
      });
    }
  });

  return { nodes, edges, normalizedHazards };
}

/**
 * indexByNormalizedTitle encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param requirements Requirement records participating in this step.
 * @returns the value that the next step in this workflow consumes.
 */
function indexByNormalizedTitle(requirements) {
  const map = new Map();
  requirements.forEach(r => {
    const k = normalizeTitle(r.title);
    if (k && !map.has(k)) map.set(k, r.id);
  });
  return map;
}

/**
 * normalizeTitle prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizeTitle(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * normalizeHazardRow prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param row Single worksheet row being normalized or rendered.
 * @param rowIdx Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizeHazardRow(row, rowIdx) {
  // Flexible column detection across STPA / FMEA / What-If variants:
  const cols = Object.keys(row).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
  const pick = (names) => {
    for (const name of names) {
      const key = cols[name.toLowerCase()];
      if (key && row[key]) return String(row[key]);
    }
    return "";
  };

  const hazardLike = pick(["Hazard", "Hazards", "Risk", "Effect", "Hazard Description"]);
  const mitigationLike = pick(["Mitigation Strategy", "Mitigation", "Control", "Safeguard"]);
  const sysReq = pick([
    "System Requirement",
    "Requirement",
    "Safety Requirement",
    "Safety Requirements/Constraints",
    "Consolidated Requirement"
  ]);
  const altReq = pick(["AI Policy", "Policy"]); // optional extra link target

  const key = `${hashish(hazardLike)}:${hashish(mitigationLike)}:${hashish(sysReq) || "nr"}`;
  return {
    _row: rowIdx,
    hazardLike: hazardLike || "(unspecified hazard)",
    mitigationLike: mitigationLike || "",
    reqCandidates: [sysReq, altReq].filter(Boolean),
    key,
  };
}

/**
 * hashish encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function hashish(s) {
  return (String(s || "").toLowerCase().replace(/\s+/g, "-").slice(0, 40)) || "x";
}

/**
 * guessFuncReqMatches encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param functions Input consumed by this step of the xHandle workflow.
 * @param requirements Requirement records participating in this step.
 * @returns the value that the next step in this workflow consumes.
 */
function guessFuncReqMatches(functions, requirements) {
  const reqs = requirements.map(r => ({ id: r.id, title: r.title.toLowerCase() }));
  const res = [];
  functions.forEach(f => {
    const fl = (f.label || f.name || "").toLowerCase();
    if (!fl) return;
    const hit = reqs.find(r => r.title.includes(fl.slice(0, 10))); // loose match
    if (hit) res.push({ funcId: f.id || f.label || hit.id, reqId: hit.id });
  });
  return dedupByKey(res, x => `${x.funcId}->${x.reqId}`);
}

/* -------------------------- Coverage & Gaps -------------------------- */

export function computeCoverage(graph) {
  const { nodes, edges } = graph;

  const reqCount = nodes.requirement.size || 1;
  const hzCount = nodes.hazard.size || 1;
  const mtCount = nodes.mitigation.size || 1;
  const fnCount = nodes.func.size || 1;

  const reqCovered = countLeftCovered(edges.req_to_hazard);
  const hzMitigated = countLeftCovered(edges.hazard_to_mitigation);
  const mtVerified = countLeftCovered(edges.mitigation_to_test);
  const fnCovered = countLeftCovered(edges.func_to_req);

  return {
    reqCoveredPct: Math.round((reqCovered / reqCount) * 100),
    hazardMitigatedPct: Math.round((hzMitigated / hzCount) * 100),
    mitigationVerifiedPct: Math.round((mtVerified / mtCount) * 100),
    functionCoveredPct: Math.round((fnCovered / fnCount) * 100),
  };
}

/**
 * findGaps encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param graph Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function findGaps(graph) {
  const { nodes, edges } = graph;

  // Helper: get left nodes with no outgoing edge to right type
  const leftMissingRight = (leftMap, edgeSet, extractLeft) => {
    const withOut = new Set([...edgeSet].map(e => extractLeft(e)));
    return [...leftMap.values()].filter(n => !withOut.has(n.id));
  };

  const reqNoHazard = leftMissingRight(nodes.requirement, edges.req_to_hazard, e => e.split("->")[0]);
  const hazardNoMitigation = leftMissingRight(nodes.hazard, edges.hazard_to_mitigation, e => e.split("->")[0]);
  const mitigationNoVerification = leftMissingRight(nodes.mitigation, edges.mitigation_to_test, e => e.split("->")[0]);
  const functionNoRequirement = leftMissingRight(nodes.func, edges.func_to_req, e => e.split("->")[0]);

  return { reqNoHazard, hazardNoMitigation, mitigationNoVerification, functionNoRequirement };
}

/**
 * countLeftCovered encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param edgeSet Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function countLeftCovered(edgeSet) {
  const lefts = new Set();
  edgeSet.forEach(e => lefts.add(e.split("->")[0]));
  return lefts.size;
}

/* -------------------------- Agentic Loop -------------------------- */

// Suggestion/Patch types we produce:
/// type Patch =
//   | { type: "link", fromId: string, toId: string, linkType: "derives"|"verifies"|"refines"|"satisfies" }
//   | { type: "create", module: string, title: string, attributes?: object, parentId?: string | null }
//   | { type: "update", id: string, title?: string, attributes?: object }
//
// type PatchSuggestion = Patch & { rationale: string, confidence: number, previewId?: string }

export async function runTraceabilityAgent({
  requirements,
  functions,
  hazardsSummaryRows,
  maxIterations = 3,
  onUpdate = () => {},
  dryRun = true,
  targetCoverage = { reqCoveredPct: 100, hazardMitigatedPct: 100, mitigationVerifiedPct: 80, functionCoveredPct: 80 },
}) {
  let graph = buildTraceabilityGraph({ requirements, functions, hazardsSummaryRows });
  let coverage = computeCoverage(graph);
  let suggestions = [];

  for (let iter = 1; iter <= maxIterations; iter++) {
    const gaps = findGaps(graph);
    onUpdate({ stage: "gaps", iter, coverage, gaps });

    // Stop if coverage thresholds are met
    if (meetsTargets(coverage, targetCoverage)) break;

    // Ask LLM for fixes for current gaps
    const llmFixes = await proposeFixesWithLLM({ gaps, graph, requirements, functions, hazardsSummaryRows });
    suggestions = suggestions.concat(llmFixes);
    onUpdate({ stage: "suggestions", iter, suggestions });

    // Apply suggestions locally to update the graph (simulation)
    const applied = applySuggestionsToLocalGraph(llmFixes, { graph });
    graph = applied.graph;
    coverage = computeCoverage(graph);

    onUpdate({ stage: "coverage", iter, coverage });

    if (meetsTargets(coverage, targetCoverage)) break;
  }

  // If caller wants patches to commit, return them too (caller decides to persist)
  const patches = suggestionsToPatches(suggestions);

  return { coverage, suggestions, patches };
}

/**
 * meetsTargets encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param coverage Input consumed by this step of the xHandle workflow.
 * @param targets Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function meetsTargets(coverage, targets) {
  return (
    coverage.reqCoveredPct >= (targets.reqCoveredPct ?? 100) &&
    coverage.hazardMitigatedPct >= (targets.hazardMitigatedPct ?? 100) &&
    coverage.mitigationVerifiedPct >= (targets.mitigationVerifiedPct ?? 80) &&
    coverage.functionCoveredPct >= (targets.functionCoveredPct ?? 80)
  );
}

/**
 * proposeFixesWithLLM encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param gaps Input consumed by this step of the xHandle workflow.
 * @param graph Input consumed by this step of the xHandle workflow.
 * @param requirements Requirement records participating in this step.
 * @param functions Input consumed by this step of the xHandle workflow.
 * @param hazardsSummaryRows Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function proposeFixesWithLLM({ gaps, graph, requirements, functions, hazardsSummaryRows }) {
  const sysContext = summarizeContextForLLM({ graph, requirements, functions, hazardsSummaryRows });

  const prompt = `
You are a senior safety & compliance engineer. Close traceability gaps by proposing specific, atomic changes.

Artifacts:
${sysContext}

Your task:
- For each uncovered Requirement, propose a likely associated Hazard (from the summary rows) and link it (type: "refines" or "satisfies").
- For each uncovered Hazard, propose a Mitigation statement (or reuse existing) and link hazard→mitigation.
- For each Mitigation without verification, propose a Test requirement title (module "Test") and link mitigation→test (type: "verifies").
- For each Function without a Requirement, propose a Requirement title aligned with the function's intent and link function→requirement.

Return STRICT JSON array of suggestions where each item is one of:
  {"type":"link","fromId":"REQ_ID","toId":"HZ:...","linkType":"satisfies","rationale":"...", "confidence":0.82}
  {"type":"create","module":"Test","title":"...", "attributes":{"priority":"High"}, "rationale":"...", "confidence":0.76}
  {"type":"update","id":"REQ_ID","title":"Improved text ...", "rationale":"...", "confidence":0.61}

Guidelines:
- Prefer linking to *existing* nodes (referenced by id in the Artifacts) over creating new.
- Only create a new Requirement if none exists and it materially improves coverage.
- Keep titles concise and test titles verifiable (observable, measurable).
- Confidence between 0 and 1.
  `;

  const raw = await fetchLLMResponse(prompt, { model: "gpt-4o-mini", temperature: 0.2, max_tokens: 1200 });
  const json = extractJsonArraySafely(raw);
  // Enrich with preview ids for any created node
  return (json || []).map(s => ({ ...s, previewId: s.previewId || uuidv4() }));
}

/**
 * summarizeContextForLLM executes one step of the traceability and V&V workflow. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param graph Input consumed by this step of the xHandle workflow.
 * @param requirements Requirement records participating in this step.
 * @param functions Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function summarizeContextForLLM({ graph, requirements, functions /*, hazardsSummaryRows */ }) {
  const reqLines = requirements.slice(0, 200).map(r => `- ${r.id} | ${r.module} | ${r.title}`);
  const fnLines = functions.slice(0, 200).map(f => `- ${f.id || f.label} | ${f.label || f.name}`);
  const hzLines = graph.normalizedHazards.slice(0, 200)
    .map(h => `- HZ:${h.key} | hazard="${h.hazardLike}" | mitigation="${h.mitigationLike}" | reqCandidates=${h.reqCandidates.join(" / ")}`);

  const edges = graph.edges;
  const eLine = (set, tag) => `${tag}: ${[...set].slice(0, 200).join(", ")}`;

  return `
Requirements:
${reqLines.join("\n")}

Functions:
${fnLines.join("\n")}

Hazards:
${hzLines.join("\n")}

Edges:
${eLine(edges.req_to_hazard,"req->hazard")}
${eLine(edges.hazard_to_mitigation,"hazard->mitigation")}
${eLine(edges.mitigation_to_test,"mitigation->test")}
${eLine(edges.func_to_req,"func->req")}
  `.trim();
}

/**
 * extractJsonArraySafely prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function extractJsonArraySafely(text) {
  try {
    const m = text.match(/\[[\s\S]*\]$/) || text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    return JSON.parse(m[0]);
  } catch {
    return [];
  }
}

/**
 * applySuggestionsToLocalGraph encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param suggestions Input consumed by this step of the xHandle workflow.
 * @param graph Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function applySuggestionsToLocalGraph(suggestions, { graph }) {
  const g = {
    nodes: {
      requirement: new Map(graph.nodes.requirement),
      hazard: new Map(graph.nodes.hazard),
      mitigation: new Map(graph.nodes.mitigation),
      test: new Map(graph.nodes.test),
      func: new Map(graph.nodes.func),
    },
    edges: {
      req_to_hazard: new Set(graph.edges.req_to_hazard),
      hazard_to_mitigation: new Set(graph.edges.hazard_to_mitigation),
      mitigation_to_test: new Set(graph.edges.mitigation_to_test),
      func_to_req: new Set(graph.edges.func_to_req),
    },
    normalizedHazards: graph.normalizedHazards,
  };

  suggestions.forEach(s => {
    if (s.type === "link" && s.fromId && s.toId) {
      const leftIsReq = g.nodes.requirement.has(s.fromId);
      const leftIsHaz = g.nodes.hazard.has(s.fromId);
      const leftIsMit = g.nodes.mitigation.has(s.fromId);
      if (leftIsReq && g.nodes.hazard.has(s.toId)) g.edges.req_to_hazard.add(`${s.fromId}->${s.toId}`);
      else if (leftIsHaz && g.nodes.mitigation.has(s.toId)) g.edges.hazard_to_mitigation.add(`${s.fromId}->${s.toId}`);
      else if (leftIsMit && g.nodes.test.has(s.toId)) g.edges.mitigation_to_test.add(`${s.fromId}->${s.toId}`);
      else if (g.nodes.func.has(s.fromId) && g.nodes.requirement.has(s.toId)) g.edges.func_to_req.add(`${s.fromId}->${s.toId}`);
    }
    if (s.type === "create") {
      if ((s.module || "").toLowerCase() === "test") {
        const id = s.previewId || uuidv4();
        g.nodes.test.set(id, { id, title: s.title || "New Test" });
      } else {
        const id = s.previewId || uuidv4();
        g.nodes.requirement.set(id, { id, title: s.title || "New Requirement" });
      }
    }
    if (s.type === "update") {
      const node = g.nodes.requirement.get(s.id);
      if (node) g.nodes.requirement.set(s.id, { ...node, title: s.title || node.title });
    }
  });

  return { graph: g };
}

/**
 * suggestionsToPatches encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param suggestions Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function suggestionsToPatches(suggestions) {
  // Strip preview fields; return patches to persist in store
  return suggestions.map(s => {
    if (s.type === "create") {
      return { type: "create", module: s.module, title: s.title, attributes: s.attributes || {} };
    }
    if (s.type === "update") {
      return { type: "update", id: s.id, title: s.title, attributes: s.attributes || {} };
    }
    if (s.type === "link") {
      return { type: "link", fromId: s.fromId, toId: s.toId, linkType: s.linkType || "refines" };
    }
    return null;
  }).filter(Boolean);
}

/* -------------------------- Commit Helper -------------------------- */
/**
 * applyPatches: call your store functions to persist patches.
 * Provide an object with:
 * - createRequirement({ title, module, attributes }): Promise<{ id }>
 * - updateRequirement({ id, title, attributes }): Promise<void>
 * - addLink({ fromId, toId, type }): Promise<void>   // or updateRequirement to push link
 */
export async function applyPatches(patches, { createRequirement, updateRequirement, addLink }) {
  const idMap = new Map(); // previewId -> realId when we create

  for (const p of patches) {
    if (p.type === "create") {
      const created = await createRequirement({ title: p.title, module: p.module, attributes: p.attributes || {} });
      idMap.set(p.previewId || p.title, created.id);
    }
    if (p.type === "update") {
      await updateRequirement({ id: p.id, title: p.title, attributes: p.attributes || {} });
    }
    if (p.type === "link") {
      // if a link points to a previewId we created, remap
      const fromId = idMap.get(p.fromId) || p.fromId;
      const toId = idMap.get(p.toId) || p.toId;
      await addLink({ fromId, toId, type: p.linkType });
    }
  }
}

/* -------------------------- Utils -------------------------- */
function dedupByKey(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
