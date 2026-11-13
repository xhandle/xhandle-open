import StructuredAttributeInput from '../features/requirements/components/StructuredAttributeInput';
import { DESIGN_SEARCH_REVEAL } from '../features/design-management/designQuickSearch';
import DesignLibraryTree from '../features/requirements/components/DesignLibraryTree';
import DesignFolderContents from '../features/requirements/components/DesignFolderContents';
import DesignEditorMenu from '../features/requirements/components/DesignEditorMenu';
import { designLibraryModel } from '../features/requirements/components/designLibraryModel';
import { buildIndex, computeNumbering, OutlinePanel, TablePanel, TraceabilityView, Field, Modal, RowActionsBar } from "../features/requirements/components/RequirementsViews";
import { validateModuleRows } from '../features/requirements/actions/normalizeModuleRows';
// RequirementsManager.jsx — Folders • Modules • Requirements
// xHandle Lite: outline + table views, hierarchy, versioning, traceability, import/export
// New in this version:
// - Hierarchical Folders (nested) replace project dropdown
// - Folder sidebar with expand/collapse + New Folder + Manage Modules
// - Module Manager (create/edit module types, attribute templates, view templates)
// - Outline per module (hierarchical numbering); reorder/promote/demote
// - Table view + saved views + module view presets
// - Namespaced baselines (per folder + module)
// - Cross-module linking & Reuse/Derivation across folders
// - Access control hooks (canEdit/currentRole/moduleAccess)

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Plus, Trash2, Link2, X, Search, PlusCircle, ChevronRight, ChevronLeft } from "lucide-react";

import HazardAttributeMapper from "./HazardAttributeMapper";
// ADD
import LLMModuleLinkerModal from "./LLMModuleLinkerModal";
import {
  listRequirementsByFolder,
  updateRequirement
} from "./utils/requirementsStore";
import {
  getActiveFolderId as getSharedActiveFolderId,
  loadFolders as loadSharedFolders,
  loadRequirements as loadSharedRequirements,
  migrateRequirementsState,
} from "../features/requirements/actions";
import { registerActionProvider } from "../features/app/actionRegistry";

import "reactflow/dist/style.css";




// ----------------------------- Types & Constants -----------------------------
const LINK_TYPES = ["derives", "verifies", "refines", "satisfies", "blocks"];
// Inverse types for child backlinks shown in the child module
const LINK_INVERSE = {
  refines: "refined-by",
  satisfies: "satisfied-by",
  verifies: "verified-by",
  derives: "derived-from",
  blocks: "blocked-by",
};

const BASE_MODULES = ["System", "Subsystem", "Interface", "Requirement", "Test"];
const STATUSES = ["Proposed", "Approved", "Rejected"];
const VIEW_MODES = { OUTLINE: "outline", TABLE: "table", TRACE: "TRACE" };

const LS_SIDEBAR_OPEN = "xhandle:sidebar-open";
const ATTR_TYPES = ["text", "number", "select", "multiselect", "date", "boolean"];
// Drag & Drop MIME types
const DND_MIME_FOLDER = "application/x-xhandle-folder";   // you already have this

// ───────────────── Module Attribute Schema (per moduleId) ─────────────────
const LS_MODULE_SCHEMAS = "xhandle:module-schemas";

function loadAllModuleSchemas() {
  try { return JSON.parse(localStorage.getItem(LS_MODULE_SCHEMAS) || "[]"); }
  catch { return []; }
}
function saveAllModuleSchemas(all) {
  localStorage.setItem(LS_MODULE_SCHEMAS, JSON.stringify(all));
}

/** Merge/overwrite attribute defs for a moduleId on key */
async function upsertModuleAttributeDefinitions(moduleId, defs) {
  const all = loadAllModuleSchemas();
  const idx = all.findIndex(s => s.moduleId === moduleId);
  if (idx === -1) {
    all.push({ moduleId, attributes: dedupeByKey(defs) });
  } else {
    const map = new Map();
    for (const a of (all[idx].attributes || [])) map.set(a.key, a);
    for (const d of defs) map.set(d.key, { ...(map.get(d.key) || {}), ...d });
    all[idx].attributes = Array.from(map.values());
  }
  saveAllModuleSchemas(all);
}
function dedupeByKey(list) {
  const m = new Map();
  for (const d of (list || [])) m.set(d.key, d);
  return Array.from(m.values());
}

function normalizeAttrTemplate(raw) {
  // Accept legacy: ["Priority", "Owner"] and new typed: [{ key, type, options }]
  return (raw || []).map((item) =>
    typeof item === "string"
      ? { key: item, type: "text", options: [] }
      : {
          key: String(item?.key || ""),
          type: ATTR_TYPES.includes(item?.type) ? item.type : "text",
          options: Array.isArray(item?.options) ? item.options.map(String) : [],
        }
  );
}

function defaultForType(t) {
  switch (t) {
    case "number": return null;
    case "select": return "";
    case "multiselect": return [];
    case "date": return "";
    case "boolean": return false;
    default: return ""; // text
  }
}

function coerceToType(val, type) {
  if (val == null) return null;
  const s = String(val).trim();
  switch (type) {
    case "number":
      return s === "" || isNaN(Number(s)) ? null : Number(s);
    case "boolean":
      if (typeof val === "boolean") return val;
      return ["true", "yes", "1", "y"].includes(s.toLowerCase());
    case "date": {
      const d = new Date(s);
      return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
    }
    default:
      return s;
  }
}

// ----------------------------- ID + Helpers ---------------------------------
function makeId(prefix = "REQ") {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}
const nowISO = () => new Date().toISOString();
const deepClone = (o) => JSON.parse(JSON.stringify(o));

function escapeCSV(s) {
  const str = String(s ?? "");
  if (/[\",]/.test(str)) return '"' + str.replaceAll('"', '""') + '"';
  return str;
}
function splitCSVLine(line){
  const out=[]; let cur=""; let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){ if(inQ && line[i+1]==='"'){cur+='"'; i++;} else inQ=!inQ; }
    else if(ch==="," && !inQ){ out.push(cur); cur=""; }
    else cur+=ch;
  }
  out.push(cur);
  return out;
}

// ===== Pull Summary from Hazard Analysis (LiteXHandle) =====
const LITE_ACTIVE_PROJECT_ID_KEY = "xhandle.activeProjectId";
const LITE_PROJECT_DATA_KEY = "xhandle.projectData";

// Parse pasted/loaded CSV to 2D
function parseCSV2D(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];
  const rows = [splitCSVLine(lines[0])];
  for (let i = 1; i < lines.length; i++) rows.push(splitCSVLine(lines[i]));
  return rows;
}
function normalizeCategory(val){
  const v = String(val || "").trim().toLowerCase();
  if (!v) return "";
  if (/^loss(es)?$/.test(v)) return "Loss";
  if (/^hazard(s)?$/.test(v)) return "Hazard";
  if (/^mitigation(s)?$/.test(v)) return "Mitigation";
  if (/^(safety )?requirement(s)?$/.test(v)) return "Requirement";
  if (/^constraint(s)?$/.test(v)) return "Constraint";
  if (/^uca(s)?$/.test(v)) return "UCA";
  if (/^control(s)?$/.test(v)) return "Control";
  return v[0].toUpperCase() + v.slice(1);
}

/**
 * Read the active Lite project’s Summary 2D array from localStorage.
 * Returns [] if not available.
 */
function getActiveHazardSummary2D(){
  try {
    const pid = localStorage.getItem(LITE_ACTIVE_PROJECT_ID_KEY);
    if (!pid) return [];
    const map = JSON.parse(localStorage.getItem(LITE_PROJECT_DATA_KEY) || "{}");
    const pack = map?.[pid];
    const summary = pack?.analysisResult?.Summary;
    return (Array.isArray(summary) && Array.isArray(summary[0])) ? summary : [];
  } catch { return []; }
}

/** List all Lite projects available in localStorage for Hazard Analysis */
function safeParseJSON(s) {
    try { return JSON.parse(s); } catch { return undefined; }
  }

  function probeProjectNameById(id) {
    const KNOWN_KEYS = [
      "xhandle.projects",
      "xhandle.projectList",
      "xhandleLite.projects",
      "LiteProjects",
      "hazard.projects",
      "hazardProjectList",
      "projects",
    ];

    // 1) Check known keys explicitly
    for (const key of KNOWN_KEYS) {
      const v = safeParseJSON(localStorage.getItem(key));
      if (!v) continue;

      // Array of {id,name|title}
      if (Array.isArray(v)) {
        const hit = v.find(p =>
          (p?.id === id) ||
          (p?.projectId === id) ||
          (typeof p === "object" && (p?.key === id || p?.uuid === id))
        );
        if (hit) return hit.name || hit.title;
      }

      // Object map { [id]: {name|title: ...} } or { [id]: "Name" }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const maybe = v[id];
        if (typeof maybe === "string") return maybe;
        if (maybe && typeof maybe === "object") return maybe.name || maybe.title;
      }
    }

    // 2) Fallback: scan all localStorage for common shapes
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = safeParseJSON(localStorage.getItem(key));
      if (!val) continue;

      // Array of project-ish objects
      if (Array.isArray(val)) {
        const hit = val.find(p =>
          p &&
          typeof p === "object" &&
          (p.id === id || p.projectId === id || p.key === id || p.uuid === id) &&
          (p.name || p.title)
        );
        if (hit) return hit.name || hit.title;
      }

      // Object map
      if (val && typeof val === "object") {
        const maybe = val[id];
        if (typeof maybe === "string") return maybe;
        if (maybe && typeof maybe === "object" && (maybe.name || maybe.title)) {
          return maybe.name || maybe.title;
        }
      }

      // Wrapped under { projects: [...] }
      if (val && typeof val === "object" && Array.isArray(val.projects)) {
        const hit = val.projects.find(p =>
          p &&
          (p.id === id || p.projectId === id || p.key === id || p.uuid === id) &&
          (p.name || p.title)
        );
        if (hit) return hit.name || hit.title;
      }
    }

    return undefined;
  }

  /** List all Lite projects available in localStorage for Hazard Analysis */
  function listLiteProjects() {
    try {
      const map = JSON.parse(localStorage.getItem(LITE_PROJECT_DATA_KEY) || "{}");

      return Object.entries(map).map(([id, pack]) => {
        const inlineName =
          pack?.project?.name ||
          pack?.project?.title ||
          pack?.projectName ||
          pack?.name ||
          pack?.metadata?.title ||
          pack?.metadata?.name ||
          pack?.analysisResult?.Meta?.ProjectName ||
          pack?.analysisResult?.Meta?.Name;

        const probedName = inlineName || probeProjectNameById(id);

        return {
          id,
          name: String(probedName || `Project ${id.slice(-6)}`),
        };
      });
    } catch {
      return [];
    }
  }

  /** Get a project's Summary 2D by id */
  function getHazardSummary2DByProjectId(projectId) {
    try {
      const map = JSON.parse(localStorage.getItem(LITE_PROJECT_DATA_KEY) || "{}");
      const pack = map?.[projectId];
      const summary = pack?.analysisResult?.Summary;
      return (Array.isArray(summary) && Array.isArray(summary[0])) ? summary : [];
    } catch {
      return [];
    }
  }

  // ---- Flexible header handling (aliases + helpers)
const HEADER_ALIASES = {
    // risk score or combined risk column
    risk: [
      "risk", "risk score", "risk_score", "riskscore", "rpn", "rpn score", "risk priority number",
      "level", "risk level", "risk_level", "risk rating", "risk_rating", "riskrank", "risk rank"
    ],
    // severity / consequence
    severity: [
      "severity", "sev", "s", "consequence", "impact", "harm severity", "harm_severity"
    ],
    // likelihood / probability / frequency
    likelihood: [
      "likelihood", "probability", "prob", "p", "freq", "frequency", "occurrence", "occurrence rating"
    ],
    // textual priority labels (High/Med/Low)
    priority: [
      "priority", "risk category", "risk_category", "risk class", "risk_class", "risk band", "risk_band"
    ],
    // headers that typically contain “content” we want to import as requirement titles
    contentHints: [
      "requirement", "requirements", "mitigation", "mitigations", "hazard", "hazards", "loss", "losses",
      "constraint", "constraints", "uca", "control", "controls", "safety requirement", "safety requirements"
    ]
  };

  function normalizeHeaderLabel(s) {
    return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function findHeaderIndex(headers, aliasList) {
    const normHeaders = headers.map(normalizeHeaderLabel);
    const normAliases = aliasList.map(normalizeHeaderLabel);
    // exact normalized match
    for (let i = 0; i < normHeaders.length; i++) {
      if (normAliases.includes(normHeaders[i])) return i;
    }
    // partial contains fallback (e.g., "risk_score (calc)")
    for (let i = 0; i < normHeaders.length; i++) {
      if (normAliases.some(a => normHeaders[i].includes(a))) return i;
    }
    return -1;
  }

  // If user picks a header label (headerName), map back to the index even if spacing/case varies
  function findPickedHeaderIndex(headers, pickedHeaderName) {
    const normPicked = normalizeHeaderLabel(pickedHeaderName);
    const normHeaders = headers.map(normalizeHeaderLabel);
    let idx = normHeaders.indexOf(normPicked);
    if (idx >= 0) return idx;
    // fallback: contains
    idx = normHeaders.findIndex(h => h.includes(normPicked));
    return idx;
  }

  // Try to pick “content columns” for suggestions
  function pickContentColumns(headers) {
    const normHeaders = headers.map(normalizeHeaderLabel);
    const hints = HEADER_ALIASES.contentHints.map(normalizeHeaderLabel);
    const out = [];
    for (let i = 0; i < headers.length; i++) {
      if (hints.some(h => normHeaders[i].includes(h))) out.push(headers[i]);
    }
    // if nothing matched, return all headers (caller can filter again)
    return out.length ? out : headers;
  }

  // Map text like "High/Medium/Low" or numbers into a canonical priority string
  function toPriorityString({ riskScore, sev, lik, textPriority }) {
    // direct textual priority takes precedence
    const tp = String(textPriority || "").trim().toLowerCase();
    if (tp) {
      if (/^(highest|very high|extreme|critical|catastrophic)$/.test(tp)) return "Highest";
      if (/^(high|major|significant)$/.test(tp)) return "High";
      if (/^(medium|moderate)$/.test(tp)) return "Medium";
      if (/^(low|minor)$/.test(tp)) return "Low";
    }

    // numeric risk score (RPN or similar)
    const r = Number(riskScore);
    if (!Number.isNaN(r) && r > 0) {
      if (r >= 20) return "Highest";
      if (r >= 15) return "High";
      if (r >= 8)  return "Medium";
      if (r >= 4)  return "Low";
    }

    // fallback to sev * lik
    const s = Number(sev);
    const l = Number(lik);
    if (s > 0 && l > 0) {
      const rpn = s * l;
      if (rpn >= 20) return "Highest";
      if (rpn >= 15) return "High";
      if (rpn >= 8)  return "Medium";
      if (rpn >= 4)  return "Low";
    }
    return ""; // unknown/blank
  }


/**
 * Build requirement-like items from a Summary 2D table.
 * If categoryFilter is "All", import Requirement + Mitigation + Hazard + Loss.
 * targetModule is the module to assign inside RequirementsManager.
 */
/**
 * Build requirements from a specific Summary column header.
 * headerName must match a header in the first row of the Summary table.
 */
function buildReqsFromSummary2D(summary2D, headerName, targetModule) {
    if (!Array.isArray(summary2D) || summary2D.length < 2) return [];
    const headers = summary2D[0].map(h => String(h || ""));
    const rows = summary2D.slice(1);

    // Map the user-picked display header to an index, even if formatting differs
    const colIdx = findPickedHeaderIndex(headers, headerName);
    if (colIdx < 0) return [];

    // Find optional helpers: risk / severity / likelihood / textual priority
    const riskIdx = findHeaderIndex(headers, HEADER_ALIASES.risk);
    const sevIdx  = findHeaderIndex(headers, HEADER_ALIASES.severity);
    const likIdx  = findHeaderIndex(headers, HEADER_ALIASES.likelihood);
    const priIdx  = findHeaderIndex(headers, HEADER_ALIASES.priority);

    const out = [];
    for (const row of rows) {
      const text = row[colIdx];
      if (!text || !String(text).trim()) continue;

      const sev = sevIdx >= 0 ? row[sevIdx] : undefined;
      const lik = likIdx >= 0 ? row[likIdx] : undefined;
      const riskScore = riskIdx >= 0 ? row[riskIdx] : undefined;
      const textPriority = priIdx >= 0 ? row[priIdx] : undefined;

      const priority = toPriorityString({ riskScore, sev, lik, textPriority });

      const attributes = {};
      if (priority) attributes["Priority"] = priority;
      if (headerName) attributes["Category"] = headerName;
      if (riskIdx >= 0 && row[riskIdx] != null && String(row[riskIdx]).trim() !== "") {
        attributes["RiskScore"] = String(row[riskIdx]).trim();
      }
      if (sevIdx >= 0 && row[sevIdx] != null && String(row[sevIdx]).trim() !== "") {
        attributes["Severity"] = String(row[sevIdx]).trim();
      }
      if (likIdx >= 0 && row[likIdx] != null && String(row[likIdx]).trim() !== "") {
        attributes["Likelihood"] = String(row[likIdx]).trim();
      }

      out.push({
        title: String(text).trim(),
        module: targetModule || "Requirement",
        attributes,
      });
    }

    // de-dupe by normalized title
    const seen = new Set();
    const dedup = [];
    for (const r of out) {
      const k = r.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(r);
    }
    return dedup;
  }

// ---- File helpers
function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
async function loadXLSX() {
  try {
    return await import(/* webpackChunkName: "xlsx" */ "xlsx");
  } catch (e) {
    throw new Error("XLSX not installed. Run `npm i xlsx` or export JSON/CSV instead.");
  }
}

// ----------------------------- Storage Adapter ------------------------------
const LS_KEY = "xhandle:requirements";         // requirements (now stamped with folderId/moduleId)
const LS_VIEWS = "xhandle:req-views";          // user-saved views
const LS_PROJECTS = "xhandle:req-projects";    // we keep key name for backward compat; they are now FOLDERS
const LS_ACTIVE_PROJECT = "xhandle:req-active-project"; // active folder id
const LS_BASELINES_V2 = "xhandle:req-baselines:v2"; // { [folderId]: { [moduleId]: { [name]: { at, data[] } } } }

// Limit how much we keep in history to avoid storage blow-ups
const MAX_HISTORY_ENTRIES = 30;


const Storage = {
  async load() { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); },
  save(rows) {
    // A save either persists all content or fails visibly. Never silently prune evidence.
    localStorage.setItem(LS_KEY, JSON.stringify(rows));
    window.dispatchEvent(new CustomEvent('xhandle:requirements-data-changed', { detail: { source: 'requirements-editor' } }));
  },
  loadViews() { return JSON.parse(localStorage.getItem(LS_VIEWS) || "[]"); },
  saveViews(v) {
    try {
      localStorage.setItem(LS_VIEWS, JSON.stringify(v));
    } catch {
      // views are small; ignore failure
    }
  },
};

const Baselines = {
  loadMap() { return JSON.parse(localStorage.getItem(LS_BASELINES_V2) || "{}"); },
  saveMap(m) { localStorage.setItem(LS_BASELINES_V2, JSON.stringify(m)); },
};
const Folders = {
  loadAll() { return JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]"); },
  saveAll(p) { localStorage.setItem(LS_PROJECTS, JSON.stringify(p)); },
  activeId() { return JSON.parse(localStorage.getItem(LS_ACTIVE_PROJECT) || "null"); },
  setActive(id) { localStorage.setItem(LS_ACTIVE_PROJECT, JSON.stringify(id)); },
  upsert(folder) {
    const all = Folders.loadAll();
    const i = all.findIndex(p => p.id === folder.id);
    if (i >= 0) all[i] = folder; else all.push(folder);
    Folders.saveAll(all);
  }
};

// ----------------------------- Tree Utilities -------------------------------


function siblingsOf(rows, id) {
  const { byId, children } = buildIndex(rows);
  const me = byId.get(id); if (!me) return [];
  const list = children.get(me.parentId||null) || [];
  return list;
}
function nextOrderAmong(rows, parentId) {
  const list = rows.filter(r => (r.parentId||null) === (parentId||null));
  return (Math.max(-1, ...list.map(r => r.order ?? 0)) + 1);
}

// ----------------------------- CSV / XLSX helpers ---------------------------
function toCSV(rows, fallbackFolderId, moduleByName) {
    if (!rows?.length) return "";
    const headers = [
      "id", "title", "module", "status", "version", "createdAt", "updatedAt",
      "parentId", "order", "projectId", "folderId", "moduleId",
      "attributes_json", "links_json", "content_json",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const cells = [
        r.id,
        escapeCSV(r.title ?? ""),
        r.module ?? "",
        r.status ?? "",
        String(r.version ?? 1),
        r.createdAt ?? "",
        r.updatedAt ?? "",
        r.parentId ?? "",
        String(r.order ?? 0),
        r.projectId ?? r.folderId ?? fallbackFolderId ?? "",
        r.folderId ?? r.projectId ?? fallbackFolderId ?? "",
        r.moduleId ?? moduleByName?.[r.module]?.id ?? "",
        escapeCSV(JSON.stringify(r.attributes || {})),
        escapeCSV(JSON.stringify(r.links || [])),
        escapeCSV(JSON.stringify(r.content || null)),
      ];
      lines.push(cells.join(","));
    }
    return lines.join("");
  }


// ----------------------------- Folder tree utils ----------------------------
function buildFolderTree(folders){
  const map = new Map(folders.map(f=>[f.id,{...f, children:[]}]));
  const roots = [];
  for (const f of folders) {
    if (f.parentId && map.has(f.parentId)) map.get(f.parentId).children.push(map.get(f.id));
    else roots.push(map.get(f.id));
  }
  function sortRec(node){ node.children.sort((a,b)=>a.name.localeCompare(b.name)); node.children.forEach(sortRec); }
  roots.sort((a,b)=>a.name.localeCompare(b.name)); roots.forEach(sortRec);
  return roots;
}

// ----------------------------- Folder deletion helpers ----------------------
function collectDescendantIds(folders, folderId) {
  const byParent = new Map();
  for (const f of folders) {
    const p = f.parentId || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(f);
  }
  const out = new Set();
  (function walk(id){
    const kids = byParent.get(id) || [];
    for (const k of kids) { out.add(k.id); walk(k.id); }
  })(folderId);
  return out; // excludes the root folderId itself
}
function hasRequirementsInScope(requirements, folderId, descendantIds) {
  const inScope = new Set([folderId, ...descendantIds]);
  return requirements.some(r => inScope.has(r.folderId ?? r.projectId));
}

function MenuBar({ selectedReq, onNewSibling, onNewChild, onEdit, onDelete, onNewParent,
  onMoveUp, onMoveDown, onPromote, onDemote, onImportFile, onOpenImportHazardModal,
  onExportJSON, onExportCSV, onExportXLSX, onSaveBaseline, onRestoreBaseline,
  viewMode, setViewMode, sidebarOpen, setSidebarOpen, savedViews = [], onApplyView, onSaveView,
  onReuse, onOpenLinker, readOnly }) {
  const fileRef = useRef(null);
  const selectionDisabled = !selectedReq || readOnly;
  const entry = (label, onSelect, disabled = false) => ({ label, onSelect, disabled });
  const menus = [
    { label: 'File', items: [
      entry('Import from Hazard Analysis…', onOpenImportHazardModal, readOnly),
      entry('Import…', () => fileRef.current?.click(), readOnly),
      entry('Export as JSON', onExportJSON), entry('Export as CSV', onExportCSV), entry('Export as Excel', onExportXLSX),
      entry('Save Baseline…', onSaveBaseline, readOnly), entry('Restore Baseline…', onRestoreBaseline, readOnly),
    ] },
    { label: 'Edit', items: [
      entry('New Child', onNewChild, readOnly),
      entry('New at Same Level', () => onNewSibling(selectedReq.id), selectionDisabled),
      entry('New Parent', () => onNewParent(selectedReq.id), selectionDisabled),
      entry('Edit Selected', () => onEdit(selectedReq), selectionDisabled),
      entry('Delete Selected', () => onDelete(selectedReq.id), selectionDisabled),
    ] },
    { label: 'View', items: [
      entry(`${viewMode === 'outline' ? '✓ ' : ''}Outline`, () => setViewMode('outline')),
      entry(`${viewMode === 'table' ? '✓ ' : ''}Table`, () => setViewMode('table')),
      entry('Traceability', () => setViewMode('TRACE')),
      entry(sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar', () => setSidebarOpen(value => !value)),
      entry('Save Current View…', onSaveView), ...savedViews.map(view => entry(view.name, () => onApplyView(view))),
    ] },
    { label: 'Arrange', items: [
      entry('Move Up', () => onMoveUp(selectedReq.id), selectionDisabled),
      entry('Move Down', () => onMoveDown(selectedReq.id), selectionDisabled),
      entry('Promote', () => onPromote(selectedReq.id), selectionDisabled),
      entry('Demote', () => onDemote(selectedReq.id), selectionDisabled),
    ] },
    { label: 'Extras', items: [entry('Duplicate Module', onReuse, readOnly), entry('Link Modules (AI)', onOpenLinker, readOnly)] },
    { label: 'Help', items: [{ text: 'Select a row to edit or arrange it. Double-click a title to edit. File contains module imports, exports and baselines.' }] },
  ].map(menu => ({ ...menu, items: menu.items.filter(item => item.onSelect || item.text) }));
  return <><DesignEditorMenu menus={menus} /><input ref={fileRef} type="file" accept=".json,.csv,.xlsx,.xls" className="hidden" onChange={event => { onImportFile?.(event.target.files?.[0]); event.target.value = ''; }} /></>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TraceabilityLinkEditor — module → scrollable requirement list with search
// Uses existing LINK_TYPES constant and your Requirement shape { id, title, module, links[] }
// Props:
//   draft, setDraft            -> the form state you’re editing
//   allModules: string[]       -> list of module names (e.g., ["System","Requirement",...])
//   allCandidates: Requirement[] -> ALL requirements (across folders + modules)
// ─────────────────────────────────────────────────────────────────────────────
function TraceabilityLinkEditor({ draft, setDraft, allModules, allCandidates }) {
  const [newLinkType, setNewLinkType] = React.useState("refines");
  const [targetModuleName, setTargetModuleName] = React.useState(null);
  const [reqSearch, setReqSearch] = React.useState("");
  const [selectedChildIds, setSelectedChildIds] = React.useState(() => new Set());

  // modules except the current requirement's module (no intra-module linking)
  const moduleOptions = React.useMemo(
    () => (allModules || []).filter((name) => name !== (draft.module || "")),
    [allModules, draft.module]
  );

  // candidates within the chosen module (exclude self; belt-and-suspenders exclude same-module)
  const availableReqs = React.useMemo(() => {
    if (!targetModuleName) return [];
    return (allCandidates || [])
      .filter((r) => r.id !== draft.id)
      .filter((r) => r.module === targetModuleName)
      .filter((r) => r.module !== draft.module);
  }, [allCandidates, targetModuleName, draft.id, draft.module]);

  // search filter
  const visibleReqs = React.useMemo(() => {
    const q = reqSearch.trim().toLowerCase();
    if (!q) return availableReqs;
    return availableReqs.filter(
      (r) =>
        String(r.title || "").toLowerCase().includes(q) ||
        String(r.id || "").toLowerCase().includes(q)
    );
  }, [availableReqs, reqSearch]);

  function togglePick(id) {
    setSelectedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelectedLinks() {
    if (!selectedChildIds.size) return;
    const toAdd = Array.from(selectedChildIds).map((id) => ({ toId: id, type: newLinkType }));

    const existing = Array.isArray(draft.links) ? draft.links : [];
    const existingKeys = new Set(existing.map((l) => `${l.type}::${l.toId}`));

    const merged = [
      ...existing,
      ...toAdd.filter((l) => !existingKeys.has(`${l.type}::${l.toId}`)),
    ];

    setDraft((d) => ({ ...d, links: merged }));
    setSelectedChildIds(new Set());
  }

  function removeLink(idx) {
    const next = (draft.links || []).filter((_, i) => i !== idx);
    setDraft((d) => ({ ...d, links: next }));
  }

  function findReqById(id) {
    return (allCandidates || []).find((r) => r.id === id) || null;
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Traceability Links</span>
        <span className="text-xs text-gray-500">(select a module, then pick one or more requirements)</span>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border px-2 py-1 text-sm"
          value={newLinkType}
          onChange={(e) => setNewLinkType(e.target.value)}
        >
          {LINK_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          className="rounded-md border px-2 py-1 text-sm"
          value={targetModuleName || ""}
          onChange={(e) => setTargetModuleName(e.target.value || null)}
        >
          <option value="">Choose module…</option>
          {moduleOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        {targetModuleName && (
          <div className="relative ml-auto w-64">
            <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">
              <Search size={14} />
            </div>
            <input
              className="w-full rounded-md border pl-7 pr-2 py-1 text-sm"
              placeholder="Search requirements…"
              value={reqSearch}
              onChange={(e) => setReqSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Scrollable list */}
      {targetModuleName && (
        <div className="mt-2 rounded-md border">
          <div className="max-h-56 overflow-y-auto">
            {visibleReqs.length === 0 ? (
              <div className="p-3 text-sm text-gray-500">
                No requirements found in “{targetModuleName}”.
              </div>
            ) : (
              <ul className="divide-y">
                {visibleReqs.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedChildIds.has(r.id)}
                      onChange={() => togglePick(r.id)}
                    />
                    <div className="min-w-0">
                    <div className={`truncate text-sm ${r.heading ? "font-semibold" : "font-medium"}`}>
  {r.title || "(untitled)"}
</div>
                      <div className="text-xs text-gray-500">[{r.module}] {r.id}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2">
            <div className="text-xs text-gray-500">
              {selectedChildIds.size} selected
            </div>
            <button
              type="button"
              onClick={addSelectedLinks}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={selectedChildIds.size === 0}
              title="Add selected requirement links"
            >
              <PlusCircle size={14} /> Add link(s)
            </button>
          </div>
        </div>
      )}

      {/* Existing links on this requirement */}
      {!!(draft.links && draft.links.length) && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-gray-600">Current Links</div>
          <ul className="divide-y rounded-md border">
            {(draft.links || []).map((l, idx) => {
              const tgt = findReqById(l.toId);
              return (
                <li key={`${l.type}-${l.toId}-${idx}`} className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-gray-500">{l.type}</div>
                    <div className="truncate text-sm">
                    {tgt ? (
  <>
    <span className="text-gray-600">[{tgt.module}] </span>
    <span className={tgt.heading ? "font-semibold" : ""}>
      {tgt.title || tgt.id}
    </span>
  </>
) : (
  <span className="text-gray-400">(missing target: {l.toId})</span>
)}

                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLink(idx)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100"
                    title="Remove link"
                    aria-label="Remove link"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}



// ----------------------------- Component ------------------------------------
export default function RequirementsManager({
  canEdit = true,
  moduleAccess = {},
  currentUser = "anonymous",
  currentRole = "Owner", // "Owner" | "Editor" | "Viewer"
  onActiveDesignContextChange,
  onGenerateProject,
  onGenerateArtifact,
  onUpdateArtifactDetails,
  onDeleteArtifact,
  artifactModules = [],
  onMoveArtifact,
  onMoveDesignFolder,
  activeArtifactId = null,
  onSelectArtifact,
  renderArtifact,
}) {
  useEffect(() => { migrateRequirementsState(); }, []);

  // --- folders & selection
  const [folders, setFolders] = useState(Folders.loadAll());
  const [activeFolderId, setActiveFolderId] = useState(Folders.activeId());
  const [libraryView, setLibraryView] = useState('folder');
  useEffect(() => { setFolders(Folders.loadAll()); setActiveFolderId(Folders.activeId()); }, []);
  useEffect(() => { Folders.setActive(activeFolderId); }, [activeFolderId]);

  useEffect(() => {
    const artifact = artifactModules.find(m => m.id === activeArtifactId);
    if (artifact) { setActiveFolderId(artifact.folderId); setLibraryView('folder'); }
  }, [activeArtifactId, artifactModules]);

  const activeFolder = useMemo(() => folders.find(p => p.id === activeFolderId) || null, [folders, activeFolderId]);
  const moduleMetas = useMemo(() => activeFolder?.modules || [], [activeFolder]);
  const moduleByName = useMemo(() => Object.fromEntries(moduleMetas.map(m => [m.name, m])), [moduleMetas]);
  // --- requirements: must be declared before helpers that use it
const [requirements, setRequirements] = useState([]);
const requirementsRef = useRef(requirements);
requirementsRef.current = requirements;
const [persistenceError, setPersistenceError] = useState('');
const updateRequirements = (apply) => {
  const previous = deepClone(requirementsRef.current);
  const next = typeof apply === "function" ? apply(previous) : apply;
  try { Storage.save(next); }
  catch (error) { setPersistenceError(`Changes were not saved: ${error.message}`); throw error; }
  requirementsRef.current = next;
  setRequirements(next);
  setPersistenceError('');
};



useEffect(() => { (async ()=> setRequirements(await Storage.load()))(); }, []);

  useEffect(() => {
    const syncFromSharedState = () => {
      const nextFolders = loadSharedFolders();
      const nextRequirements = loadSharedRequirements();
      setFolders(nextFolders);
      requirementsRef.current = nextRequirements;
      setRequirements(nextRequirements);
      setActiveFolderId(getSharedActiveFolderId() || nextFolders[0]?.id || null);
    };

    const onFocusModule = (event) => {
      syncFromSharedState();
      setLibraryView('module');
      onSelectArtifact?.(null);
      const detail = event?.detail || {};
      if (detail.folderId) setActiveFolderId(detail.folderId);
      if (detail.moduleName) setSelectedModule(detail.moduleName);
      if (detail.moduleId && !detail.moduleName) {
        const targetFolder = loadSharedFolders().find((folder) => folder.id === (detail.folderId || getSharedActiveFolderId()));
        const targetModule = (targetFolder?.modules || []).find((module) => module.id === detail.moduleId);
        if (targetModule?.name) setSelectedModule(targetModule.name);
      }
    };

    window.addEventListener("xhandle:requirements-data-changed", syncFromSharedState);
    window.addEventListener("xhandle:requirements-focus-module", onFocusModule);
    return () => {
      window.removeEventListener("xhandle:requirements-data-changed", syncFromSharedState);
      window.removeEventListener("xhandle:requirements-focus-module", onFocusModule);
    };
  }, [onSelectArtifact]);

  const [showLinker, setShowLinker] = useState(false);
  const getAllReqs = useCallback(() => {
    try {
      if (activeFolderId) {
        const rows = listRequirementsByFolder(activeFolderId);
        // Normalize common shapes to a plain array
        if (Array.isArray(rows)) return rows;
        if (Array.isArray(rows?.rows)) return rows.rows;
        if (Array.isArray(rows?.data)) return rows.data;
        if (rows && typeof rows === "object") {
          // Try the first array-ish property as a last resort
          const firstArray = Object.values(rows).find(Array.isArray);
          if (Array.isArray(firstArray)) return firstArray;
        }
      }
    } catch {}
    return Array.isArray(requirements) ? requirements : [];
  }, [activeFolderId, requirements]);

  const listModulesLocal = useCallback(() => {
    // Inferred from requirements (existing logic)
    const reqs = getAllReqs();
    const arr = Array.isArray(reqs) ? reqs : [];
    const inferred = new Map();
    for (const r of arr) {
      const modId   = r.moduleId ?? r.module;
      const modName = r.moduleName ?? r.module ?? "Module";
      if (modId) inferred.set(modId, { id: modId, name: modName });
    }

    // Declared on the folder by the module manager.
    for (const m of (moduleMetas || [])) {
      inferred.set(m.id, { id: m.id, name: m.name });
    }

    return Array.from(inferred.values());
  }, [getAllReqs, moduleMetas]);

  const listRequirementsByModuleLocal = useCallback((moduleId) => {
    const reqs = getAllReqs();
    const arr = Array.isArray(reqs) ? reqs : [];
    return arr.filter(r => r.moduleId === moduleId || r.module === moduleId);
  }, [getAllReqs]);

  async function addTraceLinkLocal(parentId, childId, type) {
    const inverse = LINK_INVERSE?.[type] || `${type}-by`;
    let blocked = false;

    // Update state first so the UI reflects immediately
    updateRequirements((prev) => {
      const next = deepClone(prev);
      const parent = next.find((r) => r.id === parentId);
      const child  = next.find((r) => r.id === childId);
      if (!parent || !child) return prev;

      // 🚫 Disallow intra-module links
      const sameModule =
        (parent.moduleId && child.moduleId && parent.moduleId === child.moduleId) ||
        (parent.module && child.module && parent.module === child.module);

      if (sameModule) { blocked = true; return prev; }

      // ---- parent → child (forward)
      const pLinks = Array.isArray(parent.links) ? parent.links : [];
      if (!pLinks.some((l) => l.toId === childId && l.type === type)) {
        const newVersion = (parent.version ?? 1) + 1;
        parent.links = [...pLinks, { toId: childId, type }];
        parent.updatedAt = nowISO();
        parent.history = [
          ...(parent.history || []),
          {
            at: nowISO(),
            version: newVersion,
            change: `links changed (added ${type} → ${childId})`,
            author: currentUser,
          },
        ];
        parent.version = newVersion;
      }

      // ---- child ← parent (inverse/backlink)
      const cLinks = Array.isArray(child.links) ? child.links : [];
      if (!cLinks.some((l) => l.toId === parentId && l.type === inverse)) {
        const newVersion = (child.version ?? 1) + 1;
        child.links = [...cLinks, { toId: parentId, type: inverse }];
        child.updatedAt = nowISO();
        child.history = [
          ...(child.history || []),
          {
            at: nowISO(),
            version: newVersion,
            change: `links changed (added ${inverse} → ${parentId})`,
            author: currentUser,
          },
        ];
        child.version = newVersion;
      }

      return next;
    });

    if (blocked) {
      throw new Error("Links within the same module are not allowed.");
    }

    // Persist both sides (best-effort)
    try {
      const all = getAllReqs();
      const parent = all.find((r) => r.id === parentId);
      const child  = all.find((r) => r.id === childId);
      if (!parent || !child) return;

      // Defensive same-module check again
      const sameModule =
        (parent.moduleId && child.moduleId && parent.moduleId === child.moduleId) ||
        (parent.module && child.module && parent.module === child.module);
      if (sameModule) return;

      const parentLinks = Array.isArray(parent.links) ? parent.links : [];
      const childLinks  = Array.isArray(child.links)  ? child.links  : [];

      if (!parentLinks.some((l) => l.toId === childId && l.type === type)) {
        await updateRequirement(parentId, { links: [...parentLinks, { toId: childId, type }] });
      }
      if (!childLinks.some((l) => l.toId === parentId && l.type === inverse)) {
        await updateRequirement(childId, { links: [...childLinks, { toId: parentId, type: inverse }] });
      }
    } catch (e) {
      console.warn("Persisting link/backlink failed:", e);
    }
  }


// Create a blank parent above the selected item and reparent it under the new node
function createParentFor(id){
    if (!id) return;
    const newId = makeId("REQ");
    let newParentObj = null;

    updateRequirements(prev => {
      const me = prev.find(r => r.id === id);
      if (!me) return prev;

      const sameScope = prev.filter(
        r => (r.folderId ?? r.projectId) === me.folderId && r.module === me.module
      );

      newParentObj = {
        id: newId,
        title: "",
        projectId: me.projectId,
        folderId: me.folderId,
        module: me.module,
        moduleId: me.moduleId ?? null,
        status: STATUSES[0],
        heading: true,
        attributes: {},
        links: [],
        parentId: me.parentId ?? null,
        order: me.order ?? nextOrderAmong(sameScope, me.parentId ?? null),
        version: 1,
        history: [],
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };

      const next = deepClone(prev);
      next.push(newParentObj);

      const idx = next.findIndex(r => r.id === me.id);
      next[idx].parentId = newId;
      next[idx].order = nextOrderAmong(
        next.filter(r => (r.folderId ?? r.projectId) === me.folderId && r.module === me.module),
        newId
      );

      return next;
    });

    // Open the form on the new parent for immediate naming
    if (newParentObj) { setEditing(newParentObj); setShowForm(true); setSelectedId(newId); }
  }

  // Start a new requirement as a sibling of the selected item
  function createSiblingFor(id){
    if (!id) return;
    const me = requirements.find(r => r.id === id);
    if (!me) return;

    const draft = {
      id: makeId(),
      title: "",
      projectId: me.projectId,
      folderId: me.folderId,
      module: me.module,
      moduleId: me.moduleId ?? null,
      status: STATUSES[0],
      heading: false,
      attributes: {},
      links: [],
      parentId: me.parentId ?? null, // same level
      order: nextOrderAmong(
        requirements.filter(r => (r.folderId ?? r.projectId) === me.folderId && r.module === me.module),
        me.parentId ?? null
      ),
      version: 1,
      history: [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    setEditing(draft);
    setShowForm(true);
  }

  // inside RequirementsManager component, near other useMemos
const folderNameById = useMemo(
    () => Object.fromEntries(folders.map(f => [f.id, f.name])),
    [folders]
  );

  function resolveFolderLocal(folderId = activeFolderId) {
    const all = Folders.loadAll();
    return all.find((folder) => folder.id === folderId) || null;
  }

  function resolveModuleLocal(moduleRef, folderId = activeFolderId) {
    const folder = resolveFolderLocal(folderId);
    if (!folder || !moduleRef) return null;
    return (folder.modules || []).find((module) =>
      module.id === moduleRef || String(module.name || "").toLowerCase() === String(moduleRef).toLowerCase()
    ) || null;
  }

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_SIDEBAR_OPEN) ?? "true"); }
    catch { return true; }
  });
  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR_OPEN, JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

// UI state (near sidebarOpen)
const [isRootDrop, setIsRootDrop] = useState(false);

  // --- UI state
  const [viewMode, setViewMode] = useState(VIEW_MODES.OUTLINE);
  const [selectedModule, setSelectedModule] = useState(moduleMetas[0]?.name || "System");
  useEffect(() => {
    if (!selectedModule || !moduleMetas.find(m => m.name === selectedModule)) {
      if (moduleMetas[0]?.name) setSelectedModule(moduleMetas[0].name);
    }
  }, [moduleMetas, selectedModule]);

  const [savedViews, setSavedViews] = useState(Storage.loadViews());
  useEffect(() => { Storage.saveViews(savedViews); }, [savedViews]);

  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showHistoryFor, setShowHistoryFor] = useState(null);
  const [toast, setToast] = useState("");
  // Import-from-Hazard modal
const [showImportModal, setShowImportModal] = useState(false);
// Single-row selection for global actions
const [selectedId, setSelectedId] = useState(null);
const pendingSearchSelection = useRef(null);
const [searchSelectionVersion, setSearchSelectionVersion] = useState(0);
// Multi-select + clipboard
const [selectedIds, setSelectedIds] = useState(() => new Set());        // holds multiple ids
const [clipboard, setClipboard] = useState(null); // { moduleName, roots: Requirement[], withHierarchy: true }

const selectedReq = useMemo(
  () => requirements.find(r => r.id === selectedId) || null,
  [requirements, selectedId]
);
function selectOne(id) {
  setSelectedId(id);
  setSelectedIds(new Set([id]));
}

function toggleSelect(id) {
  setSelectedId(id);
  setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function clearSelection() {
  setSelectedId(null);
  setSelectedIds(new Set());
}

// Attribute mapper state (opened after Title is chosen)
const [showAttrMapper, setShowAttrMapper] = useState(false);
const [mapperColumns, setMapperColumns] = useState([]);     // string[] headers
const [mapperTitleCol, setMapperTitleCol] = useState(null); // string
const [mapperSummary2D, setMapperSummary2D] = useState([]); // original 2D rows

// Clear selection when switching folder/module
useEffect(() => {
  const target = pendingSearchSelection.current;
  if (target?.folderId === activeFolderId && target.moduleName === selectedModule) {
    setSelectedId(target.objectId); setSelectedIds(new Set([target.objectId])); setViewMode('table');
    pendingSearchSelection.current = null;
  } else { pendingSearchSelection.current = null; setSelectedId(null); }
}, [activeFolderId, selectedModule]);


  const [showModuleManager, setShowModuleManager] = useState(false);
  const [moduleManagerFolderId, setModuleManagerFolderId] = useState(null);
  const moduleManagerFolder = moduleManagerFolderId ? folders.find(folder => folder.id === moduleManagerFolderId) : activeFolder;
  const [showReuse, setShowReuse] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);

  function toastOnce(msg){ setToast(msg); setTimeout(()=>setToast(""), 1800); }

  // ----------------------------- Derived collections ------------------------
const allModules = useMemo(() => {
  const fromFolder = moduleMetas.map(m => m.name);
  const inferred = listModulesLocal().map(m => m.name);
  return Array.from(new Set([...fromFolder, ...inferred]));
}, [moduleMetas, listModulesLocal]);

const folderRequirements = useMemo(
  () => requirements.filter(r => (r.folderId ?? r.projectId) === activeFolderId),
  [requirements, activeFolderId]
);

// SINGLE source of truth for the currently visible module rows
const moduleRows = useMemo(
  () => folderRequirements.filter(r => r.module === selectedModule),
  [folderRequirements, selectedModule]
);

useEffect(() => {
  if (typeof onActiveDesignContextChange !== "function") return;
  onActiveDesignContextChange({
    activeFolderId,
    activeFolderName: activeFolder?.name || "Current Design Folder",
    selectedModule: libraryView === 'module' ? selectedModule : null,
    selectedModuleId: libraryView === 'module' ? moduleByName[selectedModule]?.id || null : null,
    rows: libraryView === 'module' ? moduleRows : [],
  });
}, [activeFolderId, activeFolder?.name, selectedModule, moduleByName, moduleRows, libraryView, onActiveDesignContextChange]);

useEffect(() => {
  function onKeyDown(e) {
    if (activeArtifactId || libraryView !== 'module') return;
    // don't hijack arrows while typing
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;

    const multi = selectedIds && selectedIds.size > 0;
    const ids = multi
      ? Array.from(selectedIds)
      : (selectedReq ? [selectedReq.id] : []);

    if (!ids.length) return;

    // Shift + ArrowUp → heading=true (bold)
    if (e.shiftKey && e.key === "ArrowUp") {
      e.preventDefault();
      for (const id of ids) {
        const row = moduleRows.find(r => r.id === id);
        if (row && !row.heading) saveRequirement({ ...row, heading: true });
      }
    }

    // Shift + ArrowDown → heading=false
    if (e.shiftKey && e.key === "ArrowDown") {
      e.preventDefault();
      for (const id of ids) {
        const row = moduleRows.find(r => r.id === id);
        if (row && row.heading) saveRequirement({ ...row, heading: false });
      }
    }

    // Shift + ArrowRight → Demote
    if (e.shiftKey && e.key === "ArrowRight") {
      e.preventDefault();
      ids.forEach(id => demote?.(id));
    }

    // Shift + ArrowLeft → Promote
    if (e.shiftKey && e.key === "ArrowLeft") {
      e.preventDefault();
      ids.forEach(id => promote?.(id));
    }

    // Clipboard (works for multi or single)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelection(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "x") {
      e.preventDefault();
      cutSelection();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteClipboard();
    }
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [activeArtifactId, libraryView, selectedReq, selectedIds, moduleRows, saveRequirement, promote, demote, copySelection, cutSelection, pasteClipboard]);


// Columns for the Table view (template + keys present in data)
const attrColumns = useMemo(() => {
  const tmpl = normalizeAttrTemplate(moduleByName[selectedModule]?.attrTemplate) || [];
  const tmplKeys = tmpl.map(t => t.key).filter(Boolean);

  const presentKeys = Array.from(
    new Set(
      moduleRows.flatMap(r => Object.keys(r.attributes || {})).filter(Boolean)
    )
  );

  // Template order first, then extras found on rows
  const merged = [...tmplKeys, ...presentKeys.filter(k => !tmplKeys.includes(k))];
  return merged;
}, [moduleByName, selectedModule, moduleRows]);

// Outline numbering for the current module
const numbering = useMemo(() => computeNumbering(moduleRows), [moduleRows]);

// Keep Table in the same hierarchy order as Outline, including unparented rows.
const tableRows = useMemo(() => {
  const byId = new Map(moduleRows.map(row => [row.id, row]));
  return [...Array.from(numbering.keys(), id => byId.get(id)), ...moduleRows.filter(row => !numbering.has(row.id))];
}, [moduleRows, numbering]);
  // ----------------------------- Access helpers -----------------------------
  function canEditModule(modName){
    if (!canEdit) return false;
    if (moduleAccess[modName] === false) return false;
    if (currentRole === "Viewer") return false;
    return true;
  }

  // ----------------------------- CRUD (requirements) ------------------------
  function onCreate(parentId = null) {
    const modMeta = moduleByName[selectedModule];
    const draft = {
      id: makeId(),
      title: "",
      projectId: activeFolderId,
      folderId: activeFolderId,
      moduleId: modMeta?.id || null,
      module: selectedModule,
      status: STATUSES[0],
      heading: false,
      attributes: {},
      links: [],
      parentId,
      order: nextOrderAmong(moduleRows, parentId),
      version: 1,
      history: [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const tpl = normalizeAttrTemplate(modMeta?.attrTemplate);
    if (tpl?.length) {
      draft.attributes = Object.fromEntries(
        tpl.filter(t => t.key).map(t => [t.key, defaultForType(t.type)])
      );
    }

    setEditing(draft); setShowForm(true);
  }
  function onEdit(r) { setEditing(deepClone(r)); setShowForm(true); }

  function onDelete(id) {
    if (!window.confirm("Delete this requirement? Links to it will be removed.")) return;
    updateRequirements(prev => {
      const next = prev
        .filter(r => r.id !== id)
        .map(r => ({ ...r, links: (r.links || []).filter(l => l.toId !== id) }));
      toastOnce("Requirement deleted");
      return next;
    });
  }

  function describeChange(before, after) {
    try {
      const diffs = [];
      for (const key of ["title","module","status","parentId","order"]) {
        if ((before[key]??null)!==(after[key]??null)) diffs.push(`${key}: '${before[key]??""}' → '${after[key]??""}'`);
      }
      if (JSON.stringify(before.attributes||{})!==JSON.stringify(after.attributes||{})) diffs.push("attributes changed");
      if (JSON.stringify(before.links||[])!==JSON.stringify(after.links||[])) diffs.push("links changed");
      return diffs.join("; ") || "updated";
    } catch { return "updated"; }
  }

  function proceedToAttributeMapping(summary2D, titleColumn) {
    if (!Array.isArray(summary2D) || summary2D.length < 2) return;
    const headers = summary2D[0].map(h => String(h || ""));
    setMapperSummary2D(summary2D);
    setMapperColumns(headers);
    setMapperTitleCol(titleColumn);
    setShowAttrMapper(true);
  }

  // Baselines (namespaced per folder + module)
function saveBaseline() {
    if (!activeFolder || !selectedModule) {
      toastOnce("Pick a folder and module first");
      return;
    }
    const name = window.prompt("Baseline name (e.g., v1.0 or 2025-08-22):");
    if (!name) return;

    const map = Baselines.loadMap();
    map[activeFolder.id] ||= {};
    const modId = moduleByName[selectedModule]?.id;
    map[activeFolder.id][modId] ||= {};
    map[activeFolder.id][modId][name] = {
      at: nowISO(),
      data: folderRequirements.filter(r => r.module === selectedModule),
    };
    Baselines.saveMap(map);
    toastOnce(`Baseline '${name}' saved for ${selectedModule}`);
  }

  function restoreBaseline() {
    if (!activeFolder || !selectedModule) {
      toastOnce("Pick a folder and module first");
      return;
    }
    const map = Baselines.loadMap();
    const modId = moduleByName[selectedModule]?.id;
    const choices = Object.keys(map?.[activeFolder.id]?.[modId] || {});
    if (!choices.length) {
      toastOnce("No baselines yet for this module");
      return;
    }
    const name = window.prompt(`Restore which baseline?\n${choices.join("\n")}`);
    const pack = map?.[activeFolder.id]?.[modId]?.[name];
    if (!pack) return;

    const restored = pack.data;
    updateRequirements(prev => {
        const keep = prev.filter(r => !((r.folderId ?? r.projectId) === activeFolder.id && r.module === selectedModule));
        return [...keep, ...restored];
    });

    toastOnce(`Restored '${name}' to ${selectedModule}`);
  }

  // Import Summary -> requirements into current folder & module (from Hazard Analysis tab)
// Import Summary -> requirements into current folder & module (from Hazard Analysis tab)
async function importFromHazardAnalysis(projectId, headerName){
  if (!activeFolderId || !selectedModule) {
    toastOnce("Pick a folder and module first");
    return;
  }
  const summary2D = getHazardSummary2DByProjectId(projectId);
  if (!summary2D.length) {
    toastOnce("No Summary found in that project");
    return;
  }
  if (!headerName) {
    toastOnce("Select a Summary column to import from");
    return;
  }

  // 🔁 NEW: open the attribute mapper, the actual import happens on confirm
  proceedToAttributeMapping(summary2D, headerName);
  toastOnce(`Selected '${headerName}' as Title — map remaining columns next`);
}


  function saveRequirement(draft) {
    const modMeta = moduleByName[draft.module];
draft.moduleId = modMeta?.id ?? null;

if (draft.parentId) {
  const parentOk = requirements.some(r => r.id === draft.parentId && r.module === draft.module);
  if (!parentOk) draft.parentId = null;
}
    updateRequirements(prev => {
      const exists = prev.find(r => r.id === draft.id);
      const next = deepClone(prev);
      if (!exists) {
        next.push(draft);
        toastOnce("Requirement created");
      } else {
        const idx = next.findIndex(r => r.id === draft.id);
        const prevSnap = deepClone(next[idx]);
        const newVersion = (prevSnap.version ?? 1) + 1;
        const parentChanged = (prevSnap.parentId ?? null) !== (draft.parentId ?? null);
const moduleChanged = (prevSnap.module ?? "") !== (draft.module ?? "");
if (parentChanged || moduleChanged) {
  const scope = next.filter(r =>
    (r.folderId ?? r.projectId) === (draft.folderId ?? draft.projectId) &&
    r.module === draft.module
  );
  draft.order = nextOrderAmong(scope, draft.parentId ?? null);
}
        const entry = { at: nowISO(), version: newVersion, prev: prevSnap, change: describeChange(prevSnap, draft), author: currentUser };
        draft.version = newVersion;
        draft.updatedAt = nowISO();
        draft.history = [...(prevSnap.history || []), entry];
        // Cap history length to avoid storage quota errors
if (Array.isArray(draft.history) && draft.history.length > MAX_HISTORY_ENTRIES) {
  draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES);
}

        next[idx] = draft;
        toastOnce("Requirement updated");
      }
      return next;
    });
    setShowForm(false);
    setEditing(null);
  }

  function createFolderAction({ name, parentId = null } = {}) {
    const folderName = String(name || "").trim();
    if (!folderName) throw new Error("Folder name is required.");
    const folder = {
      id: makeId("FOL"),
      parentId,
      name: folderName,
      modules: [],
      roles: { Owner: [], Editor: [], Viewer: [] },
    };
    Folders.upsert(folder);
    setFolders(Folders.loadAll());
    setActiveFolderId(folder.id);
    setLibraryView('folder');
    return folder;
  }

  async function createModuleAction({ folderId = activeFolderId, name, type = "Requirement", description = "" } = {}) {
    const folder = resolveFolderLocal(folderId);
    if (!folder) throw new Error("Target folder not found.");
    const moduleName = String(name || "").trim();
    if (!moduleName) throw new Error("Module name is required.");

    const existing = (folder.modules || []).find(
      (module) => String(module.name || "").toLowerCase() === moduleName.toLowerCase()
    );
    if (existing) {
      setActiveFolderId(folderId);
      setLibraryView('module');
      onSelectArtifact?.(null);
      setSelectedModule(existing.name);
      return existing;
    }

    const mod = {
      id: makeId("MOD"),
      name: moduleName,
      type,
      description,
      attrTemplate: [],
      viewTemplates: [],
    };
    Folders.upsert({ ...folder, modules: [...(folder.modules || []), mod] });
    setFolders(Folders.loadAll());
    setActiveFolderId(folderId);
    setSelectedModule(mod.name);
    setLibraryView('module');
    onSelectArtifact?.(null);
    return mod;
  }

  function openModuleAction({ folderId = activeFolderId, moduleRef } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    setActiveFolderId(folderId);
    setSelectedModule(module.name);
    setLibraryView('module');
    onSelectArtifact?.(null);
    return module;
  }

  function saveModuleAction({ folderId = activeFolderId, moduleRef } = {}) {
    return openModuleAction({ folderId, moduleRef });
  }

  function renameModuleAction({ folderId = activeFolderId, moduleRef, newName } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const nextName = String(newName || "").trim();
    if (!nextName) throw new Error("A new module name is required.");

    const folder = resolveFolderLocal(folderId);
    const updatedFolder = {
      ...folder,
      modules: (folder.modules || []).map((entry) =>
        entry.id === module.id ? { ...entry, name: nextName } : entry
      ),
    };
    Folders.upsert(updatedFolder);
    setFolders(Folders.loadAll());
    updateRequirements((prev) =>
      prev.map((row) =>
        (row.folderId ?? row.projectId) === folderId && row.moduleId === module.id
          ? { ...row, module: nextName, updatedAt: nowISO() }
          : row
      )
    );
    if (selectedModule === module.name) setSelectedModule(nextName);
    return { ...module, name: nextName };
  }

  function validateModuleQualityAction({ folderId = activeFolderId, moduleRef = selectedModule } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const rows = requirements.filter(
      (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
    );
    const findings = [];
    const byTitle = new Map();
    const children = new Map();
    rows.forEach((row) => {
      const key = String(row.title || "").trim().toLowerCase();
      if (key) byTitle.set(key, [...(byTitle.get(key) || []), row]);
      const parent = row.parentId || null;
      children.set(parent, [...(children.get(parent) || []), row]);
    });
    rows.forEach((row) => {
      if (row.heading && !(children.get(row.id) || []).length) {
        findings.push({ severity: "warning", title: "Empty section", rowId: row.id, message: `${row.title} has no child objects.` });
      }
      if (!row.heading) {
        const title = String(row.title || "");
        if (!/\bshall\b/i.test(title)) {
          findings.push({ severity: "warning", title: "Requirement may not be normative", rowId: row.id, message: `"${title}" does not include shall.` });
        }
        if (/\b(fast|robust|adequate|easy|user[- ]friendly|as needed|where appropriate|etc\.?|reasonable)\b/i.test(title)) {
          findings.push({ severity: "warning", title: "Ambiguous wording", rowId: row.id, message: `"${title}" contains wording that may not be verifiable.` });
        }
        if (!row.attributes?.Verification) {
          findings.push({ severity: "info", title: "Missing verification method", rowId: row.id, message: `"${title}" has no Verification attribute.` });
        }
      }
    });
    byTitle.forEach((dupes) => {
      if (dupes.length > 1) {
        findings.push({ severity: "warning", title: "Duplicate title", rowIds: dupes.map((row) => row.id), message: `${dupes.length} rows share the same title.` });
      }
    });
    return { module, rowCount: rows.length, findingCount: findings.length, findings };
  }

  function buildRequirementRow(row, module, folderId, index) {
    const modMeta = moduleByName[module.name] || module;
    const template = normalizeAttrTemplate(modMeta?.attrTemplate);
    const defaults = Object.fromEntries(
      (template || []).filter((item) => item.key).map((item) => [item.key, defaultForType(item.type)])
    );
    const isHeading = !!row.heading;
    return {
      id: row.id || makeId(),
      title: row.title || `Item ${index + 1}`,
      projectId: folderId,
      folderId,
      moduleId: module.id,
      module: module.name,
      status: row.status || STATUSES[0],
      heading: isHeading,
      attributes: isHeading ? {} : { ...defaults, ...(row.attributes || {}) },
      links: row.links || [],
      parentId: row.parentId ?? null,
      order: typeof row.order === "number" ? row.order : index,
      version: 1,
      history: [],
      content: row.content,
      sourceRefs: row.sourceRefs || [],
      provenance: row.provenance,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
  }

  const AGENT_SNAPSHOTS_KEY = "xhandle.designManagement.agentSnapshots";
  function readAgentSnapshots() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AGENT_SNAPSHOTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeAgentSnapshots(snapshots) {
    try {
      localStorage.setItem(AGENT_SNAPSHOTS_KEY, JSON.stringify((snapshots || []).slice(0, 12)));
    } catch {}
  }

  function snapshotModuleAction({ folderId = activeFolderId, moduleRef = selectedModule, reason = "Collaborator edit" } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const rows = requirements.filter(
      (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
    );
    const snapshot = {
      id: makeId("SNAP"),
      reason,
      folderId,
      moduleId: module.id,
      moduleName: module.name,
      rows: deepClone(rows),
      createdAt: nowISO(),
    };
    writeAgentSnapshots([snapshot, ...readAgentSnapshots()]);
    return snapshot;
  }

  function restoreLastAgentSnapshotAction({ snapshotId } = {}) {
    const snapshots = readAgentSnapshots();
    const snapshot = snapshotId
      ? snapshots.find((entry) => entry.id === snapshotId)
      : snapshots[0];
    if (!snapshot) throw new Error("No Collaborator snapshot is available to restore.");
    const folderId = snapshot.folderId;
    const module = resolveModuleLocal(snapshot.moduleId || snapshot.moduleName, folderId);
    if (!module) throw new Error("Snapshot module no longer exists.");
    updateRequirements((prev) => {
      const keep = prev.filter(
        (row) => !((row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name))
      );
      return [...keep, ...deepClone(snapshot.rows || [])];
    });
    setActiveFolderId(folderId);
    setSelectedModule(module.name);
    toastOnce(`Restored Collaborator snapshot for ${module.name}`);
    return { snapshotId: snapshot.id, module, restored: snapshot.rows?.length || 0 };
  }

  function findRowsByQuery(rows, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    return rows.filter((row) =>
      `${row.title || ""} ${row.attributes?.Description || ""} ${row.attributes?.Rationale || ""} ${row.content || ""}`
        .toLowerCase()
        .includes(q)
    );
  }

  function expandHeadingDetails(rows = []) {
    const expanded = [];
    let currentHeadingId = null;
    const titleWithoutNumber = (title) => String(title || "").replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "").trim();
    const hasDetails = (row) => {
      if (row?.content) return true;
      const attrs = row?.attributes || {};
      return Object.values(attrs).some((value) => String(value || "").trim());
    };

    rows.forEach((row, index) => {
      if (!row?.heading) {
        expanded.push({
          ...row,
          parentId: row.parentId ?? currentHeadingId,
        });
        return;
      }

      const headingId = row.id || makeId("HD");
      currentHeadingId = headingId;
      const detailAttrs = row.attributes || {};
      const detailContent = row.content;
      expanded.push({
        ...row,
        id: headingId,
        attributes: {},
        content: undefined,
        order: typeof row.order === "number" ? row.order : index,
      });

      if (hasDetails(row)) {
        expanded.push({
          title: `${titleWithoutNumber(row.title) || "Section"} overview`,
          heading: false,
          parentId: headingId,
          order: 0,
          attributes: {
            ...(detailAttrs.Description ? { Description: detailAttrs.Description } : {}),
            ...(detailAttrs.Rationale ? { Rationale: detailAttrs.Rationale } : {}),
            ...Object.fromEntries(
              Object.entries(detailAttrs).filter(([key, value]) =>
                !["Description", "Rationale"].includes(key) && String(value || "").trim()
              )
            ),
          },
          content: detailContent,
          status: row.status,
        });
      }
    });

    return expanded;
  }

  function replaceModuleRowsAction({ folderId = activeFolderId, moduleRef, rows = [], mode = "replace" } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");

    setActiveFolderId(folderId);
    setSelectedModule(module.name);

    const normalizedRows = expandHeadingDetails(rows);
    const created = normalizedRows.map((row, index) => buildRequirementRow(row, module, folderId, index));
    updateRequirements((prev) => {
      const scopeMatch = (row) =>
        (row.folderId ?? row.projectId) === folderId &&
        (row.moduleId ? row.moduleId === module.id : row.module === module.name);

      const base = mode === "replace" ? prev.filter((row) => !scopeMatch(row)) : [...prev];
      validateModuleRows(created, base, folderId, module.id, module.name);
      return [...base, ...created];
    });

    return {
      module,
      rows: created,
    };
  }

  function appendModuleRowsAction({ folderId = activeFolderId, moduleRef, rows = [] } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const existing = requirements.filter(
      (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
    );
    const prepared = rows.map((row, index) => ({
      ...row,
      order: typeof row.order === "number" ? row.order : existing.length + index,
    }));
    return replaceModuleRowsAction({ folderId, moduleRef: module.id, rows: prepared, mode: "append" });
  }

  function findSectionRow(rows, sectionTitle, sectionId = "") {
    const id = String(sectionId || "").trim().toLowerCase();
    if (id) {
      const byId = rows.find((row) => String(row.id || "").toLowerCase() === id);
      if (byId) return byId;
    }
    const q = String(sectionTitle || "").trim().toLowerCase();
    if (!q) return null;
    return rows.find((row) =>
      row.heading &&
      String(row.title || "").trim().toLowerCase() === q
    ) || rows.find((row) =>
      row.heading &&
      String(row.title || "").toLowerCase().includes(q)
    ) || null;
  }

  function createSectionAction({ folderId = activeFolderId, moduleRef = selectedModule, title, parentSectionId = null, parentSectionTitle = "" } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const sectionTitle = String(title || "").trim();
    if (!sectionTitle) throw new Error("Section title is required.");

    let createdSection = null;
    updateRequirements((prev) => {
      const moduleScope = prev.filter(
        (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
      );
      const existing = findSectionRow(moduleScope, sectionTitle);
      if (existing) {
        createdSection = existing;
        return prev;
      }
      const parent = parentSectionId || parentSectionTitle
        ? findSectionRow(moduleScope, parentSectionTitle, parentSectionId)
        : null;
      createdSection = buildRequirementRow({
        title: sectionTitle,
        heading: true,
        parentId: parent?.id || null,
        order: nextOrderAmong(moduleScope, parent?.id || null),
      }, module, folderId, moduleScope.length);
      return [...prev, createdSection];
    });

    setActiveFolderId(folderId);
    setSelectedModule(module.name);
    return { module, section: createdSection, created: true };
  }

  function appendRowsToSectionAction({ folderId = activeFolderId, moduleRef = selectedModule, sectionTitle, sectionId = "", rows = [], createSection = true } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const incoming = Array.isArray(rows) ? rows : [];
    if (!incoming.length) return { module, section: null, rows: [], appended: 0 };

    let section = null;
    let createdSection = null;
    updateRequirements((prev) => {
      const moduleScope = prev.filter(
        (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
      );
      section = findSectionRow(moduleScope, sectionTitle, sectionId);
      const next = [...prev];
      if (!section && createSection && String(sectionTitle || "").trim()) {
        createdSection = buildRequirementRow({
          title: String(sectionTitle).trim(),
          heading: true,
          attributes: { Description: "Section created by Collaborator." },
          parentId: null,
          order: nextOrderAmong(moduleScope, null),
        }, module, folderId, moduleScope.length);
        section = createdSection;
        next.push(createdSection);
      }
      if (!section) throw new Error(`Section not found: ${sectionTitle}`);

      const latestScope = [...moduleScope, ...(createdSection ? [createdSection] : [])];
      const baseOrder = nextOrderAmong(latestScope, section.id);
      const prepared = incoming.map((row, index) => buildRequirementRow({
        ...row,
        heading: !!row.heading && row.heading !== "false",
        parentId: section.id,
        order: baseOrder + index,
      }, module, folderId, latestScope.length + index));
      return [...next, ...prepared];
    });

    setActiveFolderId(folderId);
    setSelectedModule(module.name);
    return { module, section, rows: incoming, appended: incoming.length };
  }

  function moveRowsToSectionAction({ folderId = activeFolderId, moduleRef = selectedModule, rowIds = [], query = "", sectionTitle, sectionId = "", createSection = true } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    let movedRows = [];
    let section = null;
    updateRequirements((prev) => {
      const moduleScope = prev.filter(
        (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
      );
      section = findSectionRow(moduleScope, sectionTitle, sectionId);
      const next = [...prev];
      if (!section && createSection && String(sectionTitle || "").trim()) {
        section = buildRequirementRow({
          title: String(sectionTitle).trim(),
          heading: true,
          parentId: null,
          order: nextOrderAmong(moduleScope, null),
        }, module, folderId, moduleScope.length);
        next.push(section);
      }
      if (!section) throw new Error(`Section not found: ${sectionTitle}`);
      const ids = new Set(Array.isArray(rowIds) ? rowIds.filter(Boolean) : []);
      const targets = ids.size
        ? moduleScope.filter((row) => ids.has(row.id))
        : findRowsByQuery(moduleScope, query);
      if (!targets.length) return next;
      const baseOrder = nextOrderAmong(moduleScope, section.id);
      movedRows = targets.map((row) => row.id);
      return next.map((row) => {
        const index = targets.findIndex((target) => target.id === row.id);
        if (index < 0) return row;
        return { ...row, parentId: section.id, order: baseOrder + index, updatedAt: nowISO() };
      });
    });
    setActiveFolderId(folderId);
    setSelectedModule(module.name);
    return { module, section, movedIds: movedRows, movedCount: movedRows.length };
  }

  function rewriteModuleRowsAction({ folderId = activeFolderId, moduleRef = selectedModule, rowIds = [], query = "", updates = [] } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const updateById = new Map((updates || []).filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
    let updatedCount = 0;
    updateRequirements((prev) => {
      const moduleScope = prev.filter(
        (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
      );
      const ids = new Set(Array.isArray(rowIds) ? rowIds.filter(Boolean) : []);
      const targets = ids.size
        ? moduleScope.filter((row) => ids.has(row.id))
        : findRowsByQuery(moduleScope, query);
      const targetIds = new Set(targets.map((row) => row.id));
      return prev.map((row) => {
        if (!targetIds.has(row.id)) return row;
        const patch = updateById.get(row.id) || updates[updatedCount] || {};
        updatedCount += 1;
        return {
          ...row,
          ...patch,
          id: row.id,
          heading: !!row.heading,
          attributes: row.heading ? {} : { ...(row.attributes || {}), ...(patch.attributes || {}) },
          updatedAt: nowISO(),
        };
      });
    });
    setActiveFolderId(folderId);
    setSelectedModule(module.name);
    return { module, updatedCount };
  }

  function collectDescendantIds(rows, rootIds) {
    const ids = new Set(rootIds);
    let changed = true;
    while (changed) {
      changed = false;
      rows.forEach((row) => {
        if (row.parentId && ids.has(row.parentId) && !ids.has(row.id)) {
          ids.add(row.id);
          changed = true;
        }
      });
    }
    return ids;
  }

  function deleteModuleRowsAction({ folderId = activeFolderId, moduleRef = selectedModule, rowIds = [], query = "", sectionTitle = "", sectionId = "", includeChildren = true } = {}) {
    const module = resolveModuleLocal(moduleRef, folderId);
    if (!module) throw new Error("Module not found.");
    const q = String(query || "").trim().toLowerCase();
    const ids = new Set(Array.isArray(rowIds) ? rowIds.filter(Boolean) : []);
    const existing = requirements.filter(
      (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
    );
    const section = findSectionRow(existing, sectionTitle, sectionId);
    const matched = existing.filter((row) =>
      ids.has(row.id) ||
      (section && row.id === section.id) ||
      (q && `${row.title || ""} ${row.attributes?.Description || ""} ${row.content || ""}`.toLowerCase().includes(q))
    );
    if (!matched.length) return { module, deletedIds: [], deletedCount: 0 };

    const deleteIds = includeChildren
      ? collectDescendantIds(existing, matched.map((row) => row.id))
      : new Set(matched.map((row) => row.id));
    updateRequirements((prev) =>
      prev
        .filter((row) => !deleteIds.has(row.id))
        .map((row) => ({
          ...row,
          links: (row.links || []).filter((link) => !deleteIds.has(link.toId) && !deleteIds.has(link.fromId)),
        }))
    );
    setActiveFolderId(folderId);
    setSelectedModule(module.name);
    return { module, deletedIds: Array.from(deleteIds), deletedCount: deleteIds.size };
  }

  function deleteRequirementAction(id) {
    onDelete(id);
    return { deletedId: id };
  }

  useEffect(() => {
    const provider = {
      createFolder: createFolderAction,
      createModule: createModuleAction,
      renameModule: renameModuleAction,
      openModule: openModuleAction,
      saveModule: saveModuleAction,
      replaceModuleRows: replaceModuleRowsAction,
      appendModuleRows: appendModuleRowsAction,
      createSection: createSectionAction,
      appendRowsToSection: appendRowsToSectionAction,
      moveRowsToSection: moveRowsToSectionAction,
      rewriteModuleRows: rewriteModuleRowsAction,
      deleteModuleRows: deleteModuleRowsAction,
      snapshotModule: snapshotModuleAction,
      restoreLastAgentSnapshot: restoreLastAgentSnapshotAction,
      validateModuleQuality: validateModuleQualityAction,
      saveRequirement: saveRequirement,
      deleteRequirement: deleteRequirementAction,
      listModuleRows: ({ folderId = activeFolderId, moduleRef } = {}) => {
        const module = resolveModuleLocal(moduleRef, folderId);
        if (!module) return [];
        return requirements.filter(
          (row) => (row.folderId ?? row.projectId) === folderId && (row.moduleId === module.id || row.module === module.name)
        );
      },
      resolveModule: ({ folderId = activeFolderId, moduleRef } = {}) => resolveModuleLocal(moduleRef, folderId),
      getState: () => ({
        activeFolderId,
        activeFolderName: activeFolder?.name || null,
        selectedModule,
        selectedModuleId: moduleByName[selectedModule]?.id || null,
        selectedRowId: selectedId || null,
        selectedRowIds: selectedIds?.size ? Array.from(selectedIds) : (selectedId ? [selectedId] : []),
        selectedRow: selectedReq || null,
        folderCount: folders.length,
        requirementCount: requirements.length,
        visibleModuleRowCount: moduleRows.length,
        visibleModuleRows: moduleRows.slice(0, 80),
        lastAgentSnapshot: readAgentSnapshots()[0] || null,
      }),
      clearSelection,
    };

    return registerActionProvider("requirements", provider);
  }, [activeFolderId, activeFolder?.name, folders.length, requirements, selectedModule, moduleByName, selectedId, selectedIds, selectedReq, moduleRows]);


  // ----------------------------- Reorder / Promote / Demote -----------------
  function moveUp(id){
    updateRequirements(prev => {
      const me = prev.find(r=>r.id===id); if (!me) return prev;
      const same = prev.filter(r=> (r.folderId??r.projectId)===me.folderId && r.module===me.module);
      const sibs = siblingsOf(same, id);
      const idx = sibs.findIndex(s=>s.id===id); if (idx<=0) return prev;
      const above = sibs[idx-1];
      const next = deepClone(prev);
      const a = next.find(r=>r.id===me.id); const b = next.find(r=>r.id===above.id);
      const t = a.order ?? 0; a.order = b.order ?? 0; b.order = t;
      return next;
    });
  }
  function moveDown(id){
    updateRequirements(prev => {
      const me = prev.find(r=>r.id===id); if (!me) return prev;
      const same = prev.filter(r=> (r.folderId??r.projectId)===me.folderId && r.module===me.module);
      const sibs = siblingsOf(same, id);
      const idx = sibs.findIndex(s=>s.id===id); if (idx<0 || idx>=sibs.length-1) return prev;
      const below = sibs[idx+1];
      const next = deepClone(prev);
      const a = next.find(r=>r.id===me.id); const b = next.find(r=>r.id===below.id);
      const t = a.order ?? 0; a.order = b.order ?? 0; b.order = t;
      return next;
    });
  }
  function promote(id){
    updateRequirements(prev => {
      const me = prev.find(r => r.id === id);
      if (!me || !me.parentId) return prev; // already at root or not found

      const parent = prev.find(r => r.id === me.parentId);
      if (!parent) return prev;

      const newParentId = parent.parentId ?? null;

      // Work on a clone
      const next = deepClone(prev);

      // Constrain to same folder/project + module (matches your original filter)
      const same = next.filter(
        r => (r.folderId ?? r.projectId) === me.folderId && r.module === me.module
      );

      // Locate live references in `next`
      const n = next.find(r => r.id === id);
      const p = next.find(r => r.id === parent.id);

      const oldParentId = me.parentId;
      const oldOrder = me.order ?? 0;
      const parentOrder = p?.order ?? 0;

      // 1) Close the gap in the old sibling group (children of oldParentId)
      for (const s of same) {
        if (s.parentId === oldParentId && s.id !== me.id && (s.order ?? 0) > oldOrder) {
          s.order = (s.order ?? 0) - 1;
        }
      }

      // 2) Make space in the new sibling group *after the parent*
      for (const s of same) {
        if (s.parentId === newParentId && (s.order ?? 0) > parentOrder) {
          s.order = (s.order ?? 0) + 1;
        }
      }

      // 3) Move the node right after the parent in the new level
      n.parentId = newParentId;
      n.order = parentOrder + 1;

      return next;
    });
  }
  function demote(id){
    updateRequirements(prev => {
      const me = prev.find(r=>r.id===id); if (!me) return prev;
      const same = prev.filter(r=> (r.folderId??r.projectId)===me.folderId && r.module===me.module);
      const sibs = siblingsOf(same, id);
      const idx = sibs.findIndex(s=>s.id===id); if (idx<=0) return prev;
      const newParent = sibs[idx-1];
      const next = deepClone(prev);
      const n = next.find(r=>r.id===id);
      n.parentId = newParent.id; n.order = nextOrderAmong(same, newParent.id);
      return next;
    });
  }

  function collectSubtree(rows, rootId) {
    const byId = new Map(rows.map(r => [r.id, r]));
    const children = new Map();
    for (const r of rows) {
      const pid = r.parentId ?? null;
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(r);
    }
    // keep stable hierarchical order
    for (const list of children.values()) {
      list.sort((a,b) => (a.order ?? 0) - (b.order ?? 0) || String(a.title||"").localeCompare(b.title||""));
    }

    const out = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      const node = byId.get(id);
      if (!node) continue;
      out.push(deepClone(node));
      const kids = children.get(id) || [];
      // push in reverse so the first child is processed first
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i].id);
    }
    return out;
  }


  function copySelection(withHierarchy = true) {
    const ids = selectedIds.size ? Array.from(selectedIds) : (selectedId ? [selectedId] : []);
    if (!ids.length) return;
    const rows = moduleRows;
    const roots = [];
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) continue;
      const chunk = withHierarchy ? collectSubtree(rows, id) : [deepClone(rows.find(r => r.id === id))].filter(Boolean);
      for (const r of chunk) seen.add(r.id);
      roots.push({ rootId: id, items: chunk });
    }
    setClipboard({ moduleName: selectedModule, roots, withHierarchy });
  }

  function cutSelection() {
    copySelection(true);
    const ids = selectedIds.size ? Array.from(selectedIds) : (selectedId ? [selectedId] : []);
    for (const id of ids) {
      onDelete?.(id);
    }
    clearSelection();
  }

  function pasteClipboard() {
    if (!clipboard || !clipboard.roots || !clipboard.roots.length) return;
    const targetParentId = selectedId || null;
    const idMap = new Map();

    updateRequirements(prev => {
      const next = deepClone(prev);
      for (const { items } of clipboard.roots) {
        // allocate new ids
        for (const src of items) {
          const nid = makeId();
          idMap.set(src.id, nid);
        }
        // emit copies
        for (const src of items) {
          const copy = deepClone(src);
          copy.id = idMap.get(src.id);
          copy.projectId = activeFolderId;
          copy.folderId = activeFolderId;
          copy.module = selectedModule;
          copy.moduleId = moduleByName[selectedModule]?.id || null;
          copy.parentId = src.parentId ? idMap.get(src.parentId) : targetParentId;
          copy.order = nextOrderAmong(
            next.filter(r => (r.folderId ?? r.projectId) === activeFolderId && r.module === selectedModule),
            copy.parentId ?? null
          );
          copy.version = 1;
          copy.history = [];
          copy.createdAt = nowISO();
          copy.updatedAt = nowISO();
          next.push(copy);
        }
      }
      return next;
    });
  }


  // ----------------------------- Import/Export/Baselines --------------------
  async function exportJSON(){
    const blob = new Blob([JSON.stringify(requirements,null,2)],{type:"application/json"});
    download(`requirements-${new Date().toISOString().slice(0,10)}.json`, blob);
  }
  async function exportCSV(){
    const csv = toCSV(requirements, activeFolderId, moduleByName);
    download(`requirements-${new Date().toISOString().slice(0,10)}.csv`, new Blob([csv],{type:"text/csv"}));
  }
  async function exportXLSX() {
    try {
      const XLSX = await loadXLSX();
      const rows = requirements.map(r => ({
        id: r.id, title: r.title, module: r.module, status: r.status, version: r.version,
        createdAt: r.createdAt, updatedAt: r.updatedAt, parentId: r.parentId, order: r.order,
        projectId: r.projectId || r.folderId || activeFolderId || "",
        folderId: r.folderId || r.projectId || activeFolderId || "",
        moduleId: r.moduleId || moduleByName[r.module]?.id || "",
        attributes_json: JSON.stringify(r.attributes || {}),
        links_json: JSON.stringify(r.links || []),
        content_json: JSON.stringify(r.content || null),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Requirements");
      const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      download(`requirements-${new Date().toISOString().slice(0, 10)}.xlsx`,
        new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    } catch (e) { toastOnce(e.message || "XLSX export failed"); }
  }

  async function handleConfirmAttributeMapping(mappings) {
    // mappings = [{ sourceCol, attrKey, type, required }, ...]
    setShowAttrMapper(false);

    if (!Array.isArray(mapperSummary2D) || mapperSummary2D.length < 2) return;
    const headers = mapperSummary2D[0].map(h => String(h || ""));
    const rows = mapperSummary2D.slice(1);
    const titleIdx = findPickedHeaderIndex(headers, mapperTitleCol);
    if (titleIdx < 0) { toastOnce("Title column not found anymore"); return; }

    // 1) Upsert module attribute definitions
    const modId = moduleByName[selectedModule]?.id || null;
    if (modId) {
      const defs = mappings.map(m => ({
        key: m.attrKey,
        label: m.attrKey,
        type: m.type,
        required: !!m.required,
      }));
      await upsertModuleAttributeDefinitions(modId, defs);
    }

    // 2) Build rows → requirements using title column + mapped attributes
    const colIndexByName = Object.fromEntries(headers.map((h, i) => [h, i]));
    const fresh = [];
    for (const row of rows) {
      const title = String(row[titleIdx] ?? "").trim();
      if (!title) continue;

      const attrs = {};
      for (const m of mappings) {
        const i = colIndexByName[m.sourceCol];
        if (typeof i === "number") {
          const raw = row[i];
          attrs[m.attrKey] = coerceToType(raw, m.type);
        }
      }

      fresh.push({
        id: makeId(),
        title,
        module: selectedModule,
        moduleId: modId,
        projectId: activeFolderId,
        folderId: activeFolderId,
        status: STATUSES[0],
        attributes: attrs,
        links: [],
        parentId: null,
        order: 0, // set later
        version: 1,
        history: [],
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
    }

    if (!fresh.length) {
      toastOnce("No rows to import after mapping");
      return;
    }

    // 3) De-dupe & stamp order
// 3) De-dupe (within this import AND vs existing) & stamp order
updateRequirements(prev => {
  // Only rows in the active folder + selected module
  const inScope = prev.filter(
    x => (x.folderId ?? x.projectId) === activeFolderId && x.module === selectedModule
  );

  // Existing titles already in this module (normalized)
  const existing = new Set(
    inScope.map(x => String(x.title || "").trim().toLowerCase())
  );

  // Track duplicates within the incoming 'fresh' list
  const seenFresh = new Set();

  // Start order at the next available index under the root (no parent)
  let order = nextOrderAmong(inScope, null);

  const next = prev.slice();

  for (const r of fresh) {
    const key = String(r.title || "").trim().toLowerCase();
    if (!key) continue;

    // Skip if this title already appeared earlier in the same import
    if (seenFresh.has(key)) continue;
    seenFresh.add(key);

    // Skip if a requirement with the same title already exists in this module
    if (existing.has(key)) continue;

    // Assign order and append
    next.push({ ...r, order });
    order += 1;

    // Mark as existing to prevent later duplicates in this same run
    existing.add(key);
  }

  return next;
});


    toastOnce(`Imported ${fresh.length} item(s) from '${mapperTitleCol}' into ${selectedModule}`);
  }

  async function onImportFile(file){
    if(!file) return; const name = file.name.toLowerCase();
    try{
      if(name.endsWith('.json')){ importRows(JSON.parse(await file.text())); }
      else if(name.endsWith('.csv')){ importRows(parseCSV(await file.text())); }
      else if(name.endsWith('.xlsx')||name.endsWith('.xls')){
        const XLSX = await loadXLSX(); const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf,{type:"array"}); const ws = wb.Sheets[wb.SheetNames[0]];
        importRows(XLSX.utils.sheet_to_json(ws,{defval:""}));
      } else throw new Error("Unsupported type. Use JSON/CSV/XLSX.");
    } catch(e){ toastOnce(e.message||"Import failed"); }
  }
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = splitCSVLine(lines[0]);
    return lines.slice(1).map(ln => {
      const cols = splitCSVLine(ln);
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] ?? "");
      if (obj.attributes_json) { try { obj.attributes = JSON.parse(obj.attributes_json); } catch {} }
      if (obj.links_json) { try { obj.links = JSON.parse(obj.links_json); } catch {} }
      if (obj.content_json) { try { obj.content = JSON.parse(obj.content_json); } catch {} }
      obj.version = Number(obj.version || 1);
      obj.order = Number(obj.order || 0);
      return obj;
    });
  }

  function importRows(rows) {
    if (!Array.isArray(rows)) throw new Error("Import expects an array");
    const existingIds = new Set(requirements.map(r => r.id));
    const idMap = new Map();

    const normalized = rows.map(raw => {
      const moduleName = String(raw.module ?? selectedModule);
      const modMeta = moduleByName[moduleName];

      const contentParsed =
        typeof raw.content === "string" ? safeParseJSON(raw.content) :
        raw.content ? raw.content :
        (typeof raw.content_json === "string" ? safeParseJSON(raw.content_json) : raw.content_json);

      const attrParsed =
        typeof raw.attributes === "string" ? safeParseJSON(raw.attributes) :
        raw.attributes ? raw.attributes :
        (typeof raw.attributes_json === "string" ? safeParseJSON(raw.attributes_json) : raw.attributes_json);

      const linksParsed =
        typeof raw.links === "string" ? safeParseJSON(raw.links) :
        Array.isArray(raw.links) ? raw.links :
        (typeof raw.links_json === "string" ? safeParseJSON(raw.links_json) : raw.links_json);

      const r = {
        id: String(raw.id || makeId()),
        title: String(raw.title ?? ""),
        module: moduleName,
        moduleId: raw.moduleId || modMeta?.id || null,
        projectId: raw.projectId || raw.folderId || activeFolderId || null,
        folderId: raw.folderId || raw.projectId || activeFolderId || null,
        status: String(raw.status ?? STATUSES[0]),
        version: Number(raw.version ?? 1),
        attributes: (attrParsed && typeof attrParsed === "object") ? attrParsed : {},
        links: Array.isArray(linksParsed) ? linksParsed : [],
        content: (contentParsed && typeof contentParsed === "object") ? contentParsed : null,
        parentId: raw.parentId ?? null,
        order: Number(raw.order ?? 0),
        createdAt: raw.createdAt || nowISO(),
        updatedAt: nowISO(),
        history: raw.history || [],
      };
      if (existingIds.has(r.id)) { const newId = makeId(); idMap.set(r.id, newId); r.id = newId; }
      return r;
    });

    for (const r of normalized) {
      r.links = (r.links || []).map(l => ({ type: l.type, toId: idMap.get(l.toId) || l.toId }));
    }

    updateRequirements(prev => [...prev, ...normalized]);
    toastOnce(`Imported ${normalized.length} requirements`);
  }


  // ----------------------------- Folder deletion (NEW) ----------------------
  function deleteFolder(folderId) {
    // Project-attached folders are no longer children of their original parent.
    const attached = new Set(artifactModules.flatMap(module => module.libraryFolderIds || []));
    const visibleFolders = folders.map(folder => attached.has(folder.id) ? { ...folder, parentId: null } : folder);
    if (artifactModules.length) {
      const descendants = new Set([folderId]);
      let changed = true;
      while (changed) { changed = false; for (const folder of visibleFolders) if (descendants.has(folder.parentId) && !descendants.has(folder.id)) { descendants.add(folder.id); changed = true; } }
      if (artifactModules.some(m => descendants.has(m.folderId))) { window.alert('Delete the engineering artifacts in this folder before deleting the folder.'); return; }
    }

    const fol = visibleFolders.find(f => f.id === folderId);
    if (!fol) return;

    const descendants = collectDescendantIds(visibleFolders, folderId);
    const hasChildren = descendants.size > 0;
    const hasReqs = hasRequirementsInScope(requirements, folderId, descendants);

    // If empty, remove immediately
    if (!hasChildren && !hasReqs) {
      const remainingFolders = folders.filter(f => f.id !== folderId);
      Folders.saveAll(remainingFolders);
      setFolders(remainingFolders);
      if (activeFolderId === folderId) {
        const fallback = remainingFolders.find(f => f.id === fol.parentId) || remainingFolders[0] || null;
        setActiveFolderId(fallback?.id || null);
      }
      return;
    }

    const choice = window.prompt(
      `Folder '${fol.name}' is not empty.\n` +
      `Type DELETE to remove this folder, all subfolders, and their requirements.\n` +
      (fol.parentId ? `Type MOVE to move contents to the parent folder, then delete this folder.\n` : "") +
      `Leave blank to cancel.`
    );
    if (!choice) return;

    if (choice.toUpperCase() === "DELETE") {
      const scopeIds = new Set([folderId, ...descendants]);

      // Remove folders in scope
      const remainingFolders = folders.filter(f => !scopeIds.has(f.id));
      Folders.saveAll(remainingFolders);
      setFolders(remainingFolders);

      // Remove requirements in scope
      updateRequirements(reqs => reqs.filter(r => !scopeIds.has(r.folderId ?? r.projectId)));

      // Remove baselines buckets in scope
      const baseMap = Baselines.loadMap();
      for (const id of scopeIds) delete baseMap[id];
      Baselines.saveMap(baseMap);

      // Fix active folder if it was deleted
      if (activeFolderId && scopeIds.has(activeFolderId)) {
        const fallback = remainingFolders.find(f => f.id === fol.parentId) || remainingFolders[0] || null;
        setActiveFolderId(fallback?.id || null);
      }

      toastOnce("Folder and contents deleted");
      return;
    }

    if (choice.toUpperCase() === "MOVE") {
      if (!fol.parentId || !folders.some(folder => folder.id === fol.parentId)) return;
      const parentId = fol.parentId;

      // Reparent direct children
      const movedFolders = folders.map(f => !attached.has(f.id) && f.parentId === folderId ? { ...f, parentId } : f);
      const remainingFolders = movedFolders.filter(f => f.id !== folderId);
      Folders.saveAll(remainingFolders);
      setFolders(remainingFolders);

      // Move direct requirements to parent
      updateRequirements(reqs =>
        reqs.map(r => {
          const fid = r.folderId ?? r.projectId;
          return fid === folderId ? { ...r, folderId: parentId, projectId: parentId } : r;
        })
      );

      // Move baselines bucket (merge into parent)
      const baseMap = Baselines.loadMap();
      if (baseMap[folderId]) {
        const parentKey = parentId;
        baseMap[parentKey] = { ...(baseMap[parentKey] || {}), ...(baseMap[folderId] || {}) };
        delete baseMap[folderId];
        Baselines.saveMap(baseMap);
      }

      if (activeFolderId === folderId) {
        const fallback = remainingFolders.find(f => f.id === parentId) || remainingFolders[0] || null;
        setActiveFolderId(fallback?.id || null);
      }
      toastOnce("Folder contents moved to parent and folder deleted");
    }
  }

  function moveModule(moduleId, fromFolderId, toFolderId) {
    if (!moduleId || !fromFolderId || !toFolderId || fromFolderId === toFolderId) return;

    // 1) Move the module definition between folders
    const all = Folders.loadAll();
    const sIdx = all.findIndex(f => f.id === fromFolderId);
    const dIdx = all.findIndex(f => f.id === toFolderId);
    if (sIdx < 0 || dIdx < 0) return;

    const src = all[sIdx];
    const dst = all[dIdx];

    const mod = (src.modules || []).find(m => m.id === moduleId);
    if (!mod) return;

    src.modules = (src.modules || []).filter(m => m.id !== moduleId);
    const modAlreadyInDst = (dst.modules || []).some(m => m.id === moduleId);
    if (!modAlreadyInDst) dst.modules = [ ...(dst.modules || []), mod ];

    Folders.saveAll(all);
    setFolders(Folders.loadAll());

    // 2) Move all requirements under that module from src → dst
    updateRequirements(prev => {
      const next = deepClone(prev);
      for (const r of next) {
        const fid = r.folderId ?? r.projectId;
        if (fid === fromFolderId && r.moduleId === moduleId) {
          r.folderId = toFolderId;
          r.projectId = toFolderId;
          // keep r.order as-is; numbering will recompute in new folder
        }
      }
      return next;
    });

    toastOnce?.(`Moved module '${mod.name}' to '${dst.name}'`);
  }

  async function moveFolder(folderId, newParentId, programId = null) {
    const src = folders.find(f => f.id === folderId);
    if (!src) return;                       // unknown source
    if (folderId === newParentId) return;   // no-op

    if (newParentId && !folders.some(f => f.id === newParentId)) return; // bad target

    // prevent cycles (can’t move into your own descendant)
    const descendants = collectDescendantIds(folders, folderId);
    if (newParentId && descendants.has(newParentId)) {
      toastOnce("Can't move a folder into its own descendant");
      return;
    }

    if (onMoveDesignFolder) await onMoveDesignFolder(folderId, programId, newParentId);
    if (programId) return;

    // no-op if parent is unchanged
    if ((src.parentId ?? null) === (newParentId ?? null)) return;

    const updated = folders.map(f =>
      f.id === folderId ? { ...f, parentId: newParentId || null } : f
    );
    Folders.saveAll(updated);
    setFolders(updated);
  }


  // Saved views
  function saveCurrentView(){
    const name = window.prompt("Save view as:"); if(!name) return;
    const view = { name, selectedModule, viewMode };
    setSavedViews(prev=>{ const next=[...prev.filter(v=>v.name!==name), view]; return next; }); toastOnce(`Saved view '${name}'`);
  }
  function applyView(v){
    setSelectedModule(v.selectedModule||selectedModule); setViewMode(v.viewMode||VIEW_MODES.OUTLINE);
  }
  function deleteView(name){ setSavedViews(prev=>prev.filter(v=>v.name!==name)); }

  // ----------------------------- UI -----------------------------------------
  const folderTree = useMemo(() => buildFolderTree(folders.map(folder => ({ ...folder,
    modules: [...(folder.modules || []), ...artifactModules.filter(m => m.folderId === folder.id)],
  }))), [folders, artifactModules]);
  const library = useMemo(() => designLibraryModel(folderTree), [folderTree]);
  const canEditLibraryItem = item => canEdit && currentRole !== 'Viewer' && (item.kind !== 'module' || canEditModule(item.name));
  const openLibraryItem = item => {
    clearSelection();
    if (item.kind === 'folder') {
      setActiveFolderId(item.id); setLibraryView('folder'); onSelectArtifact?.(null);
    } else {
      setActiveFolderId(item.folderId);
      if (item.externalArtifact) { setLibraryView('folder'); onSelectArtifact?.(item.id); }
      else { setLibraryView('module'); onSelectArtifact?.(null); setSelectedModule(item.name); }
    }
  };
  useEffect(() => {
    const reveal = event => {
      const { folderId, moduleName, objectId } = event.detail || {};
      if (!folderId) return;
      pendingSearchSelection.current = objectId ? { folderId, moduleName, objectId } : null;
      clearSelection(); setActiveFolderId(folderId);
      setLibraryView(moduleName ? 'module' : 'folder');
      if (moduleName) setSelectedModule(moduleName);
      if (objectId) { setViewMode('table'); setSelectedId(objectId); setSelectedIds(new Set([objectId])); }
      setSearchSelectionVersion(value => value + 1);
      setSidebarOpen(true);
    };
    window.addEventListener(DESIGN_SEARCH_REVEAL, reveal);
    return () => window.removeEventListener(DESIGN_SEARCH_REVEAL, reveal);
  }, []);
  useEffect(() => {
    if (!selectedId || activeArtifactId) return;
    const timer = setTimeout(() => {
      const node = [...document.querySelectorAll('.design-management-workspace [data-artifact-object-id]')].find(node => node.dataset.artifactObjectId === selectedId);
      if (node) { pendingSearchSelection.current = null; node.scrollIntoView?.({ block: 'center', inline: 'nearest' }); node.classList.add('xhandle-search-hit'); node.focus?.({ preventScroll: true }); }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedId, activeFolderId, selectedModule, libraryView, viewMode, activeArtifactId, searchSelectionVersion]);
  const commitLibraryChange = (nextFolders, nextRequirements, nextBaselines) => {
    const keys = [LS_PROJECTS, ...(nextRequirements ? [LS_KEY] : []), ...(nextBaselines ? [LS_BASELINES_V2] : [])];
    const previous = new Map(keys.map(key => [key, localStorage.getItem(key)]));
    try {
      Folders.saveAll(nextFolders);
      if (nextBaselines) Baselines.saveMap(nextBaselines);
      if (nextRequirements) updateRequirements(nextRequirements);
    } catch (error) {
      for (const [key, value] of previous) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      throw error;
    }
    setFolders(nextFolders);
  };
  const saveLibraryDetails = async (item, details) => {
    if (!canEditLibraryItem(item)) throw new Error('You do not have permission to edit this item.');
    const name = details.title.trim(), description = details.description.trim();
    if (!name || name.length > 200 || description.length > 4000) throw new Error('Enter a title of 1–200 characters and a description up to 4,000 characters.');
    if (item.externalArtifact) {
      if (!onUpdateArtifactDetails) throw new Error('Editing this artifact is unavailable in this view.');
      await onUpdateArtifactDetails(item, { title: name, description });
      return;
    }
    const current = Folders.loadAll();
    const folder = current.find(folder => folder.id === (item.kind === 'folder' ? item.id : item.folderId));
    if (!folder) throw new Error('This folder no longer exists.');
    if (item.kind === 'folder') {
      Folders.upsert({ ...folder, name, description, updatedAt: nowISO() });
    } else {
      const module = folder.modules?.find(module => module.id === item.id);
      if (!module) throw new Error('This module no longer exists.');
      if (folder.modules.some(module => module.id !== item.id && module.name.toLowerCase() === name.toLowerCase())) throw new Error('A module with that title already exists in this folder.');
      const nextRequirements = requirementsRef.current.map(row => (row.folderId ?? row.projectId) === folder.id && (row.moduleId === item.id || (!row.moduleId && row.module === module.name)) ? { ...row, module: name, updatedAt: nowISO() } : row);
      const updated = { ...folder, modules: folder.modules.map(module => module.id === item.id ? { ...module, name, description, updatedAt: nowISO() } : module) };
      commitLibraryChange(current.map(folder => folder.id === updated.id ? updated : folder), nextRequirements);
      if (activeFolderId === folder.id && selectedModule === module.name) setSelectedModule(name);
    }
    setFolders(Folders.loadAll());
  };
  const removeLibraryItem = async item => {
    if (!canEditLibraryItem(item)) throw new Error('You do not have permission to remove this item.');
    if (item.externalArtifact) {
      if (!onDeleteArtifact) throw new Error('Removing this artifact is unavailable in this view.');
      await onDeleteArtifact(item);
      return;
    }
    const current = Folders.loadAll();
    if (item.kind === 'folder') {
      if ((library.containers.get(`folder:${item.id}`) || []).length || requirementsRef.current.some(row => (row.folderId ?? row.projectId) === item.id)) throw new Error('Open this folder and remove its contents before removing the folder.');
      const baselines = Baselines.loadMap(); delete baselines[item.id];
      commitLibraryChange(current.filter(folder => folder.id !== item.id), null, baselines);
    } else {
      const folder = current.find(folder => folder.id === item.folderId);
      if (!folder) throw new Error('This folder no longer exists.');
      const module = folder.modules.find(module => module.id === item.id);
      if (!module) throw new Error('This module no longer exists.');
      const nextRequirements = requirementsRef.current.filter(row => !((row.folderId ?? row.projectId) === item.folderId && (row.moduleId === item.id || (!row.moduleId && row.module === module.name))));
      const baselines = Baselines.loadMap();
      if (baselines[item.folderId]) delete baselines[item.folderId][item.id];
      commitLibraryChange(current.map(folder => folder.id === item.folderId ? { ...folder, modules: folder.modules.filter(module => module.id !== item.id) } : folder), nextRequirements, baselines);
    }
    setFolders(Folders.loadAll());
  };

  return (
    <div className="design-split-workspace flex">
      {/* Sidebar: Folder Tree */}
      <div className={`design-library-pane shrink-0 border-r bg-white transition-all duration-200 ${sidebarOpen ? "w-72" : "w-10"}`}>


{/* Sidebar header */}
<div
  className={`flex items-center justify-between px-2 py-2 border-b ${isRootDrop ? "ring-2 ring-blue-400" : ""}`}
  onDragOver={(e) => {
    if (Array.from(e.dataTransfer.types).includes(DND_MIME_FOLDER)) {
      e.preventDefault();      // allow drop
      setIsRootDrop(true);     // highlight header
    }
  }}
  onDragLeave={() => setIsRootDrop(false)}
  onDrop={(e) => {
    e.preventDefault();
    setIsRootDrop(false);
    const srcId =
    e.dataTransfer.getData(DND_MIME_FOLDER) ||
      e.dataTransfer.getData("text/plain");
    if (srcId) moveFolder(srcId, null);   // Move to the top level
  }}
>
  <button
    className="rounded p-1 hover:bg-gray-100"
    title={sidebarOpen ? "Collapse" : "Expand"}
    onClick={() => setSidebarOpen(o => !o)}
    aria-label={sidebarOpen ? "Collapse design library sidebar" : "Expand design library sidebar"}
  >
    {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
  </button>

  {sidebarOpen && <div className="text-xs font-semibold text-gray-700">Design library</div>}


</div>


  {sidebarOpen && <div className="px-2 pt-3 pb-1"><button type="button" className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-100" onClick={() => { const name = window.prompt("New folder name:"); if (name?.trim()) createFolderAction({ name: name.trim(), parentId: null }); }}><Plus className="h-4 w-4" />New folder</button><p className="mt-1 text-center text-[11px] text-gray-500">Creates a top-level folder</p></div>}

  {/* Tree content */}
  <div className={`${sidebarOpen ? "design-library-scroll overflow-auto p-2" : "hidden"}`}>
    <DesignLibraryTree
      roots={folderTree}
      activeId={activeFolderId}
      onSelect={(id)=>{ clearSelection(); setActiveFolderId(id); setLibraryView('folder'); onSelectArtifact?.(null); }}
      onCreateChild={(parentId)=>{
        const name = window.prompt("Folder name:"); if(!name) return;
        createFolderAction({ name, parentId });
      }}
      onRenameFolder={(id) => {
        const folder = folders.find(folder => folder.id === id);
        const name = window.prompt("Folder name:", folder?.name || "");
        if (!folder || !name?.trim() || name.trim() === folder.name) return;
        const next = Folders.loadAll().map(folder => folder.id === id ? { ...folder, name: name.trim(), updatedAt: nowISO() } : folder);
        Folders.saveAll(next); setFolders(next);
      }}
      onDeleteFolder={(id) => deleteFolder(id)}
      onManageModules={(id)=>{ setModuleManagerFolderId(id); setShowModuleManager(true); }}
      onGenerateProject={onGenerateProject}
      onGenerateArtifact={onGenerateArtifact}
      selectedModule={activeArtifactId || (libraryView === 'module' ? selectedModule : null)}
      onSelectModule={(moduleName, module)=> { if (module?.externalArtifact) { setLibraryView('folder'); onSelectArtifact?.(module.id); } else { setLibraryView('module'); onSelectArtifact?.(null); setSelectedModule(moduleName); } }}
      onCreateModule={(folderId)=>{
        const name = window.prompt("Module name:", "Requirement");
        if (!name?.trim()) return;
        createModuleAction({ folderId, name: name.trim(), type: "Requirement" });
      }}
      onMoveFolder={(folderId, newParentId) => moveFolder(folderId, newParentId)}
      onMoveModule={moveModule}
      onMoveItem={async (item, destination) => {
        if (item.kind === 'folder') await moveFolder(item.id, destination.folderId, destination.programId);
        else if (item.kind === 'module') {
          moveModule(item.id, item.folderId, destination.folderId);
          if (activeFolderId === item.folderId && selectedModule === item.name) setActiveFolderId(destination.folderId);
        } else if (destination.programId) {
          if (!onMoveArtifact) throw new Error('Moving artifacts is unavailable in this view.');
          await onMoveArtifact(item.id, null, destination.programId);
        } else if (destination.folderId && destination.folderId !== item.folderId) {
          if (!onMoveArtifact) throw new Error('Moving artifacts is unavailable in this view.');
          await onMoveArtifact(item.id, destination.folderId);
        }
      }}
    />
  </div>
</div>


      {/* Main */}
      <div className="design-editor-pane flex-1 min-w-0 p-4">
{persistenceError && <p role="alert" className="p-3 bg-red-50 text-red-700">{persistenceError}</p>}
{activeArtifactId ? renderArtifact?.() : libraryView === 'folder' ? <DesignFolderContents key={activeFolderId || 'library'} folder={activeFolder} items={library.containers.get(activeFolderId ? `folder:${activeFolderId}` : 'library') || []} onOpen={openLibraryItem} onSaveDetails={saveLibraryDetails} onRemove={removeLibraryItem} canEditItem={canEditLibraryItem} /> : <div className="design-legacy-workspace">
{['outline', 'table'].includes(viewMode) && <MenuBar
  readOnly={!canEditModule(selectedModule)}
  /* selection + arrange */
  selectedReq={selectedReq}
  onNewChild={() => selectedReq ? onCreate(selectedReq.id) : onCreate(null)}
  onNewSibling={(id) => id && createSiblingFor(id)}   // ← NEW
  onNewParent={(id) => id && createParentFor(id)}     // ← NEW
  onEdit={(r) => r && onEdit(r)}
  onDelete={(id) => id && onDelete(id)}
  onMoveUp={(id) => id && moveUp(id)}
  onMoveDown={(id) => id && moveDown(id)}
  onPromote={(id) => id && promote(id)}
  onDemote={(id) => id && demote(id)}

  /* file & baseline */
  onImportFile={onImportFile}
  onOpenImportHazardModal={() => setShowImportModal(true)}
  onExportJSON={exportJSON}
  onExportCSV={exportCSV}
  onExportXLSX={exportXLSX}
  onSaveBaseline={saveBaseline}
  onRestoreBaseline={restoreBaseline}

  /* view */
  viewMode={viewMode}
  setViewMode={setViewMode}
  sidebarOpen={sidebarOpen}
  setSidebarOpen={setSidebarOpen}
  savedViews={savedViews}
  onApplyView={applyView}
  onSaveView={saveCurrentView}

  /* extras */
  onReuse={() => setShowReuse(true)}
  onOpenLinker={() => setShowLinker(true)}
/>}

<RowActionsBar
  disabled={!selectedReq || !canEditModule(selectedModule)}
  selection={selectedReq}
  numbering={numbering}
  onClear={clearSelection}
  onNewChild={() => selectedReq ? onCreate(selectedReq.id) : onCreate(null)}
  onEdit={() => selectedReq && onEdit(selectedReq)}
  onDelete={() => selectedReq && onDelete(selectedReq.id)}
  onMoveUp={() => selectedReq && moveUp(selectedReq.id)}
  onMoveDown={() => selectedReq && moveDown(selectedReq.id)}
  onPromote={() => selectedReq && promote(selectedReq.id)}
  onDemote={() => selectedReq && demote(selectedReq.id)}
  onHistory={() => selectedReq && setShowHistoryFor(selectedReq.id)}
  viewMode={viewMode}
  setViewMode={setViewMode}
  onSetContent={(content) => {
    if (!selectedReq) return;
    // only change the content; saveRequirement handles versioning, timestamps, etc.
    saveRequirement({ ...selectedReq, content });
  }}
/>



<div className="design-view-scroll" data-view={viewMode === VIEW_MODES.TABLE ? "table" : viewMode === VIEW_MODES.OUTLINE ? "outline" : "trace"} tabIndex={0} role="region" aria-label="Design module content">
{viewMode === VIEW_MODES.OUTLINE && (
  <OutlinePanel
    moduleName={selectedModule}
    rows={moduleRows}
    numbering={numbering}
    onCreateChild={onCreate}
    onEdit={onEdit}
    onDelete={onDelete}
    onMoveUp={moveUp}
    onMoveDown={moveDown}
    onPromote={promote}
    onDemote={demote}
    onShowHistory={(row) => setShowHistoryFor(row.id)}
    disabled={!canEditModule(selectedModule)}
    selectedId={selectedId}
    selectedIds={selectedIds}
    onSelect={(id, evt) => (evt?.shiftKey ? toggleSelect(id) : selectOne(id))}
    onInlineUpdate={(row, patch) => saveRequirement({ ...row, ...patch })}
  />
)}

{viewMode === VIEW_MODES.TABLE && (
  <TablePanel
    rows={tableRows}
    numbering={numbering}
    moduleName={selectedModule}
    attrColumns={attrColumns}
    onEdit={onEdit}
    onDelete={onDelete}
    onCreate={onCreate}
    canCreate={canEdit}
    onInlineUpdate={(row, patch) => saveRequirement({ ...row, ...patch })}
    onShowHistory={setShowHistoryFor}
    selectedId={selectedId}
    selectedIds={selectedIds}
    onSelect={(id, evt) => (evt?.shiftKey ? toggleSelect(id) : selectOne(id))}
  />
)}


{viewMode === VIEW_MODES.TRACE && (
  <TraceabilityView
    allRequirements={requirements}     // ← full set for cross-module lookups
    selectedModule={selectedModule}    // ← module picked in the sidebar
    activeFolderId={activeFolderId}    // ← active folder
    folderNameById={folderNameById}
  />
)}

</div>

{showForm && (
  <RequirementForm
    key={editing?.id}
    allModules={allModules}
    allCandidates={requirements}          // ← use ALL requirements, not folder-only
    folderNameById={folderNameById}       // ← pass folder name map
    draft={editing}
    onCancel={() => { setShowForm(false); setEditing(null); }}
    onSave={saveRequirement}
    moduleMetaByName={moduleByName}
  />
)}


        {showHistoryFor && (
          <HistoryModal requirement={requirements.find(r=>r.id===showHistoryFor)} onClose={() => setShowHistoryFor(null)} />
        )}

        {showReuse && activeFolder && (
          <ReuseModal
            projects={folders} // any folder can be a source
            activeProjectId={activeFolderId}
            onCancel={()=>setShowReuse(false)}
            onApply={({ sourceProjectId, sourceModuleId })=>{
              const srcRows = requirements.filter(r => (r.folderId??r.projectId)===sourceProjectId && r.moduleId===sourceModuleId);
              const idMap = new Map();
              const cloned = srcRows.map(r => {
                const nid = makeId();
                idMap.set(r.id, nid);
                return {
                  ...deepClone(r),
                  id: nid,
                  projectId: activeFolderId,
                  folderId: activeFolderId,
                  module: selectedModule,
                  moduleId: moduleByName[selectedModule]?.id || null,
                  parentId: null, // flatten on copy
                  order: r.order ?? 0,
                  version: 1,
                  history: [],
                  createdAt: nowISO(),
                  updatedAt: nowISO(),
                  attributes: { ...(r.attributes||{}), derived: "true", derivedFromFolder: sourceProjectId }
                };
              });
              for (const c of cloned) {
                c.links = (c.links||[]).map(l => ({ ...l, toId: idMap.get(l.toId) || l.toId }));
              }
              updateRequirements(prev => [...prev, ...cloned]);
            setShowReuse(false);
              toastOnce(`Copied ${cloned.length} items into ${selectedModule}`);
            }}
          />
        )}

        {showNewFolder && (
          <NewFolderModal
            parents={folders}
            onCancel={()=>setShowNewFolder(false)}
            onCreate={({ name, parentId })=>{
              const fol = { id: makeId("FOL"), parentId: parentId || null, name, modules: [], roles:{Owner:[],Editor:[],Viewer:[]} };
              Folders.upsert(fol);
              setFolders(Folders.loadAll());
              setActiveFolderId(fol.id);
              setShowNewFolder(false);
            }}
          />
        )}

{showImportModal && (
  <ImportFromHazardModal
    onCancel={() => setShowImportModal(false)}
    onImport={({ projectId, headerName }) => {
      setShowImportModal(false);
      importFromHazardAnalysis(projectId, headerName);
    }}
  />
)}

{/* NEW: Attribute mapper shown after Title is chosen */}
<HazardAttributeMapper
  open={showAttrMapper}
  onClose={() => setShowAttrMapper(false)}
  columns={mapperColumns}
  titleColumn={mapperTitleCol}
  sampleRow={Object.fromEntries(
    (mapperColumns || []).map((h, i) => [h, (mapperSummary2D?.[1] || [])[i]])
  )}
  onConfirm={handleConfirmAttributeMapping}
/>

{showLinker && (
  <LLMModuleLinkerModal
    modules={listModulesLocal()}                                                // ← use Local helper
    requirementsByModule={(moduleId) => listRequirementsByModuleLocal(moduleId)}// ← use Local helper
    onApplyLinks={async (links) => {
      for (const link of links) {
        await addTraceLinkLocal(link.parentId, link.childId, link.type);        // ← use Local helper
      }
      // optional: refresh state if you cache requirements elsewhere
    }}
    onClose={() => setShowLinker(false)}
  />
)}

{!!toast && (
  <div className="fixed bottom-4 left-1/2 …">{toast}</div>
)}
      </div>}
        {showModuleManager && moduleManagerFolder && (
          <ModuleManager
            project={moduleManagerFolder} // reusing same shape; this “project” is a folder
            onClose={()=>{ setShowModuleManager(false); setModuleManagerFolderId(null); }}
            onSave={(updated) => {
              const before = moduleManagerFolder?.modules || [];
              const after  = updated?.modules || [];
              const removed = before.filter(m => !after.some(mm => mm.id === m.id)); // [{id, name, ...}]

              if (removed.length) {
                const removedIds   = new Set(removed.map(m => m.id));
                const removedNames = new Set(removed.map(m => m.name));

                updateRequirements(prev => prev.filter(r => {
                  const fid = r.folderId ?? r.projectId;
                  return !(fid === moduleManagerFolder.id && removedIds.has(r.moduleId));
                }));

                const baseMap = Baselines.loadMap();
                if (baseMap?.[moduleManagerFolder.id]) {
                  for (const m of removed) {
                    if (baseMap[moduleManagerFolder.id][m.id]) {
                      delete baseMap[moduleManagerFolder.id][m.id];
                    }
                  }
                  Baselines.saveMap(baseMap);
                }

                if (removedNames.has(selectedModule) && activeFolderId === moduleManagerFolder.id) {
                  const fallback = after[0]?.name || "";
                  setSelectedModule(fallback);
                }

                toastOnce(`Deleted module(s): ${[...removedNames].join(", ")} and their requirements from this folder`);
              }

              const renamedById = new Map();
              for (const nextModule of after) {
                const prevModule = before.find((entry) => entry.id === nextModule.id);
                if (prevModule && prevModule.name !== nextModule.name) {
                  renamedById.set(nextModule.id, { from: prevModule.name, to: nextModule.name });
                }
              }

              Folders.upsert(updated);
              setFolders(Folders.loadAll());

              if (renamedById.size) {
                updateRequirements((prev) =>
                  prev.map((row) => {
                    if ((row.folderId ?? row.projectId) !== moduleManagerFolder.id) return row;
                    const rename = renamedById.get(row.moduleId);
                    return rename ? { ...row, module: rename.to, updatedAt: nowISO() } : row;
                  })
                );

                const currentRename = Array.from(renamedById.values()).find((entry) => entry.from === selectedModule);
                if (currentRename && activeFolderId === moduleManagerFolder.id) setSelectedModule(currentRename.to);
              }

              setShowModuleManager(false); setModuleManagerFolderId(null);
            }}

          />
        )}

      </div>
    </div>
  );
}

// ----------------------------- Header Bar -----------------------------------


function ViewsDropdown({ views, onApply, onDelete, moduleViewTemplates = [] }){
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={()=>setOpen(o=>!o)} className="px-3 py-2 text-sm hover:bg-gray-50">Views ▾</button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border bg-white shadow">
          {!views.length && !moduleViewTemplates.length && <div className="p-2 text-xs text-gray-500">No saved views</div>}

          {!!moduleViewTemplates.length && (
            <>
              <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-gray-500">Module presets</div>
              {moduleViewTemplates.map((v, i)=> (
                <div key={`mvt-${i}`} className="flex items-center justify-between px-2 py-1 text-sm hover:bg-gray-50">
                  <button onClick={()=>{ onApply({ name: v.name, selectedModule: undefined, viewMode: v.mode, sort: v.sort }); setOpen(false); }}>{v.name}</button>
                </div>
              ))}
              <div className="my-1 h-px bg-gray-200" />
            </>
          )}

          {views.map(v=> (
            <div key={v.name} className="flex items-center justify-between px-2 py-1 text-sm hover:bg-gray-50">
              <button onClick={()=>{ onApply(v); setOpen(false); }}>{v.name}</button>
              <button className="text-xs text-red-600" onClick={()=>onDelete(v.name)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



// ----------------------------- Outline Panel --------------------------------



// ----------------------------- Table Panel ----------------------------------



function Th({ label }){ return <th className="px-3 py-2 text-left font-medium">{label}</th>; }

function MultiSelect({ value = [], options = [], onChange }) {
    return (
      <select
        multiple
        className="w-full rounded border px-2 py-1 text-sm h-24"
        value={Array.isArray(value) ? value : []}
        onChange={(e) => {
          const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
          onChange(vals);
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }



// ----------------------------- Traceability View -----------------------------


// ----------------------------- Requirement Form -----------------------------
function RequirementForm({
    draft,
    onSave,
    onCancel,
    allModules,
    allCandidates,
    folderNameById,
    moduleMetaByName,   // ← NEW
  }) {

    const [form, setForm] = useState(() => deepClone(draft));
    const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const activeMeta = moduleMetaByName?.[form.module];
const template = useMemo(() => normalizeAttrTemplate(activeMeta?.attrTemplate), [activeMeta]);
const templateKeys = new Set((template || []).map(t => t.key).filter(Boolean));


    const attrPairs = useMemo(() => {
      const obj = form.attributes || {};
      const entries = Object.entries(obj);
      return entries.length ? entries : [["", ""]];
    }, [form.attributes]);

    function upsertAttribute(oldKey, newKey, newValue) {
        setForm(f => {
          const obj = { ...(f.attributes || {}) };
          if (oldKey && oldKey !== newKey) delete obj[oldKey];
          if (newKey) obj[newKey] = newValue;
          return { ...f, attributes: obj };
        });
      }
      function addAttributeRow() {
        setForm(f => ({ ...f, attributes: { ...(f.attributes || {}), "": "" } }));
      }
      function removeAttribute(key) {
        setForm(f => {
          const obj = { ...(f.attributes || {}) };
          delete obj[key];
          return { ...f, attributes: obj };
        });
      }


      function addLink() {
        // preselect the first linkable module (if any)
        const linkable = Array.from(
          new Set(
            (allCandidates || [])
              .filter(r => r.module && r.module !== form.module)
              .map(r => r.module)
          )
        ).sort();
        const defaultModule = linkable[0] || "";

        setForm(f => ({
          ...f,
          links: [ ...(f.links || []), { type: LINK_TYPES[0], toId: "", __module: defaultModule } ]
        }));
      }
    function updateLink(i, patch) {
      setForm(f => ({ ...f, links: (f.links || []).map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
    }
    function removeLink(i) {
      setForm(f => ({ ...f, links: (f.links || []).filter((_, idx) => idx !== i) }));
    }

    function submit() {
      const payload = deepClone(form);
      if (!payload.title?.trim()) return alert("Title is required");
      payload.updatedAt = nowISO();

      // strip UI-only helpers and drop empty links
      payload.links = (payload.links || [])
        .map(({ __module, ...l }) => l)
        .filter(l => l.toId && l.type);

      onSave(payload);
    }

    // GLOBAL link targets (every req except self)
    const candidateTargets = useMemo(() => {
      const list = (allCandidates || []).filter(r => r.id !== form.id);
      // sort by Folder, Module, Title for sanity
      return list.slice().sort((a, b) => {
        const fa = folderNameById?.[a.folderId ?? a.projectId] ?? "";
        const fb = folderNameById?.[b.folderId ?? b.projectId] ?? "";
        return (
          fa.localeCompare(fb) ||
          String(a.module || "").localeCompare(String(b.module || "")) ||
          String(a.title || "").localeCompare(String(b.title || ""))
        );
      });
    }, [allCandidates, form.id, folderNameById]);

    // List of modules you’re allowed to link to (exclude current module)
const linkableModules = useMemo(() => {
  const mods = new Set(
    (allCandidates || [])
      .filter(r => r.module && r.module !== form.module)
      .map(r => r.module)
  );
  return Array.from(mods).sort();
}, [allCandidates, form.module]);

// Per-link module picker (stored on the link object as __module for UI only)
function updateLinkModule(i, moduleName) {
  setForm(f => {
    const links = [...(f.links || [])];
    const cur = { ...(links[i] || {}) };
    cur.__module = moduleName || "";
    // clear selection if it doesn't belong to the chosen module
    if (moduleName && cur.toId) {
      const tgt = (allCandidates || []).find(r => r.id === cur.toId);
      if (!tgt || tgt.module !== moduleName) cur.toId = "";
    }
    links[i] = cur;
    return { ...f, links };
  });
}

    return (
      <Modal title={form.id ? `Edit Requirement` : `New Requirement`} onClose={onCancel}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Text">
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                value={form.title}
                onChange={e => setField("title", e.target.value)}
              />
            </Field>

            <Field label="Module (Group)">
  <datalist id="modules">{allModules.map(m => <option key={m} value={m} />)}</datalist>
  <input
    list="modules"
    className="w-full rounded border px-2 py-1 text-sm"
    value={form.module}
    onChange={(e) => {
      const v = e.target.value;
      setForm(f => ({ ...f, module: v, parentId: null }));
    }}
  />
</Field>


            <Field label="Status">
              <select
                className="w-full rounded border px-2 py-1 text-sm"
                value={form.status}
                onChange={e => setField("status", e.target.value)}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

  {/* --- Type (Heading/Text) --- */}
<div className="mt-3">
  <div className="text-xs font-semibold text-gray-600 mb-1">Type</div>
  <div className="flex items-center gap-4">
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="radio"
        name="req-type"
        value="text"
        checked={!form.heading}
        onChange={() => setField("heading", false)}
      />
      <span>Text</span>
    </label>
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="radio"
        name="req-type"
        value="heading"
        checked={!!form.heading}
        onChange={() => setField("heading", true)}
      />
      <span>Heading (bold)</span>
    </label>
  </div>
</div>

            {/* Keep hierarchy parent limited to same module */}
            <Field label="Parent (optional)">
              <select
                className="w-full rounded border px-2 py-1 text-sm"
                value={form.parentId ?? ""}
                onChange={e => setField("parentId", e.target.value || null)}
              >
                <option value="">— none —</option>
                {allCandidates
                  .filter(r => r.id !== form.id && r.module === form.module)
                  .map(r => <option key={r.id} value={r.id}>{r.title || r.id}</option>)
                }
              </select>
            </Field>
          </div>

          <div>
  <div className="mb-2 text-xs font-semibold text-gray-700">Attributes</div>

  {/* Typed fields from module template */}
  {!!template?.length && (
    <div className="space-y-2 mb-3">
     {template.map((t, idx) => (
  <div key={t.key || `__tmpl_${idx}`} className="grid grid-cols-[12rem,1fr] items-center gap-2">
          <div className="text-xs text-gray-600">{t.key || <em>(unnamed)</em>}</div>

          {t.type === "text" && (
            <input
              className="rounded border px-2 py-1 text-sm"
              value={form.attributes?.[t.key] ?? ""}
              onChange={(e) => setField("attributes", { ...(form.attributes || {}), [t.key]: e.target.value })}
            />
          )}

          {t.type === "number" && (
            <input
              type="number"
              className="rounded border px-2 py-1 text-sm"
              value={form.attributes?.[t.key] ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setField("attributes", { ...(form.attributes || {}), [t.key]: v === "" ? null : Number(v) });
              }}
            />
          )}

          {t.type === "date" && (
            <input
              type="date"
              className="rounded border px-2 py-1 text-sm"
              value={form.attributes?.[t.key] ?? ""}
              onChange={(e) => setField("attributes", { ...(form.attributes || {}), [t.key]: e.target.value })}
            />
          )}

          {t.type === "boolean" && (
            <div className="flex items-center gap-2">
              <input
                id={`bool-${t.key}`}
                type="checkbox"
                className="h-4 w-4"
                checked={!!form.attributes?.[t.key]}
                onChange={(e) => setField("attributes", { ...(form.attributes || {}), [t.key]: e.target.checked })}
              />
              <label htmlFor={`bool-${t.key}`} className="text-xs text-gray-600">Yes</label>
            </div>
          )}

          {t.type === "select" && (
            <select
              className="rounded border px-2 py-1 text-sm"
              value={(form.attributes?.[t.key] ?? "")}
              onChange={(e) => setField("attributes", { ...(form.attributes || {}), [t.key]: e.target.value })}
            >
              <option value="">—</option>
              {(t.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          )}

          {t.type === "multiselect" && (
            <MultiSelect
              value={Array.isArray(form.attributes?.[t.key]) ? form.attributes[t.key] : []}
              options={t.options || []}
              onChange={(vals) => setField("attributes", { ...(form.attributes || {}), [t.key]: vals })}
            />
          )}
        </div>
      ))}
    </div>
  )}

  {/* Freeform attributes (anything not in the template) */}
  <div className="space-y-2">
    {Object.entries(form.attributes || {})
      .filter(([k]) => !templateKeys.has(k))
      .map(([k, v]) => (
        <div key={k} className="grid grid-cols-[1fr,1fr,auto] items-center gap-2">
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="key"
            value={k}
            onChange={e => upsertAttribute(k, e.target.value, v)}
          />
          <StructuredAttributeInput label="Value" value={v} onChange={value => setField("attributes", { ...(form.attributes || {}), [k]: value })} />
          <button className="icon-btn" onClick={() => removeAttribute(k)} title="Remove">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

    <button className="mt-1 rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={addAttributeRow}>
      + Add attribute
    </button>
  </div>
</div>


          <div>
          <div>
  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-700">
    <Link2 className="h-3.5 w-3.5" /> Traceability Links
  </div>

  <div className="space-y-3">
    {(form.links || []).map((l, i) => {
      // compute chosen module for this row
      const selectedModule =
        l.__module ||
        (allCandidates.find(r => r.id === l.toId)?.module) ||
        "";

      // targets = all reqs (not self) in the chosen module, excluding this requirement’s module
      const targets = candidateTargets.filter(
        r => r.module === selectedModule && r.module !== form.module
      );

      const currentExists = l.toId && targets.some(r => r.id === l.toId);

      return (
        <div key={i} className="grid grid-cols-[10rem,12rem,1fr,auto] items-start gap-2">
          {/* link type */}
          <select
            className="rounded border px-2 py-1 text-sm"
            value={l.type}
            onChange={(e) => updateLink(i, { type: e.target.value })}
          >
            {LINK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* pick module first (exclude current module) */}
          <select
            className="rounded border px-2 py-1 text-sm"
            value={selectedModule}
            onChange={(e) => updateLinkModule(i, e.target.value)}
          >
            <option value="">Choose module…</option>
            {linkableModules.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
            {!!selectedModule && !linkableModules.includes(selectedModule) && (
              <option value={selectedModule} disabled>({selectedModule})</option>
            )}
          </select>

          {/* scrollable list of requirements for that module */}
          <div className="rounded border max-h-40 overflow-y-auto p-1">
            {!selectedModule ? (
              <div className="px-2 py-1 text-xs text-gray-500">
                Pick a module to see requirements.
              </div>
            ) : !targets.length ? (
              <div className="px-2 py-1 text-xs text-gray-500">
                No requirements in {selectedModule}.
              </div>
            ) : (
              <ul className="space-y-1">
                {targets.map(r => (
                  <li key={r.id}>
                    <label className="flex items-start gap-2 text-sm cursor-pointer px-2 py-1 rounded hover:bg-gray-50">
                      <input
                        type="radio"
                        name={`linkpick-${i}`}
                        className="mt-1"
                        checked={l.toId === r.id}
                        onChange={() => updateLink(i, { toId: r.id })}
                      />
                      <span className="leading-snug">
                        <span className="text-gray-500 text-xs">
                          [{folderNameById?.[r.folderId ?? r.projectId] ?? "—"} / {r.module}]
                        </span>{" "}
                        {r.title || r.id}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {!currentExists && l.toId && (
              <div className="mt-1 rounded border-t bg-amber-50 px-2 py-1 text-xs text-amber-700">
                Current selection isn’t in the chosen module.
              </div>
            )}
          </div>

          <button className="icon-btn" onClick={() => removeLink(i)} title="Remove">
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    })}

    <button
      className="mt-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
      onClick={addLink}
    >
      + Add link
    </button>
  </div>
</div>

          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onCancel}>Cancel</button>
            <button className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]" onClick={submit}>Save</button>
          </div>
        </div>
      </Modal>
    );
  }



// ----------------------------- History Modal --------------------------------
function HistoryModal({ requirement, onClose }){
  const hist = requirement?.history || [];
  return (
    <Modal title={`Change History — ${requirement?.title || requirement?.id}`} onClose={onClose}>
      {!hist.length ? (<div className="p-2 text-sm text-gray-500">No changes recorded yet.</div>) : (
        <ul className="space-y-3">{hist.slice().reverse().map((h,i)=>(
          <li key={i} className="rounded border p-3">
            <div className="mb-1 text-xs text-gray-600">Version {h.version} — {h.at?.replace("T"," ").slice(0,16)} {h.author ? `— ${h.author}` : ""}</div>
            <div className="text-sm">{h.change || "updated"}</div>
          </li>))}
        </ul>
      )}
    </Modal>
  );
}

// ----------------------------- Module / Reuse / New Folder Modals -----------
function ModuleManager({ project, onSave, onClose }) {
  const [draft, setDraft] = useState(deepClone(project));
  useEffect(() => {
    setDraft(p => ({
      ...p,
      modules: (p.modules || []).map(m => ({
        ...m,
        attrTemplate: normalizeAttrTemplate(m.attrTemplate),
      })),
    }));
  }, [project.id]);

  function addModule() { setDraft(p => ({ ...p, modules: [...(p.modules||[]), { id: makeId("MOD"), name: "New Module", type: "Requirement", attrTemplate: [], viewTemplates: [] }] })); }
  function updateModule(mid, patch) { setDraft(p => ({ ...p, modules: (p.modules||[]).map(m => m.id===mid?{...m, ...patch}:m) })); }
  function removeModule(mid) {
    if (!window.confirm("Remove this module from the folder?\n\nAll requirements in this folder that belong to it will be deleted when you click Save.")) return;
    setDraft(p => ({ ...p, modules: (p.modules || []).filter(m => m.id !== mid) }));
  }

  function addAttr(mid){ updateModule(mid, { attrTemplate: [ ...((draft.modules||[]).find(m=>m.id===mid)?.attrTemplate||[]), "" ] }); }
  function setAttr(mid, idx, v){ updateModule(mid, { attrTemplate: ((draft.modules||[]).find(m=>m.id===mid)?.attrTemplate||[]).map((a,i)=> i===idx?v:a) }); }
  function delAttr(mid, idx){ updateModule(mid, { attrTemplate: ((draft.modules||[]).find(m=>m.id===mid)?.attrTemplate||[]).filter((_,i)=>i!==idx) }); }

  function addView(mid){ const m = (draft.modules||[]).find(m=>m.id===mid); updateModule(mid, { viewTemplates: [...(m?.viewTemplates||[]), { name: "New View", mode: "table", columns: [], filters: {}, sort: { key:"updatedAt", dir:"desc" } }] }); }
  function setView(mid, idx, patch){ const m = (draft.modules||[]).find(m=>m.id===mid); const arr = (m?.viewTemplates||[]).map((v,i)=> i===idx?{...v, ...patch}:v); updateModule(mid, { viewTemplates: arr }); }
  function delView(mid, idx){ const m = (draft.modules||[]).find(m=>m.id===mid); updateModule(mid, { viewTemplates: (m?.viewTemplates||[]).filter((_,i)=>i!==idx) }); }

  return (
    <Modal title={`Manage Modules — ${project.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex justify-between"><div className="text-sm text-gray-600">Define modules, attribute templates & default views for this folder.</div><button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={addModule}>+ Add Module</button></div>
        <div className="space-y-4">
          {(draft.modules||[]).map(m => (
            <div key={m.id} className="rounded border p-3">
              <div className="flex items-center gap-2">
                <input className="rounded border px-2 py-1 text-sm" value={m.name} onChange={e=>updateModule(m.id,{name:e.target.value})}/>
                <select className="rounded border px-2 py-1 text-sm" value={m.type} onChange={e=>updateModule(m.id,{type:e.target.value})}>
                  {BASE_MODULES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                </select>
                <button className="ml-auto text-red-600 text-xs rounded border px-2 py-1 hover:bg-red-50" onClick={()=>removeModule(m.id)}>Delete</button>
              </div>

              <div className="mt-3">
  <div className="text-xs font-semibold text-gray-700 mb-1">Attribute Template</div>
  <div className="space-y-2">
    {(m.attrTemplate || []).map((a, idx) => (
      <div key={idx} className="grid grid-cols-[1fr,10rem,1fr,auto] items-center gap-2">
        {/* key */}
        <input
          className="rounded border px-2 py-1 text-sm"
          value={a.key}
          placeholder="attribute_key"
          onChange={(e) => {
            const v = e.target.value;
            setDraft(p => ({
              ...p,
              modules: p.modules.map(mm => mm.id === m.id ? {
                ...mm,
                attrTemplate: mm.attrTemplate.map((x,i)=> i===idx ? {...x, key: v } : x)
              } : mm)
            }));
          }}
        />
        {/* type */}
        <select
          className="rounded border px-2 py-1 text-sm"
          value={a.type}
          onChange={(e) => {
            const t = e.target.value;
            setDraft(p => ({
              ...p,
              modules: p.modules.map(mm => mm.id === m.id ? {
                ...mm,
                attrTemplate: mm.attrTemplate.map((x,i)=> i===idx ? {...x, type: t } : x)
              } : mm)
            }));
          }}
        >
          {ATTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {/* options (for select/multiselect) */}
        {(a.type === "select" || a.type === "multiselect") ? (
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="options,comma,separated"
            value={(a.options || []).join(",")}
            onChange={(e) => {
              const opts = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
              setDraft(p => ({
                ...p,
                modules: p.modules.map(mm => mm.id === m.id ? {
                  ...mm,
                  attrTemplate: mm.attrTemplate.map((x,i)=> i===idx ? {...x, options: opts } : x)
                } : mm)
              }));
            }}
          />
        ) : (
          <div className="text-xs text-gray-400">—</div>
        )}
        {/* remove */}
        <button
          className="icon-btn"
          title="Remove"
          onClick={() => setDraft(p => ({
            ...p,
            modules: p.modules.map(mm => mm.id === m.id ? {
              ...mm,
              attrTemplate: mm.attrTemplate.filter((_,i)=> i!==idx)
            } : mm)
          }))}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    ))}

    <button
      className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
      onClick={() => setDraft(p => ({
        ...p,
        modules: p.modules.map(mm => mm.id === m.id ? {
          ...mm,
          attrTemplate: [ ...(mm.attrTemplate || []), { key: "", type: "text", options: [] } ]
        } : mm)
      }))}
    >
      + Add attribute
    </button>
  </div>
</div>


              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-700 mb-1">Saved View Templates</div>
                <div className="space-y-2">
                  {(m.viewTemplates||[]).map((v,idx)=> (
                    <div key={idx} className="rounded border p-2">
                      <div className="flex items-center gap-2">
                        <input className="rounded border px-2 py-1 text-sm" value={v.name} onChange={e=>setView(m.id, idx, {name:e.target.value})}/>
                        <select className="rounded border px-2 py-1 text-sm" value={v.mode} onChange={e=>setView(m.id, idx, {mode:e.target.value})}>
                          <option value="outline">Outline</option>
                          <option value="table">Table</option>
                        </select>
                        <button className="ml-auto text-xs text-red-600 rounded border px-2 py-1 hover:bg-red-50" onClick={()=>delView(m.id, idx)}>Delete</button>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <Field label="Columns (CSV)"><input className="w-full rounded border px-2 py-1 text-sm" value={(v.columns||[]).join(",")} onChange={e=>setView(m.id, idx, {columns: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})}/></Field>
                        <Field label="Sort key"><input className="w-full rounded border px-2 py-1 text-sm" value={v.sort?.key||"updatedAt"} onChange={e=>setView(m.id, idx, {sort: {...(v.sort||{}), key:e.target.value}})}/></Field>
                        <Field label="Sort dir">
                          <select className="w-full rounded border px-2 py-1 text-sm" value={v.sort?.dir||"desc"} onChange={e=>setView(m.id, idx, {sort: {...(v.sort||{}), dir:e.target.value}})}>
                            <option value="asc">asc</option><option value="desc">desc</option>
                          </select>
                        </Field>
                      </div>
                    </div>
                  ))}
                  <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={()=>addView(m.id)}>+ Add view</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onClose}>Cancel</button>
          <button className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]" onClick={()=>onSave(draft)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
function ReuseModal({ projects, activeProjectId, onCancel, onApply }) {
  const other = projects.filter(p=>p.id!==activeProjectId);
  const [sourceProjectId, setSourceProjectId] = useState(other[0]?.id || "");
  const [sourceModuleId, setSourceModuleId] = useState("");
  const sourceProject = other.find(p => p.id === sourceProjectId);
  return (
    <Modal title="Duplicate Module" onClose={onCancel}>
      <div className="space-y-3">
        <Field label="From folder">
          <select className="w-full rounded border px-2 py-1 text-sm" value={sourceProjectId} onChange={e=>{ setSourceProjectId(e.target.value); setSourceModuleId(""); }}>
            {other.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="From module">
          <select className="w-full rounded border px-2 py-1 text-sm" value={sourceModuleId} onChange={e=>setSourceModuleId(e.target.value)} disabled={!sourceProject}>
            <option value="">— select —</option>
            {sourceProject?.modules?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onCancel}>Cancel</button>
          <button className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
            onClick={()=> onApply({ sourceProjectId, sourceModuleId })}
            disabled={!sourceProjectId || !sourceModuleId}
          >Copy</button>
        </div>
      </div>
    </Modal>
  );
}
function NewFolderModal({ parents, onCancel, onCreate }){
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  return (
    <Modal title="New Folder" onClose={onCancel}>
      <div className="space-y-3">
        <Field label="Name">
          <input className="w-full rounded border px-2 py-1 text-sm" value={name} onChange={e=>setName(e.target.value)} />
        </Field>
        <Field label="Parent (optional)">
          <select className="w-full rounded border px-2 py-1 text-sm" value={parentId} onChange={e=>setParentId(e.target.value)}>
            <option value="">— root —</option>
            {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onCancel}>Cancel</button>
          <button className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]" onClick={()=>{ if(!name.trim()) return; onCreate({ name: name.trim(), parentId: parentId || null }); }}>Create</button>
        </div>
      </div>
    </Modal>
  );
}

function ImportFromHazardModal({ onCancel, onImport }) {
    const projects = listLiteProjects();
    const activeLite = typeof window !== 'undefined' ? localStorage.getItem("xhandle.activeProjectId") : null;
    const initialProjectId = projects.find(p => p.id === activeLite)?.id || projects[0]?.id || "";
    const [projectId, setProjectId] = useState(initialProjectId);
    const [columns, setColumns] = useState([]);
    const [headerName, setHeaderName] = useState("");

    useEffect(() => {
        if (!projectId) { setColumns([]); setHeaderName(""); return; }
        const summary = getHazardSummary2DByProjectId(projectId);
const hdrs = Array.isArray(summary?.[0]) ? summary[0].map(h => String(h || "").trim()) : [];

// show ALL headers exactly as they appear
const opts = hdrs.filter(Boolean);

// keep current selection if still present, otherwise pick the first
setColumns(opts);
setHeaderName(prev => (opts.includes(prev) ? prev : (opts[0] || "")));
      }, [projectId]);

    return (
      <Modal title="Import from Hazard Analysis" onClose={onCancel}>
        <div className="space-y-4">
          <Field label="Project">
            <select
              className="w-full rounded border px-2 py-1 text-sm"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
            >
              {!projects.length && <option value="">(No Hazard Analysis projects found)</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          <Field label="Summary column">
            <select
              className="w-full rounded border px-2 py-1 text-sm"
              value={headerName}
              onChange={e => setHeaderName(e.target.value)}
              disabled={!columns.length}
            >
              {!columns.length && <option value="">(No Summary detected)</option>}
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <div className="flex justify-end gap-2">
            <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onCancel}>Cancel</button>
            <button
              className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
              disabled={!projectId || !headerName}
              onClick={() => onImport({ projectId, headerName })}
            >
              Import
            </button>
          </div>
        </div>
      </Modal>
    );
  }


// ----------------------------- Modal (shared) --------------------------------
