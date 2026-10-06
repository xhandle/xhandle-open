import { readRecord } from '../code-architecture-storage/chunkedRecord';
import { codeSourceIndexKey, codeSourceProvenance, isLocalCodeSource } from "../code-architecture-context/codeSourceIdentity";
const IDB_DB_NAME = "xhandle";
const IDB_VERSION = 4;
const CODE_INDEX_STORE = "code_index";
const CBA_STORE = "copilot_baseline";
const DIAGRAM_POSITIONS_STORE = "diagram_positions";
const VSCODE_SOURCE_FILES_URL = "http://127.0.0.1:39017/source-files";

const SOURCE_FILE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
  ".ino", ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".cs",
  ".go", ".rs", ".swift", ".kt", ".kts", ".rb", ".php", ".m",
  ".mm", ".scala", ".sh", ".bash", ".zsh",
]);

function openXHandleDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser context."));
      return;
    }
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CODE_INDEX_STORE)) {
        db.createObjectStore(CODE_INDEX_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(CBA_STORE)) {
        db.createObjectStore(CBA_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(DIAGRAM_POSITIONS_STORE)) {
        db.createObjectStore(DIAGRAM_POSITIONS_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetCodeIndex(key) {
  const db = await openXHandleDb();
  try { return await readRecord(db, CODE_INDEX_STORE, key) || null; }
  finally { db.close(); }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function pathExtension(path = "") {
  const clean = String(path).split("?")[0].split("#")[0];
  const match = clean.match(/(\.[A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

export function isPatchableSourceFile(path = "") {
  const clean = normalizeText(path);
  if (!clean) return false;
  if (clean.includes("..") || clean.startsWith("/") || clean.startsWith("~")) return false;
  if (/package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|\.min\.(js|css)$|\.map$/i.test(clean)) return false;
  return SOURCE_FILE_EXTENSIONS.has(pathExtension(clean));
}

function repoPartsFromUrl(url = "") {
  const text = normalizeText(url);
  const match = text.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  return match ? { owner: match[1], repo: match[2] } : {};
}

function sourceUrlParts(url = "") {
  const text = normalizeText(url);
  const blob = text.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/blob\/([^/\s]+)\/(.+)$/i);
  if (blob) {
    return {
      owner: decodeURIComponent(blob[1]),
      repo: decodeURIComponent(blob[2]).replace(/\.git$/i, ""),
      branch: decodeURIComponent(blob[3]),
      filePath: decodeURIComponent(blob[4]),
    };
  }
  const raw = text.match(/raw\.githubusercontent\.com\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/(.+)$/i);
  if (raw) {
    return {
      owner: decodeURIComponent(raw[1]),
      repo: decodeURIComponent(raw[2]).replace(/\.git$/i, ""),
      branch: decodeURIComponent(raw[3]),
      filePath: decodeURIComponent(raw[4]),
    };
  }
  return {};
}

function repoPartsFromMeta(repoMeta = {}, refs = []) {
  const fromUrl = repoPartsFromUrl(repoMeta.repoUrl || repoMeta.url || "");
  const repoId = normalizeText(repoMeta.repoId || repoMeta.repoName || [repoMeta.owner, repoMeta.repo].filter(Boolean).join("/"));
  const [ownerFromId, repoFromId] = repoId.includes("/") ? repoId.split("/").slice(-2) : [];
  const refWithRepo = refs.find((ref) => ref.owner || ref.repo || ref.repoName || ref.repoUrl);
  const refUrl = repoPartsFromUrl(refWithRepo?.repoUrl || "");
  const refSource = sourceUrlParts(refWithRepo?.sourceUrl || "");
  return {
    owner: normalizeText(repoMeta.owner || fromUrl.owner || ownerFromId || refWithRepo?.owner || refUrl.owner || refSource.owner),
    repo: normalizeText(repoMeta.repo || fromUrl.repo || repoFromId || refWithRepo?.repo || refWithRepo?.repoName || refUrl.repo || refSource.repo),
  };
}

const sourceRefIdentity = ref => JSON.stringify([ref.sourceType || 'legacy', ref.sourceId || ref.repoId || ref.repoName || ref.repoUrl || '', ref.snapshotId || ref.commitSha || '']);

function uniqueRefs(codeReferences = []) {
  const seen = new Set();
  return (Array.isArray(codeReferences) ? codeReferences : [])
    .filter((ref) => isPatchableSourceFile(ref?.filePath))
    .filter((ref) => {
      const key = `${sourceRefIdentity(ref)}:${ref.filePath}:${ref.symbolName || ""}:${ref.startLine || ""}:${ref.endLine || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function snippetFromLines({ content, startLine, endLine, symbolName, baseLine = 1 }) {
  const lines = String(content || "").split("\n");
  if (!lines.length) return null;
  let start = Number(startLine);
  let end = Number(endLine);
  if (!Number.isFinite(start) || start <= 0) {
    const symbol = normalizeText(symbolName);
    const found = symbol
      ? lines.findIndex((line) => line.includes(symbol) || new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line))
      : -1;
    start = found >= 0 ? found + baseLine : baseLine;
  }
  if (!Number.isFinite(end) || end < start) end = start;

  const windowStart = Math.max(baseLine, start - 35);
  const windowEnd = Math.min(baseLine + lines.length - 1, Math.max(end + 45, start + 90));
  const snippet = lines
    .slice(windowStart - baseLine, windowEnd - baseLine + 1)
    .map((line, index) => `${String(windowStart + index).padStart(5, " ")} | ${line}`)
    .join("\n");
  return { snippet, snippetStartLine: windowStart, snippetEndLine: windowEnd };
}

async function loadIndexedSourceRecord({ filePath, ...source }) {
  const key = codeSourceIndexKey(source, filePath);
  if (!key) return null;
  try {
    const record = await idbGetCodeIndex(key);
    if (record) return record;
  } catch {}
  try {
    const fallback = localStorage.getItem(key);
    return fallback ? JSON.parse(fallback) : null;
  } catch {
    return null;
  }
}

async function fetchVSCodeWorkspaceSource({ filePath, ref = {} }) {
  if (!filePath) return { record: null, diagnostic: "No file path was provided." };
  try {
    const response = await fetch(VSCODE_SOURCE_FILES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePaths: [filePath],
        fileRequests: [{
          filePath,
          symbolName: ref.symbolName || "",
          symbols: [ref.symbolName, ref.symbolType].filter(Boolean),
        }],
      }),
    });
    if (!response.ok) return { record: null, diagnostic: `VS Code source endpoint returned ${response.status}.` };
    const payload = await response.json();
    const file = Array.isArray(payload.files)
      ? payload.files.find((item) => item.requestedPath === filePath || item.filePath === filePath) || payload.files[0]
      : null;
    if (!file?.ok || !file.content) {
      return {
        record: null,
        diagnostic: file?.error
          ? `VS Code active workspace ${payload.workspaceRoot || ""}: ${file.error}`
          : `VS Code active workspace ${payload.workspaceRoot || ""} did not return file content.`,
        workspaceRoot: payload.workspaceRoot || "",
      };
    }
    return {
      record: {
        path: file.filePath,
        requestedPath: file.requestedPath || filePath,
        content: file.content,
        branch: file.branch || payload.branch || "",
        commitSha: file.commitSha || payload.commitSha || "",
        workspaceRoot: payload.workspaceRoot || "",
        pathResolutionWarning: file.warning || "",
        source: "vscode_active_workspace",
      },
      diagnostic: "",
      workspaceRoot: payload.workspaceRoot || "",
    };
  } catch (error) {
    return {
      record: null,
      diagnostic: `VS Code active workspace source was unavailable at ${VSCODE_SOURCE_FILES_URL}. ${error?.message || ""}`.trim(),
    };
  }
}

async function fetchRemoteSource({ owner, repo, branch, filePath, sourceUrl }) {
  const sourceParts = sourceUrlParts(sourceUrl || "");
  const resolvedOwner = owner || sourceParts.owner;
  const resolvedRepo = repo || sourceParts.repo;
  const resolvedBranch = branch || sourceParts.branch || "main";
  const resolvedPath = filePath || sourceParts.filePath;
  if (!resolvedOwner || !resolvedRepo || !resolvedPath) return null;

  const rawUrl = sourceUrlParts(sourceUrl || "").filePath
    ? `https://raw.githubusercontent.com/${encodeURIComponent(sourceParts.owner)}/${encodeURIComponent(sourceParts.repo)}/${encodeURIComponent(sourceParts.branch || resolvedBranch)}/${sourceParts.filePath}`
    : `https://raw.githubusercontent.com/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolvedRepo)}/${encodeURIComponent(resolvedBranch)}/${resolvedPath}`;

  try {
    const response = await fetch(rawUrl);
    if (!response.ok) return null;
    const content = await response.text();
    if (!content) return null;
    return {
      path: resolvedPath,
      owner: resolvedOwner,
      repo: resolvedRepo,
      branch: resolvedBranch,
      content: content.slice(0, 80000),
      sourceUrl: rawUrl,
    };
  } catch {
    return null;
  }
}

function evidenceContentForRef(ref = {}) {
  return ref.content || ref.source || ref.snippet || ref.codeSnippet || "";
}

async function loadSourceRecordForRef({ ref, owner, repo, repoMeta = {} }) {
  const filePath = normalizeText(ref.filePath);
  if (isLocalCodeSource(ref) || isLocalCodeSource(repoMeta)) {
    const localSource = isLocalCodeSource(ref) ? ref : repoMeta;
    const record = await loadIndexedSourceRecord({ ...codeSourceProvenance(localSource), filePath });
    return {
      record, content: record?.content || evidenceContentForRef(ref),
      source: record?.content ? "local_source_snapshot" : "architecture_evidence",
      filePath, requestedFilePath: filePath, owner: "", repo: "", branch: "",
      workspaceRoot: "", pathResolutionWarning: "", vscodeWorkspaceRoot: "",
      vscodeDiagnostic: record?.content || evidenceContentForRef(ref) ? "" : "Saved local source is unavailable. Reconnect and analyze this project folder again.",
    };
  }
  const sourceParts = sourceUrlParts(ref.sourceUrl || "");
  const refOwner = owner || sourceParts.owner;
  const refRepo = repo || sourceParts.repo;
  const refBranch = ref.branch || repoMeta.branch || sourceParts.branch || "main";
  if (ref.evidenceVersion === 1 && ref.snapshotId) {
    const record = await loadIndexedSourceRecord({ owner: ref.owner || refOwner, repo: ref.repo || refRepo, ...codeSourceProvenance(ref), filePath });
    return { record, content: record?.content || evidenceContentForRef(ref), source: record ? "github_source_snapshot" : "architecture_evidence", filePath, requestedFilePath: filePath, owner: refOwner, repo: refRepo, branch: ref.snapshotId, workspaceRoot: "", pathResolutionWarning: record ? "" : "Original snapshot file is unavailable; only retained excerpt evidence can be used.", vscodeDiagnostic: "", vscodeWorkspaceRoot: "" };
  }
  const vscodeSource = await fetchVSCodeWorkspaceSource({ filePath, ref });
  let record = vscodeSource.record;
  let source = "vscode_active_workspace";
  if (!record?.content) {
    record = await loadIndexedSourceRecord({ owner: refOwner, repo: refRepo, filePath });
    source = "indexeddb_code_index";
  }
  if (!record?.content) {
    record = await fetchRemoteSource({
      owner: refOwner,
      repo: refRepo,
      branch: refBranch,
      filePath,
      sourceUrl: ref.sourceUrl,
    });
    source = record?.content ? "github_raw_source" : "architecture_evidence";
  }
  const content = record?.content || evidenceContentForRef(ref);
  const resolvedFilePath = record?.path || filePath;
  return {
    record,
    content,
    source,
    filePath: resolvedFilePath,
    requestedFilePath: filePath,
    owner: refOwner,
    repo: refRepo,
    branch: record?.branch || refBranch,
    workspaceRoot: record?.workspaceRoot || "",
    pathResolutionWarning: record?.pathResolutionWarning || "",
    vscodeDiagnostic: vscodeSource.diagnostic || "",
    vscodeWorkspaceRoot: vscodeSource.workspaceRoot || record?.workspaceRoot || "",
  };
}

export async function buildSourceSnippetsForPatch({
  finding,
  codeReferences = [],
  repoMeta = {},
  maxSnippets = 6,
} = {}) {
  const refs = uniqueRefs(codeReferences.length ? codeReferences : finding?.affectedCodeRefs || []);
  const { owner, repo } = repoPartsFromMeta(repoMeta, refs);
  const snippets = [];
  const diagnostics = [];

  for (const ref of refs) {
    const { record, content, source, filePath, requestedFilePath, owner: refOwner, repo: refRepo, branch: refBranch, workspaceRoot, pathResolutionWarning, vscodeDiagnostic, vscodeWorkspaceRoot } = await loadSourceRecordForRef({
      ref,
      owner,
      repo,
      repoMeta,
    });
    if (!content) {
      diagnostics.push({
        filePath,
        reason: vscodeDiagnostic || "No indexed, remote, or embedded source content was available.",
        owner: refOwner,
        repo: refRepo,
        branch: refBranch,
        workspaceRoot: vscodeWorkspaceRoot,
      });
      continue;
    }
    const lineSnippet = snippetFromLines({
      content,
      baseLine: source === "architecture_evidence" ? Number(ref.contentStartLine) || 1 : 1,
      startLine: ref.startLine,
      endLine: ref.endLine,
      symbolName: ref.symbolName,
    });
    if (!lineSnippet) continue;
    snippets.push({
      filePath,
      requestedFilePath,
      symbolName: ref.symbolName || "",
      symbolType: ref.symbolType || "",
      startLine: ref.startLine || lineSnippet.snippetStartLine,
      endLine: ref.endLine || lineSnippet.snippetEndLine,
      snippetStartLine: lineSnippet.snippetStartLine,
      snippetEndLine: lineSnippet.snippetEndLine,
      branch: refBranch || record?.branch || "",
      commitSha: ref.commitSha || record?.commitSha || "",
      workspaceRoot,
      pathResolutionWarning,
      content: lineSnippet.snippet,
      source,
    });
    if (snippets.length >= maxSnippets) break;
  }

  Object.defineProperty(snippets, "diagnostics", {
    value: diagnostics,
    enumerable: false,
  });
  return snippets;
}

export async function buildImpactFileContexts({
  finding,
  codeReferences = [],
  repoMeta = {},
  maxFiles = 6,
} = {}) {
  const refs = uniqueRefs(codeReferences.length ? codeReferences : finding?.affectedCodeRefs || []);
  const { owner, repo } = repoPartsFromMeta(repoMeta, refs);
  const byPath = new Map();
  const diagnostics = [];

  for (const ref of refs) {
    const requestedPath = normalizeText(ref.filePath);
    if (!requestedPath) continue;
    const { record, content, source, filePath, requestedFilePath, owner: refOwner, repo: refRepo, branch: refBranch, workspaceRoot, pathResolutionWarning, vscodeDiagnostic, vscodeWorkspaceRoot } = await loadSourceRecordForRef({
      ref,
      owner,
      repo,
      repoMeta,
    });
    const sourcePathKey = `${sourceRefIdentity(ref)}:${filePath}`;
    if (!filePath || byPath.has(sourcePathKey)) continue;
    if (!content) {
      diagnostics.push({
        filePath: requestedPath,
        reason: vscodeDiagnostic || "No indexed, remote, or embedded source content was available.",
        owner: refOwner,
        repo: refRepo,
        branch: refBranch,
        workspaceRoot: vscodeWorkspaceRoot,
      });
      continue;
    }
    const lines = String(content).split("\n");
    const baseLine = source === "architecture_evidence" ? Number(ref.contentStartLine) || 1 : 1;
    byPath.set(sourcePathKey, {
      filePath,
      requestedFilePath,
      owner: refOwner,
      repo: refRepo,
      branch: refBranch || record?.branch || "",
      commitSha: ref.commitSha || record?.commitSha || "",
      workspaceRoot,
      pathResolutionWarning,
      source,
      lineCount: lines.length,
      loadedBytes: String(content).length,
      isTruncated: String(content).length >= 80000,
      references: refs.filter((candidate) => sourceRefIdentity(candidate) === sourceRefIdentity(ref) && (candidate.filePath === requestedFilePath || candidate.filePath === filePath)).map((candidate) => ({
        symbolName: candidate.symbolName || "",
        symbolType: candidate.symbolType || "",
        startLine: candidate.startLine || null,
        endLine: candidate.endLine || null,
        rationale: candidate.rationale || "",
      })),
      content: lines.map((line, index) => `${String(index + baseLine).padStart(5, " ")} | ${line}`).join("\n"),
    });
    if (byPath.size >= maxFiles) break;
  }

  const contexts = Array.from(byPath.values());
  Object.defineProperty(contexts, "diagnostics", {
    value: diagnostics,
    enumerable: false,
  });
  return contexts;
}

export function compactPatchFinding(finding = {}) {
  return {
    id: finding.id,
    title: finding.title,
    description: finding.description,
    hazardId: finding.hazardId,
    hazard: finding.hazard,
    causalFactorId: finding.causalFactorId,
    causalFactor: finding.causalFactor,
    severity: finding.severity,
    likelihood: finding.likelihood,
    riskLevel: finding.riskLevel,
    proposedMitigation: finding.proposedMitigation,
    architectureElementId: finding.architectureElementId,
    architectureElementLabel: finding.architectureElementLabel,
    hazardAnalysisRunId: finding.hazardAnalysisRunId,
    hazardAnalysisMethod: finding.hazardAnalysisMethod,
    hazardRowRef: finding.hazardRowRef,
    coveredHazardRowRefs: finding.coveredHazardRowRefs || [],
    architectureRowRef: finding.architectureRowRef,
  };
}
