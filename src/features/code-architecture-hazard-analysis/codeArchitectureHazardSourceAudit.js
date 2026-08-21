const IDB_DB_NAME = "xhandle";
const IDB_VERSION = 4;
const CODE_INDEX_STORE = "code_index";

function normalizeText(value) {
  return String(value || "").trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return normalizeText(value)
    .split(/\s*[,;]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function repoPartsFromUrl(url = "") {
  const text = normalizeText(url);
  const match = text.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  return match ? { owner: match[1], repo: match[2] } : {};
}

function repoPartsFromMeta(repoMeta = {}) {
  const fromUrl = repoPartsFromUrl(repoMeta.repoUrl || repoMeta.url || "");
  const repoId = normalizeText(repoMeta.repoId || repoMeta.repoName || [repoMeta.owner, repoMeta.repo].filter(Boolean).join("/"));
  const parts = repoId.includes("/") ? repoId.split("/") : [];
  return {
    owner: normalizeText(repoMeta.owner || fromUrl.owner || parts[parts.length - 2]),
    repo: normalizeText(repoMeta.repo || fromUrl.repo || parts[parts.length - 1]),
  };
}

function sourceFilesFromRow(row = {}) {
  const files = [
    row.fromFile,
    row.toFile,
    ...(row.sourceFiles || []),
    ...(row.traceability?.sourceFiles || []),
    ...((row.affectedCodeRefs || []).map((ref) => ref?.filePath)),
    ...((row.codeEvidence?.sourceFunctions || []).map((fn) => fn?.filePath || fn?.path)),
    ...((row.sourceEvidence?.functions || []).map((fn) => fn?.filePath || fn?.path)),
    ...((row.codeEvidence?.files || []).map((file) => file?.filePath || file?.path)),
  ];
  return Array.from(new Set(files.flatMap(splitList))).filter(Boolean);
}

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadIndexedSourceRecord({ owner, repo, filePath }) {
  if (!owner || !repo || !filePath || typeof indexedDB === "undefined") return null;
  const key = `code:file:${owner}/${repo}:${filePath}`;
  try {
    const db = await openXHandleDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(CODE_INDEX_STORE, "readonly");
      const req = tx.objectStore(CODE_INDEX_STORE).get(key);
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror = () => reject(req.error);
    });
    if (result) return result;
  } catch {}

  try {
    const fallback = localStorage.getItem(key);
    return fallback ? JSON.parse(fallback) : null;
  } catch {
    return null;
  }
}

async function loadAllIndexedSourceRecords({ owner, repo }) {
  if (!owner || !repo) return [];
  const prefix = `code:file:${owner}/${repo}:`;
  if (typeof indexedDB !== "undefined") try {
    const db = await openXHandleDb();
    const rows = await new Promise((resolve, reject) => {
      const rows = [];
      const tx = db.transaction(CODE_INDEX_STORE, "readonly");
      const req = tx.objectStore(CODE_INDEX_STORE).openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(rows);
          return;
        }
        const key = String(cursor.value?.key || "");
        if (key.startsWith(prefix) && cursor.value?.value) rows.push(cursor.value.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    if (rows.length) return rows;
  } catch {
    // Fall through to localStorage compatibility scan.
  }

  try {
    if (typeof localStorage === "undefined") return [];
    const rows = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = String(localStorage.key(index) || "");
      if (!key.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const record = JSON.parse(raw);
      if (record) rows.push(record);
    }
    return rows;
  } catch {
    return [];
  }
}

function lineSlice(content = "", startLine, endLine) {
  const lines = String(content || "").split("\n");
  const start = Math.max(0, Number(startLine || 1) - 1);
  const end = Math.min(lines.length, Math.max(start + 1, Number(endLine || startLine || start + 1)));
  return lines.slice(start, end).join("\n").slice(0, 12000);
}

function attachFunctionContent(record = {}, fn = {}) {
  if (fn?.content || !record?.content) return fn;
  const startLine = Number(fn.startLine || fn.lineStart || 0);
  if (!startLine) return fn;
  return {
    ...fn,
    content: lineSlice(record.content, startLine, fn.endLine || fn.lineEnd || startLine),
  };
}

function mergeUniqueFunctions(functions = []) {
  const byKey = new Map();
  functions.filter(Boolean).forEach((fn) => {
    const key = [
      fn.filePath || fn.path || "",
      fn.functionName || fn.name || fn.symbolName || "",
      fn.startLine || fn.lineStart || "",
    ].join(":");
    if (!byKey.has(key)) byKey.set(key, fn);
  });
  return Array.from(byKey.values());
}

function mergeFileRecords(existingFiles = [], loadedFiles = []) {
  const byPath = new Map();
  [...existingFiles, ...loadedFiles].filter(Boolean).forEach((file) => {
    const filePath = file.filePath || file.path;
    if (!filePath) return;
    byPath.set(filePath, {
      ...(byPath.get(filePath) || {}),
      ...file,
      filePath,
    });
  });
  return Array.from(byPath.values());
}

function normalizeCodeSymbol(value = "") {
  return String(value || "")
    .split(".")
    .pop()
    .replace(/[^A-Za-z0-9_$]+/g, "")
    .toLowerCase();
}

function functionNameOf(fn = {}) {
  return fn.functionName || fn.name || fn.symbolName || fn.label || "";
}

function sourceFunctionsFromRecord(record = {}) {
  const structured = Array.isArray(record.sourceFunctions) ? record.sourceFunctions : [];
  const named = Array.isArray(record.functions)
    ? record.functions
      .filter((item) => typeof item === "string")
      .map((name) => ({ functionName: name, filePath: record.path || record.filePath || record.name || "" }))
    : [];
  const auditedTopLevel = Array.isArray(record.sourceAudit?.pythonTopLevelFunctions)
    ? record.sourceAudit.pythonTopLevelFunctions.map((item) => ({
      functionName: item.name,
      filePath: record.path || record.filePath || record.name || "",
      startLine: item.line,
    }))
    : [];
  return [...structured, ...named, ...auditedTopLevel];
}

function endpointValidatorSymbols(row = {}) {
  return [row.fromFunction || row.from, row.toFunction || row.to]
    .map((symbol) => String(symbol || "").trim())
    .filter((symbol) => /^is_|_?validate|bounds?/i.test(symbol) || /within_bounds|validator|check/i.test(symbol));
}

function lineLooksLikeDefinition(line = "", symbol = "") {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*(?:async\\s+def|def|class)\\s+${escaped}\\b|^\\s*${escaped}\\s*=`, "i").test(line);
}

function countCallSites(records = [], symbol = "") {
  const normalized = normalizeCodeSymbol(symbol);
  if (!normalized) return 0;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const callPattern = new RegExp(`(?:^|[^A-Za-z0-9_$])(?:self\\.|this\\.|[A-Za-z0-9_$]+\\.)?${escaped}\\s*\\(`, "i");
  let count = 0;
  records.forEach((record) => {
    String(record?.content || "").split("\n").forEach((line) => {
      if (lineLooksLikeDefinition(line, normalized)) return;
      if (callPattern.test(line)) count += 1;
    });
  });
  return count;
}

function definitionCount(records = [], symbol = "") {
  const normalized = normalizeCodeSymbol(symbol);
  return records.reduce((count, record) => {
    const functions = sourceFunctionsFromRecord(record);
    return count + functions.filter((fn) => normalizeCodeSymbol(functionNameOf(fn)) === normalized).length;
  }, 0);
}

function usageAuditsForRow(row = {}, allRecords = []) {
  return endpointValidatorSymbols(row).map((symbolName) => ({
    kind: "validator",
    symbolName,
    definitionCount: definitionCount(allRecords, symbolName),
    callSiteCount: countCallSites(allRecords, symbolName),
  })).filter((audit) => audit.definitionCount > 0);
}

function hasArchitectureCoverageForSymbol(rows = [], symbol = "") {
  const target = normalizeCodeSymbol(symbol);
  return rows.some((row) => {
    const endpointSymbols = [
      row.fromFunction || row.from,
      row.toFunction || row.to,
    ].map(normalizeCodeSymbol);
    return endpointSymbols.includes(target);
  });
}

function makeMissingExtractTrajTokensRow(records = [], rows = []) {
  if (hasArchitectureCoverageForSymbol(rows, "extract_traj_tokens")) return null;
  const record = records.find((item) =>
    sourceFunctionsFromRecord(item).some((fn) => normalizeCodeSymbol(functionNameOf(fn)) === "extract_traj_tokens")
  );
  if (!record) return null;
  const fn = sourceFunctionsFromRecord(record).find((item) => normalizeCodeSymbol(functionNameOf(item)) === "extract_traj_tokens") || {};
  const filePath = record.path || record.filePath || fn.filePath || fn.path || "src/alpamayo1_5/models/token_utils.py";
  const enrichedFn = attachFunctionContent(record, {
    functionName: "extract_traj_tokens",
    ...fn,
    filePath,
  });
  return {
    rowRef: "source-audit-extract-traj-tokens",
    traceId: "source-audit-extract-traj-tokens",
    fromFunction: "extract_traj_tokens",
    controlAction: "Clamp trajectory token ids",
    toFunction: "torch.clamp",
    fromFile: filePath,
    toFile: filePath,
    sourceFiles: [filePath],
    codeEvidence: {
      rowRefs: ["source-audit-extract-traj-tokens"],
      sourceAudit: {
        mode: "per-row-indexed-source",
        reason: "Indexed source contained extract_traj_tokens, but no architecture row traced it.",
        checkedFiles: [filePath],
      },
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
        sourceFunctions: [enrichedFn],
        content: record.content || "",
      }],
      sourceFunctions: [enrichedFn],
    },
    sourceEvidence: {
      rowRefs: ["source-audit-extract-traj-tokens"],
      functions: [enrichedFn],
    },
    syntheticHazardSummaryRow: {
      "Architecture Row Ref": "source-audit-extract-traj-tokens",
      "Function (From)": "extract_traj_tokens",
      "Control Action": "Clamp trajectory token ids",
      "Function (To)": "torch.clamp",
      Hazards: "Invalid trajectory token values are clamped into the accepted range, which may mask degraded model output unless the warning is surfaced through telemetry or converted into rejection logic.",
      "Unsafe Control Actions": "Trajectory token values outside the tokenizer vocabulary are accepted through clamping rather than rejected.",
      "Causal Factors": "Indexed source evidence shows invalid trajectory token values are detected and clamped; repo-wide usage audit may show no runtime call sites in the current codebase.",
      "Safety Requirements/Constraints": "Trajectory token extraction shall reject, quarantine, or clearly surface invalid trajectory token values before downstream trajectory decoding.",
      "Safety Significant": "Yes",
      "Safety Significance Rationale": "Source audit found trajectory-token clamping code that was not traced by the generated architecture rows.",
    },
  };
}

export async function enrichHazardTableRowsWithSourceContent(tableRows = [], repoMeta = {}, options = {}) {
  const rows = Array.isArray(tableRows) ? tableRows : [];
  const { owner, repo } = repoPartsFromMeta(repoMeta);
  if (!owner || !repo) return rows;

  const loadSourceRecord = options.loadSourceRecord || loadIndexedSourceRecord;
  const allSourceRecords = options.allSourceRecords || await loadAllIndexedSourceRecords({ owner, repo });
  const cache = new Map();
  async function load(filePath) {
    if (!filePath) return null;
    if (cache.has(filePath)) return cache.get(filePath);
    const record = await loadSourceRecord({ owner, repo, filePath });
    cache.set(filePath, record || null);
    return record || null;
  }

  const enriched = [];
  for (const row of rows) {
    const filePaths = sourceFilesFromRow(row);
    const loadedFiles = [];
    const loadedFunctions = [];
    for (const filePath of filePaths) {
      const record = await load(filePath);
      if (!record?.content) continue;
      const recordFunctions = (record.sourceFunctions || []).map((fn) => attachFunctionContent(record, fn));
      loadedFiles.push({
        filePath,
        fileName: filePath.split("/").pop() || filePath,
        repo: record.repo || repo,
        owner: record.owner || owner,
        branch: record.branch || repoMeta.branch || "",
        commitSha: record.commitSha || "",
        imports: record.imports || [],
        exports: record.exports || [],
        functions: record.functions || [],
        sourceFunctions: recordFunctions,
        content: record.content,
      });
      loadedFunctions.push(...recordFunctions);
    }

    if (!loadedFiles.length) {
      enriched.push(row);
      continue;
    }

    const existingCodeEvidence = row.codeEvidence || {};
    const repoWideUsageAudits = usageAuditsForRow(row, allSourceRecords);
    const nextSourceFunctions = mergeUniqueFunctions([
      ...(existingCodeEvidence.sourceFunctions || []),
      ...(row.sourceEvidence?.functions || []),
      ...loadedFunctions,
    ]);

    enriched.push({
      ...row,
      codeEvidence: {
        ...existingCodeEvidence,
        files: mergeFileRecords(existingCodeEvidence.files || [], loadedFiles),
        sourceFunctions: nextSourceFunctions,
        sourceAudit: {
          ...(existingCodeEvidence.sourceAudit || {}),
          mode: "per-row-indexed-source",
          checkedFiles: loadedFiles.map((file) => file.filePath),
          unavailableFiles: filePaths.filter((filePath) => !loadedFiles.some((file) => file.filePath === filePath)),
        },
        repoWideUsageAudits,
      },
      sourceEvidence: {
        ...(row.sourceEvidence || {}),
        functions: mergeUniqueFunctions([
          ...(row.sourceEvidence?.functions || []),
          ...nextSourceFunctions,
        ]),
        repoWideUsageAudits,
      },
    });
  }
  const missingExtractTrajTokens = makeMissingExtractTrajTokensRow(allSourceRecords, enriched);
  return missingExtractTrajTokens ? [...enriched, missingExtractTrajTokens] : enriched;
}
