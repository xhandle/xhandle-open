/**
 * xHandle: ai plan gen traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

// src/components/utils/aiPlanGen.js
import { backendURL, buildAIAuthOpts } from "../../../lib/api/backendConfig";
import { logger } from "../../../lib/utils/logger";

// This mirrors your backend-proxied JSON-only chat style (see aiPm.js).
// It turns a set of generated tests + project context into a full test plan.

export async function generateTestPlan(payload) {
    const {
      projectName = "Project",
      tests = [],
      requirements = [],
      riskRegister = [],
      envMatrix = defaultEnvMatrix(),
      schedule = defaultSchedule(),
      reporting = defaultReporting(),
      tooling = defaultTooling(),
      staffing = defaultStaffing(),
      entryExit = defaultEntryExit(),
      constraints = {},
      notes = "",
    } = payload || {};
  
    const sys = {
      role: "system",
      content:
        "You are a senior QA/Test Architect. Produce rigorous, *concise* and *actionable* enterprise test plans. Always return valid JSON. Prefer bullets and tables. Use ISO-like clarity.",
    };
  
    // Keep request compact but informative. We’ll give the LLM structured slices.
    const userContent = `
  Return JSON using this schema:
  
  {
    "summary": string,
    "objectives": [string],
    "scope": {
      "in": [string],
      "out": [string]
    },
    "approach": {
      "strategies": [string],                     // e.g., Nominal, Boundary, Pairwise, Fault Injection, Temporal
      "testDesign": [string],                     // how tests are derived
      "data": [string],                           // datasets / synthetic data strategy
      "oracles": [string]                         // acceptance criteria approach
    },
    "environments": [ { "name": string, "config": [string] } ],
    "schedule": [ { "phase": string, "start": string, "end": string, "deliverables": [string] } ],
    "traceability": [ { "requirementId": string, "tests": [string] } ],
    "risks": [ { "risk": string, "mitigations": [string] } ],
    "entryExit": {
      "entry": [string],
      "exit": [string]
    },
    "staffing": [ { "role": string, "responsibilities": [string] } ],
    "tooling": [ { "tool": string, "purpose": string } ],
    "reporting": {
      "cadence": string,
      "channels": [string],
      "dashboards": [string],
      "metrics": [string]
    },
    "signoff": [ { "owner": string, "area": string } ],
    "appendix": [string]
  }
  
  Rules:
  - Ground the plan in the provided tests (kinds, priorities, oracles, links).
  - Prioritize hazards/requirements with higher risk.
  - Be specific and avoid fluff. Use consistent IDs from inputs.
  - Use ISO-8601 dates already provided in schedule; if none, propose a reasonable 2–4 week window.
  - Keep each array between 3 and 12 items where sensible.
  
  Context:
  Project: ${projectName}
  Requirements: ${safe(requirements)}
  RiskRegister: ${safe(riskRegister)}
  
  GeneratedTests (cap 200): ${safe(tests.slice(0, 200))}
  
  PreferredEnvironmentMatrix: ${safe(envMatrix)}
  PreferredSchedule: ${safe(schedule)}
  PreferredReporting: ${safe(reporting)}
  PreferredTooling: ${safe(tooling)}
  PreferredStaffing: ${safe(staffing)}
  EntryExitCriteria: ${safe(entryExit)}
  Constraints: ${safe(constraints)}
  StakeholderNotes: ${truncate(notes, 4000)}
  `.trim();
  
    const requestInit = {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [sys, { role: "user", content: userContent }],
        temperature: 0.2,
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
      const err = await resp.text().catch(() => "");
      throw new Error(`LLM proxy error (${resp.status}): ${err}`);
    }
  
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
  
    try {
      return JSON.parse(extractJson(raw));
    } catch {
      return { summary: String(raw).slice(0, 800) };
    }
  }
  
  // --------- sensible defaults / helpers ----------
  
  export function defaultEnvMatrix() {
    return [
      { name: "CI", config: ["Headless", "Ephemeral DB", "Feature flags: safe"] },
      { name: "Staging", config: ["Prod-like", "External integrations mocked where needed"] },
      { name: "Pre-Prod", config: ["Prod parity", "Data mask", "Blue/Green capability"] },
    ];
  }
  
/**
 * defaultSchedule encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
  export function defaultSchedule() {
    // ~3 weeks default
    const today = new Date();
    const plusDays = (d) => new Date(today.getTime() + d * 86400000).toISOString().slice(0, 10);
    return [
      { phase: "Planning", start: plusDays(0), end: plusDays(2), deliverables: ["Test Plan v1", "Entry criteria agreed"] },
      { phase: "Design & Data", start: plusDays(2), end: plusDays(6), deliverables: ["Datasets prepared", "Oracles refined"] },
      { phase: "Execution", start: plusDays(6), end: plusDays(17), deliverables: ["Daily runs", "Defects triage"] },
      { phase: "Closure", start: plusDays(17), end: plusDays(21), deliverables: ["Summary report", "Exit criteria signoff"] },
    ];
  }
  
/**
 * defaultReporting encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
  export function defaultReporting() {
    return {
      cadence: "Daily standup + twice-weekly QA summary",
      channels: ["Slack #qa", "Email to stakeholders"],
      dashboards: ["Coverage", "Pass/Fail trends", "Defect aging"],
      metrics: ["Req coverage %", "Hazard coverage %", "MTTR defects", "Flaky tests", "Escapes"],
    };
  }
  
/**
 * defaultTooling encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
  export function defaultTooling() {
    return [
      { tool: "CI Orchestrator", purpose: "Scheduled/On-demand runs" },
      { tool: "JUnit/XML", purpose: "Results interchange" },
      { tool: "Allure/ReportPortal", purpose: "Explorable test reports & trends" },
      { tool: "Tracing/Observability", purpose: "Root cause and performance" },
    ];
  }
  
/**
 * defaultStaffing encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
  export function defaultStaffing() {
    return [
      { role: "QA Lead", responsibilities: ["Plan ownership", "Risk triage", "Stakeholder comms"] },
      { role: "SDET", responsibilities: ["Framework", "Data generation", "Automation maintenance"] },
      { role: "Domain QA", responsibilities: ["Scenario vetting", "Exploratory sessions"] },
    ];
  }
  
/**
 * defaultEntryExit encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
  export function defaultEntryExit() {
    return {
      entry: ["Test environment available", "Critical paths implemented", "Risk register up to date"],
      exit: ["≥95% high-priority tests passing", "No Sev-1 open defects", "Stakeholder signoff"],
    };
  }
  
/**
 * safe encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param x Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  function safe(x) {
    try {
      return JSON.stringify(x).slice(0, 25000);
    } catch {
      return "[]";
    }
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
 * truncate encapsulates a focused piece of traceability and V&V workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param s Input consumed by this step of the xHandle workflow.
 * @param n Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
  function truncate(s, n) {
    return (s || "").slice(0, n);
  }
  
  // --- add below your existing exports in src/components/utils/aiPlanGen.js ---

function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  
  // Export: JSON
  export function exportTestPlanJSON(plan, filename = "test-plan.json") {
    try {
      const pretty = JSON.stringify(plan, null, 2);
      downloadBlob(pretty, filename, "application/json");
    } catch (e) {
      logger.error("exportTestPlanJSON failed", e);
      alert("Could not export Test Plan JSON.");
    }
  }
  
  // Export: Markdown
  export function exportTestPlanMarkdown(plan, filename = "test-plan.md") {
    try {
      // defensively read fields (plan schema may vary)
      const title = plan?.meta?.title || plan?.title || "Test Plan";
      const project = plan?.meta?.project || plan?.projectName || "Project";
      const version = plan?.meta?.version || plan?.version || "v1";
      const owner = plan?.meta?.owner || plan?.owner || "QA Lead";
      const date = new Date().toISOString().split("T")[0];
  
      const objectives = Array.isArray(plan?.objectives) ? plan.objectives : [];
      const scopeIn = Array.isArray(plan?.scope?.in) ? plan.scope.in : [];
      const scopeOut = Array.isArray(plan?.scope?.out) ? plan.scope.out : [];
  
      const entry = plan?.entryExit?.entry || [];
      const exit = plan?.entryExit?.exit || [];
  
      const schedule = Array.isArray(plan?.schedule?.milestones) ? plan.schedule.milestones : [];
      const environments = Array.isArray(plan?.environments) ? plan.environments : [];
      const staffing = Array.isArray(plan?.staffing?.roles) ? plan.staffing.roles : [];
      const tooling = Array.isArray(plan?.tooling) ? plan.tooling : [];
      const reporting = Array.isArray(plan?.reporting) ? plan.reporting : [];
      const risks = Array.isArray(plan?.risks) ? plan.risks : [];
      const coverage = plan?.coverage || {};
      const strategies = Array.isArray(plan?.strategies) ? plan.strategies : [];
  
      const md = [
        `# ${title}`,
        ``,
        `**Project:** ${project}  `,
        `**Version:** ${version}  `,
        `**Owner:** ${owner}  `,
        `**Generated:** ${date}`,
        ``,
        `## 1. Objectives`,
        ...(objectives.length ? objectives.map((o) => `- ${o}`) : ["- Define, execute, and report on test activities."]),
        ``,
        `## 2. Scope`,
        `### In-Scope`,
        ...(scopeIn.length ? scopeIn.map((s) => `- ${s}`) : ["- Core functional requirements"]),
        ``,
        `### Out-of-Scope`,
        ...(scopeOut.length ? scopeOut.map((s) => `- ${s}`) : ["- Non-functional areas explicitly excluded"]),
        ``,
        `## 3. Entry & Exit Criteria`,
        `### Entry`,
        ...(entry.length ? entry.map((e) => `- ${e}`) : ["- Requirements baseline approved"]),
        ``,
        `### Exit`,
        ...(exit.length ? exit.map((e) => `- ${e}`) : ["- Critical defects resolved; coverage targets met"]),
        ``,
        `## 4. Strategies`,
        ...(strategies.length ? strategies.map((s) => `- ${s}`) : ["- Risk-based prioritization", "- Boundary/Pairwise", "- Fault Injection", "- Temporal/Sequence"]),
        ``,
        `## 5. Schedule & Milestones`,
        ...(schedule.length
          ? schedule.map((m) => `- ${m.when ? `**${m.when}** — ` : ""}${m.title || m.name || "Milestone"}`)
          : ["- Iteration 1 Complete", "- Test Execution Complete", "- Sign-off"]),
        ``,
        `## 6. Environments`,
        ...(environments.length
          ? environments.map((e) => `- ${e.name || e.env || "Env"}: ${e.details || e.notes || ""}`)
          : ["- CI: Linux, Node LTS", "- Staging: k8s cluster, prod-like data"]),
        ``,
        `## 7. Staffing`,
        ...(staffing.length
          ? staffing.map((r) => `- ${r.role || "Role"}: ${r.owner || r.name || "TBD"} (${r.capacity || "100%"})`)
          : ["- QA Lead: TBD", "- SDET: TBD", "- Manual QA: TBD"]),
        ``,
        `## 8. Tooling`,
        ...(tooling.length
          ? tooling.map((t) => `- ${t.name || "Tool"}: ${t.purpose || ""}`)
          : ["- Test Runner", "- CI/CD", "- Defect Tracking", "- Coverage Analyzer"]),
        ``,
        `## 9. Reporting`,
        ...(reporting.length
          ? reporting.map((r) => `- ${r.metric || r.name || "Metric"}: ${r.frequency || "per build"}`)
          : ["- Pass/Fail per build", "- Defect aging weekly", "- Coverage trend per sprint"]),
        ``,
        `## 10. Risk & Coverage`,
        `**Requirements:** ${coverage?.requirements?.covered ?? 0} / ${coverage?.requirements?.total ?? 0}`,
        `**Hazards:** ${coverage?.hazards?.covered ?? 0} / ${coverage?.hazards?.total ?? 0}`,
        ``,
        `### Top Risks`,
        ...(risks.length
          ? risks.map((rk) => `- ${rk.id ? `**${rk.id}** — ` : ""}${rk.title || rk.name || "Risk"} (S:${rk.severity ?? "?"} × L:${rk.likelihood ?? "?"})`)
          : ["- None recorded"]),
        ``,
        `## 11. Approvals`,
        `- QA Lead: ____________________`,
        `- Engineering Lead: ____________________`,
        `- Product Owner: ____________________`,
        ``,
      ].join("\n");
  
      downloadBlob(md, filename, "text/markdown");
    } catch (e) {
      logger.error("exportTestPlanMarkdown failed", e);
      alert("Could not export Test Plan Markdown.");
    }
  }
  
