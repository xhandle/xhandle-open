/**
 * xHandle: index module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

// src/vnv/index.js
// Pro-grade, dependency-free V&V generation + exports.

const makeId = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  
/**
 * S renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  const S = (v) => (v == null ? "" : String(v));
/**
 * T renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  const T = (v) => S(v).trim().toLowerCase();
  
  /* ---------- Normalize inputs ---------- */
  function parseSummaryToHazards(analysisResult) {
    const table = analysisResult?.Summary;
    if (!Array.isArray(table) || table.length < 2) return [];
    const [headers, ...rows] = table;
    const idx = {};
    headers.forEach((h, i) => (idx[T(h)] = i));
  
    const nameKey = Object.keys(idx).find(k => /\bhazard\b|\bhazards\b|\bfailure mode\b|\brisk\b|\bwhat[-\s]?if\b/.test(k)) ?? Object.keys(idx)[0];
    const causeKey = Object.keys(idx).find(k => /\bcause\b|\bcausal factors?\b|\beffect\b|\bfailure modes?\b|\buca\b|\bunsafe control actions?\b|\bwhat[-\s]?if\s*scenarios?\b|\bdescription\b|\bconsequence\b/.test(k)) ?? Object.keys(idx)[1];
  
    return rows.map((r, i) => ({
      id: `HZ-${String(i+1).padStart(3,'0')}`,
      title: S(r[idx[nameKey]] ?? `Hazard ${i+1}`),
      detail: S(r[idx[causeKey]] ?? ""),
    }));
  }
  
/**
 * normalizeReqs prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param requirements Requirement records participating in this step.
 * @returns the value that the next step in this workflow consumes.
 */
  function normalizeReqs(requirements) {
    const arr = Array.isArray(requirements) ? requirements : [];
    return arr.map((r, i) => ({
      id: r.id || `REQ-${String(i+1).padStart(3,'0')}`,
      title: S(r.title || r.name || `Requirement ${i+1}`),
      text: S(r.text || r.description || r.title || ""),
      acceptance: S(r.acceptance || ""),
      module: S(r.module || ""),
      tag: S(r.tag || ""),
    }));
  }
  
/**
 * normalizeRisks prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param riskRegister Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  function normalizeRisks(riskRegister) {
    const arr = Array.isArray(riskRegister) ? riskRegister : [];
    return arr.map((x, i) => ({
      id: x.id || `RISK-${String(i+1).padStart(3,'0')}`,
      title: S(x.title || `Risk ${i+1}`),
      severity: Number(x.severity) || 0,
      likelihood: Number(x.likelihood) || 0,
      tags: S(x.tags || ""),
      status: S(x.status || ""),
    }));
  }
  
/**
 * rpn encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param lik Input consumed by this step of the xHandle workflow.
 * @param sev Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  const rpn = (lik, sev) => (Number(lik)||0) * (Number(sev)||0);
  
  /* ---------- Strategy helpers ---------- */
  function extractNumbers(text) {
    // crude number/min/max/within detection for boundary/temporal constraints
    const nums = [];
    const re = /(-?\d+\.?\d*)\s*(ms|s|sec|seconds|ms|msec|hz|%|ppm|°c|c|v|a|g|kg|kb|mb|gb|msps|bps|kbps|mbps)?/ig;
    let m;
    while ((m = re.exec(text)) !== null) {
      nums.push({ value: parseFloat(m[1]), unit: (m[2]||"").toLowerCase() });
    }
    return nums;
  }
  
/**
 * deriveTemporalProperty encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param req Express request object for the current API call.
 * @returns the value that the next step in this workflow consumes.
 */
  function deriveTemporalProperty(req) {
    // Micro-DSL: WHEN <trigger> THEN <response> WITHIN <t><unit>
    const text = (req.text || req.title).toLowerCase();
    const within = /within\s+(\d+)\s*(ms|milliseconds|s|sec|seconds)/i.exec(text);
    const tVal = within ? Number(within[1]) : null;
    const tUnit = within ? within[2].toLowerCase() : null;
    const trigger = /on\s+(fault|error|loss|timeout|over.*|under.*|drop|stall|reset)/i.exec(text)?.[0] || "trigger";
    const response = /enter\s+(safe|failsafe|degraded)|recover|retry|isolate|shed load/i.exec(text)?.[0] || "safe_state";
  
    if (!within) return null;
    return {
      type: "TEMPORAL",
      spec: {
        when: trigger,
        then: response,
        bound: { value: tVal, unit: tUnit },
        semantics: "MTL" // Metric Temporal Logic-style intent
      }
    };
  }
  
/**
 * pairwise encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param valuesA Input consumed by this step of the xHandle workflow.
 * @param valuesB Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  function pairwise(valuesA, valuesB) {
    const out = [];
    for (const a of valuesA) for (const b of valuesB) out.push([a,b]);
    return out;
  }
  
  /* ---------- Generators (per requirement) ---------- */
  function generatePerRequirement(req, linkedHazards, riskMap, options) {
    const tests = [];
    const rid = req.id;
  
    /* Priority from max linked hazard RPN */
    const maxRpn = Math.max(0, ...linkedHazards.map(h => rpn(riskMap.get(h)?.likelihood, riskMap.get(h)?.severity)));
    const priority = maxRpn >= 20 ? "Highest" : maxRpn >= 12 ? "High" : maxRpn >= 6 ? "Medium" : "Low";
  
    // 1) Nominal
    if (options.useNominal !== false) {
      tests.push({
        id: makeId(),
        kind: "NOMINAL",
        name: `Verify: ${req.title}`,
        priority,
        links: { requirementId: rid, hazardIds: linkedHazards },
        params: {},
        steps: [
          "Configure system in nominal state.",
          "Execute function under expected operating conditions.",
          "Record outputs and logs."
        ],
        oracle: { type: "ASSERT", rule: req.acceptance || "Meets stated performance and safety constraints." }
      });
    }
  
    // 2) Boundary/Robustness
    if (options.useBoundary !== false) {
      const nums = extractNumbers(req.text);
      const candidates = nums.slice(0, 2).map(n => n.value);
      const low = candidates[0] != null ? candidates[0]*0.9 : 0.9;
      const high = candidates[0] != null ? candidates[0]*1.1 : 1.1;
      tests.push({
        id: makeId(),
        kind: "BOUNDARY",
        name: `Boundary: ${req.title}`,
        priority,
        links: { requirementId: rid, hazardIds: linkedHazards },
        params: { sweep: [low, candidates[0] ?? 1.0, high] },
        steps: [
          "Sweep input parameter across boundary values.",
          "Monitor for error handling and stability.",
          "Record outputs and logs."
        ],
        oracle: { type: "NO_HAZARD", rule: "No entry into known hazardous states" }
      });
    }
  
    // 3) Pairwise (lightweight)
    if (options.usePairwise !== false) {
      const pA = ['min','nominal','max'];
      const pB = ['cold','room','hot'];
      const combos = pairwise(pA, pB);
      for (const [a,b] of combos.slice(0, options.pairwiseLimit ?? 6)) {
        tests.push({
          id: makeId(),
          kind: "PAIRWISE",
          name: `Pairwise: ${req.title} (${a},${b})`,
          priority,
          links: { requirementId: rid, hazardIds: linkedHazards },
          params: { amplitude: a, ambient: b },
          steps: [
            `Set amplitude=${a} and ambient=${b}.`,
            "Exercise function, record response."
          ],
          oracle: { type: "ASSERT", rule: req.acceptance || "Meets stated constraints." }
        });
      }
    }
  
    // 4) Fault Injection per linked hazard
    if (options.useFaults !== false && linkedHazards.length) {
      const lib = [
        { fault: "message_drop", description: "Drop 5% control messages" },
        { fault: "message_delay", description: "Inject 200ms latency jitter" },
        { fault: "sensor_bias", description: "Bias sensor +10%" },
        { fault: "stuck_at", description: "Hold actuator command at last value" },
        { fault: "out_of_range", description: "Feed extreme input beyond range" },
      ];
      for (const hz of linkedHazards.slice(0, options.faultsPerRequirement ?? 3)) {
        const pick = lib.slice(0, options.faultKinds ?? 2);
        for (const f of pick) {
          tests.push({
            id: makeId(),
            kind: "FAULT_INJECTION",
            name: `Fault: ${f.fault} → ${req.title}`,
            priority: "High", // faults are prioritized
            links: { requirementId: rid, hazardIds: [hz] },
            params: f,
            steps: [
              `Introduce fault: ${f.description}.`,
              "Observe safety monitors and response.",
              "Record logs/telemetry."
            ],
            oracle: { type: "SAFETY_GOAL", rule: "Fault detected, contained, or mitigated per design intent" }
          });
        }
      }
    }
  
    // 5) Temporal/Causal property
    const temporal = deriveTemporalProperty(req);
    if (options.useTemporal !== false && temporal) {
      tests.push({
        id: makeId(),
        kind: "TEMPORAL",
        name: `Temporal: ${req.title}`,
        priority,
        links: { requirementId: rid, hazardIds: linkedHazards },
        params: { property: temporal.spec },
        steps: [
          "Trigger precondition that should elicit the response.",
          `Verify response occurs within ${temporal.spec.bound.value}${temporal.spec.bound.unit}.`
        ],
        oracle: { type: "TEMPORAL", rule: temporal.spec }
      });
    }
  
    return tests;
  }
  
  /* ---------- Top-level suite generator ---------- */
  export function generateVnVSuite({ analysisResult, riskRegister, requirements, options = {} }) {
    const hazards = parseSummaryToHazards(analysisResult);
    const reqs = normalizeReqs(requirements);
    const risks = normalizeRisks(riskRegister);
  
    // Link hazards to requirements by fuzzy title/tag overlap
    const hazardsByTitle = new Map(hazards.map(h => [T(h.title), h.id]));
    const riskMap = new Map(risks.map(r => [r.id, r]));
    const hazardIdByRiskTitle = new Map(risks.map(r => [T(r.title), hazardsByTitle.get(T(r.title))]));
  
    const linkHazards = (req) => {
      const t = T(req.title + " " + req.text + " " + req.tag);
      const hits = [];
      for (const h of hazards) {
        if (t.includes(T(h.title))) hits.push(h.id);
      }
      for (const r of risks) {
        if (t.includes(T(r.title)) && hazardIdByRiskTitle.get(T(r.title))) {
          hits.push(hazardIdByRiskTitle.get(T(r.title)));
        }
      }
      return Array.from(new Set(hits));
    };
  
    // Generate tests
    const allTests = [];
    for (const req of reqs) {
      const hzLinks = linkHazards(req);
      const t = generatePerRequirement(req, hzLinks, riskMap, options);
      allTests.push(...t);
    }
  
    // Traceability rows
    const traceMatrix = allTests.map(t => ({
      TestId: t.id,
      Kind: t.kind,
      RequirementId: t.links.requirementId,
      HazardIds: (t.links.hazardIds || []).join(" | "),
      Priority: t.priority,
      OracleType: t.oracle?.type || "",
    }));
  
    // Procedures & datasets (placeholders, runner-ready)
    const procedures = [
      { id: "PROC-REGRESSION", name: "Regression - Safety Core", testIds: allTests.map(t => t.id) }
    ];
    const datasets = [
      { id: "DATA-NOMINAL-EDGE", name: "Nominal + Edge Inputs", description: "Synthesized parameter sweeps and fault profiles" }
    ];
  
    // Coverage
    const coveredReqs = new Set(allTests.map(t => t.links.requirementId));
    const coveredHaz = new Set(allTests.flatMap(t => t.links.hazardIds || []));
    const strategyCount = allTests.reduce((m, t) => { m[t.kind]=(m[t.kind]||0)+1; return m; }, {});
    const coverage = {
      requirements: { covered: coveredReqs.size, total: reqs.length },
      hazards: { covered: coveredHaz.size, total: hazards.length },
      byStrategy: strategyCount,
      gaps: {
        requirements: reqs.filter(r => !coveredReqs.has(r.id)).map(r => r.id),
        hazards: hazards.filter(h => !coveredHaz.has(h.id)).map(h => h.id),
      }
    };
  
    // Plan
    const plan = {
      title: `${options.projectName || "Project"} – Verification & Validation Plan`,
      version: "1.0",
      strategy: [
        "Risk-prioritized, multi-strategy generation (nominal, boundary, pairwise, fault-injection, temporal).",
        "Simulation-first; HIL optional via adapters.",
        "Evidence bundling with JUnit XML + JSON artifacts.",
      ],
      policy: [
        "Traceability Test ⇄ Requirement ⇄ Hazard must be maintained.",
        "Highest/High risk tests must pass to exit gate.",
      ],
      totals: {
        tests: allTests.length,
        requirements: reqs.length,
        hazards: hazards.length,
      }
    };
  
    // Evidence bundle (runnable schema for future runner integration)
    const evidence = {
      schema: "xhandle.vnv/1.0",
      generatedAt: new Date().toISOString(),
      procedures, datasets,
      tests: allTests,
      coverage, plan
    };
  
    return {
      tests: allTests,
      trace: traceMatrix,
      procedures,
      datasets,
      coverage,
      plan,
      evidence
    };
  }
  
  /* ---------- Exports ---------- */
  export function exportEvidenceJSON(bundle) {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vnv_evidence.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  
/**
 * exportJUnitXML encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param tests Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  export function exportJUnitXML(tests) {
    // Minimal JUnit suite with "skipped" status ready to be updated by a runner.
    const esc = (s) => S(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const cases = tests.map(t =>
      `  <testcase classname="${esc(t.kind)}" name="${esc(t.name)}" time="0">` +
      `    <skipped message="Not executed by runner yet" />` +
      `  </testcase>`
    ).join("\n");
    const xml =
  `<?xml version="1.0" encoding="UTF-8"?>
  <testsuite name="xHandle VnV" tests="${tests.length}" failures="0" errors="0" skipped="${tests.length}">
  ${cases}
  </testsuite>`;
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vnv_junit.xml";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  
