import {
  CODE_ARCHITECTURE_HAZARD_REVIEW_STATUSES,
  CODE_ARCHITECTURE_HAZARD_SOURCE_TYPE,
} from "./codeArchitectureHazardTypes";

export function makeCodeArchitectureHazardId(prefix = "cba-hazard") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeCodeArchitectureTraceId(prefix = "cba-trace") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeFunctionIdentity(value) {
  return normalizeText(value).toLowerCase();
}

function functionIdentityKey(row = {}, side = "from") {
  const functionName = side === "to"
    ? (row.to ?? row.toFunction ?? "")
    : (row.from ?? row.fromFunction ?? "");
  const fileName = side === "to"
    ? (row.toFile ?? "")
    : (row.fromFile ?? "");
  return [
    normalizeFunctionIdentity(functionName),
    normalizeText(fileName).toLowerCase(),
  ].filter(Boolean).join("|") || makeCodeArchitectureTraceId("cba-node-key");
}

export function ensureCodeArchitectureTraceIds(rows = []) {
  const nodeIdsByIdentity = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row = {}) => {
    if (row.fromNodeId) nodeIdsByIdentity.set(functionIdentityKey(row, "from"), row.fromNodeId);
    if (row.toNodeId) nodeIdsByIdentity.set(functionIdentityKey(row, "to"), row.toNodeId);
  });

  return (Array.isArray(rows) ? rows : []).map((row = {}, index) => {
    const fromKey = functionIdentityKey(row, "from");
    const toKey = functionIdentityKey(row, "to");
    const fromNodeId = row.fromNodeId || nodeIdsByIdentity.get(fromKey) || makeCodeArchitectureTraceId("cba-node");
    const toNodeId = row.toNodeId || nodeIdsByIdentity.get(toKey) || makeCodeArchitectureTraceId("cba-node");
    nodeIdsByIdentity.set(fromKey, fromNodeId);
    nodeIdsByIdentity.set(toKey, toNodeId);

    const traceId = row.traceId || makeCodeArchitectureTraceId("cba-trace");
    return {
      ...row,
      rowRef: row.rowRef || index + 1,
      traceId,
      fromNodeId,
      toNodeId,
      edgeId: row.edgeId || makeCodeArchitectureTraceId("cba-edge"),
    };
  });
}

export function normalizeRepoId(repoMeta = {}) {
  return repoMeta.repoId || repoMeta.repoName || [repoMeta.owner, repoMeta.repo].filter(Boolean).join("/") || "";
}

export const CODE_ARCHITECTURE_TRACEABILITY_COLUMNS = [
  "Trace ID",
  "From Node ID",
  "Control Edge ID",
  "To Node ID",
  "Architecture Row Ref",
  "Architecture Element ID",
  "Function (From) Related File(s)",
  "Function (To) Related File(s)",
  "Related Source File(s)",
  "Source Symbols",
  "Source Line Ranges",
  "Subsystem",
  "CSCI",
  "CSC",
  "CSU",
];

function normalizeText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}

export function isMarkdownSourcePath(value) {
  const normalized = normalizeText(value).replace(/\\/g, "/");
  if (!normalized) return false;
  const baseName = normalized.split("/").filter(Boolean).pop() || normalized;
  return /\.md$/i.test(baseName);
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return normalizeText(value)
    .split(/\s*[,;]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value == null ? "" : value;
}

export function computeArchitectureSnapshotHash(cbaRows = []) {
  const compactRows = (Array.isArray(cbaRows) ? cbaRows : []).map((row, index) => ({
    rowRef: row?.rowRef || index + 1,
    from: row?.from || "",
    action: row?.action || "",
    to: row?.to || "",
    fromFile: row?.fromFile || "",
    toFile: row?.toFile || "",
    architecture: row?.architecture || null,
    codeEvidence: row?.codeEvidence || null,
    sourceEvidence: row?.sourceEvidence || null,
  }));
  const text = JSON.stringify(stableValue(compactRows));
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `cba-${compactRows.length}-${Math.abs(hash).toString(36)}`;
}

function sourceSymbolsFromRow(row = {}) {
  return sourceFunctionsFromArchitectureRow(row)
    .map((fn) => fn.functionName || fn.symbolName || fn.name)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function rawSourceFunctionsFromArchitectureRow(row = {}) {
  return [
    ...(row.sourceEvidence?.functions || []),
    ...(row.codeEvidence?.sourceFunctions || []),
    ...((row.codeEvidence?.files || []).flatMap((file) => file.sourceFunctions || [])),
  ].filter(Boolean);
}

function sourcePathFromFunction(fn = {}) {
  return fn.filePath || fn.path || fn.fileName || "";
}

function sourceFunctionsFromArchitectureRow(row = {}) {
  return rawSourceFunctionsFromArchitectureRow(row)
    .filter((fn) => !isMarkdownSourcePath(sourcePathFromFunction(fn)));
}

function uniqueList(values = []) {
  return values.map(normalizeText).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index);
}

function sourceLineRangesFromFunctions(functions = []) {
  return uniqueList((functions || []).map((fn) => {
    const filePath = fn.filePath || fn.path || "";
    const startLine = fn.startLine || fn.lineStart || "";
    const endLine = fn.endLine || fn.lineEnd || "";
    if (!filePath && !startLine) return "";
    const range = startLine ? `${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ""}` : "";
    return [filePath, range].filter(Boolean).join(":");
  }));
}

export function buildAffectedCodeRefsFromTraceability(trace = {}, repoMeta = {}) {
  const sourceFiles = splitList(trace.sourceFiles || trace.relatedSourceFiles).filter((filePath) => !isMarkdownSourcePath(filePath));
  const sourceSymbols = splitList(trace.sourceSymbols);
  const sourceLineRanges = splitList(trace.sourceLineRanges).filter((range) => {
    const match = String(range).match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    return !isMarkdownSourcePath(match?.[1] || range);
  });
  const repoId = repoMeta.repoId || repoMeta.repoName || trace.repoId || "";
  const repoName = repoMeta.repoName || repoId;
  const refs = [];

  sourceLineRanges.forEach((range, index) => {
    const match = String(range).match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    const filePath = match?.[1] || sourceFiles[index] || "";
    if (!filePath) return;
    refs.push({
      repoId,
      repoName,
      repoPath: repoMeta.repoPath || "",
      repoUrl: repoMeta.repoUrl || "",
      branch: repoMeta.branch || trace.branch || "",
      filePath,
      symbolName: sourceSymbols[index] || "",
      symbolType: sourceSymbols[index] ? "function" : "file",
      startLine: match?.[2] ? Number(match[2]) : null,
      endLine: match?.[3] ? Number(match[3]) : (match?.[2] ? Number(match[2]) : null),
      commitSha: trace.commitSha || "",
      architectureNodeId: trace.architectureElementId || "",
      confidence: match?.[2] ? 0.82 : 0.55,
      rationale: "Derived from hazard-analysis row traceability.",
    });
  });

  sourceFiles.forEach((filePath) => {
    if (!filePath || refs.some((ref) => ref.filePath === filePath)) return;
    refs.push({
      repoId,
      repoName,
      repoPath: repoMeta.repoPath || "",
      repoUrl: repoMeta.repoUrl || "",
      branch: repoMeta.branch || trace.branch || "",
      filePath,
      symbolName: "",
      symbolType: "file",
      startLine: null,
      endLine: null,
      commitSha: trace.commitSha || "",
      architectureNodeId: trace.architectureElementId || "",
      confidence: 0.45,
      rationale: "Derived from hazard-analysis row source file traceability.",
    });
  });

  return refs.slice(0, 12);
}

export function buildTraceabilityForArchitectureRow(row = {}, index = 0, repoMeta = {}) {
  const rowRef = row?.rowRef || index + 1;
  const functions = sourceFunctionsFromArchitectureRow(row);
  const sourceFiles = uniqueList([
    row?.fromFile,
    row?.toFile,
    ...functions.map((fn) => fn.filePath || fn.path),
    ...((row.codeEvidence?.files || []).map((file) => (typeof file === "string" ? file : file.filePath || file.path))),
    ...((row.sourceEvidence?.files || []).map((file) => (typeof file === "string" ? file : file.filePath || file.path))),
  ].filter((filePath) => !isMarkdownSourcePath(filePath)));
  const trace = {
    traceId: row?.traceId || "",
    fromNodeId: row?.fromNodeId || "",
    edgeId: row?.edgeId || "",
    toNodeId: row?.toNodeId || "",
    architectureRowRef: rowRef,
    architectureElementId: architectureElementIdForRow(row, index),
    functionFrom: row?.from || "",
    controlAction: row?.action || "",
    functionTo: row?.to || "",
    fromFile: row?.fromFile || "",
    toFile: row?.toFile || "",
    sourceFiles,
    sourceSymbols: sourceSymbolsFromRow(row),
    sourceLineRanges: sourceLineRangesFromFunctions(functions),
    subsystem: row?.architecture?.subsystem || "Application Subsystem",
    csci: row?.architecture?.csci || "",
    csc: row?.architecture?.csc || "",
    csu: row?.architecture?.csu || "",
    repoId: normalizeRepoId(repoMeta),
    branch: repoMeta.branch || "",
  };
  return {
    ...trace,
    affectedCodeRefs: buildAffectedCodeRefsFromTraceability(trace, repoMeta),
  };
}

export function traceabilityToSheetCells(trace = {}) {
  return [
    trace.traceId || "",
    trace.fromNodeId || "",
    trace.edgeId || "",
    trace.toNodeId || "",
    trace.architectureRowRef || "",
    trace.architectureElementId || "",
    trace.fromFile || "",
    trace.toFile || "",
    normalizeText(trace.sourceFiles),
    normalizeText(trace.sourceSymbols),
    normalizeText(trace.sourceLineRanges),
    trace.subsystem || "Application Subsystem",
    trace.csci || "",
    trace.csc || "",
    trace.csu || "",
  ];
}

export function extractFunctionalDecompositionTrace(headers = [], row = [], repoMeta = {}) {
  const valueFor = (name) => {
    const index = headers.findIndex((header) => normalizeText(header).toLowerCase() === name.toLowerCase());
    return index >= 0 ? normalizeText(row[index]) : "";
  };
  const trace = {
    traceId: valueFor("Trace ID"),
    fromNodeId: valueFor("From Node ID"),
    edgeId: valueFor("Control Edge ID"),
    toNodeId: valueFor("To Node ID"),
    architectureRowRef: valueFor("Architecture Row Ref"),
    architectureElementId: valueFor("Architecture Element ID"),
    functionFrom: normalizeText(row[0]),
    controlAction: normalizeText(row[1]),
    functionTo: normalizeText(row[2]),
    fromFile: valueFor("Function (From) Related File(s)"),
    toFile: valueFor("Function (To) Related File(s)"),
    sourceFiles: splitList(valueFor("Related Source File(s)")),
    sourceSymbols: splitList(valueFor("Source Symbols")),
    sourceLineRanges: splitList(valueFor("Source Line Ranges")),
    subsystem: valueFor("Subsystem") || "Application Subsystem",
    csci: valueFor("CSCI"),
    csc: valueFor("CSC"),
    csu: valueFor("CSU"),
    repoId: normalizeRepoId(repoMeta),
    branch: repoMeta.branch || "",
  };
  if (!trace.sourceFiles.length) trace.sourceFiles = uniqueList([trace.fromFile, trace.toFile]);
  trace.sourceFiles = trace.sourceFiles.filter((filePath) => !isMarkdownSourcePath(filePath));
  trace.sourceLineRanges = trace.sourceLineRanges.filter((range) => {
    const match = String(range).match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    return !isMarkdownSourcePath(match?.[1] || range);
  });
  return {
    ...trace,
    affectedCodeRefs: buildAffectedCodeRefsFromTraceability(trace, repoMeta),
  };
}

export function traceColumnsFromSheetRow(headers = [], row = []) {
  return traceabilityToSheetCells(extractFunctionalDecompositionTrace(headers, row));
}

export function traceabilityObjectToSummaryFields(trace = {}) {
  return {
    "Trace ID": trace.traceId || "",
    "From Node ID": trace.fromNodeId || "",
    "Control Edge ID": trace.edgeId || "",
    "To Node ID": trace.toNodeId || "",
    "Architecture Row Ref": trace.architectureRowRef || "",
    "Architecture Element ID": trace.architectureElementId || "",
    "Function (From)": trace.functionFrom || "",
    "Control Action": trace.controlAction || "",
    "Function (To)": trace.functionTo || "",
    "Related Source File(s)": normalizeText(trace.sourceFiles),
    "Source Symbols": normalizeText(trace.sourceSymbols),
    "Source Line Ranges": normalizeText(trace.sourceLineRanges),
    Subsystem: trace.subsystem || "Application Subsystem",
    CSCI: trace.csci || "",
    CSC: trace.csc || "",
    CSU: trace.csu || "",
  };
}

export const HAZARD_SUMMARY_TRACEABILITY_COLUMNS = [
  "Trace ID",
  "From Node ID",
  "Control Edge ID",
  "To Node ID",
  "Architecture Row Ref",
  "Architecture Element ID",
  "Function (From)",
  "Control Action",
  "Function (To)",
  "Related Source File(s)",
  "Source Symbols",
  "Source Line Ranges",
  "Subsystem",
  "CSCI",
  "CSC",
  "CSU",
];

export function architectureElementIdForRow(row = {}, index = 0) {
  return `cba-row-${row.rowRef || index + 1}`;
}

function rowSourcePaths(row = {}) {
  return uniqueList([
    row?.fromFile,
    row?.toFile,
    ...(rawSourceFunctionsFromArchitectureRow(row).map(sourcePathFromFunction)),
    ...((row.codeEvidence?.files || []).map((file) => file.filePath || file.path || file.fileName)),
    ...((row.sourceEvidence?.files || []).map((file) => file.filePath || file.path || file.fileName)),
  ]);
}

function shouldIncludeArchitectureRowForHazardAnalysis(row = {}) {
  const directFiles = uniqueList([row?.fromFile, row?.toFile]);
  if (directFiles.some(isMarkdownSourcePath)) return false;

  const paths = rowSourcePaths(row);
  return paths.length === 0 || paths.some((filePath) => !isMarkdownSourcePath(filePath));
}

export function filterMarkdownRowsForHazardAnalysis(cbaRows = []) {
  return (Array.isArray(cbaRows) ? cbaRows : []).filter(shouldIncludeArchitectureRowForHazardAnalysis);
}

export function codeArchitectureRowsToHazardTableRows(cbaRows = [], repoMeta = {}) {
  const repoId = normalizeRepoId(repoMeta);
  return ensureCodeArchitectureTraceIds(filterMarkdownRowsForHazardAnalysis(cbaRows)).map((row, index) => {
    const rowRef = row?.rowRef || index + 1;
    const sourceFiles = [row?.fromFile, row?.toFile]
      .filter(Boolean)
      .filter((value, valueIndex, arr) => arr.indexOf(value) === valueIndex);
    const traceability = buildTraceabilityForArchitectureRow(row, index, repoMeta);
    return {
      id: architectureElementIdForRow(row, index),
      traceId: row.traceId || "",
      fromNodeId: row.fromNodeId || "",
      edgeId: row.edgeId || "",
      toNodeId: row.toNodeId || "",
      rowRef,
      fromFunction: row?.from || "",
      controlAction: row?.action || "",
      toFunction: row?.to || "",
      fromDetails: row?.fromDetails || "",
      controlDetails: row?.controlActionDetails || row?.controlDetails || "",
      toDetails: row?.toDetails || "",
      sourceFiles,
      repoId,
      repoName: repoMeta.repoName || repoId,
      repoUrl: repoMeta.repoUrl || "",
      repoPath: repoMeta.repoPath || "",
      branch: repoMeta.branch || "",
      fromFile: row?.fromFile || "",
      toFile: row?.toFile || "",
      architecture: row?.architecture || null,
      codeEvidence: row?.codeEvidence || null,
      sourceEvidence: row?.sourceEvidence || null,
      traceability,
      affectedCodeRefs: traceability.affectedCodeRefs || [],
      originalArchitectureRow: row,
    };
  });
}

export function buildCodeArchitectureTraceabilityMap(cbaRows = []) {
  return codeArchitectureRowsToHazardTableRows(cbaRows).map((row) => ({
    traceId: row.traceId,
    fromNodeId: row.fromNodeId,
    edgeId: row.edgeId,
    toNodeId: row.toNodeId,
    architectureRowRef: row.rowRef,
    architectureElementId: row.id,
    sourceFiles: row.sourceFiles || [],
    sourceSymbols: sourceSymbolsFromRow(row.originalArchitectureRow || {}),
    sourceLineRanges: row.traceability?.sourceLineRanges || [],
    affectedCodeRefs: row.affectedCodeRefs || [],
    codeEvidence: row.codeEvidence || null,
    sourceEvidence: row.sourceEvidence || null,
    subsystem: row.traceability?.subsystem || row.originalArchitectureRow?.architecture?.subsystem || "Application Subsystem",
  }));
}

export function buildCodeArchitectureHazardInput({ cbaRows = [], repoMeta = {}, projectId = "" } = {}) {
  const tableRows = codeArchitectureRowsToHazardTableRows(cbaRows, repoMeta);
  const functionalDecompositionSheet = [
    ["Function (From)", "Control Action", "Function (To)", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS],
    ...tableRows.map((row) => [
      row.fromFunction || "",
      row.controlAction || "",
      row.toFunction || "",
      ...traceabilityToSheetCells(row.traceability || {}),
    ]),
  ];
  const architectureRowsForHazardAnalysis = filterMarkdownRowsForHazardAnalysis(cbaRows);
  const architectureSnapshotHash = computeArchitectureSnapshotHash(architectureRowsForHazardAnalysis);
  return {
    projectId,
    repoId: normalizeRepoId(repoMeta),
    tableRows,
    sheets: { "Functional Decomposition": functionalDecompositionSheet },
    architectureSnapshotHash,
    architectureRowsSnapshot: tableRows,
    traceabilityMap: buildCodeArchitectureTraceabilityMap(cbaRows),
  };
}

export function summarySheetToHazardSummaryRows(summarySheet) {
  if (!Array.isArray(summarySheet) || !Array.isArray(summarySheet[0])) return [];
  const headers = summarySheet[0].map((header, index) => String(header || `Column ${index + 1}`));
  return summarySheet.slice(1).map((row, rowIndex) => {
    const get = (name) => {
      const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
      return index >= 0 ? normalizeText(Array.isArray(row) ? row[index] : "") : "";
    };
    const trace = {
      traceId: get("Trace ID"),
      fromNodeId: get("From Node ID"),
      edgeId: get("Control Edge ID"),
      toNodeId: get("To Node ID"),
      architectureRowRef: get("Architecture Row Ref"),
      architectureElementId: get("Architecture Element ID"),
      functionFrom: get("Function (From)"),
      controlAction: get("Control Action"),
      functionTo: get("Function (To)"),
      sourceFiles: splitList(get("Related Source File(s)")),
      sourceSymbols: splitList(get("Source Symbols")),
      sourceLineRanges: splitList(get("Source Line Ranges")),
      subsystem: get("Subsystem") || "Application Subsystem",
      csci: get("CSCI"),
      csc: get("CSC"),
      csu: get("CSU"),
    };
    const record = {
      id: `cba-hazard-row-${rowIndex + 1}`,
      rowIndex,
      row,
      architectureRowRef: trace.architectureRowRef,
      architectureElementId: trace.architectureElementId,
      traceId: trace.traceId,
      fromNodeId: trace.fromNodeId,
      edgeId: trace.edgeId,
      toNodeId: trace.toNodeId,
      sourceFiles: trace.sourceFiles,
      sourceSymbols: trace.sourceSymbols,
      sourceLineRanges: trace.sourceLineRanges,
      affectedCodeRefs: buildAffectedCodeRefsFromTraceability(trace),
      functionFrom: trace.functionFrom,
      controlAction: trace.controlAction,
      functionTo: trace.functionTo,
      subsystem: trace.subsystem,
      csci: trace.csci,
      csc: trace.csc,
      csu: trace.csu,
    };
    headers.forEach((header, index) => {
      record[header] = Array.isArray(row) ? row[index] : "";
    });
    return record;
  });
}

export function ensureHazardSummaryTraceColumns(generatedSheets = {}, tableRows = []) {
  const summary = generatedSheets?.Summary;
  if (!Array.isArray(summary) || !Array.isArray(summary[0])) return generatedSheets;

  const currentHeaders = summary[0].map((header, index) => String(header || `Column ${index + 1}`));
  const nextHeaders = [...currentHeaders];
  HAZARD_SUMMARY_TRACEABILITY_COLUMNS.forEach((column) => {
    if (!nextHeaders.some((header) => header.toLowerCase() === column.toLowerCase())) {
      nextHeaders.push(column);
    }
  });
  const headerIndex = (headerName) =>
    nextHeaders.findIndex((header) => header.toLowerCase() === String(headerName || "").toLowerCase());
  const originalHeaderIndex = (headerName) =>
    currentHeaders.findIndex((header) => header.toLowerCase() === String(headerName || "").toLowerCase());

  const rowsByRef = new Map();
  (Array.isArray(tableRows) ? tableRows : []).forEach((row, index) => {
    rowsByRef.set(String(row.rowRef || index + 1), row);
  });

  const nextRows = summary.slice(1).map((row, rowIndex) => {
    const nextRow = nextHeaders.map((header) => {
      const existingIndex = originalHeaderIndex(header);
      return existingIndex >= 0 ? row?.[existingIndex] ?? "" : "";
    });
    const rowRefIndex = headerIndex("Architecture Row Ref");
    const existingRowRef = rowRefIndex >= 0 ? normalizeText(nextRow[rowRefIndex]) : "";
    const sourceRow = rowsByRef.get(existingRowRef) || tableRows[rowIndex] || null;
    const traceFields = traceabilityObjectToSummaryFields(sourceRow?.traceability || {});
    HAZARD_SUMMARY_TRACEABILITY_COLUMNS.forEach((column) => {
      const index = headerIndex(column);
      if (index < 0) return;
      if (!normalizeText(nextRow[index]) || ["Trace ID", "From Node ID", "Control Edge ID", "To Node ID"].includes(column)) {
        nextRow[index] = traceFields[column] || nextRow[index] || "";
      }
    });
    return nextRow;
  });

  return {
    ...generatedSheets,
    Summary: [nextHeaders, ...nextRows],
  };
}

export function normalizeCodeArchitectureHazardRun(raw = {}, context = {}) {
  const now = new Date().toISOString();
  const repoId = raw.repoId || context.repoId || normalizeRepoId(context.repoMeta || {});
  const summaryRows = Array.isArray(raw.summaryRows)
    ? raw.summaryRows
    : summarySheetToHazardSummaryRows(raw.generatedSheets?.Summary || raw.analysisResult?.Summary);
  return {
    id: raw.id || makeCodeArchitectureHazardId(),
    projectId: raw.projectId || context.projectId || "",
    repoId,
    repoName: raw.repoName || context.repoMeta?.repoName || repoId,
    repoUrl: raw.repoUrl || context.repoMeta?.repoUrl || "",
    repoPath: raw.repoPath || context.repoMeta?.repoPath || "",
    branch: raw.branch || context.repoMeta?.branch || "",
    sourceType: CODE_ARCHITECTURE_HAZARD_SOURCE_TYPE,
    sourceRunId: raw.sourceRunId || raw.id || makeCodeArchitectureHazardId("cba-hazard-run"),
    architectureModelId: raw.architectureModelId || `${repoId || "repo"}:${raw.architectureSnapshotHash || context.architectureSnapshotHash || "architecture"}`,
    architectureSnapshotHash: raw.architectureSnapshotHash || context.architectureSnapshotHash || "",
    architectureRowsSnapshot: Array.isArray(raw.architectureRowsSnapshot) ? raw.architectureRowsSnapshot : [],
    traceabilityMap: Array.isArray(raw.traceabilityMap) ? raw.traceabilityMap : [],
    hazardMethod: raw.hazardMethod || context.hazardMethod || "STPA-Textbook",
    hazardGenerationMode: raw.hazardGenerationMode || context.hazardGenerationMode || raw.fhaGenerationMode || context.fhaGenerationMode || "",
    fhaGenerationMode: raw.fhaGenerationMode || context.fhaGenerationMode || "",
    generatedSheets: raw.generatedSheets || raw.analysisResult || {},
    summaryRows,
    reviewStatus: raw.reviewStatus || CODE_ARCHITECTURE_HAZARD_REVIEW_STATUSES.DRAFT_AI_GENERATED,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

export function isCodeArchitectureHazardAnalysisStale({ run, cbaRows }) {
  if (!run?.architectureSnapshotHash) return false;
  return run.architectureSnapshotHash !== computeArchitectureSnapshotHash(cbaRows || []);
}
