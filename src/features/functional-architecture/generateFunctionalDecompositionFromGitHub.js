/**
 * xHandle: generate functional decomposition from git hub functional-architecture workflow.
 * This file supports xHandle's functional-architecture flow, where users describe a system, generate functional decomposition rows, and turn those rows into diagram-ready structure.
 * Functional decomposition is the upstream model that later feeds hazard analysis, reporting, traceability, and other AI-assisted engineering workflows throughout the application.
 * Related files: src/App.js, src/components/diagrams/LiteSummaryDiagramReactFlow.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// 📁 generateFunctionalDecompositionFromGitHub.js

import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import LiteSummaryDiagramReactFlowGitHub from "../../components/diagrams/LiteSummaryDiagramReactFlowGitHub";
import { backendURL, buildAIAuthOpts, buildAuthOpts } from "../../lib/api/backendConfig";
import { logger } from "../../lib/utils/logger";

// --- IndexedDB helpers (xHandle durable storage, unified schema) ---
const IDB_DB_NAME = "xhandle";
const IDB_VERSION = 3; // bump to trigger upgrade across the app
const IDB_STORES = {
  codeIndex: "code_index",         // per-file code index
  cba: "copilot_baseline",         // Copilot Baseline Array rows
  positions: "diagram_positions",  // node positions for diagrams
};

/**
 * idbOpen encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Create any missing stores (idempotent)
      if (!db.objectStoreNames.contains(IDB_STORES.codeIndex)) {
        db.createObjectStore(IDB_STORES.codeIndex, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(IDB_STORES.cba)) {
        db.createObjectStore(IDB_STORES.cba, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(IDB_STORES.positions)) {
        db.createObjectStore(IDB_STORES.positions, { keyPath: "key" });
      }
    };
    req.onblocked = () => {
      // another tab holds old version open; refresh that tab to complete upgrade
      logger.warn("IndexedDB upgrade blocked; close other tabs using xHandle.");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * idbPut encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param storeName Input consumed by this step of the xHandle workflow.
 * @param key Input consumed by this step of the xHandle workflow.
 * @param value Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function idbPut(storeName, key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * idbDeleteByPrefix encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param storeName Input consumed by this step of the xHandle workflow.
 * @param prefix Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function idbDeleteByPrefix(storeName, prefix) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      if (String(cursor.key || "").startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Lightweight file indexer for Copilot grounding ---
function detectLangFromPath(path) {
  if (/\.tsx?$/.test(path)) return "ts";
  if (/\.jsx?$/.test(path)) return "js";
  if (/\.py$/.test(path)) return "py";
  if (/\.(c|cc|cpp|h|hpp)$/.test(path)) return "cpp";
  if (/\.json$/.test(path)) return "json";
  if (/\.md$/.test(path)) return "md";
  return "";
}

/**
 * extractSymbolsJS prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param source Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function extractSymbolsJS(source) {
  const fns = new Set();
  const exps = new Set();
  const fnDecl = /function\s+([A-Za-z0-9_$]+)\s*\(/g;
  const fnExpr = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(?[A-Za-z0-9_,\s]*\)?\s*=>/g;
  const meth   = /([A-Za-z0-9_$]+)\s*\([^)]*\)\s*{/g;
  const exp1   = /export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g;
  const exp2   = /export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/g;
  const exp3   = /export\s*{\s*([^}]+)\s*}/g;
  let m;
  while ((m = fnDecl.exec(source))) fns.add(m[1]);
  while ((m = fnExpr.exec(source))) fns.add(m[1]);
  while ((m = meth.exec(source))) fns.add(m[1]);
  while ((m = exp1.exec(source))) { fns.add(m[1]); exps.add(m[1]); }
  while ((m = exp2.exec(source))) exps.add(m[1]);
  while ((m = exp3.exec(source))) m[1].split(",").map(s=>s.trim().split(/\s+as\s+/)[0]).forEach(n=>exps.add(n));
  return { functions: Array.from(fns), exports: Array.from(exps) };
}

/**
 * indexSourceFileToIDB encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param owner Input consumed by this step of the xHandle workflow.
 * @param repo Input consumed by this step of the xHandle workflow.
 * @param path Input consumed by this step of the xHandle workflow.
 * @param content Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function indexSourceFileToIDB({ owner, repo, path, content }) {
  const MAX_BYTES = 80000; // keep per-file small
  const lang = detectLangFromPath(path);
  const clipped = (content || "").slice(0, MAX_BYTES);

  let functions = [];
  let exportsList = [];
  if (lang === "js" || lang === "ts") {
    try {
      const { functions: f, exports: e } = extractSymbolsJS(clipped);
      functions = f; exportsList = e;
    } catch {}
  }

  const key = `code:file:${owner}/${repo}:${path}`;
  const record = { path, lang, functions, exports: exportsList, content: clipped };

  try {
    await idbPut(IDB_STORES.codeIndex, key, record);
  } catch (e) {
    // As a last resort, no-throw fallback to localStorage (rare)
    try { localStorage.setItem(key, JSON.stringify(record)); } catch {}
  }
}

/**
 * clearIndexedFilesForRepo encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param owner Input consumed by this step of the xHandle workflow.
 * @param repo Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function clearIndexedFilesForRepo(owner, repo) {
  const prefix = `code:file:${owner}/${repo}:`;
  try {
    await idbDeleteByPrefix(IDB_STORES.codeIndex, prefix);
  } catch {
    // fallback clean if needed
    try {
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) toDelete.push(k);
      }
      toDelete.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
}


// If your tooling dislikes brackets in filenames, rename the file to
// LiteSummaryDiagramReactFlowGitHub.js and update the import accordingly.

/* =======================================================================
   NEW: Helpers + Modal to choose file types after initial scan
======================================================================= */
const LANGUAGE_GROUPS = [
  { label: "JavaScript / TypeScript", exts: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"] },
  { label: "Python", exts: [".py"] },
  { label: "Go", exts: [".go"] },
  { label: "Java / Kotlin", exts: [".java", ".kt", ".kts"] },
  { label: "C / C++", exts: [".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"] },
  { label: "Rust", exts: [".rs"] },
  { label: "Ruby", exts: [".rb"] },
  { label: "PHP", exts: [".php"] },
  { label: "Shell", exts: [".sh", ".bash", ".zsh"] },
  { label: "Config / Infra", exts: [".yml", ".yaml", ".json", ".toml", ".ini", ".env", ".tf", ".tfvars", ".dockerfile", "Dockerfile"] },
  { label: "Web Assets", exts: [".html", ".css", ".scss", ".sass", ".vue", ".svelte"] },
  { label: "Docs", exts: [".md", ".rst"] },
];

/**
 * extOf encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param path Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function extOf(path) {
  const base = path.split("/").pop() || path;
  if (base === "Dockerfile") return "Dockerfile";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * tallyExtensions encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param files Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function tallyExtensions(files) {
  const map = new Map();
  for (const f of files) {
    const e = extOf(f.path);
    map.set(e, (map.get(e) || 0) + 1);
  }
  return map;
}

/**
 * FileTypeSelectorModal renders a React component. It gives users access to functional-architecture authoring and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param open Input consumed by this step of the xHandle workflow.
 * @param files Input consumed by this step of the xHandle workflow.
 * @param onCancel Callback used to notify the surrounding workflow about progress or user actions.
 * @param onConfirm Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export function FileTypeSelectorModal({ open, files, onCancel, onConfirm }) {
  const counts = React.useMemo(() => tallyExtensions(files || []), [files]);
  const defaultSelected = React.useMemo(
    () =>
      new Set(
        [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py"].filter((e) => counts.get(e) > 0)
      ),
    [counts]
  );
  const [selected, setSelected] = React.useState(defaultSelected);

  React.useEffect(() => {
    setSelected(defaultSelected);
  }, [defaultSelected]);

  const toggleExt = (e) => {
    const next = new Set(selected);
    next.has(e) ? next.delete(e) : next.add(e);
    setSelected(next);
  };

  const toggleGroup = (group) => {
    const next = new Set(selected);
    const present = group.exts.filter((e) => counts.get(e) > 0);
    const anyUnchecked = present.some((e) => !next.has(e));
    present.forEach((e) => (anyUnchecked ? next.add(e) : next.delete(e)));
    setSelected(next);
  };

  const selectAll = () => {
    const next = new Set();
    counts.forEach((_, e) => next.add(e));
    setSelected(next);
  };
  const selectNone = () => setSelected(new Set());

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
      <div className="w-[680px] max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-xl border">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Choose file types to include</h3>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-auto max-h-[60vh]">
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-2.5 py-1.5 text-sm rounded bg-slate-100 hover:bg-slate-200"
            >
              Select all
            </button>
            <button
              onClick={selectNone}
              className="px-2.5 py-1.5 text-sm rounded bg-slate-100 hover:bg-slate-200"
            >
              Select none
            </button>
          </div>

          {LANGUAGE_GROUPS.map((g) => {
            const present = g.exts.filter((e) => counts.get(e) > 0);
            if (!present.length) return null;
            const allIn = present.every((e) => selected.has(e));
            return (
              <div key={g.label} className="border rounded-lg">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
                  <div className="font-medium">{g.label}</div>
                  <button
                    onClick={() => toggleGroup(g)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {allIn ? "Uncheck group" : "Check group"}
                  </button>
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                  {present.map((e) => (
                    <label key={e} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(e)}
                        onChange={() => toggleExt(e)}
                      />
                      <span className="font-mono">{e}</span>
                      <span className="text-slate-500">({counts.get(e)})</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded bg-slate-100 hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(Array.from(selected))}
            className="px-3 py-2 rounded bg-[#2D7DFE] text-white hover:bg-[#1E61D6]"
          >
            Include {selected.size} type{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== utils: regex + path helpers ===================== */

// JS: handle both `require('x')` and `import ... from 'x'`
const importRegexJS =
  /(?:import\s+.*?\s+from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g;

// PY:  from pkg.mod import X   OR   import pkg.mod
const importRegexPY =
  /(?:from\s+([a-zA-Z0-9_.]+)\s+import|import\s+([a-zA-Z0-9_.]+))/g;

/**
 * normalizePath prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param basePath Input consumed by this step of the xHandle workflow.
 * @param importPath Input consumed by this step of the xHandle workflow.
 * @param isJS Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizePath(basePath, importPath, isJS) {
  const baseParts = basePath.split("/").slice(0, -1);
  const parts = importPath.split("/");
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  let candidate = baseParts.join("/");
  const hasExt = /\.[a-zA-Z0-9]+$/.test(candidate);
  if (!hasExt) candidate += isJS ? ".js" : ".py";
  return candidate;
}

// Best-effort resolver for absolute Python imports against files in the repo.
// raw like "pkg.mod.submod" → try "pkg/mod/submod.py" then "pkg/mod/submod/__init__.py"
function resolvePythonAbsolute(raw, repoFilesSet) {
  const dotted = raw.replace(/\./g, "/");
  const candidates = [`${dotted}.py`, `${dotted}/__init__.py`];
  return candidates.find((p) => repoFilesSet.has(p)) || null;
}

/* ===================== GitHub helper layer (no backend dependency) ===================== */

const githubHeaders = (token) =>
  token
    ? {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      }
    : { Accept: "application/vnd.github.v3+json" };

/**
 * jsonFetch encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param url Input consumed by this step of the xHandle workflow.
 * @param opts Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function jsonFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const err = new Error(`HTTP ${r.status} ${r.statusText} - ${t}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/**
 * getDefaultBranch reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param owner Input consumed by this step of the xHandle workflow.
 * @param repo Input consumed by this step of the xHandle workflow.
 * @param token Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the normalized data requested by this module.
 */
async function getDefaultBranch(owner, repo, token) {
  try {
    const j = await jsonFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: githubHeaders(token) }
    );
    return j.default_branch || "main";
  } catch {
    // Fallback heuristics
    return "main";
  }
}

/**
 * List repo files using GitHub Trees API (includes sha for faster blob reads).
 * Returns array: [{ path, name, sha }]
 */
async function listRepoFilesViaGitHub(owner, repo, token, ref) {
  try {
    const tree = await jsonFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { headers: githubHeaders(token) }
    );
    const blobs = (tree.tree || []).filter((n) => n.type === "blob");
    return blobs.map((b) => ({
      path: b.path,
      name: b.path.split("/").pop(),
      sha: b.sha,
    }));
  } catch (e) {
    // Try master as a quick extra attempt
    if (ref !== "master") {
      try {
        const tree = await jsonFetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo
          )}/git/trees/master?recursive=1`,
          { headers: githubHeaders(token) }
        );
        const blobs = (tree.tree || []).filter((n) => n.type === "blob");
        return blobs.map((b) => ({
          path: b.path,
          name: b.path.split("/").pop(),
          sha: b.sha,
        }));
      } catch (e2) {
        throw e;
      }
    }
    throw e;
  }
}

/**
 * Fetch file content with preference:
 * 1) Git Data blob by sha (requires token) → base64 decode
 * 2) Contents API (optionally with ref) → base64 decode
 * 3) Raw URL (main/master) → text
 */
async function fetchGitHubFileDirect({ owner, repo, path, token, ref, sha }) {
  // 1) Blob by sha (best for private repos; compact + no extra preflights beyond CORS)
  if (token && sha) {
    try {
      const j = await jsonFetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo
        )}/git/blobs/${encodeURIComponent(sha)}`,
        { headers: githubHeaders(token) }
      );
      if (j && j.content && j.encoding === "base64") {
        try {
          return { ok: true, content: atob(j.content.replace(/\n/g, "")) };
        } catch {}
      }
    } catch {}
  }

  // 2) Contents API
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/contents/${encodeURI(path.replace(/^\/+/, ""))}${
      ref ? `?ref=${encodeURIComponent(ref)}` : ""
    }`;
    const j = await jsonFetch(url, { headers: githubHeaders(token) });
    if (j?.content && j?.encoding === "base64") {
      try {
        return { ok: true, content: atob(j.content.replace(/\n/g, "")) };
      } catch {}
    }
    if (typeof j?.content === "string") {
      return { ok: true, content: j.content };
    }
  } catch {}

  // 3) Raw (public repos)
  const candidates = [ref, "main", "master"].filter(Boolean);
  for (const r of candidates) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/${encodeURIComponent(r)}/${encodeURI(path.replace(/^\/+/, ""))}`;
      const resp = await fetch(rawUrl); // no creds, no custom headers → very CORS-friendly
      if (resp.ok) {
        return { ok: true, content: await resp.text() };
      }
    } catch {}
  }

  return { ok: false };
}

/* ===================== Remove backend dependency for file contents ===================== */
/* (kept name for minimal_surface change; now prefers GitHub paths and never puts token in URLs) */
async function fetchGitHubFileSmart({ backendURL: _unused, owner, repo, path, token, accountId: _acc, bearer: _bearer, ref, sha }) {
  // Direct GitHub attempts only; no token in URLs, no backend state required
  return fetchGitHubFileDirect({ owner, repo, path, token, ref, sha });
}

if (typeof window !== "undefined") {
  window.fetchGitHubFileSmart = fetchGitHubFileSmart;
}

/* ===================== Chunking helpers ===================== */

const MAX_CHARS_PER_PROMPT = 12000; // ~3k tokens of code
const CHUNK_OVERLAP_CHARS = 400;

/**
 * chunkTextWithOverlap encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param text Input consumed by this step of the xHandle workflow.
 * @param maxLen Input consumed by this step of the xHandle workflow.
 * @param overlap Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function chunkTextWithOverlap(text, maxLen = MAX_CHARS_PER_PROMPT, overlap = CHUNK_OVERLAP_CHARS) {
  if (!text || text.length <= maxLen) return [text];
  const lines = text.split("\n");
  const chunks = [];
  let current = [];
  let currentLen = 0;

  const pushChunk = () => {
    if (current.length) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (currentLen + line.length + 1 > maxLen) {
      pushChunk();
      if (overlap > 0 && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        const tail = prev.slice(Math.max(0, prev.length - overlap));
        current.push(tail);
        currentLen += tail.length;
      }
    }
    current.push(line);
    currentLen += line.length + 1; // + newline
  }
  pushChunk();
  return chunks;
}

/**
 * makeChunkHeader encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param path Input consumed by this step of the xHandle workflow.
 * @param idx Input consumed by this step of the xHandle workflow.
 * @param total Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function makeChunkHeader(path, idx, total) {
  return `// File: ${path}\n// Part ${idx + 1} of ${total}\n\n`;
}

/* ===================== Lightweight concurrency limiter ===================== */

async function mapPool(items, limit, mapper) {
  const ret = [];
  let i = 0;
  const running = new Set();

  async function runOne(idx) {
    const p = Promise.resolve().then(() => mapper(items[idx], idx));
    running.add(p);
    try {
      const v = await p;
      ret[idx] = v;
    } finally {
      running.delete(p);
      if (i < items.length) {
        await runOne(i++);
      }
    }
  }

  while (i < items.length && running.size < limit) {
    await runOne(i++);
  }
  while (running.size) {
    await Promise.race(running);
  }
  return ret;
}

/* ===================== graph builder ===================== */
function buildDependencyGraph(files) {
  const graph = {};
  const repoFilesSet = new Set(files.map((f) => f.path));

  for (const file of files) {
    const deps = new Set();
    const isJS = /\.(mjs|cjs|js|jsx|ts|tsx)$/i.test(file.path);
    const isPY = /\.py$/i.test(file.path);

    if (!isJS && !isPY) {
      graph[file.path] = [];
      continue;
    }

    const regex = isJS ? importRegexJS : importRegexPY;
    let match;
    while ((match = regex.exec(file.content))) {
      const rawPath = match[1] || match[2];
      if (!rawPath) continue;

      if (isJS) {
        if (!rawPath.startsWith(".")) continue; // skip node_modules/aliases
        const normalized = normalizePath(file.path, rawPath, /*isJS=*/ true);
        if (repoFilesSet.has(normalized)) deps.add(normalized);
      } else {
        if (rawPath.startsWith(".")) {
          const normalized = normalizePath(file.path, rawPath, /*isJS=*/ false);
          if (repoFilesSet.has(normalized)) deps.add(normalized);
        } else {
          const resolved = resolvePythonAbsolute(rawPath, repoFilesSet);
          if (resolved) deps.add(resolved);
        }
      }
    }

    graph[file.path] = [...deps];
  }
  return graph;
}

// ===================== entry-point detection =====================
function autoDetectEntryPoints(parsedFiles) {
  const candidates = [
    "src/index.tsx",
    "src/index.ts",
    "src/index.jsx",
    "src/index.js",
    "index.tsx",
    "index.ts",
    "index.jsx",
    "index.js",
    "src/main.tsx",
    "src/main.ts",
    "src/main.jsx",
    "src/main.js",
    "server.ts",
    "server.js",
    "app.ts",
    "app.js",
    // Python
    "main.py",
    "app.py",
    "__main__.py",
  ];

  const paths = new Set(parsedFiles.map((f) => f.path));
  const found = candidates.filter((p) => paths.has(p));
  if (found.length > 0) return found;

  return parsedFiles.map((f) => f.path).filter((p) => /\.(mjs|cjs|js|jsx|ts|tsx|py)$/i.test(p));
}

// ===================== reachability =====================
function getReachableFiles(entryFiles, graph) {
  const visited = new Set();
  const stack = [...entryFiles];

  while (stack.length > 0) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = graph[current] || [];
    neighbors.forEach((dep) => {
      if (!visited.has(dep)) stack.push(dep);
    });
  }

  return visited;
}

/* =======================================================================
   UPDATED: main export supports a 4th opts arg with onChooseFileTypes
   opts = {
     preselectedPaths?: string[]
     onChooseFileTypes?: ({files}) => Promise<string[]>  // array of extensions
   }
   Files are chunked for LLM if they exceed MAX_CHARS_PER_PROMPT.
   NOW: No dependency on POST /api/config/repo or /api/github/repo-files.
======================================================================= */
export const generateFunctionalDecompositionFromGitHub = async (
  setTableData,
  setLoading,
  filterFiles = null,
  opts = {}
) => {
  try {
    setLoading(true);
    logger.debug("🔄 Starting functional decomposition generation from GitHub...");

    // pull owner/repo/token the user saved in Settings
    const owner = localStorage.getItem("repoOwner");
    const repo = localStorage.getItem("repoName");
    const token = localStorage.getItem("githubToken") || undefined;
    if (!owner || !repo) throw new Error("Missing owner/repo. Save them in Settings → GitHub first.");

    // Determine ref/branch once up front
    const ref = await getDefaultBranch(owner, repo, token);
    await clearIndexedFilesForRepo(owner, repo);

    // List all repo files via GitHub Trees API (no backend state)
    const allFiles = await listRepoFilesViaGitHub(owner, repo, token, ref);
    if (!allFiles.length) throw new Error("No files found in GitHub repository.");

    // Exclude heavy/vendor dirs; allow all extensions for modal selection
    const VENDOR_EXCLUDES = [
      "venv/",
      "site-packages/",
      "node_modules/",
      ".git/",
      ".next/",
      "dist/",
      "build/",
      "target/",
      "__pycache__/",
      "coverage/",
    ];
    const isVendor = (p) => VENDOR_EXCLUDES.some((s) => p.includes(s));
    const candidates = allFiles.filter((f) => !isVendor(f.path));

    // Determine which files to include
    let selectedFiles;
    if (opts?.preselectedPaths?.length) {
      const set = new Set(opts.preselectedPaths);
      selectedFiles = candidates.filter((f) => set.has(f.path));
    } else if (typeof opts?.onChooseFileTypes === "function") {
      const chosenExts = await opts.onChooseFileTypes({ files: candidates });
      const chosen = new Set((chosenExts || []).map((e) => e.toLowerCase()));
      selectedFiles = candidates.filter((f) => chosen.has(extOf(f.path)));
    } else {
      // Back-compat fallback: only JS/TS/Python if no modal provided
      selectedFiles = candidates.filter((f) => /\.(mjs|cjs|js|jsx|ts|tsx|py)$/i.test(f.path));
    }

    // Back-compat direct path filtering (old callers)
    const finalList = filterFiles
      ? selectedFiles.filter((f) => filterFiles.includes(f.path))
      : selectedFiles;

    if (!finalList.length) throw new Error("No matching files after filters.");

    // Fetch file contents with small concurrency to reduce preflight/CORS churn
    const CONCURRENCY = 6;
    const githubFiles = (await mapPool(finalList, CONCURRENCY, async (file) => {
      const got = await fetchGitHubFileSmart({
        backendURL, // unused now
        owner,
        repo,
        path: file.path,
        token,
        ref,
        sha: file.sha,
      });
      if (!got.ok) {
        logger.warn("skip file (all sources failed):", file.path);
        return null;
      }
      
      // NEW: index raw source for Copilot grounding
      try {
        await indexSourceFileToIDB({
          owner,
          repo,
          path: file.path,
          content: got.content,
        });
      } catch {}
      
      return {
        name: file.name,
        path: file.path,
        content: `// File: ${file.path}\n\n${got.content}`,
        raw: got.content,
      };      
    })).filter(Boolean);

    // Build graph (deps only for JS/TS + Python) and auto-detect entry points
    const dependencyGraph = buildDependencyGraph(githubFiles.map((f) => ({ path: f.path, content: f.content })));
    let entryPoints = autoDetectEntryPoints(githubFiles.map((f) => ({ path: f.path, content: f.content })));
    let reachable = getReachableFiles(entryPoints, dependencyGraph);

    // Final valid set: prefer reachable; else small fallback to keep UX moving
    let validFiles;
    if (filterFiles) {
      validFiles = githubFiles.filter((file) => filterFiles.includes(file.path));
    } else if (reachable.size > 0) {
      validFiles = githubFiles.filter((file) => reachable.has(file.path));
    } else {
      validFiles = githubFiles.filter((f) => /\.(mjs|cjs|js|jsx|ts|tsx|py)$/i.test(f.path)).slice(0, 20);
    }

    logger.debug("📁 Reachable files for decomposition:", validFiles.map((f) => f.path));
    logger.debug("📄 Files ready for ingestion:", validFiles.map((f) => f.path));

    const prompt = `
You are an expert systems engineer who is reverse engineering the design of a system from its codebase using the following steps:

Step 1: Review each file and develop a detailed understanding of what it is doing functionally.
Step 2: Develop a detailed narrative of how these functions interact with each other (what information is being exchanged through inputs and outputs, shared state, APIs, etc.).
Step 3: From your analysis, derive a structured list of interactions between functions in the system. For each interaction, provide the following columns:

| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |

Rules:
- Output only the markdown table; no commentary or code.
- "Function (From)" and "Function (To)" must be 2–3 word phrases (no periods).
- Use multi-sentence prose for both Details fields.
- "Control Action" should be an imperative verb phrase.
- Include file extensions in Related File(s) columns.
- Every row must have all columns populated.
- Keep control action details in base form tense.
    `.trim();

    let allTableData = [];

    for (const file of validFiles) {
      try {
        const fileBody = file.raw ?? file.content;
        const chunks = chunkTextWithOverlap(fileBody, MAX_CHARS_PER_PROMPT, CHUNK_OVERLAP_CHARS);
        const total = chunks.length;

        for (let i = 0; i < total; i++) {
          const header = makeChunkHeader(file.path, i, total);
          const chunkedContent = header + chunks[i];

          logger.debug(
            `📤 Sending ${file.path} chunk ${i + 1}/${total} to LLM (len=${chunkedContent.length})`
          );
          const filePrompt = `${prompt}\n\n${chunkedContent}`;

          const llmResponse = await fetch(`${backendURL}/api/chat`, {
            method: "POST",
            ...buildAIAuthOpts({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: filePrompt }],
            }),
          });

          if (!llmResponse.ok) {
            throw new Error(`LLM HTTP ${llmResponse.status}`);
          }

          const llmJson = await llmResponse.json();
          const result = llmJson?.choices?.[0]?.message?.content || "";
          logger.debug(
            `📥 LLM result for ${file.path} [part ${i + 1}/${total}]:\n`,
            (result || "").slice(0, 500)
          );

          const lines = (result || "").split("\n").filter((l) => l.trim().startsWith("|"));
          const rows = lines.slice(2);

          const tableData = rows
            .map((row, index) => {
              const cols = row.split("|").map((c) => c.trim());
              if (cols.length < 9) {
                logger.warn(
                  `⚠️ Skipping row ${index} (${file.path} part ${i + 1}) due to unexpected column count:`,
                  cols
                );
                return null;
              }
              const [
                ,
                from,
                fromFile,
                fromDetails,
                controlAction,
                controlActionDetails,
                to,
                toFile,
                toDetails,
              ] = cols;

              return {
                from,
                fromFile,
                fromDetails,
                action: controlAction,
                controlActionDetails,
                to,
                toFile,
                toDetails,
              };
            })
            .filter(Boolean);

          allTableData.push(...tableData);

          // tiny throttle helps avoid transient 502/Fetch errors
          await new Promise((r) => setTimeout(r, 120));
        }
      } catch (e) {
        logger.warn(`LLM failed for ${file.path}:`, e);
      }
    }

    setTableData(allTableData);

    // NEW: make rows available to Copilot (read via cba:owner/repo)
    try {
      await idbPut(IDB_STORES.cba, `cba:${owner}/${repo}`, allTableData);
    } catch {}
    
    logger.debug("📊 Parsed table rows:", allTableData.length);
    return allTableData;
    
  } catch (error) {
    logger.error("🚨 Failed to generate functional decomposition:", error);
    setTableData([]);
  } finally {
    setLoading(false);
  }
};

/* =======================================================================
   OPTIONAL: Ready-made launcher button that pops the modal and calls the
   generator with the user's file-type choices.
======================================================================= */
export function GitHubDecomposeLauncher({ setTableData, setLoading, buttonClassName }) {
  const [open, setOpen] = useState(false);
  const [filesForModal, setFilesForModal] = useState([]);
  const resolverRef = useRef(null);

  const onChooseFileTypes = React.useCallback(({ files }) => {
    setFilesForModal(files);
    setOpen(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const confirm = (exts) => {
    setOpen(false);
    resolverRef.current?.(exts || []);
  };
  const cancel = () => {
    setOpen(false);
    resolverRef.current?.([]);
  };

  const run = async () => {
    await generateFunctionalDecompositionFromGitHub(setTableData, setLoading, null, {
      onChooseFileTypes, // ← shows modal after scan
    });
  };

  return (
    <>
      <button
        onClick={run}
        className={buttonClassName || "px-3 py-2 rounded bg-[#2D7DFE] text-white hover:bg-[#1E61D6] text-sm"}
      >
        Scan GitHub & Choose Types
      </button>

      <FileTypeSelectorModal open={open} files={filesForModal} onCancel={cancel} onConfirm={confirm} />
    </>
  );
}

// ===================== table/diagram component =====================
export const FunctionalDecompositionTable = ({
  data,
  repoId = "repo",
  branch = "main",
  onRequestCreateProject,
}) => {
  const [manualData, setManualData] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const [view, setView] = useState("diagram"); // default to diagram
  const [cleanOnceKey, setCleanOnceKey] = useState(() => `clean-${Date.now()}`); // one-time arrange on first open
  const diagramRef = useRef(null);

  const storageKey = useMemo(() => `diagram:github:${repoId}:${branch}`, [repoId, branch]);

  // Derive display repo name from saved GitHub settings
const repoName = useMemo(() => {
  const owner = localStorage.getItem("repoOwner") || "";
  const repo  = localStorage.getItem("repoName") || "";
  return owner && repo ? `${owner}/${repo}` : (repo || repoId || "");
}, [repoId]);

  const REQUIRED_COLUMNS = [
    "Function (From)",
    "Function (From) Related File(s)",
    "Function (From) Details",
    "Control Action",
    "Control Action Details",
    "Function (To)",
    "Function (To) Related File(s)",
    "Function (To) Details",
  ];

  const handleFileImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (file.name.endsWith(".json")) {
          const parsed = JSON.parse(e.target.result);
          if (Array.isArray(parsed)) setManualData(parsed);
          else logger.error("❌ Uploaded JSON must be an array.");
        } else if (file.name.endsWith(".xlsx")) {
          const workbook = XLSX.read(e.target.result, { type: "binary" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const parsed = XLSX.utils.sheet_to_json(sheet);

          if (!Array.isArray(parsed)) {
            logger.error("❌ Uploaded Excel must contain a flat row array.");
            return;
          }
          const headers = Object.keys(parsed[0] || {});
          const hasAll = REQUIRED_COLUMNS.every((c) => headers.includes(c));
          if (!hasAll) {
            alert(
              "❌ Excel file is missing one or more required columns:\n\n" + REQUIRED_COLUMNS.join(", ")
            );
            return;
          }

          const mapped = parsed.map((row) => ({
            from: row["Function (From)"],
            fromFile: row["Function (From) Related File(s)"],
            fromDetails: row["Function (From) Details"],
            action: row["Control Action"],
            controlActionDetails: row["Control Action Details"],
            to: row["Function (To)"],
            toFile: row["Function (To) Related File(s)"],
            toDetails: row["Function (To) Details"],
          }));
          setManualData(mapped);
        } else {
          logger.error("❌ Unsupported file type.");
        }
      } catch (err) {
        logger.error("❌ Failed to parse file:", err);
      }
    };
    reader.readAsBinaryString(file); // needed for xlsx
  };

  const diagramRows = useMemo(() => {
    const src = manualData || data || [];
    return src.map((r) => ({
      fromFunction: r.from,
      fromFile: r.fromFile,
      fromDetails: r.fromDetails,
      controlAction: r.action,
      controlDetails: r.controlActionDetails,
      toFunction: r.to,
      toFile: r.toFile,
      toDetails: r.toDetails,
    }));
  }, [manualData, data]);

  // --- file filter helpers/state for the left sidebar ---
function primaryFile(cell) {
  if (!cell || typeof cell !== "string") return "Unfiled";
  const first = cell.split(/[,;]+/)[0].trim();
  return first || "Unfiled";
}

const uniqueFiles = useMemo(() => {
  const s = new Set();
  (diagramRows || []).forEach((r) => {
    if (r.fromFile) s.add(primaryFile(r.fromFile));
    if (r.toFile) s.add(primaryFile(r.toFile));
  });
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}, [diagramRows]);

const [includedFiles, setIncludedFiles] = useState(uniqueFiles);

// keep selection in sync with data changes
React.useEffect(() => {
  setIncludedFiles(uniqueFiles);
}, [uniqueFiles]);

const [fileQuery, setFileQuery] = useState("");
const filteredList = useMemo(() => {
  const q = fileQuery.trim().toLowerCase();
  if (!q) return uniqueFiles;
  return uniqueFiles.filter((f) => f.toLowerCase().includes(q));
}, [fileQuery, uniqueFiles]);

  const thBase =
    "sticky top-0 z-10 bg-indigo-50 text-slate-700 font-semibold text-[13px] uppercase tracking-wide border-b border-slate-200 px-3 py-2";
  const tdBase = "border-b border-slate-100 px-3 py-2 align-top text-[13px] text-slate-800";

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <button
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2D7DFE] text-white text-sm disabled:opacity-60"
            onClick={() => {
              const next = view === "diagram" ? "table" : "diagram";
              setView(next);
              if (next === "diagram") setCleanOnceKey(`clean-${Date.now()}`);
            }}
          >
            {view === "diagram" ? "Table" : "Diagram"}
          </button>
          {/* Optional: file import */}
          <label className="px-3 py-2 rounded bg-slate-100 hover:bg-slate-200 text-sm cursor-pointer">
            Import .xlsx/.json
            <input type="file" accept=".xlsx,.json" className="hidden" onChange={handleFileImport} />
          </label>
        </div>
      </div>

      {/* Surface */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {view === "diagram" ? (
  <div className="p-0">
    <div className="flex min-h-[560px]">
      {/* Left sidebar */}
      <aside
  className={`${collapsed ? "w-10" : "w-64"} transition-all duration-200 border-r bg-white relative`}
>
  {/* Collapse/expand button */}
  <button
    onClick={() => setCollapsed((v) => !v)}
    className="absolute right-1 top-3 z-10 rounded-full border bg-white px-2 py-1 text-xs shadow"
    aria-label={collapsed ? "Expand filters" : "Collapse filters"}
    title={collapsed ? "Expand" : "Collapse"}
  >
    {collapsed ? "›" : "‹"}
  </button>

  {/* Sidebar content only when expanded */}
  {!collapsed && (
    <div className="p-3">
      <div className="font-semibold text-sm mb-2">Files</div>

      <div className="mb-2">
        <input
          value={fileQuery}
          onChange={(e) => setFileQuery(e.target.value)}
          placeholder="Search files…"
          className="w-full rounded-md border px-2 py-1 text-sm"
        />
      </div>

      <div className="flex items-center gap-2 mb-3 text-xs">
        <button
          type="button"
          onClick={() => setIncludedFiles(uniqueFiles)}
          className="px-2 py-1 rounded border hover:bg-gray-50"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => setIncludedFiles([])}
          className="px-2 py-1 rounded border hover:bg-gray-50"
        >
          Clear all
        </button>
      </div>

      <div className="max-h-[480px] overflow-auto space-y-1 pr-1">
        {filteredList.map((f) => {
          const checked = includedFiles.includes(f);
          return (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={checked}
                onChange={(e) => {
                  setIncludedFiles((prev) => {
                    if (e.target.checked) return [...new Set([...prev, f])];
                    return prev.filter((x) => x !== f);
                  });
                }}
              />
              <span className="truncate" title={f}>
                {f}
              </span>
            </label>
          );
        })}
        {filteredList.length === 0 && (
          <div className="text-xs text-slate-500">No matches</div>
        )}
      </div>
    </div>
  )}
</aside>


      {/* Diagram surface */}
      <div className="flex-1 p-3">
        <LiteSummaryDiagramReactFlowGitHub
          ref={diagramRef}
          rows={diagramRows}
          onUpdateRows={(nextRows) => {
            const backMapped = nextRows.map((r) => ({
              from: r.fromFunction,
              fromFile: r.fromFile || "",
              fromDetails: r.fromDetails,
              action: r.controlAction,
              controlActionDetails: r.controlDetails,
              to: r.toFunction,
              toFile: r.toFile || "",
              toDetails: r.toDetails,
            }));
            if (manualData) setManualData(backMapped);
          }}
          repoName={repoName}
          storageKey={storageKey}
          cleanOnceKey={cleanOnceKey}
          onCleanApplied={() => setCleanOnceKey(null)}
          onRequestCreateProject={onRequestCreateProject}
          includeFiles={includedFiles}   // ← pass selection to diagram
        />
      </div>
    </div>
  </div>
) : (

          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-indigo-50/80">
                  <th className={`${thBase} w-[14%]`}>Function (From)</th>
                  <th className={`${thBase} w-[14%]`}>Function (From) Related File(s)</th>
                  <th className={`${thBase} w-[18%]`}>Function (From) Details</th>
                  <th className={`${thBase} w-[12%]`}>Control Action</th>
                  <th className={`${thBase} w-[18%]`}>Control Action Details</th>
                  <th className={`${thBase} w-[14%]`}>Function (To)</th>
                  <th className={`${thBase} w-[14%]`}>Function (To) Related File(s)</th>
                  <th className={`${thBase} w-[18%]`}>Function (To) Details</th>
                </tr>
              </thead>
              <tbody>
                {(manualData || data || []).map((row, i) => (
                  <tr
                    key={i}
                    className={i % 2 ? "bg-slate-50/60 hover:bg-slate-100" : "bg-white hover:bg-slate-50"}
                  >
                    <td className={tdBase}>{row.from}</td>
                    <td className={tdBase}>{row.fromFile}</td>
                    <td className={tdBase}>{row.fromDetails}</td>
                    <td className={tdBase}>{row.action}</td>
                    <td className={tdBase}>{row.controlActionDetails}</td>
                    <td className={tdBase}>{row.to}</td>
                    <td className={tdBase}>{row.toFile}</td>
                    <td className={tdBase}>{row.toDetails}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
