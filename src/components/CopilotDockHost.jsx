/**
 * xHandle: copilot dock host shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// src/components/CopilotDockHost.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import html2canvas from "html2canvas";
import {
  Plus, PanelRightClose, Loader2, Square, Bot, AlertTriangle,
} from "lucide-react";

import {
  loadThreads, saveThreads, newThread, appendMessage,
} from "./copilotThreads";
import { dispatchAgentApply } from "./agentActions";
import { backendURL, buildAIAuthOpts } from "./backendConfig";
import { logger } from "./utils/logger";

// ⬇️ NEW: Region selection helpers
import { openRegionSelector } from "./diagrams/RegionLassoOverlay";
import { popAllRegionContext } from "./utils/copilotContextBus";

// Optional: if you pass copilotContext from your shell, we’ll use it.
function renderCopilotContext(ctx) {
  if (!ctx?.project) return "You are xHandle Copilot. No active project selected.";
  const reqCount   = (ctx.requirements || []).length;
  const linkCount  = (ctx.functionalDecomposition || []).length;
  const riskCount  = (ctx.riskRegister || []).length;
  const sumRows    = (ctx.riskSummarySheet || []).length > 1 ? (ctx.riskSummarySheet.length - 1) : 0;
  const cbaCount   = (ctx.codeArchitecture || []).length;

  const sample = {
    requirements: (ctx.requirements || []).slice(0, 5).map(r => ({
      id: r.id, title: r.title, module: r.module, attrs: r.attributes
    })),
    decomposition: (ctx.functionalDecomposition || []).slice(0, 5),
    risks: (ctx.riskRegister || []).slice(0, 5).map(r => ({
      id: r.id, title: r.title, lik: r.likelihood, sev: r.severity, status: r.status
    })),
    summaryHeaders: (ctx.riskSummarySheet?.[0] || []).slice(0, 12),
    codeArchSample: (ctx.codeArchitecture || []).slice(0, 5),
  };

  return [
    `You are xHandle Copilot. Use the project context below when answering.`,
    `Project: ${ctx.project.name} (id: ${ctx.project.id})`,
    `Counts ⇒ Requirements: ${reqCount}, Decomposition links: ${linkCount}, Risks: ${riskCount}, RiskSummary rows: ${sumRows}, CodeArch rows: ${cbaCount}`,
    ctx.projectHint?.owner && ctx.projectHint?.repo ? `Repo: ${ctx.projectHint.owner}/${ctx.projectHint.repo}` : null,
    `Samples (truncated):`,
    JSON.stringify(sample)
  ].filter(Boolean).join("\n");
}

/**
 * callChat renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param messages Input consumed by this step of the xHandle workflow.
 * @param signal Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
async function callChat(messages, signal) {
  const resp = await fetch(`${backendURL}/api/chat`, {
    method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    signal,
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages,
      stream: false,
    }),
  });
  if (!resp.ok) throw new Error(`assistant_failed_${resp.status}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "No response.";
}

/**
 * extractJsonFromMarkdown renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function extractJsonFromMarkdown(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * parsePlan renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function parsePlan(text) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const steps = [];
  for (const l of lines) {
    const m = l.match(/^(\d+)[).\s-]+(.*)$/);
    if (m && m[2]) { steps.push(m[2].trim()); continue; }
    const d = l.match(/^[-•]\s*(.*)$/);
    if (d && d[1]) { steps.push(d[1].trim()); continue; }
  }
  const unique = (steps.length ? steps : [text]).map(s => s.trim()).filter(Boolean);
  return unique.slice(0, 5);
}

async function captureSelectionAsImage(viewRect) {
  const x = Math.round(viewRect.x + window.scrollX);
  const y = Math.round(viewRect.y + window.scrollY);
  const width = Math.max(1, Math.round(viewRect.width));
  const height = Math.max(1, Math.round(viewRect.height));

  const shot = await html2canvas(document.body, {
    x, y, width, height,
    scale: 1,
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  return shot.toDataURL("image/png");
}

const sanitizedSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "u", "mark"],
};

const mdComponents = {
  h1: ({ children }) => <h1 className="text-lg font-bold mt-1 mb-1.5">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold mt-1 mb-1.5">{children}</h2>,
  p:  ({ children }) => <p className="text-[13px] leading-relaxed mb-1.5">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  u: ({ children }) => <u className="underline underline-offset-2">{children}</u>,
  mark: ({ children }) => <mark className="bg-yellow-100 rounded px-1">{children}</mark>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
  code({ inline, className, children }) {
    const isInline = inline ?? !/\blanguage-/.test(className || "");
    if (isInline) return <code className="px-1 py-0.5 text-[0.825rem] bg-neutral-200 rounded">{children}</code>;
    return (
      <pre className="text-[0.825rem] bg-neutral-900 text-neutral-100 p-2.5 rounded-lg overflow-auto my-2">
        <code>{children}</code>
      </pre>
    );
  }
};

/**
 * groupTurns renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param msgs Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function groupTurns(msgs = []) {
  const groups = [];
  let current = null;
  for (const m of msgs) {
    if (m.role === "user") {
      if (current) groups.push(current);
      current = { user: m, assistant: [] };
    } else {
      if (!current) current = { user: null, assistant: [] };
      current.assistant.push(m);
    }
  }
  if (current) groups.push(current);
  return groups;
}

export default function CopilotDockHost({ copilotContext }) {
  const [docked, setDockedState] = useState(() => {
    try { return JSON.parse(localStorage.getItem("xhandle:copilotDocked") || "false"); } catch { return false; }
  });
  const [dockWidth, setDockWidth] = useState(() => {
    const n = Number(localStorage.getItem("xhandle:copilotDockWidth"));
    return Number.isFinite(n) && n >= 320 ? n : 420;
  });
  const resizingRef = useRef(false);

  const [threads, setThreads] = useState(() => loadThreads());
  const [activeId, setActiveId] = useState(() => (loadThreads()[0] || {}).id);
  const active = useMemo(() => threads.find(t => t.id === activeId), [threads, activeId]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [progress, setProgress]   = useState({ step: 0, total: 0, label: "" });
  const agentAbortRef = useRef(null);

  const [pendingActions, setPendingActions] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // keep localStorage and other tabs/components in sync
  function persistDocked(next) {
    const val = JSON.stringify(!!next);
    localStorage.setItem("xhandle:copilotDocked", val);
    window.dispatchEvent(new CustomEvent("xhandle:copilot-dock-changed", { detail: { docked: !!next } }));
    setDockedState(!!next);
  }

  // Sidebar -> Dock control: Agent On / Undock
  useEffect(() => {
    const onSetAgent = (e) => {
      const on = !!e?.detail?.on;
      setAgentMode(on);
    };
    const onUndock = () => {
      // Use the existing persist function so state + localStorage + cross-tab stay in sync
      if (typeof persistDocked === "function") {
        persistDocked(false);
      } else {
        // Fallback: mirror the localStorage + event shape used elsewhere in this file
        localStorage.setItem("xhandle:copilotDocked", "false");
        window.dispatchEvent(new CustomEvent("xhandle:copilot-dock-changed", { detail: { docked: false } }));
        setDockedState(false);
      }
    };

    window.addEventListener("xhandle:copilot-set-agent", onSetAgent);
    window.addEventListener("xhandle:copilot-undock", onUndock);
    return () => {
      window.removeEventListener("xhandle:copilot-set-agent", onSetAgent);
      window.removeEventListener("xhandle:copilot-undock", onUndock);
    };
  }, []);

  useEffect(() => {
    const onCustom = (e) => {
      if (typeof e.detail?.docked === "boolean") setDockedState(e.detail.docked);
    };
    const onStorage = (e) => {
      if (e.key === "xhandle:copilotDocked") {
        try { setDockedState(JSON.parse(e.newValue || "false")); } catch {}
      }
      if (e.key === "xhandle:copilotDockWidth") {
        const n = Number(e.newValue);
        if (Number.isFinite(n)) setDockWidth(n);
      }
    };
    window.addEventListener("xhandle:copilot-dock-changed", onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("xhandle:copilot-dock-changed", onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => { saveThreads(threads); }, [threads]);

  // Global hotkey: Cmd/Ctrl+Shift+C toggles dock anywhere
  useEffect(() => {
    const onKey = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        persistDocked(!docked);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docked]);

  useEffect(() => {
    function onMove(e) {
      if (!resizingRef.current) return;
      const vw = window.innerWidth;
      const newWidth = Math.min(Math.max(320, vw - e.clientX), 800);
      setDockWidth(newWidth);
      localStorage.setItem("xhandle:copilotDockWidth", String(newWidth));
    }
    function onUp() { resizingRef.current = false; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ⬇️ NEW: Ingest region selections (and buffered ones) into the composer
  useEffect(() => {
    function onRegion(ev) {
      const { text, tableMarkdown } = ev.detail || {};
      const md = tableMarkdown ? `\n\n**Selection (table):**\n\n${tableMarkdown}` : "";
      const txt = text ? `\n\n**Selection (text):**\n\n${text}` : "";
      setInput((prev) => `${prev}${md || txt}`);
    }
    window.addEventListener("xhandle:copilot-add-context", onRegion);

    // Drain any buffered context if user captured before dock was ready
    const pending = popAllRegionContext();
    if (pending.length) {
      const blobs = pending.map(p => {
        const md = p.tableMarkdown ? `\n\n**Selection (table):**\n\n${p.tableMarkdown}` : "";
        const txt = p.text ? `\n\n**Selection (text):**\n\n${p.text}` : "";
        return md || txt;
      }).join("\n");
      setInput(prev => `${prev}${blobs}`);
    }

    return () => window.removeEventListener("xhandle:copilot-add-context", onRegion);
  }, []);

  function makeThread(title) {
    newThread(title || "New topic");
    const all = loadThreads();
    setThreads(all);
    setActiveId(all[0].id);
  }

  async function handleSend() {
    if (!input.trim() || !active) return;
    const userMsg = { role: "user", content: input.trim() };
    setInput("");
    appendMessage(active.id, userMsg);
    setThreads(loadThreads());
    if (agentMode) await runAgent(userMsg.content);
    else await runCopilot(userMsg.content);
  }

  async function runCopilot() {
    setBusy(true);
    try {
      const systemMsg = { role: "system", content: renderCopilotContext(copilotContext) };
      const t = loadThreads().find(t => t.id === activeId);
      const messages = [systemMsg, ...(t?.messages || [])];
      const answer = await callChat(messages, undefined);
      appendMessage(activeId, { role: "assistant", content: answer });
      setThreads(loadThreads());
    } catch {
      appendMessage(activeId, { role: "assistant", content: "Sorry — I hit an issue generating a reply. Check server logs and try again." });
      setThreads(loadThreads());
    } finally {
      setBusy(false);
    }
  }

  async function runAgent(userText) {
    if (!active) return;
    setBusy(true);
    setProgress({ step: 0, total: 0, label: "Planning…" });
    agentAbortRef.current?.abort?.();
    agentAbortRef.current = new AbortController();
    const signal = agentAbortRef.current.signal;

    try {
      const planPrompt = [
        { role: "system", content: `${renderCopilotContext(copilotContext)}\nYou are an autonomous xHandle project assistant. Produce a short, numbered plan (max 5 steps). Use **bold** for step titles.` },
        { role: "user", content: `User request: ${userText}\nReturn only the steps as a numbered list.` }
      ];
      const planText = await callChat(planPrompt, signal);
      const steps = parsePlan(planText);
      setProgress({ step: 1, total: steps.length + 3, label: "Plan created" });

      appendMessage(activeId, {
        role: "assistant",
        content: `# 📋 Plan\n${steps.map((s,i)=>`${i+1}. **${s}**`).join("\n")}`
      });
      setThreads(loadThreads());

      for (let i = 0; i < steps.length; i++) {
        if (signal.aborted) throw new Error("aborted");
        setProgress({ step: i + 2, total: steps.length + 3, label: `Executing step ${i+1}/${steps.length}` });
        const execPrompt = [
          { role: "system", content: `${renderCopilotContext(copilotContext)}\nYou are assisting in 'Agent Mode'. Return Markdown with:\n## Step Title\n- **What you looked at**\n- **What you found**\n- **Next suggestions** (numbered list)\nKeep it concise.` },
          { role: "user", content: `Step: ${steps[i]}\nDo NOT modify data; provide guidance only.` }
        ];
        const result = await callChat(execPrompt, signal);
        appendMessage(activeId, { role: "assistant", content: `## ✅ Step ${i+1}: **${steps[i]}**\n${result}` });
        setThreads(loadThreads());
      }

      if (signal.aborted) throw new Error("aborted");
      setProgress({ step: steps.length + 2, total: steps.length + 3, label: "Proposing edits…" });

      const proposePrompt = [
        { role: "system", content:
`From the prior analysis, output a JSON object \`\`\`json
{ "actions": [ { "type": "<ACTION_TYPE>", "payload": { /* fields */ } } ] }
\`\`\`
Only include actions that are clearly useful. Use these action types and payloads:

- CREATE_REQUIREMENT: { "title": string, "module": string, "attributes": { [k:string]: any } }
- UPDATE_REQUIREMENT: { "id": string, "patch": { [k:string]: any } }
- CREATE_MODULE: { "name": string, "type": string, "attrTemplate": Array, "viewTemplates": Array }
- CREATE_DIAGRAM_NODE: { "label": string, "description": string, "group": string }
- CREATE_DIAGRAM_EDGE: { "fromLabel": string, "toLabel": string, "controlAction": string }
- UPDATE_RISK: { "id": string, "patch": { [k:string]: any } }

Return ONLY a fenced JSON block.`
        },
        { role: "user", content: "Infer 1-6 sensible actions max from our conversation. Do not duplicate existing items if not needed." }
      ];
      const actionsMd = await callChat(proposePrompt, signal);
      const json = extractJsonFromMarkdown(actionsMd);

      if (json?.actions?.length) {
        setPendingActions(json);
        setShowConfirm(true);
        appendMessage(activeId, {
          role: "assistant",
          content: `### ✍️ Proposed Changes (Review Required)\nI have a small set of changes ready. Please review and confirm to apply.`
        });
        setThreads(loadThreads());
      } else {
        appendMessage(activeId, { role: "assistant", content: `No concrete changes are recommended at this time.` });
        setThreads(loadThreads());
      }

      if (signal.aborted) throw new Error("aborted");
      setProgress({ step: steps.length + 3, total: steps.length + 3, label: "Done" });
    } catch (e) {
      if (String(e?.message || "").includes("aborted")) {
        appendMessage(activeId, { role: "assistant", content: "⏹️ Agent run stopped." });
      } else {
        appendMessage(activeId, { role: "assistant", content: "Sorry — the agent hit an issue mid-run. Check server logs and try again." });
      }
      setThreads(loadThreads());
    } finally {
      setBusy(false);
      agentAbortRef.current = null;
      setTimeout(() => setProgress({ step: 0, total: 0, label: "" }), 600);
    }
  }

  async function applyPendingActions() {
    if (!pendingActions?.actions?.length) { setShowConfirm(false); return; }
    try {
      dispatchAgentApply({ actions: pendingActions.actions, threadId: activeId });
      appendMessage(activeId, { role: "assistant", content: `✅ **Changes applied.** If anything looks off, you can undo in your project views.` });
      setThreads(loadThreads());
    } catch (e) {
      appendMessage(activeId, { role: "assistant", content: `⚠️ Failed to apply changes: ${e?.message || "unknown error"}` });
      setThreads(loadThreads());
    } finally {
      setPendingActions(null);
      setShowConfirm(false);
    }
  }

  if (!docked) return null;

  return createPortal(
    <>
      <div className="fixed inset-y-0 right-0 z-[1000] pointer-events-none">
        <div
          className="absolute right-0 top-0 h-full bg-white border-l shadow-2xl pointer-events-auto flex flex-col"
          style={{ width: dockWidth }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b bg-[#F8FAFC]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-neutral-700">Copilot</span>
              <span className="text-neutral-400">·</span>
              <span className="text-xs text-neutral-600 truncate max-w-[180px]">
                {(threads.find(t => t.id === activeId)?.title) || "No thread"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <select
                className="text-xs border rounded px-1 py-1 max-w-[200px]"
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                title="Switch thread"
              >
                {threads
                  .slice()
                  .sort((a,b)=> Number(b.pinned)-Number(a.pinned) || b.updatedAt - a.updatedAt)
                  .map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
              </select>

              <button
                onClick={() => makeThread("New topic")}
                className="p-1 rounded border hover:bg-neutral-50"
                title="New thread"
              >
                <Plus className="w-4 h-4" />
              </button>
{/* ⬇️ NEW: Region selection → append as context */}
<button
                type="button"
                onClick={() => {
                  openRegionSelector({
                    onDone: async (payload) => {
                      const { bbox, text, tableMarkdown } = payload || {};
                      try {
                        if (bbox && bbox.width > 0 && bbox.height > 0) {
                          const dataUrl = await captureSelectionAsImage(bbox);
                          setInput(prev => `${prev}\n\n![Selection](${dataUrl})`);
                        } else {
                          const md  = tableMarkdown ? `\n\n**Selection (table):**\n\n${tableMarkdown}` : "";
                          const txt = text ? `\n\n**Selection (text):**\n\n${text}` : "";
                          setInput(prev => `${prev}${md || txt}`);
                        }
                      } catch (e) {
                        const md  = tableMarkdown ? `\n\n**Selection (table):**\n\n${tableMarkdown}` : "";
                        const txt = text ? `\n\n**Selection (text):**\n\n${text}` : "";
                        setInput(prev => `${prev}${md || txt}`);
                        logger.warn("screenshot failed, fell back to text:", e);
                      }
                    }
                    
                  });
                }}
                className="inline-flex items-center px-2 py-1 text-xs rounded border bg-white text-neutral-700 hover:bg-neutral-50"
                title="Select on-screen region to use as Copilot context"
              >
                Select Region
              </button>
              {/* Agent toggle (button in dock header) */}
              <button
                type="button"
                onClick={() => setAgentMode(v => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition
                  ${agentMode
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'}`}
                title={agentMode ? 'Agent On' : 'Agent Off'}
              >
                <Bot className="w-4 h-4" />
                <span>{agentMode ? 'Agent On' : 'Agent Off'}</span>
              </button>

              <button
                onClick={() => persistDocked(false)}
                className="p-1 rounded border hover:bg-neutral-50"
                title="Undock"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {groupTurns((threads.find(t => t.id === activeId)?.messages) || []).map((turn, idx) => (
              <div key={idx} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                {turn.user ? (
                  <div className="px-3 py-2 border-b bg-neutral-50">
                    <div className="w-full flex justify-end">
                      <div className="max-w-[48ch] w-full bg-indigo-600 text-white px-3 py-2 rounded-2xl rounded-tr-sm shadow">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[[rehypeSanitize, sanitizedSchema]]}
                          components={mdComponents}
                        >
                          {String(turn.user.content || "")}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="px-3 py-2 space-y-1">
                  {(turn.assistant.length ? turn.assistant : [{ role: "assistant", content: "" }]).map((am, i) => (
                    <div key={i} className="max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[[rehypeSanitize, sanitizedSchema]]}
                        components={mdComponents}
                      >
                        {String(am.content || "")}
                      </ReactMarkdown>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="w-4 h-4 animate-spin" /> thinking…
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t p-2 bg-white">
            <div className="flex items-end gap-2">
              <textarea
                className="flex-1 border rounded-lg px-2 py-1.5 text-sm h-16 resize-y focus:outline-none focus:ring focus:ring-indigo-200"
                placeholder={agentMode ? "Goal for agent…" : "Ask Copilot…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              {agentMode && busy ? (
                <button
                  onClick={() => agentAbortRef.current?.abort?.()}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 text-sm border rounded-lg hover:bg-neutral-50"
                  title="Stop Agent"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              ) : null}
              <button
                onClick={handleSend}
                disabled={busy || !input.trim() || !active}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                Send
              </button>
            </div>

            {/* mode row */}
            <div className="mt-2 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={agentMode}
                  onChange={(e) => setAgentMode(e.target.checked)}
                />
                <span className="inline-flex items-center gap-1">
                  <Bot className="w-3 h-3" /> Agent Mode
                </span>
              </label>
              {progress.total > 0 && (
                <div className="text-[11px] text-neutral-700 px-2 py-0.5 rounded border bg-white">
                  {progress.label || "Working…"} {progress.step}/{progress.total}
                </div>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div
            className="absolute left-0 top-0 h-full w-1 cursor-ew-resize"
            onMouseDown={() => { resizingRef.current = true; }}
            title="Drag to resize"
          />
        </div>
      </div>

      {/* HITL confirmation modal (global) */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1100]">
          <div className="bg-white rounded-xl shadow-xl w-[680px] max-w-[95vw]">
            <div className="px-5 py-4 border-b flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <div className="font-semibold">Review proposed changes</div>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-auto">
              <div className="text-sm text-neutral-700">
                <p className="mb-3">
                  <strong>Heads up:</strong> Agent Mode can make mistakes. <u>You are the human in the loop.</u>
                </p>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-left px-3 py-2 border-b">Type</th>
                      <th className="text-left px-3 py-2 border-b">Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pendingActions?.actions || []).map((a, i) => (
                      <tr key={i} className="odd:bg-white even:bg-neutral-50">
                        <td className="px-3 py-2 align-top border-b font-mono text-xs">{a.type}</td>
                        <td className="px-3 py-2 align-top border-b">
                          <pre className="text-[11px] bg-neutral-100 text-neutral-800 rounded p-2 overflow-auto">
                            {JSON.stringify(a.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 text-sm rounded border hover:bg-neutral-50"
                onClick={() => { setShowConfirm(false); setPendingActions(null); }}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={applyPendingActions}
              >
                I understand — Apply changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
