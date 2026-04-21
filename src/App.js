/**
 * xHandle: application shell and workspace orchestrator.
 * This file assembles the main xHandle experience, routing data between functional architecture modeling, hazard analysis, requirements, traceability, reporting, licensing, and agent surfaces.
 * It is the primary composition layer for the local-first frontend and coordinates how feature-specific state, diagrams, modal flows, and persisted project data appear together in one workspace.
 * Related files: src/index.js, src/components/XHandleCopilotView.jsx, src/components/RequirementsManager.jsx, src/features/traceability/VnVCenterPro.jsx.
 */

import { useRef, useState, useEffect, useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import VnVCenterPro from './features/traceability/VnVCenterPro';
import ReadmeModal from './components/modals/ReadmeModal';
import React from "react";  
import { logger } from "./lib/utils/logger";
import { ActivityProvider, ActivitiesButton, useActivityCenter } from "./components/activity/ActivityCenter";
import {
  Plus,
  X,
  LayoutDashboard,     // <-- Console
  FolderGit2,
  ShieldAlert,
  FileText,
  ChevronRight,
  MoreVertical,
  Bot,
  PanelLeftClose,
} from 'lucide-react';
import XHandleCopilotView from "./components/XHandleCopilotView";
import { handleLitePromptSubmit } from './features/functional-architecture/LitePromptHandler';
import { runLiteAIAnalysis } from './features/hazard-analysis/aiAnalysisLite';
import LiteSummaryDiagram from './components/diagrams/LiteSummaryDiagram';
import PromptWizard from './features/functional-architecture/PromptWizard';
import ConversationalWizard from './components/ConversationalWizard';
import LiteSummaryDiagramReactFlow from './components/diagrams/LiteSummaryDiagramReactFlow';
import { generateAgenticRiskReport } from './components/generateAgenticReport';
import SafetyReportViewer from './components/SafetyReportViewer';
import { exportReport } from "./components/utils/exportUtils";
import {
  PieChart, Pie, Cell, Legend, Tooltip,
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer
} from 'recharts';
import { createPortal } from 'react-dom';
import { CalendarClock, GitCommit } from 'lucide-react';
import RequirementsManager from './components/RequirementsManager';
import TraceabilityAuditorPanel from './features/traceability/TraceabilityAuditorPanel';
import { useLicense, Gate } from './license/LicenseContext';
import ActivateLicenseModal from './license/ActivateLicenseModal';
import TopNavBar from './components/layout/TopNavBar';
import SettingsModal from './features/settings/SettingsModal';
import { generateFunctionalDecompositionFromGitHub, FunctionalDecompositionTable } from './features/functional-architecture/generateFunctionalDecompositionFromGitHub';
import { Sun, Moon } from 'lucide-react';
import { useDarkMode } from './hooks/useDarkMode';
import AgentHubButton from "./features/agents/ui/AgentHubButton";
import AgentsConsole from "./features/agents/ui/AgentsConsole";
import { initAgentMonitor } from "./agents/AgentMonitor";

// Convert the 2D "Summary" sheet into an array of objects for the auditor
const summary2Objects = (summary2D) => {
  if (!summary2D || !Array.isArray(summary2D) || summary2D.length < 2) return [];
  const headers = summary2D[0].map(String);
  return summary2D.slice(1).map((row) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
};

// Ensure a requirement-like node exists by id (used when linking to HZ:/MT: placeholders)
const ensureReqById = (list, id, { title = '', module = 'Requirement', attributes = {} } = {}) => {
  let found = list.find(r => r.id === id);
  if (!found) {
    found = { id, title: title || id, module, attributes, links: [] };
    list.push(found);
  }
  return found;
};
// ── helpers used by hooks during render: define at module scope
const makeId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const PROJECTS_KEY = 'xhandle.projects';
const ACTIVE_PROJECT_ID_KEY = 'xhandle.activeProjectId';
const PROJECT_DATA_KEY = 'xhandle.projectData';
const PROJECTS_OPEN_KEY = 'xhandle.sidebarProjectsOpen';
const DEFAULT_RISK_METHOD = 'STPA-Textbook';

function normalizeRiskMethod(method) {
  switch (method) {
    case 'STPA':
    case 'STPA-SEC':
    case 'STPA-Textbook':
      return 'STPA-Textbook';
    case 'FMEA':
    case 'FMEA-Textbook':
      return 'FMEA-Textbook';
    case 'WhatIf':
    case 'HRWhatIf':
    case 'WhatIf-Textbook':
      return 'WhatIf-Textbook';
    default:
      return DEFAULT_RISK_METHOD;
  }
}

// Keep projects hidden on Console
const SHOW_CONSOLE_PROJECTS = false;

// ---- Broadcast localStorage changes and trigger a re-collect of context ----
function installLocalStorageBroadcast() {
  if (window.__xhandle_ls_broadcast_installed) return;
  window.__xhandle_ls_broadcast_installed = true;

  // Only broadcast for keys that matter to global context
  const KEY_WHITELIST = new Set([
    'xhandle.projects',
    'xhandle.activeProjectId',
    'xhandle.projectData',
    'xhandle.sidebarOpen',
    'xhandle.sidebarProjectsOpen',
    // add any others that should trigger global recompute
  ]);
  // Ignore hot/volatile keys
  const KEY_BLOCKLIST_PREFIXES = [
    'diagram:positions:',      // React Flow viewport/positions
    'LiteSummaryDiagram::',    // any per-diagram cache you keep
    'cba:',                    // big code-arch blobs if they churn
  ];

  let pending = false;
  const fire = () => {
    if (pending) return;
    pending = true;
    // batch multiple writes into a single event per frame
    requestAnimationFrame(() => {
      pending = false;
      try { window.dispatchEvent(new CustomEvent("xhandle:data-changed")); } catch {}
    });
  };

  const shouldFireForKey = (k) => {
    if (!k) return false;
    for (const p of KEY_BLOCKLIST_PREFIXES) if (k.startsWith(p)) return false;
    if (KEY_WHITELIST.size) return KEY_WHITELIST.has(k);
    return true; // fallback (if you remove the whitelist)
  };

  const _set = localStorage.setItem.bind(localStorage);
  const _rem = localStorage.removeItem.bind(localStorage);
  const _clr = localStorage.clear.bind(localStorage);

  localStorage.setItem = function (k, v) { _set(k, v); if (shouldFireForKey(k)) fire(); };
  localStorage.removeItem = function (k)  { _rem(k);   if (shouldFireForKey(k)) fire(); };
  localStorage.clear = function ()        { _clr();    fire(); };

  window.addEventListener("storage", (e) => {
    if (e.storageArea !== localStorage) return;
    if (shouldFireForKey(e.key)) fire();
  });
}


/**
 * readProjectMap reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @returns the normalized data requested by this module.
 */
function readProjectMap() {
  try { return JSON.parse(localStorage.getItem(PROJECT_DATA_KEY) || '{}'); }
  catch { return {}; }
}
/**
 * writeProjectMap writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param map Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
function writeProjectMap(map) {
  try { localStorage.setItem(PROJECT_DATA_KEY, JSON.stringify(map)); }
  catch {}
}
/**
 * saveProjectPatch writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param projectId Project identifier used to scope data access within local storage.
 * @param patch Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
function saveProjectPatch(projectId, patch) {
  if (!projectId) return;
  const map = readProjectMap();
  const prev = map[projectId] || {};
  map[projectId] = { ...prev, ...patch, _updatedAt: new Date().toISOString() };
  writeProjectMap(map);
}
/**
 * loadProjectData reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param projectId Project identifier used to scope data access within local storage.
 * @returns the normalized data requested by this module.
 */
function loadProjectData(projectId) {
  const map = readProjectMap();
  return map[projectId] || null;
}
/**
 * removeProjectData encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param projectId Project identifier used to scope data access within local storage.
 * @returns the value that the next step in this workflow consumes.
 */
function removeProjectData(projectId) {
  const map = readProjectMap();
  if (map && Object.prototype.hasOwnProperty.call(map, projectId)) {
    delete map[projectId];
    writeProjectMap(map);
  }
}
// Ensure IndexedDB exists for project storage used by Copilot create flow
function ensureTraceabilityDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("TraceabilityDB");
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("Projects")) {
        db.createObjectStore("Projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("Notes")) {
        db.createObjectStore("Notes", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      try { req.result.close?.(); } catch {}
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * ProjectMenuPortal renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param anchorEl Input consumed by this step of the xHandle workflow.
 * @param setPortalRef React state setter supplied by the parent workflow.
 * @param onRename Callback used to notify the surrounding workflow about progress or user actions.
 * @param onDelete Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function ProjectMenuPortal({ anchorEl, setPortalRef, onRename, onDelete }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    function computePosition() {
      if (!anchorEl) return;
      const r = anchorEl.getBoundingClientRect();

      const MENU_W = 160;
      const MENU_H = 88;
      const GAP = 8;

      const openUp = r.bottom + MENU_H + GAP > window.innerHeight;
      const top = openUp
        ? Math.max(8, r.top - MENU_H - GAP)
        : Math.min(window.innerHeight - MENU_H - 8, r.bottom + GAP);

      const left = Math.min(
        window.innerWidth - MENU_W - 8,
        Math.max(8, r.right - MENU_W)
      );

      setPos({ top, left });
    }

    computePosition();
    window.addEventListener("resize", computePosition);
    window.addEventListener("scroll", computePosition, true);
    return () => {
      window.removeEventListener("resize", computePosition);
      window.removeEventListener("scroll", computePosition, true);
    };
  }, [anchorEl]);

  useEffect(() => {
    if (menuRef.current && setPortalRef) setPortalRef(menuRef.current);
  }, [setPortalRef]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[1000] w-40 bg-white border rounded-lg shadow-md overflow-hidden"
      style={{ top: pos.top, left: pos.left }}
      role="menu"
      aria-label="Project options"
    >
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
        onClick={onRename}
        role="menuitem"
      >
        Rename
      </button>

      <button
        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-50"
        onClick={onDelete}
        role="menuitem"
      >
        Delete
      </button>
    </div>,
    document.body
  );
}

/**
 * LiteXHandle renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function LiteXHandle() {
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [agentsOpen, setAgentsOpen] = useState(false);
const [repoConnected, setRepoConnected] = useState(false);
const { isDark, toggle } = useDarkMode();
const [showReadmeModal, setShowReadmeModal] = useState(false);
// Forces re-render when LS changes so getActiveProjectContext() picks up new data
const [, setLsTick] = useState(0);
useEffect(() => {
  installLocalStorageBroadcast();
  let t = null, pending = false;
  const onChange = () => {
    if (pending) return;
    pending = true;
    t = setTimeout(() => {
      setLsTick(tick => tick + 1);
      pending = false;
    }, 150); // 100–250ms works well
  };
  window.addEventListener("xhandle:data-changed", onChange);
  return () => { window.removeEventListener("xhandle:data-changed", onChange); clearTimeout(t); };
}, []);


// --- App section state ---
const [section, setSection] = useState('console'); // 'console' | 'projects' | 'risk' | 'reports' | 'settings'

const performTask = async (task) => {
  const a = task?.action || {};
  switch (a.type) {
    case "run-analysis": {
      // You already have handleRunAnalysis; ensure project & tab are set
      setActiveProjectId(a.projectId);
      setSection("projects");
      setActiveTab("Functional Diagramming");
      await handleRunAnalysis(a.method || "FMEA");
      return;
    }
    case "refresh-diagram": {
      setActiveProjectId(a.projectId);
      setSection("projects");
      setActiveTab(a.view === "Risk" ? "Risk Diagram" : "Functional Diagram");
      window.dispatchEvent(new CustomEvent("xhandle:diagram:refresh", { detail: { projectId: a.projectId, view: a.view || "Risk" } }));
      return;
    }
    case "normalize-risk": {
      window.dispatchEvent(new CustomEvent("xhandle:risk:normalize", { detail: { projectId: a.projectId, riskId: a.riskId, op: a.op || "assignOwner" } }));
      return;
    }
    case "generate-mitigations": {
      window.dispatchEvent(new CustomEvent("xhandle:risk:generateMitigations", { detail: { projectId: a.projectId, riskId: a.riskId } }));
      return;
    }
    default:
      // Fallback to your existing event router
      window.dispatchEvent(new CustomEvent("xhandle:xagent:action", { detail: a }));
  }
};

  // Docked Copilot (persistent)
  const [dockOpen, setDockOpen] = useState(() => localStorage.getItem('xhandle.copilotDockOpen') === 'true');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  // Reserve space for the right dock so it doesn't overlay content
  const dockPaddingClass = dockOpen && !dockCollapsed ? 'pr-[380px] md:pr-[420px]' : '';
const [cbaTableData, setCbaTableData] = useState(() => {
  try {
    const owner = localStorage.getItem("repoOwner");
    const repo  = localStorage.getItem("repoName");
    const key = owner && repo ? `cba:${owner}/${repo}` : null;
    return key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
  } catch {
    return [];
  }
});

async function handleBaselineRepo({
  owner,
  repo,
  token,
  selectedExtensions,
} = {}) {
  setSection("code-architecture");

  const finalOwner = (owner || localStorage.getItem("repoOwner") || "").trim();
  const finalRepo = (repo || localStorage.getItem("repoName") || "").trim();
  const finalToken = (token || localStorage.getItem("githubToken") || "").trim();

  if (!finalOwner || !finalRepo) {
    throw new Error("Missing owner/repo. Save them in Settings → GitHub first.");
  }

  // 🔑 WRITE TO LOCAL STORAGE (CRITICAL)
  localStorage.setItem("repoOwner", finalOwner);
  localStorage.setItem("repoName", finalRepo);

  if (finalToken) {
    localStorage.setItem("githubToken", finalToken);
  } else {
    localStorage.removeItem("githubToken");
  }

  if (selectedExtensions?.length) {
    localStorage.setItem("githubSelectedExtensions", JSON.stringify(selectedExtensions));
  }

  const id = `cba-${finalOwner}/${finalRepo}`;

  startActivity(id, {
    title: "Generating code-based architecture",
    message: "Analyzing repository…"
  });

  try {
    // ✅ KEEP OLD SIGNATURE
    await generateFunctionalDecompositionFromGitHub(
      setCbaTableData,
      setCbaLoading
    );

    finishActivity(id, "success", "Architecture ready");
  } catch (e) {
    finishActivity(id, "error", String(e?.message || e));
    throw e;
  }
}


const [cbaLoading, setCbaLoading] = useState(false);

useEffect(() => {
  const owner = localStorage.getItem("repoOwner");
  const repo  = localStorage.getItem("repoName");
  if (!owner || !repo) return;
  localStorage.setItem(`cba:${owner}/${repo}`, JSON.stringify(cbaTableData || []));
}, [cbaTableData]);

useEffect(() => {
  const fetchStatus = async () => {
    // If you have a real endpoint, call it here and return its JSON.
    return { kind: "composite", status: "ok", heartbeat: Date.now() };
  };
  initAgentMonitor({ fetchStatus });
}, []);

const [lastNonCopilotSection, setLastNonCopilotSection] = useState(
  () => localStorage.getItem('xhandle.lastNonCopilotSection') || 'console'
);

    // Ctrl/Cmd + Shift + C toggles the dock
    useEffect(() => {
      const onKey = (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (meta && (e.key === 'j' || e.key === 'J')) {
          e.preventDefault();
          if (dockOpen) {
            // If dock is open, don't navigate to the Copilot page.
            setDockCollapsed(false); // optional: uncollapse the dock instead
            return;
          }
          setSection('copilot');
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [dockOpen, setSection, setDockCollapsed]);

// Let XHandleCopilotView (or anything) broadcast dock/undock
useEffect(() => {
  const dock = () => {
    setDockOpen(true);
    try { localStorage.setItem('xhandle.copilotDockOpen','true'); } catch {}
  };
  const undock = () => {
    setDockOpen(false);
    try { localStorage.setItem('xhandle.copilotDockOpen','false'); } catch {}
  };

  window.addEventListener('xhandle:copilot-dock-open', dock);
  window.addEventListener('xhandle:copilot-undock', undock);

  return () => {
    window.removeEventListener('xhandle:copilot-dock-open', dock);
    window.removeEventListener('xhandle:copilot-undock', undock);
  };
}, []);


useEffect(() => {
  if (dockOpen && section === 'copilot') {
    setSection(lastNonCopilotSection || 'console');
  }
}, [dockOpen, section, lastNonCopilotSection]);

    // Initialize IDB stores early so “object store not found” can’t occur later
useEffect(() => {
  ensureTraceabilityDB().catch(() => {});
}, []);

const resetLocalSession = async () => {
  try {
    localStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
  } catch {}
};
  
  // ────────────────────────────────────────────────────────────────────────────────
  // Sidebar + nav
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    if (section && section !== 'copilot') {
      setLastNonCopilotSection(section);
      try { localStorage.setItem('xhandle.lastNonCopilotSection', section); } catch {}
    }
  }, [section]);
  
  const [reportType, setReportType] = useState("Safety");

  const REPORT_TYPE_OPTIONS = [
    "Subsystem Design Document",
    "System Design Document",
    "Safety",
    "Executive Brief",
    "Compliance Checklist",
    "Audit Readout",
    "Test Plan",
    "Risk Register",
    "Functional Architecture Definition", // <-- add this
    "Custom Report",
  ];  

// --- Custom Report Wizard state ---
const [showCustomPromptModal, setShowCustomPromptModal] = useState(false);
const [customReportPrompt, setCustomReportPrompt] = useState("");

const [wizardStep, setWizardStep] = useState(1);
const [wizard, setWizard] = useState({
  title: "",
  audience: "engineering stakeholders",
  tone: "professional and concise",
  length: "medium", // short | medium | long
  goals: "",
  includeFindings: true,
  includeArchitecture: true,
  includeSummaryJson: true,
  includeAllRisks: false,           // ⬅️ NEW
  topRisksCount: 5,
  sections: [
    "Executive Summary",
    "Analysis Scope",
    "Key Risks and Impacts",
    "Mitigations & Requirements",
    "Recommendations",
  ],
  tables: ["Top Risks Table"],
  extras: ["Insert blank line before lists"],
});

function composeCustomPromptFromWizard(w) {
  const goalsList = (w.goals || "")
    .split(/\r?\n|,/)
    .map(s => s.trim())
    .filter(Boolean);

  const sections = (w.sections || []).filter(Boolean);
  const tables = (w.tables || []).filter(Boolean);

  const risksDirective = w.includeAllRisks
    ? "- A full list or table of **all identified risks** derived from findings. If very long, group by category/subsystem; keep each entry concise."
    : (Number.isFinite(w.topRisksCount)
        ? `- A concise list or table of the **top ${w.topRisksCount} risks** by impact and likelihood.`
        : "- A concise list of the top risks.");

  return `
Create a ${w.length} ${w.tone} **Markdown** report titled "${w.title || "Custom Report"}" for ${w.audience || "stakeholders"}.

Sections (in order):
${sections.map(s => `- ${s}`).join("\n") || "- Executive Summary"}

Content sources (available context to use):
${w.includeFindings ? "- Findings summaries from the risk analysis." : ""}
${w.includeArchitecture ? "- Functional architecture narrative." : ""}
${w.includeSummaryJson ? "- A small sample of the summary sheet as JSON for traceability." : ""}

Emphasis:
${goalsList.length ? goalsList.map(g => `- ${g}`).join("\n") : "- Clarity, actionability, and correctness."}

If applicable, include:
${risksDirective}
${tables.length ? tables.map(t => `- ${t}`).join("\n") : "- Tables where helpful (keep them simple)."}

Formatting rules:
- Use proper Markdown headings.
- Insert a blank line before any list.
- Avoid nesting lists inside paragraphs.
- Do **not** wrap the entire output in code fences.

Output: clean Markdown only (no surrounding backticks).
`.trim();
}

  // Projects list + active project selection (persisted)
  const [projects, setProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); }
    catch { return []; }
  });
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem(ACTIVE_PROJECT_ID_KEY) || null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectError, setNewProjectError] = useState('');

     // NEW: Project Manager (AI-PM) filters
const [aiPmFilters, setAiPmFilters] = React.useState(() => {
  const allIds = (projects || []).map(p => p.id);
  return {
    query: "",
    projectIds: activeProjectId ? [activeProjectId] : allIds, // default: current project or all
    statusPick: ["Open","In Progress","In Mitigation","Mitigated","Accepted"], // exclude Closed by default
    onlyHighRPN: false,
    unassignedOnly: false,
  };
});

// Optional: backfill projects after they load (or when active project changes)
React.useEffect(() => {
  if (!projects?.length) return;
  // if no selection yet, default to the current active project or "all"
  if (!aiPmFilters.projectIds?.length) {
    setAiPmFilters(f => ({
      ...f,
      projectIds: activeProjectId ? [activeProjectId] : projects.map(p => p.id),
    }));
  }
}, [projects, activeProjectId, aiPmFilters.projectIds?.length]);

  const [projectLoaded, setProjectLoaded] = useState(false);  

  // Rename state
const [editingProjectId, setEditingProjectId] = useState(null);
const [editingProjectName, setEditingProjectName] = useState('');
const [renameError, setRenameError] = useState('');
// Three-dots menu state
const [openProjectMenuId, setOpenProjectMenuId] = useState(null);
const projectMenuPortalRefs = useRef({}); // portal root (for outside-click)
const projectMenuAnchorEls = useRef({});  // the trigger button element
const riskDiagramContainerRef = useRef(null);

// License status (from provider) + modal
const lic = useLicense();
const [licenseModalOpen, setLicenseModalOpen] = useState(false);

// --- Project cap from entitlements (fallbacks for safety) ---
const projectLimit = useMemo(
  () => Number(lic?.entitlements?.max_projects ?? (lic?.ok ? 50 : 3)),
  [lic?.entitlements?.max_projects, lic?.ok]
);
const atProjectLimit = projects.length >= projectLimit;

function guardNewProjectIntent() {
  if (atProjectLimit) {
    // nudge to upgrade
    setSection('projects');
    setLicenseModalOpen(true);
    return false;
  }
  return true;
}

// --- Tabs ---
const [activeTab, setActiveTab] = useState('Functional Diagramming'); // 'Analysis' | 'Risk Assessment'

// --- Risk register state (persisted per-project) ---
const [riskRegister, setRiskRegister] = useState([]);
// --- Requirements state (persisted per-project) ---
const [requirements, setRequirements] = useState([]);
// --- V&V artifacts (persisted per-project) ---
const [vnvArtifacts, setVnvArtifacts] = useState({
  summary: null,
  testCases: [],
  traceMatrix: [],
  procedures: [],
  hazardsCoverage: [],
  datasets: [],
});


// ── Console (aggregate across ALL projects) ─────────────────────────────
// Build a cross-project risk list directly from localStorage project map
const consoleRiskRegister = React.useMemo(() => {
  const map = readProjectMap();
  const list = [];
  (projects || []).forEach((p) => {
    const regs = (map?.[p.id]?.riskRegister) || [];
    regs.forEach((r) => list.push(r));
  });
  return list;
}, [projects]);

// Risks by status (uses aggregate list)
const consoleRiskStatusData = React.useMemo(() => {
  const counts = new Map();
  for (const r of consoleRiskRegister) {
    const key = (r?.status || 'Open').trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}, [consoleRiskRegister]);

// Priority buckets from RPN (likelihood * severity)
const consolePriorityBucketData = React.useMemo(() => {
  const buckets = [
    { name: 'Very Low (≤3)', test: (rpn) => rpn <= 3, value: 0 },
    { name: 'Low (4–6)',     test: (rpn) => rpn >= 4 && rpn <= 6, value: 0 },
    { name: 'Med (7–9)',     test: (rpn) => rpn >= 7 && rpn <= 9, value: 0 },
    { name: 'High (10–15)',  test: (rpn) => rpn >= 10 && rpn <= 15, value: 0 },
    { name: 'Severe (≥16)',  test: (rpn) => rpn >= 16, value: 0 },
  ];
  for (const r of consoleRiskRegister) {
    const L = Number(r?.likelihood) || 0;
    const S = Number(r?.severity) || 0;
    const RPN = L * S;
    const b = buckets.find(bk => bk.test(RPN));
    if (b) b.value += 1;
  }
  return buckets;
}, [consoleRiskRegister]);

// Recent activity (aggregate, newest first)
const consoleRecentActivity = React.useMemo(() => {
  const items = [];
  const map = readProjectMap();
  (projects || []).forEach((p) => {
    const pd = map?.[p.id] || {};
    const count = Array.isArray(pd.riskRegister) ? pd.riskRegister.length : 0;
    if (count) {
      items.push({
        user: 'You',
        item: `${p.name} risk register`,
        status: `${count} risks`,
        when: pd._updatedAt || ''
      });
    }
  });
  return items
    .slice()
    .sort((a,b) => new Date(b.when||0) - new Date(a.when||0))
    .slice(0, 12)
    .map(x => ({ ...x, when: x.when ? new Date(x.when).toLocaleString() : 'recently' }));
}, [projects]);

// Static subtitle for all-project aggregate
const consoleSubtitle = 'All projects';

// --- Risk Hub (aggregate) filters ---
const [riskHubFilters, setRiskHubFilters] = useState({
  query: '',
  projectIds: [],
  statuses: [],
  owner: '',
  tags: '',
  minRPN: '',
  maxRPN: ''
});

// Stacked bar: counts by status per project
const buildRequirementsFromSummary = (summary) => {
  if (!summary || !Array.isArray(summary) || summary.length < 2) return [];
  const headers = summary[0].map(h => String(h || ''));
  const rows = summary.slice(1);

  const reqCols = headers
    .map((h, i) => (/requirement|system requirement|derived requirement|safety requirement|constraint|mitigation/i.test(h) ? i : -1))
    .filter(i => i >= 0);

  const sevIdx = headers.findIndex(h => /severity/i.test(h));
  const likIdx = headers.findIndex(h => /likelihood|probability/i.test(h));

  const out = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const text = reqCols.map(i => row[i]).find(v => v && String(v).trim());
    if (!text) continue;

    let priority = '';
    const s = Number(row[sevIdx] || 0);
    const l = Number(row[likIdx] || 0);
    const rpn = s * l;
    if (rpn >= 20) priority = 'Highest';
    else if (rpn >= 15) priority = 'High';
    else if (rpn >= 8) priority = 'Medium';
    else if (rpn >= 4) priority = 'Low';

    const attrs = {};
    if (priority) attrs['Priority'] = priority;

    out.push({
      id: makeId(),
      title: String(text),
      module: 'Requirement',
      attributes: attrs,
      links: []
    });
  }

  // de-dupe by normalized title
  const seen = new Set();
  const dedup = [];
  out.forEach(r => {
    const k = r.title.trim().toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    dedup.push(r);
  });
  return dedup;
};



// Seed risks from the Summary sheet (very generic so it doesn't depend on headers)
// Seed risks from the Summary sheet
// Description = HAZARD column only (fallbacks if not present)
const buildRiskRegisterFromSummary = (summary) => {
  if (!summary || !Array.isArray(summary) || summary.length < 2) return [];

  const headers = summary[0].map(h => String(h || ''));
  const [, ...rows] = summary;

  // Identify columns
  const hazardIdx = headers.findIndex(h => /(^|\s)hazards?\b/i.test(h));
  // Reasonable title fallbacks across STPA/FMEA/What-If variants
  const titleIdx =
    headers.findIndex(h => /\brisk\b|\bfailure modes?\b|\buca\b|\bunsafe\s*control\s*actions?\b|\bwhat[-\s]?if\b|\bwhat[-\s]?if\s*scenarios?\b|\bscenarios?\b/i.test(h)) !== -1
      ? headers.findIndex(h => /\brisk\b|\bfailure modes?\b|\buca\b|\bunsafe\s*control\s*actions?\b|\bwhat[-\s]?if\b|\bwhat[-\s]?if\s*scenarios?\b|\bscenarios?\b/i.test(h))
      : 0;

  return rows.map((row, idx) => ({
    id: makeId(),
    title: String(row[titleIdx] ?? `Risk ${idx + 1}`),
    // ⬇️ description strictly from hazard column (or a minimal fallback)
    description: String(
      hazardIdx >= 0
        ? (row[hazardIdx] ?? '—')
        : (row[1] ?? '—') // fallback if no explicit Hazard column exists
    ),
    likelihood: 3,
    severity: 3,
    status: 'Open',
    owner: '',
    dueDate: '',
    tags: '',
    sourceIndex: idx + 1,
  }));
};

  // Collapsible state for sidebar projects
  const [isProjectsOpen, setIsProjectsOpen] = useState(() => {
    const saved = localStorage.getItem(PROJECTS_OPEN_KEY);
    return saved ? saved === 'true' : true;
  });

  useEffect(() => {
    function handleOutside(e) {
      if (!openProjectMenuId) return;
  
      // Ignore clicks on the trigger button
      if (e.target.closest('[data-project-menu-trigger="true"]')) return;
  
      const menuEl = projectMenuPortalRefs.current[openProjectMenuId];
      if (menuEl && !menuEl.contains(e.target)) {
        setOpenProjectMenuId(null);
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') setOpenProjectMenuId(null);
    }
  
    document.addEventListener('click', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('click', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [openProjectMenuId]);

  useEffect(() => {
    const onProjectsUpdated = () => {
      try {
        const list = JSON.parse(localStorage.getItem("xhandle.projects") || "[]");
        setProjects(list);
        // Make it visible when something new arrives (e.g., from Copilot)
        setSection('projects');
        setIsSidebarOpen(true);
        setIsProjectsOpen(true);
      } catch {}
    };
    window.addEventListener("xhandle:projects-updated", onProjectsUpdated);
    return () => window.removeEventListener("xhandle:projects-updated", onProjectsUpdated);
  }, []);  
  
  useEffect(() => { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); }, [projects]);
  useEffect(() => {
    if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_ID_KEY, activeProjectId);
    else localStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
  }, [activeProjectId]);
  useEffect(() => { localStorage.setItem(PROJECTS_OPEN_KEY, String(isProjectsOpen)); }, [isProjectsOpen]);

  const createProject = () => {
      // HARD GUARD: prevent creation beyond cap
  if (atProjectLimit) {
    setNewProjectError(`You’ve reached your plan limit of ${projectLimit} projects. Upgrade to create more.`);
    setLicenseModalOpen(true);
    return;
  }

    const name = newProjectName.trim();
    if (!name) { setNewProjectError('Please enter a project name.'); return; }
    if (projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      setNewProjectError('A project with this name already exists.');
      return;
    }
    const id = `${Date.now()}`;
    const proj = { id, name, createdAt: new Date().toISOString() };
    setProjects(prev => [proj, ...prev]);
    // NEW: initialize agentReportResult
    saveProjectPatch(id, {
      responseRows: [],
      analysisResult: null,
      riskMethod: DEFAULT_RISK_METHOD,
      agentReportResult: null,
      riskRegister: [],
      requirements: [],      // ← add this
      vnvArtifacts: {
        summary: null,
        testCases: [],
        traceMatrix: [],
        procedures: [],
        hazardsCoverage: [],
        datasets: [],
      },      
    });
        setActiveProjectId(id);
    setNewProjectName('');
    setNewProjectError('');
    setShowNewProject(false);
    setSection('projects');
    
  };

  // Delete a project (with confirmation and cleanup)
  const deleteProject = (projectId) => {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;
    if (!window.confirm(`Delete project "${proj.name}"? This will remove its locally stored data.`)) return;

    const remaining = projects.filter(p => p.id !== projectId);
    setProjects(remaining);

    if (activeProjectId === projectId) {
      const nextId = remaining[0]?.id || null;
      setActiveProjectId(nextId);
      if (!nextId) {
        setResponseRows([]);
        setAnalysisResult(null);
        setRiskMethod(DEFAULT_RISK_METHOD);
        setAgentReportResult(null); // NEW: clear report in UI state
        setRequirements([]); 
        setShowPromptWizard(true);
      }
    }
    removeProjectData(projectId);
  };

  function getActiveProjectContext() {
    const map = readProjectMap();
    const proj = projects.find(p => p.id === activeProjectId) || null;
    const persisted = activeProjectId ? (map?.[activeProjectId] || {}) : {};
  
    // ---- Pull from localStorage (safe, synchronous) ----
    const ls = localStorage;
    const lsKeys = Object.keys(ls);
  
    // 1) Per-app/project blob you already use
    let projectDataLS = {};
    try { projectDataLS = JSON.parse(ls.getItem("xhandle.projectData") || "{}"); } catch {}
    const storedProj = activeProjectId ? (projectDataLS?.[activeProjectId] || {}) : {};
  
    // 2) Extra requirements cache (if present)
    let reqsLS = [];
    try { reqsLS = JSON.parse(ls.getItem("xhandle:requirements") || "[]"); } catch {}
  
    // 3) LiteSummaryDiagram blocks (capture all variants to give the model more context)
    const liteSummaryKeys = lsKeys.filter(k => k.startsWith("LiteSummaryDiagram::"));
    const liteSummaries = [];
    for (const k of liteSummaryKeys) {
      try {
        const v = JSON.parse(ls.getItem(k) || "null");
        if (v) liteSummaries.push({ key: k, headers: v.headers, nodes: v.nodes?.slice?.(0, 50) || v.nodes });
      } catch {}
    }
  
    // 4) Diagram snapshots (positions) – keep a manageable tail
    const diagramKeys = lsKeys.filter(k => k.startsWith("diagram:positions:")).sort();
    const lastDiagKeys = diagramKeys.slice(-12); // tail to keep context compact
    const diagramSnapshots = [];
    for (const k of lastDiagKeys) {
      try {
        const v = JSON.parse(ls.getItem(k) || "null");
        if (v) {
          diagramSnapshots.push({
            key: k,
            count: Array.isArray(v) ? v.length : 0,
            sample: Array.isArray(v) ? v.slice(0, 12) : v
          });
        }
      } catch {}
    }
  
    // 5) Code-based architecture (CBA): collect ALL cba:* tables, not only the active repo
    const cbaKeys = lsKeys.filter(k => k.startsWith("cba:"));
    const codeArchitecture = [];
    for (const k of cbaKeys) {
      try {
        const rows = JSON.parse(ls.getItem(k) || "[]");
        if (Array.isArray(rows) && rows.length) {
          codeArchitecture.push(...rows.map(r => ({ ...r, _source: k })));
        }
      } catch {}
    }
  
    // 6) A few convenience hints (what you already had, preserved)
    const owner = ls.getItem("repoOwner") || undefined;
    const repo  = ls.getItem("repoName") || undefined;
  
    // ---- Compose a single context (prefer live state → persisted → LS blobs) ----
    const ctx = {
      // meta / hinting
      project: proj ? { id: proj.id, name: proj.name, createdAt: proj.createdAt } : null,
      projectHint, // you already memoize owner/repo/baselineKey elsewhere
  
      // core working data
      requirements:
        (requirements?.length ? requirements : null) ??
        (persisted.requirements?.length ? persisted.requirements : null) ??
        (storedProj.requirements?.length ? storedProj.requirements : null) ??
        reqsLS,
  
      functionalDecomposition:
        (responseRows?.length ? responseRows : null) ??
        (persisted.responseRows?.length ? persisted.responseRows : null) ??
        (storedProj.responseRows?.length ? storedProj.responseRows : null) ??
        [],
  
      riskRegister:
        (riskRegister?.length ? riskRegister : null) ??
        (persisted.riskRegister?.length ? persisted.riskRegister : null) ??
        (storedProj.riskRegister?.length ? storedProj.riskRegister : null) ??
        [],
  
      // generated analysis (Summary sheet)
      riskSummarySheet:
        (analysisResult?.Summary?.length ? analysisResult.Summary : null) ??
        (persisted.analysisResult?.Summary?.length ? persisted.analysisResult.Summary : null) ??
        (storedProj.analysisResult?.Summary?.length ? storedProj.analysisResult.Summary : null) ??
        null,
  
      // ALL CBA tables found in LS (tagged with their source key)
      codeArchitecture,
  
      // extra sources the Copilot can leverage for reasoning
      liteSummaries,
      diagramSnapshots,
  
      // lightweight metadata
      sourcesMeta: {
        lsKeyCount: lsKeys.length,
        cbaKeyCount: cbaKeys.length,
        liteSummaryCount: liteSummaries.length,
        diagramSnapshotCount: diagramSnapshots.length,
        repoOwner: owner,
        repoName: repo,
      },
    };
  
    return ctx;
  }
  
  
  const shortId = (id, fallback = "") =>
    (id || "")
      .toString()
      .replace(/[^a-zA-Z0-9]/g, "")   // strip hyphens, etc.
      .slice(0, 6) || fallback;
  
  // ── Rename helpers ─────────────────────────────────────────────────────
const beginRename = (project) => {
  setEditingProjectId(project.id);
  setEditingProjectName(project.name);
  setRenameError('');
};

const commitRename = () => {
  const name = (editingProjectName || '').trim();
  if (!name) { setRenameError('Please enter a project name.'); return; }
  if (projects.some(p => p.id !== editingProjectId && p.name.toLowerCase() === name.toLowerCase())) {
    setRenameError('A project with this name already exists.');
    return;
  }
  setProjects(prev =>
    prev.map(p => p.id === editingProjectId ? { ...p, name, updatedAt: new Date().toISOString() } : p)
  );
  setEditingProjectId(null);
  setEditingProjectName('');
  setRenameError('');
};

const cancelRename = () => {
  setEditingProjectId(null);
  setEditingProjectName('');
  setRenameError('');
};


const NavItem = ({ icon: Icon, label, active, onClick, disabled }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`w-full text-left flex items-center ${isSidebarOpen ? 'gap-3' : 'gap-0 justify-center'} px-3 py-2 rounded-xl transition-colors
      ${disabled
        ? 'text-gray-400 cursor-not-allowed'
        : active
          ? 'bg-[#ECEEFF] text-[#0F0F12]'
          : 'text-gray-600 hover:bg-gray-100'}`}
    title={
      !isSidebarOpen
        ? (typeof label === 'string' ? label : 'Item')
        : (disabled ? 'Copilot is docked' : undefined)
    }
  >
    <span className="shrink-0"><Icon size={18} /></span>
    {isSidebarOpen && <span className="text-sm font-medium">{label}</span>}
  </button>
);



// Create a new project from a selection coming from the diagram modal
function handleCreateProjectFromSelection({ name, selectedNodes, filteredRows }) {
  if (!guardNewProjectIntent()) return;

  const desired = String(name || '').trim() || 'New Project';
  const existingNames = new Set(projects.map((p) => p.name.toLowerCase()));
  let finalName = desired;
  let suffix = 2;
  while (existingNames.has(finalName.toLowerCase())) {
    finalName = `${desired} (${suffix++})`;
  }

  const id = makeId();
  const proj = { id, name: finalName, createdAt: new Date().toISOString() };

  setProjects(prev => [proj, ...prev]);

  saveProjectPatch(id, {
    responseRows: Array.isArray(filteredRows) ? filteredRows : [],
    analysisResult: null,
    riskMethod: DEFAULT_RISK_METHOD,
    agentReportResult: null,
    riskRegister: [],
    requirements: [],
  });

  setActiveProjectId(id);
  setSection('projects');

  // ⬇️ ADD THESE TWO LINES so the new project is visible in the sidebar list
  setIsSidebarOpen(true);
  setIsProjectsOpen(true);
}


  // ────────────────────────────────────────────────────────────────────────────────

  const diagramRef = useRef();
  const stepDescriptionsMap = useMemo(() => ({
    HRWhatIf: {
      total: 9,
      steps: {
        1: "Seeding HR/Org what-if scenario table…",
        2: "Populating HR consequences and triggers…",
        3: "Extracting causal factors (people/process)…",
        4: "Generating HR/Org mitigation strategies…",
        5: "Deriving organizational requirements…",
        6: "Consolidating requirements…",
        7: "Mapping causal factors to impact categories…",
        8: "Linking losses to impacts…",
        9: "Compiling HR/Org risk summary…"
      }
    },
    STPA: { total: 9, steps: { 1:"Identifying unsafe control actions...",2:"Populating hazard timing columns...",3:"Identifying causal factors...",4:"Generating mitigation strategies...",5:"Deriving system requirements...",6:"Consolidating requirements...",7:"Mapping hazards to behaviors...",8:"Linking losses to hazards...",9:"Compiling safety summary..." } },
    "STPA-Textbook": {
      total: 4,
      steps: {
        1: "Identifying unsafe control actions...",
        2: "Populating unsafe control action scenarios...",
        3: "Deriving textbook causal factors...",
        4: "Compiling the textbook traceability matrix..."
      }
    },
    "FMEA-Textbook": {
      total: 4,
      steps: {
        1: "Identifying failure modes...",
        2: "Populating failure mode scenarios...",
        3: "Deriving textbook causal factors and requirements...",
        4: "Compiling the textbook traceability matrix..."
      }
    },
    "WhatIf-Textbook": {
      total: 4,
      steps: {
        1: "Seeding what-if guidewords...",
        2: "Populating what-if scenarios...",
        3: "Deriving textbook causal factors and requirements...",
        4: "Compiling the textbook traceability matrix..."
      }
    },
    FMEA: { total: 9, steps: { 1:"Seeding failure mode candidates...",2:"Analyzing effects and causes...",3:"Extracting causal factors...",4:"Generating mitigation strategies...",5:"Deriving system requirements...",6:"Consolidating requirements...",7:"Mapping hazards to failure effects...",8:"Linking losses to hazards...",9:"Compiling safety summary..." } },
    WhatIf:{ total: 9, steps: { 1:"Seeding what-if scenario table...",2:"Populating consequences and causes...",3:"Extracting causal factors...",4:"Generating mitigation strategies...",5:"Deriving system requirements...",6:"Consolidating requirements...",7:"Mapping hazards to what-if paths...",8:"Linking losses to hazards...",9:"Compiling safety summary..." } },
    "STPA-SEC": {
      total: 9,
      steps: {
        1: "Identifying vulnerable control actions…",
        2: "Populating VCA threat columns…",
        3: "Deriving threat scenarios…",
        4: "Generating security controls…",
        5: "Deriving system security requirements…",
        6: "Consolidating requirements…",
        7: "Mapping VCAs to security categories…",
        8: "Linking categories to business/operational losses…",
        9: "Compiling security summary…"
      }
    }
  }), []);

  const agentStepDescriptions = useMemo(() => ({
    1: "Assessing summary quality...",
    2: "Chunking and summarizing data...",
    3: "Auditing summary chunks...",
    4: "Revising low-confidence summaries...",
    5: "Synthesizing final safety report..."
  }), []);
  
  const [responseRows, setResponseRows] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showDiagram] = useState(true);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [columnFilters, setColumnFilters] = useState({});
  const dropdownRefs = useRef({});
  const [filterColumnIndex, setFilterColumnIndex] = useState(null);
  const [columnSearches, setColumnSearches] = useState({});
  const [isGeneratingDecomposition, setIsGeneratingDecomposition] = useState(false);
  const [showFunctionalDiagram, setShowFunctionalDiagram] = useState(true);
  const [riskMethod, setRiskMethod] = useState(DEFAULT_RISK_METHOD);
  const [progress, setProgress] = useState({ step: 0, total: stepDescriptionsMap[DEFAULT_RISK_METHOD].total });
  const [agentReportResult, setAgentReportResult] = useState(null); // NEW: persisted report state
  const [isGeneratingAgentReport, setIsGeneratingAgentReport] = useState(false);
  const [functionalDiagramImage, setFunctionalDiagramImage] = useState(null);
  const [showPromptWizard, setShowPromptWizard] = useState(true);
  const [cleanOnceKey, setCleanOnceKey] = useState(null);
  const [promptMode, setPromptMode] = useState('structured');
  // Bulk selection + bulk edit for Risk Inbox
const [inboxSelection, setInboxSelection] = useState(new Set());
const [inboxBulk, setInboxBulk] = useState({
  status: "",
  owner: "",
  dueDate: "",
  likelihood: "",
  severity: "",
  tags: "",
  tagsMode: "replace", // "replace" | "append" | "clear"
});

  // NEW: bulk edit + selection state (put near your other useState hooks)
const [selectedIds, setSelectedIds] = useState(new Set());
const [bulk, setBulk] = useState({
  status: "",
  owner: "",
  dueDate: "",
  likelihood: "",
  severity: "",
  tags: "",
  tagsMode: "replace", // "replace" | "append" | "clear"
});

// Keep selection sane when the list changes
useEffect(() => {
  setSelectedIds(prev => {
    const keep = new Set();
    for (const id of prev) {
      if (riskRegister.some(r => r.id === id)) keep.add(id);
    }
    return keep;
  });
}, [riskRegister]);

// Helpers
const allVisibleIds = useMemo(
  () =>
    riskRegister
      .slice()
      .sort(
        (a, b) =>
          (Number(b.likelihood) || 0) * (Number(b.severity) || 0) -
          (Number(a.likelihood) || 0) * (Number(a.severity) || 0)
      )
      .map(r => r.id),
  [riskRegister]
);
const toggleAll = () => {
  if (selectedIds.size === allVisibleIds.length) {
    setSelectedIds(new Set());
  } else {
    setSelectedIds(new Set(allVisibleIds));
  }
};
const toggleOne = (id) => {
  setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
};

// Apply bulk changes
const applyBulk = () => {
  if (selectedIds.size === 0) return;

  setRiskRegister(prev =>
    prev.map(r => {
      if (!selectedIds.has(r.id)) return r;

      let next = { ...r };

      if (bulk.status) next.status = bulk.status;
      if (bulk.owner !== "") next.owner = bulk.owner;
      if (bulk.dueDate !== "") next.dueDate = bulk.dueDate;
      if (bulk.likelihood !== "") next.likelihood = Number(bulk.likelihood);
      if (bulk.severity !== "") next.severity = Number(bulk.severity);

      if (bulk.tagsMode === "clear") {
        next.tags = "";
      } else if (bulk.tags.trim()) {
        if (bulk.tagsMode === "replace") {
          next.tags = bulk.tags.trim();
        } else if (bulk.tagsMode === "append") {
          const existing = (next.tags || "").trim();
          next.tags = existing
            ? `${existing}, ${bulk.tags.trim()}`
            : bulk.tags.trim();
        }
      }

      return next;
    })
  );
};

// Delete selected

  const { startActivity, updateActivity, finishActivity } = useActivityCenter();
const [analysisActivityId, setAnalysisActivityId] = useState(null);
useEffect(() => {
  if (!analysisActivityId || !isAnalyzing) return;
  updateActivity(analysisActivityId, {
    step: progress.step || 0,
    total: progress.total || 0,
    message: stepDescriptionsMap[riskMethod]?.steps[progress.step] || "Working…"
  });
}, [analysisActivityId, isAnalyzing, progress.step, progress.total, riskMethod, stepDescriptionsMap, updateActivity]);

useEffect(() => {
  const onRunAnalysis = (e) => {
    const { projectId, method } = e.detail || {};
    // your existing analysis kickoff (FMEA/STPA/WhatIf). Example:
    // runLiteAIAnalysis({ projectId, method }) or
    window.dispatchEvent(new CustomEvent("xhandle:runLiteAIAnalysis", { detail: { projectId, method } }));
  };

  const onRefreshDiagram = (e) => {
    const { projectId, view } = e.detail || {};
    // flip UI to the relevant tab/view, then ask diagram to recompute layout if needed
    setActiveProjectId(projectId);
    setSection(view === "Risk" ? "projects" : "projects");
    setActiveTab(view === "Risk" ? "Risk Diagram" : "Functional Diagram");
    // optional: send an internal nudge to your diagram component
    window.dispatchEvent(new CustomEvent("xhandle:diagram:refresh", { detail: { projectId, view } }));
  };

  const onNormalizeRisk = (e) => {
    const { projectId, riskId, op } = e.detail || {};
    // trigger your risk normalization UI/actions
    window.dispatchEvent(new CustomEvent("xhandle:risk:normalize", { detail: { projectId, riskId, op } }));
  };

  const onGenerateMitigations = (e) => {
    const { projectId, riskId } = e.detail || {};
    // kick off your mitigation generator (LLM pipeline) for a specific risk
    window.dispatchEvent(new CustomEvent("xhandle:risk:generateMitigations", { detail: { projectId, riskId } }));
  };

  window.addEventListener("xhandle:xagent:run-analysis", onRunAnalysis);
  window.addEventListener("xhandle:xagent:refresh-diagram", onRefreshDiagram);
  window.addEventListener("xhandle:xagent:normalize-risk", onNormalizeRisk);
  window.addEventListener("xhandle:xagent:generate-mitigations", onGenerateMitigations);
  return () => {
    window.removeEventListener("xhandle:xagent:run-analysis", onRunAnalysis);
    window.removeEventListener("xhandle:xagent:refresh-diagram", onRefreshDiagram);
    window.removeEventListener("xhandle:xagent:normalize-risk", onNormalizeRisk);
    window.removeEventListener("xhandle:xagent:generate-mitigations", onGenerateMitigations);
  };
}, [setSection, setActiveProjectId, setActiveTab]);

  useEffect(() => {
    if (!projectLoaded) return;
    if (requirements.length === 0 && analysisResult?.Summary) {
      const seededReqs = buildRequirementsFromSummary(analysisResult.Summary);
      if (seededReqs.length) setRequirements(seededReqs);
    }
  }, [projectLoaded, requirements.length, analysisResult])

  // Keep total steps aligned with method
  useEffect(() => {
    setProgress(prev => ({ ...prev, total: stepDescriptionsMap[riskMethod]?.total || 9 }));
  }, [riskMethod, stepDescriptionsMap]);

  
  // Risk Register sidebar selection + filters
const [riskListSelection, setRiskListSelection] = useState(new Set());

// Map labels dynamically to match the analysis / functional decomposition
const CANDIDATE_LABELS = {
  hazard: ['Hazard','Hazards','Failure Mode','Risk','Risk Title','What-If','Scenario','Event'],
  uca: ['Unsafe Control Actions','Unsafe Control Action','UCA','Failure Mode','Failure Modes','What-If Scenario','What-If Scenarios','Effect','Cause','Causal Factor','What-If Detail','Consequence','Description'],
};

const availableSummaryHeaders = useMemo(() => {
  const firstRow = Array.isArray(analysisResult?.Summary) && analysisResult.Summary.length > 0
    ? analysisResult.Summary[0]
    : null;
  return firstRow ? new Set(firstRow.map(String)) : new Set();
}, [analysisResult]);

function pickLabel(candidates, fallback) {
  for (const c of candidates) if (availableSummaryHeaders.has(c)) return c;
  return fallback;
}

const hazardLabel = pickLabel(CANDIDATE_LABELS.hazard, 'Hazard');

const ucaLabel = pickLabel(CANDIDATE_LABELS.uca, 'Unsafe Control Actions');

// ⬇️ INSERT RIGHT AFTER hazardLabel and ucaLabel useMemos

// --- Column definitions used by the Risk Register table header ---
const COLS = useMemo(() => ([
  { key: 'id',          label: 'ID',                type: 'text' },
  { key: 'title',       label: hazardLabel,         type: 'text' },
  { key: 'description', label: ucaLabel,            type: 'text' },
  { key: 'likelihood',  label: 'Likelihood',        type: 'number' },
  { key: 'severity',    label: 'Severity',          type: 'number' },
  { key: 'priority',    label: 'Priority',          type: 'derived' }, // L*S
  { key: 'status',      label: 'Status',            type: 'text' },
  { key: 'owner',       label: 'Owner',             type: 'text' },
  { key: 'dueDate',     label: 'Due Date',          type: 'date' },
  { key: 'tags',        label: 'Tags',              type: 'tags' },
  { key: 'actions',     label: '',                  type: 'none' },     // aligns with last actions col
]), [hazardLabel, ucaLabel]);

// Build per-column option lists from current Risk Register
const columnOptions = useMemo(() => {
  const opts = {};
  const rows = riskRegister || [];

  const add = (k, v) => {
    if (!opts[k]) opts[k] = new Set();
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      opts[k].add(String(v));
    }
  };

  rows.forEach(r => {
    add('id', r.id);
    add('title', r.title);
    add('description', r.description);
    add('likelihood', r.likelihood);
    add('severity', r.severity);
    add('priority', (Number(r.likelihood)||0) * (Number(r.severity)||0));
    add('status', r.status);
    add('owner', r.owner);
    add('dueDate', r.dueDate);
    if (r.tags) {
      String(r.tags).split(',').map(s=>s.trim()).filter(Boolean).forEach(t => add('tags', t));
    }
  });

  const out = {};
  Object.entries(opts).forEach(([k, set]) => {
    const arr = Array.from(set);
    if (['likelihood','severity','priority'].includes(k)) {
      out[k] = arr.map(Number).sort((a,b)=>a-b).map(String);
    } else {
      out[k] = arr.sort((a,b)=>String(a).localeCompare(String(b)));
    }
  });
  return out;
}, [riskRegister]);

// Selected values per column (multi-select)
const [colFilters, setColFilters] = useState({});
// Which column's dropdown is open
const [openFilterKey, setOpenFilterKey] = useState(null);
// Per-column search text in the dropdown
const [filterSearch, setFilterSearch] = useState({});

// Close dropdowns on outside click
useEffect(() => {
  const onDocClick = (e) => {
    if (!e.target.closest?.('[data-filter-panel="true"]') &&
        !e.target.closest?.('[data-filter-button="true"]')) {
      setOpenFilterKey(null);
    }
  };
  document.addEventListener('pointerdown', onDocClick);
  return () => document.removeEventListener('pointerdown', onDocClick);
}, []);


// Sidebar “filter-by” column options (key maps to riskRegister fields)
const [riskTableFilters] = useState({
  title: "",
  status: [],
  owner: [],
  tags: "",
  likelihood: [],
  severity: [],
});

useEffect(() => {
  const allIds = new Set((riskRegister || []).map(r => r.id));
  if (riskListSelection.size === 0) {
    setRiskListSelection(allIds);
  } else {
    const next = new Set();
    for (const id of riskListSelection) if (allIds.has(id)) next.add(id);
    if (next.size !== riskListSelection.size) setRiskListSelection(next);
  }
}, [riskListSelection, riskRegister]);

const displayedRiskIds = riskListSelection;
const filteredRiskRows = useMemo(() => {
  const titleQ = (riskTableFilters.title || "").toLowerCase();
  const tagsQ  = (riskTableFilters.tags || "").toLowerCase();
  const statusSet = new Set(riskTableFilters.status);
  const ownerSet  = new Set(riskTableFilters.owner);
  const likSet    = new Set(riskTableFilters.likelihood.map(Number));
  const sevSet    = new Set(riskTableFilters.severity.map(Number));

  const headerPass = (row) => {
    // no header filters? quick pass
    if (!colFilters || Object.keys(colFilters).length === 0) return true;

    const has = (k, v) => (colFilters[k] && colFilters[k].size > 0) ? colFilters[k].has(String(v)) : true;

    // Priority is derived (L*S)
    const priorityVal = (Number(row.likelihood)||0) * (Number(row.severity)||0);

    // Tags: match if any selected tag appears in row.tags
    const tagTokens = String(row.tags || '').split(',').map(s=>s.trim()).filter(Boolean);
    const tagsSelected = colFilters['tags'] && colFilters['tags'].size > 0
      ? tagTokens.some(t => colFilters['tags'].has(String(t)))
      : true;

    return (
      has('id', row.id) &&
      has('title', row.title ?? '') &&
      has('description', row.description ?? '') &&
      has('likelihood', Number(row.likelihood)||0) &&
      has('severity', Number(row.severity)||0) &&
      (colFilters['priority']?.size ? colFilters['priority'].has(String(priorityVal)) : true) &&
      has('status', row.status ?? '') &&
      has('owner', row.owner ?? '') &&
      has('dueDate', row.dueDate ?? '') &&
      tagsSelected
    );
  };

  return (riskRegister || [])
    .filter(r => displayedRiskIds.has(r.id))
    // existing simple filters
    .filter(r => !titleQ || `${r.title||""} ${r.description||""}`.toLowerCase().includes(titleQ))
    .filter(r => statusSet.size === 0 || statusSet.has(r.status))
    .filter(r => ownerSet.size === 0 || ownerSet.has((r.owner||"").trim()))
    .filter(r => !tagsQ || (r.tags||"").toLowerCase().includes(tagsQ))
    .filter(r => likSet.size === 0 || likSet.has(Number(r.likelihood)||0))
    .filter(r => sevSet.size === 0 || sevSet.has(Number(r.severity)||0))
    // header multi-select filters
    .filter(headerPass)
    .slice()
    .sort((a,b) =>
      ((Number(b.likelihood)||0)*(Number(b.severity)||0)) -
      ((Number(a.likelihood)||0)*(Number(a.severity)||0))
    );
}, [riskRegister, displayedRiskIds, riskTableFilters, colFilters]);


  // Dropdown outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      const activeRef = dropdownRefs.current[filterColumnIndex];
      if (activeRef && !activeRef.contains(event.target)) {
        setColumnSearches({});
        setFilterColumnIndex(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [filterColumnIndex]);

  // Load per-project state whenever activeProjectId changes
  useEffect(() => {
    if (!activeProjectId) { 
      setResponseRows([]);
      setAnalysisResult(null);
      setRiskMethod(DEFAULT_RISK_METHOD);
      setAgentReportResult(null); // NEW: reset when no project
      setRiskRegister([]);
      setRequirements([]);      
      setShowPromptWizard(true);
      setProjectLoaded(false);
      return;
    }
    const data = loadProjectData(activeProjectId);
    setResponseRows(data?.responseRows || []);
    setAnalysisResult(data?.analysisResult || null);
    setRiskMethod(normalizeRiskMethod(data?.riskMethod));
    setAgentReportResult(data?.agentReportResult || null); // NEW: restore report
    setRiskRegister(data?.riskRegister || []);
    setShowPromptWizard(!(data?.responseRows && data.responseRows.length > 0));
    setProjectLoaded(true);
    setRequirements(data?.requirements || []);   // ← add this

  }, [activeProjectId]);
  useEffect(() => {
    if (!projectLoaded) return;
    setRiskRegister(prev => {
      let changed = false;
      const next = prev.map(r => {
        if (!r.id) { changed = true; return { ...r, id: makeId() }; }
        return r;
      });
      return changed ? next : prev;
    });
  }, [projectLoaded]);
  
  useEffect(() => {
    if (!activeProjectId) return;
    const pd = loadProjectData(activeProjectId) || {};
    setRiskRegister(Array.isArray(pd.riskRegister) ? pd.riskRegister : []);
    setRequirements(Array.isArray(pd.requirements) ? pd.requirements : []);
    setVnvArtifacts(pd.vnvArtifacts || {
      summary: null,
      testCases: [],
      traceMatrix: [],
      procedures: [],
      hazardsCoverage: [],
      datasets: [],
    });
  }, [activeProjectId]);

  // Persist per-project state whenever it changes (including the report)
useEffect(() => {
  if (!activeProjectId || !projectLoaded) return;
  saveProjectPatch(activeProjectId, {
    responseRows,
    analysisResult,
    riskMethod,
    agentReportResult,
    riskRegister,
    requirements,        // ← add this
  });  
}, [
  activeProjectId,
  projectLoaded,
  responseRows,
  analysisResult,
  riskMethod,
  agentReportResult,
  riskRegister, // <-- ensure riskRegister is in the deps
  requirements,
]);

   // Accept an optional prompt override so we don't rely on async state
// Accept an optional prompt override for Custom Report
// Accept an optional prompt override for Custom Report
const handleGenerateAgentReport = async (customPromptOverride = null) => {
  if (!analysisResult?.Summary) return;

  // --- start activity
  const activityId = `agent-${activeProjectId || "default"}`;
  startActivity(activityId, {
    title: "Generating safety report",
    step: 1,
    total: Object.keys(agentStepDescriptions).length,
    message: agentStepDescriptions[1] || "Starting…"
  });

  setIsGeneratingAgentReport(true);
  setProgress({ step: 1, total: Object.keys(agentStepDescriptions).length });

  const decompositionRows = (responseRows || []).map(row => [
    row.fromFunction || "",
    row.controlAction || "",
    row.toFunction || ""
  ]);

  const customPromptToSend =
    reportType === "Custom Report"
      ? (customPromptOverride ?? customReportPrompt ?? "")
      : "";

  if (reportType === "Custom Report" && !customPromptToSend.trim()) {
    // stop spinner + keep activity around (no finish) so user can resume
    setIsGeneratingAgentReport(false);
    setShowCustomPromptModal(true);
    return;
  }

  try {
    const result = await generateAgenticRiskReport({
      summarySheet: analysisResult.Summary,
      method: riskMethod,
      mode: "autonomous",                // ⬅ hard-coded
      onClarifyChunk: null,              // ⬅ no interactive callbacks
      functionalDiagramImage,
      functionalDecomposition: decompositionRows,
      // Wrap setProgress so Activities stay in sync
      setProgress: (p) => {
        setProgress(p);
        updateActivity(activityId, {
          step: p?.step || 0,
          total: p?.total || Object.keys(agentStepDescriptions).length,
          message: agentStepDescriptions[p?.step] || "Working…"
        });
      },
      reportType,
      customPrompt: customPromptToSend,
    });

    setAgentReportResult(result);
    finishActivity(activityId, "success", "Report ready");
  } catch (err) {
    logger.error("Agentic report failed:", err);
    finishActivity(activityId, "error", err?.message || "Report failed");
    alert(err?.message || "Sorry — report generation failed.");
  } finally {
    setIsGeneratingAgentReport(false);
  }
};


  useEffect(() => {
    if (!analysisResult?.Summary) return;
    // Only seed if empty so you don't overwrite edits
    if (riskRegister.length === 0) {
      const seeded = buildRiskRegisterFromSummary(analysisResult.Summary);
      if (seeded.length) setRiskRegister(seeded);
    }
  }, [analysisResult?.Summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture diagram image after analysis completes
  useEffect(() => {
    if (!analysisResult) return;
    const waitForDiagram = async (maxRetries = 10, delay = 200) => {
      for (let i = 0; i < maxRetries; i++) {
        if (diagramRef.current?.isReady?.()) return true;
        await new Promise((r) => setTimeout(r, delay));
      }
      logger.warn("⚠️ Diagram ref not ready after waiting.");
      return false;
    };
    const exportDiagram = async () => {
      const isReady = await waitForDiagram();
      if (!isReady) return;
      const image = await diagramRef.current.exportAsImage();
      setFunctionalDiagramImage(image);
    };
    exportDiagram();
  }, [analysisResult]);

  const getUniqueColumnValues = (colIdx, searchText = '') => {
    const rows = analysisResult?.Summary?.slice(1) ?? [];
    const unique = new Set();
    rows.forEach(row => { if (row[colIdx]) unique.add(row[colIdx]); });
    return Array.from(unique).filter(val => String(val).toLowerCase().includes(searchText.toLowerCase()));
  };
  const toggleFilterValue = (colIdx, value) => {
    const current = columnFilters[colIdx] || [];
    const updated = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    setColumnFilters({ ...columnFilters, [colIdx]: updated });
  };
  const applyFilters = (rows) => rows.filter((row) =>
    Object.entries(columnFilters).every(([colIdx, allowed]) =>
      allowed.length === 0 || allowed.includes(row[colIdx])
    )
  );

  const handleRowChange = (index, field, value) => {
    const updated = [...responseRows];
    updated[index][field] = value;
    setResponseRows(updated);
  };
  const handleAddRow = () => setResponseRows([...responseRows, { fromFunction:'', fromDetails:'', controlAction:'', controlDetails:'', toFunction:'', toDetails:'' }]);
  const handleRemoveRow = (index) => setResponseRows(responseRows.filter((_, i) => i !== index));

  const handleRunAnalysis = async (selectedMethod) => {
    const functionalDecompositionSheet = [
      ["Function (From)", "Control Action", "Function (To)"],
      ...responseRows.map(row => [row.fromFunction || "", row.controlAction || "", row.toFunction || ""])
    ];
    const sheets = { "Functional Decomposition": functionalDecompositionSheet };
    const dummySetFolders = async (updater) => { const prev = {}; const newState = await updater(prev); return newState; };
    const currentFolder = "LiteProject";
  
    // NEW: start activity
    const actId = `hazard-${activeProjectId || "default"}`;
    setAnalysisActivityId(actId);
    startActivity(actId, {
      title: "Running hazard analysis",
      step: 0,
      total: stepDescriptionsMap[selectedMethod]?.total || 9,
      message: "Starting analysis..."
    });
  
    setIsAnalyzing(true);
    setProgress({ step: 0, total: stepDescriptionsMap[selectedMethod].total });
  
    const finalSheets = await runLiteAIAnalysis({
      tableRows: responseRows,
      sheets,
      setFolders: dummySetFolders,
      currentFolder,
      setChatPrompt: () => {},
      setChatResponse: () => {},
      setProgress,              // keeps your UI updated
      hazardMethod: selectedMethod,
    });
  
    setAnalysisResult(finalSheets);
    setIsAnalyzing(false);
    setActiveTab('Hazard Analysis');
  
    // NEW: finish activity
    finishActivity(actId, "success", "Analysis complete");
  };
  

  // Exporters
  const exportDecompositionCSV = () => {
    if (!responseRows?.length) return;
    const headers = ["Function (From)","Function (From) Details","Control Action","Control Action Details","Function (To)","Function (To) Details"];
    const rows2D = responseRows.map(r => ([ r.fromFunction ?? "", r.fromDetails ?? "", r.controlAction ?? "", r.controlDetails ?? "", r.toFunction ?? "", r.toDetails ?? "" ]));
    const escapeCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows2D].map(r => r.map(escapeCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const ts = new Date().toISOString().slice(0, 10);
    const filename = `functional_decomposition_${ts}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  
// Apply agent suggestions (create/update/link) into local Requirements state
const handleApplyTraceabilityPatches = async (suggestions) => {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return;
  setRequirements(prev => {
    const next = [...prev];
    const createdIdMap = new Map();
    const mapId = (id) => createdIdMap.get(id) || id;

    // 1) Create new nodes first (so links can reference them)
    suggestions
      .filter(s => s.type === 'create')
      .forEach(s => {
        const realId = makeId();
        createdIdMap.set(s.previewId || s.title || realId, realId);
        next.push({
          id: realId,
          title: s.title || 'New Item',
          module: s.module || 'Requirement',
          attributes: s.attributes || {},
          links: [],
        });
      });

    // 2) Apply updates
    suggestions
      .filter(s => s.type === 'update' && s.id)
      .forEach(s => {
        const idx = next.findIndex(r => r.id === s.id);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            title: s.title != null ? s.title : next[idx].title,
            attributes: s.attributes || next[idx].attributes,
          };
        }
      });

    // 3) Apply links (auto-create placeholders for HZ:/MT: ids)
    suggestions
      .filter(s => s.type === 'link' && s.fromId && s.toId)
      .forEach(s => {
        const fromId = mapId(s.fromId);
        const toId   = mapId(s.toId);

        const fromLooksVirtual = /^HZ:|^MT:/i.test(fromId);
        const toLooksVirtual   = /^HZ:|^MT:/i.test(toId);

        const from =
          next.find(r => r.id === fromId) ||
          (fromLooksVirtual ? ensureReqById(next, fromId, { module: /^HZ:/i.test(fromId) ? 'Hazard' : 'Mitigation' }) : null);

        const to =
          next.find(r => r.id === toId) ||
          (toLooksVirtual ? ensureReqById(next, toId, { module: /^HZ:/i.test(toId) ? 'Hazard' : 'Mitigation' }) : null);

        if (!from || !to) return;

        const links = Array.isArray(from.links) ? [...from.links] : [];
        const linkType = s.linkType || 'refines';
        if (!links.find(l => l.toId === to.id && l.type === linkType)) {
          links.push({ toId: to.id, type: linkType });
          const idx = next.findIndex(r => r.id === from.id);
          next[idx] = { ...from, links };
        }
      });

    return next;
  });
};

  const displayedReport = (
    agentReportResult?.report ?? agentReportResult?.markdown ?? agentReportResult?.text ?? agentReportResult?.content ?? ""
  ).trim();

  // Console summary
  // ── Console dashboard data ─────────────────────────────────────────────
const activeProject = useMemo(
  () => projects.find(p => p.id === activeProjectId) || null,
  [projects, activeProjectId]
);

// Hint the Copilot about repo/baseline context (optional keys)
const projectHint = {
  owner: localStorage.getItem("repoOwner") || undefined,
  repo: localStorage.getItem("repoName") || undefined,
  baselineKey: localStorage.getItem("activeBaselineKey") || undefined,
};

// Donut + horizontal bars: risk counts by status

  // 🔧 fit-to-view utilities so the canvas isn’t stuck zoomed
  const fitDiagramToView = (padding = 0.2) => {
    try { diagramRef.current?.fitView?.({ padding }); } catch {}
  };

  useEffect(() => {
    if (!showFunctionalDiagram) return;
    if (responseRows.length > 0) {
      const t = setTimeout(() => fitDiagramToView(0.2), 60);
      return () => clearTimeout(t);
    }
  }, [responseRows.length, showFunctionalDiagram]);

  useEffect(() => {
    if (!analysisResult) return;
    const t = setTimeout(() => fitDiagramToView(0.2), 60);
    return () => clearTimeout(t);
  }, [analysisResult]);

// ⬇️ INSERT JUST ABOVE `return ( ... )`

const ColumnFilterButton = ({ col }) => {
  const k = col.key;
  if (k === 'actions') return null;

  const options = columnOptions[k] || [];
  const active = (colFilters[k]?.size || 0) > 0;
  const search = filterSearch[k] || '';

  const visibleOptions = options.filter(v =>
    !search || String(v).toLowerCase().includes(search.toLowerCase())
  );

  const toggleValue = (val) => {
    setColFilters(prev => {
      const cur = new Set(prev[k] || []);
      if (cur.has(val)) cur.delete(val); else cur.add(val);
      return { ...prev, [k]: cur };
    });
  };

  const setAll = () => setColFilters(prev => ({ ...prev, [k]: new Set(visibleOptions) }));
  const setNone = () => setColFilters(prev => ({ ...prev, [k]: new Set() }));
  const clearAll = () => setColFilters(prev => { const next={...prev}; delete next[k]; return next; });

  return (
    <div className="relative">
      <button
        type="button"
        data-filter-button="true"
        onClick={() => setOpenFilterKey(openFilterKey === k ? null : k)}
        className={`inline-flex items-center gap-1 hover:underline ${active ? 'text-[#2D7DFE] font-semibold' : ''}`}
        title={`Filter ${col.label}`}
      >
        {col.label}
        <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7l5 6 5-6H5z" /></svg>
      </button>

      {openFilterKey === k && (
        <div
          data-filter-panel="true"
          className="absolute left-0 mt-2 z-50 w-64 rounded-lg border bg-white shadow-lg p-2"
        >
          <input
            className="w-full border rounded px-2 py-1 text-xs mb-2"
            placeholder={`Search ${col.label}…`}
            value={search}
            onChange={e => setFilterSearch(s => ({ ...s, [k]: e.target.value }))}
          />

          <div className="flex items-center gap-2 mb-2">
            <button className="text-xs border rounded px-2 py-1" onClick={setAll}>All</button>
            <button className="text-xs border rounded px-2 py-1" onClick={setNone}>None</button>
            <button className="text-xs border rounded px-2 py-1 ml-auto" onClick={clearAll}>Clear</button>
          </div>

          <div className="max-h-56 overflow-auto pr-1">
            {visibleOptions.length === 0 ? (
              <div className="text-xs text-gray-500 px-1 py-1.5">No matches</div>
            ) : visibleOptions.map(v => (
              <label key={v} className="flex items-center gap-2 text-sm px-1 py-1">
                <input
                  type="checkbox"
                  checked={colFilters[k]?.has?.(String(v)) || false}
                  onChange={() => toggleValue(String(v))}
                />
                <span className="truncate" title={String(v)}>{String(v)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

  return (
<>
      {/* Fixed top nav (56px tall) */}
      <div className="fixed inset-x-0 top-0 z-40">
              <TopNavBar
  onUpgrade={() => setLicenseModalOpen(true)}
  onOpenSettings={() => setShowSettingsModal(true)}
  onOpenReadme={() => setShowReadmeModal(true)}
  onSignOut={resetLocalSession}
  rightActions={
    <div className="flex items-center gap-2 shrink-0">
      <AgentHubButton onOpen={() => setAgentsOpen(true)} />
  
      <ActivitiesButton />
  
      <button
        type="button"
        onClick={toggle}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="inline-flex items-center justify-center h-8 w-8 rounded-md border
                   text-xs transition shrink-0
                   hover:bg-gray-100 dark:hover:bg-zinc-800
                   border-gray-200 dark:border-zinc-700
                   text-gray-700 dark:text-zinc-100"
      >
        {isDark ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  }
/>

<ReadmeModal
  open={showReadmeModal}
  onClose={() => setShowReadmeModal(false)}
/>

{/* Activities dropdown (top bar) */}




{createPortal(
      dockOpen ? (
        <div className="fixed top-14 right-0 bottom-0 z-[1000] w-[380px] md:w-[420px] border-l bg-white shadow-2xl flex flex-col">
          {/* Dock header */}
          <div className="h-10 border-b flex items-center justify-between px-2 text-xs">
            <div className="font-semibold">Copilot</div>
            <div className="flex items-center gap-1">
  {/* Agent toggle */}
  <button
    type="button"
    onClick={() => {
      const next = !agentMode;
      setAgentMode(next);
      try {
        // Let the docked copilot know to enable/disable agent mode
        window.dispatchEvent(new CustomEvent("xhandle:copilot-set-agent", { detail: { on: next } }));
        localStorage.setItem("xhandle.agentMode", JSON.stringify(next));
      } catch {}
    }}
    className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition ${
      agentMode
        ? "bg-indigo-600 text-white border-indigo-600"
        : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
    }`}
    title={agentMode ? "Agent On" : "Agent Off"}
  >
    <Bot className="w-4 h-4" />
    <span>{agentMode ? "Agent On" : "Agent Off"}</span>
  </button>

  {/* Undock (return to full-screen Copilot) */}
  <button
    className="px-2 py-1 rounded hover:bg-gray-100"
    title="Undock"
    onClick={() => {
      setDockOpen(false);
      setSection("copilot"); // jump to full-screen copilot
      try { localStorage.setItem("xhandle.copilotDockOpen", "false"); } catch {}
      try { window.dispatchEvent(new CustomEvent("xhandle:copilot-undock")); } catch {}
    }}
  >
    <PanelLeftClose className="w-4 h-4" />
  </button>
  <button
  className="px-2 py-1 rounded hover:bg-gray-100"
  title="Close"
  aria-label="Close dock"
  onClick={() => {
    // Close the dock WITHOUT routing to full-screen Copilot
    setDockOpen(false);
    try { localStorage.setItem("xhandle.copilotDockOpen", "false"); } catch {}
  }}
>
  <X className="w-4 h-4" />
</button>

</div>

          </div>

          {/* Copilot body */}
          {!dockCollapsed ? (
            <div className="flex-1 min-h-0">
              <XHandleCopilotView
                projectHint={projectHint}
                copilotContext={getActiveProjectContext()}
                onRequestDock={() => {
                  setDockOpen(true);
                  try { localStorage.setItem('xhandle.copilotDockOpen','true'); } catch {}
                }}
                defaultSidebarOpen={false}
                docked
                onRequestUndock={() => {
                  setDockOpen(false);
                  try { localStorage.setItem('xhandle.copilotDockOpen','false'); } catch {}
                }}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 grid place-items-center text-xs text-gray-500">
              Copilot docked (collapsed)
            </div>
          )}
        </div>
      ) : null,
      document.body
    )}

<AgentsConsole
  isOpen={agentsOpen}
  onClose={() => setAgentsOpen(false)}
  performTask={performTask}
  activeProjectId={activeProjectId}
/>

{/* tiny signed-in indicator (optional) */}
      </div>
  
      {/* Push page content below the header */}
      <div className={`${dockPaddingClass} fixed inset-x-0 top-14 bottom-0`}>
  <div className="flex h-full bg-white overflow-hidden">
    {/* Sidebar */}
    <aside
      onMouseEnter={() => setIsSidebarOpen(true)}
      onMouseLeave={() => setIsSidebarOpen(false)}
      className={`sticky top-0 h-full border-r bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 z-30 transition-[width] duration-300 ease-in-out overflow-hidden
        ${isSidebarOpen ? 'w-64' : 'w-[68px]'} hidden md:flex flex-col`}
    >
          <div className="flex items-center justify-between px-3 py-4">
          <div className="flex items-center gap-2">
            {isSidebarOpen && <span className="text-sm font-semibold"></span>}
          </div>
        </div>

        <div className="px-3 py-2 space-y-1">
          <NavItem icon={LayoutDashboard} label="Console" active={section === 'console'} onClick={() => setSection('console')} />
          <NavItem
  icon={ShieldAlert}
  label="Risk Register"
  active={section === 'risk'}
  onClick={() => setSection('risk')}
/>
{/* AI Project Manager (with badge) */}
<NavItem
  icon={CalendarClock}
  label={
    isSidebarOpen ? (
      <span className="inline-flex items-center gap-2">
        <span>Project Manager</span>
        {/* Removed badge display */}
      </span>
    ) : (
      'AI PM'
    )
  }
  active={section === 'ai-pm'}
  onClick={() => setSection('ai-pm')}
/>

<NavItem
  icon={GitCommit}
  label="Code-Based Architecture"
  active={section === 'code-architecture'}
  onClick={() => setSection('code-architecture')}
/>

<NavItem
  icon={FileText}
  label="Requirements Management"
  active={section === 'requirements'}
  onClick={() => setSection('requirements')}
/>

<NavItem
  icon={FlaskConical}
  label="V&V Center"
  active={section === 'vnv'}
  onClick={() => setSection('vnv')}
/>

{/* xHandle Copilot (full-screen view) */}
<NavItem
  icon={() => (
    <div className="flex items-center justify-center w-[30px] h-[30px]">
      <img
        src="/x_Logo.PNG"
        alt="Copilot"
        className={`w-full h-full object-contain transition-all duration-300 ${
          section === 'copilot' && !dockOpen
            ? 'drop-shadow-[0_0_6px_#2D7DFE]'
            : ''
        }`}
      />
    </div>
  )}
  label="Copilot"
  active={section === 'copilot' && !dockOpen}
  disabled={dockOpen}
  onClick={() => setSection('copilot')}
/>







          {/* Projects row with + and collapsible list */}
          <div className={`w-full ${isSidebarOpen ? '' : 'flex justify-center'}`}>
            <div className={`flex items-center ${isSidebarOpen ? 'gap-2' : ''} w-full`}>
              <NavItem
                icon={FolderGit2}
                label={isSidebarOpen ? (
                  <span className="inline-flex items-center gap-2">
                    <span className={`transition-transform ${isProjectsOpen ? 'rotate-90' : ''}`}>
                      <ChevronRight size={14} />
                    </span>
                    <span>Projects</span>
                    {projects.length > 0 && (
  <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
    {projects.length}/{projectLimit}
  </span>
)}

                  </span>
                ) : 'Projects'}
                active={section === 'projects'}
                onClick={() => { setSection('projects'); setIsProjectsOpen(o => !o); }}
              />
<button
  disabled={atProjectLimit}
  className={`rounded-lg ${
    atProjectLimit ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
  } text-gray-700
  ${isSidebarOpen ? 'p-1.5 shrink-0' : 'w-0 p-0 overflow-hidden opacity-0 pointer-events-none shrink'}`}
  title={
    atProjectLimit
      ? `Limit reached (${projectLimit}) — Upgrade to add more`
      : 'New project'
  }
  aria-label="New project"
  aria-hidden={!isSidebarOpen}
  tabIndex={isSidebarOpen ? 0 : -1}
  onClick={() => {
    if (!guardNewProjectIntent()) return;
    setSection('projects');
    setShowNewProject(true);
  }}
>
  <Plus size={16} className="block" />
</button>



            </div>
          </div>

          {/* Collapsible list */}
          {isSidebarOpen && isProjectsOpen && projects.length > 0 && (
            <div className="mt-1 ml-9 pr-1 max-h-56 overflow-auto space-y-1" role="list" aria-label="Projects">
{projects.map((p) => (
  <div key={p.id} className="group relative">
    <div className="flex items-center justify-between">
      {editingProjectId === p.id ? (
        <div className="flex-1 flex items-center gap-2 px-2 py-1.5">
          <input
            autoFocus
            className="flex-1 bg-white border rounded px-2 py-1 text-sm"
            value={editingProjectName}
            onChange={(e) => { setEditingProjectName(e.target.value); if (renameError) setRenameError(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            }}
            placeholder="New project name"
          />
          <button
            onClick={(e) => { e.stopPropagation(); commitRename(); }}
            className="text-sm text-[#2D7DFE] hover:underline"
            title="Save name"
          >
            Save
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); cancelRename(); }}
            className="text-sm text-gray-600 hover:underline"
            title="Cancel rename"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setSection('projects'); setActiveProjectId(p.id); }}
          className={`flex-1 text-left px-2 py-1.5 rounded-lg truncate transition-colors ${
            activeProjectId === p.id ? 'bg-[#ECEEFF] text-[#0F0F12]' : 'text-gray-700 hover:bg-gray-100'
          }`}
          title={p.name}
        >
          {p.name}
        </button>
      )}

      {/* Three-dots menu trigger (hidden until hover) */}
      {editingProjectId !== p.id && (
       <button
       ref={(el) => (projectMenuAnchorEls.current[p.id] = el)}
       data-project-menu-trigger="true"
       onMouseDown={(e) => { e.stopPropagation(); }}
       onClick={(e) => {
         e.stopPropagation();
         setOpenProjectMenuId((cur) => (cur === p.id ? null : p.id));
       }}
       className="ml-1 p-1.5 rounded hover:bg-gray-100 text-gray-600 invisible group-hover:visible"
       aria-haspopup="menu"
       aria-expanded={openProjectMenuId === p.id}
       title="More options"
     >
       <MoreVertical size={16} />
     </button>
     

      )}
    </div>

    {/* Dropdown menu */}
    {openProjectMenuId === p.id && (
      <ProjectMenuPortal
  anchorEl={projectMenuAnchorEls.current[p.id]}
  setPortalRef={(el) => (projectMenuPortalRefs.current[p.id] = el)}
  onRename={() => { setOpenProjectMenuId(null); beginRename(p); }}
  onDelete={() => { setOpenProjectMenuId(null); deleteProject(p.id); }}
/>


)}


    {editingProjectId === p.id && renameError && (
      <div className="px-2 text-[11px] text-red-600 mt-1">{renameError}</div>
    )}
  </div>
))}


            </div>
          )}
        </div>

        <div className="mt-auto px-3 pb-4">
          <div className={`text-[11px] text-gray-400 ${isSidebarOpen ? '' : 'text-center'}`}></div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        {/* COPILOT (full-screen) */}
        {section === 'copilot' && !dockOpen && (
  <XHandleCopilotView
    projectHint={projectHint}
    copilotContext={getActiveProjectContext()}
  />
)}




        {/* License toolbar (shows only if not licensed) */}
{/* License toolbar (shows only if not licensed) */}
{!lic.loading && !lic.ok && (
  <>
    {/* Fixed just under the fixed TopNavBar (h-14) */}
    <div className="fixed top-14 inset-x-0 z-30 bg-yellow-50 border-b border-yellow-200">
    <div className="sticky top-0 z-20 bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex justify-center">
    <div className="text-sm text-yellow-800 text-center">
          You’re on the free tier. Click Upgrade to unlock Pro features.
        </div>
      </div>
    </div>

    {/* Spacer so content doesn’t sit under the fixed bar */}
    <div className="h-10" />
  </>
)}
    {/* CODE BASED ANALYSIS */}
{section === 'code-architecture' && (
  <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-1 px-3 md:px-5 lg:px-7 w-full">
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-2xl md:text-2xl font-semibold">Code-Based Architecture</h1>
        <p className="text-gray-500 text-sm">
          Analyze your repository’s code to extract a functional architecture table and diagram.
        </p>
      </div>
    </div>

    {cbaLoading
  ? null
  : cbaTableData.length > 0 ? (
      <div className="rounded-2xl border bg-white p-4">
        <FunctionalDecompositionTable
          data={cbaTableData}
          onRequestCreateProject={handleCreateProjectFromSelection}
        />
      </div>
    ) : (
      <div className="rounded-xl border bg-white p-8 text-gray-600 text-sm">
        Click <span className="font-medium">Analyze</span> to fetch repo files, build a dependency graph,
        and generate the functional interaction table. You can switch to Diagram View on the table once it’s populated.
      </div>
    )
}
  </div>
)}


{section === 'console' && (
  <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-1 px-3 md:px-5 lg:px-7 w-full">
    <div className="mb-8">
      <h1 className="text-2xl md:text-2xl font-semibold">Console</h1>
      <p className="text-gray-500 text-sm">At-a-glance project summary</p>
    </div>

    {/* Dashboard panels */}
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Status overview (donut) */}
      <Panel title="Risk status overview" subtitle={consoleSubtitle}>
        {consoleRiskRegister.length === 0 ? (
          <EmptyState text="No risks yet." />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={consoleRiskStatusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                >
                  {consoleRiskStatusData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={['#6366F1', '#F59E0B', '#10B981', '#A78BFA', '#EF4444'][i % 5]}
                    />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {/* Recent activity */}
      <Panel title="Recent activity" subtitle="What changed lately">
        <ul className="space-y-3">
          {consoleRecentActivity.length === 0 && (
            <li className="text-sm text-gray-500">Nothing to show yet.</li>
          )}
          {consoleRecentActivity.map((act, i) => (
            <li key={i} className="text-sm text-gray-800">
              <span className="font-medium">{act.user}</span> updated{' '}
              <span className="text-indigo-600">{act.item}</span>{' '}
              {act.status && <>→ <Badge>{act.status}</Badge></>}
              {act.when && <span className="text-gray-500"> · {act.when}</span>}
            </li>
          ))}
        </ul>
      </Panel>

      {/* Priority breakdown (vertical bars) */}
      <Panel title="Priority breakdown" subtitle="Risk RPN buckets">
        {consoleRiskRegister.length === 0 ? (
          <EmptyState text="No risks to bucket yet." />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={consolePriorityBucketData}>
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value">
                  {consolePriorityBucketData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={['#6366F1', '#F59E0B', '#10B981', '#A78BFA', '#EF4444'][i % 5]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {/* Types of work-style panel (horizontal bars of statuses) */}
      <Panel title="Risks by status" subtitle="Distribution by state">
        {consoleRiskRegister.length === 0 ? (
          <EmptyState text="No risk states yet." />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={consoleRiskStatusData} layout="vertical">
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120} />
                <Tooltip />
                <Bar dataKey="value">
                  {consoleRiskStatusData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={['#6366F1', '#F59E0B', '#10B981', '#A78BFA', '#EF4444'][i % 5]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </div>

    {/* Hidden per request */}
    {SHOW_CONSOLE_PROJECTS && (
      <div className="mt-8">{/* old console projects grid kept behind flag */}</div>
    )}
  </div>
)}



        {/* PROJECTS */}
        {section === 'projects' && (
          <div className="flex flex-col justify-start flex-1 min-h-0 overflow-auto bg-white py-0 px-3 md:px-5 lg:px-7 w-full">
<div className="flex items-center justify-between mb-6">
  <h1 className="text-2xl font-semibold flex items-center gap-2">
    Projects
    <span
      className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border"
      title={`You can create up to ${projectLimit} project${projectLimit === 1 ? '' : 's'} on your plan`}
    >
      {projects.length}/{projectLimit}
    </span>
  </h1>
</div>

{!activeProjectId && (
  <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm mb-8">
    {atProjectLimit ? (
      <>
        You’re at your plan limit of <span className="font-medium">{projectLimit}</span> project{projectLimit === 1 ? '' : 's'}.{" "}
        <button className="underline text-[#2D7DFE]" onClick={() => setLicenseModalOpen(true)}>
          Upgrade
        </button>{" "}
        to create more.
      </>
    ) : (
      <>
        Use the sidebar to select a project, or click the “+” next to{" "}
        <span className="font-medium">Projects</span> to create one.
      </>
    )}
  </div>
)}


            {/* Original powerful UI gated by selected project */}
            {activeProjectId && (
              <>

{/* Tabs header */}
<div className="mb-5">
  <div className="border-b" role="tablist" aria-label="Project sections">
    <div className="flex items-center gap-2">
    {['Functional Diagramming', 'Hazard Analysis', 'Risk Assessment', 'Reporting'].map((t) => (

  <button
    key={t}
    onClick={() => setActiveTab(t)}
    role="tab"
    aria-selected={activeTab === t}
    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
      activeTab === t
        ? 'border-[#2D7DFE] text-[#0F0F12]'
        : 'border-transparent text-gray-600 hover:text-gray-800'
    }`}
  >
    {t}
  </button>
))}

    </div>
  </div>
</div>
{isGeneratingDecomposition && (
  <div className="fixed inset-0 flex items-center justify-center bg-white bg-opacity-80 z-50">
    <div className="flex flex-col items-center space-y-4">
      <div className="w-12 h-12 border-4 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
      <span className="text-lg text-gray-700 font-medium">
        Generating functional architecture decomposition...
      </span>
    </div>
  </div>
)}

{activeTab === 'Coverage Auditor' && (
  <section className="mt-4" role="tabpanel" aria-label="Coverage Auditor">
    {!activeProjectId ? (
      <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
        Select a project to run the auditor.
      </div>
    ) : (
      <div className="rounded-2xl border bg-white p-4">
        <TraceabilityAuditorPanel
          requirements={requirements}
          functions={responseRows}
          hazardsSummaryRows={summary2Objects(analysisResult?.Summary)}
          onRunPatches={handleApplyTraceabilityPatches}
        />
      </div>
    )}
  </section>
)}
                {isGeneratingDecomposition && (
                  <div className="fixed inset-0 flex items-center justify-center bg-white bg-opacity-80 z-50">
                    <div className="flex flex-col items-center space-y-4">
                      <div className="w-12 h-12 border-4 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-lg text-gray-700 font-medium">Generating functional architecture decomposition...</span>
                    </div>
                  </div>
                )}

{activeTab === 'Functional Diagramming' && (
  <div className="text-center">
                  {showPromptWizard && (
                    <>
                    
                    </>
                  )}

                  {showPromptWizard && (
                    <div className="max-w-4xl mx-auto w-full">
                      {/* Mode Toggle */}
                      <div className="flex items-center justify-center mb-4">
  <div className="inline-flex p-1 bg-gray-100 rounded-xl">
    <button
      className={`px-3 py-1.5 rounded-lg text-sm ${promptMode==='structured' ? 'bg-white shadow' : ''}`}
      onClick={() => setPromptMode('structured')}
    >
      Structured
    </button>
    <button
      className={`px-3 py-1.5 rounded-lg text-sm ${promptMode==='conversational' ? 'bg-white shadow' : ''}`}
      onClick={() => setPromptMode('conversational')}
    >
      Conversational
    </button>
  </div>
</div>


                      {/* Wizard / Realtime */}
                      {promptMode === 'structured' ? (
                        <PromptWizard
                          onSubmit={async (combinedPrompt) => {
                            setIsGeneratingDecomposition(true);
                            await handleLitePromptSubmit(
                              combinedPrompt,
                              (response) => {
                                const jsonMatch = response.match(/```json\s*([\s\S]*?)```/i);
                                const cleanJson = jsonMatch ? jsonMatch[1] : response;
                                try {
                                  const parsed = JSON.parse(cleanJson);
                                  setResponseRows(Array.isArray(parsed) ? parsed : []);
                                } catch (err) {
                                  logger.error("Failed to parse response as JSON array", err);
                                }
                              },
                              () => {},
                              {}
                            );
                            setIsGeneratingDecomposition(false);
                            setShowPromptWizard(false);
                            setCleanOnceKey(`wizard-${Date.now()}`);
                          }}
                          onSkip={() => {
                            setResponseRows([
                              { fromFunction: 'Node 1', fromDetails: '...', controlAction: 'Control', controlDetails: '...', toFunction: 'Node 2', toDetails: '...' }
                            ]);
                            setShowPromptWizard(false);
                            setCleanOnceKey(`wizard-${Date.now()}`);
                          }}
                        />
                      ) : (
                        <ConversationalWizard
                          onSubmit={async (combinedPrompt) => {
                            setIsGeneratingDecomposition(true);
                            await handleLitePromptSubmit(
                              combinedPrompt,
                              (response) => {
                                const jsonMatch = response.match(/```json\s*([\s\S]*?)```/i);
                                const cleanJson = jsonMatch ? jsonMatch[1] : response;
                                try {
                                  const parsed = JSON.parse(cleanJson);
                                  setResponseRows(Array.isArray(parsed) ? parsed : []);
                                } catch (err) {
                                  logger.error("Failed to parse response as JSON array", err);
                                }
                              },
                              () => {},
                              {}
                            );
                            setIsGeneratingDecomposition(false);
                            setShowPromptWizard(false);
                            setCleanOnceKey(`wizard-${Date.now()}`);
                          }}
                          onSkip={() => {
                            setResponseRows([
                              { fromFunction: 'Node 1', fromDetails: '...', controlAction: 'Control', controlDetails: '...', toFunction: 'Node 2', toDetails: '...' }
                            ]);
                            setShowPromptWizard(false);
                            setCleanOnceKey(`wizard-${Date.now()}`);
                          }}
                        />
                      )}
                      
                    </div>
                  )}

                  {responseRows.length > 0 && (
                    <>



                      <div className="mb-4 flex justify-center gap-3">
                        <div className="flex items-center space-x-2">
                          <label className="text-sm text-gray-700">Method:</label>
<select className="text-sm border rounded px-2 py-1" value={riskMethod} onChange={(e) => setRiskMethod(e.target.value)}>
  <option value="STPA-Textbook">STPA</option>
  <option value="FMEA-Textbook">FMEA</option>
  <option value="WhatIf-Textbook">What-If</option>
</select>
                        </div>

                        <button onClick={() => handleRunAnalysis(riskMethod)} className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6]">
                          Develop risk profile
                        </button>

                        {!showFunctionalDiagram && responseRows.length > 0 && (
                          <button onClick={exportDecompositionCSV} className="px-3 py-2 text-white rounded bg-[#10B981] hover:bg-[#059669]" title="Export the functional decomposition table as CSV">
                            Export CSV
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setShowFunctionalDiagram((v) => {
                              const nv = !v;
                              // 🔧 nudge React Flow to recompute bounds after the view becomes visible
                              setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
                              return nv;
                            });
                          }}
                          className="px-3 py-2 text-white rounded bg-[#7A37FF] hover:bg-[#5E2AD1]"
                        >
                          {showFunctionalDiagram ? 'Show Functional Table' : 'Visualize Functional Architecture'}
                        </button>
                      </div>

                      {/* Diagram */}
                      <div className={`${showFunctionalDiagram ? '' : 'hidden'} mb-10 w-full space-y-6`}>
                        <div className="pt-6">
                          {/* relative/pb-10/overflow-visible prevents clipping of bottom-right controls */}
                          <div className="relative pb-10 h-[560px] min-h-[560px] w-full rounded-2xl bg-white overflow-visible">
                          <LiteSummaryDiagramReactFlow
  key={activeProjectId}
  ref={diagramRef}
  rows={responseRows}
  cleanOnceKey={cleanOnceKey}
  onCleanApplied={() => setCleanOnceKey(null)}   // ← clear after first use
  storageKey={`diagram:positions:${activeProjectId}`} // ← per-project persistence
  onUpdateRows={setResponseRows}
  onRequestCreateProject={handleCreateProjectFromSelection}   // ← ADD THIS
/>


                          </div>
                        </div>
                      </div>

                      {/* Table */}
                      <div className={`${showFunctionalDiagram ? 'hidden' : ''} mb-10 w-full overflow-auto max-h-[500px]`}>
                        <table className="min-w-full border-collapse text-sm text-left shadow-sm rounded-md overflow-hidden">
                          <thead className="sticky top-0 bg-white z-10 shadow">
                            <tr className="text-[#4B5563] text-sm font-medium">
                              {["Function (From)","Function (From) Details","Control Action","Control Action Details","Function (To)","Function (To) Details","Remove"].map((header) => (
                                <th key={header} className="px-6 py-4 border-b border-gray-200 bg-white whitespace-nowrap">{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="text-[#374151] text-sm">
                            {responseRows.map((row, idx) => (
                              <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"}>
                                {['fromFunction','fromDetails','controlAction','controlDetails','toFunction','toDetails'].map((field) => (
                                  <td key={field} className="px-6 py-4 align-top whitespace-pre-wrap border-b border-gray-100">
                                    <textarea className="w-full resize-none bg-transparent focus:outline-none text-sm" value={row[field]} onChange={(e) => handleRowChange(idx, field, e.target.value)} style={{ minHeight: '40px' }} />
                                  </td>
                                ))}
                                <td className="px-6 py-4 text-center text-red-500 font-bold cursor-pointer align-middle border-b border-gray-100">
                                  <button onClick={() => handleRemoveRow(idx)}>×</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-4 text-right">
                          <button onClick={handleAddRow} className="px-4 py-2 text-sm border rounded bg-[#ECEEFF] hover:bg-[#D7DAFF] text-[#0F0F12]">+ Add Row</button>
                        </div>
                      </div>
                    </>
                  )}
                       </div>
              )}
              </>
            )}
            {activeTab === 'Hazard Analysis' && (
  <section className="mt-2">
    {!analysisResult?.Summary ? (
      <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
        <p className="mb-2">No hazard analysis yet.</p>
        <p>
          Go to <span className="font-medium">Functional Diagramming</span> and click
          <span className="font-medium"> “Develop risk profile”</span> to generate it.
        </p>
      </div>
    ) : (
      <>
        {/* Risk Profile Diagram OR Table */}
        {showDiagram ? (
          <div className="flex-1 min-h-0 flex">
  <div className="flex-1 min-h-0 overflow-hidden" ref={riskDiagramContainerRef}>
  <LiteSummaryDiagram
  key={`hazards:${activeProjectId}`}
  projectId={activeProjectId}
  summaryData={{ Summary: [ analysisResult.Summary[0], ...applyFilters(analysisResult.Summary.slice(1)) ] }}
  selectedLabel={selectedLabel}
  setSelectedLabel={setSelectedLabel}
/>

  </div>
</div>
) : (
          <div className="overflow-auto max-h-[600px]">
            <table className="table-fixed w-full border-collapse text-sm text-left">
              <thead className="sticky top-0 bg-white z-10 shadow-sm">
                <tr>
                  {analysisResult["Summary"][0].map((header, idx) => (
                    <th key={idx} className="px-6 py-4 border-b font-semibold text-gray-700 text-left">
                      <div ref={(el) => (dropdownRefs.current[idx] = el)} className="relative">
                        <button
                          onClick={() => setFilterColumnIndex((prev) => (prev === idx ? null : idx))}
                          className="text-sm w-full text-left"
                        >
                          {header}
                        </button>
                        {filterColumnIndex === idx && (
                          <div className="absolute left-0 mt-2 w-48 bg-white border rounded shadow-md z-20">
                            <div className="p-2 border-b sticky top-0 bg-white z-10">
                              <input
                                type="text"
                                placeholder="Search..."
                                value={columnSearches[idx] || ''}
                                onChange={(e) =>
                                  setColumnSearches({ ...columnSearches, [idx]: e.target.value })
                                }
                                className="w-full px-2 py-1 text-xs border rounded"
                              />
                            </div>
                            <div className="max-h-48 overflow-y-auto p-2">
                              {getUniqueColumnValues(idx, columnSearches[idx] || '').map((val) => (
                                <label key={val} className="block text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={(columnFilters[idx] || []).includes(val)}
                                    onChange={() => toggleFilterValue(idx, val)}
                                    className="mr-2"
                                  />
                                  {val}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applyFilters(analysisResult["Summary"].slice(1)).map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-gray-50">
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} className="px-6 py-4 border-b text-gray-800 break-words">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )}
  </section>
)}

{activeTab === 'Risk Assessment' && (
  <section className="mt-2">
<div className="w-full">
    {/* ── RIGHT CONTENT: your existing toolbar + table (now using filteredRiskRows) ── */}
    <div className="flex-1 min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRiskRegister(prev => ([
            ...prev,
            {
              id: makeId(),
              title: `New Hazard ${prev.length + 1}`,
              description: '',
              likelihood: 3,
              severity: 3,
              status: 'Open',
              owner: '',
              dueDate: '',
              tags: '',
              sourceIndex: null,
            }
          ]))}
          className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6] text-sm"
        >
          + Add Risk
        </button>

        <button
          onClick={() => {
            if (!analysisResult?.Summary) return;
            const seeded = buildRiskRegisterFromSummary(analysisResult.Summary);
            const byTitle = new Map(riskRegister.map(r => [r.title, r]));
            const merged = [
              ...riskRegister,
              ...seeded.filter(s => !byTitle.has(s.title))
            ];
            setRiskRegister(merged);
          }}
          className="px-3 py-2 text-white rounded bg-[#7A37FF] hover:bg-[#5E2AD1] text-sm"
          disabled={!analysisResult?.Summary}
          title={analysisResult?.Summary ? 'Import risks from current Analysis' : 'Run Analysis first'}
        >
          Import from Analysis
        </button>

        <button
          onClick={() => {
            const headers = [hazardLabel, ucaLabel, 'Likelihood','Severity','Priority','Status','Owner','Due Date','Tags','SourceIndex'];
            const rows = riskRegister.map(r => [
              r.title,
              r.description,
              r.likelihood,
              r.severity,
              (Number(r.likelihood)||0) * (Number(r.severity)||0),
              r.status,
              r.owner,
              r.dueDate,
              r.tags,
              r.sourceIndex ?? ''
            ]);
            const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `risk_register_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
          }}
          className="px-3 py-2 text-white rounded bg-[#10B981] hover:bg-[#059669] text-sm"
          title="Export Risk Register as CSV"
        >
          Export CSV
        </button>

        {/* BULK EDIT BAR (right-aligned) */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{selectedIds.size} selected</span>

          {/* Status */}
          <select
            className="border rounded px-2 py-1 text-sm"
            value={bulk.status}
            onChange={(e) => setBulk(b => ({ ...b, status: e.target.value }))}
          >
            <option value="">Status…</option>
            {['Open','In Progress','Mitigated','Accepted','Closed'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Owner */}
          <input
            className="border rounded px-2 py-1 text-sm"
            placeholder="Owner…"
            value={bulk.owner}
            onChange={(e) => setBulk(b => ({ ...b, owner: e.target.value }))}
          />

          {/* Due Date */}
          <input
            type="date"
            className="border rounded px-2 py-1 text-sm"
            value={bulk.dueDate}
            onChange={(e) => setBulk(b => ({ ...b, dueDate: e.target.value }))}
          />

          {/* Likelihood / Severity */}
          <select
            className="border rounded px-2 py-1 text-sm"
            value={bulk.likelihood}
            onChange={(e) => setBulk(b => ({ ...b, likelihood: e.target.value }))}
          >
            <option value="">L…</option>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>

          <select
            className="border rounded px-2 py-1 text-sm"
            value={bulk.severity}
            onChange={(e) => setBulk(b => ({ ...b, severity: e.target.value }))}
          >
            <option value="">S…</option>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>

          {/* Tags (mode + value) */}
          <select
            className="border rounded px-2 py-1 text-sm"
            value={bulk.tagsMode}
            onChange={(e) => setBulk(b => ({ ...b, tagsMode: e.target.value }))}
            title="Replace: overwrite, Append: add to end, Clear: remove tags"
          >
            <option value="replace">Replace</option>
            <option value="append">Append</option>
            <option value="clear">Clear</option>
          </select>
          <input
            className="border rounded px-2 py-1 text-sm"
            placeholder="tags (comma sep)"
            value={bulk.tags}
            onChange={(e) => setBulk(b => ({ ...b, tags: e.target.value }))}
            disabled={bulk.tagsMode === 'clear'}
          />

          <button
            className="px-3 py-1.5 rounded text-white bg-[#2D7DFE] hover:bg-[#1E61D6] text-sm disabled:opacity-50"
            onClick={applyBulk}
            disabled={selectedIds.size === 0}
            title="Apply bulk changes to selected rows"
          >
            Apply to Selected
          </button>

          <button
            className="px-3 py-1.5 rounded border text-sm"
            onClick={() => setSelectedIds(new Set())}
            title="Clear selection"
          >
            Clear Selection
          </button>
        </div>
      </div>

      {/* Risk table OR empty state */}
      {riskRegister.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
          <p className="mb-2">No risks yet for this project.</p>
          {analysisResult?.Summary ? (
            <p>
              Use <span className="font-medium">Import from Analysis</span> above to pull items from your latest risk profile,
              or click <span className="font-medium">+ Add Risk</span> to create one manually.
            </p>
          ) : (
            <p>
              Click <span className="font-medium">+ Add Risk</span> to create one manually. To import automatically, run
              <span className="font-medium"> “Develop risk profile”</span> on the Analysis tab first.
            </p>
          )}
        </div>
      ) : (
<Panel title="Risk Register" subtitle={`Current project · ${hazardLabel} / ${ucaLabel}`}>
{/* make this the only scroll + clipping container */}
<div className="max-h-[550px] overflow-y-auto rounded-md shadow-sm">
            <table className="min-w-full border-collapse text-sm text-left">
            <thead>
  <tr>
    {/* Select all (on visible rows only) */}
    <th className="sticky top-0 z-20 bg-white px-2 py-1.5 border-b">
      <input
        type="checkbox"
        aria-label="Select all"
        checked={selectedIds.size === allVisibleIds.length && allVisibleIds.length > 0}
        onChange={toggleAll}
      />
    </th>

    {COLS.map((col) => (
      <th
        key={col.key}
        className="sticky top-0 z-20 bg-white px-2 py-1.5 border-b font-semibold text-xs text-left"
      >
        {col.key === 'actions' ? null : <ColumnFilterButton col={col} />}
      </th>
    ))}
  </tr>
</thead>


              <tbody className="text-[#374151] text-sm">
                {filteredRiskRows.map((r, idx) => (
                  <tr key={r.id} className={idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"}>
                    {/* Row checkbox */}
                    <td className="px-4 py-3 border-b align-top">
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                      />
                    </td>

                    <td className="px-4 py-3 border-b align-top whitespace-nowrap font-mono text-xs text-gray-600">
                      <button
                        type="button"
                        title={r.id}
                        onClick={() => navigator.clipboard?.writeText(r.id)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 active:bg-gray-100"
                      >
                        {shortId(r.id, String(idx + 1).padStart(3, "0"))}
                        <span className="text-gray-400">↘</span>
                      </button>
                    </td>

                    {/* Hazard (title) */}
                    <td className="px-4 py-3 border-b align-top min-w-[220px]">
                      <input
                        className="w-full bg-transparent focus:outline-none"
                        value={r.title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, title: v } : x));
                        }}
                      />
                    </td>

                    {/* Unsafe Control Actions (description) */}
                    <td className="px-4 py-3 border-b align-top min-w-[320px]">
                      <textarea
                        className="w-full bg-transparent focus:outline-none resize-y"
                        rows={2}
                        value={r.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, description: v } : x));
                        }}
                      />
                    </td>

                    <td className="px-4 py-3 border-b align-top">
                      <select
                        className="border rounded px-2 py-1"
                        value={r.likelihood}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, likelihood: v } : x));
                        }}
                      >
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>

                    <td className="px-4 py-3 border-b align-top">
                      <select
                        className="border rounded px-2 py-1"
                        value={r.severity}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, severity: v } : x));
                        }}
                      >
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>

                    <td className="px-4 py-3 border-b align-top">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-gray-100">
                        {(Number(r.likelihood)||0) * (Number(r.severity)||0)}
                      </span>
                    </td>

                    <td className="px-4 py-3 border-b align-top">
                      <select
                        className="border rounded px-2 py-1"
                        value={r.status}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, status: v } : x));
                        }}
                      >
                        {['Open','In Progress','Mitigated','Accepted','Closed'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>

                    <td className="px-4 py-3 border-b align-top min-w-[140px]">
                      <input
                        className="w-full bg-transparent focus:outline-none"
                        placeholder="e.g., Alex"
                        value={r.owner}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, owner: v } : x));
                        }}
                      />
                    </td>

                    <td className="px-4 py-3 border-b align-top">
                      <input
                        type="date"
                        className="border rounded px-2 py-1"
                        value={r.dueDate}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, dueDate: v } : x));
                        }}
                      />
                    </td>

                    <td className="px-4 py-3 border-b align-top min-w-[160px]">
                      <input
                        className="w-full bg-transparent focus:outline-none"
                        placeholder="comma, tags"
                        value={r.tags}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === r.id ? { ...x, tags: v } : x));
                        }}
                      />
                    </td>

                    <td className="px-4 py-3 border-b align-top text-right">
                      <button
                        className="text-red-500 hover:underline"
                        onClick={() => setRiskRegister(prev => prev.filter(x => x.id !== r.id))}
                        title="Delete risk"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  </div>
</section>

)}


{activeTab === 'Reporting' && (
  <section className="mt-2">
    {/* Gate: need a finished risk profile to generate a report */}
    {!analysisResult?.Summary ? (
      <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
        <p className="mb-2">No risk profile yet.</p>
        <p>
          Go to <span className="font-medium">Analysis</span> and click
          <span className="font-medium"> “Develop risk profile”</span> to enable reporting.
        </p>
      </div>
    ) : (
      <>
        {/* Report generation controls */}
        <div className="mb-4 flex flex-wrap items-center gap-3">


          <div className="flex items-center gap-3">
  <select
    value={reportType}
    onChange={(e) => setReportType(e.target.value)}
    className="rounded-md border px-2 py-2 text-sm"
    title="Select report type"
  >
    {REPORT_TYPE_OPTIONS.map((opt) => (
      <option key={opt} value={opt}>
        {opt}
      </option>
    ))}
  </select>

  <Gate
  feature="agentic_reports"
  fallback={
    <button
      disabled
      className="px-3 py-2 rounded bg-gray-200 text-gray-500"
      title="Activate a Pro license to enable AI report generation"
    >
      Generate AI Report (Pro)
    </button>
  }
>
  <button
    onClick={() => {
      if (reportType === "Custom Report") {
        setShowCustomPromptModal(true);
      } else {
        handleGenerateAgentReport();
      }
    }}
    disabled={isGeneratingAgentReport}
    className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6]"
    title="Generate a full AI report from the completed risk profile"
  >
    {isGeneratingAgentReport ? "Generating Report..." : "Generate AI Report"}
  </button>
</Gate>

</div>


        </div>

        {/* Exports */}
        <div className="mb-6 rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold mb-2">Exports</div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => exportReport(displayedReport, 'pdf')}
              className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6] text-sm"
              disabled={!displayedReport}
            >
              Export Report as PDF
            </button>

            <button
              onClick={() => exportReport(displayedReport, 'word')}
              className="px-3 py-2 text-white rounded bg-[#7A37FF] hover:bg-[#5E2AD1] text-sm"
              disabled={!displayedReport}
            >
              Export Report as Word (.docx)
            </button>

            <button
              onClick={() => exportReport(displayedReport, 'gdocs')}
              className="px-3 py-2 text-white rounded bg-[#F59E0B] hover:bg-[#D97706] text-sm"
              disabled={!displayedReport}
            >
              Export Report to Google Docs
            </button>
          </div>

          <div className="text-xs text-gray-500 mt-2">
            Tip: Risk Profile CSV honors any filters you set on the Hazard Analysis tab.
          </div>
        </div>

        {/* Report viewer */}
        {agentReportResult ? (
          <section className="mt-6 w-full">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-6">
            <div className="w-full overflow-x-auto overflow-y-auto max-h-[510px]
                              [&_.prose]:max-w-none
                              [&_.prose]:w-full
                              [&_.prose]:px-0
                              [&_.prose_img]:max-w-none
                              [&_.prose_img]:w-full
                              [&_.prose_table]:min-w-full">

                <SafetyReportViewer
                  reportText={displayedReport}
                  functionalDiagramImage={functionalDiagramImage}
                />
              </div>
            </div>
          </section>
        ) : (
          <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
            <p className="mb-2">No AI report yet.</p>
            <p>Use the controls above to generate your report.</p>
          </div>
        )}
      </>
    )}
  </section>
)}


          </div>
        )}
{(section === "ai-pm" || section === "ai-pm!") && (
  <Gate
    feature="ai_pm"
    loadingFallback={
      <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-0 px-3 md:px-5 lg:px-7 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Project Manager</h1>
          <p className="text-gray-500 text-sm">Loading license…</p>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm animate-pulse">
          Checking your access…
        </div>
      </div>
    }
    fallback={
      <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-0 px-3 md:px-5 lg:px-7 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Project Manager</h1>
          <p className="text-gray-500 text-sm">
            Upgrade to Pro to unlock project-wide monitoring & triage.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-6 text-gray-700 text-sm">
          This feature is available on the <span className="font-medium">Pro</span> plan.
        </div>
      </div>
    }
  >
    <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-1 px-3 md:px-5 lg:px-7 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Project Manager</h1>
        <p className="text-gray-500 text-sm">
          Monitor due dates & owners across selected projects. Triage risks quickly. No fluff.
        </p>
      </div>

      {(() => {
        // ------- helpers -------        
        const rpnOf = (r) => (Number(r?.likelihood) || 0) * (Number(r?.severity) || 0);
        const daysUntil = (dateStr) => {
          if (!dateStr) return Infinity;
          const d = new Date(dateStr);
          const now = new Date();
          if (Number.isNaN(+d)) return Infinity;
          return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
        };
        const riskHealth = (r) => {
          if (!r) return "no-date";
          if (r.status === "Closed") return "closed";
          if (!r.dueDate) return "no-date";
          const d = new Date(r.dueDate);
          const now = new Date();
          if (Number.isNaN(+d)) return "no-date";
          if (d < now) return "overdue";
          const days = daysUntil(r.dueDate);
          if (days <= 7) return "due-soon";
          return "on-track";
        };
        const safeKey = (r, i) => (r?.id ? `${r.projectId}:${r.id}` : `risk-${i}`);
        const isValidRisk = (r) => r != null && typeof r === "object" && !Array.isArray(r);

        const coerceRisk = (r) => ({
          ...r,
          likelihood: Number(r?.likelihood) || 0,
          severity: Number(r?.severity) || 0,
        });
        
        // ---- build multi-project risk view from storage (no map over unknowns) ----
        const pmProjectMap = readProjectMap() || {};
        const allRisks = (projects || []).reduce((acc, p) => {
          const raw = pmProjectMap?.[p.id]?.riskRegister;
          if (!Array.isArray(raw) || raw.length === 0) return acc;
          raw.forEach((r) => {
            if (!isValidRisk(r)) return;         // drop null/invalid
            const rr = coerceRisk(r);
            acc.push({
              ...rr,
              projectId: p.id,
              projectName: p.name,
              rpn: rpnOf(rr),
            });
          });
          return acc;
        }, []);

        // ---- project selection semantics: undefined = All, [] = None, [ids...] = specific ----
        const selectedSet = new Set(
          aiPmFilters.projectIds === undefined
            ? (projects || []).map((p) => p.id) // All
            : aiPmFilters.projectIds            // [] = None
        );

        // ------- filters + sort -------
        const inbox = allRisks
          .filter((r) => selectedSet.has(r.projectId))
          .filter((r) => aiPmFilters.statusPick.includes(r.status || "Open"))
          .filter((r) => !aiPmFilters.unassignedOnly || !String(r.owner || "").trim())
          .filter((r) => !aiPmFilters.onlyHighRPN || rpnOf(r) >= 12)
          .filter((r) => {
            if (!aiPmFilters.query) return true;
            const q = aiPmFilters.query.toLowerCase();
            const hay = `${r.title || ""} ${r.description || ""} ${r.tags || ""} ${r.owner || ""} ${r.projectName || ""}`.toLowerCase();
            return hay.includes(q);
          })
          .sort((a, b) => {
            const prio = (r) => {
              const h = riskHealth(r);
              if (h === "overdue") return 0;
              if (h === "due-soon") return 1;
              if (!String(r.owner || "").trim()) return 2;
              return 3;
            };
            const p = prio(a) - prio(b);
            if (p !== 0) return p;
            const rpnDelta = rpnOf(b) - rpnOf(a);
            if (rpnDelta !== 0) return rpnDelta;
            const da = a.dueDate ? +new Date(a.dueDate) : Infinity;
            const db = b.dueDate ? +new Date(b.dueDate) : Infinity;
            return da - db;
          });

        // Keys are "projectId:riskId" so selection works across projects reliably
        const keyOf = (r) => `${r.projectId}:${r.id}`;
        const visibleKeys = inbox.map(keyOf);
        const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => inboxSelection.has(k));
        const selectedVisibleCount = inbox.filter((r) => inboxSelection.has(keyOf(r))).length;

        const toggleAllInbox = () => {
          setInboxSelection((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) {
              visibleKeys.forEach((k) => next.delete(k));
            } else {
              visibleKeys.forEach((k) => next.add(k));
            }
            return next;
          });
        };

        const toggleOneInbox = (k) => {
          setInboxSelection((prev) => {
            const next = new Set(prev);
            next.has(k) ? next.delete(k) : next.add(k);
            return next;
          });
        };

        const applyInboxBulk = () => {
          if (selectedVisibleCount === 0) return;

          // Group selected by project for efficient persistence
          const byProject = new Map();
          inbox.forEach((r) => {
            const k = keyOf(r);
            if (!inboxSelection.has(k)) return;
            if (!byProject.has(r.projectId)) byProject.set(r.projectId, new Set());
            byProject.get(r.projectId).add(r.id);
          });

          const patchOne = (r) => {
            let next = { ...r };
            if (inboxBulk.status) next.status = inboxBulk.status;
            if (inboxBulk.owner !== "") next.owner = inboxBulk.owner;
            if (inboxBulk.dueDate !== "") next.dueDate = inboxBulk.dueDate;
            if (inboxBulk.likelihood !== "") next.likelihood = Number(inboxBulk.likelihood);
            if (inboxBulk.severity !== "") next.severity = Number(inboxBulk.severity);

            if (inboxBulk.tagsMode === "clear") {
              next.tags = "";
            } else if (inboxBulk.tags.trim()) {
              if (inboxBulk.tagsMode === "replace") {
                next.tags = inboxBulk.tags.trim();
              } else if (inboxBulk.tagsMode === "append") {
                const existing = (next.tags || "").trim();
                next.tags = existing ? `${existing}, ${inboxBulk.tags.trim()}` : inboxBulk.tags.trim();
              }
            }
            return next;
          };

          for (const [projectId, ids] of byProject.entries()) {
            updateRiskInProject(projectId, (r) => (ids.has(r.id) ? patchOne(r) : r));
          }
        };

        // ------- update handlers (multi-project aware) -------
// ✅ REPLACE your existing updateRiskInProject with this
const updateRiskInProject = (projectId, predicate) => {
  const map = readProjectMap() || {};
  const regs = (Array.isArray(map?.[projectId]?.riskRegister) ? map[projectId].riskRegister : [])
    .filter(isValidRisk);

  const nextRegs = regs.map((r) => {
    if (!isValidRisk(r)) return r;           // extra guard
    const out = predicate(r);
    // 🔒 Deletions disabled in AI-PM: if a predicate returns null, keep the original row.
    if (out === null) return r;
    return coerceRisk(out);
  })
  .filter(isValidRisk); // still safe, but we never pass null above

  saveProjectPatch(projectId, { riskRegister: nextRegs });
  if (projectId === activeProjectId && typeof setRiskRegister === "function") {
    setRiskRegister(nextRegs);
  }
};


        const applyOwnerDue = (projectId, riskId, patch) => {
          updateRiskInProject(projectId, (r) => (r.id === riskId ? { ...r, ...patch } : r));
        };
        const updateStatus = (projectId, riskId, status) => {
          updateRiskInProject(projectId, (r) => (r.id === riskId ? { ...r, status } : r));
        };

        // ------- KPIs on current scope -------
        const overdue    = inbox.filter((r) => riskHealth(r) === "overdue").length;
        const dueSoon    = inbox.filter((r) => riskHealth(r) === "due-soon").length;
        const unassigned = inbox.filter((r) => !String(r.owner || "").trim()).length;
        const onTrack    = inbox.filter((r) => riskHealth(r) === "on-track").length;

        // ------- render -------
        return (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white rounded-2xl shadow p-4">
                <div className="text-xs text-gray-500">Overdue</div>
                <div className="text-xl font-semibold">{overdue}</div>
              </div>
              <div className="bg-white rounded-2xl shadow p-4">
                <div className="text-xs text-gray-500">Due ≤ 7 days</div>
                <div className="text-xl font-semibold">{dueSoon}</div>
              </div>
              <div className="bg-white rounded-2xl shadow p-4">
                <div className="text-xs text-gray-500">Unassigned</div>
                <div className="text-xl font-semibold">{unassigned}</div>
              </div>
              <div className="bg-white rounded-2xl shadow p-4">
                <div className="text-xs text-gray-500">On Track</div>
                <div className="text-xl font-semibold">{onTrack}</div>
              </div>
            </div>

            {/* Filters toolbar */}
            <div className="rounded-2xl border bg-white p-3 mb-6">
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  className="border rounded px-2 py-1 text-sm w-full md:w-64"
                  placeholder="Search title / owner / tags…"
                  value={aiPmFilters.query}
                  onChange={(e) => setAiPmFilters((f) => ({ ...f, query: e.target.value }))}
                />
                <button
                  type="button"
                  className={`px-2 py-1 rounded text-xs border ${aiPmFilters.unassignedOnly ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-white border-gray-200 text-gray-600"}`}
                  onClick={() => setAiPmFilters((f) => ({ ...f, unassignedOnly: !f.unassignedOnly }))}
                >
                  Unassigned only
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 rounded text-xs border ${aiPmFilters.onlyHighRPN ? "bg-purple-50 border-purple-200 text-purple-700" : "bg-white border-gray-200 text-gray-600"}`}
                  onClick={() => setAiPmFilters((f) => ({ ...f, onlyHighRPN: !f.onlyHighRPN }))}
                >
                  High RPN (≥12)
                </button>

                {/* Projects quick picker */}
                <details className="ml-auto w-full md:w-auto">
                  <summary className="text-sm px-2 py-1 rounded border cursor-pointer list-none inline-flex items-center gap-2 hover:bg-gray-50">
                    Projects ({aiPmFilters.projectIds === undefined ? "All" : aiPmFilters.projectIds.length})
                  </summary>

                  <div className="mt-2 p-3 rounded-xl border bg-white shadow-sm w-[min(320px,90vw)] max-h-64 overflow-auto">
                    <div className="flex gap-2 mb-2">
                      <button
                        className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                        onClick={() => setAiPmFilters((f) => ({ ...f, projectIds: (projects || []).map((p) => p.id) }))}
                      >
                        Select all
                      </button>
                      <button
                        className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                        onClick={() => setAiPmFilters((f) => ({ ...f, projectIds: [] }))}
                      >
                        None
                      </button>
                    </div>
                    <div className="space-y-1">
                      {(projects || []).map((p) => {
                        const list = aiPmFilters.projectIds;
                        const checked = Array.isArray(list) ? list.includes(p.id) : true; // undefined => All
                        return (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setAiPmFilters((f) => {
                                  const current =
                                    f.projectIds === undefined
                                      ? new Set((projects || []).map((pp) => pp.id))
                                      : new Set(f.projectIds);
                                  if (checked) current.delete(p.id);
                                  else current.add(p.id);
                                  return { ...f, projectIds: Array.from(current) };
                                });
                              }}
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </details>
              </div>

              {/* Status chips */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-600">Status:</span>
                {["Open","In Progress","In Mitigation","Mitigated","Accepted","Closed"].map((s) => {
                  const active = aiPmFilters.statusPick.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setAiPmFilters((f) => {
                          const set = new Set(f.statusPick);
                          active ? set.delete(s) : set.add(s);
                          return { ...f, statusPick: Array.from(set) };
                        });
                      }}
                      className={`px-2 py-1 rounded text-xs border ${active ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-gray-200 text-gray-600"}`}
                    >
                      {s}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="ml-auto text-xs px-2 py-1 rounded border hover:bg-gray-50"
                  onClick={() => setAiPmFilters((f) => ({ ...f, statusPick: ["Open","In Progress"] }))}
                  title="Focus on active work"
                >
                  Active only
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                  onClick={() => setAiPmFilters((f) => ({ ...f, statusPick: ["Open","In Progress","In Mitigation","Mitigated","Accepted","Closed"] }))}
                  title="Include all statuses"
                >
                  All statuses
                </button>
              </div>
            </div>

            {/* Risk Inbox */}
            <div className="rounded-2xl border bg-white p-3 mb-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm inline-flex items-center gap-2">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllInbox} />
                  <span className="text-gray-700">{selectedVisibleCount} selected</span>
                </label>

                <select className="border rounded px-2 py-1 text-sm" value={inboxBulk.status} onChange={(e) => setInboxBulk((b) => ({ ...b, status: e.target.value }))}>
                  <option value="">Status…</option>
                  {["Open","In Progress","In Mitigation","Mitigated","Accepted","Closed"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>

                <input className="border rounded px-2 py-1 text-sm" placeholder="Owner…" value={inboxBulk.owner} onChange={(e) => setInboxBulk((b) => ({ ...b, owner: e.target.value }))} />
                <input type="date" className="border rounded px-2 py-1 text-sm" value={inboxBulk.dueDate} onChange={(e) => setInboxBulk((b) => ({ ...b, dueDate: e.target.value }))} />

                <select className="border rounded px-2 py-1 text-sm" value={inboxBulk.likelihood} onChange={(e) => setInboxBulk((b) => ({ ...b, likelihood: e.target.value }))}>
                  <option value="">L…</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <select className="border rounded px-2 py-1 text-sm" value={inboxBulk.severity} onChange={(e) => setInboxBulk((b) => ({ ...b, severity: e.target.value }))}>
                  <option value="">S…</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>

                <select className="border rounded px-2 py-1 text-sm" value={inboxBulk.tagsMode} onChange={(e) => setInboxBulk((b) => ({ ...b, tagsMode: e.target.value }))} title="Replace: overwrite, Append: add to end, Clear: remove tags">
                  <option value="replace">Replace</option>
                  <option value="append">Append</option>
                  <option value="clear">Clear</option>
                </select>
                <input className="border rounded px-2 py-1 text-sm" placeholder="tags (comma sep)" value={inboxBulk.tags} onChange={(e) => setInboxBulk((b) => ({ ...b, tags: e.target.value }))} disabled={inboxBulk.tagsMode === "clear"} />

                <div className="ml-auto flex items-center gap-2">
  <button
    className="px-3 py-1.5 rounded text-white bg-[#2D7DFE] hover:bg-[#1E61D6] text-sm disabled:opacity-50"
    onClick={applyInboxBulk}
    disabled={selectedVisibleCount === 0}
  >
    Apply to Selected
  </button>
  <button
    className="px-3 py-1.5 rounded border text-sm"
    onClick={() => setInboxSelection(new Set())}
  >
    Clear Selection
  </button>
</div>

              </div>
            </div>

            <Panel title="Risk Inbox" subtitle={`${inbox.length} shown`}>
              <div className="h-[24rem] overflow-y-auto">
                {inbox.length === 0 ? (
                  <p className="text-sm text-gray-500">Nothing to triage right now. 🎉</p>
                ) : (
                  <div className="divide-y">
                    {inbox.map((r, i) => {
                      const h = riskHealth(r);
                      const badge =
                        h === "overdue" ? "bg-red-50 text-red-700 border-red-200"
                        : h === "due-soon" ? "bg-amber-50 text-amber-700 border-amber-200"
                        : !String(r.owner || "").trim() ? "bg-rose-50 text-rose-700 border-rose-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200";

                      return (
                        <div key={safeKey(r, i)} className="py-3 flex flex-col md:flex-row md:items-start md:gap-4 gap-2">
                          {/* Selection checkbox */}
                          <div className="pt-1">
                            <input type="checkbox" checked={inboxSelection.has(keyOf(r))} onChange={() => toggleOneInbox(keyOf(r))} aria-label="Select risk" />
                          </div>

                          {/* Left meta */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${badge}`}>
                                {h === "overdue" ? "Overdue" : h === "due-soon" ? "Due ≤7d" : !String(r.owner || "").trim() ? "Unassigned" : "On-track"}
                              </span>
                              <span className="text-[11px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-700 border-gray-200">RPN {rpnOf(r)}</span>
                              <span className="text-[11px] px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200">{r.projectName}</span>
                              {r.tags ? <span className="text-[11px] text-gray-500 truncate">#{String(r.tags)}</span> : null}
                            </div>
                            <div className="font-medium mt-1">{r.title || "—"}</div>
                            {r.description ? <div className="text-xs text-gray-600 line-clamp-2">{r.description}</div> : null}
                          </div>

                          {/* Inline edits */}
                          <div className="w-full md:w-[460px] flex flex-wrap items-center gap-2 md:justify-end">
                            <input className="border rounded px-2 py-1 text-sm w-[160px]" placeholder="Owner" value={r.owner || ""} onChange={(e) => applyOwnerDue(r.projectId, r.id, { owner: e.target.value })} title="Assign owner" />
                            <input type="date" className="border rounded px-2 py-1 text-sm" value={r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : ""} onChange={(e) => applyOwnerDue(r.projectId, r.id, { dueDate: e.target.value })} title="Set due date" />
                            <select className="border rounded px-2 py-1 text-sm" value={r.status || "Open"} onChange={(e) => updateStatus(r.projectId, r.id, e.target.value)} title="Update status">
                              {["Open","In Progress","In Mitigation","Mitigated","Accepted","Closed"].map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button type="button" className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={async () => {
                              try {
                                await navigator.clipboard?.writeText?.(
                                  `[${r.projectName}] ${r.title} — owner: ${r.owner || "(unassigned)"} — due: ${r.dueDate || "—"} — status: ${r.status || "Open"}`
                                );
                              } catch {
                                alert("Copy failed. Are you on HTTPS / localhost?");
                              }
                            }}>
                              Copy
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Panel>
          </>
        );
      })()}
    </div>
  </Gate>
)}



{section === "risk" && (
  <Gate
    feature="risk_register"
    loadingFallback={
      <div className="flex flex-col min-h-screen bg-white py-2 px-3 md:px-5 lg:px-7 w-full overflow-hidden">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mt-0 text-2xl font-semibold">Risk Register</h1>
            <p className="text-gray-500 text-sm">Loading license…</p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm animate-pulse">
          Checking your access…
        </div>
      </div>
    }
    fallback={
      <div className="flex flex-col min-h-screen bg-white py-2 px-3 md:px-5 lg:px-7 w-full overflow-hidden">
        <div className="mb-6">
          <h1 className="mt-0 text-2xl font-semibold">Risk Register</h1>
          <p className="text-gray-500 text-sm">
            Upgrade to Pro to unlock aggregated risk management across all projects.
          </p>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-700 text-sm">
          This feature is available on the <span className="font-medium">Pro</span> plan.
        </div>
      </div>
    }
  >
    {(() => {
      // ---- null-safety & helpers (match AI-PM) ----
      const isValidRisk = (r) => r && typeof r === "object" && !Array.isArray(r);
      const coerceRisk = (r) => ({
        ...r,
        likelihood: Number(r?.likelihood) || 0,
        severity: Number(r?.severity) || 0,
      });
      const rpnOf = (r) => (Number(r?.likelihood) || 0) * (Number(r?.severity) || 0);

      // ---- read all risks (from persisted project map) safely ----
      const pmProjectMap = readProjectMap() || {};
      const allRisks = (projects || []).reduce((acc, p) => {
        const regs = pmProjectMap?.[p.id]?.riskRegister;
        if (!Array.isArray(regs)) return acc;
        regs.forEach((raw) => {
          if (!isValidRisk(raw)) return;           // drop null/invalid rows
          const r = coerceRisk(raw);
          acc.push({
            ...r,
            projectId: p.id,
            projectName: p.name,
            rpn: rpnOf(r),
          });
        });
        return acc;
      }, []);

      // ---- tri-state semantics for project selection ----
      // projectIds === null -> All, [] -> None, [..] -> explicit
      const projectIds = riskHubFilters.projectIds ?? null;

      const inSelectedProjects = (r) => {
        if (projectIds === null) return true; // All
        if (Array.isArray(projectIds) && projectIds.length === 0) return false; // None
        return projectIds.includes(r.projectId); // Explicit
      };

      const matchesStatuses = (r) =>
        (riskHubFilters.statuses?.length
          ? riskHubFilters.statuses.includes(r.status || "Open")
          : true);

      const matchesQuery = (r) => {
        const q = riskHubFilters.query?.trim()?.toLowerCase();
        if (!q) return true;
        const hay = `${r.title||""} ${r.description||""} ${r.tags||""} ${r.owner||""} ${r.projectName||""}`.toLowerCase();
        return hay.includes(q);
      };

      const matchesOwner = (r) =>
        !riskHubFilters.owner?.trim()
          ? true
          : String(r.owner || "").toLowerCase().includes(riskHubFilters.owner.toLowerCase());

      const matchesTags = (r) =>
        !riskHubFilters.tags?.trim()
          ? true
          : String(r.tags || "").toLowerCase().includes(riskHubFilters.tags.toLowerCase());

      const matchesRpnMin = (r) =>
        riskHubFilters.minRPN ? (r.rpn >= Number(riskHubFilters.minRPN)) : true;

      const matchesRpnMax = (r) =>
        riskHubFilters.maxRPN ? (r.rpn <= Number(riskHubFilters.maxRPN)) : true;

      // ---- filtered list (drives everything below) ----
      const filteredRisks = allRisks
        .filter(inSelectedProjects)
        .filter(matchesStatuses)
        .filter(matchesQuery)
        .filter(matchesOwner)
        .filter(matchesTags)
        .filter(matchesRpnMin)
        .filter(matchesRpnMax);

      // ---- charts: stack by status per project ----
      const statusKeysAll = ["Open", "In Progress", "In Mitigation", "Mitigated", "Accepted", "Closed"];
      const statusByProjectMap = new Map();
      filteredRisks.forEach((r) => {
        if (!statusByProjectMap.has(r.projectId)) {
          statusByProjectMap.set(r.projectId, {
            projectId: r.projectId,
            project: r.projectName,
            ...Object.fromEntries(statusKeysAll.map((s) => [s, 0])),
          });
        }
        const row = statusByProjectMap.get(r.projectId);
        const key = statusKeysAll.includes(r.status) ? r.status : "Open";
        row[key] = (row[key] || 0) + 1;
      });
      const statusByProject = Array.from(statusByProjectMap.values());
      const statusKeys = statusKeysAll;

      // ---- export uses CURRENT filters ----
      const exportAllRisksCSV = () => {
        const rows = [
          ["Project","ID","Title","Description","Likelihood","Severity","RPN","Status","Owner","Due Date","Tags"],
          ...filteredRisks.map((r) => [
            r.projectName, r.id, r.title || "", r.description || "",
            r.likelihood ?? "", r.severity ?? "", r.rpn,
            r.status || "Open", r.owner || "", r.dueDate || "", r.tags || ""
          ])
        ];
        const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `risk_register_${Date.now()}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      // helper for dropdown label
      const projectCountLabel =
        projectIds === null ? "All" :
        (projectIds.length === 0 ? "None" : projectIds.length);

      return (
        <div className="flex flex-col min-h-screen bg-white py-1 px-3 md:px-5 lg:px-7 w-full overflow-hidden">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="mt-0 text-2xl font-semibold">Risk Register</h1>
              <p className="text-gray-500 text-sm">Aggregated across selected projects</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setRiskHubFilters({
                    query: "",
                    projectIds: null,   // reset to All
                    statuses: [],
                    owner: "",
                    tags: "",
                    minRPN: "",
                    maxRPN: "",
                  })
                }
                className="px-3 py-2 rounded border text-sm hover:bg-gray-50"
                title="Reset all filters"
              >
                Clear Filters
              </button>
              <button
                onClick={exportAllRisksCSV}
                className="px-3 py-2 text-white rounded bg-[#10B981] hover:bg-[#059669] text-sm"
                title="Export currently filtered risks"
              >
                Export CSV
              </button>
            </div>
          </div>

          {/* Compact toolbar (filters) */}
          <div className="rounded-2xl border bg-white p-3 mb-6">
            <div className="flex flex-wrap gap-2 items-center">
              <input
                className="border rounded px-2 py-1 text-sm w-full md:w-64"
                placeholder="Search title / description…"
                value={riskHubFilters.query}
                onChange={(e) => setRiskHubFilters((f) => ({ ...f, query: e.target.value }))}
              />
              <input
                className="border rounded px-2 py-1 text-sm w-[160px]"
                placeholder="Owner contains…"
                value={riskHubFilters.owner}
                onChange={(e) => setRiskHubFilters((f) => ({ ...f, owner: e.target.value }))}
              />
              <input
                className="border rounded px-2 py-1 text-sm w-[160px]"
                placeholder="Tags contains…"
                value={riskHubFilters.tags}
                onChange={(e) => setRiskHubFilters((f) => ({ ...f, tags: e.target.value }))}
              />
              <div className="flex items-center gap-2">
                <input
                  className="border rounded px-2 py-1 text-sm w-24"
                  placeholder="Min RPN"
                  value={riskHubFilters.minRPN}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "");
                    setRiskHubFilters((f) => ({ ...f, minRPN: v }));
                  }}
                />
                <span className="text-xs text-gray-500">–</span>
                <input
                  className="border rounded px-2 py-1 text-sm w-24"
                  placeholder="Max RPN"
                  value={riskHubFilters.maxRPN}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "");
                    setRiskHubFilters((f) => ({ ...f, maxRPN: v }));
                  }}
                />
              </div>

              {/* Projects quick picker (tri-state: All / None / Explicit) */}
              <details className="ml-auto w-full md:w-auto">
                <summary className="text-sm px-2 py-1 rounded border cursor-pointer list-none inline-flex items-center gap-2 hover:bg-gray-50">
                  Projects ({projectCountLabel})
                </summary>
                <div className="mt-2 p-3 rounded-xl border bg-white shadow-sm w-[min(320px,90vw)] max-h-64 overflow-auto">
                  <div className="flex gap-2 mb-2">
                    <button
                      className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                      onClick={() => setRiskHubFilters((f) => ({ ...f, projectIds: (projects || []).map(p => p.id) }))}
                    >
                      Select all
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                      onClick={() => setRiskHubFilters((f) => ({ ...f, projectIds: [] }))}
                    >
                      None
                    </button>
                  </div>
                  <div className="space-y-1">
                    {(projects || []).map((p) => {
                      const checked =
                        projectIds === null
                          ? true              // All -> visually checked
                          : projectIds.includes(p.id); // None or explicit
                      return (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setRiskHubFilters((f) => {
                                const current = f.projectIds == null ? [] : (f.projectIds || []);
                                const set = new Set(current);
                                if (set.has(p.id)) set.delete(p.id); else set.add(p.id);
                                return { ...f, projectIds: Array.from(set) };
                              });
                            }}
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </details>
            </div>

            {/* Status chips row */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-600">Status:</span>
              {["Open", "In Progress", "In Mitigation", "Mitigated", "Accepted", "Closed"].map((s) => {
                const active = riskHubFilters.statuses.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setRiskHubFilters((f) => {
                        const set = new Set(f.statuses);
                        active ? set.delete(s) : set.add(s);
                        return { ...f, statuses: Array.from(set) };
                      })
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                        : "bg-white border-gray-200 text-gray-600"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
              {/* quick toggles */}
              <button
                type="button"
                className="ml-auto text-xs px-2 py-1 rounded border hover:bg-gray-50"
                onClick={() => setRiskHubFilters((f) => ({ ...f, statuses: ["Open", "In Progress"] }))}
                title="Focus on active work"
              >
                Active only
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                onClick={() => setRiskHubFilters((f) => ({ ...f, statuses: [] }))}
                title="Include all statuses"
              >
                All statuses
              </button>
            </div>
          </div>

          {/* Quick analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Panel title="Risks by project & status" subtitle="Stacked counts">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusByProject}>
                    <XAxis dataKey="project" />
                    <YAxis allowDecimals={false} />
                    <Legend />
                    <Tooltip />
                    {statusKeys.map((k, i) => (
                      <Bar
                        key={k}
                        dataKey={k}
                        stackId="s"
                        fill={["#6366F1", "#F59E0B", "#10B981", "#A78BFA", "#EF4444"][i % 5]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Top risks (by RPN)" subtitle="Click a project to jump">
              <div className="max-h-64 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-gray-600">
                      <th className="px-3 py-2 text-left">Project</th>
                      <th className="px-3 py-2 text-left">Title</th>
                      <th className="px-3 py-2 text-left">RPN</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRisks
                      .slice()
                      .sort((a,b) => (b.rpn||0) - (a.rpn||0))
                      .slice(0, 8)
                      .map((r) => (
                        <tr key={`${r.projectId}:${r.id}`} className="border-t">
                          <td className="px-3 py-2">
                            <button
                              className="text-indigo-600 hover:underline"
                              onClick={() => { setActiveProjectId(r.projectId); setSection("projects"); }}
                            >
                              {r.projectName}
                            </button>
                          </td>
                          <td className="px-3 py-2">{r.title}</td>
                          <td className="px-3 py-2">{r.rpn}</td>
                          <td className="px-3 py-2">{r.status || "Open"}</td>
                        </tr>
                      ))}
                    {filteredRisks.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-gray-500">
                          No risks match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          {/* Master table */}
          <Panel title="All risks (table)" subtitle="Aggregated & filterable">
          <div className="max-h-52 overflow-auto pb-3">
          <table className="min-w-full border-collapse text-sm">
                <thead className="bg-white sticky top-0 z-10 shadow-sm">
                  <tr className="text-gray-600">
                    {[
                      "ID","Project","Title","Description","Likelihood","Severity","RPN",
                      "Status","Owner","Due Date","Tags",
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 text-left border-b">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRisks.map((r) => (
                    <tr key={`${r.projectId}:${r.id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 border-b whitespace-nowrap font-mono text-xs text-gray-600">{r.id}</td>
                      <td className="px-4 py-3 border-b">
                        <button
                          className="text-indigo-600 hover:underline"
                          onClick={() => { setActiveProjectId(r.projectId); setSection("projects"); }}
                        >
                          {r.projectName}
                        </button>
                      </td>
                      <td className="px-4 py-3 border-b">{r.title}</td>
                      <td className="px-4 py-3 border-b">{r.description}</td>
                      <td className="px-4 py-3 border-b">{r.likelihood}</td>
                      <td className="px-4 py-3 border-b">{r.severity}</td>
                      <td className="px-4 py-3 border-b">{r.rpn}</td>
                      <td className="px-4 py-3 border-b">{r.status || "Open"}</td>
                      <td className="px-4 py-3 border-b">{r.owner}</td>
                      <td className="px-4 py-3 border-b">{r.dueDate}</td>
                      <td className="px-4 py-3 border-b">{r.tags}</td>
                    </tr>
                  ))}
                  {filteredRisks.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-gray-500">
                        No risks to display.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      );
    })()}
  </Gate>
)}






{section === "requirements" && (
  <Gate
    feature="requirements_manager"
    loadingFallback={
      <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-0 px-3 md:px-5 lg:px-7 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Requirements Management</h1>
          <p className="text-gray-500 text-sm">Loading license…</p>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm animate-pulse">
          Checking your access…
        </div>
      </div>
    }
    fallback={
      <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-1 px-3 md:px-5 lg:px-7 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Requirements Management</h1>
          <p className="text-gray-500 text-sm">
            Upgrade to Pro to unlock object-oriented modules, custom attributes, and bi-directional links.
          </p>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-700 text-sm">
          This feature is available on the <span className="font-medium">Pro</span> plan.
        </div>
      </div>
    }
  >
    <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-0 px-3 md:px-5 lg:px-7 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Requirements Management</h1>
        <p className="text-gray-500 text-sm">
          Object-oriented modules, custom attributes, and bi-directional links.
        </p>
      </div>

      {!activeProjectId ? (
        <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
          Select a project in the sidebar to manage requirements.
        </div>
      ) : (
<RequirementsManager
  key={activeProjectId}
  projectName={projects.find((p) => p.id === activeProjectId)?.name || "Current Project"}
  requirements={requirements}
  setRequirements={setRequirements}
/>

      )}
    </div>
  </Gate>
)}

{section === 'vnv' && (
  <div className="flex-1 min-h-0 overflow-auto bg-white py-1 px-3 md:px-5 lg:px-7 w-full">
    {!activeProjectId ? (
      <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
        Select a project to use V&V.
      </div>
    ) : (
<VnVCenterPro
  activeProject={activeProject}
  activeProjectId={activeProjectId}
  analysisResult={analysisResult}
  riskRegister={riskRegister}
  requirements={requirements}
  vnvArtifacts={vnvArtifacts}
  setVnvArtifacts={setVnvArtifacts}
  saveProjectPatch={saveProjectPatch}
  projects={projects}
/>
    )}
  </div>
)}



{/* Settings Modal */}
{showSettingsModal && (
  <SettingsModal
  connected={repoConnected}
  onClose={() => setShowSettingsModal(false)}
  onSynced={() => {
    setRepoConnected(true);      // ✅ switch to "Baseline Repo"
  }}
  onBaselineRepo={handleBaselineRepo} // ✅ runs the same analyzer as "Analyze"
 />
)}

{/* Custom Report Wizard Modal */}
{showCustomPromptModal && (
  <div className="fixed inset-0 z-[999]">
    <div
      className="absolute inset-0 bg-black/40"
      onClick={() => setShowCustomPromptModal(false)}
      aria-hidden
    />
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Custom Report Wizard</h3>
            <p className="text-xs text-gray-500">Step {wizardStep} of 5</p>
          </div>
          <button
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
            onClick={() => setShowCustomPromptModal(false)}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto text-sm space-y-5">
          {/* Step 1: Basics */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Report Title</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Safety Analysis Executive Readout"
                  value={wizard.title}
                  onChange={(e) => setWizard(w => ({ ...w, title: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Audience</label>
                  <input
                    className="w-full border rounded px-3 py-2"
                    value={wizard.audience}
                    onChange={(e) => setWizard(w => ({ ...w, audience: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Tone</label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={wizard.tone}
                    onChange={(e) => setWizard(w => ({ ...w, tone: e.target.value }))}
                  >
                    {["professional and concise", "stakeholder-friendly", "technical and detailed", "brief and executive"].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Length</label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={wizard.length}
                    onChange={(e) => setWizard(w => ({ ...w, length: e.target.value }))}
                  >
                    {["short","medium","long"].map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Goals / Emphasis</label>
                <textarea
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="e.g., Highlight top risks; include mitigations and owners; focus on schedule impacts"
                  value={wizard.goals}
                  onChange={(e) => setWizard(w => ({ ...w, goals: e.target.value }))}
                />
              </div>
            </div>
          )}

{/* Step 2: Sources */}
{wizardStep === 2 && (
  <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={wizard.includeFindings}
          onChange={(e) => setWizard(w => ({ ...w, includeFindings: e.target.checked }))}
        />
        Use findings (chunked summaries)
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={wizard.includeArchitecture}
          onChange={(e) => setWizard(w => ({ ...w, includeArchitecture: e.target.checked }))}
        />
        Include architecture narrative
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={wizard.includeSummaryJson}
          onChange={(e) => setWizard(w => ({ ...w, includeSummaryJson: e.target.checked }))}
        />
        Include sample summary JSON
      </label>
    </div>

    <div className="flex flex-wrap items-end gap-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={wizard.includeAllRisks}
          onChange={(e) => setWizard(w => ({ ...w, includeAllRisks: e.target.checked }))}
        />
        Include <span className="font-medium">all risks</span>
      </label>

      <div className="max-w-xs">
        <label className="block text-xs font-medium mb-1">
          Top Risks Count {wizard.includeAllRisks && <span className="text-gray-400">(disabled)</span>}
        </label>
        <input
          type="number"
          min={1}
          className="w-full border rounded px-3 py-2 disabled:opacity-50"
          value={wizard.topRisksCount}
          disabled={wizard.includeAllRisks}
          onChange={(e) =>
            setWizard(w => ({ ...w, topRisksCount: Math.max(1, Number(e.target.value) || 1) }))
          }
        />
      </div>
    </div>

    {wizard.includeAllRisks && (
      <div className="text-xs text-gray-500">
        Note: Including every risk can create a long report; results will be grouped or condensed for readability.
      </div>
    )}
  </div>
)}

          {/* Step 3: Sections */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <label className="block text-xs font-medium">Sections (one per line; order matters)</label>
              <textarea
                className="w-full border rounded px-3 py-2"
                rows={6}
                value={wizard.sections.join("\n")}
                onChange={(e) =>
                  setWizard(w => ({ ...w, sections: e.target.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }))
                }
              />
              <div className="text-xs text-gray-500">
                Tip: Add sections like “Timeline & Dependencies”, “Traceability Matrix”, or “Appendix”.
              </div>
            </div>
          )}

          {/* Step 4: Tables & Extras */}
          {wizardStep === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Tables to include (one per line)</label>
                <textarea
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="e.g., Top Risks Table\nMitigation Owners\nTraceability Matrix"
                  value={wizard.tables.join("\n")}
                  onChange={(e) =>
                    setWizard(w => ({ ...w, tables: e.target.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Formatting / Extras (one per line)</label>
                <textarea
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="Insert blank line before lists\nNo code fences around output"
                  value={wizard.extras.join("\n")}
                  onChange={(e) =>
                    setWizard(w => ({ ...w, extras: e.target.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }))
                  }
                />
              </div>
            </div>
          )}

          {/* Step 5: Review */}
          {wizardStep === 5 && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500">Preview of the prompt that will be sent to the AI:</div>
              <textarea
                className="w-full border rounded px-3 py-2 font-mono text-xs"
                rows={12}
                readOnly
                value={composeCustomPromptFromWizard(wizard)}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-5 py-4">
          <div className="text-xs text-gray-500">
            {wizardStep > 1 && (
              <button
                className="px-3 py-2 rounded border mr-2"
                onClick={() => setWizardStep(s => Math.max(1, s - 1))}
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded border"
              onClick={() => setShowCustomPromptModal(false)}
            >
              Cancel
            </button>
            {wizardStep < 5 ? (
              <button
                className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6]"
                onClick={() => setWizardStep(s => Math.min(5, s + 1))}
              >
                Next
              </button>
            ) : (
<button
  className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6]"
  onClick={() => {
    const prompt = composeCustomPromptFromWizard(wizard);
    if (!prompt.trim()) return;
    setCustomReportPrompt(prompt);       // optional: keep for persistence
    setShowCustomPromptModal(false);
    if (reportType !== "Custom Report") setReportType("Custom Report");
    handleGenerateAgentReport(prompt);   // ⬅️ pass it directly
  }}
>
  Generate
</button>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
)}

        {/* New Project Modal */}
        {showNewProject && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => {
                setShowNewProject(false);
                setNewProjectName('');
                setNewProjectError('');
              }}
            />
            {/* Dialog */}
            <div className="relative z-[101] w-full max-w-md rounded-2xl border-2 border-[#2D7DFE] bg-white shadow-xl">
              <div className="px-5 py-4 border-b">
                <h2 className="text-base font-semibold text-slate-800">Create new project</h2>
                <p className="text-xs text-slate-500 mt-0.5">Give your project a short, memorable name.</p>
              </div>

              <div className="px-5 py-4">
                <label className="block text-sm font-medium mb-1">Project name</label>
                <input
                  autoFocus
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    if (newProjectError) setNewProjectError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createProject();
                    if (e.key === 'Escape') {
                      setShowNewProject(false);
                      setNewProjectName('');
                      setNewProjectError('');
                    }
                  }}
                  placeholder="e.g., Autonomous Cart v1"
                />
                {newProjectError && (
                  <div className="text-xs text-red-600 mt-1">{newProjectError}</div>
                )}
                {!newProjectError && (
  <div className="text-[11px] text-gray-500 mt-1">
    {projects.length}/{projectLimit} projects used on your plan.
  </div>
)}
              </div>

              <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowNewProject(false);
                    setNewProjectName('');
                    setNewProjectError('');
                  }}
                  className="px-3 py-2 rounded border text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
  onClick={createProject}
  disabled={atProjectLimit}
  title={atProjectLimit ? `Limit reached (${projectLimit}). Upgrade to add more.` : undefined}
  className={`px-3 py-2 rounded text-sm ${
    atProjectLimit
      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
      : 'bg-[#2D7DFE] text-white hover:bg-[#1E61D6]'
  }`}
>
  {atProjectLimit ? 'Limit reached' : 'Create'}
</button>

              </div>
            </div>
          </div>
        )}
        {/* License activation modal */}
{licenseModalOpen && (
  <ActivateLicenseModal onClose={() => setLicenseModalOpen(false)} />
)}
      </main>
    </div>          {/* closes .flex */}
  </div>            {/* closes .pt-14 */}
  </>
  );
}


/**
 * Panel renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param title Input consumed by this step of the xHandle workflow.
 * @param subtitle Input consumed by this step of the xHandle workflow.
 * @param children Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Panel({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="px-5 pt-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * Badge renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param children Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Badge({ children }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded bg-gray-100 border border-gray-200">
      {children}
    </span>
  );
}

/**
 * EmptyState renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function EmptyState({ text }) {
  return <div className="text-sm text-gray-500">{text}</div>;
}

/**
 * App renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function App() {
  return (
    <ActivityProvider>
      <LiteXHandle />
    </ActivityProvider>
  );
}

export default App;
