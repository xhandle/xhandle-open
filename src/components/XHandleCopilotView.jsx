// src/components/XHandleCopilotView.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import html2canvas from "html2canvas";
import {
  MessageSquareText,
  ArrowDown,
  Loader2,
  SendHorizonal,
  Trash2,
  History,
  Plus,
  Pin,
  PinOff,
  Pencil,
  Copy,
  Bold,
  Italic,
  Underline,
  List as ListIcon,
  ListOrdered,
  Heading2,
  Heading3,
  CheckSquare,
  Code2,
  Table as TableIcon,
  PanelLeftOpen,
  PanelLeftClose,
  Crosshair,
} from "lucide-react";
import {
  loadThreads, saveThreads, newThread, renameThread, deleteThread,
  togglePin, appendMessage, setMessages
} from "./copilotThreads";
import { generateThreadTitle } from "./generateThreadTitle";
import { buildAIAuthOpts } from "./backendConfig";
import {
  Rocket, Link2, GitCommit, Network, FilePlus2, ShieldCheck, FolderGit2
} from "lucide-react";

/* === NEW: region selection imports === */
import { openRegionSelector } from "./RegionLassoOverlay";
import { pushRegionContext, popAllRegionContext } from "./utils/copilotContextBus";
import { buildWorkspaceLLMContext } from "../features/workspace-graph";

function QuickSuggestions({ onPick }) {
  const items = [
    {
      label: "Visualize Functional Architecture",
      prompt: "Visualize the functional architecture from the current project data. If a functional decomposition table exists, use it to build the diagram and call out the most connected nodes.",
      icon: Network,
      tone: "primary",
    },
    {
      label: "Generate Risk Profile (FMEA)",
      prompt: "Run the FMEA pipeline from the functional decomposition (Failure Mode | Effect | Cause), then generate mitigations, system requirements, consolidation, and the summary sheet.",
      icon: ShieldCheck,
      tone: "indigo",
    },
    {
      label: "Link Requirements to Functions",
      prompt: "Propose traceability links between existing requirements and functions/control actions. Return a concise list of suggested links with confidence scores.",
      icon: Link2,
      tone: "neutral",
    },
    {
      label: "Summarize Latest GitHub Commits",
      prompt: "Summarize the most recent commits for the connected repo and identify any changes that could affect risk or requirements.",
      icon: GitCommit,
      tone: "neutral",
    },
    {
      label: "Find Most Connected Function",
      prompt: "From the current architecture graph, identify the function with the highest degree (incoming + outgoing) and explain why it’s critical.",
      icon: Rocket,
      tone: "indigo",
    },
    {
      label: "Create System Requirement Template",
      prompt: "Draft a system requirement template tailored to this project with fields for ID, Module, Rationale, Verification Method, and Acceptance Criteria.",
      icon: FilePlus2,
      tone: "neutral",
    },
    {
      label: "Sync Repository & Parse Code",
      prompt: "Sync the configured GitHub repository and extract a functional decomposition from source files (JS/TS/PY/C++). List the top 10 functions by connectivity.",
      icon: FolderGit2,
      tone: "neutral",
    },
  ];

  const toneClasses = {
    primary:
      "bg-gradient-to-r from-[#2D7DFE] to-[#7A37FF] text-white border-transparent hover:shadow-[0_6px_18px_rgba(45,125,254,0.35)]",
    indigo:
      "bg-[#ECEEFF] text-[#0F0F12] border border-[#7A37FF]/50 hover:border-[#7A37FF] hover:shadow-[0_6px_18px_rgba(122,55,255,0.25)]",
    neutral:
      "bg-white text-[#0F0F12] border border-neutral-200 hover:border-neutral-300 hover:shadow-sm",
  };

  return (
    <div className="mt-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-2">
        Quick actions
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(({ label, prompt, icon: Icon, tone }, i) => (
          <button
            key={i}
            onClick={() => onPick(prompt)}
            className={[
              "group inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition",
              "focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-[#7A37FF]/60",
              "active:scale-[0.99]",
              toneClasses[tone],
            ].join(" ")}
            title={label}
          >
            <span
              className={[
                "inline-flex items-center justify-center rounded-full",
                tone === "primary"
                  ? "bg-white/15"
                  : tone === "indigo"
                  ? "bg-[#7A37FF]/10"
                  : "bg-neutral-100",
                "w-5 h-5"
              ].join(" ")}
            >
              <Icon className={tone === "primary" ? "w-3.5 h-3.5 text-white" : "w-3.5 h-3.5 text-[#7A37FF]"} />
            </span>
            <span className={tone === "primary" ? "text-white" : "text-[#0F0F12]"}>
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- Utilities & Context --------------------------- */

function countUserMsgs(msgs) {
  return (msgs || []).reduce((n, m) => n + (m.role === "user" ? 1 : 0), 0);
}

function truncateText(value, max = 600) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function boundedJson(value, max = 14000) {
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}... [truncated]` : text;
}

function compactPromptArtifact(artifact) {
  return {
    id: artifact.id,
    type: artifact.type,
    projectId: artifact.projectId,
    parentId: artifact.parentId,
    title: artifact.title,
    summary: truncateText(artifact.summary, 500),
    status: artifact.status,
    sourceStore: artifact.sourceStore,
    sourceKey: artifact.sourceKey,
    sourceId: artifact.sourceId,
    tags: artifact.tags,
    contentSnippet: truncateText(artifact.content, 500),
    structuredDataSnippet: artifact.structuredData == null
      ? undefined
      : truncateText(typeof artifact.structuredData === "string" ? artifact.structuredData : JSON.stringify(artifact.structuredData), 600),
  };
}

function compactPromptHistory(messages = [], { maxMessages = 10, maxCharsPerMessage = 3000 } = {}) {
  return messages.slice(-maxMessages).map((message) => ({
    ...message,
    content: truncateText(message.content, maxCharsPerMessage),
  }));
}

export function renderCopilotContext(ctx) {
  if (!ctx) return "You are xHandle Collaborator. Reason across the complete local xHandle workspace by default.";
  if (Array.isArray(ctx.relevantArtifacts) || Array.isArray(ctx.relationships)) {
    const artifacts = ctx.relevantArtifacts || [];
    const relationships = ctx.relationships || [];
    const summary = ctx.workspaceSummary || {};
    const projects = ctx.projects || [];
    const sourceFiles = ctx.sourceFiles || [];
    const sample = {
      projects: projects.slice(0, 8).map(project => ({
        id: project.id,
        name: project.name,
        folderId: project.folderId,
      })),
      relevantArtifacts: artifacts.slice(0, 18).map(compactPromptArtifact),
      relationships: relationships.slice(0, 35).map(rel => ({
        id: rel.id,
        type: rel.type,
        fromArtifactId: rel.fromArtifactId,
        toArtifactId: rel.toArtifactId,
        confidence: rel.confidence,
        sourceFeature: rel.sourceFeature,
      })),
      runs: (ctx.runs || []).slice(0, 6).map(run => ({
        id: run.id,
        type: run.type,
        title: run.title,
        status: run.status,
        artifactIds: (run.artifactIds || []).slice(0, 10),
      })),
      reviews: (ctx.reviews || []).slice(0, 8).map(review => ({
        id: review.id,
        artifactId: review.artifactId,
        title: review.title,
        status: review.status,
      })),
      evidence: (ctx.evidence || []).slice(0, 8).map(item => ({
        id: item.id,
        artifactId: item.artifactId,
        title: item.title,
        type: item.type,
        contentSnippet: truncateText(item.content, 400),
      })),
      sourceFiles: sourceFiles.slice(0, 10).map(file => ({
        id: file.id,
        path: file.path,
        repoId: file.repoId,
        language: file.language,
        symbols: file.symbols,
        sourceStore: file.sourceStore,
      })),
      citations: (ctx.citations || []).slice(0, 30),
      diagnostics: ctx.diagnostics || {},
    };

    return [
      `You are xHandle Collaborator. Reason from the canonical xHandle workspace graph, not raw localStorage keys.`,
      `Use typed artifacts, relationships, runs, reviews, evidence, source files, and citations as the source of truth for local workspace context.`,
      ctx.scope?.projectId ? `Active project id: ${ctx.scope.projectId}` : `No active project boundary is required; reason workspace-wide unless the user names a project or artifact.`,
      `Active view: ${JSON.stringify(ctx.scope?.activeView || {})}`,
      `Workspace graph counts => Projects: ${summary.projectCount || projects.length || 0}, Artifacts: ${summary.artifactCount || artifacts.length || 0}, Relationships: ${summary.relationshipCount || relationships.length || 0}, Relevant artifacts: ${summary.relevantArtifactCount || artifacts.length || 0}`,
      `Cite artifact ids and source pointers when making claims about stored workspace data.`,
      `For destructive writes or ambiguous artifact generation, infer the best target from the prompt when clear; otherwise create/add to an appropriate workspace artifact or ask a short clarification.`,
      `Canonical graph sample (truncated):`,
      boundedJson(sample),
    ].filter(Boolean).join("\n");
  }
  const reqCount   = (ctx.requirements || []).length;
  const linkCount  = (ctx.functionalDecomposition || []).length;
  const riskCount  = (ctx.riskRegister || []).length;
  const sumRows    = (ctx.riskSummarySheet || []).length > 1 ? (ctx.riskSummarySheet.length - 1) : 0;
  const cbaCount   = (ctx.codeArchitecture || []).length;
  const workspace = ctx.workspace || {};
  const workspaceProjectCount = workspace.projectCount || workspace.projects?.length || 0;
  const workspaceSysMLCount = workspace.sysmlModels?.length || 0;
  const screen = ctx.focus?.screen || {};
  const designState = screen.designManagement || {};

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
    workspaceProjects: (workspace.projects || []).slice(0, 8).map(project => ({
      id: project.id,
      name: project.name,
      counts: project.counts,
      sampleRequirementTitles: (project.samples?.requirements || []).slice(0, 3).map(row => row.title || row.name || row.id),
      sampleRiskTitles: (project.samples?.riskRegister || []).slice(0, 3).map(row => row.title || row.name || row.id),
    })),
    sysmlModels: (workspace.sysmlModels || []).slice(0, 5).map(model => ({
      id: model.id,
      name: model.name,
      projectId: model.projectId,
      elementCount: model.elementCount,
      relationshipCount: model.relationshipCount,
      elementNames: (model.elements || []).slice(0, 8).map(element => `${element.type}:${element.name}`),
    })),
    currentScreen: {
      feature: screen.feature || ctx.focus?.section || null,
      view: screen.view || ctx.focus?.activeTab || null,
      designManagement: designState ? {
        activeFolderId: designState.activeFolderId,
        activeFolderName: designState.activeFolderName,
        selectedModule: designState.selectedModule,
        selectedModuleId: designState.selectedModuleId,
        visibleModuleRowCount: designState.visibleModuleRowCount,
        visibleModuleRows: (designState.visibleModuleRows || []).slice(0, 12).map(row => ({
          id: row.id,
          title: row.title,
          heading: row.heading,
          parentId: row.parentId,
          order: row.order,
          attributes: row.attributes,
        })),
      } : null,
    },
  };

  return [
    `You are xHandle Collaborator. Reason across the complete local xHandle workspace by default.`,
    `Do not use an active-project boundary unless the user explicitly names a project or artifact scope.`,
    ctx.project ? `Recently opened project context: ${ctx.project.name} (id: ${ctx.project.id})` : `No project context is required; use workspace-wide context.`,
    `Current screen: ${screen.feature || ctx.focus?.section || "unknown"}${designState?.selectedModule ? `; Design Management module: ${designState.selectedModule}` : ""}`,
    `Workspace counts ⇒ Projects: ${workspaceProjectCount}, SysML models: ${workspaceSysMLCount}, Workspace CodeArch rows: ${(workspace.codeArchitecture || []).length || cbaCount}`,
    `Artifact counts ⇒ Requirements: ${reqCount}, Decomposition links: ${linkCount}, Risks: ${riskCount}, RiskSummary rows: ${sumRows}, CodeArch rows: ${cbaCount}`,
    `For destructive writes or ambiguous artifact generation, infer the best target from the prompt when clear; otherwise create/add to an appropriate workspace artifact or ask a short clarification.`,
    ctx.projectHint?.owner && ctx.projectHint?.repo ? `Repo: ${ctx.projectHint.owner}/${ctx.projectHint.repo}` : null,
    `Samples (truncated):`,
    boundedJson(sample)
  ].filter(Boolean).join("\n");
}

function sanitizeCapturedText(s) {
  if (!s) return "";
  return String(s)
    // strip any markdown images (including base64 screenshots)
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    // strip inline data URLs
    .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "")
    // remove overlay hint lines
    .replace(/—\s*release to capture.*$/gmi, "")
    // remove dimension patterns like "502 × 343"
    .replace(/\b\d{2,4}\s*[×x]\s*\d{2,4}\b/g, "")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function captureSelectionAsImage(viewRect /* {x,y,width,height} */) {
  const x = Math.round(viewRect.x + window.scrollX);
  const y = Math.round(viewRect.y + window.scrollY);
  const width = Math.max(1, Math.round(viewRect.width));
  const height = Math.max(1, Math.round(viewRect.height));

  // Ask html2canvas to capture exactly that rectangle.
  const shot = await html2canvas(document.body, {
    x, y, width, height,
    scale: 1,
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  return shot.toDataURL("image/png");
}


async function callChat(messages, signal) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    signal,
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      top_p: 0.1,
      messages,
      stream: false,
    }),
  });
  if (!resp.ok) {
    let detail = "";
    try {
      const payload = await resp.clone().json();
      detail = payload?.error ? `: ${payload.error}` : "";
    } catch {}
    throw new Error(`assistant_failed_${resp.status}${detail}`);
  }
  const data = await resp.json();
  return extractChatText(data) || "No response.";
}

function extractChatText(payload) {
  if (typeof payload === "string") return payload;
  return String(
    payload?.result ||
    payload?.answer ||
    payload?.content ||
    payload?.message ||
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    ""
  );
}

function extractStreamToken(parsed) {
  if (typeof parsed === "string") return parsed;
  return String(
    parsed?.choices?.[0]?.delta?.content ||
    parsed?.delta?.content ||
    parsed?.content ||
    parsed?.token ||
    ""
  );
}

async function streamChat(messages, { signal, onToken } = {}) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    signal,
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      top_p: 0.1,
      max_tokens: 1800,
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    if (resp.status === 400) return callChat(messages, signal);
    let detail = "";
    try {
      const payload = await resp.clone().json();
      detail = payload?.error ? `: ${payload.error}` : "";
    } catch {}
    throw new Error(`assistant_failed_${resp.status}${detail}`);
  }
  if (!resp.body) return callChat(messages, signal);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const processEvent = (eventText) => {
    const dataLines = eventText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const token = extractStreamToken(parsed);
        if (token) {
          fullText += token;
          onToken?.(token, fullText);
        }
      } catch {
        // Ignore malformed partial SSE frames; the next chunk usually completes them.
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || "";
    for (const eventText of events) processEvent(eventText);
  }

  buffer += decoder.decode();
  if (buffer.trim()) processEvent(buffer);
  return fullText.trim();
}


/* --------------------------- Markdown Rendering ---------------------------- */

const sanitizedSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "u", "mark", "img"],
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...(defaultSchema.attributes?.img || []),
      "src", "alt", ["width", "number"], ["height", "number"],
    ],
  },
  protocols: {
    ...(defaultSchema.protocols || {}),
    src: ["http", "https", "data"], // enable data: for <img src="data:...">
  },
};


const mdComponents = {
  h1: ({ children }) => <h1 className="text-2xl font-bold mt-2 mb-3">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold mt-2 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-2 mb-2">{children}</h3>,
  h4: ({ children }) => <h4 className="text-base font-semibold mt-2 mb-2">{children}</h4>,
  p:  ({ children }) => <p className="text-sm leading-relaxed mb-3">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  u: ({ children }) => <u className="underline underline-offset-2">{children}</u>,
  mark: ({ children }) => <mark className="bg-yellow-100 rounded px-1">{children}</mark>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-neutral-300 pl-3 italic text-neutral-700 my-3">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-auto my-3">
      <table className="w-full text-sm border border-neutral-200 rounded">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-neutral-100">{children}</thead>,
  th: ({ children }) => <th className="text-left px-2 py-1 border-b border-neutral-200">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 border-b border-neutral-200 align-top">{children}</td>,
  pre: ({ children }) => (
    <pre className="text-[0.825rem] bg-neutral-900 text-neutral-100 p-3 rounded-lg overflow-auto my-3">
      {children}
    </pre>
  ),
  code({ inline, children }) {
    if (inline) {
      return <code className="px-1 py-0.5 text-[0.825rem] bg-neutral-200 rounded">{children}</code>;
    }
    return <code>{children}</code>;
  }
};

// Forced light table styles for content rendered inside the blue user bubble
// Forced light table styles for content rendered inside the blue user bubble
const mdComponentsUser = {
  ...mdComponents,
  table: ({ children }) => (
    <div className="overflow-auto my-3">
      <table className="w-full text-sm bg-[#F6F1FF] border border-[#E5DBFF] rounded">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#EFE6FF]">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left px-2 py-1 border-b border-[#E5DBFF] text-neutral-900">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 border-b border-[#E5DBFF] align-top text-neutral-900">
      {children}
    </td>
  ),
};

const STYLE_GENERAL_ASSISTANT = `
You are xHandle Copilot, a helpful general-purpose AI assistant inside xHandle.
Answer normal questions directly and naturally, including everyday questions that do not require project context.
Use the available xHandle workspace context when the user asks about their project, requirements, architecture, safety analysis, files, or traceability.
If current workspace data is missing for a project-specific request, briefly say what is missing and offer a practical next step.
If a question asks for current date or time, use the runtime context provided in this system message.
If you are uncertain, say so plainly without forcing a fixed refusal format.
`;

/* ------------------------------ Toolbar stuff ----------------------------- */

function applyWrap(textarea, before, after = before) {
  const el = textarea;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const sel = el.value.slice(start, end) || "";
  const next = el.value.slice(0, start) + before + sel + after + el.value.slice(end);
  const caret = start + before.length + sel.length + after.length;
  el.value = next;
  el.focus();
  el.setSelectionRange(caret, caret);
  return next;
}

function insertAtLineStart(textarea, prefix) {
  const el = textarea;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const value = el.value;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end);
  const endPos = lineEnd === -1 ? value.length : lineEnd;
  const chunk = value.slice(lineStart, endPos);
  const withPrefix = chunk
    .split("\n")
    .map(l => (l.startsWith(prefix) ? l : `${prefix}${l || ""}`))
    .join("\n");
  const next = value.slice(0, lineStart) + withPrefix + value.slice(endPos);
  el.value = next;
  el.focus();
  const caret = lineStart + withPrefix.length;
  el.setSelectionRange(caret, caret);
  return next;
}

function MarkdownToolbar({ onChange, textareaRef }) {
  const click = (fn) => (e) => {
    e.preventDefault();
    if (!textareaRef.current) return;
    const next = fn(textareaRef.current);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1 border rounded-md p-1 bg-white">
      <button className="p-2 rounded hover:bg-neutral-100" title="Bold" onClick={click(el => applyWrap(el, "**"))}><Bold className="w-4 h-4" /></button>
      <button className="p-2 rounded hover:bg-neutral-100" title="Italic" onClick={click(el => applyWrap(el, "*"))}><Italic className="w-4 h-4" /></button>
      <button className="p-2 rounded hover:bg-neutral-100" title="Underline" onClick={click(el => applyWrap(el, "<u>", "</u>"))}><Underline className="w-4 h-4" /></button>
      <span className="w-px h-5 bg-neutral-200 mx-1" />
      <button className="p-2 rounded hover:bg-neutral-100" title="H2" onClick={click(el => insertAtLineStart(el, "## "))}><Heading2 className="w-4 h-4" /></button>
      <button className="p-2 rounded hover:bg-neutral-100" title="H3" onClick={click(el => insertAtLineStart(el, "### "))}><Heading3 className="w-4 h-4" /></button>
      <span className="w-px h-5 bg-neutral-200 mx-1" />
      <button className="p-2 rounded hover:bg-neutral-100" title="Bulleted list" onClick={click(el => insertAtLineStart(el, "- "))}><ListIcon className="w-4 h-4" /></button>
      <button className="p-2 rounded hover:bg-neutral-100" title="Numbered list" onClick={click(el => insertAtLineStart(el, "1. "))}><ListOrdered className="w-4 h-4" /></button>
      <button className="p-2 rounded hover:bg-neutral-100" title="Checklist" onClick={click(el => insertAtLineStart(el, "- [ ] "))}><CheckSquare className="w-4 h-4" /></button>
      <span className="w-px h-5 bg-neutral-200 mx-1" />
      <button className="p-2 rounded hover:bg-neutral-100" title="Inline code" onClick={click(el => applyWrap(el, "`"))}><Code2 className="w-4 h-4" /></button>
      <button className="p-2 rounded hover:bg-neutral-100" title="Table template" onClick={click(el => {
        const tpl = "\n| Col A | Col B |\n| --- | --- |\n|  |  |\n";
        el.setRangeText(tpl, el.selectionStart, el.selectionEnd, "end");
        const next = el.value;
        el.focus();
        onChange(next);
        return next;
      })}><TableIcon className="w-4 h-4" /></button>
    </div>
  );
}

/* ----------------------- Turn grouping (inline layout) --------------------- */

function groupTurns(msgs = []) {
  const groups = [];
  let current = null;
  msgs.forEach((m, messageIndex) => {
    if (m.role === "user") {
      if (current) groups.push(current);
      current = { user: { ...m, messageIndex }, assistant: [] };
    } else {
      if (!current) current = { user: null, assistant: [] };
      current.assistant.push({ ...m, messageIndex });
    }
  });
  if (current) groups.push(current);
  return groups;
}

function MessageInlineEditor({
  value,
  onChange,
  onSave,
  onCancel,
  variant = "assistant",
  actionLabel,
  helperText,
  disabled = false,
}) {
  const isUser = variant === "user";
  const submitLabel = actionLabel || (isUser ? "Send" : "Save");
  const submitHelp = helperText || (isUser ? "Cmd/Ctrl+Enter to send, Esc to cancel" : "Cmd/Ctrl+Enter to save, Esc to cancel");
  return (
    <div className="space-y-2">
      <textarea
        className={[
          "w-full rounded-lg border px-3 py-2 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 min-h-[120px]",
          isUser
            ? "border-indigo-200 bg-white text-neutral-900 focus:ring-white/70"
            : "border-neutral-300 bg-white text-neutral-900 focus:ring-indigo-200",
        ].join(" ")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!disabled) onSave();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={[
            "rounded-md border px-2.5 py-1 text-xs font-medium transition",
            isUser
              ? "border-white/60 bg-transparent text-white hover:bg-white/10"
              : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
          ].join(" ")}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || !String(value || "").trim()}
          className={[
            "rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
            isUser
              ? "bg-white text-indigo-700 hover:bg-indigo-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700",
          ].join(" ")}
        >
          {submitLabel}
        </button>
      </div>
      <div className={isUser ? "text-[11px] text-indigo-100" : "text-[11px] text-neutral-500"}>
        {submitHelp}
      </div>
    </div>
  );
}

function HoverActionButton({ title, onClick, children, className = "" }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={[
        "inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-900 shadow-sm",
        "hover:bg-neutral-100 h-7 w-7 transition",
        className,
      ].join(" ")}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

// ---------- Prompt → Scope parsing ----------
function readProjectsFromLS() {
  try { return JSON.parse(localStorage.getItem("xhandle.projects") || "[]"); }
  catch { return []; }
}

function parseScopeFromPrompt(text = "") {
  const t = String(text);
  const areas = new Set();

  if (/\bconsole\b/i.test(t)) areas.add("console");
  if (/\bproject manager\b|\bprogram manager\b|\bpm\b/i.test(t)) areas.add("pm");
  if (/\brisk register\b|\brisks?\b|\bfmea\b|\bstpa\b|\bhazard\b|\bsafety risk\b|\brisk\s*summary\b/i.test(t)) areas.add("risk");
  if (/\brequirements?\b|\breqs?\b/i.test(t)) areas.add("requirements");
  if (/\bcode[-\s]?based architecture\b|\bcode\s*architecture\b|\bcba\b/i.test(t)) areas.add("cba");
  if (/\bfunctional\s+decomposition\b|\bfunctions?\b/i.test(t)) areas.add("functional");

  const fileMatch = t.match(/([A-Za-z0-9_\-./]+?\.(?:jsx?|tsx?|json|py|c|cc|cpp|h|md))/i);
  const filePath = fileMatch ? fileMatch[1] : null;

  const projects = readProjectsFromLS();
  let project = null;
  const m = t.match(/\bproject\s*:\s*["']?([^"'\n]+)["']?/i) ||
            t.match(/\bfor project\s+["']?([^"'\n]+)["']?/i);
  let projectName = m && m[1] ? m[1].trim() : null;
  if (!projectName && projects.length) {
    for (const p of projects) {
      const re = new RegExp(`\\b${p.name}\\b`, "i");
      if (re.test(t)) { projectName = p.name; break; }
    }
  }
  if (projectName) {
    project = projects.find(p => (p.name || "").toLowerCase() === projectName.toLowerCase()) || null;
  }

  return { areas: Array.from(areas), project, filePath };
}

/* ---- CBA hydration + formatting (auto-grounding) ------------------------- */

function lsKeys() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return keys;
  } catch { return []; }
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

function readCBAFromLocalStorage(repoLike) {
  const rows = [];
  for (const k of lsKeys()) {
    if (!k.startsWith("cba:")) continue;
    if (repoLike && !k.toLowerCase().includes(repoLike.toLowerCase())) continue;
    const v = safeParse(localStorage.getItem(k));
    if (Array.isArray(v)) rows.push(...v);
  }
  return rows;
}

function mergeAutoContext(baseCtx, scope) {
  const ctx = { ...baseCtx };
  const repoLike = ctx?.projectHint?.owner && ctx?.projectHint?.repo
    ? `${ctx.projectHint.owner}/${ctx.projectHint.repo}` : undefined;

  const wantsCBA = !(scope?.areas?.length) || (scope?.areas || []).includes("cba");
  if (wantsCBA) {
    if (!Array.isArray(ctx.codeArchitecture) || ctx.codeArchitecture.length === 0) {
      const cba = readCBAFromLocalStorage(repoLike);
      if (cba.length) ctx.codeArchitecture = cba;
    }
  }

  return ctx;
}

function formatCBAEdges(rows, max = 25) {
  const out = [];
  for (const r of rows.slice(0, max)) {
    const from = r.from || r.source || "Unknown";
    const to = r.to || r.target || "Unknown";
    const action = r.action || r.controlAction || "rel";
    const fromFile = r.fromFile ? ` [${r.fromFile}]` : "";
    const toFile = r.toFile ? ` [${r.toFile}]` : "";
    out.push(`${from} --${action}--> ${to}${fromFile}${toFile}`);
  }
  return out;
}

function cbaGuardNote(ctx, scope) {
  const askedForCBA = (scope?.areas || []).includes("cba");
  const canonicalCbaCount = (ctx.relevantArtifacts || []).filter(
    artifact => ["code_architecture_edge", "repository", "source_file"].includes(artifact?.type)
  ).length;
  if (askedForCBA && canonicalCbaCount === 0 && (!ctx.codeArchitecture || ctx.codeArchitecture.length === 0)) {
    return "\nImportant: User asked about Code-Based Architecture, but no CBA rows were found in scope. If you cannot locate CBA data, say so explicitly instead of speculating.";
  }
  return "";
}

function repoLikeFromHint(hint) {
  return hint?.owner && hint?.repo ? `${hint.owner}/${hint.repo}` : undefined;
}

function readIndexedFileFromLocalStorage(repoLike, path) {
  if (!path) return null;
  const key = repoLike ? `code:file:${repoLike}:${path}` : `code:file:${path}`;
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function makeFileGrounding(fileRec, maxBytes = 3500) {
  const lang = fileRec?.lang || "";
  const functions = Array.isArray(fileRec?.functions) ? fileRec.functions.join(", ") : "unknown";
  const exportsList = Array.isArray(fileRec?.exports) ? fileRec.exports.join(", ") : "unknown";
  const content = (fileRec?.content || "").slice(0, maxBytes);
  return [
    `Grounding — File: ${fileRec.path} (${lang || "text"})`,
    `Functions: ${functions}`,
    `Exports: ${exportsList}`,
    "",
    "Excerpt:",
    "```" + lang,
    content,
    "```"
  ].join("\n");
}

const SCOPE_ARTIFACT_TYPES = {
  requirements: new Set(["requirement", "sysml_requirement"]),
  risk: new Set(["risk", "hazard_analysis_row", "safety_finding", "safety_case", "safety_case_node"]),
  cba: new Set(["code_architecture_edge", "repository", "source_file"]),
  functional: new Set(["functional_decomposition_row", "sysml_element"]),
  review: new Set(["review_item", "patch_proposal"]),
};

function buildScopedContext(base, scope) {
  if (!base) return base;
  const scoped = { ...base };
  const wants = new Set(scope?.areas || []);

  if (Array.isArray(scoped.relevantArtifacts)) {
    if (scope?.project) {
      const pid = String(scope.project.id);
      scoped.relevantArtifacts = scoped.relevantArtifacts.filter(
        artifact => !artifact?.projectId || String(artifact.projectId) === pid
      );
      scoped.projects = (scoped.projects || []).filter(
        project => !project?.id || String(project.id) === pid
      );
    }

    if (wants.size) {
      const allowedTypes = new Set();
      wants.forEach((area) => {
        SCOPE_ARTIFACT_TYPES[area]?.forEach((type) => allowedTypes.add(type));
      });
      if (allowedTypes.size) {
        scoped.relevantArtifacts = scoped.relevantArtifacts.filter(
          artifact => allowedTypes.has(artifact?.type)
        );
      }
    }

    const artifactIds = new Set((scoped.relevantArtifacts || []).map(artifact => artifact.id));
    scoped.relationships = (scoped.relationships || []).filter(
      rel => artifactIds.has(rel.fromArtifactId) || artifactIds.has(rel.toArtifactId)
    );
    scoped.citations = (scoped.citations || []).filter(
      citation => !citation.artifactId || artifactIds.has(citation.artifactId)
    );
    scoped.__scopeNote = {
      areas: scope?.areas || [],
      project: scope?.project ? { id: scope.project.id, name: scope.project.name } : null
    };
    return scoped;
  }

  if (scope?.project) {
    const pid = String(scope.project.id);
    if (Array.isArray(scoped.requirements)) {
      scoped.requirements = scoped.requirements.filter(r => !r?.projectId || String(r.projectId) === pid);
    }
    if (scoped.project?.id && String(scoped.project.id) !== pid) {
      scoped.project = { id: scope.project.id, name: scope.project.name };
    }
  }

  if (wants.size) {
    const onlyUiView = [...wants].every(a => a === "console" || a === "copilot");
    if (!onlyUiView) {
      if (!wants.has("requirements")) scoped.requirements = [];
      if (!wants.has("risk")) { scoped.riskRegister = []; scoped.riskSummarySheet = []; }
      if (!wants.has("cba")) scoped.codeArchitecture = [];
      if (!wants.has("functional")) scoped.functionalDecomposition = [];
    }
  }

  scoped.__scopeNote = {
    areas: scope?.areas || [],
    project: scope?.project ? { id: scope.project.id, name: scope.project.name } : null
  };
  return scoped;
}

/* ------------------------------ Main Component ---------------------------- */

export default function XHandleCopilotView({
  projectHint,
  copilotContext,
  appFocus,
  docked = false,
  onRequestDock,
  onRequestUndock,
  defaultSidebarOpen = true,
  isDark = false,
}) {
  const enrichedContext = useMemo(
    () => ({ ...copilotContext, projectHint: projectHint || copilotContext?.projectHint, focus: appFocus || copilotContext?.focus }),
    [copilotContext, projectHint, appFocus]
  );

  // add state
const [ctxEditorOpen, setCtxEditorOpen] = useState(false);
const [ctxDraft, setCtxDraft] = useState(null); // { id, text?, tableMarkdown?, imageDataUrl? }
const fileInputRef = useRef(null);

// open editor for a chip
function openCtxEditor(c) {
  // clone so we don’t mutate live state while editing
  setCtxDraft(JSON.parse(JSON.stringify(c)));
  setCtxEditorOpen(true);
}

// save edits back into regionContexts
function saveCtxEditor() {
  if (!ctxDraft) return;
  setRegionContexts(prev => prev.map(x => x.id === ctxDraft.id ? ctxDraft : x));
  setCtxEditorOpen(false);
  setCtxDraft(null);
}

function cancelCtxEditor() {
  setCtxEditorOpen(false);
  setCtxDraft(null);
}

  const [threads, setThreads] = useState(() => {
    const t = loadThreads();
    if (t.length) return t;
    newThread("Welcome");
    return loadThreads();
  });
  const [activeId, setActiveId] = useState(() => (loadThreads()[0] || {}).id);
  const active = useMemo(() => threads.find(t => t.id === activeId), [threads, activeId]);
  const [regionContexts, setRegionContexts] = useState([]);
  // items like { id, text?, tableMarkdown?, imageDataUrl? }

  const [input, setInput] = useState("");
  const [editingMessage, setEditingMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen && !docked);

  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const [autoStick, setAutoStick] = useState(true);

  const handleScroll = (e) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 160;
    setAutoStick(nearBottom);
  };

  const titlingRef = useRef(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    const onProjectsUpdated = () => {};
    window.addEventListener("xhandle:projects-updated", onProjectsUpdated);
    return () => window.removeEventListener("xhandle:projects-updated", onProjectsUpdated);
  }, []);

  // Hotkey: Cmd/Ctrl + Shift + C requests (un)dock
  useEffect(() => {
    const onKey = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        try {
          window.dispatchEvent(new CustomEvent('xhandle:copilot-dock-open'));
        } catch {}
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hotkey: Cmd/Ctrl + \ toggles left threads (only when not docked)
  useEffect(() => {
    const onKey = (e) => {
      if (docked) return;
      const isMod = e.metaKey || e.ctrlKey;
      const isBackslash = e.key === "\\" || e.code === "Backslash";
      if (isMod && isBackslash) {
        e.preventDefault();
        setSidebarOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docked]);

  useEffect(() => { saveThreads(threads); }, [threads]);

  useEffect(() => {
    setEditingMessage(null);
  }, [activeId, docked]);

/* === NEW: capture region contexts only when docked === */
/* === capture region contexts only when docked === */
useEffect(() => {
  function onRegion(ev) {
    if (!docked) return;
    const { text, tableMarkdown, imageDataUrl } = ev.detail || {};
    const clean = sanitizeCapturedText(text);

    // store as discrete chips — do NOT append into textarea
    if (tableMarkdown) pushPendingContext({ tableMarkdown });
    if (clean)        pushPendingContext({ text: clean });
    if (imageDataUrl) pushPendingContext({ imageDataUrl });
  }

  // listen while this component is mounted
  window.addEventListener("xhandle:copilot-add-context", onRegion);

  // when we’re in the dock, pull any queued contexts and chip them
  if (docked) {
    const pending = popAllRegionContext();
    for (const p of pending) {
      const clean = sanitizeCapturedText(p.text);
      if (p.tableMarkdown) pushPendingContext({ tableMarkdown: p.tableMarkdown });
      if (clean)           pushPendingContext({ text: clean });
      if (p.imageDataUrl)  pushPendingContext({ imageDataUrl: p.imageDataUrl });
    }
  }

  return () => window.removeEventListener("xhandle:copilot-add-context", onRegion);
}, [docked]);

  function makeThread(title) {
    newThread(title || "New topic");
    const all = loadThreads();
    setThreads(all);
    setActiveId(all[0].id);
  }
  function doRename(id) {
    const title = window.prompt("Thread title:", threads.find(t => t.id === id)?.title || "");
    if (title) { renameThread(id, title); setThreads(loadThreads()); }
  }
  function doDelete(id) {
    if (!window.confirm("Delete this thread?")) return;
    deleteThread(id);
    const all = loadThreads();
    setThreads(all);
    if (!all.find(t => t.id === activeId) && all.length) setActiveId(all[0].id);
  }
  function doPin(id) { togglePin(id); setThreads(loadThreads()); }

  async function copyText(text) {
    const value = String(text || "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  function startInlineEdit(messageIndex, content) {
    setEditingMessage({
      messageIndex,
      draft: String(content || ""),
    });
  }

  function cancelInlineEdit() {
    setEditingMessage(null);
  }

  function updateEditingDraft(draft) {
    setEditingMessage((prev) => (prev ? { ...prev, draft } : prev));
  }

  function saveInlineEdit() {
    const editSession = editingMessage;
    if (!active?.id || editSession?.messageIndex == null) return;
    const updatedMessages = (active.messages || []).map((message, index) => (
      index === editSession.messageIndex
        ? { ...message, content: editSession.draft ?? "" }
        : message
    ));
    setMessages(active.id, updatedMessages);
    setThreads(loadThreads());
    setEditingMessage(null);
  }

  async function sendInlinePromptEdit() {
    const editSession = editingMessage;
    if (!active?.id || editSession?.messageIndex == null || busy) return;
    const revisedContent = String(editSession.draft ?? "");
    if (!revisedContent.trim()) return;

    const revisedMessages = (active.messages || [])
      .slice(0, editSession.messageIndex + 1)
      .map((message, index) => (
        index === editSession.messageIndex
          ? { ...message, content: revisedContent }
          : message
      ));

    setMessages(active.id, revisedMessages);
    setThreads(loadThreads());
    setEditingMessage(null);

    await runCopilot(revisedContent);
  }

  async function handleSend() {
    if ((!input.trim() && regionContexts.length === 0) || !active) return;

    // Build a single markdown block from selected contexts
    const contextBlob = regionContexts.map((c, idx) => {
      if (c.tableMarkdown) return `**Selection (table ${idx+1}):**\n\n${c.tableMarkdown}`;
      if (c.text)          return `**Selection (text ${idx+1}):**\n\n${c.text}`;
      if (c.imageDataUrl)  return `**Selection (image ${idx+1}):**\n\n![selection](${c.imageDataUrl})`;
      return "";
    }).filter(Boolean).join("\n\n");

    const content = [contextBlob, input.trim()].filter(Boolean).join("\n\n");

    const userMsg = { role: "user", content };
    setInput("");
    setRegionContexts([]);        // clear chips after send

    appendMessage(active.id, userMsg);
    setThreads(loadThreads());

    await runCopilot(userMsg.content);
  }


  async function runCopilot(userText) {
    setBusy(true);
    try {
      const scope = parseScopeFromPrompt(userText);
      const activeProjectId =
        scope?.project?.id ||
        appFocus?.activeProjectId ||
        enrichedContext?.project?.id ||
        enrichedContext?.workspace?.activeProjectId ||
        null;
      let graphContext = enrichedContext;
      try {
        graphContext = await buildWorkspaceLLMContext({
          projectId: activeProjectId,
          activeView: appFocus || enrichedContext?.focus || {},
          query: userText,
          tokenBudget: 5000,
        });
        graphContext.projectHint = projectHint || enrichedContext?.projectHint;
      } catch (error) {
        graphContext = {
          ...enrichedContext,
          diagnostics: {
            ...(enrichedContext?.diagnostics || {}),
            workspaceGraphContextError: error?.message || String(error),
          },
        };
      }

      let scoped = buildScopedContext(graphContext, scope);
      scoped = mergeAutoContext(scoped, scope);
      scoped.lastUserPrompt = userText;
      const note = scoped?.__scopeNote
        ? `\nScope: areas=${(scoped.__scopeNote.areas || []).join(", ") || "all"}, project=${scoped.__scopeNote.project?.name || "active"}`
        : "";
      const cbaLines = Array.isArray(scoped.codeArchitecture) && scoped.codeArchitecture.length
        ? `\n\nGrounding — Code Architecture edges (first 25):\n${formatCBAEdges(scoped.codeArchitecture, 25).join("\n")}`
        : "";
      const guard = cbaGuardNote(scoped, scope);
      const repoLike = repoLikeFromHint(scoped?.projectHint);
      const canonicalFile = scope?.filePath
        ? (scoped.sourceFiles || []).find(file => file?.path === scope.filePath || file?.path?.endsWith(`/${scope.filePath}`))
        : null;
      const fileRec = canonicalFile || (scope?.filePath ? readIndexedFileFromLocalStorage(repoLike, scope.filePath) : null);
      const fileGrounding = fileRec ? `\n\n${makeFileGrounding(fileRec)}` : "";
      const fileGuard = scope?.filePath && !fileRec
        ? `\nImportant: User asked about ${scope.filePath}, but no indexed file was found. Do not speculate; ask the user to sync/index the repository so this file can be read.`
        : "";
      const runtimeNow = new Date();
      const runtimeContext = `

Runtime context:
- Current local date and time: ${runtimeNow.toLocaleString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })}
- Current ISO timestamp: ${runtimeNow.toISOString()}
- Current timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown"}
`;

        const systemMsg = {
          role: "system",
          content: `${runtimeContext}${renderCopilotContext(scoped)}${note}${cbaLines}${guard}${fileGrounding}${fileGuard}

        Style:
        ${STYLE_GENERAL_ASSISTANT}`
        };

      const t = loadThreads().find(t => t.id === activeId);
      const messages = [systemMsg, ...compactPromptHistory(t?.messages || [])];

      appendMessage(activeId, { role: "assistant", content: "" });
      setThreads(loadThreads());

      let lastCommitAt = 0;
      const updateAssistant = (content, force = false) => {
        const now = Date.now();
        if (!force && now - lastCommitAt < 80) return;
        lastCommitAt = now;
        const current = loadThreads();
        const thread = current.find((entry) => entry.id === activeId);
        if (!thread) return;
        const messages = [...(thread.messages || [])];
        const lastIndex = messages.length - 1;
        if (lastIndex < 0 || messages[lastIndex]?.role !== "assistant") return;
        messages[lastIndex] = { ...messages[lastIndex], content };
        setMessages(activeId, messages);
        setThreads(loadThreads());
      };

      const answer = await streamChat(messages, {
        onToken: (_token, fullText) => updateAssistant(fullText),
      });
      updateAssistant(answer || "No response.", true);
    } catch {
      appendMessage(activeId, { role: "assistant", content: "Sorry — I hit an issue generating a reply. Check server logs and try again." });
      setThreads(loadThreads());
    } finally {
      setBusy(false);
    }
  }


  function pushPendingContext(ctx) {
    const id = crypto?.randomUUID?.() || String(Date.now() + Math.random());
    setRegionContexts(prev => [...prev, { id, ...ctx }]);
  }

  function clearThread() {
    if (!active) return;
    setMessages(active.id, [{ role: "assistant", content: "Thread cleared. Ask away!" }]);
    setThreads(loadThreads());
  }

  // Auto-title after ≥2 user turns, once per thread
  useEffect(() => {
    const t = threads.find((x) => x.id === activeId);
    if (!t) return;
    const userTurns = countUserMsgs(t.messages);
    const isGeneric = !t.title || /^(welcome|new topic|untitled|copilot thread)/i.test(t.title);
    if (titlingRef.current || t.autoTitleDone || userTurns < 2 || !isGeneric) return;

    (async () => {
      try {
        titlingRef.current = true;
        const title = await generateThreadTitle(t.messages);
        const all = loadThreads();
        const idx = all.findIndex((x) => x.id === t.id);
        if (idx >= 0) {
          all[idx].title = title && title.length >= 6 ? title : (all[idx].title || "General Collaborator Chat");
          all[idx].autoTitleDone = true;
          all[idx].updatedAt = Date.now();
          saveThreads(all);
          setThreads(all);
        }
      } catch {
        const all = loadThreads();
        const idx = all.findIndex((x) => x.id === t.id);
        if (idx >= 0) { all[idx].autoTitleDone = true; saveThreads(all); setThreads(all); }
      } finally {
        titlingRef.current = false;
      }
    })();
  }, [threads, activeId]);

  useEffect(() => {
    if (!autoStick) return;
    const t = requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => cancelAnimationFrame(t);
  }, [
    active?.messages?.length,
    busy,
    autoStick,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const t = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(t);
  }, [activeId]);

  /* ---------------------------------- UI ---------------------------------- */

  const userBubbleMax = docked ? "max-w-[48ch]" : "max-w-[55ch]";
  const asstH1 = docked ? "text-lg" : "text-xl";
  const asstH2 = docked ? "text-base" : "text-lg";
  const userH1 = docked ? "text-base" : "text-lg";
  const userH2 = docked ? "text-sm"  : "text-base";
  const userP  = docked ? "text-[13px]" : "text-[13px]";

  return (
    <div className={isDark ? "dark contents" : "contents"}>
      {/* Full view (embedded page) */}
      {!docked && (
        <div className="w-full max-w-none h-[calc(100dvh-40px)] flex bg-white">
          {/* LEFT: Threads list */}
          {sidebarOpen && (
            <div className="w-[280px] shrink-0 border-r h-full flex flex-col">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="w-5 h-5 text-indigo-600" />
                  <div className="font-semibold">Collaborator Threads</div>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {threads
                  .slice()
                  .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
                  .map(t => (
                    <div
                      key={t.id}
                      className={`px-3 py-2 border-b cursor-pointer ${t.id === activeId ? "bg-indigo-50" : "hover:bg-neutral-50"}`}
                      onClick={() => setActiveId(t.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm line-clamp-1">{t.title}</div>
                        <div className="flex items-center gap-1">
                          <button className="p-1 rounded hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); doPin(t.id); }} title={t.pinned ? "Unpin" : "Pin"}>
                            {t.pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
                          </button>
                          <button className="p-1 rounded hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); doRename(t.id); }} title="Rename">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button className="p-1 rounded hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); doDelete(t.id); }} title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1">
                        {new Date(t.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="px-3 py-2 border-t">
  <button
    className="w-full inline-flex items-center justify-center gap-2 text-xs px-3 py-2 rounded border hover:bg-neutral-50"
    onClick={() => makeThread("New topic")}
    title="New thread"
  >
    <Plus className="w-4 h-4" /> New Thread
  </button>
  <div className="h-4 md:h-6" aria-hidden="true" />
</div>

            </div>
          )}

          {/* RIGHT: Conversation */}
          <div className="flex-1 min-w-0 h-full flex flex-col">
            <div className="copilot-header px-6 py-3 border-b flex items-center justify-between bg-[#F8FAFC]">
              <div className="flex items-center gap-2 text-sm text-neutral-700">
                <button
                  onClick={() => setSidebarOpen((s) => !s)}
                  className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded border hover:bg-neutral-50"
                  title={sidebarOpen ? "Hide threads (⌘/Ctrl+\\)" : "Show threads (⌘/Ctrl+\\)"}
                >
                  {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
                  {sidebarOpen ? "Hide Threads" : "Show Threads"}
                </button>
                <span className="text-neutral-600">{active ? active.title : "No thread selected"}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (typeof onRequestDock === "function") onRequestDock();
                    else try { window.dispatchEvent(new CustomEvent("xhandle:copilot-dock-open")); } catch {}
                  }}
                  className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded border hover:bg-neutral-50"
                  title="Dock Collaborator to right sidebar (⌘/Ctrl+Shift+C)"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                  Dock
                </button>

                <button
                  onClick={clearThread}
                  disabled={!active}
                  className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded border hover:bg-neutral-50"
                >
                  <Trash2 className="w-4 h-4" /> Clear
                </button>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <History className="w-4 h-4" /> Auto-saves
                </div>
              </div>
            </div>

            {/* Conversation */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="relative flex-1 min-w-0 overflow-auto px-6 pt-4 pb-10 space-y-3"
              >
              {groupTurns(active?.messages).map((turn, idx) => (
                <div key={idx} className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                  {turn.user ? (
                    <div className="px-4 py-3 border-b bg-neutral-50">
                      <div className="w-full flex justify-end">
                        <div className={`${userBubbleMax} group relative w-full bg-indigo-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm shadow`}>
                          <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 flex items-center gap-1">
                            <HoverActionButton
                              title="Edit prompt"
                              onClick={() => startInlineEdit(turn.user.messageIndex, turn.user.content)}
                              className="border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </HoverActionButton>
                            <HoverActionButton
                              title="Copy prompt"
                              onClick={() => copyText(turn.user.content)}
                              className="border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </HoverActionButton>
                          </div>
                          {editingMessage?.messageIndex === turn.user.messageIndex ? (
                            <MessageInlineEditor
                              value={editingMessage?.draft ?? ""}
                              onChange={updateEditingDraft}
                              onSave={sendInlinePromptEdit}
                              onCancel={cancelInlineEdit}
                              variant="user"
                              actionLabel="Send"
                              helperText="Cmd/Ctrl+Enter to send, Esc to cancel"
                              disabled={busy}
                            />
                          ) : (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[[rehypeSanitize, sanitizedSchema]]}
                              components={{
                                ...mdComponentsUser,
                                h1: ({ children }) => <h1 className={`${userH1} font-bold mt-1 mb-2`}>{children}</h1>,
                                h2: ({ children }) => <h2 className={`${userH2} font-semibold mt-1 mb-2`}>{children}</h2>,
                                p:  ({ children }) => <p className={`${userP} leading-relaxed mb-2`}>{children}</p>,
                              }}
                            >
                              {String(turn.user.content || "")}
                            </ReactMarkdown>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="px-4 py-3 space-y-2">
                    {(turn.assistant.length ? turn.assistant : [{ role: "assistant", content: "" }]).map((am, i) => (
                      <div key={i} className="group relative max-w-none">
                        <div className="absolute right-0 top-0 opacity-0 transition group-hover:opacity-100 flex items-center gap-1">
                          <HoverActionButton
                            title="Copy response"
                            onClick={() => copyText(am.content)}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </HoverActionButton>
                        </div>
                        {editingMessage && editingMessage.messageIndex === am.messageIndex ? (
                          <MessageInlineEditor
                            value={editingMessage?.draft ?? ""}
                            onChange={updateEditingDraft}
                            onSave={saveInlineEdit}
                            onCancel={cancelInlineEdit}
                          />
                        ) : (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[[rehypeSanitize, sanitizedSchema]]}
                            components={{
                              ...mdComponents,
                              h1: ({ children }) => <h1 className={`${asstH1} font-bold mt-1 mb-2`}>{children}</h1>,
                              h2: ({ children }) => <h2 className={`${asstH2} font-semibold mt-1 mb-2`}>{children}</h2>,
                              p:  ({ children }) => <p className="text-sm leading-relaxed mb-2">{children}</p>,
                              ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-4 border-neutral-300 pl-3 italic text-neutral-700 my-2">
                                  {children}
                                </blockquote>
                              )
                            }}
                          >
                            {String(am.content || "")}
                          </ReactMarkdown>
                        )}
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
              <div ref={endRef} />
              {!autoStick && (
                <button
                  onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
                  className="absolute bottom-24 right-6 p-2 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700"
                  title="Jump to latest response"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Compose Area with Markdown Toolbar */}
            <div className="p-4 border-t bg-white">
              <div className="mb-2">
                <MarkdownToolbar onChange={setInput} textareaRef={textareaRef} />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <textarea
                    ref={textareaRef}
                    className="w-full border rounded-lg px-3 py-2 text-sm h-24 resize-y focus:outline-none focus:ring focus:ring-indigo-200"
                    placeholder="Ask anything about your project..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={busy || !input.trim() || !active}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  <SendHorizonal className="w-4 h-4" />
                  Send
                </button>
              </div>
              <QuickSuggestions
                onPick={(text) => {
                  setInput(text);
                  try { textareaRef.current?.focus(); } catch {}
                }}
              />
              <div className="text-[11px] text-neutral-500 mt-1">
                Tip: Enter to send, Shift+Enter for a new line
              </div>
            </div>
            <div className="h-4 md:h-6" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Compact view (when rendered inside the dock by App.js) */}
      {docked && (
        <div className="h-full min-w-0 flex flex-col">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 min-w-0 overflow-auto p-3 pb-20 space-y-2"
          >
            {groupTurns(active?.messages).map((turn, idx) => (
              <div key={idx} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                {turn.user ? (
                  <div className="px-3 py-2 border-b bg-neutral-50">
                    <div className="w-full flex justify-end">
                      <div className={`${userBubbleMax} group relative w-full bg-indigo-600 text-white px-3 py-2 rounded-2xl rounded-tr-sm shadow`}>
                        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 flex items-center gap-1">
                          <HoverActionButton
                            title="Edit prompt"
                            onClick={() => startInlineEdit(turn.user.messageIndex, turn.user.content)}
                            className="border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </HoverActionButton>
                          <HoverActionButton
                            title="Copy prompt"
                            onClick={() => copyText(turn.user.content)}
                            className="border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </HoverActionButton>
                        </div>
                        {editingMessage?.messageIndex === turn.user.messageIndex ? (
                          <MessageInlineEditor
                            value={editingMessage?.draft ?? ""}
                            onChange={updateEditingDraft}
                            onSave={sendInlinePromptEdit}
                            onCancel={cancelInlineEdit}
                            variant="user"
                            actionLabel="Send"
                            helperText="Cmd/Ctrl+Enter to send, Esc to cancel"
                            disabled={busy}
                          />
                        ) : (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[[rehypeSanitize, sanitizedSchema]]}
                            components={{
                              ...mdComponentsUser,
                              h1: ({ children }) => <h1 className={`${userH1} font-bold mt-1 mb-1.5`}>{children}</h1>,
                              h2: ({ children }) => <h2 className={`${userH2} font-semibold mt-1 mb-1.5`}>{children}</h2>,
                              p:  ({ children }) => <p className="text-[13px] leading-relaxed mb-1.5">{children}</p>,
                            }}
                          >
                            {String(turn.user.content || "")}
                          </ReactMarkdown>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="px-3 py-2 space-y-1">
                  {(turn.assistant.length ? turn.assistant : [{ role: "assistant", content: "" }]).map((am, i) => (
                    <div key={i} className="group relative max-w-none">
                      <div className="absolute right-0 top-0 opacity-0 transition group-hover:opacity-100 flex items-center gap-1">
                        <HoverActionButton
                          title="Copy response"
                          onClick={() => copyText(am.content)}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </HoverActionButton>
                      </div>
                      {editingMessage && editingMessage.messageIndex === am.messageIndex ? (
                        <MessageInlineEditor
                          value={editingMessage?.draft ?? ""}
                          onChange={updateEditingDraft}
                          onSave={saveInlineEdit}
                          onCancel={cancelInlineEdit}
                        />
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[[rehypeSanitize, sanitizedSchema]]}
                          components={{
                            ...mdComponentsUser,
                            h1: ({ children }) => <h1 className="text-lg font-bold mt-1 mb-1.5">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-base font-semibold mt-1 mb-1.5">{children}</h2>,
                            p:  ({ children }) => <p className="text-[13px] leading-relaxed mb-1.5">{children}</p>,
                          }}
                        >
                          {String(am.content || "")}
                        </ReactMarkdown>
                      )}
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

            <div ref={endRef} />
          </div>

          <div className="border-t bg-white p-2">
    <div className="flex flex-col gap-2">
    {/* Pending context chips */}
{regionContexts.length > 0 && (
  <div className="mb-2">
    <div className="text-[11px] text-neutral-600 mb-1">
      Context to send ({regionContexts.length})
    </div>
    <div className="flex flex-wrap gap-1.5">
      {regionContexts.map(c => {
        return (
<button
  type="button"
  key={c.id}
  onClick={() => openCtxEditor(c)}
  className="inline-flex items-center gap-2 max-w-[220px] truncate px-2 py-1 rounded-full text-xs border bg-neutral-50 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
  title="Click to preview/edit"
>
  <span className="uppercase tracking-wide text-[10px] text-neutral-500">
    {c.tableMarkdown ? "table" : c.text ? "text" : "image"}
  </span>
  <span className="truncate">
    {c.tableMarkdown ? "|…table…" : c.text ? c.text.slice(0, 60) + (c.text.length > 60 ? "…" : "") : "screenshot"}
  </span>
  <button
    className="ml-1 rounded hover:bg-neutral-200 px-1"
    onClick={(e) => {
      e.stopPropagation(); // don’t open editor
      setRegionContexts(prev => prev.filter(x => x.id !== c.id));
    }}
    aria-label="Remove"
    title="Remove"
  >
    ✕
  </button>
</button>
        );
      })}
      <button
        className="ml-1 text-[11px] px-2 py-1 border rounded hover:bg-neutral-50"
        onClick={() => setRegionContexts([])}
        title="Clear all"
      >
        Clear all
      </button>
    </div>
  </div>
)}

    {/* Row 1: textarea gets the full width */}
    <div>
      <textarea
        ref={textareaRef}
        className="w-full border rounded-lg px-3 py-2 text-sm min-h-[84px] max-h-48 resize-y focus:outline-none focus:ring focus:ring-indigo-200"
        placeholder="Ask Collaborator..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
    </div>

    {/* Row 2: controls split left/right */}
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {/* Select Region */}
        <button
          type="button"
          onClick={() => {
            openRegionSelector({
              onDone: async (payload) => {
                const { bbox } = payload || {};
                if (bbox && bbox.width > 0 && bbox.height > 0) {
                  try {
                    const dataUrl = await captureSelectionAsImage(bbox);
                    pushRegionContext({ imageDataUrl: dataUrl }); // stash only; text is appended by the event listener
                  } catch {/* ignore */}
                }
              }
            });
          }}
          className="inline-flex items-center gap-2 px-2.5 py-1.5 text-sm border rounded-lg hover:bg-neutral-50"
          title="Select on-screen region to use as Collaborator context"
        >
          <Crosshair className="w-4 h-4" />
          Select
        </button>

      </div>

      {/* Right: primary action */}
      <button
        onClick={handleSend}
        disabled={busy || !input.trim() || !active}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
      >
        <SendHorizonal className="w-4 h-4" />
        Send
      </button>
    </div>

    {/* Row 3: tiny helper text */}
    <div className="text-[10px] text-neutral-500">Tip: Enter to send, Shift+Enter for a new line</div>
  </div>
</div>


        </div>
      )}
      {ctxEditorOpen && ctxDraft && (
  <div
    className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center"
    onKeyDown={(e) => { if (e.key === "Escape") cancelCtxEditor(); }}
  >
    <div className="bg-white w-full max-w-[680px] rounded-xl shadow-xl">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="font-semibold text-sm">
          Edit context — {ctxDraft.tableMarkdown ? "Table" : ctxDraft.text ? "Text" : "Image"}
        </div>
        <button className="text-sm px-2 py-1 rounded border hover:bg-neutral-50" onClick={cancelCtxEditor}>
          Close
        </button>
      </div>

      <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
        {/* TEXT / TABLE */}
        {(ctxDraft.text || ctxDraft.tableMarkdown) && (
          <div className="space-y-2">
            <label className="text-xs text-neutral-600 block">
              {ctxDraft.tableMarkdown ? "Table (Markdown)" : "Text"}
            </label>
            <textarea
              className="w-full border rounded-md p-2 text-sm min-h-[180px] focus:outline-none focus:ring focus:ring-indigo-200"
              value={ctxDraft.tableMarkdown ?? ctxDraft.text ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setCtxDraft(d => {
                  const next = { ...d };
                  if (d.tableMarkdown != null) next.tableMarkdown = v;
                  else next.text = v;
                  return next;
                });
              }}
            />
            <div className="text-[11px] text-neutral-500">
              Tip: You can paste Markdown tables here; they’ll be sent as-is.
            </div>
          </div>
        )}

        {/* IMAGE */}
        {ctxDraft.imageDataUrl && (
          <div className="space-y-2">
            <label className="text-xs text-neutral-600 block">Image</label>
            <img
              src={ctxDraft.imageDataUrl}
              alt="Selection preview"
              className="w-full max-h-[320px] object-contain border rounded"
            />
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const dataUrl = await new Promise((res) => {
                    const r = new FileReader();
                    r.onload = () => res(r.result);
                    r.readAsDataURL(file);
                  });
                  setCtxDraft(d => ({ ...d, imageDataUrl: String(dataUrl) }));
                  e.target.value = "";
                }}
              />
              <button
                className="px-2 py-1 text-sm border rounded hover:bg-neutral-50"
                onClick={() => fileInputRef.current?.click()}
              >
                Replace image…
              </button>
              <button
                className="px-2 py-1 text-sm border rounded hover:bg-neutral-50"
                onClick={() => setCtxDraft(d => ({ ...d, imageDataUrl: null }))}
                title="Remove image from this chip"
              >
                Remove image
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t flex justify-end gap-2">
        <button
          className="px-3 py-2 text-sm rounded border hover:bg-neutral-50"
          onClick={cancelCtxEditor}
        >
          Cancel
        </button>
        <button
          className="px-3 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700"
          onClick={saveCtxEditor}
        >
          Save changes
        </button>
      </div>
    </div>
  </div>
)}

    </div>
  );
}
