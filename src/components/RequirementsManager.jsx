/* eslint-disable react-hooks/exhaustive-deps */
/**
 * xHandle: requirements manager shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

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

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { logger } from "./utils/logger";
import {
    Boxes, Plus, Trash2, Edit3, History, Link2, X,
    ArrowUp, ArrowDown, IndentIncrease, IndentDecrease, Layers,
    Table as TableIcon, Folder as FolderIcon,
    FolderOpen, ChevronDown, ChevronRight, ChevronLeft, Image as ImageIcon, Grid3x3
  } from "lucide-react";
  
import HazardAttributeMapper from "./HazardAttributeMapper";
// ADD
import LLMModuleLinkerModal from "./modals/LLMModuleLinkerModal";
import {
  listRequirementsByFolder,
  updateRequirement
} from "./utils/requirementsStore";
import { FolderPlus } from "lucide-react";



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
const LS_FOLDER_OPEN = "xhandle:folder-open";
const LS_SIDEBAR_OPEN = "xhandle:sidebar-open";
const ATTR_TYPES = ["text", "number", "select", "multiselect", "date", "boolean"];
// Drag & Drop MIME types
const DND_MIME_FOLDER = "application/x-xhandle-folder";   // you already have this
const DND_MIME_MODULE = "application/x-xhandle-module";   // ← NEW
// ───────────────── Module Attribute Schema (per moduleId) ─────────────────
const LS_MODULE_SCHEMAS = "xhandle:module-schemas";

/**
 * loadAllModuleSchemas renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function loadAllModuleSchemas() {
  try { return JSON.parse(localStorage.getItem(LS_MODULE_SCHEMAS) || "[]"); }
  catch { return []; }
}
/**
 * saveAllModuleSchemas renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param all Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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
/**
 * dedupeByKey renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param list Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function dedupeByKey(list) {
  const m = new Map();
  for (const d of (list || [])) m.set(d.key, d);
  return Array.from(m.values());
}

/**
 * normalizeAttrTemplate renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param raw Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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

/**
 * defaultForType renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param t Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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

/**
 * coerceToType renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param val Input consumed by this step of the xHandle workflow.
 * @param type Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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
/**
 * nowISO renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const nowISO = () => new Date().toISOString();
/**
 * deepClone renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param o Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const deepClone = (o) => JSON.parse(JSON.stringify(o));

/**
 * escapeCSV renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function escapeCSV(s) {
  const str = String(s ?? "");
  if (/[",]/.test(str)) return '"' + str.replaceAll('"', '""') + '"';
  return str;
}
/**
 * splitCSVLine renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param line Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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
const LITE_PROJECT_DATA_KEY = "xhandle.projectData";


/** List all Lite projects available in localStorage for Hazard Analysis */
function safeParseJSON(s) {
    try { return JSON.parse(s); } catch { return undefined; }
  }
  
/**
 * probeProjectNameById renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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

/**
 * normalizeHeaderLabel renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  function normalizeHeaderLabel(s) {
    return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  
  

// ---- File helpers
function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
/**
 * loadXLSX renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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

/**
 * pruneForStorage renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param rows Worksheet or table rows that this step transforms.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function pruneForStorage(rows) {
  return (rows || []).map(r => {
    const out = { ...r };

    // Trim very large image data URLs (we keep the name as a placeholder)
    if (out?.content?.type === "image" && out.content.image?.dataUrl) {
      const du = out.content.image.dataUrl;
      if (du.length > 50_000) {
        out.content = {
          ...out.content,
          image: { ...out.content.image, dataUrl: "__omitted__" },
        };
      }
    }

    // Cap history length
    if (Array.isArray(out.history) && out.history.length > MAX_HISTORY_ENTRIES) {
      out.history = out.history.slice(-MAX_HISTORY_ENTRIES);
    }

    return out;
  });
}

const Storage = {
  async load() { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); },
  async save(rows) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(rows));
    } catch (e1) {
      try {
        // Retry with a pruned copy
        const pruned = pruneForStorage(rows);
        localStorage.setItem(LS_KEY, JSON.stringify(pruned));
        logger.warn("[xhandle] localStorage full; saved pruned requirements");
      } catch (e2) {
        try {
          // Last-resort: sessionStorage (will be lost on tab close)
          const pruned = pruneForStorage(rows);
          sessionStorage.setItem(LS_KEY, JSON.stringify(pruned));
          logger.warn("[xhandle] fell back to sessionStorage for requirements");
        } catch (e3) {
          logger.error("[xhandle] failed to persist requirements:", e3);
        }
      }
    }
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

// Migration: ensure at least one root folder and add parentId if missing
async function migrateIfNeeded() {
  const folders = Folders.loadAll();
  if (!folders.length) {
    // Build defaults from any legacy rows
    const rows = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    const moduleNames = [...new Set(rows.map(r => r.module).filter(Boolean))];
    const modules = moduleNames.map(m => ({
      id: makeId("MOD"),
      name: m,
      type: BASE_MODULES.includes(m) ? m : "Requirement",
      attrTemplate: [],
      viewTemplates: []
    }));
    const root = {
      id: makeId("FOL"),
      parentId: null,
      name: "Root",
      modules,
      roles: { Owner: [], Editor: [], Viewer: [] }
    };
    const tagged = rows.map(r => ({ ...r, projectId: root.id,
      folderId: root.id,
      moduleId: modules.find(mm => mm.name === r.module)?.id || null
    }));
    Folders.saveAll([root]);
    Folders.setActive(root.id);
    localStorage.setItem(LS_KEY, JSON.stringify(tagged));
    return;
  }
  // Add parentId if missing
  let mutated = false;
  const fixed = folders.map(f => {
    if (typeof f.parentId === "undefined") { mutated = true; return { ...f, parentId: null }; }
    return f;
  });
  if (mutated) Folders.saveAll(fixed);
}

// ----------------------------- Tree Utilities -------------------------------
function buildIndex(rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const children = new Map();
  for (const r of rows) {
    const p = r.parentId || null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(r);
  }
  for (const list of children.values()) list.sort((a,b)=> (a.order??0)-(b.order??0) || (a.title||'').localeCompare(b.title||''));
  return { byId, children };
}
/**
 * computeNumbering renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param moduleRows Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function computeNumbering(moduleRows) {
  const { children } = buildIndex(moduleRows);
  const res = new Map();
  function dfs(parentId, prefix=[]) {
    const list = children.get(parentId||null) || [];
    list.forEach((node, idx) => {
      const num = [...prefix, idx+1];
      res.set(node.id, num.join('.'));
      dfs(node.id, num);
    });
  }
  dfs(null, []);
  return res;
}
/**
 * siblingsOf renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param rows Worksheet or table rows that this step transforms.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function siblingsOf(rows, id) {
  const { byId, children } = buildIndex(rows);
  const me = byId.get(id); if (!me) return [];
  const list = children.get(me.parentId||null) || [];
  return list;
}
/**
 * nextOrderAmong renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param rows Worksheet or table rows that this step transforms.
 * @param parentId Parent identifier used to maintain tree structure.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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
/**
 * hasRequirementsInScope renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param requirements Requirement records participating in this step.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @param descendantIds Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function hasRequirementsInScope(requirements, folderId, descendantIds) {
  const inScope = new Set([folderId, ...descendantIds]);
  return requirements.some(r => inScope.has(r.folderId ?? r.projectId));
}

/**
 * MenuBar renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param selectedReq Input consumed by this step of the xHandle workflow.
 * @param onNewSibling Callback used to notify the surrounding workflow about progress or user actions.
 * @param onNewChild Callback used to notify the surrounding workflow about progress or user actions.
 * @param onEdit Callback used to notify the surrounding workflow about progress or user actions.
 * @param onDelete Callback used to notify the surrounding workflow about progress or user actions.
 * @param onNewParent Callback used to notify the surrounding workflow about progress or user actions.
 * @param onMoveUp Callback used to notify the surrounding workflow about progress or user actions.
 * @param onMoveDown Callback used to notify the surrounding workflow about progress or user actions.
 * @param onPromote Callback used to notify the surrounding workflow about progress or user actions.
 * @param onDemote Callback used to notify the surrounding workflow about progress or user actions.
 * @param onImportFile Callback used to notify the surrounding workflow about progress or user actions.
 * @param onOpenImportHazardModal Callback used to notify the surrounding workflow about progress or user actions.
 * @param onExportJSON Callback used to notify the surrounding workflow about progress or user actions.
 * @param onExportCSV Callback used to notify the surrounding workflow about progress or user actions.
 * @param onExportXLSX Callback used to notify the surrounding workflow about progress or user actions.
 * @param onSaveBaseline Callback used to notify the surrounding workflow about progress or user actions.
 * @param onRestoreBaseline Callback used to notify the surrounding workflow about progress or user actions.
 * @param viewMode Input consumed by this step of the xHandle workflow.
 * @param setViewMode React state setter supplied by the parent workflow.
 * @param sidebarOpen Input consumed by this step of the xHandle workflow.
 * @param setSidebarOpen React state setter supplied by the parent workflow.
 * @param savedViews Input consumed by this step of the xHandle workflow.
 * @param onApplyView Callback used to notify the surrounding workflow about progress or user actions.
 * @param onSaveView Callback used to notify the surrounding workflow about progress or user actions.
 * @param onReuse Callback used to notify the surrounding workflow about progress or user actions.
 * @param onManageModulesClick Callback used to notify the surrounding workflow about progress or user actions.
 * @param onOpenLinker Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function MenuBar({
    // selection + actions
    selectedReq, onNewSibling,
    onNewChild, onEdit, onDelete, onNewParent,
    onMoveUp, onMoveDown, onPromote, onDemote,
  
    // file ops
    onImportFile, onOpenImportHazardModal,
    onExportJSON, onExportCSV, onExportXLSX,
    onSaveBaseline, onRestoreBaseline,
  
    // view ops
    viewMode, setViewMode,
    sidebarOpen, setSidebarOpen,
    savedViews = [], onApplyView, onSaveView,
  
    // extras
    onReuse, onManageModulesClick, // pass if you still want access via menu
    onOpenLinker,
  }) {
    const [open, setOpen] = React.useState(null); // "File" | "Edit" | ...
    const fileRef = React.useRef();
    const hasSel = !!selectedReq;
  
    React.useEffect(() => {
      function onDocClick(e) {
        // close menus if clicking outside
        if (!(e.target.closest && e.target.closest('[data-menubar]'))) setOpen(null);
      }
      document.addEventListener('click', onDocClick);
      return () => document.removeEventListener('click', onDocClick);
    }, []);
  
    const Btn = ({label}) => (
      <button
        className={`px-3 py-1.5 text-sm hover:bg-gray-100 rounded ${open===label?'bg-gray-100':''}`}
        onClick={(e)=>{ e.stopPropagation(); setOpen(m => m===label ? null : label); }}
      >{label}</button>
    );
  
    const Item = ({children, onClick, disabled}) => (
      <button
        className={`flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50 ${disabled?'opacity-40 cursor-not-allowed':''}`}
        onClick={(e)=>{ e.stopPropagation(); if(!disabled) { setOpen(null); onClick?.(); } }}
        disabled={disabled}
        role="menuitem"
      >{children}</button>
    );
  
    const Divider = () => <div className="my-1 h-px bg-gray-200" />;
  
    return (
      <div className="mb-2" data-menubar>
        <div className="flex gap-1 text-gray-800">
          <Btn label="File" />
          <Btn label="Edit" />
          <Btn label="View" />
          <Btn label="Arrange" />
          <Btn label="Extras" />
          <Btn label="Help" />
        </div>
  
        {/* Hidden file input for Import… */}
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,.xlsx,.xls"
          className="hidden"
          onChange={(e)=>{ onImportFile?.(e.target.files?.[0]); e.target.value=""; }}
        />
  
        {/* Menus */}
        {open && (
          <div className="relative">
            <div className="absolute z-50 mt-1 min-w-[220px] rounded-md border bg-white shadow">
              {open === "File" && (
                <div role="menu" aria-label="File">
                  <Item onClick={onOpenImportHazardModal}>Import from Hazard Analysis…</Item>
                  <Item onClick={()=>fileRef.current?.click()}>Import…</Item>
                  <Item onClick={onOpenLinker}>Link Modules (AI)</Item>
                  <Divider />
                  <Item onClick={onExportJSON}>Export as JSON</Item>
                  <Item onClick={onExportCSV}>Export as CSV</Item>
                  <Item onClick={onExportXLSX}>Export as Excel</Item>
                  <Divider />
                  <Item onClick={onSaveBaseline}>Save Baseline…</Item>
                  <Item onClick={onRestoreBaseline}>Restore Baseline…</Item>
                </div>
              )}
  
  {open === "Edit" && (
  <div role="menu" aria-label="Edit">
    <Item onClick={() => onNewChild?.()} disabled={!onNewChild}>New Child</Item>
    <Item onClick={() => onNewSibling?.(selectedReq?.id)} disabled={!hasSel || !onNewSibling}>
      New at Same Level
    </Item>
    <Item onClick={() => onNewParent?.(selectedReq?.id)} disabled={!hasSel || !onNewParent}>
      New Parent
    </Item>
    <Item onClick={() => onEdit?.(selectedReq)} disabled={!hasSel}>Edit Selected</Item>
    <Item onClick={() => onDelete?.(selectedReq?.id)} disabled={!hasSel}>Delete Selected</Item>
  </div>
)}


  
              {open === "View" && (
                <div role="menu" aria-label="View">
                  <Item onClick={()=>setViewMode("outline")}>{viewMode==="outline" ? "✓ " : ""}Outline</Item>
                  <Item onClick={()=>setViewMode("table")}>{viewMode==="table" ? "✓ " : ""}Table</Item>
                  <Item onClick={()=>setSidebarOpen(s=>!s)}>
                    {sidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
                  </Item>
                  <Divider />
                  <Item onClick={onSaveView}>Save Current View…</Item>
                  {!savedViews.length && <div className="px-3 py-1.5 text-xs text-gray-500">No saved views</div>}
                  {savedViews.map(v=>(
                    <Item key={v.name} onClick={()=>onApplyView?.(v)}>{v.name}</Item>
                  ))}
                </div>
              )}
  
              {open === "Arrange" && (
                <div role="menu" aria-label="Arrange">
                  <Item onClick={()=>onMoveUp?.(selectedReq?.id)} disabled={!hasSel}>Move Up</Item>
                  <Item onClick={()=>onMoveDown?.(selectedReq?.id)} disabled={!hasSel}>Move Down</Item>
                  <Item onClick={()=>onPromote?.(selectedReq?.id)} disabled={!hasSel}>Promote</Item>
                  <Item onClick={()=>onDemote?.(selectedReq?.id)} disabled={!hasSel}>Demote</Item>
                </div>
              )}
  
              {open === "Extras" && (
                <div role="menu" aria-label="Extras">
                  <Item onClick={onReuse}>Duplicate Module</Item>
                  {!!onManageModulesClick && <Item onClick={onManageModulesClick}>Manage Modules…</Item>}
                </div>
              )}
  
              {open === "Help" && (
                <div role="menu" aria-label="Help">
                  <div className="px-3 py-1.5 text-sm text-gray-700">
                    Double-click a title to edit. Use the menu for imports, exports, and baselines.
                  </div>
                </div>
              )}
              
            </div>
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
}) {
  useEffect(() => { migrateIfNeeded(); }, []);

  // --- folders & selection
  const [folders, setFolders] = useState(Folders.loadAll());
  const [activeFolderId, setActiveFolderId] = useState(Folders.activeId());
  useEffect(() => { setFolders(Folders.loadAll()); setActiveFolderId(Folders.activeId()); }, []);
  useEffect(() => { Folders.setActive(activeFolderId); }, [activeFolderId]);

  const activeFolder = useMemo(() => folders.find(p => p.id === activeFolderId) || null, [folders, activeFolderId]);
  const moduleMetas = useMemo(() => activeFolder?.modules || [], [activeFolder]);
  const moduleByName = useMemo(() => Object.fromEntries(moduleMetas.map(m => [m.name, m])), [moduleMetas]);
  // --- requirements: must be declared before helpers that use it
const [requirements, setRequirements] = useState([]);
const updateRequirements = (apply) => {
  setRequirements((prev) => {
    const prevCopy = deepClone(prev);
    const next = typeof apply === "function" ? apply(prevCopy) : apply;
    Storage.save(next); // persist on every write
    return next;
  });
};



useEffect(() => { (async ()=> setRequirements(await Storage.load()))(); }, []);

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

    // Declared on the folder (module manager / agent creates)
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
      logger.warn("Persisting link/backlink failed:", e);
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

  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterModule, setFilterModule] = useState("all");
  const [sortKey, setSortKey] = useState("numbering");
const [sortDir, setSortDir] = useState("asc");


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

const handleAgentApplyRef = useRef(null);
const saveRequirementRef = useRef(null);
const promoteRef = useRef(null);
const demoteRef = useRef(null);
const copySelectionRef = useRef(null);
const cutSelectionRef = useRef(null);
const pasteClipboardRef = useRef(null);

useEffect(() => {
  const onAgentApply = (e) => {
    const { actions = [] } = e.detail || {};
    handleAgentApplyRef.current?.(actions);
  };

  // primary + a couple of safe fallbacks
  window.addEventListener("xhandle:agent-apply", onAgentApply);
  window.addEventListener("agent-apply", onAgentApply);
  window.addEventListener("xhandle:agent.apply", onAgentApply);

  return () => {
    window.removeEventListener("xhandle:agent-apply", onAgentApply);
    window.removeEventListener("agent-apply", onAgentApply);
    window.removeEventListener("xhandle:agent.apply", onAgentApply);
  };
}, []);


async function handleAgentApply(actions) {
  const list = Array.isArray(actions) ? actions : [];

  // helper: live map of moduleName -> moduleId for the ACTIVE folder
  function buildModuleIdByName(folderId) {
    const all = Folders.loadAll();
    const folder = all.find(f => f.id === folderId);
    const map = {};
    for (const m of (folder?.modules || [])) map[m.name] = m.id;
    return map;
  }

  let moduleIdByName = buildModuleIdByName(activeFolderId);

  // 1) Always create modules first so they exist for downstream actions
  for (const a of list) {
    if (a.type !== "CREATE_MODULE") continue;

    const { name, type = "Requirement", attrTemplate = [], viewTemplates = [] } = a.payload || {};
    if (!name?.trim()) continue;

    const all = Folders.loadAll();
    const folder = all.find(f => f.id === activeFolderId);
    if (!folder) continue;

    const exists = (folder.modules || []).some(m => m.name === name.trim());
    if (exists) {
      // update local map even if it already existed
      const hit = (folder.modules || []).find(m => m.name === name.trim());
      if (hit) moduleIdByName[name.trim()] = hit.id;
      continue;
    }

    const mod = {
      id: makeId("MOD"),
      name: name.trim(),
      type,
      attrTemplate: normalizeAttrTemplate(attrTemplate),
      viewTemplates: Array.isArray(viewTemplates) ? viewTemplates : []
    };

    const updatedFolder = { ...folder, modules: [ ...(folder.modules || []), mod ] };
    Folders.upsert(updatedFolder);

    // refresh UI + map immediately
    setFolders(Folders.loadAll());
    setSelectedModule(mod.name);
    moduleIdByName[mod.name] = mod.id;

    await upsertModuleAttributeDefinitions(mod.id, mod.attrTemplate);
  }

  // 2) Handle the rest (requirements, updates, links, etc.)
  for (const a of list) {
    try {
      switch (a.type) {
        case "CREATE_REQUIREMENT": {
          const { title, module, attributes = {} } = a.payload || {};
          if (!title || !module) break;

          // use the FRESH moduleId if we just created the module above
          const modId = moduleIdByName[module] || null;

          const draft = {
            id: makeId(),
            title,
            module,
            moduleId: modId,
            projectId: activeFolderId,
            folderId: activeFolderId,
            status: "Proposed",
            heading: false,
            attributes,
            links: [],
            parentId: null,
            order: nextOrderAmong(
              requirements.filter(r => (r.folderId ?? r.projectId) === activeFolderId && r.module === module),
              null
            ),
            version: 1,
            history: [],
            createdAt: nowISO(),
            updatedAt: nowISO(),
          };
          saveRequirement(draft);
          break;
        }

        case "UPDATE_REQUIREMENT": {
          const { id, patch = {} } = a.payload || {};
          const row = requirements.find(r => r.id === id);
          if (row) saveRequirement({ ...row, ...patch });
          break;
        }

        case "CREATE_TRACE_LINK": {
          const { fromId, toId, linkType } = a.payload || {};
          if (fromId && toId && linkType) await addTraceLinkLocal(fromId, toId, linkType);
          break;
        }

        case "CREATE_DIAGRAM_NODE":
        case "CREATE_DIAGRAM_EDGE":
          window.dispatchEvent(new CustomEvent("xhandle:diagram-apply", { detail: a }));
          break;

        case "UPDATE_RISK":
          window.dispatchEvent(new CustomEvent("xhandle:risk-apply", { detail: a }));
          break;

        // already handled above
        case "CREATE_MODULE":
        default:
          break;
      }
    } catch (err) {
      logger.warn("[agent-apply] failed on action", a, err);
    }
  }
}

handleAgentApplyRef.current = handleAgentApply;

// Attribute mapper state (opened after Title is chosen)
const [showAttrMapper, setShowAttrMapper] = useState(false);
const [mapperColumns, setMapperColumns] = useState([]);     // string[] headers
const [mapperTitleCol, setMapperTitleCol] = useState(null); // string
const [mapperSummary2D, setMapperSummary2D] = useState([]); // original 2D rows

// Clear selection when switching folder/module
useEffect(() => { setSelectedId(null); }, [activeFolderId, selectedModule]);


  const [showModuleManager, setShowModuleManager] = useState(false);
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
  function onKeyDown(e) {
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
        if (row && !row.heading) saveRequirementRef.current?.({ ...row, heading: true });
      }
    }

    // Shift + ArrowDown → heading=false
    if (e.shiftKey && e.key === "ArrowDown") {
      e.preventDefault();
      for (const id of ids) {
        const row = moduleRows.find(r => r.id === id);
        if (row && row.heading) saveRequirementRef.current?.({ ...row, heading: false });
      }
    }

    // Shift + ArrowRight → Demote
    if (e.shiftKey && e.key === "ArrowRight") {
      e.preventDefault();
      ids.forEach(id => demoteRef.current?.(id));
    }

    // Shift + ArrowLeft → Promote
    if (e.shiftKey && e.key === "ArrowLeft") {
      e.preventDefault();
      ids.forEach(id => promoteRef.current?.(id));
    }

    // Clipboard (works for multi or single)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelectionRef.current?.(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "x") {
      e.preventDefault();
      cutSelectionRef.current?.();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteClipboardRef.current?.();
    }
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [selectedReq, selectedIds, moduleRows]);


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

// Filtered/sorted rows for the Table view
const tableFiltered = useMemo(() => {
  // start from the current module only
  let rows = selectedModule
    ? folderRequirements.filter(r => r.module === selectedModule)
    : folderRequirements;

  if (filterText.trim()) {
    const q = filterText.toLowerCase();
    rows = rows.filter(r =>
      (r.title || "").toLowerCase().includes(q) ||
      (r.module || "").toLowerCase().includes(q) ||
      (r.status || "").toLowerCase().includes(q) ||
      JSON.stringify(r.attributes || {}).toLowerCase().includes(q)
    );
  }
  if (filterStatus !== "all") {
    rows = rows.filter(r => (r.status || "Proposed") === filterStatus);
  }

  const dir = sortDir === "asc" ? 1 : -1;

  function parsePath(s) {
    return String(s || "")
      .split(".")
      .map(n => parseInt(n, 10))
      .map(n => (Number.isFinite(n) ? n : -1));
  }
  function cmpNumbering(aId, bId) {
    const aP = parsePath(numbering.get(aId));
    const bP = parsePath(numbering.get(bId));
    const len = Math.max(aP.length, bP.length);
    for (let i = 0; i < len; i++) {
      const a = aP[i] ?? -1;
      const b = bP[i] ?? -1;
      if (a !== b) return a - b;
    }
    return 0;
  }

  if (sortKey === "numbering") {
    rows = [...rows].sort((a, b) => {
      const byNum = cmpNumbering(a.id, b.id);
      if (byNum !== 0) return byNum * dir;
      // stable tie-breakers
      return (
        String(a.title || "").localeCompare(String(b.title || "")) ||
        String(a.id || "").localeCompare(String(b.id || ""))
      ) * dir;
    });
// inside tableFiltered, right before the final return, replace your non-numbering sort with:
} else {
  rows = [...rows].sort((a, b) => {
    let aVal, bVal;

    if (sortKey.startsWith("attr:")) {
      const k = sortKey.slice("attr:".length);
      aVal = a?.attributes?.[k];
      bVal = b?.attributes?.[k];
      // normalize arrays/booleans/numbers
      aVal = Array.isArray(aVal) ? aVal.join(", ") : (aVal ?? "");
      bVal = Array.isArray(bVal) ? bVal.join(", ") : (bVal ?? "");
      // numeric-aware compare
      const an = Number(aVal), bn = Number(bVal);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        return (an - bn) * dir;
      }
      return String(aVal).localeCompare(String(bVal)) * dir;
    }

    aVal = a?.[sortKey];
    bVal = b?.[sortKey];
    return String(aVal ?? "").localeCompare(String(bVal ?? "")) * dir;
  });
}

  return rows;
}, [
  folderRequirements,
  selectedModule,
  filterText,
  filterStatus,
  sortKey,
  sortDir,
  numbering, // ensure it re-sorts when the outline hierarchy changes
]);
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

  saveRequirementRef.current = saveRequirement;
  

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
  promoteRef.current = promote;
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
  demoteRef.current = demote;

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
  copySelectionRef.current = copySelection;
  
  function cutSelection() {
    copySelection(true);
    const ids = selectedIds.size ? Array.from(selectedIds) : (selectedId ? [selectedId] : []);
    for (const id of ids) {
      onDelete?.(id);
    }
    clearSelection();
  }
  cutSelectionRef.current = cutSelection;
  
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
  pasteClipboardRef.current = pasteClipboard;
  
  
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
    const fol = folders.find(f => f.id === folderId);
    if (!fol) return;
  
    const descendants = collectDescendantIds(folders, folderId);
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
      `Type MOVE to move contents to the parent folder, then delete this folder.\n` +
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
      const parentId = fol.parentId || null;
  
      // Reparent direct children
      const movedFolders = folders.map(f => f.parentId === folderId ? { ...f, parentId } : f);
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
        const parentKey = parentId || "root";
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

  function moveFolder(folderId, newParentId) {
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
    const view = { name, filterText, filterStatus, filterModule, sortKey, sortDir, selectedModule, viewMode };
    setSavedViews(prev=>{ const next=[...prev.filter(v=>v.name!==name), view]; return next; }); toastOnce(`Saved view '${name}'`);
  }
  function applyView(v){
    setFilterText(v.filterText||""); setFilterStatus(v.filterStatus||"all"); setFilterModule(v.filterModule||"all");
    setSortKey(v.sortKey||"updatedAt"); setSortDir(v.sortDir||"desc"); setSelectedModule(v.selectedModule||selectedModule); setViewMode(v.viewMode||VIEW_MODES.OUTLINE);
  }

  // ----------------------------- UI -----------------------------------------
  const folderTree = useMemo(()=> buildFolderTree(folders), [folders]);

  return (
    <div className="flex">
      {/* Sidebar: Folder Tree */}
      <div className={`shrink-0 border-r bg-white transition-all duration-200 ${sidebarOpen ? "w-64" : "w-10"}`}>


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
    if (srcId) moveFolder(srcId, null);   // ← reparent to ROOT
  }}
>
  <button
    className="rounded p-1 hover:bg-gray-100"
    title={sidebarOpen ? "Collapse" : "Expand"}
    onClick={() => setSidebarOpen(o => !o)}
    aria-label={sidebarOpen ? "Collapse folders sidebar" : "Expand folders sidebar"}
  >
    {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
  </button>

  {sidebarOpen && <div className="text-xs font-semibold text-gray-700">Folders</div>}

  {sidebarOpen && (
    <button
      className="rounded p-1 hover:bg-gray-100"
      title="New root folder"
      onClick={() => {
        const name = window.prompt("Folder name:");
        if (!name?.trim()) return;
        const fol = { id: makeId("FOL"), parentId: null, name: name.trim(), modules: [], roles:{Owner:[],Editor:[],Viewer:[]} };
        Folders.upsert(fol);
        setFolders(Folders.loadAll());
        setActiveFolderId(fol.id);
      }}
    >
      <Plus className="h-4 w-4" />
    </button>
  )}
</div>


  {/* Tree content */}
  <div className={`${sidebarOpen ? "max-h-[80vh] overflow-auto p-2" : "hidden"}`}>
    <FolderTree
      roots={folderTree}
      activeId={activeFolderId}
      onSelect={(id)=>setActiveFolderId(id)}
      onCreateChild={(parentId)=>{
        const name = window.prompt("Folder name:"); if(!name) return;
        const fol = { id: makeId("FOL"), parentId, name, modules: [], roles:{Owner:[],Editor:[],Viewer:[]} };
        Folders.upsert(fol);
        setFolders(Folders.loadAll());
        setActiveFolderId(fol.id);
      }}
      onDeleteFolder={(id) => deleteFolder(id)}
      onManageModules={(id)=>{ setActiveFolderId(id); setShowModuleManager(true); }}
      selectedModule={selectedModule}
      onSelectModule={(moduleName)=> setSelectedModule(moduleName)}
      onCreateModule={(folderId)=>{
        const foldersAll = Folders.loadAll();
        const folder = foldersAll.find(f=>f.id===folderId);
        if (!folder) return;
        const name = window.prompt("Module name:", "Requirement");
        if (!name?.trim()) return;
        const mod = { id: makeId("MOD"), name: name.trim(), type: "Requirement", attrTemplate: [], viewTemplates: [] };
        const updated = { ...folder, modules: [...(folder.modules || []), mod] };
        Folders.upsert(updated);
        setFolders(Folders.loadAll());
        setActiveFolderId(folderId);
        setSelectedModule(mod.name);
      }}
      onMoveFolder={(folderId, newParentId) => moveFolder(folderId, newParentId)}
      onMoveModule={moveModule} 
    />
  </div>
</div>


      {/* Main */}
      <div className="flex-1 p-4">

<MenuBar
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
  onManageModulesClick={undefined /* or () => setShowModuleManager(true) if you want it accessible here */}
  onOpenLinker={() => setShowLinker(true)}
/>

<HeaderBar
  folderName={activeFolder?.name || "—"}
  filterText={filterText}
  setFilterText={setFilterText}
  filterStatus={filterStatus}
  setFilterStatus={setFilterStatus}
  sortKey={sortKey}
  setSortKey={setSortKey}
  sortDir={sortDir}
  setSortDir={setSortDir}
  attrColumns={attrColumns}
/>


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
    rows={tableFiltered}
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

        {showModuleManager && activeFolder && (
          <ModuleManager
            project={activeFolder} // reusing same shape; this “project” is a folder
            onClose={()=>setShowModuleManager(false)}
            onSave={(updated) => {
              // 1) Figure out which modules were removed from this folder
              const before = activeFolder?.modules || [];
              const after  = updated?.modules || [];
              const removed = before.filter(m => !after.some(mm => mm.id === m.id)); // [{id, name, ...}]
            
              // 2) If any were removed, purge their requirements in THIS folder
              if (removed.length) {
                const removedIds   = new Set(removed.map(m => m.id));
                const removedNames = new Set(removed.map(m => m.name));
            
                updateRequirements(prev => prev.filter(r => {
                  const fid = r.folderId ?? r.projectId;
                  // keep rows that are not in this folder OR not in the deleted modules
                  return !(fid === activeFolderId && removedIds.has(r.moduleId));
                }));
            
                // 3) Drop baselines for those modules in this folder
                const baseMap = Baselines.loadMap();
                if (baseMap?.[activeFolderId]) {
                  for (const m of removed) {
                    if (baseMap[activeFolderId][m.id]) {
                      delete baseMap[activeFolderId][m.id];
                    }
                  }
                  Baselines.saveMap(baseMap);
                }
            
                // 4) If the currently selected module was deleted in this folder, pick a safe fallback
                if (removedNames.has(selectedModule) && activeFolderId === activeFolder?.id) {
                  const fallback = after[0]?.name || "";
                  setSelectedModule(fallback);
                }
            
                toastOnce(`Deleted module(s): ${[...removedNames].join(", ")} and their requirements from this folder`);
              }
            
              // 5) Persist folder changes (module list) and close
              Folders.upsert(updated);
              setFolders(Folders.loadAll());
              setShowModuleManager(false);
            }}
            
          />
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
      </div>
    </div>
  );
}

// ----------------------------- Folder Sidebar -------------------------------
function FolderTree({
    roots,
    activeId,
    selectedModule,
    onSelect,
    onSelectModule,
    onCreateChild,
    onManageModules,
    onDeleteFolder, 
    onCreateModule,
    onMoveFolder, 
    onMoveModule,
  }) {
    const [open, setOpen] = useState(() => {
      try {
        const raw = localStorage.getItem(LS_FOLDER_OPEN);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(arr);
      } catch {
        return new Set();
      }
    });

      // NEW: highlight the folder currently being hovered during drag
  const [, setDragOverId] = useState(null);
  
    // persist open set
    useEffect(() => {
      localStorage.setItem(LS_FOLDER_OPEN, JSON.stringify([...open]));
    }, [open]);
  
    function ModuleRow({ folderId, m, isActiveFolder, isActiveModule }) {
        return (
          <div
            className={`ml-6 flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50 ${
              isActiveFolder && isActiveModule ? "bg-blue-50" : ""
            }`}
            onDoubleClick={(e) => { e.stopPropagation(); onManageModules(folderId); }}
            title="Drag to another folder to move this module"
            draggable                      // ← NEW
            onDragStart={(e) => {         // ← NEW
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(
                DND_MIME_MODULE,
                JSON.stringify({ moduleId: m.id, fromFolderId: folderId })
              );
              // fallback for some browsers
              e.dataTransfer.setData("text/plain", m.id);
            }}
          >
            <Layers className="h-4 w-4" />
            <button
              className="flex-1 text-left text-sm"
              onClick={() => { onSelect(folderId); onSelectModule?.(m.name); }}
              title={m.name}
            >
              {m.name}
            </button>
          </div>
        );
      }      
  
    function Node({ n }) {
      const isOpen = open.has(n.id);
      const modules = n.modules || [];
      const hasChildren = (n.children || []).length > 0;
      const hasContent = hasChildren || modules.length > 0;
      const Chevron = isOpen ? ChevronDown : ChevronRight;
    
      const handleToggle = () => {
        if (hasContent) {
          setOpen(s => {
            const next = new Set(s);
            if (next.has(n.id)) next.delete(n.id);
            else next.add(n.id);
            return next;
          });
        }
        onSelect(n.id);
      };
    
      return (
        <div>
<div
  className={`flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-50 ${
    activeId === n.id ? "bg-blue-50" : ""
  }`}
  role="button"
  tabIndex={0}
  onClick={handleToggle}
  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleToggle(); }}
  draggable
   onDragStart={(e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DND_MIME_FOLDER, n.id);
      e.dataTransfer.setData("text/plain", n.id); // fallback
    }}
  // ↓↓↓ NEW: accept folder or module drops
  onDragOver={(e) => {
    const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [];
    if (types.includes(DND_MIME_FOLDER) || types.includes(DND_MIME_MODULE)) {
      e.preventDefault(); // allow drop
      setDragOverId(n.id);
    }
  }}
  onDragLeave={() => setDragOverId(null)}
  onDrop={(e) => {
    e.preventDefault();
    setDragOverId(null);
    // Module move?
    const modPayload = e.dataTransfer.getData(DND_MIME_MODULE);
    if (modPayload) {
      try {
        const { moduleId, fromFolderId } = JSON.parse(modPayload);
        if (moduleId && fromFolderId && fromFolderId !== n.id) {
          onMoveModule?.(moduleId, fromFolderId, n.id);
          return;
        }
      } catch {}
    }
    // (your existing folder drop code stays here; if you used DND_MIME_FOLDER, leave it as-is)
    const folderId = e.dataTransfer.getData(DND_MIME_FOLDER);
    if (folderId && folderId !== n.id) {
       onMoveFolder?.(folderId, n.id);  // keep your existing call
    }
  }}
>

            {hasContent ? <Chevron className="h-4 w-4" /> : <span className="inline-block w-4" />}
            {isOpen ? <FolderOpen className="h-4 w-4" /> : <FolderIcon className="h-4 w-4" />}
            <span className="flex-1 text-left text-sm">{n.name}</span>
    
            {/* Manage button */}
            <button
  className="rounded px-1 text-xs hover:bg-gray-100"
  title="Manage Modules"
  onClick={(e) => { e.stopPropagation(); onManageModules(n.id); }}
>
  <Boxes className="h-4 w-4" />
</button>
            {/* Add subfolder */}
            <button
  className="rounded px-1 text-xs hover:bg-gray-100"
  title="Add subfolder"
  onClick={(e) => { e.stopPropagation(); onCreateChild(n.id); }}
>
  <FolderPlus className="h-4 w-4" />
</button>
            <button
  className="rounded px-1 text-xs hover:bg-gray-100 text-red-600"
  title="Delete folder"
  onClick={(e) => { e.stopPropagation(); onDeleteFolder?.(n.id); }}
>
  <Trash2 className="h-4 w-4" />
</button>
          </div>
    
          {isOpen && modules.map(m => (
            <ModuleRow
              key={m.id}
              folderId={n.id}
              m={m}
              isActiveFolder={activeId === n.id}
              isActiveModule={selectedModule === m.name}
            />
          ))}
    
          {isOpen && (
            <div className="ml-4">
              {(n.children || []).map(ch => <Node key={ch.id} n={ch} />)}
            </div>
          )}
        </div>
      );
    }        
  
    // expose expand/collapse all via a tiny header bar returned alongside the tree
    return (
        <div>
          {roots.map((r) => (
            <Node key={r.id} n={r} />
          ))}
        </div>
      );      
  }  

// ----------------------------- Header Bar -----------------------------------
function HeaderBar({ folderName, filterText, setFilterText, filterStatus, setFilterStatus, sortKey, setSortKey, sortDir, setSortDir, attrColumns = [] })
 {
    return (
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
          <input
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder={`Search in ${folderName}…`}
            onChange={(e)=>setFilterText(e.target.value)}
            value={filterText}
          />
        </div>
  
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={filterStatus}
            onChange={(e)=>setFilterStatus(e.target.value)}
          >
            <option value="all">All</option>
            {STATUSES.map(s=> <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
  
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Sort</label>
          <div className="flex items-center gap-2">
          <select
  className="rounded border px-2 py-1 text-sm"
  value={sortKey}
  onChange={(e)=>setSortKey(e.target.value)}
>
  <option value="numbering">Numbering</option>
  <option value="updatedAt">Updated</option>
  <option value="title">Title</option>
  <option value="module">Module</option>
  <option value="status">Status</option>
  <option value="version">Version</option>
  {attrColumns.map(k => <option key={`attr-${k}`} value={`attr:${k}`}>{`Attr: ${k}`}</option>)}

</select>

            <select
              className="rounded border px-2 py-1 text-sm"
              value={sortDir}
              onChange={(e)=>setSortDir(e.target.value)}
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </div>
        </div>
      </div>
    );
  }
  
/**
 * RowActionsBar renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param disabled Input consumed by this step of the xHandle workflow.
 * @param selection Input consumed by this step of the xHandle workflow.
 * @param numbering Input consumed by this step of the xHandle workflow.
 * @param onClear Callback used to notify the surrounding workflow about progress or user actions.
 * @param onNewChild Callback used to notify the surrounding workflow about progress or user actions.
 * @param onEdit Callback used to notify the surrounding workflow about progress or user actions.
 * @param onDelete Callback used to notify the surrounding workflow about progress or user actions.
 * @param onMoveUp Callback used to notify the surrounding workflow about progress or user actions.
 * @param onMoveDown Callback used to notify the surrounding workflow about progress or user actions.
 * @param onPromote Callback used to notify the surrounding workflow about progress or user actions.
 * @param onDemote Callback used to notify the surrounding workflow about progress or user actions.
 * @param onHistory Callback used to notify the surrounding workflow about progress or user actions.
 * @param viewMode Input consumed by this step of the xHandle workflow.
 * @param setViewMode React state setter supplied by the parent workflow.
 * @param onSetContent Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function RowActionsBar({
    disabled,
    selection,
    numbering,
    onClear,
    onNewChild,
    onEdit,
    onDelete,
    onMoveUp,
    onMoveDown,
    onPromote,
    onDemote,
    onHistory,
    viewMode,
    setViewMode,
    onSetContent,     // ← receives { type: "image"| "table", ... }
  }) {
    const [showTableMaker, setShowTableMaker] = React.useState(false);
    const fileRef = React.useRef(null);
  
    function onPickImage(file) {
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => onSetContent?.({
        type: "image",
        image: { dataUrl: String(fr.result || ""), name: file.name }
      });
      fr.readAsDataURL(file);
    }
  
    return (
        <div className="flex flex-wrap items-center gap-2">
             <div className="flex flex-wrap items-center gap-1">
        
{/* View toggle */}
<div className="inline-flex overflow-hidden rounded border">
  <button
    className={`p-2 ${viewMode === VIEW_MODES.OUTLINE ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
    onClick={() => setViewMode(VIEW_MODES.OUTLINE)}
    title="Outline view"
    aria-pressed={viewMode === VIEW_MODES.OUTLINE}
  >
    <Layers className="h-4 w-4" />
  </button>
  <div className="w-px bg-gray-200" />
  <button
    className={`p-2 ${viewMode === VIEW_MODES.TABLE ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
    onClick={() => setViewMode(VIEW_MODES.TABLE)}
    title="Table view"
    aria-pressed={viewMode === VIEW_MODES.TABLE}
  >
    <TableIcon className="h-4 w-4" />
  </button>
  <div className="w-px bg-gray-200" />
  <button
    className={`p-2 ${viewMode === VIEW_MODES.TRACE ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
    onClick={() => setViewMode(VIEW_MODES.TRACE)}
    title="Traceability view"
    aria-pressed={viewMode === VIEW_MODES.TRACE}
  >
    <Link2 className="h-4 w-4" />
  </button>
</div>

  
          {/* New child */}
          <button
            onClick={onNewChild}
            disabled={disabled}
            title="New child"
            className="rounded border p-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            aria-disabled={disabled}
          >
            <Plus className="h-4 w-4" />
          </button>
  
          {/* Insert image */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ""; }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!selection || disabled}
            title="Insert image (renders in place of title)"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <ImageIcon className="h-4 w-4" />
          </button>
  
          {/* Insert table */}
          <button
            onClick={() => setShowTableMaker(true)}
            disabled={!selection || disabled}
            title="Insert table (renders in place of title)"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
  
          <div className="mx-1 h-5 w-px bg-gray-200" />
  
          {/* Edit / Delete */}
          <button
            onClick={onEdit}
            disabled={!selection || disabled}
            title="Edit"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            disabled={!selection || disabled}
            title="Delete"
            className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
  
          <div className="mx-1 h-5 w-px bg-gray-200" />
  
          {/* Ordering / hierarchy */}
          <button onClick={onMoveUp} disabled={!selection || disabled} title="Move up"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button onClick={onMoveDown} disabled={!selection || disabled} title="Move down"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button onClick={onPromote} disabled={!selection || disabled} title="Promote (outdent)"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <IndentDecrease className="h-4 w-4" />
          </button>
          <button onClick={onDemote} disabled={!selection || disabled} title="Demote (indent)"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <IndentIncrease className="h-4 w-4" />
          </button>
  
          <div className="mx-1 h-5 w-px bg-gray-200" />
  
          {/* History / clear */}
          <button onClick={onHistory} disabled={!selection} title="History"
                  className="rounded border p-2 hover:bg-gray-50 disabled:opacity-50">
            <History className="h-4 w-4" />
          </button>
          <button onClick={onClear} title="Clear selection" className="rounded border p-2 hover:bg-gray-50">
            <X className="h-4 w-4" />
          </button>
        </div>
  
        {showTableMaker && (
          <QuickTableModal
            onCancel={() => setShowTableMaker(false)}
            onSave={(cells) => {
              onSetContent?.({ type: "table", table: { cells } });
              setShowTableMaker(false);
            }}
          />
        )}
      </div>
    );
  }  

// ----------------------------- Outline Panel --------------------------------
function OutlinePanel({
  moduleName, rows, numbering,
  onCreateChild, onEdit, onDelete,
  onMoveUp, onMoveDown, onPromote, onDemote,
  onShowHistory,
  onInlineUpdate,
  disabled,
  selectedId,
  selectedIds,         // add this
  onSelect,            // update to accept (id, event)
}) {

    const { children } = buildIndex(rows);
  
    const [editState, setEditState] = React.useState({ id: null, title: "" });
    const [editTable, setEditTable] = React.useState({ open: false, row: null, cells: [[]] });

    const inputRef = React.useRef(null);
  
    React.useEffect(() => {
      if (editState.id && inputRef.current) inputRef.current.focus();
    }, [editState.id]);
  
    function startInlineEdit(node) {
      if (disabled) return;
      onSelect?.(node.id);
      setEditState({ id: node.id, title: node.title || "" });
    }
    function commitInlineEdit() {
      if (!editState.id) return;
      const cur = rows.find(r => r.id === editState.id);
      const nextTitle = editState.title.trim();
      setEditState({ id: null, title: "" });
      if (!disabled && cur && nextTitle !== (cur.title || "")) {
        onInlineUpdate?.(cur, { title: nextTitle });
      }
    }
    function cancelInlineEdit() {
      setEditState({ id: null, title: "" });
    }
  
    function renderBranch(parentId) {
      const list = children.get(parentId || null) || [];
      return list.map(node => {
        const isSelected = selectedId === node.id || selectedIds?.has?.(node.id);
        const isEditing = editState.id === node.id;
  
        return (
          <div key={node.id} className="border-t first:border-t-0">
           <div
  className={`flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50 ${isSelected ? "bg-blue-50 ring-1 ring-blue-300" : ""}`}
  role="button"
  tabIndex={0}
  aria-pressed={isSelected}
  onMouseDown={(e) => {
    const t = e.target;
    const tag = t.tagName;
    const interactive =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      t.isContentEditable;
    if (interactive) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
    }
  }}
  onClick={(e) => onSelect?.(node.id, e)}
  onDoubleClick={(e) => { e.stopPropagation(); !disabled && onEdit(node); }}
  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(node.id); }}
>

              <div className="w-24 shrink-0 text-xs font-mono text-gray-500">
                {numbering.get(node.id)}
              </div>
  
              <div className="flex-1">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="w-full rounded border px-2 py-1 text-sm"
                    value={editState.title}
                    onChange={(e) => setEditState(s => ({ ...s, title: e.target.value }))}
                    onBlur={commitInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitInlineEdit(); }
                      if (e.key === "Escape") { e.preventDefault(); cancelInlineEdit(); }
                    }}
                  />
                ) : node?.content?.type === "image" ? (
                  <img
                    src={node.content?.image?.dataUrl}
                    alt={node.title || node.content?.image?.name || "image"}
                    className="max-h-24 rounded"
                    onDoubleClick={(e) => { e.stopPropagation(); onEdit(node); }}
                  />
                ) : node?.content?.type === "table" ? (
                    <div
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditTable({
                          open: true,
                          row: node,
                          cells: Array.isArray(node.content?.table?.cells) ? node.content.table.cells : [[]],
                        });
                      }}
                    >
                      <MiniTable cells={node.content?.table?.cells || []} />
                    </div>
                  ) : (
                  
<div
  className={node.heading ? "font-semibold" : "font-medium"}
  title="Double-click to edit title"
  onDoubleClick={(e) => { e.stopPropagation(); startInlineEdit(node); }}
>
  {node.title || <span className="text-gray-400">(untitled)</span>}
</div>

                )}
  
                <div className="text-xs text-gray-500">
                  {node.status} · v{node.version} · {(node.updatedAt || "").replace("T", " ").slice(0, 16)}
                </div>
              </div>
            </div>
  
            <div className="pl-8">{renderBranch(node.id)}</div>
          </div>
        );
      });
    }
  
    return (
      <div className="mt-4 overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-3 py-2 text-sm text-gray-600">{moduleName} — Outline</div>
        <div className="max-h-[55vh] overflow-auto">{renderBranch(null)}</div>
        {!rows.length && (
          <div className="p-6 text-center text-sm text-gray-500">
            No items in this module. Click <span className="font-medium">New</span> or <span className="font-medium">Import</span>.
          </div>
        )}
        {editTable.open && (
  <QuickTableModal
    title="Edit Table"
    initial={editTable.cells}
    onCancel={() => setEditTable({ open: false, row: null, cells: [[]] })}
    onSave={(cells) => {
      if (editTable.row) {
        onInlineUpdate?.(editTable.row, { content: { type: "table", table: { cells } } });
      }
      setEditTable({ open: false, row: null, cells: [[]] });
    }}
  />
)}

      </div>
    );
  }  
  

// ----------------------------- Table Panel ----------------------------------
function TablePanel({ rows, numbering, moduleName, attrColumns = [],
  onEdit, onDelete, onCreate, canCreate,
  onInlineUpdate, onShowHistory,
  onSelect, selectedId, selectedIds }) {

      // ────────────── Column Model (order must match rendering) ──────────────
  const columns = React.useMemo(() => {
    const fixedBefore = [
      { key: "id",       label: "ID" },
      { key: "title",    label: "Title" },
    ];
    const attrs = (attrColumns || []).map((k) => ({ key: `attr:${k}`, label: k }));
    const fixedAfter = [
      { key: "status",   label: "Status" },
      { key: "version",  label: "Version" },
      { key: "updatedAt",label: "Updated" },
      { key: "links",    label: "Links" },
    ];
    return [...fixedBefore, ...attrs, ...fixedAfter];
  }, [attrColumns]);

  // Reasonable defaults per column
  const defaultWidthFor = React.useCallback((key) => {
    if (key === "id") return 160;
    if (key === "title") return 340;
    if (key.startsWith("attr:")) return 180;
    if (key === "status") return 120;
    if (key === "version") return 100;
    if (key === "updatedAt") return 170;
    if (key === "links") return 90;
    return 150;
  }, []);

  // Persist widths per module
  const STORAGE_KEY = React.useMemo(
    () => `xhandle:table-colwidths:${moduleName || "default"}`,
    [moduleName]
  );

  // Initialize widths from storage or defaults
  const [colWidths, setColWidths] = React.useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      }
    } catch {}
    return {};
  });

  // Ensure any new columns get a width
  React.useEffect(() => {
    setColWidths((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const c of columns) {
        if (!next[c.key]) {
          next[c.key] = defaultWidthFor(c.key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [columns, defaultWidthFor]);

  // Persist on change
  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(colWidths)); } catch {}
  }, [STORAGE_KEY, colWidths]);

  // Resize interaction
  const MIN_WIDTH = 60;
  const startResize = (key, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[key] ?? defaultWidthFor(key);

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const w = Math.max(MIN_WIDTH, startW + dx);
      setColWidths((m) => ({ ...m, [key]: w }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetWidth = (key) => {
    setColWidths((m) => ({ ...m, [key]: defaultWidthFor(key) }));
  };

  const renderAttrVal = (v) => {
    if (v == null) return "";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };
    
    const [editState, setEditState] = React.useState({ id: null, title: "" });
    const [, setEditTable] = React.useState({ open: false, row: null, cells: [[]] });

    const inputRef = React.useRef(null);
  
    React.useEffect(() => {
      if (editState.id && inputRef.current) inputRef.current.focus();
    }, [editState.id]);
  
    function startInlineEdit(row) {
      setEditState({ id: row.id, title: row.title || "" });
    }
    function commitInlineEdit() {
      if (!editState.id) return;
      const row = rows.find(r => r.id === editState.id);
      const nextTitle = (editState.title || "").trim();
      setEditState({ id: null, title: "" });
      if (row && nextTitle !== (row.title || "")) {
        onInlineUpdate?.(row, { title: nextTitle });
      }
    }
    function cancelInlineEdit() {
      setEditState({ id: null, title: "" });
    }
  
    return (
      <div className="mt-4 rounded-xl border bg-white">
        {/* NEW: scrolling container for both axes */}
        <div className="relative max-h-[60vh] overflow-x-auto overflow-y-auto">
          <table className="min-w-full text-sm table-fixed">
            <colgroup>
              {columns.map((c) => (
                <col
                  key={`col-${c.key}`}
                  style={{ width: (colWidths[c.key] ?? defaultWidthFor(c.key)) + "px" }}
                />
              ))}
            </colgroup>
    
            {/* NEW: sticky header */}
            <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                {columns.map((c) => (
                  <th
                    key={`h-${c.key}`}
                    title={c.label}
                    // note the extra sticky/bg/z classes on the th itself too
                    className="relative px-3 py-2 text-left font-medium select-none sticky top-0 bg-gray-50 z-20"
                  >
                    <span>{c.label}</span>
                    {/* Resize handle (unchanged) */}
                    <span
                      role="separator"
                      aria-label={`Resize column ${c.label}`}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-gray-300"
                      onMouseDown={(e) => startResize(c.key, e)}
                      onDoubleClick={() => resetWidth(c.key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
    
            <tbody>
              {rows.map((r) => {
const isSelected = selectedId === r.id || selectedIds?.has?.(r.id);
const isEditing = editState.id === r.id;
    
                return (
                  <tr
  key={r.id}
  className={`border-t hover:bg-gray-50 ${isSelected ? "bg-blue-50 ring-1 ring-blue-300" : ""}`}
  onMouseDown={(e) => {
    const t = e.target;
    const tag = t.tagName;
    const interactive =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      t.isContentEditable;
    if (interactive) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
    }
  }}
  onClick={(e) => onSelect?.(r.id, e)}
  onDoubleClick={(e) => { e.stopPropagation(); onEdit(r); }}
  role="button"
  aria-pressed={isSelected}
>

                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{r.id}</td>
    
                    <td className="px-3 py-2 align-top">
                      {(() => {
                        const num = numbering?.get?.(r.id);
                        const Prefix = num ? (
                          <span
                            className="shrink-0 whitespace-nowrap font-mono text-[11px] text-gray-500 min-w-[3.5rem] text-right"
                            style={{ display: "inline-block" }}
                            aria-hidden="true"
                          >
                            {num}
                          </span>
                        ) : null;
    
                        if (isEditing) {
                          return (
                            <div className="flex items-start gap-2">
                              {Prefix}
                              <input
                                ref={inputRef}
                                className="w-full rounded border px-2 py-1 text-sm"
                                value={editState.title}
                                onChange={(e) => setEditState((s) => ({ ...s, title: e.target.value }))}
                                onBlur={commitInlineEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); commitInlineEdit(); }
                                  if (e.key === "Escape") { e.preventDefault(); cancelInlineEdit(); }
                                }}
                              />
                            </div>
                          );
                        }
    
                        if (r?.content?.type === "image") {
                          return (
                            <div className="flex items-start gap-2">
                              {Prefix}
                              <img
                                src={r.content?.image?.dataUrl}
                                alt={r.title || r.content?.image?.name || "image"}
                                className="max-h-16 rounded"
                                onDoubleClick={(e) => { e.stopPropagation(); onEdit(r); }}
                              />
                            </div>
                          );
                        }
    
                        if (r?.content?.type === "table") {
                          return (
                            <div
                              className="flex items-start gap-2"
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditTable({
                                  open: true,
                                  row: r,
                                  cells: Array.isArray(r.content?.table?.cells) ? r.content.table.cells : [[]],
                                });
                              }}
                            >
                              {Prefix}
                              <div className="max-h-28 overflow-auto">
                                <MiniTable cells={r.content?.table?.cells || []} dense />
                              </div>
                            </div>
                          );
                        }
    
                        return (
<div
  className="flex items-start gap-2"
  title="Double-click to edit title"
  onDoubleClick={(e) => { e.stopPropagation(); startInlineEdit(r); }}
>
  {Prefix}
  <div className={`whitespace-normal break-words leading-snug ${r.heading ? "font-semibold" : "font-medium"}`}>
    {r.title || <span className="text-gray-400">(untitled)</span>}
  </div>
</div>

                        );
                      })()}
                    </td>
    
                    {/* attribute cells */}
                    {attrColumns.map((k) => (
                      <td key={`c-${r.id}-${k}`} className="px-3 py-2">
                        {renderAttrVal(r.attributes?.[k])}
                      </td>
                    ))}
    
                    <td className="px-3 py-2">
                      <select
                        className="rounded border px-2 py-1 text-sm"
                        value={r.status || "Proposed"}
                        onChange={(e) => onInlineUpdate(r, { status: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
    
                    <td className="px-3 py-2">{r.version ?? 1}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {(r.updatedAt || "").replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{(r.links || []).length}</td>
                  </tr>
                );
              })}
    
              {!rows.length && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-500">
                    No requirements yet.{" "}
                    {canCreate && (
                      <>
                        Click <span className="font-medium">New</span> or use <span className="font-medium">Import</span>.
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );    
  }
  
  
/**
 * MultiSelect renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param value Input consumed by this step of the xHandle workflow.
 * @param options Optional behavior switches for this step.
 * @param onChange Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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

/**
 * MiniTable renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param cells Input consumed by this step of the xHandle workflow.
 * @param dense Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  function MiniTable({ cells = [[]], dense = false }) {
    const cls = dense ? "px-1 py-0.5" : "px-2 py-1";
    return (
      <table className="border border-gray-200 rounded">
        <tbody>
          {(cells.length ? cells : [[]]).map((row, i) => (
            <tr key={i}>
              {(row.length ? row : [""]).map((c, j) => (
                <td key={j} className={`border border-gray-200 text-xs ${cls}`}>{String(c ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
/**
 * QuickTableModal renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param title Input consumed by this step of the xHandle workflow.
 * @param initial Input consumed by this step of the xHandle workflow.
 * @param onCancel Callback used to notify the surrounding workflow about progress or user actions.
 * @param onSave Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  function QuickTableModal({ title = "Insert Table", initial, onCancel, onSave }) {
    // If `initial` is provided, prefill from it
    const initialRows = Array.isArray(initial) && initial.length ? initial.length : 3;
    const initialCols = Array.isArray(initial?.[0]) && initial[0].length ? initial[0].length : 3;
  
    const [rows, setRows] = React.useState(initialRows);
    const [cols, setCols] = React.useState(initialCols);
    const [grid, setGrid] = React.useState(
      Array.from({ length: initialRows }, (_, i) =>
        Array.from({ length: initialCols }, (_, j) => initial?.[i]?.[j] ?? "")
      )
    );
  
    // When rows/cols change, preserve existing cells
    React.useEffect(() => {
      setGrid((g) => {
        const r = Math.max(1, rows), c = Math.max(1, cols);
        const next = Array.from({ length: r }, (_, i) =>
          Array.from({ length: c }, (_, j) => g[i]?.[j] ?? "")
        );
        return next;
      });
    }, [rows, cols]);
  
    return (
      <Modal title={title} onClose={onCancel}>
        <div className="space-y-3">
          <div className="flex gap-3">
            <Field label="Rows">
              <input
                type="number"
                min={1}
                className="w-24 rounded border px-2 py-1 text-sm"
                value={rows}
                onChange={(e) => setRows(Number(e.target.value || 1))}
              />
            </Field>
            <Field label="Cols">
              <input
                type="number"
                min={1}
                className="w-24 rounded border px-2 py-1 text-sm"
                value={cols}
                onChange={(e) => setCols(Number(e.target.value || 1))}
              />
            </Field>
          </div>
  
          <div className="overflow-auto max-h-72 rounded border p-2">
            <table className="text-xs">
              <tbody>
                {grid.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className="border border-gray-200">
                        <input
                          className="w-28 px-2 py-1 text-xs outline-none"
                          value={cell}
                          onChange={(e) => {
                            const v = e.target.value;
                            setGrid((g) =>
                              g.map((rr, ii) =>
                                ii === i
                                  ? rr.map((cc, jj) => (jj === j ? v : cc))
                                  : rr
                              )
                            );
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
  
          <div className="flex justify-end gap-2">
            <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="rounded bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
              onClick={() => onSave(grid)}
            >
              Save
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  
// ----------------------------- Traceability View -----------------------------
function TraceabilityView({
  allRequirements = [],
  selectedModule,
  activeFolderId,
  folderNameById = {},
}) {
  const [mode, setMode] = React.useState("REFINES"); // "REFINES" | "REFINED_BY"

  const memo = React.useMemo(() => {
    const all = Array.isArray(allRequirements) ? allRequirements : [];

    // Seed = only items in the selected module & active folder
    const seed = all.filter((r) => {
      if (selectedModule && r.module !== selectedModule) return false;
      if (activeFolderId && (r.folderId ?? r.projectId) !== activeFolderId) return false;
      return true;
    });

    // Map for resolving titles/modules/folders for ANY node (not just seed)
    const byId = new Map(all.map((r) => [r.id, r]));
    const seedSet = new Set(seed.map((r) => r.id));

    // Helper to pull folder label
    const folderOf = (r) => folderNameById?.[r?.folderId ?? r?.projectId] ?? "—";

    // -------- Refines OUT of the seed (module → anything)
    const edgesOut = [];
    const dangling = [];

    for (const r of seed) {
      const links = Array.isArray(r.links) ? r.links : [];
      for (const l of links) {
        if (!l?.toId) continue;
        if (String(l.type || "").toLowerCase() !== "refines") continue;

        const fromFolder = folderOf(r);
        if (byId.has(l.toId)) {
          const toReq = byId.get(l.toId);
          edgesOut.push({
            type: "refines",
            from: r.id,
            fromTitle: r.title || "",
            fromModule: r.module || "",
            fromFolder,
            to: l.toId,
            toTitle: toReq?.title || "",
            toModule: toReq?.module || "",
            toFolder: folderOf(toReq),
          });
        } else {
          // missing target → dangling
          dangling.push({
            type: "refines",
            from: r.id,
            fromTitle: r.title || "",
            fromModule: r.module || "",
            fromFolder,
            to: l.toId,
          });
        }
      }
    }

    // -------- Refines INTO the seed (anything → module)
    const edgesInRaw = [];
    for (const r of all) {
      const links = Array.isArray(r.links) ? r.links : [];
      for (const l of links) {
        if (!l?.toId) continue;
        if (String(l.type || "").toLowerCase() !== "refines") continue;
        if (!seedSet.has(l.toId)) continue;

        const toReq = byId.get(l.toId);
        edgesInRaw.push({
          type: "refines",
          from: r.id,
          fromTitle: r.title || "",
          fromModule: r.module || "",
          fromFolder: folderOf(r),
          to: l.toId,
          toTitle: toReq?.title || "",
          toModule: toReq?.module || "",
          toFolder: folderOf(toReq),
        });
      }
    }

    // -------- Orphans within the module context:
    // no outgoing "refines" FROM seed AND no incoming "refines" INTO seed
    const outgoingFromSeed = new Map();
    edgesOut.forEach((e) => outgoingFromSeed.set(e.from, (outgoingFromSeed.get(e.from) || 0) + 1));

    const incomingToSeed = new Map();
    edgesInRaw.forEach((e) => incomingToSeed.set(e.to, (incomingToSeed.get(e.to) || 0) + 1));

    const orphans = seed.filter(
      (r) => (outgoingFromSeed.get(r.id) || 0) === 0 && (incomingToSeed.get(r.id) || 0) === 0
    );

    // Stats reflect the seeded set; edges count reflects the current mode
    const stats = {
      nodes: seed.length,
      edges: mode === "REFINES" ? edgesOut.length : edgesInRaw.length,
      dangling: dangling.length,
      orphans: orphans.length,
    };

    return { edgesOut, edgesInRaw, dangling, orphans, stats, seed };
  }, [allRequirements, selectedModule, activeFolderId, folderNameById, mode]);

  const { edgesOut, edgesInRaw, dangling, orphans, stats } = memo;

  // For "refined by", show SUBJECT (seed item) on the left and the REFINER on the right
  const viewEdges =
    mode === "REFINES"
      ? edgesOut
      : edgesInRaw.map((e) => ({
          type: "refined by",
          from: e.to,
          fromTitle: e.toTitle,
          fromModule: e.toModule,
          fromFolder: e.toFolder,
          to: e.from,
          toTitle: e.fromTitle,
          toModule: e.toModule,
          toFolder: e.fromFolder,
        }));

  const PathLine = ({ folder, module }) => (
    <div className="text-[11px] text-gray-500">[{folder || "—"} / {module || "—"}]</div>
  );

  return (
    <div className="grid grid-cols-12 gap-4 mt-4">
      {/* Left: metrics + lists */}
      <div className="col-span-12 lg:col-span-4 space-y-4">
        {/* Metrics (sticky) */}
    <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Traceability Metrics</h3>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-gray-500">Nodes</dt><dd className="font-medium">{stats.nodes}</dd></div>
            <div><dt className="text-gray-500">Edges</dt><dd className="font-medium">{stats.edges}</dd></div>
            <div><dt className="text-gray-500">Orphans</dt><dd className="font-medium">{stats.orphans}</dd></div>
            <div><dt className="text-gray-500">Dangling Refs</dt><dd className="font-medium">{stats.dangling}</dd></div>
          </dl>
        </div>

        {/* Dangling list (sticky header inside, scroll body) */}
        {!!dangling.length && (
          <div className="rounded-xl border bg-white">
            <div className="max-h-[32vh] overflow-auto">
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b px-4 py-2">
                <h4 className="text-sm font-semibold">Dangling “refines” Links</h4>
              </div>
              <ul className="p-4 space-y-2 text-xs">
                {dangling.map((d, i) => (
                  <li key={`${d.from}-${d.to}-${i}`} className="leading-tight">
                    <PathLine folder={d.fromFolder} module={d.fromModule} />
                    <div className="text-[11px] text-gray-400 font-mono">{d.from}</div>
                    <div className="text-[13px] font-medium">
                      {d.fromTitle || <span className="text-gray-400">(untitled)</span>}
                    </div>
                    <div>
                      <span className="mx-1">—refines→</span>
                      <code className="bg-gray-50 px-1 py-0.5 rounded">(missing) {d.to}</code>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Orphans (sticky header inside, scroll body) */}
        {!!orphans.length && (
          <div className="rounded-xl border bg-white">
            <div className="max-h-[45vh] overflow-auto">
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b px-4 py-2">
                <h4 className="text-sm font-semibold">Orphans (no in/out “refines”)</h4>
              </div>
              <ul className="p-4 space-y-2 text-sm">
                {orphans.map((r) => {
                  const folder = folderNameById?.[r.folderId ?? r.projectId] ?? "—";
                  return (
                    <li key={r.id} className="leading-tight">
                      <PathLine folder={folder} module={r.module} />
                      <div className="text-[11px] text-gray-400 font-mono">{r.id}</div>
                      <div className="truncate">
                        {r.title || <span className="text-gray-400">(untitled)</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Right: links table (sticky head, scroll body) */}
      <div className="col-span-12 lg:col-span-8 rounded-xl border bg-white">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <h3 className="text-sm font-semibold">
            Links — {mode === "REFINES" ? "Refines" : "Refined by"}
          </h3>
          <div className="inline-flex overflow-hidden rounded border">
            <button
              className={`px-2 py-1 text-xs ${mode === "REFINES" ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
              onClick={() => setMode("REFINES")}
              aria-pressed={mode === "REFINES"}
            >
              Refines
            </button>
            <button
              className={`px-2 py-1 text-xs ${mode === "REFINED_BY" ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
              onClick={() => setMode("REFINED_BY")}
              aria-pressed={mode === "REFINED_BY"}
            >
              Refined by
            </button>
          </div>
        </div>

        <div className="relative max-h-[520px] overflow-auto">
          {!viewEdges.length ? (
            <div className="p-4 text-sm text-gray-500">No links found for this view.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left">
                    {mode === "REFINES" ? "From (module item)" : "Subject (module item)"}
                  </th>
                  <th className="px-2 py-2 text-left">Relation</th>
                  <th className="px-2 py-2 text-left">
                    {mode === "REFINES" ? "To" : "Refiner"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {viewEdges.map((e, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-2 py-2">
                      <div className="leading-tight">
                        <PathLine folder={e.fromFolder} module={e.fromModule} />
                        <div className="text-[11px] text-gray-400 font-mono">{e.from}</div>
                        <div className="font-medium">
                          {e.fromTitle || <span className="text-gray-400">(untitled)</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">{e.type}</td>
                    <td className="px-2 py-2">
                      <div className="leading-tight">
                        <PathLine folder={e.toFolder} module={e.toModule} />
                        <div className="text-[11px] text-gray-400 font-mono">{e.to}</div>
                        <div className="font-medium">
                          {e.toTitle || <span className="text-gray-400">(untitled)</span>}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

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
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="value"
            value={typeof v === "string" ? v : JSON.stringify(v)}
            onChange={(e) => {
              let val = e.target.value;
              try { val = JSON.parse(val); } catch {}
              setField("attributes", { ...(form.attributes || {}), [k]: val });
            }}
          />
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
  
/**
 * Field renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param children Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Field({label, children}){ return (<label className="block"><div className="mb-1 text-xs font-medium text-gray-700">{label}</div>{children}</label>); }

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
/**
 * ReuseModal renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param projects Input consumed by this step of the xHandle workflow.
 * @param activeProjectId Stable identifier for the entity this step works with.
 * @param onCancel Callback used to notify the surrounding workflow about progress or user actions.
 * @param onApply Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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
/**
 * NewFolderModal renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param parents Input consumed by this step of the xHandle workflow.
 * @param onCancel Callback used to notify the surrounding workflow about progress or user actions.
 * @param onCreate Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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

/**
 * ImportFromHazardModal renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param onCancel Callback used to notify the surrounding workflow about progress or user actions.
 * @param onImport Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
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
function Modal({ title, onClose, children }) {
    return (
      <div className="fixed inset-0 z-[999]">
        <div
          className="absolute inset-0 bg-black/40"
          onClick={onClose}
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              <button
                className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                onClick={onClose}
              >
                ✕
              </button>
            </div>
            {/* Scrollable content area */}
            <div className="p-4 overflow-y-auto flex-1">{children}</div>
          </div>
        </div>
      </div>
    );
  }
  
