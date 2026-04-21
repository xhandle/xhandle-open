/**
 * xHandle: get llmlayout from rows diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

// ================== helpers (place above getLLMLayoutFromRows) ==================
import { backendURL, buildAIAuthOpts } from "../../lib/api/backendConfig";
import { logger } from "../../lib/utils/logger";

/**
 * buildPass1Prompt constructs the diagram model or layout structure shown in the UI for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param rows Worksheet or table rows that this step transforms.
 * @returns diagram data or layout state for rendering.
 */
function buildPass1Prompt(rows) {
    return `
  You are planning a clean engineering block diagram.
  
  Each row is a control interaction: From Function --Control Action--> To Function.
  
  Your tasks:
  1) Assign each function to a logical "layer" (0 = leftmost, increasing to the right).
  2) Group related nodes (e.g., "Sensors", "Controllers", "Actuators").
  3) For EVERY interaction, choose which SIDE of each node the edge attaches to: "left"|"right"|"top"|"bottom".
  
  Rules:
  - Flow left→right by default (increasing layer). Feedback is right→left.
  - Prefer sides that reduce dog-legs: forward uses right→left; feedback uses left→right or top/bottom if cleaner.
  - Mostly-vertical relations should use top/bottom.
  - Do not rename functions. Be consistent/deterministic.
  
  Output JSON ONLY:
  {
    "nodes": [ { "function": "<exact name>", "layer": <int>, "group": "<string>" } ],
    "edges": [
      { "from":"<From>", "to":"<To>", "controlAction":"<exact>", "sourceSide":"left|right|top|bottom", "targetSide":"left|right|top|bottom" }
    ]
  }
  
  Sort "nodes" by layer then function name. Sort "edges" by from→to→controlAction.
  
  Interactions:
  ${rows.map(r => `From: "${r.fromFunction}" --${r.controlAction}--> To: "${r.toFunction}"`).join('\n')}
  `.trim();
  }
  
  // Deterministic placement on a grid using model-given layer/group
  function placeNodesDeterministically(plan, { colGap = 300, rowGap = 200, x0 = 120, y0 = 100 }) {
    const byLayer = new Map();
    for (const n of (plan.nodes || [])) {
      const L = Number.isFinite(n.layer) ? n.layer : 0;
      if (!byLayer.has(L)) byLayer.set(L, []);
      byLayer.get(L).push(n);
    }
    const layers = [...byLayer.keys()].sort((a,b)=>a-b);
    const nodesOut = [];
  
    layers.forEach((L, colIdx) => {
      const layerNodes = byLayer.get(L).slice()
        .sort((a,b) => (a.group || "Default").localeCompare(b.group || "Default")
                    || a.function.localeCompare(b.function));
      layerNodes.forEach((n, rowIdx) => {
        nodesOut.push({
          function: n.function,
          x: x0 + colIdx * colGap,
          y: y0 + rowIdx * rowGap,
          layer: L,
          group: n.group || "Default"
        });
      });
    });
  
    return nodesOut;
  }
  
  // Basic validation + light repair (snap & push-down to resolve tight collisions)
  function validateAndRepair(layout, { minDX = 300, minDY = 200 }) {
    for (const n of layout.nodes) {
      n.x = Math.round(n.x / minDX) * minDX;
      n.y = Math.round(n.y / minDY) * minDY;
    }
    const nodes = layout.nodes.slice().sort((a,b)=> a.y-b.y || a.x-b.x);
    for (let i=0;i<nodes.length;i++){
      for (let j=i+1;j<nodes.length;j++){
        const a=nodes[i], b=nodes[j];
        const dx=Math.abs(a.x-b.x), dy=Math.abs(a.y-b.y);
        if (dx < minDX && dy < minDY) {
          b.y = a.y + minDY; // push b down one row
        }
      }
    }
    return layout;
  }
  
  // Approximate crossing score using layer-pair inversion counting
  function estimateCrossings(layout) {
    const byFunc = new Map(layout.nodes.map(n => [n.function, n]));
    const buckets = new Map();
    for (const e of (layout.edges || [])) {
      const s = byFunc.get(e.from), t = byFunc.get(e.to);
      if (!s || !t) continue;
      const a = Math.min(s.layer, t.layer);
      const b = Math.max(s.layer, t.layer);
      const key = `${a}-${b}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ sY: s.y, tY: t.y });
    }
    let score = 0;
    for (const arr of buckets.values()) {
      const sorted = arr.slice().sort((u,v)=>u.sY - v.sY);
      for (let i=0;i<sorted.length;i++){
        for (let j=i+1;j<sorted.length;j++){
          if (sorted[i].tY > sorted[j].tY) score++;
        }
      }
    }
    return score;
  }
  
/**
 * buildRefinePrompt constructs the diagram model or layout structure shown in the UI for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param plan Input consumed by this step of the xHandle workflow.
 * @param issues Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
  function buildRefinePrompt(plan, issues) {
    return `
  You proposed layers, groups, and port sides for a block diagram.
  We computed coordinates, validated, and found issues.
  
  Fix ONLY:
  - node "layer" (integer, left→right flow), and/or
  - edge "sourceSide"/"targetSide" (left|right|top|bottom)
  to reduce crossings and feedback congestion. Do NOT rename functions.
  
  Return the SAME JSON schema as before (nodes with {function,layer,group}, edges with side fields only). No prose.
  
  Issues summary:
  ${JSON.stringify(issues).slice(0, 3000)}
  
  Current plan:
  ${JSON.stringify(plan).slice(0, 6000)}
  `.trim();
  }
  
  // ================== REPLACE your two functions with these ==================
  
  export async function getLLMLayoutFromRows(rows) {
    // Pass 1: layers/groups/ports only
    const pass1 = await fetchLLMResponse(buildPass1Prompt(rows), {
      model: "gpt-4o",
      max_tokens: 3000,
      temperature: 0.1,
      seed: 42
    });
  
    let plan;
    try {
      plan = JSON.parse(pass1);
    } catch (e) {
      logger.warn("Plan JSON parse failed (pass1):", e);
      return null;
    }
  
    // Compute coords deterministically, then validate/repair
    let nodesPlaced = placeNodesDeterministically(plan, { colGap: 300, rowGap: 200, x0: 120, y0: 100 });
    let layout = { nodes: nodesPlaced, edges: plan.edges || [] };
    layout = validateAndRepair(layout, { minDX: 300, minDY: 200 });
  
    // Score crossings; one refinement if needed
    let crossingScore = estimateCrossings(layout);
    const tooManyCrossings = crossingScore > 5;
    const tooManyNodes = layout.nodes.length > 30;
  
    if (tooManyCrossings && !tooManyNodes) {
      const refine = await fetchLLMResponse(buildRefinePrompt(plan, { crossingScore }), {
        model: "gpt-4o",
        max_tokens: 3000,
        temperature: 0.1,
        seed: 42
      });
      try {
        const plan2 = JSON.parse(refine);
        const nodes2 = placeNodesDeterministically(plan2, { colGap: 300, rowGap: 200, x0: 120, y0: 100 });
        let layout2 = { nodes: nodes2, edges: plan2.edges || [] };
        layout2 = validateAndRepair(layout2, { minDX: 300, minDY: 200 });
  
        const score2 = estimateCrossings(layout2);
        if (score2 <= crossingScore) {
          layout = layout2;
          crossingScore = score2;
        }
      } catch (e) {
        logger.warn("Refine JSON parse failed:", e);
      }
    }
  
    // --- Backward compatibility ---
    // Your callsite does: `if (!res || !Array.isArray(res)) return;`
    // Return an ARRAY of nodes and hang edges off a property so that still passes.
    const resultArray = layout.nodes;
    resultArray.__edges = layout.edges;   // access as res.__edges at the callsite if you want
    return resultArray;
  }
  
/**
 * fetchLLMResponse sends an xHandle prompt to the backend chat proxy and returns the model text needed by this module. In AI-heavy flows this is the boundary that packages local worksheet context, optional diagram context, and any user-authored prompt text into the request format expected by the server.
 * @param prompt Prompt text or prompt payload supplied to the AI step.
 * @param model Input consumed by this step of the xHandle workflow.
 * @param max_tokens Input consumed by this step of the xHandle workflow.
 * @param temperature Input consumed by this step of the xHandle workflow.
 * @param seed Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the model response text expected by the downstream pipeline step.
 */
  async function fetchLLMResponse(
    prompt,
    { model = "gpt-4o", max_tokens = 2000, temperature = 0.1, seed = 42 } = {}
  ) {
    const res = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens,
        temperature,
        seed,
        // If your account supports structured outputs, this enforces JSON:
        response_format: { type: "json_object" }
      }),
    });
  
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM Error (${res.status}): ${err}`);
    }
  
    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? "";
  }
  
  
