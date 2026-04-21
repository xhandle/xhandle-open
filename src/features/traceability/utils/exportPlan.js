/**
 * xHandle: export plan traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

// src/components/utils/aiPlanGen.js
import { backendURL, buildAIAuthOpts } from "../../../lib/api/backendConfig";

/**
 * AI-powered Test Plan generator.
 * Mirrors the JSON-first LLM integration pattern from utils/aiPm.js and aiTestGen.
 * Produces a rich, structured plan + helpers to export as JSON or Markdown.
 */

export async function generateTestPlan({ projectName, tests, requirements, riskRegister, context }) {
    const sys = {
      role: "system",
      content: [
        "You are a senior QA/Test Manager specializing in risk-driven, regulated systems.",
        "Return concise, VALID JSON. No preamble. No commentary outside JSON.",
        "Your plan should be realistic and directly actionable for a cross-functional team.",
      ].join(" "),
    };
  
    // Build deterministic, compact inputs (cap at ~20k chars)
    const safe = (x) => {
      try { return JSON.stringify(x).slice(0, 20000); } catch { return "[]"; }
    };
  
    // Helpful aggregates for the model
    const aggregates = aggregateTests(tests || []);
  
    const userContent = `
  Return JSON with EXACT keys:
  {
    "version": "v1",
    "generatedAt": string,
    "project": { "name": string },
    "objectives": [string],
    "scope": { "inScope": [string], "outOfScope": [string] },
    "strategies": [
      {
        "kind": "Nominal" | "Boundary" | "Pairwise" | "Fault Injection" | "Temporal" | "Exploratory" | "Performance" | "Security" | "Reliability" | "Other",
        "approach": string,
        "selectionHeuristics": [string],
        "dataStrategy": [string],
        "oracleStrategy": [string],
        "exitCriteria": [string]
      }
    ],
    "environments": [
      { "name": string, "setup": [string], "data": [string], "tools": [string], "constraints": [string] }
    ],
    "schedule": {
      "milestones": [
        { "name": string, "start": string, "end": string, "owner": string, "deliverables": [string] }
      ],
      "cadence": { "ci": boolean, "nightly": boolean, "regressionWeekly": boolean }
    },
    "roles": [
      { "role": string, "owner": string, "responsibilities": [string] }
    ],
    "entryExit": {
      "entry": [string],
      "exit": [string]
    },
    "riskMitigations": [
      { "risk": string, "mitigation": string, "owner": string, "due": string }
    ],
    "reporting": {
      "dashboards": [string],
      "metrics": [ "Requirements Coverage %", "Hazard Coverage %", "Pass Rate %", "MTTR", "Defect Leakage %", "Flake Rate %", "Time to Triage (h)" ],
      "communication": [string]
    },
    "resources": {
      "peopleDays": number,
      "environments": number,
      "budgetEstimate": string
    },
    "planItems": [
      {
        "id": string,
        "title": string,
        "requirementId": string | null,
        "tests": [string],
        "priority": "P0" | "P1" | "P2",
        "estimateDays": number,
        "dependencies": [string]
      }
    ],
    "traceability": {
      "coverage": {
        "requirements": { "total": number, "covered": number },
        "hazards": { "total": number, "covered": number }
      },
      "byRequirement": [
        { "requirementId": string, "testIds": [string] }
      ]
    },
    "assumptions": [string],
    "notes": [string]
  }
  
  Context to use:
  Project: ${projectName || "Project"}
  Aggregates: ${safe(aggregates)}
  Requirements (sampled or full): ${safe((requirements || []).slice(0, 500))}
  Hazards (risk register): ${safe((riskRegister || []).slice(0, 500))}
  TestCases (first 300): ${safe((tests || []).slice(0, 300))}
  System Context: ${context || ""}
  `.trim();
  
    // Call your server proxy (same pattern as utils/aiPm.js)
    const resp = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [sys, { role: "user", content: userContent }],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });
  
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      throw new Error(`LLM proxy error (${resp.status}): ${errTxt}`);
    }
  
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const json = safeParseJson(extractJson(raw));
  
    // Minimal guardrails / fill-ins
    return {
      version: json.version || "v1",
      generatedAt: json.generatedAt || new Date().toISOString(),
      project: json.project || { name: projectName || "Project" },
      objectives: json.objectives || [],
      scope: json.scope || { inScope: [], outOfScope: [] },
      strategies: json.strategies || [],
      environments: json.environments || [],
      schedule: json.schedule || { milestones: [], cadence: { ci: true, nightly: true, regressionWeekly: true } },
      roles: json.roles || [],
      entryExit: json.entryExit || { entry: [], exit: [] },
      riskMitigations: json.riskMitigations || [],
      reporting: json.reporting || { dashboards: [], metrics: [], communication: [] },
      resources: json.resources || { peopleDays: 0, environments: 1, budgetEstimate: "$0" },
      planItems: json.planItems || [],
      traceability: json.traceability || {
        coverage: { requirements: { total: 0, covered: 0 }, hazards: { total: 0, covered: 0 } },
        byRequirement: [],
      },
      assumptions: json.assumptions || [],
      notes: json.notes || [],
    };
  }
  
  // ---------- helpers ----------
  
  function safeParseJson(txt) {
    try { return JSON.parse(txt); } catch { return {}; }
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
 * aggregateTests encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param tests Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  function aggregateTests(tests) {
    const total = tests.length;
    const byKind = {};
    const byReq = new Map();
    const priorities = { P0: 0, P1: 0, P2: 0 };
  
    for (const t of tests) {
      if (t.kind) byKind[t.kind] = (byKind[t.kind] || 0) + 1;
      const p = String(t.priority || "P2").toUpperCase();
      if (priorities[p] !== undefined) priorities[p] += 1;
  
      const rid = t?.links?.requirementId || null;
      if (rid) {
        if (!byReq.has(rid)) byReq.set(rid, []);
        byReq.get(rid).push(t.id);
      }
    }
  
    const byRequirement = Array.from(byReq.entries()).map(([requirementId, testIds]) => ({ requirementId, testIds }));
    return { total, byKind, priorities, byRequirement };
  }
  
  // ---------- export helpers ----------
  export function exportTestPlanJSON(plan) {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    download(url, `${(plan?.project?.name || "test-plan").replace(/\s+/g, "_")}_plan.json`);
    URL.revokeObjectURL(url);
  }
  
/**
 * exportTestPlanMarkdown encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param plan Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  export function exportTestPlanMarkdown(plan) {
    const md = toMarkdown(plan);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    download(url, `${(plan?.project?.name || "test-plan").replace(/\s+/g, "_")}_plan.md`);
    URL.revokeObjectURL(url);
  }
  
/**
 * download encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param url Input consumed by this step of the xHandle workflow.
 * @param filename Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  function download(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  
/**
 * toMarkdown encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param plan Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function toMarkdown(plan) {
  const h = (txt) => `## ${txt}\n`;
  const h3 = (txt) => `### ${txt}\n`;
  
    let out = `# Test Plan — ${plan?.project?.name || "Project"}\n\n`;
    out += `Generated: ${plan?.generatedAt || new Date().toISOString()}\n\n`;
  
    if (plan.objectives?.length) {
      out += h("Objectives");
      plan.objectives.forEach((o) => (out += `- ${o}\n`));
      out += "\n";
    }
  
    out += h("Scope");
    out += h3("In Scope");
    (plan.scope?.inScope || []).forEach((s) => (out += `- ${s}\n`));
    out += "\n";
    out += h3("Out of Scope");
    (plan.scope?.outOfScope || []).forEach((s) => (out += `- ${s}\n`));
    out += "\n";
  
    if (plan.strategies?.length) {
      out += h("Strategies");
      plan.strategies.forEach((s) => {
        out += `- **${s.kind}**\n`;
        if (s.approach) out += `  - Approach: ${s.approach}\n`;
        if (s.selectionHeuristics?.length) out += `  - Selection: ${s.selectionHeuristics.join("; ")}\n`;
        if (s.dataStrategy?.length) out += `  - Data: ${s.dataStrategy.join("; ")}\n`;
        if (s.oracleStrategy?.length) out += `  - Oracles: ${s.oracleStrategy.join("; ")}\n`;
        if (s.exitCriteria?.length) out += `  - Exit: ${s.exitCriteria.join("; ")}\n`;
      });
      out += "\n";
    }
  
    if (plan.environments?.length) {
      out += h("Environments");
      plan.environments.forEach((e) => {
        out += `- **${e.name}**\n`;
        if (e.setup?.length) out += `  - Setup: ${e.setup.join("; ")}\n`;
        if (e.data?.length) out += `  - Data: ${e.data.join("; ")}\n`;
        if (e.tools?.length) out += `  - Tools: ${e.tools.join("; ")}\n`;
        if (e.constraints?.length) out += `  - Constraints: ${e.constraints.join("; ")}\n`;
      });
      out += "\n";
    }
  
    if (plan.schedule?.milestones?.length) {
      out += h("Schedule & Milestones");
      plan.schedule.milestones.forEach((m) => {
        out += `- **${m.name}** (${m.start} → ${m.end}) • Owner: ${m.owner}\n`;
        if (m.deliverables?.length) out += `  - Deliverables: ${m.deliverables.join("; ")}\n`;
      });
      out += "\n";
    }
  
    if (plan.roles?.length) {
      out += h("Roles & Responsibilities");
      plan.roles.forEach((r) => {
        out += `- **${r.role}** — ${r.owner}\n`;
        if (r.responsibilities?.length) out += `  - ${r.responsibilities.join("\n  - ")}\n`;
      });
      out += "\n";
    }
  
    if (plan.entryExit) {
      out += h("Entry / Exit Criteria");
      out += h3("Entry");
      (plan.entryExit.entry || []).forEach((x) => (out += `- ${x}\n`));
      out += "\n";
      out += h3("Exit");
      (plan.entryExit.exit || []).forEach((x) => (out += `- ${x}\n`));
      out += "\n";
    }
  
    if (plan.riskMitigations?.length) {
      out += h("Risk Mitigations");
      plan.riskMitigations.forEach((r) => {
        out += `- **${r.risk}** → ${r.mitigation} (Owner: ${r.owner}, Due: ${r.due})\n`;
      });
      out += "\n";
    }
  
    if (plan.reporting) {
      out += h("Reporting & Communication");
      if (plan.reporting.metrics?.length) out += `- Metrics: ${plan.reporting.metrics.join("; ")}\n`;
      if (plan.reporting.dashboards?.length) out += `- Dashboards: ${plan.reporting.dashboards.join("; ")}\n`;
      if (plan.reporting.communication?.length) out += `- Communication: ${plan.reporting.communication.join("; ")}\n`;
      out += "\n";
    }
  
    if (plan.resources) {
      out += h("Resource Estimate");
      out += `- People-days: ${plan.resources.peopleDays}\n`;
      out += `- Environments: ${plan.resources.environments}\n`;
      out += `- Budget: ${plan.resources.budgetEstimate}\n\n`;
    }
  
    if (plan.planItems?.length) {
      out += h("Plan Items (Work Packages)");
      plan.planItems.forEach((p) => {
        out += `- **${p.id} — ${p.title}** [${p.priority}] • ${p.estimateDays}d\n`;
        if (p.requirementId) out += `  - Requirement: ${p.requirementId}\n`;
        if (p.tests?.length) out += `  - Tests: ${p.tests.join(", ")}\n`;
        if (p.dependencies?.length) out += `  - Dependencies: ${p.dependencies.join(", ")}\n`;
      });
      out += "\n";
    }
  
    if (plan.traceability) {
      out += h("Traceability Summary");
      const c = plan.traceability.coverage || {};
      out += `- Requirements Coverage: ${c.requirements?.covered || 0} / ${c.requirements?.total || 0}\n`;
      out += `- Hazards Coverage: ${c.hazards?.covered || 0} / ${c.hazards?.total || 0}\n`;
      out += "\n";
    }
  
    if (plan.assumptions?.length) {
      out += h("Assumptions");
      plan.assumptions.forEach((a) => (out += `- ${a}\n`));
      out += "\n";
    }
  
    if (plan.notes?.length) {
      out += h("Notes");
      plan.notes.forEach((n) => (out += `- ${n}\n`));
      out += "\n";
    }
  
    return out;
  }
  
  
