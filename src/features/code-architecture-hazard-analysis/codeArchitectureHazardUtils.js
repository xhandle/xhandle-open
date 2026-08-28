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

const PRIMITIVE_CALL_TARGET_PREFIXES = ["torch.", "np.", "numpy.", "einops.", "scipy.", "math."];

function normalizePrimitiveCallActionText(action = "", to = "") {
  const actionText = normalizeText(action);
  const toText = normalizeText(to);
  if (!actionText || !toText) return actionText;
  if (!PRIMITIVE_CALL_TARGET_PREFIXES.some((prefix) => toText.startsWith(prefix))) return actionText;
  if (!/^call\b/i.test(actionText)) return actionText;
  const quotedCall = /^call\s+`([^`]+)`$/i.exec(actionText);
  const plainCall = /^call\s+([A-Za-z_][A-Za-z0-9_.]*)$/i.exec(actionText);
  const namedTarget = quotedCall?.[1] || plainCall?.[1] || "";
  if (!namedTarget) return actionText;
  if (namedTarget === toText) return actionText;
  return `Call ${toText}`;
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
    controlAction: normalizePrimitiveCallActionText(row?.action || "", row?.to || ""),
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
    controlAction: normalizePrimitiveCallActionText(row[1], row[2]),
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

export const HAZARD_SUMMARY_EVIDENCE_COLUMNS = [
  "Proposed Safety Assessment",
  "Proposed Safety Assessment Rationale",
  "Evidence Classification",
  "Safety Concern Type",
  "Confidence",
  "Code Relationship Audit",
  "Repo-Wide Usage Audit",
  "Code Evidence",
  "Mitigation Evidence",
  "Assumptions",
  "Recommended Verification",
  "Recommended Mitigation",
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
      controlAction: normalizePrimitiveCallActionText(row?.action || "", row?.to || ""),
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
    operationalContext: String(repoMeta.operationalContext || "").trim(),
    analysisContext: repoMeta.analysisContext || { text: "", files: [] },
    contextSources: repoMeta.contextSources || null,
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

  const buildReviewedRow = (row, rowIndex) => {
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
  };

  const nextRows = summary.slice(1).map(buildReviewedRow);
  const existingRefs = new Set(nextRows.map((row) => {
    const index = headerIndex("Architecture Row Ref");
    return index >= 0 ? normalizeText(row[index]) : "";
  }).filter(Boolean));
  (Array.isArray(tableRows) ? tableRows : []).forEach((sourceRow) => {
    const rowRef = normalizeText(sourceRow?.rowRef);
    if (!rowRef || existingRefs.has(rowRef) || !sourceRow?.syntheticHazardSummaryRow) return;
    const syntheticRow = nextHeaders.map((header) => sourceRow.syntheticHazardSummaryRow[header] ?? "");
    nextRows.push(buildReviewedRow(syntheticRow, nextRows.length));
    existingRefs.add(rowRef);
  });

  return {
    ...generatedSheets,
    Summary: [nextHeaders, ...nextRows],
  };
}

function objectValuesForEvidence(value, seen = new Set()) {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap((item) => objectValuesForEvidence(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return [];
    seen.add(value);
    return Object.values(value).flatMap((item) => objectValuesForEvidence(item, seen));
  }
  return [];
}

function evidenceTextForSourceRow(sourceRow = {}) {
  return objectValuesForEvidence({
    fromFunction: sourceRow.fromFunction,
    controlAction: sourceRow.controlAction,
    toFunction: sourceRow.toFunction,
    fromFile: sourceRow.fromFile,
    toFile: sourceRow.toFile,
    sourceFiles: sourceRow.sourceFiles,
    traceability: sourceRow.traceability,
    codeEvidence: sourceRow.codeEvidence,
    sourceEvidence: sourceRow.sourceEvidence,
  }).join(" ").replace(/\s+/g, " ").trim();
}

function hasAny(text = "", patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function joinEvidence(values = []) {
  return uniqueList(values).join("; ");
}

function normalizeCodeSymbol(value = "") {
  return String(value || "")
    .split(".")
    .pop()
    .replace(/[^A-Za-z0-9_$]+/g, "")
    .toLowerCase();
}

function lineSlice(content = "", startLine, endLine) {
  const lines = String(content || "").split("\n");
  const start = Math.max(0, Number(startLine || 1) - 1);
  const end = Math.max(start + 1, Number(endLine || startLine || lines.length));
  return lines.slice(start, end).join("\n");
}

function findMatchingBraceIndex(source = "", openIndex = -1) {
  if (openIndex < 0 || source[openIndex] !== "{") return -1;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      const lineEnd = source.indexOf("\n", index + 2);
      index = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }
    if (ch === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findFunctionBodyInContent(content = "", symbol = "") {
  const source = String(content || "");
  const name = String(symbol || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!source || !name) return "";

  const lines = source.split("\n");
  const pyPattern = new RegExp(`^(\\s*)(?:async\\s+def|def|class)\\s+${name}\\s*(?:\\(|:)`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = pyPattern.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    let end = index + 1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) {
        end = cursor + 1;
        continue;
      }
      const nextIndent = line.match(/^\s*/)?.[0]?.length || 0;
      if (nextIndent <= indent && !line.trim().startsWith("#")) break;
      end = cursor + 1;
    }
    return lines.slice(index, end).join("\n");
  }

  const jsPattern = new RegExp(`(?:function\\s+${name}\\s*\\([^)]*\\)\\s*{|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z0-9_$]+)\\s*=>\\s*{|(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*{)`);
  const match = jsPattern.exec(source);
  if (match) {
    const openIndex = source.indexOf("{", match.index);
    const closeIndex = openIndex >= 0 ? findMatchingBraceIndex(source, openIndex) : -1;
    if (closeIndex >= 0) return source.slice(match.index, closeIndex + 1);
  }

  return "";
}

function sourceFilesFromRow(sourceRow = {}) {
  return [
    ...(sourceRow.codeEvidence?.files || []),
    ...(sourceRow.sourceEvidence?.files || []),
  ].filter(Boolean);
}

function sourceFunctionsForAudit(sourceRow = {}) {
  return rawSourceFunctionsFromArchitectureRow(sourceRow).filter((fn) => fn?.functionName);
}

function functionBodyFromEvidence(fn = {}, files = []) {
  const file = files.find((item) =>
    normalizeText(item?.filePath || item?.path) === normalizeText(fn.filePath || fn.path)
  );
  const content = file?.content || fn.content || "";
  if (!content) return "";
  const rangedBody = fn.startLine ? lineSlice(content, fn.startLine, fn.endLine) : "";
  if (rangedBody && bodyCallsSymbol(rangedBody, fn.functionName || fn.name || fn.symbolName)) return rangedBody;
  const recoveredBody = findFunctionBodyInContent(content, fn.functionName || fn.name || fn.symbolName);
  return recoveredBody || rangedBody;
}

function functionLooksAbstract(body = "") {
  const text = String(body || "").toLowerCase();
  if (!text.trim()) return false;
  return /@abstractmethod\b/.test(text) ||
    /\braise\s+notimplementederror\b/.test(text) ||
    /(^|\n)\s*(pass|\.{3})\s*(#.*)?($|\n)/.test(text);
}

function bodyCallsSymbol(body = "", symbol = "") {
  const name = normalizeCodeSymbol(symbol);
  if (!body || !name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const callPattern = new RegExp(`(?:^|[^A-Za-z0-9_$])(?:self\\.|this\\.|[A-Za-z0-9_$]+\\.)?${escaped}\\s*\\(`, "i");
  return callPattern.test(body);
}

function matchingFunctionsByName(functions = [], symbol = "") {
  const target = normalizeCodeSymbol(symbol);
  if (!target) return [];
  return functions.filter((fn) => normalizeCodeSymbol(fn.functionName || fn.name || fn.symbolName) === target);
}

function auditCodeRelationshipForRow(sourceRow = {}) {
  const fromName = sourceRow.fromFunction || sourceRow.from || "";
  const toName = sourceRow.toFunction || sourceRow.to || "";
  const fromSymbol = normalizeCodeSymbol(fromName);
  const toSymbol = normalizeCodeSymbol(toName);
  if (!fromSymbol || !toSymbol || fromSymbol === toSymbol) {
    return { status: "unavailable", label: "Code relationship audit unavailable: missing or identical endpoint symbols." };
  }

  const files = sourceFilesFromRow(sourceRow);
  const functions = sourceFunctionsForAudit(sourceRow);
  const fromFns = matchingFunctionsByName(functions, fromName);
  const toFns = matchingFunctionsByName(functions, toName);
  const bodies = functions.map((fn) => ({
    fn,
    body: functionBodyFromEvidence(fn, files),
  })).filter((item) => item.body);

  const direct = fromFns.find((fn) => bodyCallsSymbol(functionBodyFromEvidence(fn, files), toName));
  if (direct) {
    return {
      status: "direct",
      label: `Code relationship audit: direct call evidence found from ${fromName} to ${toName} in ${direct.filePath || "source evidence"}.`,
    };
  }

  const reverse = toFns.find((fn) => bodyCallsSymbol(functionBodyFromEvidence(fn, files), fromName));
  if (reverse) {
    return {
      status: "reverse",
      label: `Code relationship audit: reverse call evidence found; ${toName} calls ${fromName}, so the claimed edge direction is not supported.`,
    };
  }

  const commonCaller = bodies.find(({ fn, body }) => {
    const caller = normalizeCodeSymbol(fn.functionName || fn.name || fn.symbolName);
    if (caller === fromSymbol || caller === toSymbol) return false;
    return bodyCallsSymbol(body, fromName) && bodyCallsSymbol(body, toName);
  });
  if (commonCaller) {
    return {
      status: "common-caller",
      label: `Code relationship audit: ${fromName} and ${toName} appear as sibling calls under ${commonCaller.fn.functionName}; no direct edge was found.`,
    };
  }

  if (fromFns.length && toFns.length) {
    const endpointBodies = [...fromFns, ...toFns]
      .map((fn) => functionBodyFromEvidence(fn, files))
      .filter(Boolean);
    if (!endpointBodies.length) {
      return {
        status: "symbols-no-body",
        label: "Code relationship audit: endpoint symbols are present, but source bodies were not available for caller/callee verification.",
      };
    }
    const abstractFns = [...fromFns, ...toFns].filter((fn) => functionLooksAbstract(functionBodyFromEvidence(fn, files)));
    if (abstractFns.length) {
      return {
        status: "abstract-only",
        label: "Code relationship audit: endpoint symbols are present, but available bodies are abstract or placeholder implementations; edge direction is unverified.",
      };
    }
    return {
      status: "symbols-only",
      label: "Code relationship audit: endpoint symbols are present, but no direct caller/callee evidence was found in available indexed source.",
    };
  }

  if (files.some((file) => file?.content)) {
    return {
      status: "no-symbol-match",
      label: "Code relationship audit: indexed source content was available, but one or both endpoint symbols were not found.",
    };
  }

  return {
    status: "unavailable",
    label: "Code relationship audit unavailable: indexed source content was not available for this row.",
  };
}

function repoWideUsageAuditForRow(sourceRow = {}) {
  const audits = sourceRow.codeEvidence?.repoWideUsageAudits || sourceRow.sourceEvidence?.repoWideUsageAudits || [];
  const fromSymbol = normalizeCodeSymbol(sourceRow.fromFunction || sourceRow.from || "");
  const toSymbol = normalizeCodeSymbol(sourceRow.toFunction || sourceRow.to || "");
  const endpointSymbols = new Set([fromSymbol, toSymbol].filter(Boolean));
  const relevant = (Array.isArray(audits) ? audits : []).filter((audit) =>
    endpointSymbols.has(normalizeCodeSymbol(audit?.symbolName))
  );
  if (!relevant.length) {
    return { status: "unavailable", label: "Repo-wide usage audit unavailable for endpoint symbols." };
  }
  const unusedValidator = relevant.find((audit) =>
    audit?.kind === "validator" &&
    Number(audit.callSiteCount || 0) === 0 &&
    Number(audit.definitionCount || 0) > 0
  );
  if (unusedValidator) {
    return {
      status: "unused-validator",
      symbolName: unusedValidator.symbolName,
      label: `Repo-wide usage audit: ${unusedValidator.symbolName} is defined ${unusedValidator.definitionCount} time${unusedValidator.definitionCount === 1 ? "" : "s"} and has zero call sites in indexed source.`,
    };
  }
  return {
    status: "used-or-not-validator",
    label: relevant.map((audit) =>
      `Repo-wide usage audit: ${audit.symbolName} definitions=${audit.definitionCount || 0}, call sites=${audit.callSiteCount || 0}.`
    ).join(" "),
  };
}

function hasNavigationFreshnessEvidence(text = "") {
  return hasAny(text, [/\bnav_utils\.py\b/i, /\bcompare_nav_conditions\b/i, /\bget_nav_token_span\b/i, /\bremove_nav_text\b/i]) ||
    (/\bnavigation conditions?\b/i.test(text) && hasAny(text, [/\bfresh(?:ness)?\b/i, /\bstale\b/i, /\btimestamp\b/i, /\broute\b/i]));
}

function hasExplicitRelationshipEvidence(evidenceText = "") {
  return hasAny(evidenceText, [
    /\brelationship(?:Type| type)?\s*[:=]?\s*(?:direct[_\s-]?call|calls?|caller[_\s-]?callee|invocation)\b/i,
    /\b(?:direct[_\s-]?call|caller[_\s-]?callee|invocation)\b/i,
    /\bast[_\s-]?(?:verified|confirmed)\b/i,
  ]);
}

function hasTokenClampEvidence(text = "") {
  return hasAny(text, [
    /\bextract_traj_tokens\b/i,
    /\btrajectory token/i,
    /\btraj(?:ectory)?[_\s-]?tokens?\b/i,
    /\btoken_values\b/i,
  ]) && /\bclamp\b/i.test(text);
}

function hasTokenClampEndpointEvidence(sourceRow = {}, rowObject = {}) {
  const fromSymbol = normalizeCodeSymbol(sourceRow.fromFunction || sourceRow.from || rowObject["Function (From)"]);
  const toSymbol = normalizeCodeSymbol(sourceRow.toFunction || sourceRow.to || rowObject["Function (To)"]);
  const rowRef = normalizeCodeSymbol(sourceRow.rowRef || rowObject["Architecture Row Ref"]);
  const isExtractTrajAudit = rowRef.includes("sourceauditextracttrajtokens");
  return (fromSymbol === "extract_traj_tokens" || isExtractTrajAudit) &&
    (toSymbol === "torchclamp" || toSymbol === "clamp" || isExtractTrajAudit);
}

function hasActionBoundsEvidence(text = "") {
  return hasAny(text, [
    /\bis_within_bounds\b/i,
    /\baction_space(?:\.py|\/)/i,
    /\bunicycle_accel_curvature\.py\b/i,
    /\baction_to_traj\b/i,
    /\btraj_to_action\b/i,
  ]) && hasAny(text, [
    /\baction\b/i,
    /\bbounds?\b/i,
    /\bcurvature\b/i,
    /\baccel(?:eration)?\b/i,
    /\bsampled actions?\b/i,
  ]);
}

function hasFrameTransformEvidence(text = "") {
  return hasAny(text, [
    /\brot_?3d_?to_?2d\b/i,
    /\brot_?2d_?to_?3d\b/i,
    /\bget_yaw_rotation_matrices\b/i,
    /\brotation\b/i,
    /\byaw\b/i,
    /\blocal frame\b/i,
    /\bcoordinate\b/i,
    /\bspatial\b/i,
  ]);
}

const SAFEGUARD_PATTERNS = [
  { key: "bounds", label: "bounds check", patterns: [/\bis_within_bounds\b/i, /\bbounds?\b/i, /\bclamp\b/i] },
  { key: "finite", label: "finite/NaN check", patterns: [/\bisfinite\b/i, /\bnotnan\b/i, /\bnan\b/i, /\binf\b/i] },
  { key: "timestamp", label: "timestamp/freshness check", patterns: [/\btimestamp\b/i, /\bfresh(?:ness)?\b/i, /\bstale\b/i, /\bt0_us\b/i] },
  { key: "shape", label: "shape/range validation", patterns: [/\bassert\b/i, /\braise\s+ValueError\b/i, /\bshape\b/i, /\bndim\b/i, /\brange\b/i] },
  { key: "fallback", label: "fallback/retry behavior", patterns: [/\bfallback\b/i, /\bretry\b/i, /\bresample\b/i, /\breject\b/i] },
  { key: "telemetry", label: "logging/telemetry", patterns: [/\blogger\./i, /\bconsole\./i, /\bwarning\b/i, /\btelemetry\b/i] },
];

function detectSafeguards(evidenceText = "") {
  const found = [];
  SAFEGUARD_PATTERNS.forEach((item) => {
    if (hasAny(evidenceText, item.patterns)) found.push(item.label);
  });
  return found;
}

function safetyConcernTypeForHazard(hazardText = "", evidenceText = "") {
  const text = `${hazardText} ${evidenceText}`;
  if (hasAny(text, [/\bcollision\b/i, /\bnavigation\b/i, /\boff[-\s]?course\b/i, /\bloss of control\b/i, /\btrajectory\b/i, /\baction[_\s-]?to[_\s-]?traj\b/i, /\btraj[_\s-]?to[_\s-]?action\b/i, /\baction space\b/i, /\bcurvature\b/i, /\baccel(?:eration)?\b/i, /\byaw\b/i, /\brotation\b/i, /\blocal frame\b/i, /\bcoordinate\b/i, /\bspatial\b/i])) return "Safety-critical";
  if (hasAny(text, [/\boperator\b/i, /\bvisuali[sz]ation\b/i, /\bplot\b/i, /\bdisplay\b/i, /\breadable\b/i])) return "Usability/operator awareness";
  if (hasAny(text, [/\bconfiguration\b/i, /\binitiali[sz]ation\b/i, /\binitiali[sz]e\b/i, /\bmodel initialization\b/i])) return "Mission/reliability";
  if (hasAny(text, [/\btoken\b/i, /\bmessage\b/i, /\bdata\b/i, /\bformat\b/i, /\bprocessor\b/i, /\btemplate\b/i])) return "Data integrity";
  if (hasAny(text, [/\bmission\b/i, /\breliability\b/i, /\bperformance\b/i, /\binitiali[sz]e\b/i, /\bconfiguration\b/i, /\bmodel\b/i, /\bdevice\b/i])) return "Mission/reliability";
  return "Low safety relevance";
}

function proposedSafetyAssessmentForEvidence(evidenceClassification = "", concernType = "") {
  if (evidenceClassification === "Code-supported independent finding") return "Safety";
  if (concernType !== "Safety-critical") return "Mission/Reliability";
  if ([
    "Contradicted by code relationship",
    "Generic/low confidence",
    "Symbol-supported, edge unverified",
  ].includes(evidenceClassification)) {
    return "Mission/Reliability";
  }
  return "Safety";
}

function isGenericHazardText(hazardText = "") {
  const text = normalizeText(hazardText);
  if (!text) return true;
  const genericTerms = [
    /\bincorrect (?:data|output|input|parameters?|configuration|processing)\b/i,
    /\b(?:configuration|data) (?:data )?(?:stored|handled|processed) improperly\b/i,
    /\bstor(?:e|ing) configuration data improperly\b/i,
    /\bstored incorrectly\b/i,
    /\bimproper initiali[sz]ation\b/i,
    /\bincorrect model initiali[sz]ation\b/i,
    /\bincorrect reasoning outputs?\b/i,
    /\bmalformed data\b/i,
    /\bdownstream systems?\b/i,
    /\bsystem failure\b/i,
    /\bsystem instability\b/i,
    /\bdegraded performance\b/i,
    /\bcommunication (?:errors?|failures?)\b/i,
    /\binvalid messages?\b/i,
    /\bfail(?:s|ure)? to process\b/i,
  ];
  const concreteTerms = [
    /\bcollision\b/i,
    /\boff[-\s]?course\b/i,
    /\btrajectory\b/i,
    /\bcurvature\b/i,
    /\baccel(?:eration)?\b/i,
    /\byaw\b/i,
    /\broute\b/i,
    /\btimestamp\b/i,
    /\blocal frame\b/i,
    /\bcoordinate\b/i,
    /\bspatial\b/i,
    /\boperator\b/i,
  ];
  return hasAny(text, genericTerms) && !hasAny(text, concreteTerms);
}

function rewriteHazardWithEvidence(hazardText = "", sourceRow = {}, evidenceText = "", options = {}) {
  const text = normalizeText(hazardText);
  const context = `${text} ${evidenceText}`;
  if (options.tokenClampEndpoint && hasAny(context, [/\btokens?\b/i, /\bindex\b/i, /\bindices\b/i]) && /\bclamp\b/i.test(evidenceText)) {
    return "Invalid trajectory token values are clamped into the accepted range, which may mask degraded model output unless the warning is surfaced through telemetry or converted into rejection logic.";
  }
  if (hasAny(context, [/\baction_to_traj\b/i, /\btrajectory\b/i, /\bcurvature\b/i, /\baccel(?:eration)?\b/i]) && /\bis_within_bounds\b/i.test(evidenceText)) {
    return "Sampled actions may be converted into predicted trajectories without evidence that available acceleration and curvature bounds are enforced on the sampled output path.";
  }
  if (hasAny(context, [/\bnav_text\b/i, /\bcompare_nav_conditions\b/i, /\broute\b/i]) && !hasAny(evidenceText, [/\bfresh(?:ness)?\b/i, /\bstale\b/i, /\btimestamp\b/i])) {
    return "Navigation-conditioned inference accepts route text for trajectory sampling without evidence that the route context is fresh, synchronized, or semantically consistent with the current clip.";
  }
  if (isGenericHazardText(text) && sourceRow?.fromFunction) {
    return `${text} Evidence review found this row is better treated as a ${safetyConcernTypeForHazard(text, evidenceText).toLowerCase()} concern unless the architecture context shows a direct safety-control path.`;
  }
  return text;
}

function overAppliedTokenClampHazardText(rowObject = {}, sourceRow = {}) {
  const from = normalizeText(rowObject["Function (From)"] || sourceRow.fromFunction || sourceRow.from || "the source function");
  const action = normalizeText(rowObject["Control Action"] || sourceRow.controlAction || "the generated control action");
  const to = normalizeText(rowObject["Function (To)"] || sourceRow.toFunction || sourceRow.to || "the target function");
  return `Needs review: the ${from} -> ${to} row describes "${action}", but trajectory-token clamping evidence is only directly tied to the extract_traj_tokens -> torch.clamp endpoint.`;
}

function recommendedVerificationFor(type = "", evidenceText = "", options = {}) {
  if (options.tokenClampEndpoint) {
    return "Add token contract tests for missing, malformed, out-of-range, clamped, and wrong-length trajectory token sequences.";
  }
  if (type === "Safety-critical" && hasNavigationFreshnessEvidence(evidenceText)) {
    return "Add scenario tests for stale, missing, contradictory, and direction-swapped navigation text before trajectory sampling.";
  }
  if (type === "Safety-critical" && hasActionBoundsEvidence(evidenceText)) {
    return "Add tests that inject out-of-bounds, NaN, and discontinuous sampled actions and verify rejection, resampling, or safe degradation before trajectory return.";
  }
  if (type === "Safety-critical" && hasFrameTransformEvidence(evidenceText)) {
    return "Add numerical tests for coordinate-frame transforms, yaw wrapping, degenerate rotations, finite outputs, and expected frame conventions.";
  }
  if (type === "Data integrity") {
    return "Add contract tests for malformed, missing, out-of-range, and clamped data values and assert visible warnings or rejection behavior.";
  }
  if (type === "Usability/operator awareness") {
    return "Add golden-image or data-overlay tests that verify displayed trajectories, axes, and labels match source trajectory data.";
  }
  return "Add focused unit or integration tests around the referenced function edge and verify the generated safety constraint is enforced.";
}

function recommendedMitigationFor(type = "", evidenceText = "", options = {}) {
  if (options.tokenClampEndpoint) {
    return "Reject or quarantine invalid trajectory token sequences instead of silently accepting values that require clamping or shape repair.";
  }
  if (type === "Safety-critical" && hasNavigationFreshnessEvidence(evidenceText)) {
    return "Validate navigation freshness, route-token presence, timestamp alignment, and semantic consistency before conditioned inference.";
  }
  if (type === "Safety-critical" && hasActionBoundsEvidence(evidenceText)) {
    return "Enforce a final safety envelope on sampled actions and returned trajectories; reject, resample, or mark unsafe outputs before consumers can use them.";
  }
  if (type === "Safety-critical" && hasFrameTransformEvidence(evidenceText)) {
    return "Add explicit frame-convention validation and finite-output checks before transformed pose, yaw, or rotation values are consumed by trajectory planning.";
  }
  if (type === "Data integrity" && /\bclamp\b/i.test(evidenceText)) {
    return "Promote silent clamping or warning-only handling into structured telemetry and rejection thresholds for safety-relevant outputs.";
  }
  if (type === "Data integrity") {
    return "Add explicit input/output schema validation at the boundary and fail closed when required fields or shapes are invalid.";
  }
  if (type === "Usability/operator awareness") {
    return "Display provenance, scale, and validity markers for operator-facing trajectory or camera visualizations.";
  }
  return "Document the assumption and add the narrowest runtime guard or review gate needed to prevent unsupported propagation.";
}

function evaluateHazardEvidence({ rowObject = {}, sourceRow = {} } = {}) {
  const hazardText = normalizeText(rowObject.Hazards || rowObject.Hazard || rowObject.hazard || rowObject.Effect || "");
  const ucaText = normalizeText(rowObject["Unsafe Control Actions"] || rowObject["Functional Degradation/Loss"] || rowObject.Malfunction || "");
  const requirementText = normalizeText(rowObject["Safety Requirements/Constraints"] || rowObject["Safety Requirement"] || rowObject.safetyRequirement || "");
  const evidenceText = evidenceTextForSourceRow(sourceRow);
  const reviewText = `${hazardText} ${ucaText} ${requirementText}`;
  const combinedText = `${reviewText} ${evidenceText}`;
  const safeguards = detectSafeguards(evidenceText);
  const concernType = safetyConcernTypeForHazard(reviewText, evidenceText);
  const relationshipAudit = auditCodeRelationshipForRow(sourceRow);
  const usageAudit = repoWideUsageAuditForRow(sourceRow);
  const tokenClampEndpoint = hasTokenClampEndpointEvidence(sourceRow, rowObject);
  const hasClampTheme = hasTokenClampEvidence(combinedText);
  const overAppliedTokenClampTheme = hasClampTheme && !tokenClampEndpoint;
  const rewrittenHazard = rewriteHazardWithEvidence(hazardText, sourceRow, evidenceText, { tokenClampEndpoint });
  const reviewedHazard = overAppliedTokenClampTheme
    ? overAppliedTokenClampHazardText(rowObject, sourceRow)
    : rewrittenHazard;

  let evidenceClassification = "Plausible but not evidenced";
  let confidence = "Medium";
  const codeEvidence = [];
  const mitigationEvidence = [];
  const assumptions = [];

  if (!evidenceText) {
    evidenceClassification = "Generic/low confidence";
    confidence = "Low";
    assumptions.push("No source evidence was available in the architecture row.");
  } else {
    codeEvidence.push("Referenced code evidence includes source files, symbols, or line ranges for this architecture row.");
  }

  if (isGenericHazardText(reviewText)) {
    evidenceClassification = "Generic/low confidence";
    confidence = "Low";
    assumptions.push("Generated hazard wording is generic and does not establish a concrete safety-control path.");
  }

  if (overAppliedTokenClampTheme) {
    evidenceClassification = "Generic/low confidence";
    confidence = "Low";
    assumptions.push("Trajectory-token clamping evidence was present in nearby source context but this row is not the extract_traj_tokens -> torch.clamp endpoint.");
  }

  if (safeguards.length) {
    mitigationEvidence.push(`Detected ${safeguards.join(", ")} evidence in the referenced code context.`);
  }

  if (relationshipAudit.status === "reverse" || relationshipAudit.status === "common-caller") {
    evidenceClassification = "Contradicted by code relationship";
    confidence = "Low";
    codeEvidence.push(relationshipAudit.label);
    assumptions.push("The generated architecture edge should be reviewed or corrected before this hazard row is treated as safety-significant.");
  } else if (["abstract-only", "symbols-no-body", "symbols-only", "no-symbol-match"].includes(relationshipAudit.status)) {
    if (evidenceClassification !== "Generic/low confidence") {
      evidenceClassification = "Symbol-supported, edge unverified";
      confidence = "Medium";
    }
    codeEvidence.push(relationshipAudit.label);
  } else if (relationshipAudit.status === "direct") {
    codeEvidence.push(relationshipAudit.label);
  } else if (relationshipAudit.status === "unavailable") {
    assumptions.push(relationshipAudit.label);
  }

  if (usageAudit.status === "unused-validator") {
    evidenceClassification = "Code-supported independent finding";
    confidence = "High";
    codeEvidence.push(usageAudit.label);
    mitigationEvidence.push("Independent repo-wide usage evidence supports an unused safety validator finding even if the pairwise architecture edge needs review.");
  } else if (usageAudit.status !== "unavailable") {
    codeEvidence.push(usageAudit.label);
  }

  if (
    !["Contradicted by code relationship", "Code-supported independent finding"].includes(evidenceClassification) &&
    tokenClampEndpoint &&
    hasClampTheme
  ) {
    evidenceClassification = "Contradicted or mitigated by code";
    confidence = "Medium";
    codeEvidence.push("Token handling evidence includes clamping of out-of-range values.");
    mitigationEvidence.push("Clamping mitigates raw invalid-token propagation, but warning-only behavior may still mask degradation.");
  }

  if (
    !["Contradicted by code relationship", "Code-supported independent finding"].includes(evidenceClassification) &&
    hasActionBoundsEvidence(combinedText) &&
    /\bis_within_bounds\b/i.test(evidenceText)
  ) {
    const hasVerifiedRelationship = relationshipAudit.status === "direct" || hasExplicitRelationshipEvidence(evidenceText);
    evidenceClassification = hasVerifiedRelationship ? "Code-supported" : "Symbol-supported, edge unverified";
    confidence = hasVerifiedRelationship ? "High" : "Medium";
    codeEvidence.push(hasVerifiedRelationship
      ? "The architecture evidence references action/trajectory conversion, an available bounds-checking mechanism, and explicit relationship evidence."
      : "The architecture evidence references relevant symbols and line ranges, but does not prove the claimed edge direction or caller/callee relationship.");
    if (!hasAny(evidenceText, [/\breject\b/i, /\bresample\b/i, /\bfilter\b/i])) {
      mitigationEvidence.push("No reject/resample/filter evidence was found in the available row context.");
    }
  }

  if (
    evidenceClassification !== "Contradicted or mitigated by code" &&
    evidenceClassification !== "Symbol-supported, edge unverified" &&
    evidenceClassification !== "Contradicted by code relationship" &&
    evidenceClassification !== "Code-supported independent finding" &&
    hasNavigationFreshnessEvidence(combinedText) &&
    !hasAny(evidenceText, [/\bfresh(?:ness)?\b/i, /\bstale\b/i])
  ) {
    evidenceClassification = confidence === "Low" ? evidenceClassification : "Plausible but not evidenced";
    assumptions.push("The row assumes navigation context freshness matters to downstream trajectory use.");
  }

  if (
    concernType === "Safety-critical" &&
    evidenceText &&
    evidenceClassification !== "Contradicted or mitigated by code" &&
    evidenceClassification !== "Generic/low confidence" &&
    evidenceClassification !== "Contradicted by code relationship" &&
    evidenceClassification !== "Code-supported independent finding"
  ) {
    confidence = evidenceClassification === "Code-supported" ? "High" : "Medium";
  }

  const safetySignificantOverride = evidenceClassification === "Code-supported independent finding"
    ? "Yes"
    : ([
      "Contradicted by code relationship",
      "Generic/low confidence",
      "Symbol-supported, edge unverified",
    ].includes(evidenceClassification) ? "Needs Review" : "");
  const safetySignificanceRationaleOverride = evidenceClassification === "Code-supported independent finding"
    ? "Independent repo-wide source audit supports the hazard even though the pairwise architecture edge may need review."
    : (evidenceClassification === "Contradicted by code relationship"
      ? "Code relationship audit did not support the claimed architecture edge; review or correct the architecture row before carrying this hazard forward."
      : (evidenceClassification === "Generic/low confidence"
        ? "Evidence review found generic or low-confidence hazard wording; keep this row in review until a concrete safety-control path is confirmed."
        : (evidenceClassification === "Symbol-supported, edge unverified"
          ? "Source symbols were found, but the row lacks verified caller/callee evidence; keep this row in review unless a separate hazard justification supports it."
          : "")));

  return {
    hazardText: reviewedHazard || hazardText,
    evidenceClassification,
    proposedSafetyAssessment: proposedSafetyAssessmentForEvidence(evidenceClassification, concernType),
    proposedSafetyAssessmentRationale: safetySignificanceRationaleOverride || assumptions[0] || "Assessment is based on generated hazard text plus referenced architecture/code evidence.",
    safetyConcernType: concernType,
    confidence,
    safetySignificantOverride,
    safetySignificanceRationaleOverride,
    relationshipAudit: relationshipAudit.label,
    usageAudit: usageAudit.label,
    codeEvidence: joinEvidence(codeEvidence),
    mitigationEvidence: joinEvidence(mitigationEvidence) || "No explicit mitigation evidence found in the available row context.",
    assumptions: joinEvidence(assumptions) || "Classification is based on generated hazard text plus referenced architecture/code evidence; full source-body analysis may change this assessment.",
    recommendedVerification: recommendedVerificationFor(concernType, combinedText, { tokenClampEndpoint }),
    recommendedMitigation: recommendedMitigationFor(concernType, combinedText, { tokenClampEndpoint }),
  };
}

export function ensureHazardSummaryEvidenceColumns(generatedSheets = {}, tableRows = []) {
  const tracedSheets = ensureHazardSummaryTraceColumns(generatedSheets, tableRows);
  const summary = tracedSheets?.Summary;
  if (!Array.isArray(summary) || !Array.isArray(summary[0])) return tracedSheets;

  const currentHeaders = summary[0].map((header, index) => String(header || `Column ${index + 1}`));
  const nextHeaders = [...currentHeaders];
  HAZARD_SUMMARY_EVIDENCE_COLUMNS.forEach((column) => {
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
    const rowObject = {};
    nextHeaders.forEach((header, index) => {
      rowObject[header] = nextRow[index] ?? "";
    });
    const rowRef = normalizeText(rowObject["Architecture Row Ref"]);
    const sourceRow = rowsByRef.get(rowRef) || tableRows[rowIndex] || {};
    const evidence = evaluateHazardEvidence({ rowObject, sourceRow });

    const hazardIndex = headerIndex("Hazards");
    if (hazardIndex >= 0 && evidence.hazardText) nextRow[hazardIndex] = evidence.hazardText;
    const safetySignificantIndex = headerIndex("Safety Significant");
    if (safetySignificantIndex >= 0 && evidence.safetySignificantOverride) {
      nextRow[safetySignificantIndex] = evidence.safetySignificantOverride;
    }
    const safetyRationaleIndex = headerIndex("Safety Significance Rationale");
    if (safetyRationaleIndex >= 0 && evidence.safetySignificanceRationaleOverride) {
      nextRow[safetyRationaleIndex] = evidence.safetySignificanceRationaleOverride;
    }

    const evidenceValues = {
      "Proposed Safety Assessment": evidence.proposedSafetyAssessment,
      "Proposed Safety Assessment Rationale": evidence.proposedSafetyAssessmentRationale,
      "Evidence Classification": evidence.evidenceClassification,
      "Safety Concern Type": evidence.safetyConcernType,
      Confidence: evidence.confidence,
      "Code Relationship Audit": evidence.relationshipAudit,
      "Repo-Wide Usage Audit": evidence.usageAudit,
      "Code Evidence": evidence.codeEvidence,
      "Mitigation Evidence": evidence.mitigationEvidence,
      Assumptions: evidence.assumptions,
      "Recommended Verification": evidence.recommendedVerification,
      "Recommended Mitigation": evidence.recommendedMitigation,
    };

    Object.entries(evidenceValues).forEach(([column, value]) => {
      const index = headerIndex(column);
      if (index >= 0 && !normalizeText(nextRow[index])) nextRow[index] = value;
    });
    return nextRow;
  });

  return {
    ...tracedSheets,
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
    operationalContext: raw.operationalContext || context.operationalContext || context.repoMeta?.operationalContext || "",
    contextSources: raw.contextSources || context.contextSources || context.repoMeta?.contextSources || null,
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
