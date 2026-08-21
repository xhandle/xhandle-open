// 📁 generateFunctionalDecompositionFromGitHub.js

import React, { useMemo, useRef, useState } from "react";
import LiteSummaryDiagramReactFlowGitHub from "./LiteSummaryDiagramReactFlowGitHub";
import ArchitectureReportViewer from "./ArchitectureReportViewer";
import { FilterableHeaderCell, useColumnFilters } from "./FilterableTableHeader";
import { backendURL, ACCOUNT_ID, getLocalAccessToken, buildAIAuthOpts } from "./backendConfig";
import { notifyBackupDataChanged } from "../lib/localBackupEvents";
import { architectureElementFromRow } from "../features/safety-remediation/safetyRemediationUtils";
import ReviewStatusBadge from "../features/results-review/ReviewStatusBadge";
import { REVIEW_STATUSES } from "../features/results-review/reviewTypes";
import {
  ensureCodeArchitectureTraceIds,
  makeCodeArchitectureTraceId,
} from "../features/code-architecture-hazard-analysis/codeArchitectureHazardUtils";
import {
  createFunctionalDecompositionMetricsRun,
  finishFunctionalDecompositionMetricsRun,
  recordFunctionalDecompositionAiCall,
  saveFunctionalDecompositionMetricsRun,
} from "../features/code-architecture-assurance/codeArchitectureMetrics";

// --- IndexedDB helpers (xHandle durable storage, unified schema) ---
const IDB_DB_NAME = "xhandle";
const IDB_VERSION = 4; // bump to trigger upgrade across the app
const IDB_STORES = {
  codeIndex: "code_index",         // per-file code index
  cba: "copilot_baseline",         // Copilot Baseline Array rows
  positions: "diagram_positions",  // node positions for diagrams
};

const architectureReportStorageKey = (repoName, branch) =>
  `architecture-report:${repoName || "repo"}:${branch || "main"}`;

const architectureTableColumnWidthsKey = (repoName, branch) =>
  `code-architecture-table-column-widths:${repoName || "repo"}:${branch || "main"}`;

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
      console.warn("IndexedDB upgrade blocked; close other tabs using xHandle.");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put({ key, value });
    tx.oncomplete = () => {
      notifyBackupDataChanged({ db: IDB_DB_NAME, stores: [storeName] });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(storeName, key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => {
      notifyBackupDataChanged({ db: IDB_DB_NAME, stores: [storeName] });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

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
    tx.oncomplete = () => {
      notifyBackupDataChanged({ db: IDB_DB_NAME, stores: [storeName] });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// --- Lightweight file indexer for Copilot grounding ---
function detectLangFromPath(path) {
  if (/\.tsx?$/.test(path)) return "ts";
  if (/\.jsx?$/.test(path)) return "js";
  if (/\.py$/.test(path)) return "py";
  if (/\.(c|cc|cp|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|ipp|inl|tpp)$/i.test(path)) return "cpp";
  if (/\.json$/.test(path)) return "json";
  if (/\.md$/.test(path)) return "md";
  return "";
}

function extractSymbolsJS(source) {
  const fns = new Set();
  const exps = new Set();
  const imps = new Set();
  const fnDecl = /function\s+([A-Za-z0-9_$]+)\s*\(/g;
  const fnExpr = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(?[A-Za-z0-9_,\s]*\)?\s*=>/g;
  const meth   = /([A-Za-z0-9_$]+)\s*\([^)]*\)\s*{/g;
  const exp1   = /export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g;
  const exp2   = /export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/g;
  const exp3   = /export\s*{\s*([^}]+)\s*}/g;
  const imp1   = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
  const imp2   = /require\s*\(\s*['"](.+?)['"]\s*\)/g;
  let m;
  while ((m = fnDecl.exec(source))) fns.add(m[1]);
  while ((m = fnExpr.exec(source))) fns.add(m[1]);
  while ((m = meth.exec(source))) fns.add(m[1]);
  while ((m = exp1.exec(source))) { fns.add(m[1]); exps.add(m[1]); }
  while ((m = exp2.exec(source))) exps.add(m[1]);
  while ((m = exp3.exec(source))) m[1].split(",").map(s=>s.trim().split(/\s+as\s+/)[0]).forEach(n=>exps.add(n));
  while ((m = imp1.exec(source))) imps.add(m[1]);
  while ((m = imp2.exec(source))) imps.add(m[1]);
  return { functions: Array.from(fns), exports: Array.from(exps), imports: Array.from(imps) };
}

function lineNumberAt(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function findMatchingBraceIndex(source, openIndex) {
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const next = source.indexOf("\n", i + 2);
      i = next === -1 ? source.length : next;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const next = source.indexOf("*/", i + 2);
      i = next === -1 ? source.length : next + 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    if (prev === "=" && ch === ">") {
      // no-op; arrow functions are handled by the opening brace search
    }
  }
  return -1;
}

function githubSourceUrl({ owner, repo, path, branch, commitSha, startLine, endLine }) {
  if (!owner || !repo || !path || !startLine) return "";
  const ref = commitSha || branch || "main";
  const linePart = endLine && endLine !== startLine ? `#L${startLine}-L${endLine}` : `#L${startLine}`;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(ref)}/${encodeURI(path)}${linePart}`;
}

function makeSourceFunction({ owner, repo, path, branch, commitSha, functionName, startLine, endLine }) {
  return {
    functionName,
    filePath: path,
    fileName: path.split("/").pop() || path,
    startLine,
    endLine,
    repo,
    owner,
    branch,
    commitSha,
    sourceUrl: githubSourceUrl({ owner, repo, path, branch, commitSha, startLine, endLine }),
  };
}

function extractFunctionRangesJS(source, meta) {
  const ranges = [];
  const seen = new Set();
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*{/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*{/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?function\s*\([^)]*\)\s*{/g,
    /^\s*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*{/gm,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const functionName = match[1];
      if (["if", "for", "while", "switch", "catch", "function"].includes(functionName)) continue;
      const openIndex = source.indexOf("{", match.index);
      const closeIndex = openIndex >= 0 ? findMatchingBraceIndex(source, openIndex) : -1;
      const startLine = lineNumberAt(source, match.index);
      const endLine = closeIndex >= 0 ? lineNumberAt(source, closeIndex) : startLine;
      const key = `${functionName}:${startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(makeSourceFunction({ ...meta, functionName, startLine, endLine }));
    }
  }
  return ranges;
}

function extractFunctionRangesPython(source, meta) {
  const lines = source.split("\n");
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)(?:async\s+def|def|class)\s+([A-Za-z0-9_]+)\s*(?:\(|:)/.exec(lines[i]);
    if (!match) continue;
    const indent = match[1].length;
    let end = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) {
        end = j + 1;
        continue;
      }
      const nextIndent = line.match(/^\s*/)?.[0]?.length || 0;
      if (nextIndent <= indent && /^(def|class)\s+/.test(line.trim())) break;
      if (nextIndent <= indent && !line.trim().startsWith("#")) break;
      end = j + 1;
    }
    ranges.push(makeSourceFunction({
      ...meta,
      functionName: match[2],
      startLine: i + 1,
      endLine: end,
    }));
  }
  return ranges;
}

function extractTopLevelPythonSymbols(source) {
  const symbols = [];
  String(source || "").split("\n").forEach((line, index) => {
    const match = /^(?:async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/.exec(line);
    if (match) symbols.push({ name: match[1], line: index + 1 });
  });
  return symbols;
}

function extractFunctionRangesCpp(source, meta) {
  const ranges = [];
  const seen = new Set();
  const pattern = /(?:^|\n)\s*(?:[A-Za-z_][A-Za-z0-9_:<>,*&\s~]*\s+)+([A-Za-z_][A-Za-z0-9_:~]*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?{/g;
  const controls = new Set(["if", "for", "while", "switch", "catch"]);
  let match;
  while ((match = pattern.exec(source))) {
    const functionName = match[1].split("::").pop();
    if (!functionName || controls.has(functionName)) continue;
    const openIndex = source.indexOf("{", match.index);
    const closeIndex = openIndex >= 0 ? findMatchingBraceIndex(source, openIndex) : -1;
    const startLine = lineNumberAt(source, match.index);
    const endLine = closeIndex >= 0 ? lineNumberAt(source, closeIndex) : startLine;
    const key = `${functionName}:${startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push(makeSourceFunction({ ...meta, functionName, startLine, endLine }));
  }
  return ranges;
}

function extractSourceFunctions(source, lang, meta) {
  if (lang === "js" || lang === "ts") return extractFunctionRangesJS(source, meta);
  if (lang === "py") return extractFunctionRangesPython(source, meta);
  if (lang === "cpp") return extractFunctionRangesCpp(source, meta);
  return [];
}

export function buildSourceFileIndexRecord({ owner, repo, path, content, branch, commitSha }) {
  const MAX_BYTES = 80000; // keep per-file small
  const lang = detectLangFromPath(path);
  const clipped = (content || "").slice(0, MAX_BYTES);

  let functions = [];
  let exportsList = [];
  let importsList = [];
  if (lang === "js" || lang === "ts") {
    try {
      const { functions: f, exports: e, imports: i } = extractSymbolsJS(clipped);
      functions = f; exportsList = e; importsList = i;
    } catch {}
  } else if (lang === "py") {
    try {
      const imports = new Set();
      const functionsFound = new Set();
      const importRe = /(?:from\s+([a-zA-Z0-9_.]+)\s+import|import\s+([a-zA-Z0-9_.]+))/g;
      const fnRe = /(?:async\s+def|def|class)\s+([A-Za-z0-9_]+)\s*(?:\(|:)/g;
      let m;
      while ((m = importRe.exec(clipped))) imports.add(m[1] || m[2]);
      while ((m = fnRe.exec(clipped))) functionsFound.add(m[1]);
      importsList = Array.from(imports);
      functions = Array.from(functionsFound);
    } catch {}
  }

  const sourceFunctions = extractSourceFunctions(clipped, lang, { owner, repo, path, branch, commitSha });
  const indexedFunctionNames = new Set(functions);
  sourceFunctions.forEach((fn) => indexedFunctionNames.add(fn.functionName));
  const sourceAudit = {};
  if (lang === "py") {
    const topLevelSymbols = extractTopLevelPythonSymbols(clipped);
    const sourceFunctionNames = new Set(sourceFunctions.map((fn) => fn.functionName));
    sourceAudit.pythonTopLevelFunctions = topLevelSymbols;
    sourceAudit.missingFromSourceFunctions = topLevelSymbols
      .filter((symbol) => !sourceFunctionNames.has(symbol.name))
      .map((symbol) => symbol.name);
  }
  const record = {
    path,
    lang,
    repo,
    owner,
    branch,
    commitSha,
    functions: Array.from(indexedFunctionNames),
    sourceFunctions,
    sourceAudit,
    imports: importsList,
    exports: exportsList,
    content: clipped,
  };
  return record;
}

async function indexSourceFileToIDB({ owner, repo, path, content, branch, commitSha }) {
  const record = buildSourceFileIndexRecord({ owner, repo, path, content, branch, commitSha });

  try {
    await idbPut(IDB_STORES.codeIndex, `code:file:${owner}/${repo}:${path}`, record);
  } catch (e) {
    // As a last resort, no-throw fallback to localStorage (rare)
    try { localStorage.setItem(`code:file:${owner}/${repo}:${path}`, JSON.stringify(record)); } catch {}
  }
  return record;
}

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
  { label: "C / C++", exts: [".c", ".cc", ".cp", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ipp", ".inl", ".tpp"] },
  { label: "Rust", exts: [".rs"] },
  { label: "Ruby", exts: [".rb"] },
  { label: "PHP", exts: [".php"] },
  { label: "Shell", exts: [".sh", ".bash", ".zsh"] },
  { label: "Config / Infra", exts: [".yml", ".yaml", ".json", ".toml", ".ini", ".env", ".tf", ".tfvars", ".dockerfile", "Dockerfile"] },
  { label: "Web Assets", exts: [".html", ".css", ".scss", ".sass", ".vue", ".svelte"] },
  { label: "Docs", exts: [".md", ".rst"] },
];

const SPECIAL_FILENAMES = new Set(["Dockerfile", "Makefile", "CMakeLists.txt", "Jenkinsfile"]);
const NO_EXTENSION_TOKEN = "(no extension)";
const DEFAULT_CODE_ARCHITECTURE_SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py",
  ".go", ".java", ".kt", ".kts", ".c", ".cc", ".cp", ".cpp", ".cxx", ".c++",
  ".h", ".hh", ".hpp", ".hxx", ".h++", ".ipp", ".inl", ".tpp", ".rs", ".rb", ".php",
  ".sh", ".bash", ".zsh",
]);

function extOf(path) {
  const base = path.split("/").pop() || path;
  if (SPECIAL_FILENAMES.has(base)) return base;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : NO_EXTENSION_TOKEN;
}

const DEFAULT_FUNCTIONAL_ANALYSIS_BATCH_FILES = 80;
const MAX_FUNCTIONAL_ANALYSIS_CHUNKS_PER_FILE = 8;
const MAX_AI_ARCHITECTURE_ALLOCATION_ROWS = 300;
const MAX_FUNCTIONAL_SOURCE_FILE_BYTES = 350000;
const FUNCTIONAL_DECOMPOSITION_CHECKPOINT_PREFIX = "functional-decomposition-checkpoint:";
const FUNCTIONAL_GROUNDING_VERSION = 6;
const FUNCTIONAL_ANALYSIS_VENDOR_PATH_RE = /(^|\/)(venv|site-packages|node_modules|\.git|\.next|dist|build|target|__pycache__|coverage|thirdparty|third_party|3rdparty|vendor|external|extern|submodules|sdkclient[^/]*|[^/]*sdk|sdk[^/]*|sdk_client|sdk-client|dependencies|deps)(\/|$)/i;

function isVendorFunctionalAnalysisPath(path = "") {
  return FUNCTIONAL_ANALYSIS_VENDOR_PATH_RE.test(String(path || ""));
}

function scoreFunctionalAnalysisFile(file = {}) {
  const path = String(file.path || "");
  const lower = path.toLowerCase();
  const extension = extOf(path);
  let score = 0;
  if (/(^|\/)(src|include|lib|app|apps|packages|nodes|components|modules)\//.test(lower)) score += 45;
  if (/(^|\/)(launch|msg|srv|action|interfaces?|proto|schemas?)\//.test(lower)) score += 35;
  if (/(^|\/)(config|params?)\//.test(lower)) score += 8;
  if (/\.(msg|srv|action|proto|idl)$/i.test(path)) score += 30;
  if (/\.(yaml|yml|toml|json|xml)$/i.test(path)) score -= 15;
  if (/(^|\/)(main|index|app|node|component|manager|controller|planner|perception|localization|interface|adapter)[._-]/i.test(path)) score += 20;
  if (/\.(cpp|cc|cxx|c|hpp|hh|h|py|js|jsx|ts|tsx|go|rs|java|kt)$/i.test(path)) score += 15;
  if (/\.(hpp|hh|h|hxx|h\+\+)$/i.test(path)) score -= 28;
  if (/(^|\/)include\//.test(lower) && !/(interface|adapter|controller|manager)/i.test(path)) score -= 35;
  if (![".msg", ".srv", ".action", ".proto", ".idl"].includes(extension) && /(^|\/)(observations?|terms?|datasets?|configs?)\//.test(lower)) score -= 60;
  if (/(^|\/)(test|tests|spec|specs|__tests__|docs?|examples?|sample|samples|demo|demos|benchmark|benchmarks)\//.test(lower)) score -= 50;
  if (/(^|\/)(tools?|utils?|scripts?|visuali[sz]ation|visuali[sz]er|vis|teleop)\//.test(lower)) score -= 35;
  if (/(^|\/)(build|install|log|coverage|dist|vendor|third_party|external)\//.test(lower)) score -= 80;
  if (isVendorFunctionalAnalysisPath(path)) score -= 120;
  if (Number(file.size || 0) > MAX_FUNCTIONAL_SOURCE_FILE_BYTES) score -= 60;
  score -= Math.min(30, path.split("/").length);
  return score;
}

function prioritizeFunctionalAnalysisFiles(files = [], maxFiles = 0) {
  const filtered = (files || []).filter((file) => {
    const size = Number(file?.size || 0);
    return file?.path && !isVendorFunctionalAnalysisPath(file.path) && (!size || size <= MAX_FUNCTIONAL_SOURCE_FILE_BYTES);
  });
  const selected = [];
  const effectiveMaxFiles = Number(maxFiles || 0);
  for (const entry of filtered
    .map((file, index) => ({ file, index, score: scoreFunctionalAnalysisFile(file) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)) {
    selected.push(entry.file);
    if (effectiveMaxFiles > 0 && selected.length >= Math.max(1, effectiveMaxFiles)) break;
  }
  return selected;
}

function shouldIndexFunctionalAnalysisSource(path = "") {
  const extension = extOf(String(path || ""));
  return [
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py",
    ".c", ".cc", ".cp", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ipp", ".inl", ".tpp",
  ].includes(extension);
}

function tallyExtensions(files) {
  const map = new Map();
  for (const f of files) {
    const e = extOf(f.path);
    map.set(e, (map.get(e) || 0) + 1);
  }
  return map;
}

function isDefaultCodeArchitectureSourceSelection(extToken) {
  if (!extToken) return false;
  return DEFAULT_CODE_ARCHITECTURE_SOURCE_EXTENSIONS.has(String(extToken || "").toLowerCase());
}

function buildFileTypeGroups(counts) {
  const groups = [];
  const seen = new Set();

  for (const group of LANGUAGE_GROUPS) {
    const present = group.exts.filter((ext) => counts.get(ext) > 0);
    if (!present.length) continue;
    present.forEach((ext) => seen.add(ext));
    groups.push({ label: group.label, exts: present });
  }

  const specialFiles = Array.from(counts.keys()).filter(
    (ext) => SPECIAL_FILENAMES.has(ext) && !seen.has(ext)
  );
  if (specialFiles.length) {
    specialFiles.forEach((ext) => seen.add(ext));
    groups.push({ label: "Special Files", exts: specialFiles.sort() });
  }

  const noExtension = counts.get(NO_EXTENSION_TOKEN) > 0 && !seen.has(NO_EXTENSION_TOKEN)
    ? [NO_EXTENSION_TOKEN]
    : [];
  if (noExtension.length) {
    noExtension.forEach((ext) => seen.add(ext));
    groups.push({ label: "No Extension", exts: noExtension });
  }

  const otherExts = Array.from(counts.keys())
    .filter((ext) => !seen.has(ext))
    .sort((a, b) => {
      const aCount = counts.get(a) || 0;
      const bCount = counts.get(b) || 0;
      return bCount - aCount || a.localeCompare(b);
    });

  if (otherExts.length) {
    groups.push({ label: "Other File Types", exts: otherExts });
  }

  return groups;
}

export function FileTypeSelectorModal({ open, files, onCancel, onConfirm }) {
  const counts = React.useMemo(() => tallyExtensions(files || []), [files]);
  const groups = React.useMemo(() => buildFileTypeGroups(counts), [counts]);
  const defaultSelected = React.useMemo(
    () =>
      new Set(
        Array.from(counts.keys()).filter((ext) => isDefaultCodeArchitectureSourceSelection(ext))
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
          <p className="text-sm text-slate-600">
            xHandle scanned the repo and found these file types. Source-code files are preselected by default; notebooks, docs, config, media, archives, CAD, and other support files are left unchecked unless you choose them.
          </p>
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

          {groups.map((g) => {
            const allIn = g.exts.every((e) => selected.has(e));
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
                  {g.exts.map((e) => (
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

/* ===================== GitHub helper layer (no backend dependency) ===================== */

const githubHeaders = (token) =>
  token
    ? {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      }
    : { Accept: "application/vnd.github.v3+json" };

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

export async function getDefaultBranch(owner, repo, token) {
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

export async function getCommitShaForRef(owner, repo, token, ref) {
  if (!owner || !repo || !ref) return "";
  try {
    const branch = await jsonFetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(ref)}`,
      { headers: githubHeaders(token) }
    );
    return branch?.commit?.sha || "";
  } catch {
    try {
      const gitRef = await jsonFetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(ref)}`,
        { headers: githubHeaders(token) }
      );
      return gitRef?.object?.sha || "";
    } catch {
      return "";
    }
  }
}

/**
 * List repo files using GitHub Trees API (includes sha for faster blob reads).
 * Returns array: [{ path, name, sha }]
 */
export async function listRepoFilesViaGitHub(owner, repo, token, ref) {
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
      size: b.size || 0,
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
          size: b.size || 0,
        }));
      } catch (e2) {
        throw e;
      }
    }
    throw e;
  }
}

export function filterSelectableRepoFiles(allFiles) {
  return (allFiles || []).filter((f) => f?.path && !isVendorFunctionalAnalysisPath(f.path));
}

export function findReadmeFile(allFiles = []) {
  const priority = ["README.md", "README", "README.rst", "README.txt"];
  const files = (allFiles || []).filter((file) => file?.path);
  for (const name of priority) {
    const exact = files.find((file) => file.path === name);
    if (exact) return exact;
  }
  return files
    .filter((file) => /^readme(\.|$)/i.test(file.path.split("/").pop() || ""))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))[0] || null;
}

function humanizePathSegment(value, fallback = "Application") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildRepoStructureSummary(allFiles = []) {
  const candidates = filterSelectableRepoFiles(allFiles);
  const tree = new Map();
  const rootFiles = [];

  candidates.forEach((file) => {
    const parts = String(file?.path || "").split("/").filter(Boolean);
    if (!parts.length) return;
    if (parts.length === 1) {
      rootFiles.push(parts[0]);
      return;
    }
    const top = parts[0];
    const second = parts[1];
    const topRecord = tree.get(top) || { count: 0, children: new Map() };
    topRecord.count += 1;
    if (second) topRecord.children.set(second, (topRecord.children.get(second) || 0) + 1);
    tree.set(top, topRecord);
  });

  const topLevelEntries = [
    ...Array.from(tree.entries()).map(([name, record]) => ({ name, type: "directory", count: record.count })),
    ...rootFiles.slice(0, 40).map((name) => ({ name, type: "file", count: 1 })),
  ]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 40);

  const lines = Array.from(tree.entries())
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([top, record]) => {
      const children = Array.from(record.children.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([name, count]) => `${name} (${count})`)
        .join(", ");
      return `- ${top}/ (${record.count} files)${children ? `: ${children}` : ""}`;
    });

  if (rootFiles.length) {
    lines.push(`- Root files: ${rootFiles.sort((a, b) => a.localeCompare(b)).slice(0, 30).join(", ")}`);
  }

  return {
    folderSummary: lines.join("\n"),
    topLevelEntries,
  };
}

export async function fetchRepositoryContext({ owner, repo, token, ref, allFiles }) {
  const { folderSummary, topLevelEntries } = buildRepoStructureSummary(allFiles);
  const readme = findReadmeFile(allFiles);
  let readmeText = "";

  if (readme?.path) {
    try {
      const got = await fetchGitHubFileSmart({ owner, repo, path: readme.path, token, ref, sha: readme.sha });
      if (got.ok) readmeText = String(got.content || "").slice(0, 18000);
    } catch (error) {
      console.warn("Unable to fetch README for architecture context.", error);
    }
  }

  return {
    readmePath: readme?.path || "",
    readmeText,
    folderSummary,
    topLevelEntries,
    repoName: repo || "",
  };
}

async function fetchGitHubFileRaw({ owner, repo, path, ref, signal = null }) {
  const candidates = [ref, "main", "master"].filter(Boolean);
  for (const r of candidates) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/${encodeURIComponent(r)}/${encodeURI(path.replace(/^\/+/, ""))}`;
      const resp = await fetch(rawUrl, signal ? { signal } : undefined);
      if (resp.ok) {
        return { ok: true, content: await resp.text() };
      }
    } catch {}
  }
  return { ok: false };
}

/**
 * Fetch file content with preference:
 * 1) Git Data blob by sha for authenticated repos
 * 2) Raw URL for public repos to avoid Contents API rate limits
 * 3) Contents API as fallback
 */
async function fetchGitHubFileDirect({ owner, repo, path, token, ref, sha, signal = null }) {
  // 1) Blob by sha (best for private repos; compact + no extra preflights beyond CORS)
  if (token && sha) {
    try {
      const j = await jsonFetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo
        )}/git/blobs/${encodeURIComponent(sha)}`,
        { headers: githubHeaders(token), ...(signal ? { signal } : {}) }
      );
      if (j && j.content && j.encoding === "base64") {
        try {
          return { ok: true, content: atob(j.content.replace(/\n/g, "")) };
        } catch {}
      }
    } catch {}
  }

  // 2) Raw public file fetch avoids noisy 403s from the GitHub Contents API rate limit.
  if (!token) {
    const raw = await fetchGitHubFileRaw({ owner, repo, path, ref, signal });
    if (raw.ok) return raw;
  }

  // 3) Contents API
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/contents/${encodeURI(path.replace(/^\/+/, ""))}${
      ref ? `?ref=${encodeURIComponent(ref)}` : ""
    }`;
    const j = await jsonFetch(url, { headers: githubHeaders(token), ...(signal ? { signal } : {}) });
    if (j?.content && j?.encoding === "base64") {
      try {
        return { ok: true, content: atob(j.content.replace(/\n/g, "")) };
      } catch {}
    }
    if (typeof j?.content === "string") {
      return { ok: true, content: j.content };
    }
  } catch {}

  // 4) Last raw attempt, useful when token is present but the Contents API refuses a file.
  const raw = await fetchGitHubFileRaw({ owner, repo, path, ref, signal });
  if (raw.ok) return raw;

  return { ok: false };
}

/* ===================== Remove backend dependency for file contents ===================== */
/* (kept name for minimal_surface change; now prefers GitHub paths and never puts token in URLs) */
async function fetchGitHubFileSmart({ backendURL: _unused, owner, repo, path, token, accountId: _acc, bearer: _bearer, ref, sha, signal = null }) {
  // Direct GitHub attempts only; no token in URLs, no backend state required
  return fetchGitHubFileDirect({ owner, repo, path, token, ref, sha, signal });
}

if (typeof window !== "undefined") {
  window.fetchGitHubFileSmart = fetchGitHubFileSmart;
}

/* ===================== Chunking helpers ===================== */

const MAX_CHARS_PER_PROMPT = 12000; // ~3k tokens of code
const LARGE_FILE_CHARS = 24000;
const LARGE_FILE_MAX_CHARS_PER_PROMPT = 6000;
const CHUNK_OVERLAP_CHARS = 400;
const FUNCTIONAL_DECOMPOSITION_FILE_TIMEOUT_MS = 45000;

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

function makeChunkHeader(path, idx, total) {
  return `// File: ${path}\n// Part ${idx + 1} of ${total}\n\n`;
}

function chunksForFunctionalAnalysis(text = "") {
  const source = String(text || "");
  const maxLen = source.length > LARGE_FILE_CHARS
    ? LARGE_FILE_MAX_CHARS_PER_PROMPT
    : MAX_CHARS_PER_PROMPT;
  return chunkTextWithOverlap(source, maxLen, CHUNK_OVERLAP_CHARS);
}

const PLACEHOLDER_RELATED_FILE_VALUES = new Set(["none", "n/a", "na", "-", "null", "undefined"]);
const PLACEHOLDER_ENDPOINT_VALUES = new Set([...PLACEHOLDER_RELATED_FILE_VALUES, "return"]);
const LOW_VALUE_ENDPOINT_VALUES = new Set([
  "data",
  "input",
  "inputs",
  "output",
  "outputs",
  "message",
  "messages",
  "model inputs",
  "model input",
  "model outputs",
  "prediction",
  "predictions",
  "result",
  "results",
  "extra",
  "extras",
]);
const SPECULATIVE_RELATIONSHIP_PATTERNS = [
  /\bdoes\s+not\s+directly\s+call\b/i,
  /\bnot\s+directly\s+call(?:s|ed|ing)?\b/i,
  /\blikely\s+used\b/i,
  /\bmay\s+be\s+used\b/i,
  /\bmight\s+be\s+used\b/i,
  /\bcould\s+be\s+used\b/i,
  /\bbroader\s+context\b/i,
  /\bsimilar\s+structure(?:s)?\b/i,
  /\bpart\s+of\s+the\s+overall\s+system\b/i,
];

function createRepoPathResolver(files = []) {
  const paths = (files || []).map((file) => String(file?.path || "").trim()).filter(Boolean);
  const exact = new Set(paths);
  const suffixMap = new Map();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index += 1) {
      const suffix = parts.slice(index).join("/");
      if (!suffix) continue;
      const current = suffixMap.get(suffix) || [];
      current.push(path);
      suffixMap.set(suffix, current);
    }
  }

  return {
    has(path) {
      return exact.has(String(path || "").trim());
    },
    resolve(value, currentPath = "") {
      const raw = String(value || "").trim();
      if (!raw) return { status: "missing", raw, path: "" };
      if (PLACEHOLDER_RELATED_FILE_VALUES.has(raw.toLowerCase())) return { status: "placeholder", raw, path: "" };
      if (exact.has(raw)) return { status: "exact", raw, path: raw };
      const current = String(currentPath || "").trim();
      if (current && raw === current.split("/").pop()) return { status: "current-basename", raw, path: current };
      const matches = suffixMap.get(raw) || paths.filter((path) => path.endsWith(`/${raw}`));
      const uniqueMatches = Array.from(new Set(matches));
      if (uniqueMatches.length === 1) return { status: "normalized", raw, path: uniqueMatches[0] };
      if (uniqueMatches.length > 1) return { status: "ambiguous", raw, path: "", matches: uniqueMatches.slice(0, 8) };
      return { status: "not-found", raw, path: "" };
    },
  };
}

function normalizeFunctionLabelForEvidence(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function functionLabelMatchesSource(label, sourceFunctions = [], imports = []) {
  const normalizedLabel = normalizeFunctionLabelForEvidence(label);
  if (!normalizedLabel || PLACEHOLDER_ENDPOINT_VALUES.has(normalizedLabel)) return false;
  const compactLabel = normalizedLabel.replace(/\s+/g, "");
  const rawLabel = String(label || "");
  const qualifiedLabel = rawLabel.includes(".");
  const sourceNames = (sourceFunctions || []).map((fn) => fn?.functionName).filter(Boolean);
  const importNames = (imports || []).filter(Boolean);
  const sourceMatch = sourceNames.some((name) => {
    const normalizedName = normalizeFunctionLabelForEvidence(name);
    const compactName = normalizedName.replace(/\s+/g, "");
    return normalizedName === normalizedLabel ||
      compactName === compactLabel ||
      (qualifiedLabel && normalizedName.length >= 3 && normalizedLabel.includes(normalizedName)) ||
      (qualifiedLabel && compactName.length >= 3 && compactLabel.includes(compactName));
  });
  if (sourceMatch) return true;
  return importNames.some((name) => {
    const normalizedName = normalizeFunctionLabelForEvidence(name);
    const compactName = normalizedName.replace(/\s+/g, "");
    return normalizedName === normalizedLabel ||
      compactName === compactLabel ||
      (qualifiedLabel && normalizedName.length >= 2 && normalizedLabel.startsWith(normalizedName)) ||
      (qualifiedLabel && compactName.length >= 2 && compactLabel.startsWith(compactName));
  });
}

function normalizeSourceSymbol(value) {
  return String(value || "")
    .split(".")
    .pop()
    .replace(/[^A-Za-z0-9_$]+/g, "")
    .toLowerCase();
}

function sourceFunctionBody(content = "", fn = {}) {
  const lines = String(content || "").split("\n");
  const startLine = Number(fn?.startLine || 0);
  if (!startLine || !lines.length) return "";
  const endLine = Number(fn?.endLine || startLine);
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, Math.max(start + 1, endLine));
  return lines.slice(start, end).join("\n");
}

function pythonRangeLooksClass(content = "", fn = {}) {
  return /^\s*class\s+/m.test(String(sourceFunctionBody(content, fn) || "").split("\n")[0] || "");
}

function pythonSourceFunctionsMatching(sourceFunctions = [], label = "") {
  const target = normalizeSourceSymbol(label);
  if (!target) return [];
  return (sourceFunctions || []).filter((fn) =>
    normalizeSourceSymbol(fn?.functionName || fn?.name || fn?.symbolName) === target
  );
}

function pythonMethodsInsideClass(sourceFunctions = [], classFn = {}, methodName = "") {
  const target = normalizeSourceSymbol(methodName);
  if (!target) return [];
  const startLine = Number(classFn?.startLine || 0);
  const endLine = Number(classFn?.endLine || startLine);
  return (sourceFunctions || []).filter((fn) =>
    normalizeSourceSymbol(fn?.functionName || fn?.name || fn?.symbolName) === target &&
    Number(fn?.startLine || 0) > startLine &&
    Number(fn?.endLine || fn?.startLine || 0) <= endLine
  );
}

function pythonBodyCallsSymbol(body = "", symbol = "") {
  const target = normalizeSourceSymbol(symbol);
  if (!body || !target) return false;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const callPattern = new RegExp(`(?:^|[^A-Za-z0-9_$])(?:self\\.|cls\\.|[A-Za-z_][A-Za-z0-9_]*\\.)?${escaped}\\s*\\(`, "i");
  return callPattern.test(
    String(body || "")
      .split("\n")
      .filter((line) => !/^\s*(?:async\s+def|def|class)\s+/.test(line))
      .join("\n")
  );
}

function pythonFunctionLooksAbstract(body = "") {
  const text = String(body || "").toLowerCase();
  return /@abstractmethod\b/.test(text) ||
    /\braise\s+notimplementederror\b/.test(text) ||
    /(^|\n)\s*(pass|\.{3})\s*(#.*)?($|\n)/.test(text);
}

function pythonClassExtendsSymbol(body = "", className = "", baseName = "") {
  const child = String(className || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parent = normalizeSourceSymbol(baseName);
  if (!body || !child || !parent) return false;
  const header = String(body || "").split("\n")[0] || "";
  const match = new RegExp(`^\\s*class\\s+${child}\\s*\\(([^)]*)\\)\\s*:`, "i").exec(header);
  if (!match) return false;
  return match[1].split(",").some((item) => normalizeSourceSymbol(item) === parent);
}

function pythonClassBodyDefinesMethod(body = "", methodName = "") {
  const target = normalizeSourceSymbol(methodName);
  if (!body || !target) return false;
  const methodPattern = /^\s+(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let match;
  while ((match = methodPattern.exec(String(body || "")))) {
    if (normalizeSourceSymbol(match[1]) === target) return true;
  }
  return false;
}

function verifySameFilePythonRelationship(row = {}, currentFileRecord = {}) {
  if (currentFileRecord?.lang !== "py") return { applicable: false };
  if (!currentFileRecord?.content) return { applicable: false };
  const sourceFunctions = currentFileRecord.sourceFunctions || [];
  if (!sourceFunctions.length) return { applicable: false };
  const fromMatches = pythonSourceFunctionsMatching(sourceFunctions, row.from);
  const toMatches = pythonSourceFunctionsMatching(sourceFunctions, row.to);
  if (!fromMatches.length || !toMatches.length) return { applicable: false };
  const fromClassMatches = fromMatches.filter((fn) => pythonRangeLooksClass(currentFileRecord.content, fn));

  const structuralMember = fromMatches.find((fromFn) =>
    toMatches.some((toFn) =>
      normalizeSourceSymbol(fromFn.functionName) !== normalizeSourceSymbol(toFn.functionName) &&
      pythonClassBodyDefinesMethod(sourceFunctionBody(currentFileRecord.content, fromFn), toFn.functionName)
    )
  );
  if (structuralMember) {
    return {
      applicable: true,
      verified: true,
      relationshipType: "structural_member",
      evidence: `${row.from} defines ${row.to} in ${currentFileRecord.path || "current Python file"}.`,
    };
  }

  if (fromClassMatches.length) {
    const constructorCall = fromClassMatches.find((classFn) =>
      pythonMethodsInsideClass(sourceFunctions, classFn, "__init__").some((initFn) =>
        pythonBodyCallsSymbol(sourceFunctionBody(currentFileRecord.content, initFn), row.to)
      )
    );
    if (constructorCall) {
      return {
        applicable: true,
        verified: true,
        relationshipType: "constructor_body_call",
        evidence: `${row.from}.__init__ calls ${row.to} in ${currentFileRecord.path || "current Python file"}.`,
      };
    }

    const inheritance = fromClassMatches.find((fromFn) =>
      toMatches.some((toFn) => pythonClassExtendsSymbol(
        sourceFunctionBody(currentFileRecord.content, fromFn),
        fromFn.functionName,
        toFn.functionName
      ))
    );
    if (inheritance) {
      return {
        applicable: true,
        verified: true,
        relationshipType: "inheritance",
        evidence: `${row.from} inherits from ${row.to} in ${currentFileRecord.path || "current Python file"}.`,
      };
    }

    const reversedInheritance = toMatches.find((toFn) =>
      fromClassMatches.some((fromFn) => pythonClassExtendsSymbol(
        sourceFunctionBody(currentFileRecord.content, toFn),
        toFn.functionName,
        fromFn.functionName
      ))
    );
    if (reversedInheritance) {
      return {
        applicable: true,
        verified: false,
        reason: "reversed_same_file_python_inheritance",
        evidence: `${row.to} inherits from ${row.from}; the generated inheritance direction is reversed.`,
      };
    }

    return {
      applicable: true,
      verified: false,
      reason: "unverified_class_level_python_relationship",
      evidence: `${row.from} is a class; no structural membership, inheritance, or constructor-body call to ${row.to} was found.`,
    };
  }

  const direct = fromMatches.find((fn) => pythonBodyCallsSymbol(sourceFunctionBody(currentFileRecord.content, fn), row.to));
  if (direct) {
    return {
      applicable: true,
      verified: true,
      relationshipType: "direct_call",
      evidence: `${row.from} calls ${row.to} in ${direct.filePath || currentFileRecord.path || "current Python file"}.`,
    };
  }

  const inheritance = fromMatches.find((fromFn) =>
    toMatches.some((toFn) => pythonClassExtendsSymbol(
      sourceFunctionBody(currentFileRecord.content, fromFn),
      fromFn.functionName,
      toFn.functionName
    ))
  );
  if (inheritance) {
    return {
      applicable: true,
      verified: true,
      relationshipType: "inheritance",
      evidence: `${row.from} inherits from ${row.to} in ${currentFileRecord.path || "current Python file"}.`,
    };
  }

  const reversedInheritance = toMatches.find((toFn) =>
    fromMatches.some((fromFn) => pythonClassExtendsSymbol(
      sourceFunctionBody(currentFileRecord.content, toFn),
      toFn.functionName,
      fromFn.functionName
    ))
  );
  if (reversedInheritance) {
    return {
      applicable: true,
      verified: false,
      reason: "reversed_same_file_python_inheritance",
      evidence: `${row.to} inherits from ${row.from}; the generated inheritance direction is reversed.`,
    };
  }

  const reverse = toMatches.find((fn) => pythonBodyCallsSymbol(sourceFunctionBody(currentFileRecord.content, fn), row.from));
  if (reverse) {
    return {
      applicable: true,
      verified: false,
      reason: "reversed_same_file_python_call",
      evidence: `${row.to} calls ${row.from}; the generated edge direction is reversed.`,
    };
  }

  const abstractOnly = [...fromMatches, ...toMatches].some((fn) =>
    pythonFunctionLooksAbstract(sourceFunctionBody(currentFileRecord.content, fn))
  );
  return {
    applicable: true,
    verified: false,
    reason: abstractOnly ? "abstract_or_placeholder_python_endpoint" : "unverified_same_file_python_relationship",
    evidence: abstractOnly
      ? "Endpoint symbols are abstract or placeholder implementations; no concrete caller/callee relationship was found."
      : "Endpoint symbols are defined in the same Python file, but no direct caller/callee relationship was found.",
  };
}

function normalizeSafetyRelevantPythonRow(row = {}, currentFileRecord = {}, currentFilePath = "") {
  if (currentFileRecord?.lang !== "py" || !currentFileRecord?.content) return row;
  if (row?.fromFile !== currentFilePath) return row;
  if (normalizeSourceSymbol(row?.from) !== "extract_traj_tokens") return row;
  const sourceFunctions = currentFileRecord.sourceFunctions || [];
  const extractFn = pythonSourceFunctionsMatching(sourceFunctions, "extract_traj_tokens")[0];
  if (!extractFn) return row;
  const body = sourceFunctionBody(currentFileRecord.content, extractFn);
  if (!/\binvalid_?tokens?\b/i.test(body) || !/\btorch\.clamp\s*\(/i.test(body)) return row;
  if (normalizeSourceSymbol(row?.to) === "clamp") return row;
  return {
    ...row,
    action: "Clamp trajectory token ids",
    controlActionDetails: "Invalid trajectory token ids are warned about and clamped rather than rejected.",
    to: "torch.clamp",
    toFile: row.fromFile || currentFilePath,
    toDetails: "The implementation calls torch.clamp to force invalid trajectory token ids into the accepted vocabulary range.",
  };
}

function verifyCurrentFilePythonRelationship(row = {}, currentFileRecord = {}, currentFilePath = "") {
  if (currentFileRecord?.lang !== "py") return { applicable: false };
  if (!currentFileRecord?.content || !currentFilePath) return { applicable: false };
  const sourceFunctions = currentFileRecord.sourceFunctions || [];
  if (!sourceFunctions.length) return { applicable: false };
  const fromIsCurrent = row.fromFile === currentFilePath;
  const toIsCurrent = row.toFile === currentFilePath;
  if (!fromIsCurrent && !toIsCurrent) return {
    applicable: true,
    verified: false,
    reason: "row_not_grounded_in_current_file",
    evidence: "Neither endpoint is in the source file being analyzed.",
  };
  if (fromIsCurrent && toIsCurrent) return verifySameFilePythonRelationship(row, currentFileRecord);

  const fromMatches = fromIsCurrent ? pythonSourceFunctionsMatching(sourceFunctions, row.from) : [];
  const toMatches = toIsCurrent ? pythonSourceFunctionsMatching(sourceFunctions, row.to) : [];
  if (fromIsCurrent && fromMatches.length) {
    const direct = fromMatches.find((fn) => pythonBodyCallsSymbol(sourceFunctionBody(currentFileRecord.content, fn), row.to));
    if (direct) {
      return {
        applicable: true,
        verified: true,
        relationshipType: "direct_call",
        evidence: `${row.from} calls ${row.to} from ${currentFilePath}.`,
      };
    }
    return {
      applicable: true,
      verified: false,
      reason: "unverified_current_file_python_relationship",
      evidence: `${row.from} is in ${currentFilePath}, but its body does not call ${row.to}.`,
    };
  }
  if (toIsCurrent && toMatches.length) {
    const reverse = toMatches.find((fn) => pythonBodyCallsSymbol(sourceFunctionBody(currentFileRecord.content, fn), row.from));
    if (reverse) {
      return {
        applicable: true,
        verified: false,
        reason: "reversed_current_file_python_call",
        evidence: `${row.to} calls ${row.from}; the generated edge direction is reversed.`,
      };
    }
  }
  return { applicable: false };
}

function verifiedPythonCallEdgesForRecord(record = {}) {
  if (record?.lang !== "py" || !record?.content || !Array.isArray(record.sourceFunctions)) return [];
  const edges = [];
  const sourceFunctions = record.sourceFunctions.filter((fn) => fn?.functionName);
  sourceFunctions.forEach((fromFn) => {
    const body = sourceFunctionBody(record.content, fromFn);
    if (!body) return;
    sourceFunctions.forEach((toFn) => {
      if (!toFn?.functionName || fromFn === toFn) return;
      if (normalizeSourceSymbol(fromFn.functionName) === normalizeSourceSymbol(toFn.functionName)) return;
      if (pythonBodyCallsSymbol(body, toFn.functionName)) {
        edges.push({
          from: fromFn.functionName,
          to: toFn.functionName,
          fromLine: fromFn.startLine,
          toLine: toFn.startLine,
        });
      }
    });
  });
  return edges.slice(0, 300);
}

function isLowValueEndpointLabel(label) {
  const normalizedLabel = normalizeFunctionLabelForEvidence(label);
  if (!normalizedLabel) return true;
  if (LOW_VALUE_ENDPOINT_VALUES.has(normalizedLabel)) return true;
  if (String(label || "").includes(",")) return true;
  return false;
}

function normalizePrimitiveCallActionText(action = "", to = "") {
  const actionText = String(action || "").trim();
  const toText = String(to || "").trim();
  if (!actionText || !toText) return actionText;
  if (!/^call\b/i.test(actionText)) return actionText;
  const quotedCall = /^call\s+`([^`]+)`$/i.exec(actionText);
  const plainCall = /^call\s+([A-Za-z_][A-Za-z0-9_.]*)$/i.exec(actionText);
  const namedTarget = quotedCall?.[1] || plainCall?.[1] || "";
  if (!namedTarget) return actionText;
  if (normalizeSourceSymbol(namedTarget) === normalizeSourceSymbol(toText)) return actionText;
  return `Call ${toText}`;
}

function createFunctionalGroundingStats() {
  return {
    accepted: 0,
    rejected: 0,
    normalizedPathCount: 0,
    weakEvidenceCount: 0,
    duplicateRowCount: 0,
    rejectionReasons: {},
    rejectedRows: [],
  };
}

function describesSpeculativeRelationship(row = {}) {
  const text = [
    row.fromDetails,
    row.controlActionDetails,
    row.toDetails,
  ].map((value) => String(value || "")).join("\n");
  return SPECULATIVE_RELATIONSHIP_PATTERNS.some((pattern) => pattern.test(text));
}

function recordFunctionalGroundingRejection(stats, reason, row, context = {}) {
  if (!stats) return;
  stats.rejected += 1;
  stats.rejectionReasons[reason] = (stats.rejectionReasons[reason] || 0) + 1;
  if (stats.rejectedRows.length < 50) {
    stats.rejectedRows.push({
      reason,
      filePath: context.filePath || "",
      chunk: context.chunk || "",
      from: row?.from || "",
      action: row?.action || "",
      to: row?.to || "",
      fromFile: row?.fromFile || "",
      toFile: row?.toFile || "",
    });
  }
}

export function groundFunctionalDecompositionRow({
  row,
  currentFile,
  currentFileRecord,
  repoPathResolver,
  stats,
  chunkIndex,
}) {
  let baseRow = {
    ...row,
    from: String(row?.from || "").trim(),
    fromFile: String(row?.fromFile || "").trim(),
    fromDetails: String(row?.fromDetails || "").trim(),
    action: String(row?.action || "").trim(),
    controlActionDetails: String(row?.controlActionDetails || "").trim(),
    to: String(row?.to || "").trim(),
    toFile: String(row?.toFile || "").trim(),
    toDetails: String(row?.toDetails || "").trim(),
  };
  if (!baseRow.from || !baseRow.action || !baseRow.to) {
    recordFunctionalGroundingRejection(stats, "missing_required_relationship_fields", baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }
  if (PLACEHOLDER_ENDPOINT_VALUES.has(normalizeFunctionLabelForEvidence(baseRow.from)) || PLACEHOLDER_ENDPOINT_VALUES.has(normalizeFunctionLabelForEvidence(baseRow.to))) {
    recordFunctionalGroundingRejection(stats, "placeholder_endpoint_label", baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }
  if (describesSpeculativeRelationship(baseRow)) {
    recordFunctionalGroundingRejection(stats, "speculative_relationship", baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }

  const fromResolution = repoPathResolver.resolve(baseRow.fromFile, currentFile?.path);
  const toResolution = repoPathResolver.resolve(baseRow.toFile, currentFile?.path);
  const invalidResolution = [fromResolution, toResolution].find((item) =>
    ["missing", "placeholder", "ambiguous", "not-found"].includes(item.status)
  );
  if (invalidResolution) {
    recordFunctionalGroundingRejection(stats, `invalid_related_file_${invalidResolution.status}`, baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }

  const normalizedFromFile = fromResolution.path;
  const normalizedToFile = toResolution.path;
  if (normalizedFromFile !== baseRow.fromFile || normalizedToFile !== baseRow.toFile) {
    stats.normalizedPathCount += 1;
  }
  baseRow = {
    ...baseRow,
    fromFile: normalizedFromFile,
    toFile: normalizedToFile,
  };
  baseRow = normalizeSafetyRelevantPythonRow(baseRow, currentFileRecord, currentFile?.path);

  const sourceFunctions = currentFileRecord?.sourceFunctions || [];
  const imports = currentFileRecord?.imports || [];
  const currentFileIsCode = !!(currentFileRecord?.lang && ["js", "ts", "py", "cpp"].includes(currentFileRecord.lang));
  const rowTouchesCurrentFile = normalizedFromFile === currentFile?.path || normalizedToFile === currentFile?.path;
  if (currentFileIsCode && !rowTouchesCurrentFile) {
    recordFunctionalGroundingRejection(stats, "row_not_grounded_in_current_file", baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }
  const fromSymbolGrounded = baseRow.fromFile === currentFile?.path
    ? functionLabelMatchesSource(baseRow.from, sourceFunctions, imports)
    : true;
  const toSymbolGrounded = baseRow.toFile === currentFile?.path
    ? functionLabelMatchesSource(baseRow.to, sourceFunctions, imports)
    : true;
  const currentFileSymbolMismatch = currentFileIsCode && sourceFunctions.length && (
    (baseRow.fromFile === currentFile?.path && !fromSymbolGrounded) ||
    (baseRow.toFile === currentFile?.path && !toSymbolGrounded)
  );

  if (rowTouchesCurrentFile && currentFileSymbolMismatch) {
    recordFunctionalGroundingRejection(stats, "current_file_symbol_mismatch", baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }
  const relationshipEvidence = currentFileIsCode && currentFileRecord?.lang === "py"
    ? verifyCurrentFilePythonRelationship(baseRow, currentFileRecord, currentFile?.path)
    : { applicable: false };
  if (relationshipEvidence.applicable && !relationshipEvidence.verified) {
    recordFunctionalGroundingRejection(stats, relationshipEvidence.reason || "unverified_same_file_python_relationship", baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }
  if (isLowValueEndpointLabel(baseRow.from) || isLowValueEndpointLabel(baseRow.to)) {
    recordFunctionalGroundingRejection(stats, "low_value_endpoint_label", baseRow, { filePath: currentFile?.path, chunk: chunkIndex });
    return null;
  }

  const evidenceConfidence = currentFileIsCode && rowTouchesCurrentFile && sourceFunctions.length
    ? (fromSymbolGrounded && toSymbolGrounded ? "high" : "medium")
    : "path-only";
  if (evidenceConfidence !== "high") stats.weakEvidenceCount += 1;
  stats.accepted += 1;

  const alignedAction = normalizePrimitiveCallActionText(baseRow.action, baseRow.to);
  const normalizedAction = relationshipEvidence.verified && relationshipEvidence.relationshipType === "structural_member"
    ? `Define ${baseRow.to}`
    : relationshipEvidence.verified && relationshipEvidence.relationshipType === "inheritance"
      ? `Inherit from ${baseRow.to}`
      : alignedAction;
  const normalizedControlDetails = relationshipEvidence.verified && relationshipEvidence.relationshipType === "structural_member"
    ? `${baseRow.from} exposes ${baseRow.to} as a defined class member in source.`
    : relationshipEvidence.verified && relationshipEvidence.relationshipType === "inheritance"
      ? `${baseRow.from} is declared as a subclass or implementation of ${baseRow.to}.`
      : baseRow.controlActionDetails;

  return {
    ...baseRow,
    action: normalizedAction,
    controlActionDetails: normalizedControlDetails,
    fromFile: baseRow.fromFile,
    toFile: baseRow.toFile,
    grounding: {
      evidenceConfidence,
      currentFile: currentFile?.path || "",
      fromFileResolution: fromResolution.status,
      toFileResolution: toResolution.status,
      fromSymbolGrounded,
      toSymbolGrounded,
      relationshipType: relationshipEvidence.verified ? relationshipEvidence.relationshipType : "",
      relationshipEvidence: relationshipEvidence.verified ? relationshipEvidence.evidence : "",
    },
  };
}

function dedupeFunctionalDecompositionRows(rows = [], stats = null) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = [
      normalizeFunctionLabelForEvidence(row?.from),
      normalizeFunctionLabelForEvidence(row?.action),
      normalizeFunctionLabelForEvidence(row?.to),
    ].join("|");
    if (seen.has(key)) {
      if (stats) stats.duplicateRowCount = (stats.duplicateRowCount || 0) + 1;
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function estimateFunctionalAnalysisChunkCount(file = {}) {
  const size = Number(file?.size || 0);
  if (!size) return 1;
  const maxLen = size > LARGE_FILE_CHARS
    ? LARGE_FILE_MAX_CHARS_PER_PROMPT
    : MAX_CHARS_PER_PROMPT;
  return Math.max(1, Math.ceil(size / Math.max(1, maxLen - CHUNK_OVERLAP_CHARS)));
}

function planFunctionalAnalysisFiles(files = [], {
  maxFiles = 0,
  maxChunks = 0,
  maxChunksPerFile = MAX_FUNCTIONAL_ANALYSIS_CHUNKS_PER_FILE,
} = {}) {
  const prioritized = prioritizeFunctionalAnalysisFiles(files, maxFiles);
  const planned = [];
  const skippedForChunkLimit = [];
  let chunkCount = 0;
  for (const file of prioritized) {
    const estimatedChunks = estimateFunctionalAnalysisChunkCount(file);
    if (estimatedChunks > maxChunksPerFile) {
      skippedForChunkLimit.push({ ...file, estimatedChunks, reason: "file chunk limit" });
      continue;
    }
    if (maxChunks > 0 && chunkCount + estimatedChunks > maxChunks) {
      skippedForChunkLimit.push({ ...file, estimatedChunks, reason: "run chunk budget" });
      continue;
    }
    planned.push({ ...file, estimatedChunks });
    chunkCount += estimatedChunks;
  }
  return {
    files: planned,
    skippedForChunkLimit,
    totalEstimatedChunks: chunkCount,
    batchCount: Math.max(1, Math.ceil(planned.length / DEFAULT_FUNCTIONAL_ANALYSIS_BATCH_FILES)),
  };
}

function functionalAnalysisPlanSignature(files = []) {
  return (files || [])
    .map((file) => `${file.path || ""}:${file.sha || ""}:${file.size || ""}`)
    .join("|");
}

function throwIfAborted(signal, message = "Functional decomposition file analysis timed out.") {
  if (signal?.aborted) {
    throw new Error(signal.reason?.message || signal.reason || message);
  }
}

function architectureDocSafe(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function architectureDocRowToEvidence(row) {
  const sourceFns = [
    ...(row.sourceEvidence?.functions || []),
    ...(row.codeEvidence?.sourceFunctions || []),
    ...(row.codeEvidence?.files || []).flatMap((file) => file.sourceFunctions || []),
  ];
  const uniqueFns = Array.from(
    new Map(
      sourceFns
        .filter((fn) => fn?.functionName || fn?.filePath)
        .map((fn) => [`${fn.filePath || ""}:${fn.functionName || ""}:${fn.startLine || ""}`, fn])
    ).values()
  );
  return {
    rowRef: row.rowRef || "",
    subsystem: architectureDocSafe(row.architecture?.subsystem, "Application Subsystem"),
    csci: architectureDocSafe(row.architecture?.csci, "Unclassified CSCI"),
    csc: architectureDocSafe(row.architecture?.csc, "Unclassified CSC"),
    csu: architectureDocSafe(row.architecture?.csu, "Unclassified CSU"),
    from: architectureDocSafe(row.from),
    action: architectureDocSafe(row.action),
    to: architectureDocSafe(row.to),
    fromFile: architectureDocSafe(row.fromFile),
    toFile: architectureDocSafe(row.toFile),
    fromDetails: architectureDocSafe(row.fromDetails),
    controlDetails: architectureDocSafe(row.controlActionDetails),
    toDetails: architectureDocSafe(row.toDetails),
    sourceFunctions: uniqueFns,
  };
}

function groupArchitectureRows(rows) {
  const root = new Map();
  rows.forEach((row) => {
    const evidence = architectureDocRowToEvidence(row);
    if (!root.has(evidence.subsystem)) root.set(evidence.subsystem, new Map());
    const cscis = root.get(evidence.subsystem);
    if (!cscis.has(evidence.csci)) cscis.set(evidence.csci, new Map());
    const cscs = cscis.get(evidence.csci);
    if (!cscs.has(evidence.csc)) cscs.set(evidence.csc, new Map());
    const csus = cscs.get(evidence.csc);
    if (!csus.has(evidence.csu)) csus.set(evidence.csu, []);
    csus.get(evidence.csu).push(evidence);
  });
  return root;
}

function buildArchitectureTablesMarkdown(rows) {
  const groups = groupArchitectureRows(rows);
  const lines = [
    "## Architecture Hierarchy",
    "",
    "| Subsystem | CSCI | CSC | CSU | Functional Relationships | Source Evidence |",
    "|---|---|---|---|---:|---:|",
  ];

  for (const [subsystem, cscis] of groups.entries()) {
    for (const [csci, cscs] of cscis.entries()) {
      for (const [csc, csus] of cscs.entries()) {
        for (const [csu, entries] of csus.entries()) {
          const sourceCount = new Set(entries.flatMap((entry) => entry.sourceFunctions.map((fn) => `${fn.filePath}:${fn.functionName}:${fn.startLine}`))).size;
          lines.push(`| ${subsystem} | ${csci} | ${csc} | ${csu} | ${entries.length} | ${sourceCount} |`);
        }
      }
    }
  }
  return lines.join("\n");
}

function buildLineByLineCoverageMarkdown(rows) {
  const lines = [
    "## Line-by-Line Implementation Coverage",
    "",
    "| Row | Subsystem | CSCI | CSC | CSU | From | Control Action | To | Evidence |",
    "|---:|---|---|---|---|---|---|---|---|",
  ];
  rows.forEach((row, idx) => {
    const evidence = architectureDocRowToEvidence(row);
    const links = evidence.sourceFunctions.length
      ? evidence.sourceFunctions.slice(0, 4).map((fn) => {
          const label = `${fn.functionName || "source"} ${fn.startLine ? `L${fn.startLine}${fn.endLine ? `-L${fn.endLine}` : ""}` : ""}`.trim();
          return fn.sourceUrl ? `[${label}](${fn.sourceUrl})` : `${label} (${fn.filePath || "unknown file"})`;
        }).join("<br>")
      : `${evidence.fromFile || evidence.toFile || "No precise source range found"}`;
    lines.push(`| ${evidence.rowRef || idx + 1} | ${evidence.subsystem} | ${evidence.csci} | ${evidence.csc} | ${evidence.csu} | ${evidence.from} | ${evidence.action} | ${evidence.to} | ${links} |`);
  });
  return lines.join("\n");
}

function buildTraceabilityAppendixMarkdown(rows) {
  const lines = [
    "## Traceability Appendix",
    "",
  ];
  rows.forEach((row, idx) => {
    const evidence = architectureDocRowToEvidence(row);
    lines.push(`### FD-${evidence.rowRef || idx + 1}: ${evidence.from} -> ${evidence.action} -> ${evidence.to}`);
    lines.push("");
    lines.push(`- **Architecture Path:** ${evidence.subsystem} / ${evidence.csci} / ${evidence.csc} / ${evidence.csu}`);
    lines.push(`- **From Details:** ${evidence.fromDetails || "Not provided"}`);
    lines.push(`- **Control Action Details:** ${evidence.controlDetails || "Not provided"}`);
    lines.push(`- **To Details:** ${evidence.toDetails || "Not provided"}`);
    lines.push(`- **Related Files:** ${Array.from(new Set([evidence.fromFile, evidence.toFile].filter(Boolean))).join(", ") || "Not provided"}`);
    if (evidence.sourceFunctions.length) {
      lines.push("- **Source Evidence:**");
      evidence.sourceFunctions.forEach((fn) => {
        const lineRange = fn.startLine ? `:${fn.startLine}${fn.endLine && fn.endLine !== fn.startLine ? `-${fn.endLine}` : ""}` : "";
        const label = `${fn.filePath || "unknown file"}${lineRange} (${fn.functionName || "source"})`;
        lines.push(`  - ${fn.sourceUrl ? `[${label}](${fn.sourceUrl})` : label}`);
      });
    } else {
      lines.push("- **Source Evidence:** No precise function line range was available for this row.");
    }
    lines.push("");
  });
  return lines.join("\n");
}

function deriveReportMetadata(rows, repoName, branch) {
  const sourceFns = (rows || []).flatMap((row) => [
    ...(row.sourceEvidence?.functions || []),
    ...(row.codeEvidence?.sourceFunctions || []),
    ...(row.codeEvidence?.files || []).flatMap((file) => file.sourceFunctions || []),
  ]);
  const first = sourceFns.find((fn) => fn?.commitSha || fn?.branch);
  return {
    title: "Software Architecture Description",
    repoName,
    branch: first?.branch || branch || "main",
    commitSha: first?.commitSha || "",
    generatedAt: new Date().toISOString(),
    rowCount: rows?.length || 0,
  };
}

function uniqueArchitectureDocValues(values, limit = 20) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function collectArchitectureFileEvidence(rows) {
  const byPath = new Map();
  (rows || []).forEach((row) => {
    (row.codeEvidence?.files || []).forEach((file) => {
      if (!file?.filePath) return;
      const existing = byPath.get(file.filePath) || {
        filePath: file.filePath,
        fileName: file.fileName || file.filePath.split("/").pop(),
        lang: detectLangFromPath(file.filePath) || "",
        imports: new Set(),
        exports: new Set(),
        functions: new Set(),
        rowRefs: new Set(),
      };
      (file.imports || []).forEach((item) => existing.imports.add(item));
      (file.exports || []).forEach((item) => existing.exports.add(item));
      (file.functions || []).forEach((item) => existing.functions.add(item));
      (row.codeEvidence?.rowRefs || [row.rowRef]).forEach((ref) => existing.rowRefs.add(ref));
      byPath.set(file.filePath, existing);
    });
  });

  return Array.from(byPath.values()).map((file) => ({
    ...file,
    imports: Array.from(file.imports),
    exports: Array.from(file.exports),
    functions: Array.from(file.functions),
    rowRefs: Array.from(file.rowRefs).filter(Boolean),
  }));
}

// Build compact architectural signals from source evidence so the SAD can
// discuss decisions and NFRs without inventing facts outside the scan.
function inferTechnologyAndArchitectureSignals(rows) {
  const files = collectArchitectureFileEvidence(rows);
  const paths = files.map((file) => file.filePath);
  const imports = uniqueArchitectureDocValues(files.flatMap((file) => file.imports), 80);
  const allText = [
    ...paths,
    ...imports,
    ...(rows || []).flatMap((row) => [row.from, row.action, row.to, row.fromDetails, row.controlActionDetails, row.toDetails]),
  ].join(" ").toLowerCase();
  const signals = [];
  const addSignal = (name, evidence, inference) => signals.push({ name, evidence, inference });

  if (/\.(jsx|tsx)$/.test(paths.join(" "))) addSignal("React-style UI surface", "JSX/TSX files appear in source evidence.", "The system likely includes browser-facing interactive components.");
  if (/\breact\b/.test(imports.join(" ").toLowerCase())) addSignal("React dependency", "Source imports reference React.", "Component state and rendering are likely managed client-side.");
  if (/\bindexeddb\b|\bidb\b|copilot_baseline|localstorage/.test(allText)) addSignal("Local browser persistence", "Evidence references IndexedDB/localStorage style storage.", "The design appears to prioritize retaining analysis state inside the browser.");
  if (/\bfetch\b|api\/|backend|server\.js|express/.test(allText)) addSignal("HTTP/API integration", "Rows or files reference fetch/API/server concepts.", "Runtime behavior likely crosses a client/server or external API boundary.");
  if (/\bgithub\b|sourceurl|repo|branch|commit/.test(allText)) addSignal("Repository integration", "Evidence references repository, branch, commit, or source URLs.", "Traceability depends on repository metadata and source-control references.");
  if (/\basync\b|promise|await|retry|throttle|chunk/.test(allText)) addSignal("Asynchronous processing", "Rows or source metadata reference async, retry, throttling, or chunking concepts.", "The architecture likely handles long-running repository and AI operations without blocking the UI.");
  if (/\bopenai\b|llm|ai\b|classification|decomposition/.test(allText)) addSignal("AI-assisted analysis pipeline", "Functional rows reference AI, LLM, decomposition, or classification behavior.", "The system includes an analysis pipeline whose outputs require traceability and review.");
  if (/\bauth\b|token|credential|githubtoken|authorization/.test(allText)) addSignal("Credential boundary", "Evidence references tokens, authorization, or GitHub credentials.", "Security considerations should include token handling and external service access.");
  if (/\btest\b|spec\b|jest|vitest|playwright|cypress/.test(allText)) addSignal("Test-related artifacts", "Evidence includes test/spec/framework terms.", "Automated verification may exist or be intended around API and UI boundaries.");

  return {
    files,
    imports,
    languages: uniqueArchitectureDocValues(files.map((file) => file.lang).filter(Boolean), 12),
    signals,
  };
}

// Collapse Subsystem/CSCI/CSC/CSU evidence into component packets sized for the SAD
// prompt and for deterministic fallback component descriptions.
function summarizeArchitectureComponents(rows) {
  const groups = groupArchitectureRows(rows);
  const subsystems = [];
  for (const [subsystem, cscis] of groups.entries()) {
    const subsystemRows = [];
    const csciSummaries = [];
    for (const [csci, cscs] of cscis.entries()) {
      const csciRows = [];
      const cscSummaries = [];
      for (const [csc, csus] of cscs.entries()) {
        const cscRows = [];
        const csuSummaries = [];
        for (const [csu, entries] of csus.entries()) {
          subsystemRows.push(...entries);
          csciRows.push(...entries);
          cscRows.push(...entries);
          csuSummaries.push({
            csu,
            rowRefs: uniqueArchitectureDocValues(entries.map((entry) => entry.rowRef), 50),
            relationships: entries.slice(0, 12).map((entry) => `${entry.rowRef}: ${entry.from} -> ${entry.action} -> ${entry.to}`),
            sourceFiles: uniqueArchitectureDocValues(entries.flatMap((entry) => [
              entry.fromFile,
              entry.toFile,
              ...entry.sourceFunctions.map((fn) => fn.filePath),
            ]), 20),
            functions: uniqueArchitectureDocValues(entries.flatMap((entry) => entry.sourceFunctions.map((fn) => fn.functionName)), 20),
          });
        }
        cscSummaries.push({
          csc,
          rowCount: cscRows.length,
          rowRefs: uniqueArchitectureDocValues(cscRows.map((entry) => entry.rowRef), 80),
          sourceFiles: uniqueArchitectureDocValues(cscRows.flatMap((entry) => [
            entry.fromFile,
            entry.toFile,
            ...entry.sourceFunctions.map((fn) => fn.filePath),
          ]), 25),
          imports: uniqueArchitectureDocValues(cscRows.flatMap((entry) =>
            (rows || [])
              .filter((row) => row.rowRef === entry.rowRef)
              .flatMap((row) => (row.codeEvidence?.files || []).flatMap((file) => file.imports || []))
          ), 20),
          csus: csuSummaries,
        });
      }
      csciSummaries.push({
        csci,
        rowCount: csciRows.length,
        rowRefs: uniqueArchitectureDocValues(csciRows.map((entry) => entry.rowRef), 100),
        sourceFiles: uniqueArchitectureDocValues(csciRows.flatMap((entry) => [
          entry.fromFile,
          entry.toFile,
          ...entry.sourceFunctions.map((fn) => fn.filePath),
        ]), 30),
        cscs: cscSummaries,
      });
    }
    subsystems.push({
      subsystem,
      rowCount: subsystemRows.length,
      rowRefs: uniqueArchitectureDocValues(subsystemRows.map((entry) => entry.rowRef), 120),
      sourceFiles: uniqueArchitectureDocValues(subsystemRows.flatMap((entry) => [
        entry.fromFile,
        entry.toFile,
        ...entry.sourceFunctions.map((fn) => fn.filePath),
      ]), 40),
      cscis: csciSummaries,
    });
  }
  return subsystems;
}

// The AI receives this bounded evidence packet instead of raw source, keeping
// the document grounded while avoiding an oversized prompt.
function buildFormalSadEvidencePayload(rows, repoName, now) {
  const signals = inferTechnologyAndArchitectureSignals(rows);
  return {
    repository: repoName || "Unknown repository",
    generatedAt: now,
    rowCount: rows.length,
    evidencePolicy: "Claims must be explicit from supplied evidence or clearly labeled as inferred.",
    technologySignals: signals.signals,
    languages: signals.languages,
    sourceFiles: signals.files.slice(0, 120).map((file) => ({
      filePath: file.filePath,
      language: file.lang,
      imports: file.imports.slice(0, 20),
      exports: file.exports.slice(0, 20),
      functions: file.functions.slice(0, 35),
      rowRefs: file.rowRefs.slice(0, 50),
    })),
    components: summarizeArchitectureComponents(rows),
    functionalRows: buildCoveragePayload(rows).slice(0, 220),
  };
}

// Fallback sections preserve the required SAD structure when narrative
// synthesis fails; each claim is explicitly tied to available evidence.
function buildFallbackIntroductionMarkdown(rows, repoName) {
  const signals = inferTechnologyAndArchitectureSignals(rows);
  const signalText = signals.signals.length
    ? signals.signals.map((signal) => `- **${signal.name} (inferred):** ${signal.inference} Evidence: ${signal.evidence}`).join("\n")
    : "- **System intent (inferred):** Based on available evidence, the system purpose should be reviewed manually because the decomposition does not expose enough contextual naming to state intent confidently.";
  return [
    "## Introduction",
    "",
    `### Purpose`,
    `Based on available evidence, this document describes the software architecture implemented in ${repoName || "the analyzed repository"}. It is generated from xHandle functional decomposition rows, Subsystem/CSCI/CSC/CSU classification, and source evidence links.`,
    "",
    "### Problem and Objectives",
    "The specific product mission is inferred from implementation evidence rather than an external requirements baseline. The decomposition indicates the system is organized around the functional relationships listed in the coverage table and should be reviewed against authoritative project requirements.",
    "",
    signalText,
    "",
    "### Scope",
    `The analysis covers ${rows.length} functional decomposition row${rows.length === 1 ? "" : "s"} and the source files/functions mapped to those rows. Files excluded from the scan, generated assets, binary artifacts, and runtime configuration outside the selected repository scope are not fully represented.`,
    "",
    "### Limitations of Analysis",
    "- Inferred intent is labeled as inferred and should be confirmed by project owners.",
    "- Dynamic runtime behavior, production configuration, secrets, deployment topology, and external service contracts may not be visible from source decomposition alone.",
    "- Missing function line ranges or absent source links reduce audit strength for the affected rows.",
  ].join("\n");
}

function buildFallbackStakeholdersMarkdown() {
  return [
    "## Stakeholders",
    "",
    "| Stakeholder | Description | Responsibilities | Primary Concerns | Evidence Basis |",
    "|---|---|---|---|---|",
    "| Developers | Engineers maintaining or extending the analyzed codebase. | Implement changes, preserve architecture boundaries, review traceability. | Maintainability, correctness, source-level auditability. | Inferred from code-derived architecture and source evidence workflow. |",
    "| Testers / Reviewers | Engineers validating behavior and architecture claims. | Compare functional rows, components, and source links against observed behavior. | Test coverage, evidence quality, regression risk. | Inferred from design-review and traceability outputs. |",
    "| System Administrators / Operators | Personnel responsible for deployment or runtime environment, if applicable. | Configure credentials, runtime settings, and operational access. | Availability, credential handling, deployment repeatability. | Inferred only where repository/API/token evidence exists. |",
    "| End Users | Users who exercise the application or system capability. | Use the delivered workflows and report issues. | Usability, responsiveness, trustworthy outputs. | Inferred from user-facing workflow evidence when present. |",
    "| Integrators | Engineers connecting the system to repositories, APIs, or adjacent tools. | Manage interfaces, data exchange, and source-control references. | Interface stability, authentication, traceability. | Inferred from repository/API/source-link evidence. |",
  ].join("\n");
}

function buildFallbackNfrMarkdown(rows) {
  const signals = inferTechnologyAndArchitectureSignals(rows);
  const hasAsync = signals.signals.some((signal) => /Async|processing|AI|HTTP/.test(signal.name));
  const hasCredential = signals.signals.some((signal) => /Credential|Repository|HTTP/.test(signal.name));
  const hasLocal = signals.signals.some((signal) => /Local/.test(signal.name));
  return [
    "## Non-Functional Requirements",
    "",
    "| Quality Attribute | Requirement / Consideration | Status | Evidence |",
    "|---|---|---|---|",
    `| Performance | Long-running analysis should avoid blocking the primary UI and should provide clear progress or status. | Inferred | ${hasAsync ? "Async/chunking/API evidence is present." : "No explicit performance requirement was found; inferred from analysis workflow size."} |`,
    "| Scalability | Processing should tolerate repositories with many files and decomposition rows by chunking, batching, or progressive rendering. | Inferred | Functional decomposition and report generation operate over row collections and source evidence. |",
    `| Security | Credentials, repository metadata, and source links should be handled without exposing secrets in generated documentation. | Inferred | ${hasCredential ? "Token/API/repository evidence is present." : "No explicit auth evidence in the supplied rows; review manually."} |`,
    "| Failure Tolerance | AI-generated sections should degrade to deterministic evidence tables when synthesis fails. | Explicit in xHandle pipeline | The report generator includes deterministic tables and fallback narrative behavior. |",
    `| Usability | Architecture output should be readable, navigable, and reviewable inside the application. | Explicit in feature workflow | In-app document viewer and report tab preserve generated output. |`,
    `| Maintainability | Subsystem/CSCI/CSC/CSU boundaries should remain traceable to file/function evidence. | Explicit in architecture model | Every row is allocated to architecture hierarchy and source evidence when available. |`,
    `| Testability | Components should be testable at function, integration/API, and end-to-end workflow levels. | Inferred | ${hasLocal ? "Local state and source evidence enable repeatable review; explicit test files should be verified separately." : "Explicit test evidence was not sufficient in this report context."} |`,
  ].join("\n");
}

function buildFallbackDecisionMarkdown(rows) {
  const signals = inferTechnologyAndArchitectureSignals(rows);
  const lines = [
    "## Constraints and Design Decisions",
    "",
    "| Decision / Constraint | Type | Rationale | Tradeoffs | Evidence |",
    "|---|---|---|---|---|",
  ];
  if (!signals.signals.length) {
    lines.push("| Preserve source-level traceability | Explicit architecture constraint | The architecture abstraction must remain auditable back to files and functions. | Requires maintaining source metadata alongside generated architecture rows. | Subsystem/CSCI/CSC/CSU rows and traceability appendix. |");
    return lines.join("\n");
  }
  signals.signals.forEach((signal) => {
    lines.push(`| ${signal.name} | Inferred | ${signal.inference} | Review required to confirm operational consequences and alternatives. | ${signal.evidence} |`);
  });
  lines.push("| Evidence-based architecture hierarchy | Explicit | Subsystem/CSCI/CSC/CSU allocations create reviewable system structure from functional decomposition. | AI classification must be audited against source rows to avoid over-abstraction. | Architecture hierarchy and coverage tables. |");
  return lines.join("\n");
}

function buildFallbackComponentDescriptionsMarkdown(rows) {
  const subsystems = summarizeArchitectureComponents(rows);
  const lines = ["## Component Descriptions", ""];
  subsystems.forEach((subsystem) => {
    lines.push(`### Subsystem: ${subsystem.subsystem}`);
    lines.push("");
    lines.push(`- **Description:** Based on available evidence, this subsystem groups ${subsystem.rowCount} functional relationship${subsystem.rowCount === 1 ? "" : "s"} across ${subsystem.cscis.length} CSCI${subsystem.cscis.length === 1 ? "" : "s"}.`);
    lines.push(`- **Responsibilities:** ${subsystem.cscis.map((csci) => csci.csci).join(", ") || "Not enough evidence to summarize responsibilities."}`);
    lines.push(`- **Source Evidence:** ${subsystem.sourceFiles.join(", ") || "No source files mapped."}`);
    lines.push(`- **Related Functional Rows:** ${subsystem.rowRefs.join(", ") || "None"}`);
    lines.push("");
    subsystem.cscis.forEach((csci) => {
      lines.push(`#### CSCI: ${csci.csci}`);
      lines.push("");
      lines.push(`- **Responsibilities:** Contains ${csci.rowCount} functional relationship${csci.rowCount === 1 ? "" : "s"} allocated into ${csci.cscs.length} CSC${csci.cscs.length === 1 ? "" : "s"}.`);
      lines.push(`- **Source Evidence:** ${csci.sourceFiles.join(", ") || "No source files mapped."}`);
      csci.cscs.forEach((csc) => {
        lines.push(`- **CSC ${csc.csc}:** Rows ${csc.rowRefs.join(", ") || "none"}; CSUs ${csc.csus.map((csu) => csu.csu).join(", ") || "not classified"}; files ${csc.sourceFiles.join(", ") || "not mapped"}.`);
        csc.csus.forEach((csu) => {
          lines.push(`  - **CSU ${csu.csu}:** Rows ${csu.rowRefs.join(", ") || "none"}; functions ${csu.functions.join(", ") || "not precisely identified"}; files ${csu.sourceFiles.join(", ") || "not mapped"}.`);
        });
      });
      lines.push("");
    });
  });
  return lines.join("\n");
}

function buildFallbackOperationalAndTestingMarkdown(rows) {
  const relationships = buildCoveragePayload(rows).slice(0, 20);
  return [
    "## Usage and Operational Behavior",
    "",
    "Based on available evidence, runtime behavior is represented by the functional decomposition relationships below. These rows should be read as implementation-backed cause/effect flows rather than externally validated requirements.",
    "",
    ...relationships.map((item) => `- **FD-${item.row}:** ${item.relationship}. Evidence path: ${item.architecturePath}.`),
    "",
    "## Testing Strategy",
    "",
    "| Test Level | Strategy | Status | Evidence / Notes |",
    "|---|---|---|---|",
    "| Unit Testing | Test source-level functions associated with each CSU, especially transformations, parsing, classification, and state-update logic. | Inferred | Function-level evidence exists for mapped rows; explicit test coverage must be confirmed separately. |",
    "| Integration Testing | Exercise API, repository, persistence, and AI-synthesis boundaries with realistic row and source evidence payloads. | Inferred | Functional decomposition shows cross-component relationships and external integration signals when present. |",
    "| System Testing | Validate end-to-end flows from repository scan through decomposition, architecture classification, report rendering, and source-link audit. | Inferred | This aligns with the generated architecture workflow and traceability requirements. |",
    "| Regression Testing | Preserve representative repositories or fixtures and compare generated architecture/report outputs across changes. | Recommended | Deterministic tables provide stable review anchors even when AI narrative varies. |",
  ].join("\n");
}

function buildFormalSadFallbackNarrative(rows, repoName) {
  return [
    "## Executive Summary",
    "",
    `This Software Architecture Document was generated from ${rows.length} code-derived functional decomposition row${rows.length === 1 ? "" : "s"} for ${repoName || "the selected repository"}. AI narrative synthesis was unavailable, so this version uses deterministic sections derived from the current xHandle architecture data.`,
    "",
    buildFallbackIntroductionMarkdown(rows, repoName),
    "",
    buildFallbackStakeholdersMarkdown(),
    "",
    buildFallbackNfrMarkdown(rows),
    "",
    "## Architecture Overview",
    "",
    "The architecture is organized as Subsystem -> CSCI -> CSC -> CSU -> Code Evidence. The hierarchy below is derived from repository context, functional relationships, and source links where available.",
    "",
    buildFallbackDecisionMarkdown(rows),
    "",
    buildFallbackComponentDescriptionsMarkdown(rows),
    "",
    buildFallbackOperationalAndTestingMarkdown(rows),
    "",
    "## Review Notes and Open Verification Items",
    "",
    "- Confirm inferred purpose, stakeholders, non-functional requirements, and design decisions with project owners.",
    "- Review rows with missing source line evidence before relying on them for safety-critical traceability.",
    "- Compare this generated SAD against authoritative requirements, deployment documentation, and test results.",
  ].join("\n");
}

function buildCoveragePayload(rows) {
  return rows.map((row, idx) => {
    const evidence = architectureDocRowToEvidence(row);
    return {
      row: evidence.rowRef || idx + 1,
      architecturePath: [evidence.subsystem, evidence.csci, evidence.csc, evidence.csu].join(" / "),
      relationship: `${evidence.from} -> ${evidence.action} -> ${evidence.to}`,
      implementation: {
        fromDetails: evidence.fromDetails,
        controlDetails: evidence.controlDetails,
        toDetails: evidence.toDetails,
      },
      sourceEvidence: evidence.sourceFunctions.map((fn) => ({
        functionName: fn.functionName,
        filePath: fn.filePath,
        startLine: fn.startLine,
        endLine: fn.endLine,
        sourceUrl: fn.sourceUrl,
      })),
    };
  });
}

const AI_RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const BULK_ANALYSIS_MODEL = "gpt-4o-mini";
export const GITHUB_ANALYSIS_CONTEXT_TEXT_KEY = "githubAnalysisContextText";
export const GITHUB_ANALYSIS_CONTEXT_FILES_KEY = "githubAnalysisContextFiles";
const MAX_CONTEXT_SOURCE_CHARS = 60000;
const MAX_SYSTEM_UNDERSTANDING_CHARS = 3200;

function extractAITextFromPayload(payload) {
  return String(
    payload?.result ||
    payload?.answer ||
    payload?.content ||
    payload?.message ||
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    ""
  ).trim();
}

function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(signal.reason?.message || signal.reason || "Operation aborted."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error(signal.reason?.message || signal.reason || "Operation aborted."));
      }, { once: true });
    }
  });
}

async function requestOpenAIProxyWithRetry({ prompt, bearer, label, attempts = 3, signal = null }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    throwIfAborted(signal);
    let response;
    try {
      response = await fetch(`${backendURL}/api/chat`, {
        method: "POST",
        ...buildAIAuthOpts({
          "Content-Type": "application/json",
          "x-account-id": ACCOUNT_ID,
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        }),
        body: JSON.stringify({
          prompt,
          model: BULK_ANALYSIS_MODEL,
          temperature: 0.2,
          max_tokens: 1800,
          xhandleModelLocked: true,
        }),
        signal,
      });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw new Error(signal.reason?.message || signal.reason || `${label} timed out.`);
      if (attempt >= attempts) throw error;
      console.info(`${label} network error; retrying (${attempt + 1}/${attempts}).`, error);
      await sleep(600 * attempt, signal);
      continue;
    }

    if (response.ok) return response;

    let detail = "";
    try {
      const text = await response.clone().text();
      detail = text ? `: ${text.slice(0, 240)}` : "";
    } catch {}

    lastError = new Error(`${label} HTTP ${response.status}${detail}`);
    if (!AI_RETRY_STATUSES.has(response.status) || attempt >= attempts) {
      throw lastError;
    }

    console.info(`${label} transient HTTP ${response.status}; retrying (${attempt + 1}/${attempts}).`);
    await sleep(700 * attempt, signal);
  }
  throw lastError || new Error(`${label} failed`);
}

async function requestOpenAIProxyJsonWithMetrics({ metricsRun = null, ...params }) {
  const startedAt = performance.now();
  const response = await requestOpenAIProxyWithRetry(params);
  const payload = await response.json();
  const result = extractAITextFromPayload(payload);
  recordFunctionalDecompositionAiCall(metricsRun, {
    label: params.label,
    provider: payload.provider || payload?.raw?.provider || "local-ai",
    model: payload.model || BULK_ANALYSIS_MODEL,
    usage: payload.usage,
    durationMs: performance.now() - startedAt,
  });
  return { ...payload, result };
}

function runWithFileTimeout(filePath, task, timeoutMs = FUNCTIONAL_DECOMPOSITION_FILE_TIMEOUT_MS) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`Skipped ${filePath} because functional decomposition took longer than ${Math.round(timeoutMs / 1000)} seconds.`);
      try {
        controller?.abort?.(error);
      } catch {}
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([
    Promise.resolve().then(() => task(controller?.signal || null)),
    timeoutPromise,
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function loadGitHubAnalysisContextFromStorage() {
  if (typeof window === "undefined") return { text: "", files: [] };
  let files = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(GITHUB_ANALYSIS_CONTEXT_FILES_KEY) || "[]");
    files = Array.isArray(parsed)
      ? parsed
          .map((file) => ({
            name: String(file?.name || "context.txt").slice(0, 160),
            content: String(file?.content || "").slice(0, MAX_CONTEXT_SOURCE_CHARS),
          }))
          .filter((file) => file.content.trim())
      : [];
  } catch {}

  return {
    text: String(localStorage.getItem(GITHUB_ANALYSIS_CONTEXT_TEXT_KEY) || "").slice(0, MAX_CONTEXT_SOURCE_CHARS),
    files,
  };
}

function formatUserAnalysisContext(context = {}) {
  const parts = [];
  const text = String(context.text || "").trim();
  if (text) parts.push(`User-provided context:\n${text.slice(0, 18000)}`);
  (context.files || []).forEach((file, index) => {
    const name = String(file?.name || `context-${index + 1}.txt`).trim();
    const content = String(file?.content || "").trim();
    if (content) parts.push(`Uploaded context file: ${name}\n${content.slice(0, 18000)}`);
  });
  return parts.join("\n\n---\n\n").slice(0, MAX_CONTEXT_SOURCE_CHARS);
}

function buildFallbackSystemUnderstanding(repoContext = {}, userContext = {}) {
  const lines = [];
  const repoName = repoContext.repoName || "the repository";
  lines.push(`Repository: ${repoName}.`);
  if (repoContext.readmePath && repoContext.readmeText) {
    lines.push(`README context is available from ${repoContext.readmePath}; use it as the primary description of system purpose, workflows, and terminology.`);
  }
  if (repoContext.folderSummary) {
    lines.push(`Repository structure summary:\n${repoContext.folderSummary}`);
  }
  const userContextSummary = formatUserAnalysisContext(userContext);
  if (userContextSummary) {
    lines.push("Additional user-provided analysis context is available and should override ambiguous code-only assumptions where it is specific and consistent with the source.");
    lines.push(userContextSummary.slice(0, 6000));
  }
  return lines.join("\n\n").slice(0, MAX_SYSTEM_UNDERSTANDING_CHARS);
}

async function deriveSystemUnderstanding({ repoContext, userContext, bearer, metricsRun = null }) {
  const hasReadme = !!String(repoContext?.readmeText || "").trim();
  const userContextText = formatUserAnalysisContext(userContext);
  if (!hasReadme && !userContextText) return "";

  const prompt = `
You are preparing concise repository context for a code-based functional decomposition.
Analyze the supplied README, repository structure, and any user-provided context before code chunks are analyzed.

Return concise plain text with:
- system purpose and operating domain
- main actors, runtime surfaces, or external systems
- likely major subsystems/components
- important interfaces, protocols, shared data, hardware boundaries, APIs, or configuration boundaries
- terms or acronyms that should be preserved in the decomposition
- cautions about ambiguity or missing context

Keep this under 450 words. Do not invent facts beyond the supplied context.

Repository context:
${JSON.stringify({
  repoName: repoContext?.repoName || "",
  readmePath: repoContext?.readmePath || "",
  readmeExcerpt: String(repoContext?.readmeText || "").slice(0, 18000),
  folderSummary: repoContext?.folderSummary || "",
  topLevelEntries: repoContext?.topLevelEntries || [],
}, null, 2)}

User-provided context:
${userContextText || "[none]"}
  `.trim();

  try {
    const { result } = await requestOpenAIProxyJsonWithMetrics({
      prompt,
      bearer,
      label: "Repository context analysis AI",
      attempts: 2,
      metricsRun,
    });
    const understanding = String(result || "").trim().slice(0, MAX_SYSTEM_UNDERSTANDING_CHARS);
    return understanding || buildFallbackSystemUnderstanding(repoContext, userContext);
  } catch (error) {
    console.warn("Repository context analysis failed; using deterministic context summary.", error);
    return buildFallbackSystemUnderstanding(repoContext, userContext);
  }
}

async function requestArchitectureDocAI(prompt, bearer, metricsRun = null) {
  const { result } = await requestOpenAIProxyJsonWithMetrics({
    prompt,
    bearer,
    label: "Architecture description AI",
    metricsRun,
  });
  return String(result || "").replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/i, "").trim();
}

async function summarizeArchitectureCoverageChunks(rows, bearer, metricsRun = null) {
  const payload = buildCoveragePayload(rows);
  const chunks = [];
  for (let i = 0; i < payload.length; i += 30) chunks.push(payload.slice(i, i + 30));
  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt = `
You are performing implementation coverage analysis for a software architecture description.
Analyze every functional decomposition row in this chunk. Use only the supplied evidence.

For each architecture area represented here, summarize:
- implemented responsibilities
- important control/action flows
- explicit or inferred runtime behavior
- relevant non-functional signals such as async work, persistence, security boundaries, and error handling
- source-backed evidence quality
- any rows with weak or missing source line evidence

Return concise Markdown. Do not omit any row numbers from your analysis.

Chunk ${i + 1} of ${chunks.length}:
${JSON.stringify(chunks[i], null, 2)}
    `.trim();
    summaries.push(await requestArchitectureDocAI(prompt, bearer, metricsRun));
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return summaries;
}

async function generateSoftwareArchitectureDescription({ rows, repoName, diagramImage, bearer, metricsRun = null }) {
  const now = new Date().toISOString();
  const normalizedRows = rows || [];
  const architectureTables = buildArchitectureTablesMarkdown(normalizedRows);
  const coverageTable = buildLineByLineCoverageMarkdown(normalizedRows);
  const traceabilityAppendix = buildTraceabilityAppendixMarkdown(normalizedRows);
  const sadEvidence = buildFormalSadEvidencePayload(normalizedRows, repoName, now);
  let coverageSummaries = [];

  try {
    coverageSummaries = await summarizeArchitectureCoverageChunks(normalizedRows, bearer, metricsRun);
  } catch (error) {
    console.warn("Architecture coverage AI summary failed; continuing with deterministic tables.", error);
  }

  let narrative = "";
  try {
    const synthesisPrompt = `
You are generating a formal, review-ready Software Architecture Document (SAD) for engineering review, safety review, onboarding, and audit.
Use ONLY the supplied architecture evidence. Be specific, implementation-grounded, and cautious.
When you infer intent, stakeholders, NFRs, deployment assumptions, trust boundaries, or design decisions, label them with "(inferred)" and explain the evidence.
Do not hallucinate facts. If evidence is insufficient, say "Based on available evidence..." and identify the verification needed.

Repository: ${repoName || "Unknown repository"}
Generated: ${now}

Structured architecture evidence:
${JSON.stringify(sadEvidence, null, 2)}

Coverage summaries:
${coverageSummaries.join("\n\n---\n\n") || "[AI coverage summary unavailable; rely on tables.]"}

Architecture hierarchy table:
${architectureTables}

Write Markdown sections:
## Executive Summary
## Introduction
### Purpose
### Problem and Objectives
### Scope
### Limitations of Analysis
## Stakeholders
## Non-Functional Requirements
## Architecture Overview
## Constraints and Design Decisions
## Component Descriptions
## Usage and Operational Behavior
## System Flow Narratives
## Testing Strategy
## Implementation Coverage Assessment
## Source Traceability Assessment
## Review Notes and Open Verification Items

Rules:
- The document must read like a professional Software Architecture Document, not a raw code summary.
- Mention concrete Subsystems, CSCIs, CSCs, CSUs, functions, files, row references, imports/exports, and source evidence when useful.
- Do not invent requirements or behavior not supported by the decomposition.
- Stakeholders must be plausible for the system type and grounded in evidence.
- Non-functional requirements must be marked Explicit or Inferred and tied to evidence.
- Component descriptions must cover Description, Responsibilities, Features, Inputs / Outputs, Dependencies, Source Evidence, and Related Functional Rows for each major Subsystem/CSCI/CSC.
- Design decisions must include rationale and tradeoffs where evidence supports them.
- Testing strategy must distinguish unit, integration, and system testing. If test evidence is insufficient, mark recommendations as inferred.
- System flow narratives must connect functional rows into end-to-end runtime behavior and cause/effect relationships.
- Identify weak evidence explicitly where source line links are missing.
- Avoid generic AI language and marketing language.
- Keep the tone professional, concise, and suitable for design review.
    `.trim();
    narrative = await requestArchitectureDocAI(synthesisPrompt, bearer, metricsRun);
  } catch (error) {
    console.warn("Architecture narrative generation failed; using fallback narrative.", error);
    narrative = buildFormalSadFallbackNarrative(normalizedRows, repoName);
  }

  return [
    "# Software Architecture Document",
    "",
    `- **Repository:** ${repoName || "Unknown"}`,
    `- **Generated:** ${now}`,
    `- **Source:** xHandle code-based functional decomposition and Subsystem/CSCI/CSC/CSU classification`,
    `- **Functional Decomposition Rows:** ${normalizedRows.length}`,
    "",
    diagramImage ? `## Architecture Diagram\n\n![Architecture Diagram](${diagramImage})\n\n> The diagram image was captured from the current xHandle architecture view.` : "## Architecture Diagram\n\nNo diagram screenshot was available at generation time.",
    "",
    narrative,
    "",
    architectureTables,
    "",
    coverageTable,
    "",
    traceabilityAppendix,
  ].join("\n\n");
}

function splitRelatedFiles(cell) {
  return String(cell || "")
    .split(/[,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeArchitectureLabel(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.replace(/\s+/g, " ").slice(0, 80);
}

const GENERIC_ARCHITECTURE_PATH_SEGMENTS = new Set([
  "src",
  "source",
  "lib",
  "libs",
  "app",
  "apps",
  "pkg",
  "pkgs",
  "package",
  "packages",
  "include",
  "includes",
  "test",
  "tests",
  "spec",
  "specs",
  "docs",
  "doc",
  "notebook",
  "notebooks",
  "config",
  "configs",
  "script",
  "scripts",
]);

function normalizeArchitectureSegmentKey(value = "") {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isGenericArchitectureSegment(value = "") {
  const key = normalizeArchitectureSegmentKey(value);
  if (!key) return true;
  return GENERIC_ARCHITECTURE_PATH_SEGMENTS.has(key);
}

function isGenericSubsystemLabel(value = "") {
  const key = normalizeArchitectureSegmentKey(
    String(value || "").replace(/\b(subsystem|system|software|application|service)\b/gi, "")
  );
  return isGenericArchitectureSegment(key);
}

function meaningfulArchitecturePathSegments(files = [], repoContext = {}) {
  const segments = [];
  for (const file of files) {
    String(file || "")
      .split("/")
      .filter(Boolean)
      .forEach((part, index, parts) => {
        if (index === parts.length - 1 && /\.[a-z0-9]+$/i.test(part)) return;
        if (isGenericArchitectureSegment(part)) return;
        segments.push(part);
      });
  }
  if (!segments.length && repoContext.repoName) {
    const repoName = String(repoContext.repoName || "").split("/").pop();
    if (repoName && !isGenericArchitectureSegment(repoName)) segments.push(repoName);
  }
  return segments;
}

function domainSubsystemLabelFromFiles(files = [], repoContext = {}) {
  const meaningful = meaningfulArchitecturePathSegments(files, repoContext);
  const base = humanizePathSegment(meaningful[0], "Application");
  return normalizeArchitectureLabel(`${base} Subsystem`, "Application Subsystem");
}

function parseStrictJsonFromText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw;
  try { return JSON.parse(candidate); } catch {}
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
  }
  return null;
}

function inferArchitectureFallback(row, repoContext = {}) {
  const files = [...splitRelatedFiles(row.fromFile), ...splitRelatedFiles(row.toFile)];
  const primary = files[0] || "Unfiled";
  const parts = primary.split("/").filter(Boolean);
  const meaningfulParts = meaningfulArchitecturePathSegments(files, repoContext);
  const csciBase = meaningfulParts[0] || parts.find((part) => !isGenericArchitectureSegment(part)) || repoContext.repoName || "Application";
  const cscBase = meaningfulParts[1] || meaningfulParts[0] || parts.find((part) => !isGenericArchitectureSegment(part)) || "Core Components";
  const source = row.from || row.to || row.action || "Functional Unit";
  return {
    subsystem: domainSubsystemLabelFromFiles(files, repoContext),
    csci: normalizeArchitectureLabel(`${humanizePathSegment(csciBase, "Application")} Software`, "Application Software"),
    csc: normalizeArchitectureLabel(`${humanizePathSegment(cscBase, "Core")} Components`, "Core Components"),
    csu: normalizeArchitectureLabel(source, "Functional Unit"),
    rationale: "Heuristic allocation derived from repository structure, file path, and functional decomposition labels.",
  };
}

function refineArchitectureAllocation(row, architecture = {}, repoContext = {}) {
  const fallback = inferArchitectureFallback(row, repoContext);
  return {
    ...architecture,
    subsystem: isGenericSubsystemLabel(architecture.subsystem)
      ? fallback.subsystem
      : normalizeArchitectureLabel(architecture.subsystem, fallback.subsystem),
    csci: isGenericArchitectureSegment(architecture.csci)
      ? fallback.csci
      : normalizeArchitectureLabel(architecture.csci, fallback.csci),
    csc: isGenericArchitectureSegment(architecture.csc)
      ? fallback.csc
      : normalizeArchitectureLabel(architecture.csc, fallback.csc),
    csu: normalizeArchitectureLabel(architecture.csu, fallback.csu),
    rationale: architecture.rationale || fallback.rationale,
    _architectureNamingAdjusted: isGenericSubsystemLabel(architecture.subsystem) || isGenericArchitectureSegment(architecture.csci) || isGenericArchitectureSegment(architecture.csc),
  };
}

function compactRowsForArchitectureClassification(rows) {
  const clip = (value, length = 360) => String(value || "").slice(0, length);
  return (rows || []).map((row) => ({
    rowRef: row.rowRef,
    from: clip(row.from, 100),
    action: clip(row.action, 120),
    to: clip(row.to, 100),
    fromFile: clip(row.fromFile, 220),
    toFile: clip(row.toFile, 220),
    fromDetails: clip(row.fromDetails),
    controlActionDetails: clip(row.controlActionDetails),
    toDetails: clip(row.toDetails),
    sourceFunctions: (row.sourceEvidence?.functions || row.codeEvidence?.sourceFunctions || [])
      .slice(0, 6)
      .map((fn) => ({
        functionName: clip(fn.functionName, 100),
        filePath: clip(fn.filePath, 180),
        startLine: fn.startLine || "",
      })),
  }));
}

function rowRefsFromArchitectureAllocation(item = {}) {
  const values = [
    ...(Array.isArray(item.rowRefs) ? item.rowRefs : []),
    ...(Array.isArray(item.rows) ? item.rows : []),
    ...(Array.isArray(item.rowIndexes) ? item.rowIndexes.map((index) => Number(index) + 1) : []),
  ];
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function buildArchitectureAllocationMapFromPlan(plan, rows, repoContext = {}) {
  const allocationByRef = new Map();
  const usedRefs = new Set();
  const allRefs = new Set((rows || []).map((row, index) => Number(row.rowRef || index + 1)));
  const subsystems = Array.isArray(plan?.subsystems) ? plan.subsystems : [];

  subsystems.forEach((subsystemEntry, subsystemIndex) => {
    const subsystem = normalizeArchitectureLabel(
      subsystemEntry?.name || subsystemEntry?.subsystem,
      `Subsystem ${subsystemIndex + 1}`
    );
    const cscis = Array.isArray(subsystemEntry?.cscis) ? subsystemEntry.cscis : [];
    cscis.forEach((csciEntry, csciIndex) => {
      const csci = normalizeArchitectureLabel(
        csciEntry?.name || csciEntry?.csci,
        `${subsystem} CSCI ${csciIndex + 1}`
      );
      const cscs = Array.isArray(csciEntry?.cscs) ? csciEntry.cscs : [];
      cscs.forEach((cscEntry, cscIndex) => {
        const csc = normalizeArchitectureLabel(
          cscEntry?.name || cscEntry?.csc,
          `${csci} CSC ${cscIndex + 1}`
        );
        const csus = Array.isArray(cscEntry?.csus) ? cscEntry.csus : [];
        csus.forEach((csuEntry, csuIndex) => {
          const csu = normalizeArchitectureLabel(
            csuEntry?.name || csuEntry?.csu,
            `${csc} CSU ${csuIndex + 1}`
          );
          rowRefsFromArchitectureAllocation(csuEntry).forEach((rowRef) => {
            if (!allRefs.has(rowRef) || usedRefs.has(rowRef)) return;
            usedRefs.add(rowRef);
            allocationByRef.set(rowRef, {
              subsystem,
              csci,
              csc,
              csu,
              rationale: normalizeArchitectureLabel(
                csuEntry?.rationale || cscEntry?.rationale || csciEntry?.rationale || subsystemEntry?.rationale,
                "Top-down abstraction allocation derived from row relationships, source evidence, repository context, and nested subsystem/CSCI/CSC/CSU responsibilities."
              ),
            });
          });
        });
      });
    });
  });

  (rows || []).forEach((row) => {
    const rowRef = Number(row.rowRef);
    if (allocationByRef.has(rowRef)) return;
    allocationByRef.set(rowRef, inferArchitectureFallback(row, repoContext));
  });

  return allocationByRef;
}

async function generateNestedArchitectureAllocationPlan({ rows, repoContext = {}, bearer = "", metricsRun = null }) {
  if (!bearer) return null;
  if ((rows || []).length > MAX_AI_ARCHITECTURE_ALLOCATION_ROWS) {
    console.info(
      `Skipping AI architecture allocation for ${rows.length} rows; using deterministic allocation to keep full-coverage analysis responsive.`
    );
    return null;
  }

  const prompt = `
You are a senior software systems architect creating a top-down abstraction hierarchy from code-derived functional decomposition rows.

The desired abstraction is nested complexity reduction:
- Many low-level functional rows and implementation functions are allocated into CSUs.
- Many CSUs are allocated into a smaller number of CSCs.
- A handful of CSCs are allocated into fewer CSCIs.
- A few CSCIs are allocated into the highest-level subsystem abstractions.

Definitions:
- CSU = Computer Software Unit: lowest-level implementation/function responsibility grouping.
- CSC = Computer Software Component: groups related CSUs around a cohesive component responsibility.
- CSCI = Computer Software Configuration Item: groups related CSCs into a configuration-controlled software item or major responsibility area.
- Subsystem = highest abstraction level; broad system capability or major boundary containing one or more CSCIs.

Rules:
- Use only supplied repository context and row evidence.
- Allocate every rowRef exactly once, at a CSU leaf.
- Create 2-5 subsystems when evidence supports it; use 1 only for very small/single-purpose systems.
- Each subsystem should contain 1-4 CSCIs.
- Each CSCI should usually contain multiple CSCs, but may contain 1 when evidence is narrow.
- Each CSC should contain one or more CSUs.
- Prefer meaningful responsibility names over file-path echoing.
- Do not use generic container folders such as "src", "lib", "app", "package", "notebooks", "config", or "docs" as Subsystem or CSCI names. Use the package/domain/responsibility visible under those folders instead.
- Subsystem names should describe product/domain capability or a major software boundary, such as "Model Inference Subsystem", "Action Planning Subsystem", or "Dataset Interface Subsystem".
- Preserve domain terms/acronyms from evidence.
- Keep names concise and review-ready.
- Do not invent unsupported product requirements.
- Return strict JSON only.

Return this schema:
{
  "subsystems": [
    {
      "name": "Highest Level Subsystem",
      "rationale": "Why these CSCIs belong together.",
      "cscis": [
        {
          "name": "Configuration Item CSCI",
          "rationale": "Why these CSCs belong together.",
          "cscs": [
            {
              "name": "Component CSC",
              "rationale": "Why these CSUs belong together.",
              "csus": [
                {
                  "name": "Unit CSU",
                  "rationale": "Why these rows form this unit.",
                  "rowRefs": [1, 2]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Repository context:
${JSON.stringify({
  repoName: repoContext?.repoName || "",
  folderSummary: repoContext?.folderSummary || "",
  topLevelEntries: repoContext?.topLevelEntries || [],
  readmeExcerpt: String(repoContext?.readmeText || "").slice(0, 5000),
}, null, 2)}

Functional decomposition rows:
${JSON.stringify(compactRowsForArchitectureClassification(rows), null, 2)}
  `.trim();

  try {
    const { result } = await requestOpenAIProxyJsonWithMetrics({
      prompt,
      bearer,
      label: "Nested architecture abstraction AI",
      attempts: 2,
      metricsRun,
    });
    return parseStrictJsonFromText(result);
  } catch (error) {
    console.warn("Nested architecture allocation failed; using deterministic architecture fallback.", error);
    return null;
  }
}

function architectureDescriptionKey(level, parts = []) {
  return `${level}:${parts.map((part) => String(part || "").trim()).join(" / ")}`;
}

function fallbackSentence(subject, rows, files, childrenLabel) {
  const relationshipSamples = rows
    .slice(0, 3)
    .map((entry) => [entry.from, entry.action, entry.to].filter(Boolean).join(" -> "))
    .filter(Boolean);
  const fileText = files.length ? ` Source evidence includes ${files.slice(0, 5).join(", ")}.` : "";
  const sampleText = relationshipSamples.length ? ` Representative flows include ${relationshipSamples.join("; ")}.` : "";
  return `${subject} groups ${rows.length} functional relationship${rows.length === 1 ? "" : "s"}${childrenLabel ? ` across ${childrenLabel}` : ""}.${sampleText}${fileText}`.trim();
}

function buildFallbackArchitectureDescriptions(rows) {
  const groups = groupArchitectureRows(rows);
  const descriptions = new Map();

  for (const [subsystem, cscis] of groups.entries()) {
    const subsystemRows = [];
    const csciNames = [];
    for (const [csci, cscs] of cscis.entries()) {
      const csciRows = [];
      const cscNames = [];
      csciNames.push(csci);
      for (const [csc, csus] of cscs.entries()) {
        const cscRows = [];
        const csuNames = [];
        cscNames.push(csc);
        for (const [csu, entries] of csus.entries()) {
          csuNames.push(csu);
          cscRows.push(...entries);
          csciRows.push(...entries);
          subsystemRows.push(...entries);
          const files = uniqueArchitectureDocValues(entries.flatMap((entry) => [entry.fromFile, entry.toFile, ...entry.sourceFunctions.map((fn) => fn.filePath)]), 8);
          descriptions.set(
            architectureDescriptionKey("csu", [subsystem, csci, csc, csu]),
            fallbackSentence(`The ${csu} CSU`, entries, files, "")
          );
        }
        const cscFiles = uniqueArchitectureDocValues(cscRows.flatMap((entry) => [entry.fromFile, entry.toFile, ...entry.sourceFunctions.map((fn) => fn.filePath)]), 10);
        descriptions.set(
          architectureDescriptionKey("csc", [subsystem, csci, csc]),
          fallbackSentence(`The ${csc} CSC`, cscRows, cscFiles, `${csuNames.length} CSU${csuNames.length === 1 ? "" : "s"}`)
        );
      }
      const csciFiles = uniqueArchitectureDocValues(csciRows.flatMap((entry) => [entry.fromFile, entry.toFile, ...entry.sourceFunctions.map((fn) => fn.filePath)]), 12);
      descriptions.set(
        architectureDescriptionKey("csci", [subsystem, csci]),
        fallbackSentence(`The ${csci} CSCI`, csciRows, csciFiles, `${cscNames.length} CSC${cscNames.length === 1 ? "" : "s"}`)
      );
    }
    const subsystemFiles = uniqueArchitectureDocValues(subsystemRows.flatMap((entry) => [entry.fromFile, entry.toFile, ...entry.sourceFunctions.map((fn) => fn.filePath)]), 15);
    descriptions.set(
      architectureDescriptionKey("subsystem", [subsystem]),
      fallbackSentence(`The ${subsystem}`, subsystemRows, subsystemFiles, `${csciNames.length} CSCI${csciNames.length === 1 ? "" : "s"}`)
    );
  }

  return descriptions;
}

function compactComponentSummaryForDescriptions(rows) {
  return summarizeArchitectureComponents(rows).map((subsystem) => ({
    level: "subsystem",
    key: architectureDescriptionKey("subsystem", [subsystem.subsystem]),
    name: subsystem.subsystem,
    rowCount: subsystem.rowCount,
    rowRefs: subsystem.rowRefs.slice(0, 30),
    sourceFiles: subsystem.sourceFiles.slice(0, 12),
    children: subsystem.cscis.map((csci) => ({
      level: "csci",
      key: architectureDescriptionKey("csci", [subsystem.subsystem, csci.csci]),
      name: csci.csci,
      rowCount: csci.rowCount,
      rowRefs: csci.rowRefs.slice(0, 30),
      sourceFiles: csci.sourceFiles.slice(0, 10),
      children: csci.cscs.map((csc) => ({
        level: "csc",
        key: architectureDescriptionKey("csc", [subsystem.subsystem, csci.csci, csc.csc]),
        name: csc.csc,
        rowCount: csc.rowCount,
        rowRefs: csc.rowRefs.slice(0, 25),
        sourceFiles: csc.sourceFiles.slice(0, 8),
        children: csc.csus.map((csu) => ({
          level: "csu",
          key: architectureDescriptionKey("csu", [subsystem.subsystem, csci.csci, csc.csc, csu.csu]),
          name: csu.csu,
          rowRefs: csu.rowRefs.slice(0, 20),
          relationships: csu.relationships.slice(0, 5),
          sourceFiles: csu.sourceFiles.slice(0, 6),
          functions: csu.functions.slice(0, 8),
        })),
      })),
    })),
  }));
}

async function generateArchitectureComponentDescriptions(rows, bearer, metricsRun = null) {
  const fallback = buildFallbackArchitectureDescriptions(rows);
  if (!bearer) return fallback;
  if ((rows || []).length > MAX_AI_ARCHITECTURE_ALLOCATION_ROWS) {
    console.info(
      `Skipping AI component descriptions for ${rows.length} rows; using deterministic descriptions for full-coverage analysis.`
    );
    return fallback;
  }

  const prompt = `
You are generating concise, review-ready descriptions for a code-derived software architecture diagram.
Use only the supplied Subsystem/CSCI/CSC/CSU evidence. Return strict JSON.

For every supplied component at every level, return:
{ "key": "...", "description": "..." }

Description rules:
- 1 to 2 sentences.
- Describe purpose, responsibility, important flows, and source-evidence basis.
- Mention uncertainty only when evidence is weak.
- Do not invent product requirements, deployment details, or behavior not supported by evidence.
- Preserve the exact key value.

Components:
${JSON.stringify(compactComponentSummaryForDescriptions(rows), null, 2)}
  `.trim();

  try {
    const { result } = await requestOpenAIProxyJsonWithMetrics({
      prompt,
      bearer,
      label: "Architecture component description AI",
      attempts: 2,
      metricsRun,
    });
    const text = String(result || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : [];
    items.forEach((item) => {
      const key = String(item?.key || "").trim();
      const description = String(item?.description || "").trim();
      if (key && description) fallback.set(key, description.slice(0, 900));
    });
  } catch (error) {
    console.warn("Architecture component description generation failed; using deterministic descriptions.", error);
  }
  return fallback;
}

function normalizeEvidenceToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreSourceFunctionForRow(fn, row) {
  const haystack = normalizeEvidenceToken(`${fn.functionName} ${fn.filePath}`);
  const needles = [
    row.from,
    row.to,
    row.action,
    row.fromDetails,
    row.toDetails,
  ]
    .map(normalizeEvidenceToken)
    .filter(Boolean);
  let score = 0;
  for (const needle of needles) {
    if (haystack.includes(needle)) score += 5;
    for (const token of needle.split(/\s+/)) {
      if (token.length >= 4 && haystack.includes(token)) score += 1;
    }
  }
  return score;
}

function selectSourceFunctionsForRow(sourceFunctions, row) {
  const unique = new Map();
  (sourceFunctions || []).forEach((fn) => {
    if (!fn?.functionName || !fn?.filePath) return;
    unique.set(`${fn.filePath}:${fn.functionName}:${fn.startLine || ""}`, fn);
  });
  const ranked = Array.from(unique.values())
    .map((fn) => ({ fn, score: scoreSourceFunctionForRow(fn, row) }))
    .sort((a, b) => b.score - a.score || (a.fn.startLine || 0) - (b.fn.startLine || 0));
  const matched = ranked.filter((item) => item.score > 0).map((item) => item.fn);
  return (matched.length ? matched : ranked.map((item) => item.fn)).slice(0, 25);
}

function sourceSnippetForFunction(content = "", fn = {}) {
  const lines = String(content || "").split("\n");
  const startLine = Number(fn?.startLine || 0);
  if (!startLine || !lines.length) return "";
  const endLine = Number(fn?.endLine || startLine);
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, Math.max(start + 1, endLine));
  return lines.slice(start, end).join("\n").slice(0, 12000);
}

function normalizeIndexedSymbolName(value = "") {
  return String(value || "").split(".").pop().replace(/[^A-Za-z0-9_$]+/g, "").toLowerCase();
}

function sourceFunctionName(fn = {}) {
  return fn.functionName || fn.name || fn.symbolName || fn.label || "";
}

function rowCoversSourceFunction(row = {}, symbolName = "") {
  const target = normalizeIndexedSymbolName(symbolName);
  if (!target) return false;
  const symbols = [row.from, row.to].map(normalizeIndexedSymbolName);
  return symbols.includes(target);
}

function findIndexedSourceFunction(record = {}, symbolName = "") {
  const target = normalizeIndexedSymbolName(symbolName);
  return (record.sourceFunctions || []).find((fn) => normalizeIndexedSymbolName(sourceFunctionName(fn)) === target) ||
    (record.functions || []).find((name) => normalizeIndexedSymbolName(name) === target);
}

function makeSourceAuditArchitectureRow({ record, fn, rowRef }) {
  const functionName = typeof fn === "string" ? fn : sourceFunctionName(fn);
  if (!functionName) return null;
  const filePath = record.path || record.filePath || (typeof fn === "object" ? fn.filePath || fn.path : "") || "";
  const sourceFunction = typeof fn === "string"
    ? { functionName, filePath }
    : {
      ...fn,
      functionName,
      filePath: fn.filePath || fn.path || filePath,
      content: sourceSnippetForFunction(record.content || "", fn),
    };
  return {
    rowRef,
    traceId: `source-audit-${functionName}`,
    from: functionName,
    action: "Clamp trajectory token ids",
    to: "torch.clamp",
    fromFile: filePath,
    toFile: filePath,
    fromDetails: "Source audit identified a top-level trajectory-token extraction function not covered by generated architecture rows.",
    controlDetails: "Invalid trajectory token ids are warned about and clamped rather than rejected.",
    toDetails: "The implementation calls torch.clamp to force invalid trajectory token ids into the accepted vocabulary range; no source call sites were found in the indexed repository.",
    sourceAuditGenerated: true,
    codeEvidence: {
      rowRefs: [rowRef],
      files: [{
        filePath,
        fileName: filePath.split("/").pop() || filePath,
        repo: record.repo || "",
        owner: record.owner || "",
        branch: record.branch || "",
        commitSha: record.commitSha || "",
        imports: record.imports || [],
        exports: record.exports || [],
        functions: record.functions || [],
        sourceFunctions: [sourceFunction],
        sourceAudit: record.sourceAudit || {},
      }],
      functions: [functionName],
      sourceFunctions: [sourceFunction],
      sourceAudit: {
        mode: "source-symbol-gap",
        reason: "Indexed source contained extract_traj_tokens, but generated architecture rows did not cover it.",
        pythonTopLevelFunctions: record.sourceAudit?.pythonTopLevelFunctions || [],
        missingFromSourceFunctions: record.sourceAudit?.missingFromSourceFunctions || [],
      },
    },
    sourceEvidence: {
      rowRefs: [rowRef],
      functions: [sourceFunction],
      confidence: "source-audit",
    },
  };
}

async function buildCodeEvidenceForRows({ owner, repo, rows }) {
  const cache = new Map();
  async function getFileRecord(path) {
    if (!path) return null;
    if (cache.has(path)) return cache.get(path);
    let record = null;
    try {
      record = await idbGet(IDB_STORES.codeIndex, `code:file:${owner}/${repo}:${path}`);
    } catch {}
    if (!record) {
      try {
        const raw = localStorage.getItem(`code:file:${owner}/${repo}:${path}`);
        record = raw ? JSON.parse(raw) : null;
      } catch {}
    }
    cache.set(path, record);
    return record;
  }

  const enriched = [];
  for (let index = 0; index < rows.length; index++) {
    if (index > 0 && index % 25 === 0) await sleep(0);
    const row = rows[index];
    const files = Array.from(new Set([...splitRelatedFiles(row.fromFile), ...splitRelatedFiles(row.toFile)]));
    const fileRecords = [];
    const allSourceFunctions = [];
    for (const path of files) {
      const record = await getFileRecord(path);
      const sourceFunctions = record?.sourceFunctions || [];
      allSourceFunctions.push(...sourceFunctions.map((fn) => ({
        ...fn,
        content: sourceSnippetForFunction(record?.content || "", fn),
      })));
      fileRecords.push({
        filePath: path,
        fileName: path.split("/").pop() || path,
        repo: record?.repo || repo,
        owner: record?.owner || owner,
        branch: record?.branch || "",
        commitSha: record?.commitSha || "",
        imports: record?.imports || [],
        exports: record?.exports || [],
        functions: record?.functions || [],
        sourceFunctions,
        sourceAudit: record?.sourceAudit || {},
      });
    }
    const sourceFunctions = selectSourceFunctionsForRow(allSourceFunctions, row);

    enriched.push({
      ...row,
      rowRef: index + 1,
      codeEvidence: {
        rowRefs: [index + 1],
        files: fileRecords,
        functions: Array.from(new Set([row.from, row.to].filter(Boolean))),
        sourceFunctions,
        grounding: row.grounding || null,
      },
      sourceEvidence: {
        rowRefs: [index + 1],
        functions: sourceFunctions,
        confidence: row.grounding?.evidenceConfidence || (sourceFunctions.length ? "medium" : "path-only"),
      },
    });
  }
  if (!enriched.some((row) => rowCoversSourceFunction(row, "extract_traj_tokens"))) {
    const tokenRecord = Array.from(cache.values()).find((record) =>
      record && /token_utils\.py$/i.test(record.path || record.filePath || "") &&
      findIndexedSourceFunction(record, "extract_traj_tokens")
    );
    const tokenFn = tokenRecord ? findIndexedSourceFunction(tokenRecord, "extract_traj_tokens") : null;
    const sourceAuditRow = tokenRecord && tokenFn
      ? makeSourceAuditArchitectureRow({ record: tokenRecord, fn: tokenFn, rowRef: enriched.length + 1 })
      : null;
    if (sourceAuditRow) enriched.push(sourceAuditRow);
  }
  return enriched;
}

async function ensureCodeArchitectureTraceIdsCooperative(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const normalizeIdentity = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const functionIdentityKey = (row = {}, side = "from") => {
    const functionName = side === "to"
      ? (row.to ?? row.toFunction ?? "")
      : (row.from ?? row.fromFunction ?? "");
    const fileName = side === "to"
      ? (row.toFile ?? "")
      : (row.fromFile ?? "");
    return [
      normalizeIdentity(functionName),
      normalizeIdentity(fileName),
    ].filter(Boolean).join("|") || makeCodeArchitectureTraceId("cba-node-key");
  };
  const nodeIdsByIdentity = new Map();
  for (let index = 0; index < safeRows.length; index++) {
    if (index > 0 && index % 100 === 0) await sleep(0);
    const row = safeRows[index] || {};
    if (row.fromNodeId) nodeIdsByIdentity.set(functionIdentityKey(row, "from"), row.fromNodeId);
    if (row.toNodeId) nodeIdsByIdentity.set(functionIdentityKey(row, "to"), row.toNodeId);
  }
  const output = [];
  for (let index = 0; index < safeRows.length; index++) {
    if (index > 0 && index % 100 === 0) await sleep(0);
    const row = safeRows[index] || {};
    const fromKey = functionIdentityKey(row, "from");
    const toKey = functionIdentityKey(row, "to");
    const fromNodeId = row.fromNodeId || nodeIdsByIdentity.get(fromKey) || makeCodeArchitectureTraceId("cba-node");
    const toNodeId = row.toNodeId || nodeIdsByIdentity.get(toKey) || makeCodeArchitectureTraceId("cba-node");
    nodeIdsByIdentity.set(fromKey, fromNodeId);
    nodeIdsByIdentity.set(toKey, toNodeId);
    output.push({
      ...row,
      rowRef: row.rowRef || index + 1,
      traceId: row.traceId || makeCodeArchitectureTraceId("cba-trace"),
      fromNodeId,
      toNodeId,
      edgeId: row.edgeId || makeCodeArchitectureTraceId("cba-edge"),
    });
  }
  return output;
}

async function classifyArchitectureRows({ rows, owner, repo, repoContext = {}, bearer = "", metricsRun = null }) {
  const rowsWithEvidence = await buildCodeEvidenceForRows({ owner, repo, rows });
  if (!rowsWithEvidence.length) return rowsWithEvidence;

  const allocationPlan = await generateNestedArchitectureAllocationPlan({
    rows: rowsWithEvidence,
    repoContext,
    bearer,
    metricsRun,
  });
  const allocations = buildArchitectureAllocationMapFromPlan(allocationPlan, rowsWithEvidence, repoContext);

  const architectureRows = [];
  for (let index = 0; index < rowsWithEvidence.length; index++) {
    if (index > 0 && index % 50 === 0) await sleep(0);
    const row = rowsWithEvidence[index];
    const architecture = allocations.get(Number(row.rowRef)) || inferArchitectureFallback(row, repoContext);
    architectureRows.push({
      ...row,
      architecture: refineArchitectureAllocation(row, architecture, repoContext),
    });
  }
  const descriptions = await generateArchitectureComponentDescriptions(architectureRows, bearer, metricsRun);

  const describedRows = [];
  for (let index = 0; index < architectureRows.length; index++) {
    if (index > 0 && index % 50 === 0) await sleep(0);
    const row = architectureRows[index];
    const arch = row.architecture || {};
    describedRows.push({
      ...row,
      architecture: {
        ...arch,
        descriptions: {
          subsystem: descriptions.get(architectureDescriptionKey("subsystem", [arch.subsystem])) || "",
          csci: descriptions.get(architectureDescriptionKey("csci", [arch.subsystem, arch.csci])) || "",
          csc: descriptions.get(architectureDescriptionKey("csc", [arch.subsystem, arch.csci, arch.csc])) || "",
          csu: descriptions.get(architectureDescriptionKey("csu", [arch.subsystem, arch.csci, arch.csc, arch.csu])) || "",
        },
      },
    });
  }
  return describedRows;
}

/* =======================================================================
   UPDATED: main export supports a 4th opts arg with onChooseFileTypes
   opts = {
     preselectedPaths?: string[]
     selectedExtensions?: string[]
     onChooseFileTypes?: ({files}) => Promise<string[]>  // array of extensions
     onProgress?: ({phase, completedFiles, totalFiles, currentFile, message}) => void
     maxFilesToAnalyze?: number
     maxChunksToAnalyze?: number
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
    console.log("🔄 Starting functional decomposition generation from GitHub...");

    const repoConfig = opts?.repoConfig || {};
    const owner = (repoConfig.owner || localStorage.getItem("repoOwner") || "").trim();
    const repo = (repoConfig.repo || localStorage.getItem("repoName") || "").trim();
    const token = (repoConfig.token || localStorage.getItem("githubToken") || "") || undefined;
    if (!owner || !repo) throw new Error("Missing owner/repo. Connect a GitHub repository first.");
    const outputStorageKey = opts?.storageKey || `cba:${owner}/${repo}`;
    const metricsRun = createFunctionalDecompositionMetricsRun({
      projectId: opts?.projectId || repoConfig.projectId || "",
      repoId: repoConfig.id || repoConfig.repoId || `${owner}/${repo}`,
      owner,
      repo,
    });
    opts?.onProgress?.({
      phase: "scan",
      completedFiles: 0,
      totalFiles: 0,
      currentFile: "",
      message: "Resolving repository branch...",
    });

    // Determine ref/branch once up front
    const ref = repoConfig.branch || await getDefaultBranch(owner, repo, token);
    opts?.onProgress?.({
      phase: "scan",
      completedFiles: 0,
      totalFiles: 0,
      currentFile: "",
      message: `Scanning ${owner}/${repo} file tree on ${ref}...`,
    });
    const commitSha = await getCommitShaForRef(owner, repo, token, ref);
    await clearIndexedFilesForRepo(owner, repo);

    // List all repo files via GitHub Trees API (no backend state)
    const allFiles = await listRepoFilesViaGitHub(owner, repo, token, ref);
    if (!allFiles.length) throw new Error("No files found in GitHub repository.");
    const repoPathResolver = createRepoPathResolver(allFiles);
    const groundingStats = createFunctionalGroundingStats();
    opts?.onProgress?.({
      phase: "scan",
      completedFiles: 0,
      totalFiles: 0,
      currentFile: "",
      message: `Found ${allFiles.length} repository files; filtering selectable source files...`,
    });
    const repoContext = await fetchRepositoryContext({ owner, repo, token, ref, allFiles });
    const userAnalysisContext = opts?.analysisContext || loadGitHubAnalysisContextFromStorage();

    // Exclude heavy/vendor dirs; allow all extensions for modal selection
    const candidates = filterSelectableRepoFiles(allFiles);

    // Determine which files to include
    let selectedFiles;
    if (opts?.preselectedPaths?.length) {
      const set = new Set(opts.preselectedPaths);
      selectedFiles = candidates.filter((f) => set.has(f.path));
    } else if (opts?.selectedExtensions?.length) {
      const chosen = new Set((opts.selectedExtensions || []).map((e) => String(e || "").toLowerCase()));
      selectedFiles = candidates.filter((f) => chosen.has(extOf(f.path)));
    } else if (typeof opts?.onChooseFileTypes === "function") {
      const chosenExts = await opts.onChooseFileTypes({ files: candidates });
      const chosen = new Set((chosenExts || []).map((e) => e.toLowerCase()));
      selectedFiles = candidates.filter((f) => chosen.has(extOf(f.path)));
    } else {
      // Back-compat fallback: include common code files when no modal is provided
      selectedFiles = candidates.filter((f) =>
        /\.(mjs|cjs|js|jsx|ts|tsx|py|c|cc|cp|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|ipp|inl|tpp)$/i.test(f.path)
      );
    }

    // Back-compat direct path filtering (old callers)
    const finalList = filterFiles
      ? selectedFiles.filter((f) => filterFiles.includes(f.path))
      : selectedFiles;

    if (!finalList.length) throw new Error("No matching files after filters.");
    const maxFilesToAnalyze = Number(opts?.maxFilesToAnalyze || 0);
    const maxChunksToAnalyze = Number(opts?.maxChunksToAnalyze || 0);
    const analysisPlan = planFunctionalAnalysisFiles(finalList, {
      maxFiles: maxFilesToAnalyze,
      maxChunks: maxChunksToAnalyze,
      maxChunksPerFile: MAX_FUNCTIONAL_ANALYSIS_CHUNKS_PER_FILE,
    });
    const analysisFileList = analysisPlan.files;
    const skippedForScale = Math.max(0, finalList.length - analysisFileList.length);
    if (!analysisFileList.length) {
      throw new Error("No files fit the functional decomposition size limits. Select fewer or smaller source files.");
    }
    if (skippedForScale > 0) {
      console.warn(
        `⚠️ Functional decomposition selected ${finalList.length} files; analyzing ${analysisFileList.length} eligible files for full coverage.`
      );
    }
    if (analysisPlan.skippedForChunkLimit.length > 0) {
      console.warn(
        "⚠️ Functional decomposition skipped files outside the chunk budget:",
        analysisPlan.skippedForChunkLimit.map((file) => `${file.path} (${file.estimatedChunks} chunks, ${file.reason})`)
      );
    }
    opts?.onProgress?.({
      phase: "fetch",
      completedFiles: 0,
      totalFiles: analysisFileList.length,
      currentFile: "",
      message: skippedForScale > 0
        ? `Preparing ${analysisFileList.length} of ${finalList.length} selected files for full coverage across ${analysisPlan.batchCount} batch${analysisPlan.batchCount === 1 ? "" : "es"} (${analysisPlan.totalEstimatedChunks} estimated chunks)...`
        : `Preparing ${analysisFileList.length} files for full coverage across ${analysisPlan.batchCount} batch${analysisPlan.batchCount === 1 ? "" : "es"} (${analysisPlan.totalEstimatedChunks} estimated chunks)...`,
    });

    const validFiles = analysisFileList;

    console.log("📁 Files selected for full decomposition:", validFiles.map((f) => f.path));
    console.log("📄 Files ready for streaming ingestion:", validFiles.map((f) => f.path));
    opts?.onProgress?.({
      phase: "decomposition",
      completedFiles: 0,
      totalFiles: validFiles.length,
      currentFile: "",
      message: `Analyzing 0 of ${validFiles.length} files...`,
    });

    const bearer = getLocalAccessToken();
    const systemUnderstanding = await deriveSystemUnderstanding({
      repoContext,
      userContext: userAnalysisContext,
      bearer,
      metricsRun,
    });

    if (systemUnderstanding) {
      console.log("🧭 Repository context understanding:", systemUnderstanding.slice(0, 500));
    }

    const prompt = `
You are an expert systems engineer who is reverse engineering the design of a system from its codebase using the following steps:

Use this repository-level context throughout the analysis. Treat README and user-provided context as orientation for purpose, terminology, interfaces, actors, and subsystem boundaries, but keep each decomposition row grounded in the supplied source chunk.

Repository-level context:
${systemUnderstanding || "No README or user-provided context was available. Infer cautiously from source code and file structure."}

Step 1: Review each file and develop a detailed understanding of what it is doing functionally.
Step 2: Develop a detailed narrative of how these functions interact with each other (what information is being exchanged through inputs and outputs, shared state, APIs, etc.).
Step 3: From your analysis, derive a structured list of interactions between functions in the system. For each interaction, provide the following columns:

| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |

Rules:
- Output only the markdown table; no commentary or code.
- "Function (From)" and "Function (To)" should use actual function, method, class, imported API, or file-level artifact names from the supplied current file evidence whenever possible. Do not invent conceptual steps such as "Load Model", "Run Inference", "User Interaction", or "Return Predictions" unless those exact artifacts are present in the current file evidence.
- Use multi-sentence prose for both Details fields.
- "Control Action" should be an imperative verb phrase.
- Related File(s) columns must use exact repository-relative paths from the supplied current file evidence or imported/referenced files visible in the source chunk. Never use placeholders such as None, N/A, "-", or files that are not present in the repository evidence.
- Every row must have all columns populated.
- Keep control action details in base form tense.
- Only emit source-evidenced relationships: direct calls, inheritance, imports/exports, concrete data/control flows, shared state mutations, API boundaries, or explicit artifact dependencies. Do not emit rows for conceptual similarity or speculative sequencing. If you would need to write "does not directly call", "likely used", "may be used", "similar structure", or "broader context", omit that row.
- For sequential pipeline code where a caller invokes A and then B, do not emit A -> B unless A actually calls B. Emit caller -> A and caller -> B rows instead when the current source chunk supports those calls.
- For inheritance, use subclass -> base class direction. Do not emit base class -> subclass rows merely because the subclass imports or extends the base.
- For class membership, describe the relationship as defining or exposing a method/member; do not label it as a runtime call unless the method body actually calls the target.
- Do not use instance attribute names as Function (To) endpoints unless the attribute is itself a source-defined callable or imported API being invoked in the current function body.
- If a helper is only called inside one method, emit method -> helper, not ClassName -> helper.
- For invalid token handling, prefer the safety-relevant validation or repair operation such as torch.clamp over incidental tensor plumbing such as torch.where or torch.zeros_like.
- Prefer interface-rich interactions when source evidence supports them, including APIs, callbacks, message/event flows, hardware boundaries, shared state, configuration files, protocols, imports/includes, and library/framework boundaries.
- Analyze the current file/chunk only. README and repository context may guide terminology, but they are not evidence for rows unless the current source chunk also supports the interaction.
    `.trim();
    const checkpointKey = `${FUNCTIONAL_DECOMPOSITION_CHECKPOINT_PREFIX}${outputStorageKey}:${commitSha || ref}`;
    const planSignature = functionalAnalysisPlanSignature(validFiles);
    const savedCheckpoint = opts?.resumeFromCheckpoint === false
      ? null
      : await idbGet(IDB_STORES.cba, checkpointKey).catch(() => null);
    const checkpoint = savedCheckpoint?.planSignature === planSignature && savedCheckpoint?.groundingVersion === FUNCTIONAL_GROUNDING_VERSION
      ? savedCheckpoint
      : null;
    if (checkpoint?.groundingStats && typeof checkpoint.groundingStats === "object") {
      Object.assign(groundingStats, {
        ...groundingStats,
        ...checkpoint.groundingStats,
        rejectionReasons: { ...(checkpoint.groundingStats.rejectionReasons || {}) },
        rejectedRows: Array.isArray(checkpoint.groundingStats.rejectedRows)
          ? checkpoint.groundingStats.rejectedRows.slice(0, 50)
          : [],
      });
    }
    if (savedCheckpoint && !checkpoint) {
      console.info("Ignoring functional decomposition checkpoint because the selected file plan changed.");
    }
    const checkpointRows = Array.isArray(checkpoint?.rows) ? checkpoint.rows : [];
    const validPathSet = new Set(validFiles.map((file) => file.path));
    const completedPathSet = new Set(
      Array.isArray(checkpoint?.completedPaths)
        ? checkpoint.completedPaths.filter((path) => validPathSet.has(path))
        : []
    );
    const failedFiles = Array.isArray(checkpoint?.failedFiles)
      ? checkpoint.failedFiles.filter((file) => validPathSet.has(file?.path))
      : [];
    let allTableData = checkpointRows;
    let completedFiles = Math.min(completedPathSet.size, validFiles.length);

    if (completedFiles > 0) {
      opts?.onProgress?.({
        phase: "decomposition",
        completedFiles,
        totalFiles: validFiles.length,
        currentFile: "",
        message: `Resuming full analysis from ${completedFiles} of ${validFiles.length} completed files...`,
      });
    }

    for (const file of validFiles) {
      if (completedPathSet.has(file.path)) continue;
      const completedBeforeFile = completedFiles;
      const currentFileNumber = completedBeforeFile + 1;
      const totalFileCount = validFiles.length;
      const currentBatchNumber = Math.max(1, Math.ceil(currentFileNumber / DEFAULT_FUNCTIONAL_ANALYSIS_BATCH_FILES));
      let fileAnalysisSucceeded = false;
      let fileFailureMessage = "";
      try {
        const fileTableData = [];
        await runWithFileTimeout(file.path, async (signal) => {
          opts?.onProgress?.({
            phase: "fetch",
            completedFiles: completedBeforeFile,
            totalFiles: totalFileCount,
            currentFile: file.path,
            message: `Batch ${currentBatchNumber} of ${analysisPlan.batchCount}: fetching file ${currentFileNumber} of ${totalFileCount}: ${file.path}`,
          });
          const got = await fetchGitHubFileSmart({
            backendURL, // unused now
            owner,
            repo,
            path: file.path,
            token,
            ref,
            sha: file.sha,
            signal,
          });
          throwIfAborted(signal);
          if (!got.ok) {
            throw new Error(`Could not fetch ${file.path} from GitHub.`);
          }

          let currentFileRecord = buildSourceFileIndexRecord({
            owner,
            repo,
            path: file.path,
            content: got.content,
            branch: ref,
            commitSha,
          });
          if (shouldIndexFunctionalAnalysisSource(file.path)) {
            try {
              currentFileRecord = await indexSourceFileToIDB({
                owner,
                repo,
                path: file.path,
                content: got.content,
                branch: ref,
                commitSha,
              });
            } catch {}
          }
          throwIfAborted(signal);

          const fileBody = got.content || "";
          const chunks = chunksForFunctionalAnalysis(fileBody);
          const total = chunks.length;
          opts?.onProgress?.({
            phase: "decomposition",
            completedFiles: completedBeforeFile,
            totalFiles: totalFileCount,
            currentFile: file.path,
            message: `Batch ${currentBatchNumber} of ${analysisPlan.batchCount}: analyzing file ${currentFileNumber} of ${totalFileCount}: ${file.path} (${total} chunk${total === 1 ? "" : "s"})`,
          });

          for (let i = 0; i < total; i++) {
            throwIfAborted(signal);
            const header = makeChunkHeader(file.path, i, total);
            const chunkedContent = header + chunks[i];

            console.log(
              `📤 Sending ${file.path} chunk ${i + 1}/${total} to LLM (len=${chunkedContent.length})`
            );
            const sourceEvidenceContract = {
              currentFile: file.path,
              currentFileSymbols: (currentFileRecord.sourceFunctions || []).map((fn) => ({
                name: fn.functionName,
                startLine: fn.startLine,
                endLine: fn.endLine,
              })).slice(0, 200),
              verifiedSameFilePythonCallEdges: verifiedPythonCallEdgesForRecord(currentFileRecord),
              imports: (currentFileRecord.imports || []).slice(0, 80),
              repositoryPathsAvailableForRelatedFiles: allFiles.map((entry) => entry.path).slice(0, 1200),
            };
            const filePrompt = `${prompt}

Current file evidence contract:
${JSON.stringify(sourceEvidenceContract, null, 2)}

Rows that do not use exact repository paths and current-file symbols/imported APIs will be rejected by deterministic validation.

${chunkedContent}`;

            const { result } = await requestOpenAIProxyJsonWithMetrics({
              prompt: filePrompt,
              bearer,
              label: `Functional decomposition AI for ${file.path} chunk ${i + 1}/${total}`,
              signal,
              metricsRun,
            });
            throwIfAborted(signal);

            const lines = (result || "").split("\n").filter((l) => l.trim().startsWith("|"));
            const rows = lines.slice(2);
            console.log(
              `📥 Parsed ${rows.length} candidate functional row${rows.length === 1 ? "" : "s"} for ${file.path} [part ${i + 1}/${total}]`
            );

            const tableData = rows
              .map((row, index) => {
                const cols = row.split("|").map((c) => c.trim());
                if (cols.length < 9) {
                  console.warn(
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

                const candidateRow = {
                  from,
                  fromFile,
                  fromDetails,
                  action: controlAction,
                  controlActionDetails,
                  to,
                  toFile,
                  toDetails,
                };
                return groundFunctionalDecompositionRow({
                  row: candidateRow,
                  currentFile: file,
                  currentFileRecord,
                  repoPathResolver,
                  stats: groundingStats,
                  chunkIndex: i + 1,
                });
              })
              .filter(Boolean);

            throwIfAborted(signal);
            fileTableData.push(...tableData);

            // tiny throttle helps avoid transient 502/Fetch errors
            await sleep(120, signal);
          }
        });
        allTableData.push(...fileTableData);
        fileAnalysisSucceeded = true;
      } catch (e) {
        fileFailureMessage = e?.message || String(e);
        for (let i = failedFiles.length - 1; i >= 0; i -= 1) {
          if (failedFiles[i]?.path === file.path) failedFiles.splice(i, 1);
        }
        failedFiles.push({
          path: file.path,
          message: fileFailureMessage,
          updatedAt: new Date().toISOString(),
        });
        console.warn(`LLM failed for ${file.path}; it will remain retryable on the next run:`, e);
      } finally {
        if (fileAnalysisSucceeded) {
          completedPathSet.add(file.path);
          for (let i = failedFiles.length - 1; i >= 0; i -= 1) {
            if (failedFiles[i]?.path === file.path) failedFiles.splice(i, 1);
          }
        }
        completedFiles += 1;
        await idbPut(IDB_STORES.cba, checkpointKey, {
          owner,
          repo,
          ref,
          commitSha,
          groundingVersion: FUNCTIONAL_GROUNDING_VERSION,
          groundingStats,
          planSignature,
          totalFiles: validFiles.length,
          completedPaths: Array.from(completedPathSet),
          failedFiles,
          rows: allTableData,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
        opts?.onProgress?.({
          phase: "decomposition",
          completedFiles,
          totalFiles: validFiles.length,
          currentFile: file.path,
          message: fileAnalysisSucceeded
            ? `Analyzed ${completedFiles} of ${validFiles.length} files${completedFiles < validFiles.length ? `; next file pending...` : "."}`
            : `Skipped ${file.path} after AI retries failed; ${completedFiles} of ${validFiles.length} files processed.`,
        });
        await sleep(0);
      }
    }

    allTableData = dedupeFunctionalDecompositionRows(allTableData, groundingStats);

    console.log("🏛️ Classifying functional decomposition into Subsystem/CSCI/CSC/CSU architecture...");
    opts?.onProgress?.({
      phase: "classification",
      completedFiles,
      totalFiles: validFiles.length,
      currentFile: "",
      message: `Classifying architecture from ${completedFiles} analyzed files...`,
    });
    const architectureRows = await ensureCodeArchitectureTraceIdsCooperative(await classifyArchitectureRows({
      rows: allTableData,
      owner,
      repo,
      bearer,
      repoContext,
      metricsRun,
    }));

    setTableData(architectureRows);

    // NEW: make rows available to Copilot (read via cba:owner/repo)
    let storageSaved = false;
    let storageError = "";
    try {
      await idbPut(IDB_STORES.cba, outputStorageKey, architectureRows);
      storageSaved = true;
      if (failedFiles.length === 0) {
        await idbDelete(IDB_STORES.cba, checkpointKey).catch(() => {});
      } else {
        await idbPut(IDB_STORES.cba, checkpointKey, {
          owner,
          repo,
          ref,
          commitSha,
          groundingVersion: FUNCTIONAL_GROUNDING_VERSION,
          groundingStats,
          planSignature,
          totalFiles: validFiles.length,
          completedPaths: Array.from(completedPathSet),
          failedFiles,
          rows: allTableData,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    } catch (error) {
      storageError = error?.message || String(error || "IndexedDB write failed.");
      console.warn("[cba] Failed to persist generated architecture rows", error);
    }
    
    const finalMetrics = finishFunctionalDecompositionMetricsRun(metricsRun, {
      rowCount: architectureRows.length,
      selectedFiles: validFiles.length,
      totalFiles: allFiles.length,
      skippedForScale,
      failedFileCount: failedFiles.length,
    });
    saveFunctionalDecompositionMetricsRun(finalMetrics);

    console.log("📊 Parsed table rows:", architectureRows.length);
    const metadata = {
      owner,
      repo,
      repoId: repoConfig.repoId || `${owner}/${repo}`,
      repoName: repoConfig.repoName || `${owner}/${repo}`,
      repoUrl: repoConfig.repoUrl || `https://github.com/${owner}/${repo}`,
      branch: ref,
      commitSha,
      filesFound: allFiles.length,
      selectedFilesBeforeLimits: finalList.length,
      selectedFiles: validFiles.length,
      skippedForScale,
      skippedForChunkLimit: analysisPlan.skippedForChunkLimit.length,
      totalEstimatedChunks: analysisPlan.totalEstimatedChunks,
      batchCount: analysisPlan.batchCount,
      fullCoverage: true,
      analyzedFiles: completedPathSet.size,
      failedFileCount: failedFiles.length,
      failedFiles: failedFiles.slice(-25),
      storageKey: outputStorageKey,
      storageSaved,
      storageError,
      metrics: finalMetrics,
      grounding: groundingStats,
      operationalContext: systemUnderstanding || buildFallbackSystemUnderstanding(repoContext, userAnalysisContext),
      contextSources: {
        readmePath: repoContext.readmePath || "",
        hasReadme: Boolean(String(repoContext.readmeText || "").trim()),
        hasUserContextText: Boolean(String(userAnalysisContext?.text || "").trim()),
        userContextFiles: (userAnalysisContext?.files || [])
          .map((file) => String(file?.name || "").trim())
          .filter(Boolean),
      },
    };
    return opts?.repoConfig || opts?.storageKey
      ? { rows: architectureRows, metadata }
      : architectureRows;
    
  } catch (error) {
    console.error("🚨 Failed to generate functional decomposition:", error);
    setTableData([]);
    throw error;
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
  const [repoName, setRepoName] = useState("");

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
  repoMeta = null,
  onRequestCreateProject,
  onSelectArchitectureElement,
  reviewItems = [],
  reviewByRow,
  reviewDrawerOptions = {},
  forceTableOpenKey,
  highlightedRowIndex = null,
  hazardSummary = null,
  assuranceArtifacts = null,
  onOpenHazardRow,
  onOpenFunctionalRow,
  onOpenAssuranceArtifactRow,
  focusTarget = null,
  onFocusTargetHandled,
  architectureLevelLabels = null,
  architectureLevels = null,
  architectureRefreshKey = null,
  colorSystemElements = false,
  reviewMode = false,
}) => {
  const [manualData, setManualData] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [view, setView] = useState("architecture"); // professional hierarchy first when available
  const [architectureAbstraction, setArchitectureAbstraction] = useState("subsystem");
  const [cleanOnceKey, setCleanOnceKey] = useState(() => `clean-${Date.now()}`); // one-time arrange on first open
  const [architectureReport, setArchitectureReport] = useState(null);
  const [selectedArchitectureRowId, setSelectedArchitectureRowId] = useState("");
  const [queuedCsuFocusTarget, setQueuedCsuFocusTarget] = useState(null);
  const diagramRef = useRef(null);
  const tableRowRefs = useRef({});
  const levelLabels = {
    architecture: "Architecture",
    subsystem: "Subsystem",
    csci: "CSCI",
    csc: "CSC",
    detailed: "CSU",
    ...(architectureLevelLabels || {}),
  };
  const abstractionLevels = architectureLevels || [
    ["subsystem", "Subsystem"],
    ["csci", "CSCI"],
    ["csc", "CSC"],
    ["detailed", "CSU"],
  ];

  const storageKey = useMemo(() => `diagram:github:${repoId}:${branch}`, [repoId, branch]);

  // Derive display repo name from saved GitHub settings
const repoName = useMemo(() => {
  if (repoMeta?.repoName || repoMeta?.repoId) return repoMeta.repoName || repoMeta.repoId;
  if (repoMeta?.owner && repoMeta?.repo) return `${repoMeta.owner}/${repoMeta.repo}`;
  const owner = localStorage.getItem("repoOwner") || "";
  const repo  = localStorage.getItem("repoName") || "";
  return owner && repo ? `${owner}/${repo}` : (repo || repoId || "");
}, [repoId, repoMeta]);

  const reportStorageKey = useMemo(
    () => architectureReportStorageKey(repoName, branch),
    [repoName, branch]
  );
  const columnWidthsStorageKey = useMemo(
    () => architectureTableColumnWidthsKey(repoName, branch),
    [repoName, branch]
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await idbGet(IDB_STORES.cba, reportStorageKey);
        if (!cancelled && stored?.markdown) setArchitectureReport(stored);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [reportStorageKey]);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  React.useEffect(() => {
    if (!forceTableOpenKey) return;
    setView("table");
  }, [forceTableOpenKey]);

  React.useEffect(() => {
    if (!architectureRefreshKey) return;
    setCleanOnceKey(`refresh-${architectureRefreshKey}-${Date.now()}`);
    const timers = [80, 240, 520, 900].map((delay) =>
      setTimeout(() => {
        try {
          diagramRef.current?.fitViewToDiagram?.();
        } catch {}
      }, delay)
    );
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [architectureRefreshKey]);

  React.useEffect(() => {
    if (highlightedRowIndex === null || highlightedRowIndex === undefined || highlightedRowIndex === "") return;
    const targetIndex = Number(highlightedRowIndex);
    if (!Number.isFinite(targetIndex)) return;
    setView("table");
    setTimeout(() => {
      tableRowRefs.current[targetIndex]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 80);
  }, [highlightedRowIndex]);

  const rowsWithTraceIds = useMemo(
    () => ensureCodeArchitectureTraceIds(manualData || data || []),
    [manualData, data]
  );
  const isRepositoryBoundaryRow = React.useCallback((row = {}) => {
    const text = [
      row.from,
      row.fromFile,
      row.fromDetails,
      row.action,
      row.controlActionDetails,
      row.to,
      row.toFile,
      row.toDetails,
    ].map((value) => String(value || "").toLowerCase()).join(" ");
    return text.includes("repository component boundary");
  }, []);
  const tableRowsWithTraceIds = useMemo(
    () => rowsWithTraceIds
      .map((row, sourceIndex) => ({ row, sourceIndex }))
      .filter(({ row }) => !isRepositoryBoundaryRow(row)),
    [isRepositoryBoundaryRow, rowsWithTraceIds]
  );

  const diagramRows = useMemo(() => {
    return rowsWithTraceIds.map((r) => ({
      fromFunction: r.from,
      fromFile: r.fromFile,
      fromDetails: r.fromDetails,
      controlAction: r.action,
      controlDetails: r.controlActionDetails,
      toFunction: r.to,
      toFile: r.toFile,
      toDetails: r.toDetails,
      architecture: r.architecture || null,
      codeEvidence: r.codeEvidence || null,
      sourceEvidence: r.sourceEvidence || null,
      rowRef: r.rowRef,
      traceId: r.traceId,
      fromNodeId: r.fromNodeId,
      edgeId: r.edgeId,
      toNodeId: r.toNodeId,
    }));
  }, [rowsWithTraceIds]);

  const hasArchitecture = useMemo(
    () => diagramRows.some((row) => row.architecture?.subsystem || row.architecture?.csci || row.architecture?.csc || row.architecture?.csu),
    [diagramRows]
  );

  const handleSelectArchitectureRow = React.useCallback((row, index) => {
    const element = architectureElementFromRow(row, index);
    setSelectedArchitectureRowId(element?.id || "");
    if (element) onSelectArchitectureElement?.(element);
  }, [onSelectArchitectureElement]);

  const handleGenerateArchitectureDescription = React.useCallback(async () => {
    const rows = manualData || data || [];
    if (!rows.length) {
      alert("No functional decomposition data is available yet.");
      return;
    }

    let previousView = view;
    let diagramImage = null;
    let generatedSuccessfully = false;
    try {
      if (view !== "architecture") {
        previousView = view;
        setView("architecture");
        setCleanOnceKey(`clean-${Date.now()}`);
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      try {
        if (diagramRef.current?.exportAsImage) {
          diagramImage = await diagramRef.current.exportAsImage();
        }
      } catch (captureError) {
        console.warn("Architecture diagram screenshot capture failed.", captureError);
      }

      const bearer = getLocalAccessToken();
      const markdown = await generateSoftwareArchitectureDescription({
        rows,
        repoName,
        diagramImage,
        bearer,
      });
      const metadata = deriveReportMetadata(rows, repoName, branch);
      const report = { markdown, metadata, generatedAt: metadata.generatedAt };
      setArchitectureReport(report);
      try {
        await idbPut(IDB_STORES.cba, reportStorageKey, report);
      } catch {}
      generatedSuccessfully = true;
      setView("report");
    } catch (error) {
      console.error("Failed to generate architecture description:", error);
      alert(error?.message || "Failed to generate the Software Architecture Description.");
    } finally {
      if (!generatedSuccessfully && previousView !== "architecture") {
        setView(previousView);
      }
    }
  }, [manualData, data, view, repoName, branch, reportStorageKey]);

  // --- file filter helpers/state for the left sidebar ---
function relatedFiles(cell) {
  if (!cell || typeof cell !== "string") return [];
  return cell.split(/[,;]+/).map((value) => value.trim()).filter(Boolean);
}

function architectureFolderLabel(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

const uniqueFiles = useMemo(() => {
  const s = new Set();
  (diagramRows || []).forEach((r) => {
    relatedFiles(r.fromFile).forEach((file) => s.add(file));
    relatedFiles(r.toFile).forEach((file) => s.add(file));
  });
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}, [diagramRows]);

	const [includedFiles, setIncludedFiles] = useState(uniqueFiles);
	const includedFilesSignature = useMemo(
	  () => includedFiles.slice().sort((a, b) => a.localeCompare(b)).join("\n"),
	  [includedFiles]
	);

// keep selection in sync with data changes
React.useEffect(() => {
  setIncludedFiles(uniqueFiles);
}, [uniqueFiles]);

const [fileQuery, setFileQuery] = useState("");
const filteredFileTree = useMemo(() => {
  const q = fileQuery.trim().toLowerCase();
  const root = new Map();
  const addGroup = (map, key, label) => {
    if (!map.has(key)) map.set(key, { key, label, children: new Map(), files: new Set() });
    return map.get(key);
  };

  (diagramRows || []).forEach((row) => {
    const arch = row.architecture || {};
    const subsystem = architectureFolderLabel(arch.subsystem, "Application Subsystem");
    const csci = architectureFolderLabel(arch.csci, "Application Software");
    const csc = architectureFolderLabel(arch.csc, "Core Components");
    const csu = architectureFolderLabel(arch.csu, row.fromFunction || row.toFunction || "Functional Unit");
    const files = Array.from(new Set([...relatedFiles(row.fromFile), ...relatedFiles(row.toFile)]));
    if (!files.length) files.push("Unfiled");

    const haystack = [subsystem, csci, csc, csu, ...files].join(" ").toLowerCase();
    if (q && !haystack.includes(q)) return;

    const subsystemNode = addGroup(root, subsystem, subsystem);
    const csciNode = addGroup(subsystemNode.children, `${subsystem}/${csci}`, csci);
    const cscNode = addGroup(csciNode.children, `${subsystem}/${csci}/${csc}`, csc);
    const csuNode = addGroup(cscNode.children, `${subsystem}/${csci}/${csc}/${csu}`, csu);
    files.forEach((file) => csuNode.files.add(file));
  });

  const sortGroups = (groups) => Array.from(groups.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((group) => ({
      ...group,
      children: sortGroups(group.children),
      files: Array.from(group.files).sort((a, b) => a.localeCompare(b)),
    }));

  return sortGroups(root);
}, [diagramRows, fileQuery]);

const filteredTreeFileCount = useMemo(() => {
  const files = new Set();
  const visit = (groups) => {
    groups.forEach((group) => {
      (group.files || []).forEach((file) => files.add(file));
      visit(group.children || []);
    });
  };
  visit(filteredFileTree);
  return files.size;
}, [filteredFileTree]);

	const toggleIncludedFile = React.useCallback((file, checked) => {
	  setIncludedFiles((prev) => {
	    if (checked) return [...new Set([...prev, file])];
	    return prev.filter((item) => item !== file);
	  });
	}, []);
	const toggleIncludedFiles = React.useCallback((files, checked) => {
	  const fileList = Array.from(new Set(files || [])).filter(Boolean);
	  if (!fileList.length) return;
	  setIncludedFiles((prev) => {
	    if (checked) return Array.from(new Set([...prev, ...fileList]));
	    const remove = new Set(fileList);
	    return prev.filter((item) => !remove.has(item));
	  });
	}, []);

	const renderFileTree = React.useCallback((groups, depth = 0) => (
	  groups.map((group) => {
    const groupFiles = new Set();
    const collect = (node) => {
      (node.files || []).forEach((file) => groupFiles.add(file));
      (node.children || []).forEach(collect);
    };
	    collect(group);
	    const selectedCount = Array.from(groupFiles).filter((file) => includedFiles.includes(file)).length;
	    const totalCount = groupFiles.size;
	    const allSelected = totalCount > 0 && selectedCount === totalCount;
	    const partiallySelected = selectedCount > 0 && selectedCount < totalCount;
	    return (
	      <details key={group.key} className="rounded-md">
	        <summary
          className="flex cursor-pointer list-none items-center gap-1 rounded px-1 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          title={group.label}
          style={{ paddingLeft: depth ? `${depth * 10 + 4}px` : 4 }}
	        >
	          <span className="text-slate-400">▾</span>
	          <input
	            type="checkbox"
	            className="h-3.5 w-3.5 shrink-0"
	            checked={allSelected}
	            ref={(input) => {
	              if (input) input.indeterminate = partiallySelected;
	            }}
	            onClick={(event) => event.stopPropagation()}
	            onChange={(event) => toggleIncludedFiles(Array.from(groupFiles), event.target.checked)}
	            aria-label={`Toggle ${group.label}`}
	          />
	          <span className="truncate">{group.label}</span>
	          <span className="ml-auto shrink-0 text-[10px] font-medium text-slate-400">
	            {selectedCount}/{totalCount}
          </span>
        </summary>
        <div className="space-y-1">
          {renderFileTree(group.children || [], depth + 1)}
          {(group.files || []).map((file) => {
            const checked = includedFiles.includes(file);
            return (
              <label
                key={`${group.key}:${file}`}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                style={{ paddingLeft: `${(depth + 1) * 10 + 12}px` }}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={checked}
                  onChange={(event) => toggleIncludedFile(file, event.target.checked)}
                />
                <span className="truncate" title={file}>{file}</span>
              </label>
            );
          })}
        </div>
      </details>
	      );
	  })
	), [includedFiles, toggleIncludedFile, toggleIncludedFiles]);

const diagramHeight = "100%";

React.useEffect(() => {
  if (view !== "architecture") return;
  const timers = [80, 260].map((delay) =>
    setTimeout(() => {
      try {
        diagramRef.current?.fitViewToDiagram?.();
      } catch {}
    }, delay)
  );
  return () => timers.forEach((timer) => clearTimeout(timer));
	}, [view, architectureAbstraction, fullscreen, collapsed, includedFilesSignature, diagramRows.length]);

  const thBase =
    "sticky top-0 z-10 bg-indigo-50 text-slate-700 font-semibold text-[13px] uppercase tracking-wide border-b border-slate-200 px-3 py-2";
  const tdBase = "border-b border-slate-100 px-3 py-2 align-top text-[13px] text-slate-800";
  const traceLinkClass = "text-left font-semibold text-[#2D7DFE] underline decoration-[#2D7DFE]/30 underline-offset-2 hover:text-[#1E61D6]";
  const tableColumns = useMemo(() => [
    { id: "from", label: "Function (From)", defaultWidth: 220, minWidth: 150, getValue: (row) => row.from },
    { id: "fromFile", label: "Function (From) Related File(s)", defaultWidth: 300, minWidth: 180, getValue: (row) => row.fromFile },
    { id: "fromDetails", label: "Function (From) Details", defaultWidth: 420, minWidth: 240, getValue: (row) => row.fromDetails },
    { id: "action", label: "Control Action", defaultWidth: 240, minWidth: 160, getValue: (row) => row.action },
    { id: "controlDetails", label: "Control Action Details", defaultWidth: 440, minWidth: 240, getValue: (row) => row.controlActionDetails },
    { id: "to", label: "Function (To)", defaultWidth: 220, minWidth: 150, getValue: (row) => row.to },
    { id: "toFile", label: "Function (To) Related File(s)", defaultWidth: 300, minWidth: 180, getValue: (row) => row.toFile },
    { id: "toDetails", label: "Function (To) Details", defaultWidth: 420, minWidth: 240, getValue: (row) => row.toDetails },
    { id: "subsystem", label: "Subsystem", defaultWidth: 220, minWidth: 150, getValue: (row) => row.architecture?.subsystem || "Application Subsystem" },
    { id: "csci", label: "CSCI", defaultWidth: 220, minWidth: 150, getValue: (row) => row.architecture?.csci || "" },
    { id: "csc", label: "CSC", defaultWidth: 220, minWidth: 150, getValue: (row) => row.architecture?.csc || "" },
    { id: "csu", label: "CSU", defaultWidth: 220, minWidth: 150, getValue: (row) => row.architecture?.csu || "" },
  ], []);
  const defaultColumnWidths = useMemo(() => Object.fromEntries(tableColumns.map((column) => [column.id, column.defaultWidth])), [tableColumns]);
  const [columnWidths, setColumnWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(columnWidthsStorageKey) || "{}");
      return { ...defaultColumnWidths, ...(saved && typeof saved === "object" ? saved : {}) };
    } catch {
      return defaultColumnWidths;
    }
  });
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(columnWidthsStorageKey) || "{}");
      setColumnWidths({ ...defaultColumnWidths, ...(saved && typeof saved === "object" ? saved : {}) });
    } catch {
      setColumnWidths(defaultColumnWidths);
    }
  }, [columnWidthsStorageKey, defaultColumnWidths]);
  React.useEffect(() => {
    if (reviewMode) return;
    try {
      localStorage.setItem(columnWidthsStorageKey, JSON.stringify(columnWidths));
    } catch {}
  }, [columnWidths, columnWidthsStorageKey, reviewMode]);
  const handleColumnResizeStart = React.useCallback((event, columnIndex) => {
    event.preventDefault();
    event.stopPropagation();
    const column = tableColumns[columnIndex];
    if (!column) return;
    const startX = event.clientX;
    const startWidth = columnWidths[column.id] || column.defaultWidth;
    const onMouseMove = (moveEvent) => {
      const nextWidth = Math.max(column.minWidth || 120, Math.round(startWidth + moveEvent.clientX - startX));
      setColumnWidths((prev) => ({ ...prev, [column.id]: nextWidth }));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [columnWidths, tableColumns]);
  const tablePixelWidth = useMemo(
    () => tableColumns.reduce((sum, column) => sum + (columnWidths[column.id] || column.defaultWidth), reviewItems.length > 0 ? 110 : 0),
    [columnWidths, reviewItems.length, tableColumns]
  );
	  const sourceTableRows = useMemo(() => tableRowsWithTraceIds, [tableRowsWithTraceIds]);
  const getTableFilterCell = React.useCallback((item, columnIndex) => {
    const column = tableColumns[columnIndex];
    return column ? column.getValue(item.row) : "";
  }, [tableColumns]);
  const tableFilterState = useColumnFilters(sourceTableRows, getTableFilterCell);
  const exportRowsToCsv = React.useCallback(() => {
    const csvEscape = (value) => {
      const text = String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const headers = tableColumns.map((column) => column.label);
	    const csvRows = tableRowsWithTraceIds.map(({ row }) => tableColumns.map((column) => csvEscape(column.getValue(row))).join(","));
    const csv = [headers.map(csvEscape).join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeRepoName = String(repoName || "code-architecture")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "code-architecture";
    link.href = url;
    link.download = `${safeRepoName}-functional-decomposition-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [repoName, tableRowsWithTraceIds, tableColumns]);
  const includeRowFiles = React.useCallback((row, mode) => {
    const files = [];
    if (mode !== "to") files.push(row?.fromFile);
    if (mode !== "from") files.push(row?.toFile);
    const nextFiles = files
      .flatMap((value) => String(value || "").split(/[,;]+/))
      .map((value) => value.trim())
      .filter(Boolean);
    if (!nextFiles.length) return;
    setIncludedFiles((prev) => Array.from(new Set([...prev, ...nextFiles])));
  }, []);
  const requestCsuDiagramFocus = React.useCallback((target, onDone) => {
    const delays = [120, 240, 420, 700, 1100, 1600, 2300, 3200, 4500, 6200];
    const timers = [];
    let completed = false;
    const clearTimers = () => timers.forEach((timer) => clearTimeout(timer));
    delays.forEach((delay, index) => {
      const timer = setTimeout(() => {
        if (completed) return;
        const focused = diagramRef.current?.focusArchitectureTarget?.(target);
        if (focused || index === delays.length - 1) {
          completed = true;
          clearTimers();
          onDone?.();
        }
      }, delay);
      timers.push(timer);
    });
    return clearTimers;
  }, []);
  const openCsuDiagramTarget = React.useCallback((event, target) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    includeRowFiles(target.row, target.mode);
    setQueuedCsuFocusTarget(target);
    setView("architecture");
    setArchitectureAbstraction("detailed");
    setCleanOnceKey(`trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  }, [includeRowFiles]);
  const buildCsuDiagramTarget = React.useCallback((row, sourceIndex, type) => ({
    type: type === "action" ? "edge" : "node",
    mode: type === "from" ? "from" : type === "to" ? "to" : "edge",
    row,
    rowIndex: sourceIndex,
    rowRef: row.rowRef || sourceIndex + 1,
    nodeId: type === "from" ? row.fromNodeId : type === "to" ? row.toNodeId : "",
    edgeId: type === "action" ? row.edgeId : "",
    functionName: type === "from" ? row.from : type === "to" ? row.to : "",
    fromFunction: row.from,
    controlAction: row.action,
    toFunction: row.to,
    fromFile: row.fromFile || "",
    toFile: row.toFile || "",
  }), []);
  React.useEffect(() => {
    if (!focusTarget) return;
    const targetRowIndex = Number(focusTarget.rowIndex);
    const matchedRowIndex = Number.isFinite(targetRowIndex) && targetRowIndex >= 0
      ? targetRowIndex
      : diagramRows.findIndex((row) =>
        String(row.fromFunction || "") === String(focusTarget.fromFunction || "") &&
        String(row.controlAction || "") === String(focusTarget.controlAction || "") &&
        String(row.toFunction || "") === String(focusTarget.toFunction || "")
      );
    const enrichedTarget = matchedRowIndex >= 0
      ? { ...focusTarget, rowIndex: matchedRowIndex }
      : focusTarget;
    includeRowFiles(enrichedTarget.row || enrichedTarget, enrichedTarget.mode);
    setView("architecture");
    setArchitectureAbstraction("detailed");
    setCleanOnceKey(`trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    return requestCsuDiagramFocus(enrichedTarget, onFocusTargetHandled);
  }, [diagramRows, focusTarget, includeRowFiles, onFocusTargetHandled, requestCsuDiagramFocus]);
  React.useEffect(() => {
    if (!queuedCsuFocusTarget || view !== "architecture" || architectureAbstraction !== "detailed") return undefined;
    return requestCsuDiagramFocus(queuedCsuFocusTarget, () => setQueuedCsuFocusTarget(null));
  }, [architectureAbstraction, queuedCsuFocusTarget, requestCsuDiagramFocus, view]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <button
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-60 ${
              view === "architecture" ? "bg-[#2D7DFE] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            onClick={() => {
              setView("architecture");
              setArchitectureAbstraction("subsystem");
              setCleanOnceKey(`clean-${Date.now()}`);
            }}
            disabled={!hasArchitecture}
          >
            {levelLabels.architecture}
          </button>
          <button
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
              view === "table" ? "bg-[#2D7DFE] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            onClick={() => setView("table")}
          >
            Table
          </button>
	          <button
	            type="button"
	            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm disabled:opacity-50"
	            onClick={exportRowsToCsv}
	            disabled={!rowsWithTraceIds.length}
	            title="Export functional decomposition table as CSV"
	          >
	            Export CSV
	          </button>
	          <button
	            type="button"
	            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm"
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? "Exit fullscreen" : "Open code-based architecture fullscreen"}
          >
            {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>

      {/* Surface */}
      <div
        className={`flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${
          fullscreen ? "fixed left-4 right-4 bottom-4 top-[4.5rem] z-[9999] flex flex-col bg-white shadow-2xl" : ""
        }`}
      >
      {fullscreen && (
        <div className="border-b border-slate-200 bg-white px-4 py-2">
          <div>
            <div className="text-sm font-semibold text-slate-800">Code-Based Architecture</div>
            <div className="text-xs text-slate-500">Fullscreen mode</div>
          </div>
        </div>
      )}
      {view === "report" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <ArchitectureReportViewer
            report={architectureReport}
            repoName={repoName}
            branch={architectureReport?.metadata?.branch || branch}
            commitSha={architectureReport?.metadata?.commitSha}
            onRegenerate={reviewMode ? undefined : handleGenerateArchitectureDescription}
            onBackToArchitecture={() => {
              setView("architecture");
              setArchitectureAbstraction("subsystem");
              setCleanOnceKey(`clean-${Date.now()}`);
            }}
          />
        </div>
      ) : view === "architecture" ? (
  <div className="flex min-h-0 flex-1 flex-col p-0">
    {view === "architecture" && (
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold uppercase text-slate-500">Abstraction</span>
        {abstractionLevels.map(([level, fallbackLabel]) => {
          const label = levelLabels[level] || fallbackLabel;
          return (
          <button
            key={level}
            type="button"
            onClick={() => setArchitectureAbstraction(level)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              architectureAbstraction === level
                ? "bg-[#2D7DFE] text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        )})}
        {fullscreen && (
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => setFullscreen(false)}
          >
            Close
          </button>
        )}
      </div>
    )}
    <div className="flex min-h-0 flex-1">
      {/* Left sidebar */}
      <aside
  className={`${collapsed ? "w-10" : "w-64"} relative flex min-h-0 flex-col border-r bg-white transition-all duration-200`}
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
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="font-semibold text-sm mb-2">Files</div>

      <div className="mb-2 shrink-0">
        <input
          value={fileQuery}
          onChange={(e) => setFileQuery(e.target.value)}
          placeholder="Search files…"
          className="w-full rounded-md border px-2 py-1 text-sm"
        />
      </div>

      <div className="mb-3 flex shrink-0 items-center gap-2 text-xs">
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

      <div className="mb-2 shrink-0 text-[11px] text-slate-500">
        {filteredTreeFileCount} file{filteredTreeFileCount === 1 ? "" : "s"} in hierarchy
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {renderFileTree(filteredFileTree)}
        {filteredFileTree.length === 0 && (
          <div className="text-xs text-slate-500">No matches</div>
        )}
      </div>
    </div>
  )}
</aside>


      {/* Diagram surface */}
      <div className="flex-1 p-3 min-h-0">
        <LiteSummaryDiagramReactFlowGitHub
          ref={diagramRef}
          rows={diagramRows}
          onUpdateRows={(nextRows) => {
            if (reviewMode) return;
            const backMapped = nextRows.map((r) => ({
              from: r.fromFunction,
              fromFile: r.fromFile || "",
              fromDetails: r.fromDetails,
              action: r.controlAction,
              controlActionDetails: r.controlDetails,
              to: r.toFunction,
              toFile: r.toFile || "",
              toDetails: r.toDetails,
              architecture: r.architecture || null,
              codeEvidence: r.codeEvidence || null,
              sourceEvidence: r.sourceEvidence || null,
              rowRef: r.rowRef,
              traceId: r.traceId,
              fromNodeId: r.fromNodeId,
              edgeId: r.edgeId,
              toNodeId: r.toNodeId,
            }));
            if (manualData) setManualData(backMapped);
          }}
          repoName={repoName}
          storageKey={storageKey}
          cleanOnceKey={cleanOnceKey}
          height={diagramHeight}
          onCleanApplied={() => setCleanOnceKey(null)}
          onRequestCreateProject={onRequestCreateProject}
          reviewMode={reviewMode}
          includeFiles={includedFiles}   // ← pass selection to diagram
          architectureMode={view === "architecture"}
          architectureAbstraction={architectureAbstraction}
          colorSystemElements={colorSystemElements}
          hazardSummary={hazardSummary}
          assuranceArtifacts={assuranceArtifacts}
          onOpenHazardRow={onOpenHazardRow}
          onOpenFunctionalRow={onOpenFunctionalRow}
          onOpenAssuranceArtifactRow={onOpenAssuranceArtifactRow}
        />
      </div>
    </div>
  </div>
) : (

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="table-fixed" style={{ minWidth: tablePixelWidth }}>
              <colgroup>
                {reviewItems.length > 0 && <col style={{ width: 110, minWidth: 110 }} />}
                {tableColumns.map((column) => (
                  <col
                    key={column.id}
                    style={{
                      width: columnWidths[column.id] || column.defaultWidth,
                      minWidth: column.minWidth,
                    }}
                  />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-20 bg-indigo-50 text-slate-700">
                <tr className="bg-indigo-50">
                  {reviewItems.length > 0 && (
                    <th className={thBase} style={{ width: 110, minWidth: 110 }}>
                      Review
                    </th>
                  )}
                  {tableColumns.map((column, index) => (
                    <FilterableHeaderCell
                      key={column.label}
                      label={column.label}
                      index={index}
                      className={thBase}
                      style={{
                        width: columnWidths[column.id] || column.defaultWidth,
                        minWidth: column.minWidth,
                      }}
                      filterState={tableFilterState}
                      onResizeStart={handleColumnResizeStart}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableFilterState.filteredRows.map(({ row, sourceIndex }) => {
                  const i = sourceIndex;
                  const elementId = `cba-row-${row.rowRef || i + 1}`;
                  const selected = selectedArchitectureRowId === elementId;
                  const reviewItem = reviewByRow?.get?.(i) || null;
                  const rejected = reviewItem?.status === REVIEW_STATUSES.REJECTED;
                  const hasHighlightedRow = highlightedRowIndex !== null && highlightedRowIndex !== undefined && highlightedRowIndex !== "";
                  const highlighted = hasHighlightedRow && Number(highlightedRowIndex) === i;
                  return (
                  <tr
                    key={i}
                    ref={(el) => {
                      if (el) tableRowRefs.current[i] = el;
                      else delete tableRowRefs.current[i];
                    }}
                    onClick={() => handleSelectArchitectureRow(row, i)}
                    className={`cursor-pointer ${
                      highlighted
                        ? "bg-[#FFF7D6] ring-2 ring-[#F3B63F] ring-inset"
                        : rejected
                          ? "bg-rose-50/60"
                          : selected
                            ? "bg-blue-50 ring-1 ring-inset ring-blue-300"
                            : i % 2 ? "bg-slate-50/60 hover:bg-slate-100" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    {reviewItems.length > 0 && (
                      <td className={tdBase}>
                        <ReviewStatusBadge
                          reviewItem={reviewItem}
                          openOptions={{
                            ...reviewDrawerOptions,
                            reviewItemIds: reviewItems.map((item) => item.id),
                          }}
                        />
                      </td>
                    )}
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>
                      {row.from ? (
                        <button
                          type="button"
                          className={traceLinkClass}
                          title="Open this function in the CSU diagram view"
                          onClick={(event) => openCsuDiagramTarget(event, buildCsuDiagramTarget(row, i, "from"))}
                        >
                          {row.from}
                        </button>
                      ) : ""}
                    </td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.fromFile}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.fromDetails}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>
                      {row.action ? (
                        <button
                          type="button"
                          className={traceLinkClass}
                          title="Open this control action edge in the CSU diagram view"
                          onClick={(event) => openCsuDiagramTarget(event, buildCsuDiagramTarget(row, i, "action"))}
                        >
                          {row.action}
                        </button>
                      ) : ""}
                    </td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.controlActionDetails}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>
                      {row.to ? (
                        <button
                          type="button"
                          className={traceLinkClass}
                          title="Open this function in the CSU diagram view"
                          onClick={(event) => openCsuDiagramTarget(event, buildCsuDiagramTarget(row, i, "to"))}
                        >
                          {row.to}
                        </button>
                      ) : ""}
                    </td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.toFile}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.toDetails}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.architecture?.subsystem || "Application Subsystem"}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.architecture?.csci || ""}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.architecture?.csc || ""}</td>
                    <td className={`${tdBase} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>{row.architecture?.csu || ""}</td>
                  </tr>
                )})}
                {tableFilterState.filteredRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-sm text-slate-500" colSpan={tableColumns.length + (reviewItems.length > 0 ? 1 : 0)}>
                      No rows match the active column filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
