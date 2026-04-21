/**
 * xHandle: xagent center agent workspace.
 * This file is part of the agent-facing experience that lets xHandle coordinate engineering tasks, task state, and specialized panels around AI-assisted work.
 * The agent layer experiments with longer-running or role-oriented assistance while still keeping the rest of the application in control of project context and persisted artifacts.
 * Related files: src/agents/AgentRuntime.js, src/agents/AgentMonitor.js, src/components/agentController.js, src/features/agents/xAgent/XAgentCenter.jsx.
 */

// src/components/xAgent/XAgentCenter.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lightbulb, X } from "lucide-react";

/**
 * xAgent — Continuous Engineering Collaborator
 * Sensors -> Observations -> Planner (Skills) -> Tasks -> Actions
 * ----------------------------------------------------------------
 * Sensors (events / hooks):
 *   • xhandle:repo:pushed         { projectId, branch, commitId, changedFiles[] }
 *   • xhandle:docs:changed        { projectId, docId, path, changeType }
 *   • xhandle:model:changed       { projectId, modelId, change }
 *   • xhandle:code:coverage       { projectId, coveragePct }
 *   • xhandle:reqs:edited         { projectId, count }
 *
 * Emits:
 *   "xhandle:xagent:decompose-architecture"   { projectId, sources }
 *   "xhandle:xagent:generate-requirements"    { projectId, scope }
 *   "xhandle:xagent:traceability-sync"        { projectId }
 *   "xhandle:xagent:run-analysis"             { projectId, method }
 *   "xhandle:xagent:refresh-diagram"          { projectId, view }
 *   "xhandle:xagent:code-impact"              { projectId, commitId, files }
 *   "xhandle:xagent:generate-mitigations"     { projectId, riskId }
 *   "xhandle:xagent:normalize-risk"           { projectId, riskId, op }
 */

// ——— constants
const STORAGE_ENABLED   = "xhandle.xAgent.enabled";
const STORAGE_DONE      = "xhandle.xAgent.completed";
const STORAGE_IGNORED   = "xhandle.xAgent.ignored";
const STORAGE_COOLDOWN  = "xhandle.xAgent.cooldowns";
const STORAGE_OBS_QUEUE = "xhandle.xAgent.observations";
const STORAGE_AUTORUN   = "xhandle.xAgent.autoRun";

const AGENT_LOOP_MS = 12000;

const MAX_SUGGESTIONS_TOTAL = 6;
const MAX_PER_PROJECT = 2;
const MAX_PER_CATEGORY = 2;

const COOLDOWN_MS = {
  runAnalysis:       3 * 60 * 60 * 1000,
  refreshDiagram:   24 * 60 * 60 * 1000,
  autoMitigate:      6 * 60 * 60 * 1000,
  assignOwner:       6 * 60 * 60 * 1000,
  traceSync:        12 * 60 * 60 * 1000,
  reqsGenerate:      6 * 60 * 60 * 1000,
  codeImpact:        3 * 60 * 60 * 1000,
  decompose:        12 * 60 * 60 * 1000,
};

const RPN_STRONG_THRESHOLD = 20;
const OVERDUE_STRONG_DAYS  = 3;

// ——— safe storage helpers
const safeParse = (raw, fallback) => {
  try { return JSON.parse(raw); } catch { return fallback; }
};
/**
 * readLS renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param key Input consumed by this step of the xHandle workflow.
 * @param fallback Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const readLS = (key, fallback) =>
  typeof window === "undefined" ? fallback : safeParse(window.localStorage.getItem(key), fallback);
/**
 * writeLS renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param key Input consumed by this step of the xHandle workflow.
 * @param value Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const writeLS = (key, value) => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
};
/**
 * removeLS renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param key Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const removeLS = (key) => {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch {}
};

// ——— tiny utils
const asArray  = (v) => Array.isArray(v) ? v : [];
/**
 * asObject renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};

/**
 * rpnOf renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param r Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const rpnOf = (r) => (Number(r?.likelihood) || 0) * (Number(r?.severity) || 0);
/**
 * daysUntil renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param dateStr Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const daysUntil = (dateStr) => {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (Number.isNaN(+d)) return Infinity;
  return Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
};
/**
 * short renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param s Input consumed by this step of the xHandle workflow.
 * @param n Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const short = (s, n = 140) => (s || "").slice(0, n);
/**
 * hasNonEmptyMapping renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param m Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const hasNonEmptyMapping = (m) => {
  if (!m || typeof m !== "object") return false;
  for (const k in m) {
    if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
    const v = m[k];
    if (Array.isArray(v) ? v.length > 0 : !!v) return true;
  }
  return false;
};
/**
 * projectName renders a React component. It gives users access to agent-oriented task execution and monitoring while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param projects Input consumed by this step of the xHandle workflow.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const projectName = (projects, id) =>
  projects.find((p) => p.id === id)?.name || `Project ${id}`;

// ——— main component
export default function XAgentCenter({
  projects = [],
  readProjectMap, // () => { [projectId]: { responseRows, analysisResult, riskRegister, requirements?, tests?, trace?, hazardMethod? } }
  setSection,
  setActiveProjectId,
  setActiveTab,
  lsTick,
  analysisResult,
  perform, // optional task executor override
}) {
  // UI state
  const [open, setOpen] = useState(false);
  const [modalItem, setModalItem] = useState(null);
  const [autoRun, setAutoRun] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_AUTORUN) || "false"); } catch { return false; }
  });
  const autoRunRef = useRef(autoRun);
  useEffect(() => { autoRunRef.current = autoRun; }, [autoRun]);
  
  // enabled toggle
  const [enabled, setEnabled] = useState(() => {
    const v = readLS(STORAGE_ENABLED, true);
    return typeof v === "boolean" ? v : true;
  });
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // logs
  const [log, setLog] = useState([]);
  const appendLog = useCallback((entry) => {
    setLog((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  // persisted sets/objects
  const completedRef = useRef(new Set(asArray(readLS(STORAGE_DONE, []))));
  const ignoredRef   = useRef(new Set(asArray(readLS(STORAGE_IGNORED, []))));
  const cooldownRef  = useRef(asObject(readLS(STORAGE_COOLDOWN, {})));
  const obsRef       = useRef(asArray(readLS(STORAGE_OBS_QUEUE, [])));

  const [version, setVersion] = useState(0); // single bump key for reactivity
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // persist helpers
  const markDone = useCallback((id) => {
    completedRef.current.add(id);
    writeLS(STORAGE_DONE, [...completedRef.current]);
    bump();
  }, [bump]);

  const isDone = useCallback((id) => completedRef.current.has(id), []);
  const getIgnoredArray = useCallback(() => [...ignoredRef.current], []);

  const ignoreTask = useCallback((id) => {
    ignoredRef.current.add(id);
    writeLS(STORAGE_IGNORED, [...ignoredRef.current]);
    bump();
  }, [bump]);

  const unignoreTask = useCallback((id) => {
    ignoredRef.current.delete(id);
    writeLS(STORAGE_IGNORED, [...ignoredRef.current]);
    bump();
  }, [bump]);

  const underCooldown = useCallback((taskId, key) => {
    const last = cooldownRef.current[taskId];
    if (!last) return false;
    const win = COOLDOWN_MS[key] || 0;
    return win > 0 && (Date.now() - last) < win;
  }, []);

  const stampCooldown = useCallback((taskId) => {
    cooldownRef.current[taskId] = Date.now();
    writeLS(STORAGE_COOLDOWN, cooldownRef.current);
    bump();
  }, [bump]);

  const persistObs = useCallback(() => {
    writeLS(STORAGE_OBS_QUEUE, obsRef.current.slice(-200));
    bump();
  }, [bump]);

  const pushObservation = useCallback((obs) => {
    const o = {
      id: `obs:${(obs?.projectId || "global")}:${obs?.type || "unknown"}:${Date.now()}:${Math.random()
        .toString(36)
        .slice(2)}`,
      ts: Date.now(),
      ...obs,
    };
    obsRef.current.push(o);
    persistObs();
    appendLog({ ts: Date.now(), level: "info", msg: `👀 Observation: ${obs.type} (${obs.projectId || "global"})` });
  }, [appendLog, persistObs]);

  // expose API for external emitters
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.xAgent = window.xAgent || {};
    window.xAgent.pushObservation = pushObservation;
  }, [pushObservation]);

  // wire sensors
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mk = (type) => (e) => pushObservation({ type, ...(e?.detail || {}) });
    const handlers = [
      ["xhandle:repo:pushed", mk("repo:pushed")],
      ["xhandle:docs:changed", mk("docs:changed")],
      ["xhandle:model:changed", mk("model:changed")],
      ["xhandle:code:coverage", mk("code:coverage")],
      ["xhandle:reqs:edited", mk("reqs:edited")],
      ["xhandle:data-changed", () => bump()],
    ];
    handlers.forEach(([evt, fn]) => window.addEventListener(evt, fn));
    return () => handlers.forEach(([evt, fn]) => window.removeEventListener(evt, fn));
  }, [bump, pushObservation]);

  // recompute key: only when relevant inputs change
  const recomputeKey = useMemo(
    () => JSON.stringify([lsTick ?? null, !!analysisResult, projects.length, version]),
    [lsTick, analysisResult, projects.length, version]
  );

  // plan tasks
  const rawTasks = useMemo(() => {
    const map = (typeof readProjectMap === "function" ? readProjectMap() : {}) || {};
    /** @type {Array<{id,key,kind,priority,title,summary,context,action,auto,scoreHints}>} */
    const out = [];

    for (const p of projects) {
      const pd = map?.[p.id] || {};
      const risks = Array.isArray(pd.riskRegister) ? pd.riskRegister : [];
      const hasDecomp = Array.isArray(pd.responseRows) && pd.responseRows.length > 0;
      const hasSummary = !!pd?.analysisResult?.Summary?.length;
      const requirements = Array.isArray(pd.requirements) ? pd.requirements : [];
      const trace = pd.trace || {};

      // 1) Run analysis if decomposition exists but no summary
      if (hasDecomp && !hasSummary) {
        out.push({
          id: `runAnalysis:${p.id}`,
          key: "runAnalysis",
          kind: "Analysis",
          priority: "high",
          title: `Run hazard analysis for ${p.name}`,
          summary: "Decomposition present but no analysis summary; kick off FMEA/STPA hybrid.",
          context: { projectId: p.id },
          action: { type: "run-analysis", projectId: p.id, method: pd?.hazardMethod || "FMEA" },
          auto: true,
          scoreHints: { impact: 0.9, confidence: 0.95, novelty: 0.8 },
        });
      }

      // 2) Refresh diagram if summary exists
      if (hasSummary) {
        const sumLen = pd?.analysisResult?.Summary?.length || 0;
        out.push({
          id: `refreshDiagram:${p.id}:${sumLen}`,
          key: "refreshDiagram",
          kind: "Diagram",
          priority: "info",
          title: `Refresh risk diagram for ${p.name}`,
          summary: "Keep visualizations in sync with latest analysis.",
          context: { projectId: p.id },
          action: { type: "refresh-diagram", projectId: p.id, view: "Risk" },
          auto: true,
          scoreHints: { impact: 0.5, confidence: 0.9, novelty: 0.5 },
        });
      }

      // 3) Traceability gaps
      const hasReqs = requirements.length > 0;
      const missingReqToRisk = hasReqs && !hasNonEmptyMapping(trace?.reqToRisk);
      const missingRiskToTest = (risks.length > 0) && !hasNonEmptyMapping(trace?.riskToTest);
      if (missingReqToRisk || missingRiskToTest) {
        out.push({
          id: `traceSync:${p.id}:${Number(missingReqToRisk)}:${Number(missingRiskToTest)}`,
          key: "traceSync",
          kind: "Traceability",
          priority: "high",
          title: `Sync trace links in ${p.name}`,
          summary: `${missingReqToRisk ? "Req→Risk" : ""}${missingReqToRisk && missingRiskToTest ? " & " : ""}${missingRiskToTest ? "Risk→Test" : ""} links incomplete.`,
          context: { projectId: p.id, missingReqToRisk, missingRiskToTest },
          action: { type: "traceability-sync", projectId: p.id },
          auto: true,
          scoreHints: { impact: 0.85, confidence: 0.85, novelty: 0.7 },
        });
      }

      // 4) Risk hygiene (strong conditions)
      for (const r of risks) {
        const rpn = rpnOf(r);
        const dueIn = daysUntil(r.dueDate);
        const status = r.status || "Open";
        const rid = r.id || r._id || `${(r.title || "risk").replace(/\s+/g, "_")}:${rpn}`;

        // Mitigations for overdue or high RPN
        if (status !== "Closed" && (dueIn < 0 || rpn >= 16)) {
          out.push({
            id: `autoMitigate:${p.id}:${rid}:${rpn}`,
            key: "autoMitigate",
            kind: "Risk",
            priority: dueIn < 0 ? "critical" : "high",
            title: `${dueIn < 0 ? "Overdue" : "High-RPN"} risk in ${p.name}: ${r.title || "Untitled"}`,
            summary: `RPN ${rpn}${Number.isFinite(dueIn) ? ` · ${dueIn < 0 ? `${Math.abs(dueIn)}d overdue` : `due in ${dueIn}d`}` : ""}`,
            context: { projectId: p.id, riskId: rid, rpn, dueIn },
            action: { type: "generate-mitigations", projectId: p.id, riskId: rid },
            auto: true,
            scoreHints: { impact: Math.min(1, rpn / 25), confidence: 0.85, novelty: dueIn < 0 ? 0.9 : 0.7 },
          });
        }

        // Owner assignment
        const unassigned = !String(r.owner || "").trim();
        if (status !== "Closed" && unassigned) {
          out.push({
            id: `assignOwner:${p.id}:${rid}`,
            key: "assignOwner",
            kind: "Risk",
            priority: "medium",
            title: `Unassigned risk in ${p.name}`,
            summary: short(r.description, 120),
            context: { projectId: p.id, riskId: rid },
            action: { type: "normalize-risk", op: "assignOwner", projectId: p.id, riskId: rid },
            auto: true,
            scoreHints: { impact: 0.5, confidence: 0.8, novelty: 0.6 },
          });
        }
      }
    }

    // Observation-driven skills
for (const obs of asArray(obsRef.current)) {
      const pid = obs.projectId;
      if (!pid) continue;

      if (obs.type === "repo:pushed") {
        out.push({
          id: `codeImpact:${pid}:${obs.commitId || obs.ts}`,
          key: "codeImpact",
          kind: "Code",
          priority: "high",
          title: `Code impact analysis for ${projectName(projects, pid)}`,
          summary: `Analyze ${obs.changedFiles?.length || 0} changed files for hazards & requirement impacts.`,
          context: { projectId: pid, commitId: obs.commitId, files: obs.changedFiles || [] },
          action: { type: "code-impact", projectId: pid, commitId: obs.commitId, files: obs.changedFiles || [] },
          auto: true,
          scoreHints: { impact: 0.8, confidence: 0.75, novelty: 0.9 },
        });
      }

      if (obs.type === "docs:changed") {
        out.push({
          id: `reqsGenerate:${pid}:${obs.docId || obs.path || obs.ts}`,
          key: "reqsGenerate",
          kind: "Requirements",
          priority: "high",
          title: `Generate/refine requirements for ${projectName(projects, pid)}`,
          summary: `Source: ${obs.path || obs.docId || "document"} — extract, dedupe, and align to architecture.`,
          context: { projectId: pid, docId: obs.docId, path: obs.path },
          action: { type: "generate-requirements", projectId: pid, scope: { docId: obs.docId, path: obs.path } },
          auto: true,
          scoreHints: { impact: 0.8, confidence: 0.7, novelty: 0.85 },
        });
      }

      if (obs.type === "model:changed") {
        out.push({
          id: `decompose:${pid}:${obs.modelId || obs.ts}`,
          key: "decompose",
          kind: "Modeling",
          priority: "high",
          title: `Decompose & sync architecture for ${projectName(projects, pid)}`,
          summary: `Model updated; (re)decompose and align risks/reqs/diagrams.`,
          context: { projectId: pid, modelId: obs.modelId, change: obs.change },
          action: { type: "decompose-architecture", projectId: pid, sources: { modelId: obs.modelId } },
          auto: true,
          scoreHints: { impact: 0.85, confidence: 0.8, novelty: 0.85 },
        });
      }

      if (obs.type === "code:coverage" && typeof obs.coveragePct === "number" && obs.coveragePct < 80) {
        out.push({
          id: `traceToTests:${pid}:${obs.coveragePct}`,
          key: "traceSync",
          kind: "Traceability",
          priority: "medium",
          title: `Boost verification in ${projectName(projects, pid)}`,
          summary: `Coverage ${obs.coveragePct}% < 80%. Propose tests against high-risk and safety requirements.`,
          context: { projectId: pid, coverage: obs.coveragePct },
          action: { type: "traceability-sync", projectId: pid },
          auto: true,
          scoreHints: { impact: 0.7, confidence: 0.7, novelty: 0.7 },
        });
      }
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, readProjectMap, recomputeKey]);

  // Focused filter: strong gates, cooldowns, caps
  const focusedTasks = useMemo(() => {
    const pre = rawTasks.filter((t) => {
      if (ignoredRef.current.has(t.id) || completedRef.current.has(t.id)) return false;
      if (underCooldown(t.id, t.key)) return false;

      if (t.key === "autoMitigate") {
        const { rpn, dueIn } = t.context || {};
        const overdueStrong = typeof dueIn === "number" && dueIn < -OVERDUE_STRONG_DAYS;
        if (!(overdueStrong || (rpn || 0) >= RPN_STRONG_THRESHOLD)) return false;
      }
      return true;
    });

    const scoreOf = (t) => {
      const { impact = 0.6, confidence = 0.8, novelty = 0.6 } = t.scoreHints || {};
      const base = impact * confidence * (0.5 + 0.5 * novelty);
      const prioBoost =
        t.priority === "critical" ? 0.25 :
        t.priority === "high" ? 0.15 :
        t.priority === "medium" ? 0.05 : 0;
      return base + prioBoost;
    };
    pre.sort((a, b) => scoreOf(b) - scoreOf(a));

    const byProject = new Map();
    const byCategory = new Map();
    const out = [];
    for (const t of pre) {
      const pid = t.context?.projectId || "global";
      const cat = t.kind || "Other";
      if ((byProject.get(pid) || 0) >= MAX_PER_PROJECT) continue;
      if ((byCategory.get(cat) || 0) >= MAX_PER_CATEGORY) continue;
      out.push(t);
      byProject.set(pid, (byProject.get(pid) || 0) + 1);
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
      if (out.length >= MAX_SUGGESTIONS_TOTAL) break;
    }
    return out;
  }, [rawTasks]);

  // Background agent: auto-run focused tasks
  useEffect(() => {
    // Gate auto-execution behind both "enabled" AND "autoRun"
    if (!enabled || !autoRun) return;
  
    let didCancel = false;
  
    const run = async () => {
      if (didCancel) return;
      for (const t of focusedTasks) {
        if (!t.auto) continue;
        if (completedRef.current.has(t.id) || ignoredRef.current.has(t.id) || underCooldown(t.id, t.key)) continue;
        try {
          if (typeof perform === "function") {
            await Promise.resolve(perform(t));
          } else {
            routeTaskViaEvent(t);
          }
          if (didCancel) return;
          markDone(t.id);
          stampCooldown(t.id);
          appendLog({ ts: Date.now(), level: "info", msg: `✅ Executed: ${t.title}`, task: t });
        } catch (e) {
          appendLog({ ts: Date.now(), level: "error", msg: `❌ Failed: ${t.title} — ${e?.message || e}`, task: t });
        }
      }
    };
  
    const first = setTimeout(run, 300);
    const timer = setInterval(run, AGENT_LOOP_MS);
    return () => { didCancel = true; clearTimeout(first); clearInterval(timer); };
  }, [enabled, autoRun, focusedTasks, perform]);
  
  // Event router
  const dispatch = useCallback((type, detail) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }, []);

  const routeTaskViaEvent = useCallback((task) => {
    const { action } = task || {};
    if (!action?.type) return;
    switch (action.type) {
      case "run-analysis":
        dispatch("xhandle:xagent:run-analysis", { projectId: action.projectId, method: action.method || "FMEA" }); break;
      case "refresh-diagram":
        dispatch("xhandle:xagent:refresh-diagram", { projectId: action.projectId, view: action.view || "Risk" }); break;
      case "normalize-risk":
        dispatch("xhandle:xagent:normalize-risk", { projectId: action.projectId, riskId: action.riskId, op: action.op || "assignOwner" }); break;
      case "generate-mitigations":
        dispatch("xhandle:xagent:generate-mitigations", { projectId: action.projectId, riskId: action.riskId }); break;
      case "traceability-sync":
        dispatch("xhandle:xagent:traceability-sync", { projectId: action.projectId }); break;
      case "generate-requirements":
        dispatch("xhandle:xagent:generate-requirements", { projectId: action.projectId, scope: action.scope || {} }); break;
      case "decompose-architecture":
        dispatch("xhandle:xagent:decompose-architecture", { projectId: action.projectId, sources: action.sources || {} }); break;
      case "code-impact":
        dispatch("xhandle:xagent:code-impact", { projectId: action.projectId, commitId: action.commitId, files: action.files || [] }); break;
      default:
        dispatch("xhandle:xagent:action", action);
    }
  }, [dispatch]);

  // UI helpers
  const openTask = useCallback((t) => { setModalItem(t); setOpen(false); }, []);
  const jump = useCallback((t) => {
    if (!t?.context?.projectId) return;
    setSection?.("projects");
    setActiveProjectId?.(t.context.projectId);
    if (t.kind === "Analysis" || t.key === "runAnalysis") setActiveTab?.("Hazard Analysis");
    if (t.kind === "Traceability") setActiveTab?.("Traceability");
    if (t.kind === "Requirements") setActiveTab?.("Requirements");
    if (t.kind === "Modeling") setActiveTab?.("Architecture");
    if (t.kind === "Code") setActiveTab?.("Code");
  }, [setActiveProjectId, setActiveTab, setSection]);

  const badgeCount = focusedTasks.length;

  // ——— render
  return (
    <>
      {/* Button + Dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center justify-center h-8 px-2 rounded-md border
                     text-xs transition relative
                     hover:bg-gray-100 dark:hover:bg-zinc-800
                     border-gray-200 dark:border-zinc-700
                     text-gray-700 dark:text-zinc-100"
          title="xAgent — continuous engineering collaborator"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Lightbulb size={14} className="mr-1" />
          xAgent
          {badgeCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center text-[10px] min-w-[16px] h-[16px] rounded-full bg-indigo-600 text-white">
              {Math.min(9, badgeCount)}{badgeCount > 9 ? "+" : ""}
            </span>
          )}
          <span className={`ml-2 w-2 h-2 rounded-full ${enabled ? "bg-green-500" : "bg-gray-400"}`} />
        </button>

        {open && (
          <div role="menu" className="absolute right-0 mt-1 w-[480px] z-[1001] bg-white border rounded-xl shadow-lg overflow-hidden">
            {/* Header */}
            <div className="border-b px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Agent status — context-aware (systems • reqs • safety • code)</div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-[10px] px-2 py-0.5 rounded border hover:bg-gray-50"
                    onClick={() => {
                        removeLS(STORAGE_DONE);
                        removeLS(STORAGE_COOLDOWN);
                        removeLS(STORAGE_IGNORED);
                        removeLS(STORAGE_OBS_QUEUE);
                        completedRef.current = new Set();
                        ignoredRef.current   = new Set();
                        cooldownRef.current  = {};
                        obsRef.current       = [];
                        // proactively store clean shapes
                        writeLS(STORAGE_DONE, []);
                        writeLS(STORAGE_IGNORED, []);
                        writeLS(STORAGE_COOLDOWN, {});
                        writeLS(STORAGE_OBS_QUEUE, []);
                        bump();
                        appendLog({ ts: Date.now(), level: "info", msg: "🔄 xAgent state reset" });
                      }}                      
                  >
                    Reset
                  </button>
                  <div className="flex items-center gap-2">
  {/* existing Reset button if you have it goes here */}

  {/* NEW: Auto-run toggle */}
  <label className="flex items-center gap-2 text-xs">
  <span>Auto-run</span>
  <input
    type="checkbox"
    checked={autoRun}
    onChange={(e) => {
      const val = !!e.target.checked;
      setAutoRun(val);
      try { localStorage.setItem(STORAGE_AUTORUN, JSON.stringify(val)); } catch {}
    }}
  />
</label>
</div>

                  <label className="flex items-center gap-2 text-xs">
                    <span>{enabled ? "ON" : "OFF"}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => {
                        const val = !!e.target.checked;
                        setEnabled(val);
                        writeLS(STORAGE_ENABLED, val);
                        // no bump needed; UI reflects immediately
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Quick debug counters */}
            <div className="px-3 py-1 text-[10px] text-gray-500">
              {`suggestions=${focusedTasks.length}  raw=${rawTasks.length}  done=${completedRef.current.size}  ignored=${ignoredRef.current.size}`}
            </div>

            {/* Suggestions */}
            <div className="max-h-[26rem] overflow-auto divide-y">
              {focusedTasks.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">No high-impact actions right now.</div>
              ) : (
                focusedTasks.map((s) => (
                  <div key={s.id} role="menuitem" className="p-3 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-900">{s.title}</div>
                      <span className={
                        "text-[10px] px-1.5 py-0.5 rounded " +
                        (s.priority === "critical" ? "bg-red-100 text-red-700"
                          : s.priority === "high" ? "bg-amber-100 text-amber-700"
                          : s.priority === "medium" ? "bg-indigo-100 text-indigo-700"
                          : "bg-gray-100 text-gray-700")
                      }>{s.priority}</span>
                    </div>
                    {s.summary && <div className="mt-0.5 text-xs text-gray-600">{s.summary}</div>}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="text-[11px] px-2 py-1 rounded border hover:bg-gray-50"
                        onClick={() => {
                          try {
                            if (typeof perform === "function") perform(s);
                            else routeTaskViaEvent(s);
                            markDone(s.id);
                            stampCooldown(s.id);
                            appendLog({ ts: Date.now(), level: "info", msg: `▶ Manual: ${s.title}`, task: s });
                          } catch (e) {
                            appendLog({ ts: Date.now(), level: "error", msg: `Manual failed: ${e?.message || e}`, task: s });
                          }
                          setOpen(false);
                        }}
                      >Run now</button>

                      <button
                        type="button"
                        className="text-[11px] px-2 py-1 rounded border hover:bg-gray-50"
                        onClick={() => openTask(s)}
                      >Details</button>

                      <button
                        type="button"
                        className="text-[11px] px-2 py-1 rounded border hover:bg-gray-50"
                        title="Hide this and prevent auto-run"
                        onClick={() => {
                          ignoreTask(s.id);
                          appendLog({ ts: Date.now(), level: "info", msg: `🕳 Ignored: ${s.title}`, task: s });
                        }}
                      >Ignore</button>

                      <button
                        type="button"
                        className="text-[11px] px-2 py-1 rounded border hover:bg-gray-50"
                        onClick={() => jump(s)}
                      >Open context</button>
                    </div>

                    <div className="mt-1 text-[10px] text-gray-400">
                      {isDone(s.id) ? "✓ already executed" : (s.auto ? "Agent will auto-run (focused)" : "Manual")}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer: Ignored + Activity */}
            <div className="border-t p-2 space-y-2">
              <details>
                <summary className="text-[11px] cursor-pointer">Ignored suggestions ({getIgnoredArray().length})</summary>
                <div className="mt-1 max-h-28 overflow-auto space-y-1 pr-1">
                  {getIgnoredArray().length === 0 ? (
                    <div className="text-[11px] text-gray-500">Nothing ignored.</div>
                  ) : (
                    getIgnoredArray().map((id) => (
                      <div key={id} className="flex items-center justify-between text-[11px]">
                        <span className="truncate">{id}</span>
                        <button className="ml-2 px-1.5 py-0.5 rounded border hover:bg-gray-50" onClick={() => unignoreTask(id)}>
                          Un-ignore
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </details>

              <div>
                <div className="text-[11px] font-medium mb-1">Recent agent activity</div>
                <div className="max-h-32 overflow-auto space-y-1 pr-1">
                  {log.length === 0 ? (
                    <div className="text-[11px] text-gray-500">No recent activity.</div>
                  ) : (
                    log.map((l, i) => (
                      <div key={i} className="text-[11px]">
                        <span className={l.level === "error" ? "text-red-600" : "text-gray-700"}>
                          {new Date(l.ts).toLocaleTimeString()} — {l.msg}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {typeof document !== "undefined" && createPortal(
        modalItem ? (
          <div className="fixed inset-0 z-[1100]">
            <div className="absolute inset-0 bg-black/30" onClick={() => setModalItem(null)} />
            <div className="absolute inset-x-0 top-24 mx-auto w-[780px] max-w-[96vw] rounded-2xl bg-white shadow-2xl border">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2">
                  <Lightbulb size={16} />
                  <div className="font-semibold text-sm">xAgent · {modalItem.kind}</div>
                </div>
                <button className="p-1 rounded hover:bg-gray-100" onClick={() => setModalItem(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div className="text-lg font-semibold">{modalItem.title}</div>
                {modalItem.summary && <div className="text-sm text-gray-700">{modalItem.summary}</div>}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <div className="text-xs font-semibold mb-1">Context</div>
                    <pre className="text-[11px] bg-gray-50 rounded-lg p-3 overflow-auto">
{JSON.stringify(modalItem.context || {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-semibold mb-1">Action</div>
                    <div className="text-xs border rounded-lg p-2 bg-gray-50">{modalItem.action?.type || "N/A"}</div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                        onClick={() => {
                          try {
                            if (typeof perform === "function") perform(modalItem);
                            else routeTaskViaEvent(modalItem);
                            markDone(modalItem.id);
                            stampCooldown(modalItem.id);
                            appendLog({ ts: Date.now(), level: "info", msg: `▶ Manual (modal): ${modalItem.title}`, task: modalItem });
                          } catch (e) {
                            appendLog({ ts: Date.now(), level: "error", msg: `Manual failed: ${e?.message || e}`, task: modalItem });
                          }
                          setModalItem(null);
                        }}
                      >Run now</button>

                      <button
                        className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                        onClick={() => {
                          ignoreTask(modalItem.id);
                          appendLog({ ts: Date.now(), level: "info", msg: `🕳 Ignored: ${modalItem.title}`, task: modalItem });
                          setModalItem(null);
                        }}
                      >Ignore</button>

                      <button
                        className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                        onClick={() => {
                          if (modalItem?.context?.projectId) {
                            setSection?.("projects");
                            setActiveProjectId?.(modalItem.context.projectId);
                          }
                          setModalItem(null);
                        }}
                      >Open context</button>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500">
                  xAgent keeps diagrams, requirements, risks, and code intelligence in sync across the lifecycle.
                </div>
              </div>
            </div>
          </div>
        ) : null,
        document.body
      )}
    </>
  );
}
