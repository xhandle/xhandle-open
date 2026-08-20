import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import {
  ARTIFACT_KINDS,
} from "./artifactDefinitions";
import {
  architectureRefFromFunctionalRow,
  allocatedArchitectureFromRefs,
  allocatedFunctionFromRefs,
  cellText,
  collectArchitectureRefsFromParents,
  compactList,
  createBaseArtifactRow,
  findFunctionalRowIndexByTrace,
  makeId,
  sourceFilesFromRefs,
  splitIds,
} from "./artifactUtils";

const ASSURANCE_MODEL = "gpt-4o-mini";
const ASSURANCE_AI_COOLDOWN_MS = 120000;
const ASSURANCE_TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ASSURANCE_TRANSIENT_RETRY_DELAYS_MS = [1000, 2500, 5000];
let assuranceAIUnavailableUntil = 0;
let assuranceAIUnavailableReason = "";

function isAssuranceAIUnavailable() {
  return Date.now() < assuranceAIUnavailableUntil;
}

function isAssuranceTransientStatus(status) {
  return ASSURANCE_TRANSIENT_STATUSES.has(status);
}

function waitForAssuranceRetry(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markAssuranceAIUnavailable(error) {
  if (!isAssuranceTransientStatus(error?.status)) return;
  assuranceAIUnavailableUntil = Date.now() + ASSURANCE_AI_COOLDOWN_MS;
  assuranceAIUnavailableReason = error?.message || "AI service temporarily unavailable.";
}

function assuranceUnavailableError(errorLabel) {
  const error = new Error(`${errorLabel} skipped because the AI service is temporarily unavailable. ${assuranceAIUnavailableReason}`.trim());
  error.status = 503;
  error.assuranceAIUnavailable = true;
  return error;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const firstBrace = body.indexOf("{");
  const lastBrace = body.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? body.slice(firstBrace, lastBrace + 1) : body;
  return JSON.parse(jsonText);
}

async function callAssuranceModel(payload, {
  systemPrompt,
  errorLabel,
  retryDelays = [],
  markTransientUnavailable = true,
  respectUnavailable = true,
}) {
  if (respectUnavailable && isAssuranceAIUnavailable()) {
    throw assuranceUnavailableError(errorLabel);
  }

  const requestBody = JSON.stringify({
    model: ASSURANCE_MODEL,
    xhandleModelLocked: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) },
    ],
    temperature: 0.2,
  });

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const response = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: requestBody,
    });
    if (response.ok) {
      const data = await response.json();
      return data.answer || data.content || data.message || data.choices?.[0]?.message?.content || "";
    }

    const text = await response.text().catch(() => "");
    const error = new Error(response.status === 401 ? "No AI key is configured for Collaborator." : `${errorLabel} failed (${response.status}): ${text}`);
    error.status = response.status;
    error.responseText = text;

    const retryDelay = retryDelays[attempt];
    if (isAssuranceTransientStatus(error.status) && retryDelay != null) {
      console.warn(`⚠️ ${errorLabel} request returned ${error.status}; retrying in ${retryDelay}ms.`);
      await waitForAssuranceRetry(retryDelay);
      continue;
    }

    if (markTransientUnavailable) markAssuranceAIUnavailable(error);
    throw error;
  }

  throw new Error(`${errorLabel} failed before a response was received.`);
}

const ASSURANCE_SINGLE_PROMPT_MAX_CHARS = 80000;
const ASSURANCE_CHUNK_PROMPT_MAX_CHARS = 60000;
const SOFTWARE_TRANSIENT_SPLIT_MIN_CHARS = 8000;
const SOFTWARE_TRANSIENT_MAX_SPLIT_DEPTH = 2;
const ASSURANCE_PROMPT_BATCH_SIZE = 5;

function shouldSplitFailedChunk(error) {
  const message = `${error?.message || ""} ${error?.responseText || ""}`.toLowerCase();
  if (error?.status === 400 || error?.status === 413) return true;
  return /token|context|too large|payload|maximum context|reduce the length/.test(message);
}

function shouldSplitTransientChunk(error, payloadLength = 0, splitDepth = 0) {
  if (splitDepth >= SOFTWARE_TRANSIENT_MAX_SPLIT_DEPTH) return false;
  if (!isAssuranceTransientStatus(error?.status)) return false;
  return payloadLength >= SOFTWARE_TRANSIENT_SPLIT_MIN_CHARS;
}

export function shouldSplitFunctionalChunkAfterFailure(error, payloadLength = 0, splitDepth = 0, rowCount = 0) {
  if (rowCount <= 1) return false;
  return shouldSplitFailedChunk(error) || shouldSplitTransientChunk(error, payloadLength, splitDepth);
}

function truncateForPrompt(value, maxChars = 120) {
  const text = cellText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function compactFunctionalRowForPrompt(row = {}, index, maxChars = 120) {
  return {
    rowRef: truncateForPrompt(row.rowRef || index + 1, 32),
    traceId: truncateForPrompt(row.traceId, 64),
    fromFunction: truncateForPrompt(row.from || row.fromFunction, maxChars),
    controlAction: truncateForPrompt(row.action || row.controlAction, maxChars),
    toFunction: truncateForPrompt(row.to || row.toFunction, maxChars),
    sourceFiles: truncateForPrompt(compactList([row.fromFile, row.toFile]), maxChars),
    subsystem: truncateForPrompt(row.architecture?.subsystem, 64),
    csci: truncateForPrompt(row.architecture?.csci, 64),
    csc: truncateForPrompt(row.architecture?.csc, 64),
    csu: truncateForPrompt(row.architecture?.csu, 64),
  };
}

function compactArtifactRowForPrompt(row = {}, index, maxChars = 120) {
  const refs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const ref = refs[0] || {};
  return {
    id: truncateForPrompt(row.id || index + 1, 48),
    text: truncateForPrompt(row.requirementText || row.description || row.designElementName, maxChars),
    parentSwRequirement: truncateForPrompt(row.parentSwRequirement, maxChars),
    parentSystemRequirement: truncateForPrompt(row.parentSystemRequirement, maxChars),
    parentRequirement: truncateForPrompt(row.parentRequirement, maxChars),
    derivedFromFunction: truncateForPrompt(row.derivedFromFunction, maxChars),
    derivedFromInterface: truncateForPrompt(row.derivedFromInterface, maxChars),
    subsystem: truncateForPrompt(row.subsystem, 64),
    allocatedFunction: truncateForPrompt(row.allocatedFunction, maxChars),
    allocatedArchitecture: truncateForPrompt(row.allocatedArchitecture, maxChars),
    requirementType: truncateForPrompt(row.requirementType, 64),
    priority: truncateForPrompt(row.priority, 32),
    linkedHazards: truncateForPrompt(row.linkedHazards, maxChars),
    parentHazard: truncateForPrompt(row.parentHazard, maxChars),
    mitigationStrategy: truncateForPrompt(row.mitigationStrategy, maxChars),
    criticalitySeverity: truncateForPrompt(row.criticalitySeverity, 64),
    linkedVerification: truncateForPrompt(row.linkedVerification, maxChars),
    safetyContext: truncateForPrompt(row.safetyContext, maxChars),
    hazardSummaryRef: truncateForPrompt(row.hazardSummaryRef, 64),
    architectureTrace: {
      traceId: truncateForPrompt(ref.traceId || row.sourceTraceId, 64),
      fromFunction: truncateForPrompt(ref.fromFunction || row.derivedFromFunction, maxChars),
      controlAction: truncateForPrompt(ref.controlAction || row.derivedFromInterface, maxChars),
      toFunction: truncateForPrompt(ref.toFunction, maxChars),
      subsystem: truncateForPrompt(ref.subsystem || row.subsystem, 64),
      csci: truncateForPrompt(ref.csci, 64),
      csc: truncateForPrompt(ref.csc, 64),
      csu: truncateForPrompt(ref.csu, 64),
    },
  };
}

function compactRequirementTextRowForPrompt(row = {}, index, maxChars = 220) {
  return {
    id: truncateForPrompt(row.id || index + 1, 48),
    requirementText: truncateForPrompt(row.requirementText || row.description || row.designElementName, maxChars),
  };
}

function compactRequirementCategoryForPrompt(row = {}, index, maxChars = 160) {
  return {
    id: truncateForPrompt(row.id || index + 1, 48),
    categoryName: truncateForPrompt(row.categoryName || row.name, maxChars),
    categoryDescription: truncateForPrompt(row.categoryDescription || row.description, maxChars),
    requirementIntent: truncateForPrompt(row.requirementIntent || row.text, maxChars),
    parentSwRequirement: truncateForPrompt(row.parentSwRequirement, maxChars),
    parentSystemRequirement: truncateForPrompt(row.parentSystemRequirement, maxChars),
    parentRequirement: truncateForPrompt(row.parentRequirement, maxChars),
    subsystem: truncateForPrompt(row.subsystem, 64),
    allocatedFunction: truncateForPrompt(row.allocatedFunction, maxChars),
    allocatedArchitecture: truncateForPrompt(row.allocatedArchitecture, maxChars),
    safetyContext: truncateForPrompt(row.safetyContext, maxChars),
    representativeRequirements: truncateForPrompt(row.representativeRequirements, maxChars),
  };
}

function compactRowsForPrompt(rows = [], compactRow) {
  const rowCharBudgets = [160, 120, 80, 48, 32];
  for (const maxChars of rowCharBudgets) {
    const compactRows = rows.map((row, index) => compactRow(row, index, maxChars));
    const json = JSON.stringify(compactRows);
    if (json.length <= 240000 || maxChars === rowCharBudgets[rowCharBudgets.length - 1]) {
      return compactRows;
    }
  }
  return rows.map((row, index) => compactRow(row, index, 32));
}

function assurancePayloadLength(basePayload, rowKey, rows, compactRow) {
  return JSON.stringify({
    ...basePayload,
    [rowKey]: compactRowsForPrompt(rows, compactRow),
  }).length;
}

function chunkAssuranceRowsForPrompt(
  rows = [],
  basePayload,
  rowKey,
  compactRow,
  maxChars = ASSURANCE_CHUNK_PROMPT_MAX_CHARS
) {
  const chunks = [];
  let current = [];
  let start = 0;

  rows.forEach((row, index) => {
    const candidate = [...current, row];
    if (current.length && assurancePayloadLength(basePayload, rowKey, candidate, compactRow) > maxChars) {
      chunks.push({ start, rows: current });
      current = [row];
      start = index;
    } else {
      current = candidate;
    }
  });

  if (current.length) chunks.push({ start, rows: current });
  return chunks;
}

function chunkRowsByCount(rows = [], batchSize = ASSURANCE_PROMPT_BATCH_SIZE) {
  const chunks = [];
  const safeBatchSize = Math.max(1, batchSize);
  for (let start = 0; start < rows.length; start += safeBatchSize) {
    chunks.push({ start, rows: rows.slice(start, start + safeBatchSize) });
  }
  return chunks;
}

async function requestAssuranceChunk({
  basePayload,
  rowKey,
  chunk,
  compactRow,
  responseKey,
  systemPrompt,
  errorLabel,
  retryTransient = false,
  adaptiveTransientSplit = false,
  markTransientUnavailable = true,
  respectUnavailable = true,
  logPromptResponse = false,
  splitDepth = 0,
}) {
  const payload = {
    ...basePayload,
    rowStart: chunk.start + 1,
    rowEnd: chunk.start + chunk.rows.length,
    rowCount: chunk.rows.length,
    [rowKey]: compactRowsForPrompt(chunk.rows, compactRow),
  };
  const payloadLength = JSON.stringify(payload).length;

  if (logPromptResponse) {
    console.info(`[xHandle AI] ${errorLabel} prompt rows ${chunk.start + 1}-${chunk.start + chunk.rows.length}`, {
      systemPrompt,
      payload,
    });
  }

  try {
    const raw = await callAssuranceModel(payload, {
      systemPrompt,
      errorLabel,
      retryDelays: retryTransient ? ASSURANCE_TRANSIENT_RETRY_DELAYS_MS : [],
      markTransientUnavailable,
      respectUnavailable,
    });
    if (logPromptResponse) {
      console.info(`[xHandle AI] ${errorLabel} response rows ${chunk.start + 1}-${chunk.start + chunk.rows.length}`, raw);
    }
    const parsed = extractJson(raw);
    const rowsForChunk = Array.isArray(parsed[responseKey]) ? parsed[responseKey] : [];
    return chunk.rows.map((_, index) => rowsForChunk[index] || {});
  } catch (err) {
    const splitForSize = shouldSplitFailedChunk(err);
    const splitForTransientLoad = adaptiveTransientSplit && shouldSplitTransientChunk(err, payloadLength, splitDepth);
    if (chunk.rows.length > 1 && (splitForSize || splitForTransientLoad)) {
      const mid = Math.ceil(chunk.rows.length / 2);
      const first = { start: chunk.start, rows: chunk.rows.slice(0, mid) };
      const second = { start: chunk.start + mid, rows: chunk.rows.slice(mid) };
      const reason = splitForSize ? "prompt was too large" : "service rejected a large chunk after retries";
      console.warn(`⚠️ ${errorLabel} ${reason} for chunk starting at row ${chunk.start + 1} (${payloadLength} chars); retrying as ${first.rows.length} and ${second.rows.length} row sub-chunks.`, err);
      const firstRows = await requestAssuranceChunk({
        basePayload,
        rowKey,
        chunk: first,
        compactRow,
        responseKey,
        systemPrompt,
        errorLabel,
        retryTransient,
        adaptiveTransientSplit,
        markTransientUnavailable,
        respectUnavailable,
        logPromptResponse,
        splitDepth: splitDepth + 1,
      });
      const secondRows = await requestAssuranceChunk({
        basePayload,
        rowKey,
        chunk: second,
        compactRow,
        responseKey,
        systemPrompt,
        errorLabel,
        retryTransient,
        adaptiveTransientSplit,
        markTransientUnavailable,
        respectUnavailable,
        logPromptResponse,
        splitDepth: splitDepth + 1,
      });
      return [...firstRows, ...secondRows];
    }

    if (adaptiveTransientSplit && markTransientUnavailable) markAssuranceAIUnavailable(err);
    console.warn(`⚠️ ${errorLabel} failed for chunk starting at row ${chunk.start + 1}; using local fallback rows for that chunk.`, err);
    return chunk.rows.map(() => ({}));
  }
}

async function requestAssuranceRows({
  basePayload,
  rowKey,
  rows,
  compactRow,
  responseKey = "requirements",
  systemPrompt,
  errorLabel,
  singlePromptMaxChars = ASSURANCE_SINGLE_PROMPT_MAX_CHARS,
  chunkPromptMaxChars = ASSURANCE_CHUNK_PROMPT_MAX_CHARS,
  retryTransient = false,
  adaptiveTransientSplit = false,
  markTransientUnavailable = true,
  respectUnavailable = true,
  fixedBatchSize = null,
  logPromptResponse = false,
  onProgress = null,
}) {
  if (respectUnavailable && isAssuranceAIUnavailable()) {
    console.warn(`⚠️ ${errorLabel} skipped; using local fallback rows while the AI service is temporarily unavailable.`);
    return rows.map(() => ({}));
  }
  const singlePromptLength = assurancePayloadLength(basePayload, rowKey, rows, compactRow);
  const chunks = fixedBatchSize
    ? chunkRowsByCount(rows, fixedBatchSize)
    : (singlePromptLength <= singlePromptMaxChars
      ? [{ start: 0, rows }]
      : chunkAssuranceRowsForPrompt(rows, basePayload, rowKey, compactRow, chunkPromptMaxChars));

  if (chunks.length > 1) {
    const chunkDescription = fixedBatchSize ? `${fixedBatchSize}-row prompt batches` : "bulk prompt chunks";
    console.warn(`⚠️ ${errorLabel} input is large; using ${chunks.length} ${chunkDescription} instead of one prompt.`);
  }

  const generatedRows = [];
  for (const chunk of chunks) {
    const rowsForChunk = await requestAssuranceChunk({
      basePayload,
      rowKey,
      chunk,
      compactRow,
      responseKey,
      systemPrompt,
      errorLabel,
      retryTransient,
      adaptiveTransientSplit,
      markTransientUnavailable,
      respectUnavailable,
      logPromptResponse,
    });
    chunk.rows.forEach((_, index) => {
      generatedRows[chunk.start + index] = rowsForChunk[index] || {};
    });
    onProgress?.({
      phase: errorLabel,
      completed: Math.min(rows.length, chunk.start + chunk.rows.length),
      total: rows.length,
      message: `${errorLabel}: rows ${chunk.start + 1}-${chunk.start + chunk.rows.length} of ${rows.length}`,
    });
  }

  return generatedRows;
}

async function requestAssuranceConsolidationRows({
  basePayload,
  rowKey,
  rows,
  compactRow,
  responseKey = "requirements",
  systemPrompt,
  errorLabel,
  fixedBatchSize = null,
  logPromptResponse = false,
  retryTransient = false,
  markTransientUnavailable = true,
  respectUnavailable = true,
  onProgress = null,
}) {
  if (respectUnavailable && isAssuranceAIUnavailable()) {
    console.warn(`⚠️ ${errorLabel} consolidation skipped; keeping local first-pass rows while the AI service is temporarily unavailable.`);
    return rows;
  }
  const chunks = fixedBatchSize
    ? chunkRowsByCount(rows, fixedBatchSize)
    : chunkAssuranceRowsForPrompt(
      rows,
      basePayload,
      rowKey,
      compactRow,
      ASSURANCE_CHUNK_PROMPT_MAX_CHARS
    );

  if (chunks.length > 1) {
    const chunkDescription = fixedBatchSize ? `${fixedBatchSize}-row prompt batches` : "abstraction chunks";
    console.warn(`⚠️ ${errorLabel} consolidation input is large; using ${chunks.length} ${chunkDescription}.`);
  }

  const generatedRows = [];
  for (const chunk of chunks) {
    const payload = {
      ...basePayload,
      chunkStart: chunk.start + 1,
      chunkSize: chunk.rows.length,
      rowStart: chunk.start + 1,
      rowEnd: chunk.start + chunk.rows.length,
      rowCount: chunk.rows.length,
      [rowKey]: compactRowsForPrompt(chunk.rows, compactRow),
    };

    if (logPromptResponse) {
      console.info(`[xHandle AI] ${errorLabel} prompt rows ${chunk.start + 1}-${chunk.start + chunk.rows.length}`, {
        systemPrompt,
        payload,
      });
    }

    try {
      const raw = await callAssuranceModel(payload, {
        systemPrompt,
        errorLabel,
        retryDelays: retryTransient ? ASSURANCE_TRANSIENT_RETRY_DELAYS_MS : [],
        markTransientUnavailable,
        respectUnavailable,
      });
      if (logPromptResponse) {
        console.info(`[xHandle AI] ${errorLabel} response rows ${chunk.start + 1}-${chunk.start + chunk.rows.length}`, raw);
      }
      const parsed = extractJson(raw);
      const rowsForChunk = Array.isArray(parsed[responseKey]) ? parsed[responseKey] : [];
      generatedRows.push(...rowsForChunk);
    } catch (err) {
      console.warn(`⚠️ ${errorLabel} consolidation failed for chunk starting at row ${chunk.start + 1}; keeping first-pass rows for that chunk.`, err);
      generatedRows.push(...chunk.rows);
    }
    onProgress?.({
      phase: errorLabel,
      completed: Math.min(rows.length, chunk.start + chunk.rows.length),
      total: rows.length,
      message: `${errorLabel}: rows ${chunk.start + 1}-${chunk.start + chunk.rows.length} of ${rows.length}`,
    });
  }

  return generatedRows;
}

function isSafetyLinkedRow(row = {}) {
  return /safety/i.test(cellText(row.requirementType)) ||
    Boolean(cellText(row.linkedHazards || row.hazardSummaryRef || row.parentHazard || row.criticalitySeverity || row.safetyContext));
}

function isHazardDerivedSoftwareRow(row = {}) {
  if (row?.source === "hazard-derived") return true;
  const hasHazardAnalysisTrace = Boolean(cellText(row.hazardAnalysisRunId || row.hazardSummaryRef));
  return hasHazardAnalysisTrace && isSafetyLinkedRow(row);
}

export function splitSoftwareRequirementsBySource(softwareRequirements = []) {
  const functionalRows = [];
  const hazardRows = [];
  (Array.isArray(softwareRequirements) ? softwareRequirements : []).forEach((row) => {
    if (isHazardDerivedSoftwareRow(row)) {
      hazardRows.push(row);
    } else {
      functionalRows.push(row);
    }
  });
  return { functionalRows, hazardRows };
}

function parentIdsCovered(rows = [], parentKey = "") {
  const covered = new Set();
  rows.forEach((row) => {
    splitIds(row?.[parentKey]).forEach((id) => covered.add(id));
  });
  return covered;
}

function missingParentRows(sourceRows = [], generatedRows = [], parentKey = "") {
  const covered = parentIdsCovered(generatedRows, parentKey);
  return sourceRows.filter((row) => row.id && !covered.has(cellText(row.id)));
}

function safetyContextFromParents(parentRows = []) {
  const hazards = compactList(parentRows.map((row) => row.linkedHazards || row.hazardSummaryRef));
  const parentHazards = compactList(parentRows.map((row) => row.parentHazard));
  const mitigation = compactList(parentRows.map((row) => row.mitigationStrategy));
  const severity = compactList(parentRows.map((row) => row.criticalitySeverity));
  const verification = compactList(parentRows.map((row) => row.linkedVerification || row.verificationMethod));
  return {
    linkedHazards: hazards,
    parentHazard: parentHazards,
    mitigationStrategy: mitigation,
    criticalitySeverity: severity,
    linkedVerification: verification,
    safetyContext: compactList([parentHazards, mitigation, severity, verification]),
  };
}

function safetyRowsMissingCoverage(sourceRows = [], generatedRows = [], parentKey = "") {
  const covered = parentIdsCovered(generatedRows, parentKey);
  return sourceRows.filter((row) => isSafetyLinkedRow(row) && row.id && !covered.has(cellText(row.id)));
}

function getSheetCellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "object" && "value" in cell) return cellText(cell.value);
  return cellText(cell);
}

function summaryRowsFromHazardAnalysis(hazardAnalysis = null) {
  const summary = hazardAnalysis?.generatedSheets?.Summary || hazardAnalysis?.analysisResult?.Summary;
  if (!Array.isArray(summary) || !Array.isArray(summary[0])) return [];
  const headers = summary[0].map((header, index) => cellText(header || `Column ${index + 1}`));
  return summary.slice(1).map((row, rowIndex) => {
    const record = { rowIndex, row };
    headers.forEach((header, index) => {
      record[header] = getSheetCellText(Array.isArray(row) ? row[index] : "");
    });
    return record;
  });
}

function pickField(row = {}, names = []) {
  const entries = Object.entries(row);
  for (const name of names) {
    const normalized = cellText(name).toLowerCase();
    const match = entries.find(([key]) => cellText(key).toLowerCase() === normalized);
    const value = match ? cellText(match[1]) : "";
    if (value && !/^\([^)]*not found[^)]*\)$/i.test(value)) return value;
  }
  return "";
}

function architectureRefFromHazardRow(row = {}) {
  const traceId = pickField(row, ["Trace ID"]);
  const rowRef = pickField(row, ["Architecture Row Ref"]);
  if (!traceId && !rowRef) return null;
  return {
    rowIndex: Number(rowRef) ? Number(rowRef) - 1 : undefined,
    rowRef,
    traceId: traceId || rowRef,
    fromFunction: pickField(row, ["Function (From)"]),
    controlAction: pickField(row, ["Control Action"]),
    toFunction: pickField(row, ["Function (To)"]),
    fromNodeId: pickField(row, ["From Node ID"]),
    edgeId: pickField(row, ["Control Edge ID"]),
    toNodeId: pickField(row, ["To Node ID"]),
    fromFile: "",
    toFile: "",
    mode: "edge",
    subsystem: pickField(row, ["Subsystem"]),
    csci: pickField(row, ["CSCI"]),
    csc: pickField(row, ["CSC"]),
    csu: pickField(row, ["CSU"]),
  };
}

function normalizeSafetyRequirementText(text = "") {
  const raw = cellText(text);
  if (!raw) return "";
  const toSoftwareShall = (phrase = "") => {
    const normalized = cellText(phrase).replace(/^\s*,?\s*/, "");
    if (!normalized) return "The software shall";
    return `The software shall ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
  };
  const functionSubjectMatch = raw.match(/^the\s+software\s+shall\s+the\s+function\s+[`'"]?[\w.]+[`'"]?\s+(?:shall|must|should)\s+(.+)$/i);
  if (functionSubjectMatch) return cleanImplementationRequirementText(toSoftwareShall(functionSubjectMatch[1]));
  const duplicateSubjectMatch = raw.match(/^the\s+software\s+shall\s+(?:the\s+)?(?:system|subsystem|software)\s+(?:shall|must)\s+(.+)$/i);
  if (duplicateSubjectMatch) return cleanImplementationRequirementText(toSoftwareShall(duplicateSubjectMatch[1]));
  const subjectModalMatch = raw.match(/^(?:the\s+)?(?:system|subsystem|software)\s+(?:shall|must)\s+(.+)$/i);
  if (subjectModalMatch) return cleanImplementationRequirementText(toSoftwareShall(subjectModalMatch[1]));
  if (/^the\s+software\s+shall\b/i.test(raw)) {
    return cleanImplementationRequirementText(raw.replace(/^the\s+software\s+shall\b/i, "The software shall"));
  }
  return cleanImplementationRequirementText(`The software shall ${raw.charAt(0).toLowerCase()}${raw.slice(1)}`);
}

function safetySignificanceTagForHazardRow(row = {}) {
  return pickField(row, ["Safety Significant", "safetySignificant"]);
}

function isSafetySignificantHazardRow(row = {}) {
  const tag = cellText(safetySignificanceTagForHazardRow(row)).trim();
  if (!tag) return true;
  return /^yes$/i.test(tag);
}

function hazardSafetyRequirementRows(hazardAnalysis = null) {
  const rows = summaryRowsFromHazardAnalysis(hazardAnalysis);
  return rows.flatMap((row, index) => {
    if (!isSafetySignificantHazardRow(row)) return [];
    const requirement = normalizeSafetyRequirementText(pickField(row, [
      "Software Safety Requirement",
      "Safety Requirement",
      "Safety Requirements/Constraints",
      "Safety Goal",
      "System Requirement",
      "Consolidated Requirement",
      "Requirement",
    ]));
    if (!requirement) return [];

    const architectureRef = architectureRefFromHazardRow(row);
    const hazardRef = `HZ-${String(Number(row.rowIndex) + 1).padStart(3, "0")}`;
    const sourceId = architectureRef?.traceId || architectureRef?.rowRef || "";
    const hazardText = pickField(row, ["Hazard", "Hazards", "Hazardous Event", "Mishap", "Loss", "Losses"]);
    const mitigation = pickField(row, ["Mitigation Strategy", "Controls / Mitigations", "Controls", "Safety Goal"]);
    const severity = pickField(row, ["Software Criticality Index", "ASIL", "Severity Category", "Severity"]);
    const verification = pickField(row, ["Verification", "LOR Tasks"]);
    return [createBaseArtifactRow(ARTIFACT_KINDS.SOFTWARE, {
      id: `SWR-SAFE-${String(index + 1).padStart(3, "0")}`,
      requirementText: requirement,
      derivedFromFunction: pickField(row, ["Function", "Function (From)", "Item / Function"]),
      derivedFromInterface: pickField(row, ["Control Action", "Unsafe Control Action", "Unsafe Control Actions", "Functional Degradation / Loss", "Malfunction"]),
      requirementType: "Safety-Related",
      priority: /ASIL\s+D|SwCI\s*1|Catastrophic|Critical/i.test(severity) ? "High" : "Medium",
      rationale: pickField(row, ["Rationale"]) || "Derived from code architecture hazard analysis.",
      linkedSourceCode: pickField(row, ["Related Source File(s)", "Source Line Ranges"]),
      linkedHazards: hazardRef,
      mitigationStrategy: mitigation,
      criticalitySeverity: severity,
      safetySignificant: safetySignificanceTagForHazardRow(row),
      safetySignificanceRationale: pickField(row, ["Safety Significance Rationale"]),
      linkedVerification: verification,
      linkedTests: "",
      sourceTraceId: sourceId,
      traceLinks: [
        { targetType: "hazard-row", targetId: hazardRef, relationship: "derived-from" },
        ...(sourceId ? [{ targetType: "functional-row", targetId: sourceId, relationship: "traces-to" }] : []),
      ],
      sourceArchitectureRefs: architectureRef ? [architectureRef] : [],
      hazardAnalysisRunId: hazardAnalysis?.id || "",
      hazardAnalysisMethod: hazardAnalysis?.hazardMethod || "",
      hazardRowIndex: row.rowIndex,
      hazardSummaryRef: hazardRef,
      parentHazard: hazardText,
      source: "hazard-derived",
    }, index)];
  });
}

function normalizeSoftwareRow(raw = {}, index, cbaRows = []) {
  const sourceTraceId = cellText(raw.sourceTraceId || raw.traceId || raw.sourceRowRef || raw.architectureRowRef);
  const sourceIndex = findFunctionalRowIndexByTrace(cbaRows, sourceTraceId);
  const sourceRow = sourceIndex >= 0 ? cbaRows[sourceIndex] : cbaRows[index] || {};
  const sourceId = sourceTraceId || sourceRow.traceId || sourceRow.rowRef || String(index + 1);
  const rowIndex = sourceIndex >= 0 ? sourceIndex : index;
  const architectureRef = architectureRefFromFunctionalRow(sourceRow, rowIndex, raw.architectureMode || "edge");
  return createBaseArtifactRow(ARTIFACT_KINDS.SOFTWARE, {
    id: generatedIdFor("SWR", raw.id, index),
    requirementText: cellText(raw.requirementText),
    derivedFromFunction: cellText(raw.derivedFromFunction) || compactList([sourceRow.from || sourceRow.fromFunction, sourceRow.to || sourceRow.toFunction]),
    derivedFromInterface: cellText(raw.derivedFromInterface) || cellText(sourceRow.action || sourceRow.controlAction),
    requirementType: cellText(raw.requirementType) || "Functional",
    priority: cellText(raw.priority) || "Medium",
    rationale: cellText(raw.rationale) || "AI-derived from code-based functional decomposition.",
    linkedSourceCode: cellText(raw.linkedSourceCode) || compactList([sourceRow.fromFile, sourceRow.toFile]),
    linkedHazards: cellText(raw.linkedHazards),
    linkedTests: cellText(raw.linkedTests),
    sourceTraceId: sourceId,
    traceLinks: [
      { targetType: "functional-row", targetId: sourceId, relationship: "derived-from" },
      { targetType: "architecture-edge", targetId: architectureRef.edgeId || sourceId, relationship: "derived-from" },
    ],
    sourceArchitectureRefs: [architectureRef],
    source: "functional-derived",
  }, index);
}

function codeSymbolTokensFromFunctionalRow(row = {}) {
  return compactList([
    row.from,
    row.fromFunction,
    row.to,
    row.toFunction,
    row.action,
    row.controlAction,
  ])
    .split(/[,;]\s*|\s+->\s+/)
    .map((token) => token.trim())
    .filter((token) => (
      token.length >= 3 &&
      (/^_/.test(token) || /_$/.test(token) || token.includes("_") || /^[a-z][A-Za-z0-9]*$/.test(token))
    ));
}

function looksLikeCodeEchoSoftwareRequirement(row = {}, sourceRow = {}) {
  const text = cellText(row.requirementText);
  if (!text) return false;
  if (/\b(function|method|class|constructor)\b/i.test(text)) return true;
  if (/\b(call|calls|called|calling|invoke|invokes|invoking|return|returns|returned|create|creates|created|creating|set|sets|setting|instance)\b/i.test(text)) return true;
  const tokens = codeSymbolTokensFromFunctionalRow(sourceRow);
  return tokens.some((token) => token.length >= 4 && text.includes(token));
}

function readableCodeSymbol(token = "") {
  const raw = cellText(token).replace(/^[`'"]|[`'"]$/g, "");
  if (/^_{0,2}init_{0,2}$/i.test(raw)) return "initialization";
  if (/\.py$/i.test(raw)) return "model component";
  const lastPart = raw.split(".").filter(Boolean).pop() || raw;
  const words = lastPart
    .replace(/^_+|_+$/g, "")
    .replace(/_torch$/i, "")
    .replace(/_/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bvlm\b/ig, "vision-language model")
    .replace(/\bvla\b/ig, "vision-language action")
    .replace(/\bmlp\b/ig, "MLP")
    .replace(/\brms\b/ig, "RMS")
    .trim();
  return words || "related capability";
}

function cleanImplementationRequirementText(text = "") {
  let body = stripRequirementLeadIn(text);
  if (!body) return "";
  body = body
    .replace(/\bthe\s+function\s+[`'"]?[\w.]+[`'"]?\s+(?:shall|must|should)\s+/ig, "")
    .replace(/\b(?:when|before|after)\s+(?:the\s+)?[`'"]?[\w.]+[`'"]?\s+(?:function|method)\s+is\s+(?:called|invoked)\b/ig, "")
    .replace(/\b(?:function|method|class)\s+[`'"]?[\w.]+[`'"]?\b/ig, "")
    .replace(/\s+\bin\s+[`'"]?[\w.-]+\.py[`'"]?/ig, "")
    .replace(/[`'"]?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?[`'"]?/g, (match) => {
      const unquoted = match.replace(/^[`'"]|[`'"]$/g, "");
      return /_|\.|^__/.test(unquoted) ? readableCodeSymbol(unquoted) : match;
    })
    .replace(/^only\s+return\s+(.+?)\s+(when|before|after)\s+(.+)$/i, "only make $1 available $2 $3")
    .replace(/^only\s+return\s+(.+)$/i, "only make $1 available")
    .replace(/^return\s+(.+?)\s+(when|before|after)\s+(.+)$/i, "make $1 available $2 $3")
    .replace(/^return\s+(.+)$/i, "make $1 available")
    .replace(/^returns\s+(.+)$/i, "make $1 available")
    .replace(/^create\s+an?\s+instance\s+of\s+(?:the\s+)?(.+?)\s+that\s+is\s+capable\s+of\s+(.+)$/i, (_, name, capability) => `provide ${readableCodeSymbol(name)} capability for ${capability}`)
    .replace(/^create\s+an?\s+instance\s+of\s+(?:the\s+)?(.+?)\s+for\s+(.+)$/i, (_, name, purpose) => `provide ${readableCodeSymbol(name)} capability for ${purpose}`)
    .replace(/^create\s+an?\s+instance\s+of\s+(?:the\s+)?(.+)$/i, (_, name) => `provide ${readableCodeSymbol(name)} capability`)
    .replace(/^provide\s+an?\s+instance\s+of\s+(?:the\s+)?(.+?)\s+for\s+(.+)$/i, (_, name, purpose) => `provide ${readableCodeSymbol(name)} capability for ${purpose}`)
    .replace(/^provide\s+an?\s+instance\s+of\s+(?:the\s+)?(.+)$/i, (_, name) => `provide access to ${readableCodeSymbol(name)} capability`)
    .replace(/^provide\s+a\s+mechanism\s+to\s+initialize\s+an?\s+(.+?)\s+instance\s+with\s+(.+)$/i, (_, name, params) => `configure ${readableCodeSymbol(name)} capability with ${params}`)
    .replace(/^enable\s+the\s+creation\s+of\s+an?\s+(.+?)\s+instance\s+capable\s+of\s+(.+)$/i, (_, name, capability) => `provide ${readableCodeSymbol(name)} capability for ${capability}`)
    .replace(/\bbefore\s+calling\s+(.+)$/i, "before using $1")
    .replace(/\barctangent\s+function\b/ig, "arctangent calculation")
    .replace(/\band\s+return\s+/ig, "and make available ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+\./g, ".")
    .replace(/[.]+$/g, "");
  const prefixed = ensureRequirementPrefix(body, "The software shall");
  return prefixed ? `${prefixed}.` : "";
}

function cleanCodeEchoSoftwareRequirement(row = {}) {
  const requirementText = cleanImplementationRequirementText(row.requirementText);
  if (!requirementText || requirementText === row.requirementText) return row;
  return {
    ...row,
    requirementText,
    rationale: cellText(row.rationale) || "Locally rewritten to describe externally reviewable software behavior.",
  };
}

async function repairCodeEchoSoftwareRequirements({ rows = [], cbaRows = [], projectName = "", repoName = "", onProgress = null } = {}) {
  const repairItems = rows
    .map((row, index) => ({ row, index, sourceRow: cbaRows[index] || {} }))
    .filter(({ row, sourceRow }) => looksLikeCodeEchoSoftwareRequirement(row, sourceRow));
  if (!repairItems.length) return rows;

  onProgress?.({
    phase: "Software requirements rewrite",
    completed: 0,
    total: repairItems.length,
    message: `Rewriting ${repairItems.length} code-level software requirement${repairItems.length === 1 ? "" : "s"} into behavior requirements...`,
  });

  const systemPrompt = "You are a senior software requirements engineer. Rewrite implementation-level software requirement drafts into black-box, testable software behavior requirements. Return only valid JSON matching the requested schema.";
  const repairedByIndex = new Map();
  for (let start = 0; start < repairItems.length; start += ASSURANCE_PROMPT_BATCH_SIZE) {
    const batch = repairItems.slice(start, start + ASSURANCE_PROMPT_BATCH_SIZE);
    const payload = {
      task: "rewrite_code_echo_software_requirements",
      projectName,
      repoName,
      instructions: [
        "Rewrite each draft as externally reviewable software behavior, not an implementation step.",
        "Use 'The software shall ...' language.",
        "Do not mention function names, method names, class names, private symbols, file paths, or phrases like when the function is called.",
        "Translate code symbols into domain behavior using the functional row context.",
        "Keep sourceTraceId unchanged.",
        "Return one requirement object for each input in the same order.",
      ],
      schema: {
        requirements: [{
          id: "same id as input",
          requirementText: "The software shall ...",
          requirementType: "Functional | Interface | Data | Performance | Safety-Related | Other",
          priority: "High | Medium | Low",
          rationale: "Why this behavior follows from the functional row",
          sourceTraceId: "same sourceTraceId as input",
        }],
      },
      requirements: batch.map(({ row, sourceRow, index }) => ({
        id: row.id,
        sourceTraceId: row.sourceTraceId,
        draftRequirementText: row.requirementText,
        derivedFromFunction: row.derivedFromFunction,
        derivedFromInterface: row.derivedFromInterface,
        functionalRow: compactFunctionalRowForPrompt(sourceRow, index, 220),
      })),
    };

    try {
      const raw = await callAssuranceModel(payload, {
        systemPrompt,
        errorLabel: "Software requirements rewrite",
        retryDelays: ASSURANCE_TRANSIENT_RETRY_DELAYS_MS,
        markTransientUnavailable: false,
        respectUnavailable: false,
      });
      const parsed = extractJson(raw);
      const repairedRows = Array.isArray(parsed.requirements) ? parsed.requirements : [];
      batch.forEach(({ row, index, sourceRow }, batchIndex) => {
        const repaired = normalizeSoftwareRow({
          ...row,
          ...repairedRows[batchIndex],
          id: row.id,
          sourceTraceId: row.sourceTraceId,
          linkedSourceCode: row.linkedSourceCode,
        }, index, cbaRows);
        repairedByIndex.set(index, looksLikeCodeEchoSoftwareRequirement(repaired, sourceRow) ? cleanCodeEchoSoftwareRequirement(row) : repaired);
      });
    } catch (error) {
      console.warn(`[xHandle AI] Software requirements rewrite rows ${start + 1}-${start + batch.length}/${repairItems.length} failed; keeping original AI rows.`, error);
      batch.forEach(({ row, index }) => repairedByIndex.set(index, cleanCodeEchoSoftwareRequirement(row)));
    }

    onProgress?.({
      phase: "Software requirements rewrite",
      completed: Math.min(repairItems.length, start + batch.length),
      total: repairItems.length,
      message: `Software requirement rewrite: rows ${start + 1}-${start + batch.length} of ${repairItems.length}`,
    });
  }

  return rows.map((row, index) => repairedByIndex.get(index) || row);
}

function generatedIdFor(prefix, rawId, index) {
  const value = cellText(rawId);
  return new RegExp(`^${prefix}-`, "i").test(value)
    ? value
    : `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function ensureUniqueGeneratedIds(rows = [], prefix = "ART") {
  const seen = new Set();
  const seenInternalIds = new Set();
  return rows.map((row, index) => {
    let id = generatedIdFor(prefix, row?.id, index);
    if (seen.has(id)) id = `${prefix}-${String(index + 1).padStart(3, "0")}`;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${prefix}-${String(index + 1).padStart(3, "0")}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    let internalId = cellText(row?.internalId);
    if (!internalId || seenInternalIds.has(internalId)) {
      internalId = makeId(prefix.toLowerCase());
    }
    seenInternalIds.add(internalId);
    return { ...row, id, internalId };
  });
}

function parentRequirementTexts(rows = []) {
  return new Set(rows.map((row) => cellText(row.requirementText).toLowerCase()).filter(Boolean));
}

function normalizedRequirementWords(text = "") {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "shall",
    "that",
    "the",
    "to",
    "when",
    "with",
  ]);
  return new Set(cellText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !stopWords.has(word)));
}

function requirementSimilarity(left = "", right = "") {
  const leftWords = normalizedRequirementWords(left);
  const rightWords = normalizedRequirementWords(right);
  if (!leftWords.size || !rightWords.size) return 0;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return union ? intersection / union : 0;
}

function parentRowsForGeneratedRow(row = {}, parentKey = "", sourceRows = []) {
  const sourceById = new Map(sourceRows.map((sourceRow) => [cellText(sourceRow.id), sourceRow]).filter(([id]) => id));
  return splitIds(row?.[parentKey]).map((id) => sourceById.get(id)).filter(Boolean);
}

function isTooSimilarToParent(rowText = "", parentRows = [], threshold = 0.58) {
  const text = cellText(rowText);
  if (!text) return false;
  return parentRows.some((parentRow) => {
    const parentText = cellText(parentRow.requirementText || parentRow.description);
    return parentText && requirementSimilarity(text, parentText) >= threshold;
  });
}

function summarizeParentIntent(rows = [], fallback = "the allocated capability") {
  const sourceText = compactList(rows.map((row) => (
    row.derivedFromFunction ||
    row.allocatedFunction ||
    row.derivedFromInterface ||
    row.allocatedArchitecture ||
    row.subsystem ||
    row.requirementType
  )));
  if (sourceText) return sourceText;
  const requirementText = compactList(rows.map((row) => cellText(row.requirementText).replace(/^the\s+(software|system|subsystem)\s+shall\s*/i, "")));
  return truncateForPrompt(requirementText, 180) || fallback;
}

function ensureRequirementPrefix(text = "", prefix = "The system shall") {
  const raw = cellText(text);
  if (!raw) return "";
  if (new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(raw)) return raw;
  if (/^the\s+.+?\s+subsystem\s+shall\b/i.test(raw) && /^the\s+subsystem\s+shall\b/i.test(prefix)) return raw;
  if (/^the\s+(software|system|subsystem)\s+shall\b/i.test(raw)) {
    return raw.replace(/^the\s+(software|system|subsystem)\s+shall\b/i, prefix);
  }
  return `${prefix} ${raw.charAt(0).toLowerCase()}${raw.slice(1)}`;
}

function stripRequirementLeadIn(text = "") {
  return cellText(text)
    .replace(/^the\s+(software|system|subsystem|application subsystem|.+?\s+subsystem)\s+shall\s+/i, "")
    .replace(/^shall\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/g, "");
}

function intentItems(text = "") {
  return cellText(text)
    .split(/\s*(?:,|;|\band\b)\s*/i)
    .map((item) => stripRequirementLeadIn(item))
    .filter((item) => item.length > 2);
}

function isEnumerationLike(text = "") {
  const raw = stripRequirementLeadIn(text);
  if (!raw) return false;
  const items = intentItems(raw);
  const titleCaseItems = items.filter((item) => /^[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){1,5}$/.test(item));
  return items.length >= 4 || titleCaseItems.length >= 3 || (raw.match(/,/g) || []).length >= 3;
}

function inferCapabilityFromIntent(text = "", fallback = "provide the required capability") {
  const raw = stripRequirementLeadIn(text);
  if (!raw) return fallback;
  if (isCodeSymbolOnly(raw)) return fallback;
  if (!isEnumerationLike(raw)) return raw;

  const lower = raw.toLowerCase();
  const hasIssue = /issue|request|review/.test(lower);
  const hasContribution = /code|coding|commit|pull request|contribution|sign off|submit/.test(lower);
  const hasBuild = /build|format|pre-commit|validate/.test(lower);
  const hasDocumentation = /document|documentation|oss|component/.test(lower);
  const hasEnvironment = /install|environment|setup|dependency|uv/.test(lower);
  const hasData = /data|record|schema|field|validate|transform|import|export/.test(lower);
  const hasAccess = /auth|login|credential|permission|role|access|session/.test(lower);
  const hasSafety = /hazard|safety|mitigation|critical|constraint|fault|failure/.test(lower);

  if (hasIssue && hasContribution) return "govern the repository contribution lifecycle";
  if (hasContribution && hasBuild) return "coordinate verified code contribution readiness";
  if (hasIssue) return "manage issue intake and review workflow";
  if (hasBuild) return "validate build and formatting readiness";
  if (hasDocumentation) return "maintain component documentation governance";
  if (hasEnvironment) return "manage developer environment setup";
  if (hasAccess) return "control authorized access workflow";
  if (hasData) return "manage validated data exchange";
  if (hasSafety) return "maintain safety control coverage";

  const words = raw
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 3 && !/^(create|review|follow|submit|enforce|run|format|commit|open|sign|certify|accept|ensure|validate|execute|install|setup|provide|request|code|shall|only|when|required|input|state|timing|interface|conditions)$/.test(word));
  const uniqueWords = [...new Set(words)].slice(0, 3);
  return uniqueWords.length
    ? `coordinate ${uniqueWords.join(" ")} workflow`
    : fallback;
}

function capabilityPhraseFromRows(rows = [], fallback = "the required capability") {
  const intent = summarizeParentIntent(rows, fallback);
  return inferCapabilityFromIntent(intent, fallback);
}

function isCodeSymbolOnly(value = "") {
  const raw = cellText(value).trim();
  if (!raw) return false;
  if (/^_{1,2}[a-z0-9_]+_{1,2}$/i.test(raw)) return true;
  if (/^[a-z_][a-z0-9_]*$/i.test(raw) && /_/.test(raw)) return true;
  if (/^(init|main|setup|handler|manager|controller|processor|service|module|class|function)$/i.test(raw)) return true;
  return false;
}

function readableCapability(value = "", fallback = "the required capability") {
  const raw = stripRequirementLeadIn(value);
  if (!raw || isCodeSymbolOnly(raw)) return fallback;
  return inferCapabilityFromIntent(raw, fallback);
}

function safetyInterfaceContext(row = {}, fallback = "the affected architecture interface") {
  const refs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const ref = refs[0] || {};
  const from = cellText(ref.fromFunction || row.derivedFromFunction || row.allocatedFunction);
  const action = cellText(ref.controlAction || row.derivedFromInterface);
  const to = cellText(ref.toFunction);
  if (from && action && to) return `${action} from ${from} to ${to}`;
  if (action && to) return `${action} to ${to}`;
  if (action) return action;
  if (from && to) return `${from} to ${to}`;
  const allocated = cellText(row.allocatedFunction);
  if (allocated && !isCodeSymbolOnly(allocated)) return allocated;
  const capability = readableCapability(row.requirementText || row.description, "");
  return capability || fallback;
}

function safetyHazardContext(row = {}, fallback = "the linked hazardous condition") {
  return readableCapability(row.parentHazard || row.safetyContext || row.linkedHazards || row.hazardSummaryRef, fallback);
}

function safetyMitigationContext(row = {}, fallback = "the required safety controls") {
  return readableCapability(row.mitigationStrategy || row.linkedVerification, fallback);
}

function safetySystemRequirementText(row = {}) {
  const hazard = safetyHazardContext(row);
  const interfaceContext = safetyInterfaceContext(row);
  const mitigation = safetyMitigationContext(row);
  return `The system shall detect and control ${hazard} for ${interfaceContext} by enforcing ${mitigation} before allowing safety-relevant operation to continue.`;
}

function safetySubsystemRequirementText(row = {}, subsystem = "") {
  const hazard = safetyHazardContext(row);
  const interfaceContext = safetyInterfaceContext(row);
  const mitigation = safetyMitigationContext(row);
  return `${subsystemSubject(subsystem)} shall validate ${interfaceContext}, apply ${mitigation}, and place the allocated function in a safe state when ${hazard} is detected.`;
}

function safetyDesignDescription(row = {}, componentName = "") {
  const name = cellText(componentName) || "SafetyControl";
  const hazard = safetyHazardContext(row);
  const interfaceContext = safetyInterfaceContext(row);
  const mitigation = safetyMitigationContext(row);
  return `The ${name} component evaluates ${interfaceContext} against ${mitigation}, blocks or flags unsafe execution, and records evidence when ${hazard} is detected.`;
}

function requirementPredicateFromIntent(intent = "", fallback = "provide the required capability") {
  const phrase = inferCapabilityFromIntent(intent, fallback);
  if (!phrase) return fallback;
  if (/^(provide|maintain|coordinate|govern|manage|control|preserve|support|prevent|detect|constrain|ensure|validate|calculate|execute|publish|receive|route|monitor|expose|transform|store|report|reduce|increase|limit|reject|accept)\b/i.test(phrase)) {
    return phrase.charAt(0).toLowerCase() + phrase.slice(1);
  }
  return `${fallback.replace(/\s+the required capability$/i, "")} ${phrase}`;
}

function subsystemSubject(subsystem = "") {
  const raw = cellText(subsystem).replace(/\s+subsystem$/i, "").trim();
  if (!raw || /^application$/i.test(raw)) return "The subsystem";
  return `The ${raw} subsystem`;
}

function pascalNameFromText(text = "", fallback = "CapabilityService") {
  const words = cellText(text)
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !/^(the|and|for|with|from|into|shall|system|subsystem|software|required|capability|responsibility|related|allocated|provide|maintain|ensure|support)$/i.test(word))
    .slice(0, 4);
  if (!words.length) return fallback;
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
  return /Service|Manager|Controller|Evaluator|Publisher|Adapter|Validator|Coordinator|Logic$/i.test(name)
    ? name
    : `${name}Service`;
}

function isOverSpecificDesignName(name = "") {
  const raw = cellText(name);
  if (!raw) return false;
  const actionHits = raw.match(/Create|Initiate|Review|Follow|Submit|Enforce|Run|Format|Commit|Open|Sign|Certify|Accept|Ensure|Validate|Install|Execute|Set/g) || [];
  return actionHits.length >= 3 || raw.length > 48;
}

function systemRequirementTextFromIntent(intent = "", safetyLinked = false) {
  const predicate = requirementPredicateFromIntent(intent, "provide");
  const safetyTail = safetyLinked && !/safe|safety|hazard|mitigation|constraint/i.test(predicate)
    ? " while maintaining the applicable safety constraints"
    : "";
  return `The system shall ${predicate}${safetyTail}.`;
}

function subsystemRequirementTextFromIntent(intent = "", subsystem = "", safetyLinked = false) {
  const predicate = requirementPredicateFromIntent(intent, "provide");
  const safetyTail = safetyLinked && !/safe|safety|hazard|mitigation|constraint/i.test(predicate)
    ? " while maintaining inherited safety constraints"
    : "";
  return `${subsystemSubject(subsystem)} shall ${predicate}${safetyTail}.`;
}

function designDescriptionFromIntent(intent = "", componentName = "") {
  const phrase = inferCapabilityFromIntent(intent, "the allocated subsystem capability");
  const name = cellText(componentName) || pascalNameFromText(phrase);
  if (/repository contribution lifecycle|code contribution readiness|issue intake/i.test(phrase)) {
    return `The ${name} component coordinates workflow state, review status, validation evidence, and completion outputs for ${phrase}.`;
  }
  return `The ${name} component coordinates interfaces, data handling, state checks, and outputs for ${phrase}.`;
}

function normalizeSystemRow(raw = {}, index, sourceRows = []) {
  const parentIds = compactList([
    raw.parentSwRequirement,
    raw.parentSwRequirements,
    raw.parentSoftwareRequirement,
    raw.parentSoftwareRequirements,
    raw.sourceSoftwareRequirementId,
    raw.sourceSoftwareRequirementIds,
  ]);
  const parentTokens = splitIds(parentIds || sourceRows[index]?.id || "");
  const architectureRefs = collectArchitectureRefsFromParents(parentTokens, sourceRows);
  const sourceById = new Map(sourceRows.map((row) => [cellText(row.id), row]).filter(([id]) => id));
  const parentRows = parentTokens.map((id) => sourceById.get(id)).filter(Boolean);
  const safetyContext = safetyContextFromParents(parentRows);
  const rawRequirementText = cellText(raw.requirementText);
  const safetyLinked = parentRows.some(isSafetyLinkedRow);
  const requirementText = isEnumerationLike(rawRequirementText)
      ? systemRequirementTextFromIntent(rawRequirementText, safetyLinked)
    : ensureRequirementPrefix(rawRequirementText, "The system shall");
  return createBaseArtifactRow(ARTIFACT_KINDS.SYSTEM, {
    id: generatedIdFor("SYS", raw.id, index),
    requirementText,
    derivedFrom: cellText(raw.derivedFrom) || "Software Requirements",
    parentSwRequirement: compactList(parentTokens),
    rationale: cellText(raw.rationale) || "AI-derived from linked software requirements.",
    verificationMethod: cellText(raw.verificationMethod) || "Analysis",
    traceLinks: parentTokens.map((id) => ({ targetType: "software-requirement", targetId: id, relationship: "consolidates" })),
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "ai-generated",
  }, index);
}

function normalizeSubsystemRow(raw = {}, index, sourceRows = []) {
  const parentIds = compactList([
    raw.parentSystemRequirement,
    raw.parentSystemRequirements,
    raw.parentSysRequirement,
    raw.parentSysRequirements,
    raw.sourceSystemRequirementId,
    raw.sourceSystemRequirementIds,
  ]);
  const parentTokens = splitIds(parentIds || sourceRows[index]?.id || "");
  const architectureRefs = collectArchitectureRefsFromParents(parentTokens, sourceRows);
  const sourceById = new Map(sourceRows.map((row) => [cellText(row.id), row]).filter(([id]) => id));
  const parentRows = parentTokens.map((id) => sourceById.get(id)).filter(Boolean);
  const safetyContext = safetyContextFromParents(parentRows);
  const inheritedFunction = allocatedFunctionFromRefs(architectureRefs);
  const inheritedArchitecture = allocatedArchitectureFromRefs(architectureRefs);
  const subsystem = cellText(raw.subsystem) || "Application Subsystem";
  const rawRequirementText = cellText(raw.requirementText);
  const safetyLinked = parentRows.some(isSafetyLinkedRow);
  const requirementText = isEnumerationLike(rawRequirementText)
      ? subsystemRequirementTextFromIntent(rawRequirementText, subsystem, safetyLinked)
    : ensureRequirementPrefix(rawRequirementText, "The subsystem shall");
  return createBaseArtifactRow(ARTIFACT_KINDS.SUBSYSTEM, {
    id: generatedIdFor("SUB", raw.id, index),
    subsystem,
    requirementText,
    parentSystemRequirement: compactList(parentTokens),
    allocatedFunction: cellText(raw.allocatedFunction) || inheritedFunction,
    allocatedArchitecture: cellText(raw.allocatedArchitecture || raw.allocatedCsciCscCsu) || inheritedArchitecture,
    rationale: cellText(raw.rationale) || "AI-derived from linked system requirements.",
    verificationMethod: cellText(raw.verificationMethod) || "Analysis",
    traceLinks: parentTokens.map((id) => ({ targetType: "system-requirement", targetId: id, relationship: "allocates" })),
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "ai-generated",
  }, index);
}

function normalizeDesignRow(raw = {}, index, sourceRows = []) {
  const parentIds = compactList([
    raw.parentRequirement,
    raw.parentRequirements,
    raw.parentSubsystemRequirement,
    raw.parentSubsystemRequirements,
    raw.sourceRequirementId,
    raw.sourceRequirementIds,
  ]);
  const parentTokens = splitIds(parentIds || sourceRows[index]?.id || "");
  const architectureRefs = collectArchitectureRefsFromParents(parentTokens, sourceRows);
  const parentRowsById = new Map(sourceRows.map((row) => [cellText(row.id), row]).filter(([id]) => id));
  const parentRows = parentTokens.map((id) => parentRowsById.get(id)).filter(Boolean);
  const safetyContext = safetyContextFromParents(parentRows);
  const parentAllocatedFunction = compactList(parentRows.map((row) => row.allocatedFunction));
  const parentAllocatedArchitecture = compactList(parentRows.map((row) => row.allocatedArchitecture));
  const inheritedFunction = parentAllocatedFunction || allocatedFunctionFromRefs(architectureRefs);
  const inheritedArchitecture = parentAllocatedArchitecture || allocatedArchitectureFromRefs(architectureRefs);
  const inheritedSourceFiles = sourceFilesFromRefs(architectureRefs);
  const inheritedInterfaces = compactList((architectureRefs || []).map((ref) =>
    compactList([ref.controlAction, ref.toFunction])
  ));
  const parentRequirementText = compactList(parentRows.map((row) => row.requirementText));
  const rawDescription = cellText(
    raw.description ||
    raw.designDescription ||
    raw.designResponsibility ||
    raw.responsibility ||
    raw.behavior ||
    raw.designBehavior ||
    raw.summary
  );
  const candidateDesignName = cellText(raw.designElementName || raw.name);
  const designElementName = candidateDesignName && !isOverSpecificDesignName(candidateDesignName) && !isEnumerationLike(rawDescription)
    ? candidateDesignName
    : pascalNameFromText(inferCapabilityFromIntent(rawDescription || parentRequirementText || inheritedFunction), `DesignElement${index + 1}`);
  const description = rawDescription && !isEnumerationLike(rawDescription)
    ? rawDescription
    : designDescriptionFromIntent(rawDescription || parentRequirementText || "the linked subsystem requirement", designElementName);
  return createBaseArtifactRow(ARTIFACT_KINDS.DESIGN, {
    id: generatedIdFor("DES", raw.id, index),
    designElementName,
    designLevel: cellText(raw.designLevel) || "Subsystem",
    description,
    parentRequirement: compactList(parentTokens),
    allocatedFunction: cellText(raw.allocatedFunction) || inheritedFunction,
    allocatedArchitecture: cellText(raw.allocatedArchitecture || raw.allocatedCsciCscCsu) || inheritedArchitecture,
    interfaceDependencies: cellText(raw.interfaceDependencies) || inheritedInterfaces,
    designRationale: cellText(raw.designRationale || raw.rationale) || "AI-derived from linked subsystem requirements.",
    linkedSourceCode: cellText(raw.linkedSourceCode) || inheritedSourceFiles,
    traceLinks: parentTokens.map((id) => ({ targetType: "subsystem-requirement", targetId: id, relationship: "satisfies" })),
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "ai-generated",
  }, index);
}

function fallbackSoftwareRequirement(row = {}, index = 0) {
  const architectureRef = architectureRefFromFunctionalRow(row, index, "edge");
  const sourceId = row.traceId || row.rowRef || String(index + 1);
  const action = cellText(row.action || row.controlAction) || "the control action";
  const target = cellText(row.to || row.toFunction) || "the receiving function";
  return createBaseArtifactRow(ARTIFACT_KINDS.SOFTWARE, {
    id: `SWR-${String(index + 1).padStart(3, "0")}`,
    requirementText: `The software shall provide ${action} to ${target} only when the required input, state, timing, and interface conditions are satisfied.`,
    derivedFromFunction: compactList([row.from || row.fromFunction, row.to || row.toFunction]),
    derivedFromInterface: action,
    requirementType: "Functional",
    priority: "Medium",
    rationale: "Locally derived fallback from the code-based functional decomposition row.",
    linkedSourceCode: compactList([row.fromFile, row.toFile]),
    sourceTraceId: sourceId,
    traceLinks: [
      { targetType: "functional-row", targetId: sourceId, relationship: "derived-from" },
      { targetType: "architecture-edge", targetId: architectureRef.edgeId || sourceId, relationship: "derived-from" },
    ],
    sourceArchitectureRefs: [architectureRef],
    source: "functional-derived-fallback",
  }, index);
}

function fallbackSystemRequirement(row = {}, index = 0) {
  const architectureRefs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const parentId = cellText(row.id);
  const safetyContext = safetyContextFromParents([row]);
  const capability = capabilityPhraseFromRows([row], "provide the software-supported capability");
  return createBaseArtifactRow(ARTIFACT_KINDS.SYSTEM, {
    id: `SYS-${String(index + 1).padStart(3, "0")}`,
    requirementText: systemRequirementTextFromIntent(capability, isSafetyLinkedRow(row)),
    derivedFrom: "Software Requirements",
    parentSwRequirement: parentId,
    rationale: "Locally derived as a higher-level system obligation from the linked software requirement.",
    verificationMethod: "Analysis",
    traceLinks: parentId ? [{ targetType: "software-requirement", targetId: parentId, relationship: "consolidates" }] : [],
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "code-derived-fallback",
  }, index);
}

function fallbackSubsystemRequirement(row = {}, index = 0) {
  const architectureRefs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const parentId = cellText(row.id);
  const safetyContext = safetyContextFromParents([row]);
  const subsystem = architectureRefs[0]?.subsystem || "Application Subsystem";
  const capability = capabilityPhraseFromRows([row], "provide the allocated system capability");
  return createBaseArtifactRow(ARTIFACT_KINDS.SUBSYSTEM, {
    id: `SUB-${String(index + 1).padStart(3, "0")}`,
    subsystem,
    requirementText: subsystemRequirementTextFromIntent(capability, subsystem, isSafetyLinkedRow(row)),
    parentSystemRequirement: parentId,
    allocatedFunction: allocatedFunctionFromRefs(architectureRefs),
    allocatedArchitecture: allocatedArchitectureFromRefs(architectureRefs),
    rationale: "Locally derived as an allocated subsystem responsibility from the linked system requirement.",
    verificationMethod: "Analysis",
    traceLinks: parentId ? [{ targetType: "system-requirement", targetId: parentId, relationship: "allocates" }] : [],
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "code-derived-fallback",
  }, index);
}

function fallbackDesignElement(row = {}, index = 0) {
  const architectureRefs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const parentId = cellText(row.id);
  const safetyContext = safetyContextFromParents([row]);
  const subsystem = cellText(row.subsystem) || architectureRefs[0]?.subsystem || "Application Subsystem";
  const capability = capabilityPhraseFromRows([row], "the allocated subsystem capability");
  const designElementName = pascalNameFromText(compactList([subsystem, capability]), `${subsystem}Service`);
  return createBaseArtifactRow(ARTIFACT_KINDS.DESIGN, {
    id: `DES-${String(index + 1).padStart(3, "0")}`,
    designElementName,
    designLevel: "Subsystem",
    description: designDescriptionFromIntent(capability, designElementName),
    parentRequirement: parentId,
    allocatedFunction: cellText(row.allocatedFunction) || allocatedFunctionFromRefs(architectureRefs),
    allocatedArchitecture: cellText(row.allocatedArchitecture) || allocatedArchitectureFromRefs(architectureRefs),
    interfaceDependencies: compactList((architectureRefs || []).map((ref) => compactList([ref.controlAction, ref.toFunction]))),
    designRationale: "Locally derived as a design-level responsibility from the linked subsystem requirement.",
    linkedSourceCode: sourceFilesFromRefs(architectureRefs),
    traceLinks: parentId ? [{ targetType: "subsystem-requirement", targetId: parentId, relationship: "satisfies" }] : [],
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "code-derived-fallback",
  }, index);
}

function fallbackSystemRequirementFromSafetySw(row = {}, index = 0) {
  const architectureRefs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const safetyContext = safetyContextFromParents([row]);
  return createBaseArtifactRow(ARTIFACT_KINDS.SYSTEM, {
    id: `SYS-SAFE-${String(index + 1).padStart(3, "0")}`,
    requirementText: safetySystemRequirementText({ ...row, ...safetyContext, sourceArchitectureRefs: architectureRefs }),
    derivedFrom: "Software Safety Requirement",
    parentSwRequirement: row.id,
    rationale: cellText(row.rationale) || "Derived to preserve coverage of a software safety requirement.",
    verificationMethod: cellText(row.linkedVerification) || "Analysis",
    traceLinks: [{ targetType: "software-requirement", targetId: row.id, relationship: "consolidates-safety-requirement" }],
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "code-derived",
  }, index);
}

function fallbackSubsystemRequirementFromSafetySystem(row = {}, index = 0) {
  const architectureRefs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const safetyContext = safetyContextFromParents([row]);
  const subsystem = architectureRefs[0]?.subsystem || "Application Subsystem";
  return createBaseArtifactRow(ARTIFACT_KINDS.SUBSYSTEM, {
    id: `SUB-SAFE-${String(index + 1).padStart(3, "0")}`,
    subsystem,
    requirementText: safetySubsystemRequirementText({ ...row, ...safetyContext, sourceArchitectureRefs: architectureRefs }, subsystem),
    parentSystemRequirement: row.id,
    allocatedFunction: allocatedFunctionFromRefs(architectureRefs),
    allocatedArchitecture: allocatedArchitectureFromRefs(architectureRefs),
    rationale: cellText(row.rationale) || "Derived to preserve subsystem coverage of a safety-related system requirement.",
    verificationMethod: cellText(row.verificationMethod) || "Analysis",
    traceLinks: [{ targetType: "system-requirement", targetId: row.id, relationship: "allocates-safety-requirement" }],
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "code-derived",
  }, index);
}

function fallbackDesignElementFromSafetySubsystem(row = {}, index = 0) {
  const architectureRefs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const safetyContext = safetyContextFromParents([row]);
  const allocatedFunction = cellText(row.allocatedFunction) || allocatedFunctionFromRefs(architectureRefs);
  const capability = readableCapability(safetyInterfaceContext(row, allocatedFunction), "Safety Control");
  const designElementName = pascalNameFromText(compactList([row.subsystem, capability, "Safety Control"]), `${cellText(row.subsystem) || "Subsystem"}SafetyControl`);
  return createBaseArtifactRow(ARTIFACT_KINDS.DESIGN, {
    id: `DES-SAFE-${String(index + 1).padStart(3, "0")}`,
    designElementName,
    designLevel: "Subsystem",
    description: safetyDesignDescription({ ...row, ...safetyContext, sourceArchitectureRefs: architectureRefs }, designElementName),
    parentRequirement: row.id,
    allocatedFunction,
    allocatedArchitecture: cellText(row.allocatedArchitecture) || allocatedArchitectureFromRefs(architectureRefs),
    interfaceDependencies: compactList((architectureRefs || []).map((ref) => compactList([ref.controlAction, ref.toFunction]))),
    designRationale: cellText(row.rationale) || "Derived to preserve design coverage of a safety-related subsystem requirement.",
    linkedSourceCode: sourceFilesFromRefs(architectureRefs),
    traceLinks: [{ targetType: "subsystem-requirement", targetId: row.id, relationship: "satisfies-safety-requirement" }],
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
    source: "code-derived",
  }, index);
}

function firstPassRowsForMissingParents(firstPassRows = [], missingRows = [], parentKey = "") {
  return missingRows.map((missingRow) => {
    const missingId = cellText(missingRow.id);
    return firstPassRows.find((row) => splitIds(row?.[parentKey]).includes(missingId));
  }).filter(Boolean);
}

function categoryParentFieldForTarget(targetKind = "") {
  if (targetKind === ARTIFACT_KINDS.SYSTEM) return "parentSwRequirement";
  if (targetKind === ARTIFACT_KINDS.SUBSYSTEM) return "parentSystemRequirement";
  if (targetKind === ARTIFACT_KINDS.DESIGN) return "parentRequirement";
  return "parentRequirement";
}

function categorySourceLabelForTarget(targetKind = "") {
  if (targetKind === ARTIFACT_KINDS.SYSTEM) return "software requirements";
  if (targetKind === ARTIFACT_KINDS.SUBSYSTEM) return "system requirements";
  if (targetKind === ARTIFACT_KINDS.DESIGN) return "subsystem requirements";
  return "requirements";
}

function categoryTargetLabel(targetKind = "") {
  if (targetKind === ARTIFACT_KINDS.SYSTEM) return "system requirements";
  if (targetKind === ARTIFACT_KINDS.SUBSYSTEM) return "subsystem requirements";
  if (targetKind === ARTIFACT_KINDS.DESIGN) return "system/subsystem design elements";
  return "requirements";
}

function categoryPrefixForTarget(targetKind = "") {
  if (targetKind === ARTIFACT_KINDS.SYSTEM) return "SYS-CAT";
  if (targetKind === ARTIFACT_KINDS.SUBSYSTEM) return "SUB-CAT";
  if (targetKind === ARTIFACT_KINDS.DESIGN) return "DES-CAT";
  return "CAT";
}

function normalizeRequirementCategory(raw = {}, index = 0, targetKind = "", sourceRows = []) {
  const parentField = categoryParentFieldForTarget(targetKind);
  const explicitParents = compactList([
    raw[parentField],
    raw.parentIds,
    raw.parentRequirementIds,
    raw.sourceRequirementIds,
    raw.sourceIds,
  ]);
  const parentIds = compactList(splitIds(explicitParents || sourceRows[index]?.id || ""));
  const parentRowsById = new Map(sourceRows.map((row) => [cellText(row.id), row]).filter(([id]) => id));
  const parentRows = splitIds(parentIds).map((id) => parentRowsById.get(id)).filter(Boolean);
  const safetyContext = safetyContextFromParents(parentRows);
  const architectureRefs = collectArchitectureRefsFromParents(splitIds(parentIds), sourceRows);
  const categoryName = cellText(raw.categoryName || raw.name || raw.title) || `Requirement Category ${index + 1}`;
  const categoryDescription = cellText(raw.categoryDescription || raw.description) ||
    `Consolidates related ${categorySourceLabelForTarget(targetKind)} into ${categoryTargetLabel(targetKind)}.`;
  return {
    id: cellText(raw.id) || `${categoryPrefixForTarget(targetKind)}-${String(index + 1).padStart(3, "0")}`,
    categoryName,
    categoryDescription,
    requirementIntent: inferCapabilityFromIntent(cellText(raw.requirementIntent || raw.intent || raw.text) || categoryDescription, categoryDescription),
    [parentField]: parentIds,
    subsystem: cellText(raw.subsystem) || compactList(parentRows.map((row) => row.subsystem)),
    allocatedFunction: cellText(raw.allocatedFunction) || compactList(parentRows.map((row) => row.allocatedFunction || row.derivedFromFunction)),
    allocatedArchitecture: cellText(raw.allocatedArchitecture) || compactList(parentRows.map((row) => row.allocatedArchitecture)),
    representativeRequirements: cellText(raw.representativeRequirements) || compactList(parentRows.slice(0, 5).map((row) => row.id)),
    sourceArchitectureRefs: architectureRefs,
    ...safetyContext,
  };
}

function locallyCategorizeRequirementRows(sourceRows = [], targetKind = "", targetCount = 1) {
  const parentField = categoryParentFieldForTarget(targetKind);
  return rowsGroupedToTarget(sourceRows, targetCount).map((group, index) => {
    const parentIds = compactList(group.map((row) => row.id));
    const capability = capabilityPhraseFromRows(group, `related ${categorySourceLabelForTarget(targetKind)}`);
    const architectureRefs = uniqueArchitectureRefs(group);
    const safetyContext = safetyContextFromParents(group);
    return {
      id: `${categoryPrefixForTarget(targetKind)}-${String(index + 1).padStart(3, "0")}`,
      categoryName: `Consolidated ${categoryTargetLabel(targetKind)} Category ${index + 1}`,
      categoryDescription: `Groups ${categorySourceLabelForTarget(targetKind)} that share the intent to ${requirementPredicateFromIntent(capability, "provide")}.`,
      requirementIntent: capability,
      [parentField]: parentIds,
      subsystem: compactList(group.map((row) => row.subsystem)),
      allocatedFunction: compactList(group.map((row) => row.allocatedFunction || row.derivedFromFunction)),
      allocatedArchitecture: compactList(group.map((row) => row.allocatedArchitecture)) || allocatedArchitectureFromRefs(architectureRefs),
      representativeRequirements: compactList(group.slice(0, 5).map((row) => row.id)),
      sourceArchitectureRefs: architectureRefs,
      ...safetyContext,
    };
  });
}

function ensureUniqueCategoryIds(categories = [], targetKind = "") {
  const prefix = categoryPrefixForTarget(targetKind);
  const seen = new Set();
  return categories.map((category, index) => {
    let id = cellText(category?.id);
    if (!new RegExp(`^${prefix}-`, "i").test(id) || seen.has(id)) {
      id = `${prefix}-${String(index + 1).padStart(3, "0")}`;
    }
    let suffix = 2;
    while (seen.has(id)) {
      id = `${prefix}-${String(index + 1).padStart(3, "0")}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    return { ...category, id };
  });
}

function pruneDuplicateCategoryParents(categories = [], sourceRows = [], targetKind = "") {
  const parentField = categoryParentFieldForTarget(targetKind);
  const sourceById = new Map(sourceRows.map((row) => [cellText(row.id), row]).filter(([id]) => id));
  const assigned = new Set();
  return categories.flatMap((category) => {
    const parentIds = splitIds(category?.[parentField])
      .filter((id) => sourceById.has(id) && !assigned.has(id));
    if (!parentIds.length) return [];
    parentIds.forEach((id) => assigned.add(id));
    const parentRows = parentIds.map((id) => sourceById.get(id)).filter(Boolean);
    const architectureRefs = collectArchitectureRefsFromParents(parentIds, sourceRows);
    return [{
      ...category,
      [parentField]: compactList(parentIds),
      representativeRequirements: compactList(parentIds.slice(0, 5)),
      subsystem: cellText(category.subsystem) || compactList(parentRows.map((row) => row.subsystem)),
      allocatedFunction: cellText(category.allocatedFunction) || compactList(parentRows.map((row) => row.allocatedFunction || row.derivedFromFunction)),
      allocatedArchitecture: cellText(category.allocatedArchitecture) || compactList(parentRows.map((row) => row.allocatedArchitecture)) || allocatedArchitectureFromRefs(architectureRefs),
      sourceArchitectureRefs: architectureRefs,
      ...safetyContextFromParents(parentRows),
    }];
  });
}

function ensureCategoryCoverage(categories = [], sourceRows = [], targetKind = "", targetCount = 1) {
  const parentField = categoryParentFieldForTarget(targetKind);
  const prunedCategories = pruneDuplicateCategoryParents(categories, sourceRows, targetKind);
  const covered = parentIdsCovered(prunedCategories, parentField);
  const missingRows = sourceRows.filter((row) => row.id && !covered.has(cellText(row.id)));
  const repaired = missingRows.length
    ? [
      ...prunedCategories,
      ...locallyCategorizeRequirementRows(missingRows, targetKind, Math.max(1, Math.min(missingRows.length, targetCount))),
    ]
    : prunedCategories;
  const resized = enforceMaxRows(repaired, targetCount, (rows, count) => locallyCategorizeRequirementRows(rows.flatMap((row) => {
    const parentRowsById = new Map(sourceRows.map((sourceRow) => [cellText(sourceRow.id), sourceRow]).filter(([id]) => id));
    return splitIds(row?.[parentField]).map((id) => parentRowsById.get(id)).filter(Boolean);
  }), targetKind, count));
  const finalPruned = pruneDuplicateCategoryParents(resized, sourceRows, targetKind);
  const finalCovered = parentIdsCovered(finalPruned, parentField);
  const finalMissingRows = sourceRows.filter((row) => row.id && !finalCovered.has(cellText(row.id)));
  const finalRows = finalMissingRows.length
    ? [
      ...finalPruned,
      ...locallyCategorizeRequirementRows(finalMissingRows, targetKind, Math.max(1, Math.min(finalMissingRows.length, targetCount))),
    ]
    : finalPruned;
  return ensureUniqueCategoryIds(finalRows, targetKind);
}

async function requestRequirementCategories({
  sourceRows = [],
  targetKind = "",
  projectName = "",
  repoName = "",
  targetRatio = 0.5,
  onProgress = null,
}) {
  if (!Array.isArray(sourceRows) || !sourceRows.length) return [];
  const sourceLabel = categorySourceLabelForTarget(targetKind);
  const targetLabel = categoryTargetLabel(targetKind);
  const parentField = categoryParentFieldForTarget(targetKind);
  const targetCount = Math.max(1, Math.ceil(sourceRows.length * targetRatio));
  const compactSourceRow = targetKind === ARTIFACT_KINDS.SYSTEM
    ? compactRequirementTextRowForPrompt
    : compactArtifactRowForPrompt;
  if (isAssuranceAIUnavailable()) {
    console.warn(`⚠️ ${targetLabel} category AI skipped; using local requirement categories while the AI service is temporarily unavailable.`);
    return locallyCategorizeRequirementRows(sourceRows, targetKind, targetCount);
  }
  const categorySchema = {
    categories: [{
      id: `${categoryPrefixForTarget(targetKind)}-001`,
      categoryName: "Capability or responsibility category",
      categoryDescription: "What source requirements have in common",
      requirementIntent: `Concise higher-level capability that drives ${targetLabel}, not a comma-separated action list`,
      [parentField]: "comma-separated source requirement ids covered by this category",
      subsystem: "Subsystem if supported",
      allocatedFunction: "Function or responsibility if supported",
      allocatedArchitecture: "CSCI / CSC / CSU if supported",
      representativeRequirements: "Example source ids",
    }],
  };

  const draftPayload = {
    task: `categorize_${sourceLabel.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_for_${targetLabel.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    projectName,
    repoName,
    sourceRowCount: sourceRows.length,
    targetCategoryCount: targetCount,
    instructions: [
      `Scan all provided ${sourceLabel} and group them into categories that should drive the next layer of ${targetLabel}.`,
      targetKind === ARTIFACT_KINDS.SYSTEM
        ? "The source rows intentionally include only requirement ids and Requirement Text values from the Software Requirements table; base grouping only on those requirementText values."
        : "Use the provided source row fields to support category grouping where they are present.",
      "A category should represent a shared capability, responsibility, safety concern, interface boundary, data obligation, operational outcome, subsystem allocation, or design responsibility.",
      "Name categories in domain language, not bookkeeping language. Prefer names like Obstacle Tracking, Collision Risk Evaluation, Brake Command Dispatch, Authentication Flow, Data Validation, or Review Workflow.",
      "The requirementIntent must summarize what the grouped source requirements collectively require, including supported triggers, inputs, outputs, data fields, rates, latencies, constraints, or safety conditions when they are present in the source rows.",
      "Do not make requirementIntent a comma-separated inventory of source actions. Collapse action lists into one abstract capability such as repository contribution governance, validated data exchange, build readiness validation, or access control workflow.",
      "Do not create one category per source row unless the source row is truly unrelated to every other row.",
      `Aim for approximately ${targetCount} categories.`,
      `Every source requirement id must appear in exactly one ${parentField} value across the returned categories.`,
      "Keep safety-related source rows represented; safety rows may be grouped with related non-safety rows only when the safety intent remains explicit.",
      "Return only valid JSON matching the requested schema.",
    ],
    schema: categorySchema,
  };

  const drafted = await requestAssuranceConsolidationRows({
    basePayload: draftPayload,
    rowKey: "sourceRequirements",
    rows: sourceRows,
    compactRow: compactSourceRow,
    responseKey: "categories",
    systemPrompt: `You are a senior systems engineer categorizing ${sourceLabel} for reverse-engineering ${targetLabel}. Create conceptual categories that reduce complexity while preserving parent requirement traceability. Return only valid JSON matching the requested schema.`,
    errorLabel: `${targetLabel} category scan`,
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress,
  });

  const draftCategories = drafted
    .map((row, index) => normalizeRequirementCategory(row || {}, index, targetKind, sourceRows))
    .filter((row) => cellText(row[parentField]));
  const coveredDrafts = ensureCategoryCoverage(
    draftCategories.length ? draftCategories : locallyCategorizeRequirementRows(sourceRows, targetKind, targetCount),
    sourceRows,
    targetKind,
    targetCount
  );

  const reviewPayload = {
    task: `review_${targetLabel.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_categories`,
    projectName,
    repoName,
    sourceCategoryCount: coveredDrafts.length,
    targetCategoryCount: targetCount,
    instructions: [
      "Review the draft categories as a second scan.",
      "Merge categories that represent the same higher-level capability or responsibility.",
      "Move parent ids into a better category when the grouping is wrong.",
      "Split a category only when it combines unrelated obligations that would produce unclear upper-level artifacts.",
      "Improve category names and requirementIntent so the next derivation can produce readable, domain-specific requirements rather than generic consolidation text.",
      "Reject comma-separated action inventories. A reviewed category should have one synthesized capability intent, not a list of source row labels.",
      `Keep approximately ${targetCount} categories unless there is a strong traceability reason to differ.`,
      `Every source requirement id already present in the draft categories must remain covered in ${parentField}.`,
      "Return only valid JSON matching the requested schema.",
    ],
    schema: categorySchema,
  };

  const reviewed = await requestAssuranceConsolidationRows({
    basePayload: reviewPayload,
    rowKey: "draftCategories",
    rows: coveredDrafts,
    compactRow: compactRequirementCategoryForPrompt,
    responseKey: "categories",
    systemPrompt: `You are a senior systems engineer reviewing requirement categories before deriving ${targetLabel}. Improve category boundaries, merge duplicates, and preserve traceability. Return only valid JSON matching the requested schema.`,
    errorLabel: `${targetLabel} category review`,
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress,
  });

  const reviewedCategories = reviewed
    .map((row, index) => normalizeRequirementCategory(row || {}, index, targetKind, sourceRows))
    .filter((row) => cellText(row[parentField]));
  const coveredReviewed = ensureCategoryCoverage(
    reviewedCategories.length ? reviewedCategories : coveredDrafts,
    sourceRows,
    targetKind,
    targetCount
  );
  return ensureMinimumCategoryCount(coveredReviewed, sourceRows, targetKind, targetCount);
}

function rowsGroupedToTarget(rows = [], targetCount = 1) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!safeRows.length) return [];
  const safeTarget = Math.max(1, Math.min(targetCount, safeRows.length));
  const groupSize = Math.ceil(safeRows.length / safeTarget);
  const groups = [];
  for (let index = 0; index < safeRows.length; index += groupSize) {
    groups.push(safeRows.slice(index, index + groupSize));
  }
  return groups;
}

function minimumRowsForTarget(sourceCount = 0, targetKind = "") {
  if (!sourceCount) return 0;
  if (targetKind === ARTIFACT_KINDS.SYSTEM) {
    return Math.max(1, Math.ceil(sourceCount * 0.35));
  }
  if (targetKind === ARTIFACT_KINDS.SUBSYSTEM) {
    return Math.max(1, Math.ceil(sourceCount * 0.30));
  }
  if (targetKind === ARTIFACT_KINDS.DESIGN) {
    return Math.max(1, Math.ceil(sourceCount * 0.25));
  }
  return 1;
}

function ensureMinimumCategoryCount(categories = [], sourceRows = [], targetKind = "", targetCount = 1) {
  const minimumCount = Math.min(
    targetCount,
    sourceRows.length,
    minimumRowsForTarget(sourceRows.length, targetKind)
  );
  if (categories.length >= minimumCount) return categories;

  return locallyCategorizeRequirementRows(sourceRows, targetKind, minimumCount);
}

function uniqueArchitectureRefs(rows = []) {
  const seen = new Set();
  const refs = [];
  rows.flatMap((row) => Array.isArray(row?.sourceArchitectureRefs) ? row.sourceArchitectureRefs : []).forEach((ref) => {
    const key = [
      ref?.traceId,
      ref?.rowRef,
      ref?.rowIndex,
      ref?.fromNodeId,
      ref?.edgeId,
      ref?.toNodeId,
      ref?.mode,
    ].map(cellText).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  });
  return refs;
}

function uniqueTraceLinks(rows = []) {
  const seen = new Set();
  const links = [];
  rows.flatMap((row) => Array.isArray(row?.traceLinks) ? row.traceLinks : []).forEach((link) => {
    const key = [
      link?.targetType,
      link?.targetId,
      link?.relationship,
    ].map(cellText).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  });
  return links;
}

function combinedParentIds(rows = [], parentKey = "") {
  return compactList(rows.flatMap((row) => splitIds(row?.[parentKey])));
}

function artifactTextForDuplicateScan(kind = "", row = {}) {
  if (kind === ARTIFACT_KINDS.DESIGN) {
    return cellText(row.description || row.designElementName);
  }
  return cellText(row.requirementText || row.description);
}

function canonicalArtifactText(kind = "", row = {}) {
  const text = artifactTextForDuplicateScan(kind, row);
  const capability = inferCapabilityFromIntent(text, text);
  return stripRequirementLeadIn(capability)
    .toLowerCase()
    .replace(/\b(the|a|an|shall|system|subsystem|software|component)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function duplicateScanParentField(kind = "") {
  if (kind === ARTIFACT_KINDS.SYSTEM) return "parentSwRequirement";
  if (kind === ARTIFACT_KINDS.SUBSYSTEM) return "parentSystemRequirement";
  if (kind === ARTIFACT_KINDS.DESIGN) return "parentRequirement";
  return "";
}

function shouldMergeArtifactRows(kind = "", left = {}, right = {}) {
  const leftKey = canonicalArtifactText(kind, left);
  const rightKey = canonicalArtifactText(kind, right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  return requirementSimilarity(leftKey, rightKey) >= 0.92;
}

function mergeArtifactRows(kind = "", left = {}, right = {}) {
  const parentField = duplicateScanParentField(kind);
  const merged = {
    ...left,
    sourceArchitectureRefs: uniqueArchitectureRefs([left, right]),
    traceLinks: uniqueTraceLinks([left, right]),
  };

  if (parentField) {
    merged[parentField] = compactList([
      ...splitIds(left[parentField]),
      ...splitIds(right[parentField]),
    ]);
  }

  [
    "sourceTraceId",
    "derivedFromFunction",
    "derivedFromInterface",
    "linkedSourceCode",
    "linkedHazards",
    "parentHazard",
    "mitigationStrategy",
    "criticalitySeverity",
    "linkedVerification",
    "linkedTests",
    "safetyContext",
    "hazardSummaryRef",
    "allocatedFunction",
    "allocatedArchitecture",
    "interfaceDependencies",
    "subsystem",
  ].forEach((field) => {
    merged[field] = compactList([left[field], right[field]]);
  });

  if (kind === ARTIFACT_KINDS.DESIGN) {
    merged.designRationale = compactList([left.designRationale, right.designRationale]) || left.designRationale || right.designRationale;
    merged.linkedSourceCode = compactList([left.linkedSourceCode, right.linkedSourceCode]);
  } else {
    merged.rationale = compactList([left.rationale, right.rationale]) || left.rationale || right.rationale;
    merged.verificationMethod = compactList([left.verificationMethod, right.verificationMethod]) || left.verificationMethod || right.verificationMethod;
  }

  return merged;
}

function finalDeduplicateArtifactRows(rows = [], kind = "", minimumRows = 1) {
  const safeRows = rows.filter(Boolean);
  if (safeRows.length <= minimumRows) return safeRows;
  const mergedRows = [];
  safeRows.forEach((row, index) => {
    const matchIndex = mergedRows.findIndex((candidate) => shouldMergeArtifactRows(kind, candidate, row));
    const remainingRows = safeRows.length - index - 1;
    const canMergeWithoutOverCompressing = mergedRows.length + remainingRows >= minimumRows;
    if (matchIndex >= 0 && canMergeWithoutOverCompressing) {
      mergedRows[matchIndex] = mergeArtifactRows(kind, mergedRows[matchIndex], row);
    } else {
      mergedRows.push(row);
    }
  });
  return mergedRows;
}

function locallyConsolidateSystemRows(rows = [], targetCount = 1) {
  return rowsGroupedToTarget(rows, targetCount).map((group, index) => {
    const parentSwRequirement = combinedParentIds(group, "parentSwRequirement");
    const architectureRefs = uniqueArchitectureRefs(group);
    const capability = capabilityPhraseFromRows(group, "provide related software-supported behavior");
    const safetyContext = safetyContextFromParents(group);
    return createBaseArtifactRow(ARTIFACT_KINDS.SYSTEM, {
      id: `SYS-${String(index + 1).padStart(3, "0")}`,
      requirementText: systemRequirementTextFromIntent(capability, group.some(isSafetyLinkedRow)),
      derivedFrom: "Software Requirements",
      parentSwRequirement,
      rationale: "Second-pass local consolidation of related software-derived system requirement candidates.",
      verificationMethod: compactList(group.map((row) => row.verificationMethod)) || "Analysis",
      traceLinks: splitIds(parentSwRequirement).map((id) => ({ targetType: "software-requirement", targetId: id, relationship: "consolidates" })),
      sourceArchitectureRefs: architectureRefs,
      ...safetyContext,
      source: "ai-consolidated-fallback",
    }, index);
  });
}

function locallyConsolidateSubsystemRows(rows = [], targetCount = 1) {
  return rowsGroupedToTarget(rows, targetCount).map((group, index) => {
    const parentSystemRequirement = combinedParentIds(group, "parentSystemRequirement");
    const architectureRefs = uniqueArchitectureRefs(group);
    const subsystem = compactList(group.map((row) => row.subsystem)) || "Application Subsystem";
    const capability = capabilityPhraseFromRows(group, "provide related system capability");
    const safetyContext = safetyContextFromParents(group);
    return createBaseArtifactRow(ARTIFACT_KINDS.SUBSYSTEM, {
      id: `SUB-${String(index + 1).padStart(3, "0")}`,
      subsystem,
      requirementText: subsystemRequirementTextFromIntent(capability, subsystem, group.some(isSafetyLinkedRow)),
      parentSystemRequirement,
      allocatedFunction: compactList(group.map((row) => row.allocatedFunction)) || allocatedFunctionFromRefs(architectureRefs),
      allocatedArchitecture: compactList(group.map((row) => row.allocatedArchitecture)) || allocatedArchitectureFromRefs(architectureRefs),
      rationale: "Second-pass local consolidation of related system-derived subsystem requirement candidates.",
      verificationMethod: compactList(group.map((row) => row.verificationMethod)) || "Analysis",
      traceLinks: splitIds(parentSystemRequirement).map((id) => ({ targetType: "system-requirement", targetId: id, relationship: "allocates" })),
      sourceArchitectureRefs: architectureRefs,
      ...safetyContext,
      source: "ai-consolidated-fallback",
    }, index);
  });
}

function locallyConsolidateDesignRows(rows = [], targetCount = 1) {
  return rowsGroupedToTarget(rows, targetCount).map((group, index) => {
    const parentRequirement = combinedParentIds(group, "parentRequirement");
    const architectureRefs = uniqueArchitectureRefs(group);
    const subsystem = compactList(group.map((row) => row.subsystem)) || "Subsystem";
    const capability = capabilityPhraseFromRows(group, "related subsystem responsibilities");
    const designElementName = pascalNameFromText(compactList([subsystem, capability]), `${subsystem}Coordinator`);
    const safetyContext = safetyContextFromParents(group);
    return createBaseArtifactRow(ARTIFACT_KINDS.DESIGN, {
      id: `DES-${String(index + 1).padStart(3, "0")}`,
      designElementName,
      designLevel: "Subsystem",
      description: designDescriptionFromIntent(capability, designElementName),
      parentRequirement,
      allocatedFunction: compactList(group.map((row) => row.allocatedFunction)) || allocatedFunctionFromRefs(architectureRefs),
      allocatedArchitecture: compactList(group.map((row) => row.allocatedArchitecture)) || allocatedArchitectureFromRefs(architectureRefs),
      interfaceDependencies: compactList(group.map((row) => row.interfaceDependencies)),
      designRationale: "Second-pass local consolidation of related subsystem-derived design candidates.",
      linkedSourceCode: compactList(group.map((row) => row.linkedSourceCode)) || sourceFilesFromRefs(architectureRefs),
      traceLinks: splitIds(parentRequirement).map((id) => ({ targetType: "subsystem-requirement", targetId: id, relationship: "satisfies" })),
      sourceArchitectureRefs: architectureRefs,
      ...safetyContext,
      source: "ai-consolidated-fallback",
    }, index);
  });
}

function enforceMaxRows(rows = [], targetCount = 1, localConsolidate) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (safeRows.length <= targetCount) return safeRows;
  return localConsolidate(safeRows, targetCount);
}

async function consolidateSystemRequirementRows(firstPassRows = [], softwareRequirements = [], projectName = "", repoName = "", options = {}) {
  if (firstPassRows.length <= 2) return firstPassRows;
  const ratio = 0.5;
  const targetCount = options.targetCount || Math.max(1, Math.ceil(firstPassRows.length * ratio));
  if (isAssuranceAIUnavailable()) {
    return ensureUniqueGeneratedIds(enforceMaxRows(firstPassRows, targetCount, locallyConsolidateSystemRows), "SYS");
  }
  const basePayload = {
    task: "consolidate_system_requirements_to_higher_abstraction",
    projectName,
    repoName,
    sourceRowCount: firstPassRows.length,
    targetRowCount: targetCount,
    compressionRatio: ratio,
    instructions: [
      "Perform a second-pass abstraction over the candidate system requirements.",
      "Combine rows that describe the same user-visible capability, safety objective, interface obligation, data obligation, or operational outcome.",
      "Return fewer, broader system requirements where traceability allows consolidation.",
      "Aim for approximately targetRowCount rows for this pass. Do not preserve one output row per input row unless the input truly contains unrelated obligations.",
      "Each output row must keep all covered parentSwRequirement ids from the consolidated input rows, comma-separated.",
      "Keep safety-related parent software requirement ids represented in parentSwRequirement.",
      "Use higher-level system language. Do not copy candidate requirement text verbatim.",
      "Write each requirement as one clear sentence: 'The system shall <verb phrase> when/if/for <condition or context>.'",
      "Use concrete domain behavior from the source categories. Include thresholds, update rates, latency, data fields, confidence, timestamps, or safety constraints only when they are supported by the input.",
      "Avoid generic filler such as 'provide a consolidated operational capability', 'cover related behaviors', 'support the allocated capability', or 'handle requirements'.",
      "Never output a requirement that is only a comma-separated list of actions or source labels. Synthesize the list into one capability or workflow outcome.",
      "Do not invent unsupported hazards, verification evidence, design elements, or source files.",
    ],
    schema: {
      requirements: [{
        id: "SYS-001",
        requirementText: "The system shall automatically reduce longitudinal speed when the predicted time-to-collision with a forward obstacle is below the configured emergency braking threshold and no driver braking input is detected.",
        derivedFrom: "Software Requirements",
        parentSwRequirement: "SWR-001, SWR-002, SWR-003",
        rationale: "Why these candidate rows form one higher-level system requirement",
        verificationMethod: "Analysis | Test | Inspection | Demonstration",
      }],
    },
  };
  const generated = await requestAssuranceConsolidationRows({
    basePayload,
    rowKey: "candidateSystemRequirements",
    rows: firstPassRows,
    compactRow: compactArtifactRowForPrompt,
    responseKey: "requirements",
    systemPrompt: "You are a senior systems engineer performing second-pass consolidation. Reduce candidate system requirements into fewer, more abstract system capabilities while preserving all parent software requirement traceability. Produce readable, testable requirement sentences with concrete domain behavior and no generic filler. Return only valid JSON matching the requested schema.",
    errorLabel: "System requirements abstraction pass",
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress: options.onProgress,
  });
  const normalized = generated
    .map((row, index) => normalizeSystemRow(row || {}, index, softwareRequirements))
    .filter((row) => row.requirementText);
  if (!normalized.length) return firstPassRows;

  const parentTexts = parentRequirementTexts(softwareRequirements);
  const abstracted = ensureUniqueGeneratedIds(normalized.map((row, index) => (
    parentTexts.has(cellText(row.requirementText).toLowerCase()) ||
      isTooSimilarToParent(row.requirementText, parentRowsForGeneratedRow(row, "parentSwRequirement", softwareRequirements))
      ? firstPassRows[index] || row
      : row
  )), "SYS");
  const missingRows = missingParentRows(softwareRequirements, abstracted, "parentSwRequirement");
  const withCoverage = ensureUniqueGeneratedIds([
    ...abstracted,
    ...firstPassRowsForMissingParents(firstPassRows, missingRows, "parentSwRequirement"),
  ], "SYS");
  return ensureUniqueGeneratedIds(enforceMaxRows(withCoverage, targetCount, locallyConsolidateSystemRows), "SYS");
}

async function consolidateSubsystemRequirementRows(firstPassRows = [], systemRequirements = [], projectName = "", repoName = "", options = {}) {
  if (firstPassRows.length <= 2) return firstPassRows;
  const ratio = 0.5;
  const targetCount = options.targetCount || Math.max(1, Math.ceil(firstPassRows.length * ratio));
  if (isAssuranceAIUnavailable()) {
    return ensureUniqueGeneratedIds(enforceMaxRows(firstPassRows, targetCount, locallyConsolidateSubsystemRows), "SUB");
  }
  const basePayload = {
    task: "consolidate_subsystem_requirements_to_higher_abstraction",
    projectName,
    repoName,
    sourceRowCount: firstPassRows.length,
    targetRowCount: targetCount,
    compressionRatio: ratio,
    instructions: [
      "Perform a second-pass abstraction over the candidate subsystem requirements.",
      "Combine rows that allocate the same subsystem capability, boundary responsibility, coordination role, safety behavior, or interface responsibility.",
      "Return fewer, broader subsystem requirements where traceability allows consolidation.",
      "Aim for approximately targetRowCount rows for this pass. Do not preserve one output row per input row unless the input truly contains unrelated subsystem responsibilities.",
      "Each output row must keep all covered parentSystemRequirement ids from the consolidated input rows, comma-separated.",
      "Keep safety-related parent system requirement ids represented in parentSystemRequirement.",
      "Use allocated subsystem language. Do not copy candidate or parent system requirement text verbatim.",
      "Write each requirement as one clear sentence: 'The <named subsystem> subsystem shall <verb phrase> ...'. If no subsystem name is supported, use 'The subsystem shall ...'.",
      "Use concrete allocation behavior from the source categories. Include inputs, outputs, data fields, rates, timing budgets, validation conditions, and safety constraints only when supported by the input.",
      "Avoid generic filler such as 'realize the consolidated responsibility', 'implement the allocated behavior', or 'support related system capabilities'.",
      "Never output a requirement that is only a comma-separated list of actions or source labels. Synthesize the list into one allocated subsystem responsibility.",
      "Do not invent unsupported subsystems, design elements, tests, hazards, or evidence.",
    ],
    schema: {
      requirements: [{
        id: "SUB-001",
        subsystem: "Application Subsystem",
        requirementText: "The perception subsystem shall provide a validated forward obstacle track containing range, relative velocity, confidence, and timestamp at the supported update rate.",
        parentSystemRequirement: "SYS-001, SYS-002",
        allocatedFunction: "",
        allocatedArchitecture: "CSCI / CSC / CSU if supported",
        rationale: "Why these candidate rows form one allocated subsystem responsibility",
        verificationMethod: "Analysis | Test | Inspection | Demonstration",
      }],
    },
  };
  const generated = await requestAssuranceConsolidationRows({
    basePayload,
    rowKey: "candidateSubsystemRequirements",
    rows: firstPassRows,
    compactRow: compactArtifactRowForPrompt,
    responseKey: "requirements",
    systemPrompt: "You are a senior subsystem requirements engineer performing second-pass consolidation. Reduce candidate subsystem requirements into fewer, more abstract allocated subsystem responsibilities while preserving all parent system requirement traceability. Produce readable, testable allocation sentences with concrete domain behavior and no generic filler. Return only valid JSON matching the requested schema.",
    errorLabel: "Subsystem requirements abstraction pass",
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress: options.onProgress,
  });
  const normalized = generated
    .map((row, index) => normalizeSubsystemRow(row || {}, index, systemRequirements))
    .filter((row) => row.requirementText);
  if (!normalized.length) return firstPassRows;

  const parentTexts = parentRequirementTexts(systemRequirements);
  const abstracted = ensureUniqueGeneratedIds(normalized.map((row, index) => (
    parentTexts.has(cellText(row.requirementText).toLowerCase()) ||
      isTooSimilarToParent(row.requirementText, parentRowsForGeneratedRow(row, "parentSystemRequirement", systemRequirements))
      ? firstPassRows[index] || row
      : row
  )), "SUB");
  const missingRows = missingParentRows(systemRequirements, abstracted, "parentSystemRequirement");
  const withCoverage = ensureUniqueGeneratedIds([
    ...abstracted,
    ...firstPassRowsForMissingParents(firstPassRows, missingRows, "parentSystemRequirement"),
  ], "SUB");
  return ensureUniqueGeneratedIds(enforceMaxRows(withCoverage, targetCount, locallyConsolidateSubsystemRows), "SUB");
}

async function consolidateDesignElementRows(firstPassRows = [], subsystemRequirements = [], projectName = "", repoName = "", options = {}) {
  if (firstPassRows.length <= 2) return firstPassRows;
  const ratio = 0.4;
  const targetCount = options.targetCount || Math.max(1, Math.ceil(firstPassRows.length * ratio));
  if (isAssuranceAIUnavailable()) {
    return ensureUniqueGeneratedIds(enforceMaxRows(firstPassRows, targetCount, locallyConsolidateDesignRows), "DES");
  }
  const basePayload = {
    task: "consolidate_design_elements_to_higher_abstraction",
    projectName,
    repoName,
    sourceRowCount: firstPassRows.length,
    targetRowCount: targetCount,
    compressionRatio: ratio,
    instructions: [
      "Perform a second-pass abstraction over the candidate system/subsystem design elements.",
      "Combine rows that describe the same design responsibility, component boundary, state/data ownership area, interface dependency, validation point, coordination pattern, monitoring/control point, or safety mechanism.",
      "Return fewer, broader design line items where traceability allows consolidation.",
      "Aim for approximately targetRowCount rows for this pass. Do not preserve one output row per input row unless the input truly contains unrelated design responsibilities.",
      "Each output row must keep all covered parentRequirement ids from the consolidated input rows, comma-separated.",
      "Keep safety-related parent subsystem requirement ids represented in parentRequirement.",
      "Use design language, not requirement language. Do not copy candidate descriptions or parent subsystem requirement text verbatim.",
      "Write description as a component behavior sentence: 'The <ComponentName> component receives/calculates/validates/publishes/stores ...'.",
      "Use concrete interface, data transformation, state ownership, decision logic, validation, monitoring, or command publishing behavior from the source categories.",
      "Avoid generic filler such as 'design responsibility', 'component boundaries', 'verification points', or 'satisfy the linked requirement' unless followed by concrete behavior.",
      "Never describe a design element by repeating a comma-separated source action list. Synthesize the list into one component responsibility.",
      "Do not invent unsupported source files, tests, hazards, or evidence.",
    ],
    schema: {
      designElements: [{
        id: "DES-001",
        designElementName: "Design element name",
        designLevel: "System | Subsystem",
        description: "The CollisionRiskEvaluator component calculates predicted time-to-collision using obstacle range and relative velocity and forwards the result to the emergency decision logic.",
        parentRequirement: "SUB-001, SUB-002",
        allocatedFunction: "",
        allocatedArchitecture: "CSCI / CSC / CSU if supported",
        interfaceDependencies: "",
        designRationale: "Why these candidate rows form one broader design element",
        linkedSourceCode: "",
      }],
    },
  };
  const generated = await requestAssuranceConsolidationRows({
    basePayload,
    rowKey: "candidateDesignElements",
    rows: firstPassRows,
    compactRow: compactArtifactRowForPrompt,
    responseKey: "designElements",
    systemPrompt: "You are a senior software and systems design engineer performing second-pass consolidation. Reduce candidate design elements into fewer, more abstract design responsibilities while preserving all parent subsystem requirement traceability. Produce readable component-level design descriptions with concrete behavior and no generic filler. Return only valid JSON matching the requested schema.",
    errorLabel: "System/subsystem design abstraction pass",
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress: options.onProgress,
  });
  const normalized = generated
    .map((row, index) => normalizeDesignRow(row || {}, index, subsystemRequirements))
    .filter((row) => row.designElementName || row.description);
  if (!normalized.length) return firstPassRows;

  const abstracted = ensureUniqueGeneratedIds(normalized.map((row, index) => (
    isTooSimilarToParent(row.description, parentRowsForGeneratedRow(row, "parentRequirement", subsystemRequirements))
      ? firstPassRows[index] || row
      : row
  )), "DES");
  const missingRows = missingParentRows(subsystemRequirements, abstracted, "parentRequirement");
  const withCoverage = ensureUniqueGeneratedIds([
    ...abstracted,
    ...firstPassRowsForMissingParents(firstPassRows, missingRows, "parentRequirement"),
  ], "DES");
  return ensureUniqueGeneratedIds(enforceMaxRows(withCoverage, targetCount, locallyConsolidateDesignRows), "DES");
}

export async function deriveFunctionalSoftwareRequirements({ cbaRows = [], projectName = "", repoName = "", onProgress = null } = {}) {
  if (!Array.isArray(cbaRows) || !cbaRows.length) {
    return [];
  }
  const systemPrompt = "You are a senior software requirements engineer. Derive externally reviewable, black-box software requirements from code-based functional decomposition rows. Translate implementation names into domain behavior. Return only valid JSON matching the requested schema.";
  const basePayload = {
    task: "derive_software_requirements_from_functional_decomposition_batch",
    projectName,
    repoName,
    instructions: [
      "Create one concise, testable software requirement for each provided functional decomposition row unless a row is clearly non-behavioral.",
      "Use 'The software shall ...' language.",
      "Describe the observable behavior, data obligation, interface contract, or validation outcome implied by the row.",
      "Do not restate implementation mechanics such as calling a function, returning a value, initializing a method, setting a private field, or invoking a class.",
      "Do not mention function names, method names, class names, private symbols, file paths, or phrases like when the function is called in requirementText.",
      "Use code symbols only in traceability fields such as derivedFromFunction, derivedFromInterface, and linkedSourceCode.",
      "Preserve traceability by setting sourceTraceId to the input traceId when available, otherwise rowRef.",
      "Do not mark anything approved.",
      "Return requirements in the same order as the input rows.",
      "Return one requirement object per meaningful input row in the requirements array.",
    ],
    schema: {
      requirements: [{
        id: "SWR-001",
        requirementText: "The software shall ...",
        derivedFromFunction: "Function name(s)",
        derivedFromInterface: "Control action or interface",
        requirementType: "Functional | Interface | Data | Performance | Safety-Related | Other",
        priority: "High | Medium | Low",
        rationale: "Why this requirement follows from the functional row",
        linkedSourceCode: "file or files from input",
        linkedHazards: "",
        linkedTests: "",
        sourceTraceId: "traceId or rowRef from input",
      }],
    },
  };

  const softwareRows = [];
  for (let start = 0; start < cbaRows.length; start += ASSURANCE_PROMPT_BATCH_SIZE) {
    const batchRows = cbaRows.slice(start, start + ASSURANCE_PROMPT_BATCH_SIZE);
    const end = start + batchRows.length;
    const payload = {
      ...basePayload,
      rowStart: start + 1,
      rowEnd: end,
      rowCount: batchRows.length,
      functionalDecomposition: batchRows.map((row, batchIndex) => (
        compactFunctionalRowForPrompt(row, start + batchIndex, 160)
      )),
    };

    console.info(`[xHandle AI] Software requirements prompt rows ${start + 1}-${end}/${cbaRows.length}`, {
      systemPrompt,
      payload,
    });

    try {
      const raw = await callAssuranceModel(payload, {
        systemPrompt,
        errorLabel: "Software requirements AI",
        retryDelays: ASSURANCE_TRANSIENT_RETRY_DELAYS_MS,
        markTransientUnavailable: false,
        respectUnavailable: false,
      });
      console.info(`[xHandle AI] Software requirements response rows ${start + 1}-${end}/${cbaRows.length}`, raw);
      const parsed = extractJson(raw);
      const rowsForPrompt = Array.isArray(parsed.requirements) ? parsed.requirements : [];
      batchRows.forEach((sourceRow, batchIndex) => {
        const rowIndex = start + batchIndex;
        const normalized = normalizeSoftwareRow(rowsForPrompt[batchIndex] || {}, rowIndex, cbaRows);
        softwareRows.push(normalized.requirementText ? normalized : fallbackSoftwareRequirement(sourceRow, rowIndex));
      });
    } catch (error) {
      console.warn(`[xHandle AI] Software requirements rows ${start + 1}-${end}/${cbaRows.length} failed; using local fallback rows.`, error);
      batchRows.forEach((sourceRow, batchIndex) => {
        softwareRows.push(fallbackSoftwareRequirement(sourceRow, start + batchIndex));
      });
    }
    onProgress?.({
      phase: "Software requirements AI",
      completed: Math.min(cbaRows.length, end),
      total: cbaRows.length,
      message: `Software requirements: rows ${start + 1}-${end} of ${cbaRows.length}`,
    });
  }

  const repairedRows = await repairCodeEchoSoftwareRequirements({
    rows: softwareRows.filter((row) => row.requirementText),
    cbaRows,
    projectName,
    repoName,
    onProgress,
  });
  return ensureUniqueGeneratedIds(repairedRows, "SWR");
}

export function importHazardSoftwareRequirements({ hazardAnalysis = null } = {}) {
  return hazardSafetyRequirementRows(hazardAnalysis);
}

export async function deriveSoftwareRequirements({ cbaRows = [], projectName = "", repoName = "", hazardAnalysis = null, onProgress = null } = {}) {
  if (!Array.isArray(cbaRows) || !cbaRows.length) {
    throw new Error("Generate or load a functional decomposition before deriving software requirements.");
  }

  let softwareRows = [];
  try {
    softwareRows = await deriveFunctionalSoftwareRequirements({ cbaRows, projectName, repoName, onProgress });
  } catch (error) {
    console.warn("⚠️ Software requirements AI phase failed; using local fallback rows and continuing hazard requirement import.", error);
    softwareRows = cbaRows
      .map((sourceRow, index) => fallbackSoftwareRequirement(sourceRow, index))
      .filter((row) => row.requirementText);
  }

  const safetyRows = importHazardSoftwareRequirements({ hazardAnalysis });
  const combinedCount = softwareRows.length + safetyRows.length;
  onProgress?.({
    phase: "Hazard requirement import",
    completed: cbaRows.length,
    total: cbaRows.length,
    message: safetyRows.length
      ? `Combining ${softwareRows.length} functional software requirement${softwareRows.length === 1 ? "" : "s"} with ${safetyRows.length} hazard-derived software requirement${safetyRows.length === 1 ? "" : "s"} (${combinedCount} total before merge).`
      : `Software requirements complete (${softwareRows.length} functional software requirement${softwareRows.length === 1 ? "" : "s"}).`,
  });
  return [
    ...softwareRows,
    ...safetyRows,
  ].length
    ? ensureUniqueGeneratedIds([
      ...softwareRows,
      ...safetyRows,
    ], "SWR")
    : [];
}

async function deriveHazardSystemRequirements({ hazardRows = [], projectName = "", repoName = "", startIndex = 0, onProgress = null } = {}) {
  if (!Array.isArray(hazardRows) || !hazardRows.length) return [];
  const basePayload = {
    task: "derive_system_requirements_from_hazard_software_requirements",
    projectName,
    repoName,
    instructions: [
      "Generate system-level safety requirements from the provided hazard-derived software requirements.",
      "Each output must be AI-authored, domain-specific, and testable. Do not use canned templates.",
      "Use 'The system shall ...' language.",
      "Use the hazard, unsafe condition, mitigation strategy, control action, from/to functions, subsystem, CSCI/CSC/CSU, and source software requirement when present.",
      "Translate code symbols and function names into the operational behavior they imply; do not place raw symbols such as __init__ directly in the requirement text.",
      "If a hazard or mitigation field is generic or missing, infer only from the available source requirement and architecture trace.",
      "Do not insert placeholder phrases such as identified hazard conditions, required safety controls, or derived from code architecture hazard analysis.",
      "Avoid generic filler such as detect and control, maintain safe operation, support the capability, enforce required controls, or before allowing safety-relevant operation to continue unless those exact behaviors are supported by the input.",
      "Set parentSwRequirement to the source software requirement id.",
      "Do not invent unsupported hazards, tests, design elements, thresholds, or evidence.",
      "Return one requirement object per input row in the same order.",
    ],
    schema: {
      requirements: [{
        id: "SYS-SAFE-001",
        requirementText: "The system shall ...",
        derivedFrom: "Hazard-Derived Software Requirement",
        parentSwRequirement: "SWR-SAFE-001",
        rationale: "Why this system requirement is needed for the linked hazard and architecture trace",
        verificationMethod: "Analysis | Test | Inspection | Demonstration",
      }],
    },
  };
  const rows = await requestAssuranceRows({
    basePayload,
    rowKey: "hazardSoftwareRequirements",
    rows: hazardRows,
    compactRow: compactArtifactRowForPrompt,
    responseKey: "requirements",
    systemPrompt: "You are a senior systems safety engineer deriving system-level safety requirements from hazard-linked software requirements and architecture traces. Write specific, testable, domain-aware requirements. Return only valid JSON matching the requested schema.",
    errorLabel: "Hazard-derived system requirements AI",
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress,
  });
  return hazardRows
    .map((sourceRow, index) => {
      const raw = rows[index] || {};
      if (!cellText(raw.requirementText)) return null;
      const normalizedRow = normalizeSystemRow({
        ...raw,
        id: raw.id || `SYS-SAFE-${String(startIndex + index + 1).padStart(3, "0")}`,
        parentSwRequirement: raw.parentSwRequirement || sourceRow.id,
        requirementText: raw.requirementText || "",
        derivedFrom: raw.derivedFrom || "Hazard-Derived Software Requirement",
        rationale: raw.rationale || "Derived from hazard-linked software requirement.",
        verificationMethod: raw.verificationMethod || sourceRow.linkedVerification || "Analysis",
      }, startIndex + index, hazardRows);
      return normalizedRow.requirementText ? normalizedRow : null;
    })
    .filter((row) => row?.requirementText);
}

export async function deriveSystemRequirements({ softwareRequirements = [], projectName = "", repoName = "", onProgress = null } = {}) {
  if (!Array.isArray(softwareRequirements) || !softwareRequirements.length) {
    throw new Error("Derive or add software requirements before deriving system requirements.");
  }
  const { functionalRows, hazardRows } = splitSoftwareRequirementsBySource(softwareRequirements);
  const categories = functionalRows.length
    ? await requestRequirementCategories({
      sourceRows: functionalRows,
      targetKind: ARTIFACT_KINDS.SYSTEM,
      projectName,
      repoName,
      targetRatio: 0.5,
      onProgress,
    })
    : [];
  const basePayload = {
    task: "derive_system_requirements_from_reviewed_software_requirement_categories",
    projectName,
    repoName,
    instructions: [
      "Reverse-engineer generalized system-level requirements from the provided reviewed software requirement categories.",
      "You are working backwards from software implementation obligations to the system obligations they imply.",
      "Each system requirement must express the user-visible, operational, safety, interface, data, or mission capability represented by the category.",
      "Abstract upward: remove software implementation details, function names used only as code internals, low-level timing mechanics, and component-specific wording unless they are necessary for traceability.",
      "Use 'The system shall ...' language.",
      "Write each requirement as one clear, testable sentence in the form 'The system shall <verb phrase> when/if/for <condition or context>'.",
      "Use concrete domain nouns and behavior from the category. Include thresholds, update rates, latency, data fields, confidence, timestamps, or safety constraints only when supported by the input.",
      "Avoid generic filler such as 'provide the operational capability', 'support the capability', 'cover the behavior', or 'consolidated responsibility'.",
      "Never output a requirement that is only a comma-separated list of actions or source labels. Synthesize the list into one capability or workflow outcome.",
      "Do not create a sentence that is just the software requirement with 'software' replaced by 'system'.",
      "Prefer capability words such as provide, maintain, coordinate, preserve, support, prevent, detect, constrain, or ensure over implementation words from the source category.",
      "Create one system requirement per reviewed category unless categories are explicitly redundant.",
      "Set parentSwRequirement to all source software requirement ids covered by the category.",
      "Software requirements with requirementType Safety-Related, linkedHazards, hazardSummaryRef, parentHazard, mitigationStrategy, criticalitySeverity, or safetyContext are software safety requirements and must be represented in the derived system requirements.",
      "Safety-related software requirements may be consolidated with related requirements, but their ids must remain in parentSwRequirement so the safety trace is preserved.",
      "Do not copy category descriptions or software requirements word-for-word.",
      "Do not invent unsupported hazards, tests, design elements, or evidence.",
    ],
    schema: {
      requirements: [{
        id: "SYS-001",
        requirementText: "The system shall ...",
        derivedFrom: "Software Requirements",
        parentSwRequirement: "SWR-001, SWR-002",
        rationale: "Why this system requirement consolidates the parent software requirements",
        verificationMethod: "Analysis | Test | Inspection | Demonstration",
      }],
    },
  };
  const rows = categories.length
    ? await requestAssuranceRows({
      basePayload,
      rowKey: "softwareRequirementCategories",
      rows: categories,
      compactRow: compactRequirementCategoryForPrompt,
      responseKey: "requirements",
      systemPrompt: "You are a senior systems requirements engineer reverse-engineering higher-level system requirements from reviewed software requirement categories. Generalize upward from category intent to system capability while preserving all parent software requirement traceability. Produce readable, testable requirement sentences with concrete domain behavior and no generic filler. Return only valid JSON matching the requested schema.",
      errorLabel: "System requirements AI",
      fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
      logPromptResponse: true,
      retryTransient: true,
      markTransientUnavailable: false,
      respectUnavailable: false,
      onProgress,
    })
    : [];
  const normalized = categories
    .map((category, index) => {
      const raw = rows[index] || {};
      const normalizedRow = normalizeSystemRow({
        ...raw,
        parentSwRequirement: raw.parentSwRequirement || category.parentSwRequirement,
        requirementText: raw.requirementText || systemRequirementTextFromIntent(category.requirementIntent || category.categoryName, isSafetyLinkedRow(category)),
        rationale: raw.rationale || `Derived from reviewed category: ${category.categoryName}.`,
      }, index, functionalRows);
      return normalizedRow.requirementText ? normalizedRow : normalizeSystemRow({
        parentSwRequirement: category.parentSwRequirement,
        requirementText: systemRequirementTextFromIntent(category.requirementIntent || category.categoryName, isSafetyLinkedRow(category)),
        rationale: `Derived from reviewed category: ${category.categoryName}.`,
      }, index, functionalRows);
    })
    .filter((row) => row.requirementText);
  const parentTexts = parentRequirementTexts(functionalRows);
  const uniqueNormalized = ensureUniqueGeneratedIds(normalized.map((row, index) => (
    parentTexts.has(cellText(row.requirementText).toLowerCase()) ||
      isTooSimilarToParent(row.requirementText, parentRowsForGeneratedRow(row, "parentSwRequirement", functionalRows))
      ? fallbackSystemRequirement(functionalRows[index] || {}, index)
      : row
  )), "SYS");
  const missingSafetyRows = safetyRowsMissingCoverage(functionalRows, uniqueNormalized, "parentSwRequirement");
  const functionalFirstPassRows = [
    ...uniqueNormalized,
    ...ensureUniqueGeneratedIds(missingSafetyRows.map((row, index) => fallbackSystemRequirementFromSafetySw(row, uniqueNormalized.length + index)), "SYS"),
  ];
  const functionalConsolidated = functionalFirstPassRows.length
    ? await consolidateSystemRequirementRows(functionalFirstPassRows, functionalRows, projectName, repoName, { targetCount: Math.max(1, categories.length), onProgress })
    : [];
  const coveredFunctional = parentIdsCovered(functionalConsolidated, "parentSwRequirement");
  const uncoveredFunctionalRows = functionalRows.filter((row) => row.id && !coveredFunctional.has(cellText(row.id)));
  const functionalWithCoverage = ensureUniqueGeneratedIds([
    ...functionalConsolidated,
    ...firstPassRowsForMissingParents(functionalFirstPassRows, uncoveredFunctionalRows, "parentSwRequirement"),
  ], "SYS");
  const hazardSystemRows = ensureUniqueGeneratedIds(
    await deriveHazardSystemRequirements({
      hazardRows,
      projectName,
      repoName,
      startIndex: functionalWithCoverage.length,
      onProgress,
    }),
    "SYS"
  );
  const combinedRows = [
    ...functionalWithCoverage,
    ...hazardSystemRows,
  ];
  onProgress?.({
    phase: "System requirements complete",
    completed: softwareRequirements.length,
    total: softwareRequirements.length,
    message: `System requirements complete for ${softwareRequirements.length} software requirement row${softwareRequirements.length === 1 ? "" : "s"}.`,
  });
  return finalDeduplicateArtifactRows(
    combinedRows,
    ARTIFACT_KINDS.SYSTEM,
    minimumRowsForTarget(softwareRequirements.length, ARTIFACT_KINDS.SYSTEM)
  );
}

export async function deriveSubsystemRequirements({ systemRequirements = [], projectName = "", repoName = "", onProgress = null } = {}) {
  if (!Array.isArray(systemRequirements) || !systemRequirements.length) {
    throw new Error("Derive or add system requirements before deriving subsystem requirements.");
  }
  const categories = await requestRequirementCategories({
    sourceRows: systemRequirements,
    targetKind: ARTIFACT_KINDS.SUBSYSTEM,
    projectName,
    repoName,
    targetRatio: 0.5,
    onProgress,
  });
  const basePayload = {
    task: "derive_subsystem_requirements_from_reviewed_system_requirement_categories",
    projectName,
    repoName,
    instructions: [
      "Reverse-engineer generalized subsystem-level requirements from the provided reviewed system requirement categories.",
      "You are working backwards from system obligations to the subsystem responsibilities that would realize them.",
      "Each subsystem requirement must express an allocated subsystem responsibility, not a restatement of the category.",
      "Abstract upward/allocation-wise: describe the subsystem capability, boundary, responsibility, or coordination role implied by the category.",
      "Use 'The subsystem shall ...' language unless a named subsystem is available.",
      "Write each requirement as one clear, testable allocation sentence in the form 'The <named subsystem> subsystem shall <verb phrase> ...'.",
      "Use concrete allocation behavior from the category. Include inputs, outputs, data fields, rates, timing budgets, validation conditions, and safety constraints only when supported by the input.",
      "Avoid generic filler such as 'realize the allocated responsibility', 'implement the allocated behavior', 'support the capability', or 'cover related requirements'.",
      "Never output a requirement that is only a comma-separated list of actions or source labels. Synthesize the list into one allocated subsystem responsibility.",
      "Do not create a sentence that is just the system requirement with 'system' replaced by 'subsystem'.",
      "Prefer allocation words such as realize, coordinate, expose, maintain, enforce, validate, transform, route, monitor, or provide over copied source wording.",
      "Create one subsystem requirement per reviewed category unless categories are explicitly redundant.",
      "Set parentSystemRequirement to all source system requirement ids covered by the category.",
      "System requirements carrying linkedHazards, parentHazard, mitigationStrategy, criticalitySeverity, linkedVerification, or safetyContext are safety-derived and must be represented in the derived subsystem requirements.",
      "Safety-derived system requirements may be consolidated with related requirements, but their ids must remain in parentSystemRequirement so the safety trace is preserved.",
      "Allocate each requirement to a concrete subsystem when supported by the input.",
      "Do not invent unsupported subsystems, design elements, tests, hazards, or evidence.",
    ],
    schema: {
      requirements: [{
        id: "SUB-001",
        subsystem: "Application Subsystem",
        requirementText: "The subsystem shall ...",
        parentSystemRequirement: "SYS-001, SYS-002",
        allocatedFunction: "",
        allocatedArchitecture: "CSCI / CSC / CSU if supported",
        rationale: "Why this subsystem requirement consolidates and allocates the parent system requirements",
        verificationMethod: "Analysis | Test | Inspection | Demonstration",
      }],
    },
  };
  const rows = await requestAssuranceRows({
    basePayload,
    rowKey: "systemRequirementCategories",
    rows: categories,
    compactRow: compactRequirementCategoryForPrompt,
    responseKey: "requirements",
    systemPrompt: "You are a senior subsystem requirements engineer reverse-engineering allocated subsystem responsibilities from reviewed system requirement categories. Generalize from category intent into subsystem responsibility while preserving all parent system requirement traceability. Produce readable, testable allocation sentences with concrete domain behavior and no generic filler. Return only valid JSON matching the requested schema.",
    errorLabel: "Subsystem requirements AI",
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress,
  });
  const normalized = categories
    .map((category, index) => {
      const raw = rows[index] || {};
      const normalizedRow = normalizeSubsystemRow({
        ...raw,
        parentSystemRequirement: raw.parentSystemRequirement || category.parentSystemRequirement,
        subsystem: raw.subsystem || category.subsystem,
        allocatedFunction: raw.allocatedFunction || category.allocatedFunction,
        allocatedArchitecture: raw.allocatedArchitecture || category.allocatedArchitecture,
        requirementText: raw.requirementText || subsystemRequirementTextFromIntent(category.requirementIntent || category.categoryName, raw.subsystem || category.subsystem, isSafetyLinkedRow(category)),
        rationale: raw.rationale || `Derived from reviewed category: ${category.categoryName}.`,
      }, index, systemRequirements);
      return normalizedRow.requirementText ? normalizedRow : normalizeSubsystemRow({
        parentSystemRequirement: category.parentSystemRequirement,
        subsystem: category.subsystem,
        allocatedFunction: category.allocatedFunction,
        allocatedArchitecture: category.allocatedArchitecture,
        requirementText: subsystemRequirementTextFromIntent(category.requirementIntent || category.categoryName, category.subsystem, isSafetyLinkedRow(category)),
        rationale: `Derived from reviewed category: ${category.categoryName}.`,
      }, index, systemRequirements);
    })
    .filter((row) => row.requirementText);
  const parentTexts = parentRequirementTexts(systemRequirements);
  const uniqueNormalized = ensureUniqueGeneratedIds(normalized.map((row, index) => (
    parentTexts.has(cellText(row.requirementText).toLowerCase()) ||
      isTooSimilarToParent(row.requirementText, parentRowsForGeneratedRow(row, "parentSystemRequirement", systemRequirements))
      ? fallbackSubsystemRequirement(systemRequirements[index] || {}, index)
      : row
  )), "SUB");
  const missingSafetyRows = safetyRowsMissingCoverage(systemRequirements, uniqueNormalized, "parentSystemRequirement");
  const firstPassRows = [
    ...uniqueNormalized,
    ...ensureUniqueGeneratedIds(missingSafetyRows.map((row, index) => fallbackSubsystemRequirementFromSafetySystem(row, uniqueNormalized.length + index)), "SUB"),
  ];
  const consolidated = await consolidateSubsystemRequirementRows(firstPassRows, systemRequirements, projectName, repoName, { targetCount: categories.length, onProgress });
  onProgress?.({
    phase: "Subsystem requirements complete",
    completed: systemRequirements.length,
    total: systemRequirements.length,
    message: `Subsystem requirements complete for ${systemRequirements.length} system requirement row${systemRequirements.length === 1 ? "" : "s"}.`,
  });
  return finalDeduplicateArtifactRows(
    consolidated,
    ARTIFACT_KINDS.SUBSYSTEM,
    minimumRowsForTarget(systemRequirements.length, ARTIFACT_KINDS.SUBSYSTEM)
  );
}

export async function deriveDesignElements({ subsystemRequirements = [], projectName = "", repoName = "", onProgress = null } = {}) {
  if (!Array.isArray(subsystemRequirements) || !subsystemRequirements.length) {
    throw new Error("Derive or add subsystem requirements before deriving design elements.");
  }
  const categories = await requestRequirementCategories({
    sourceRows: subsystemRequirements,
    targetKind: ARTIFACT_KINDS.DESIGN,
    projectName,
    repoName,
    targetRatio: 0.4,
    onProgress,
  });
  const basePayload = {
    task: "derive_system_subsystem_design_from_reviewed_subsystem_requirement_categories",
    projectName,
    repoName,
    instructions: [
      "Reverse-engineer reviewable system/subsystem design elements from the provided reviewed subsystem requirement categories.",
      "You are working backwards from subsystem requirements to the design responsibilities implied by those requirements.",
      "Each design element must describe the architectural/design responsibility that would satisfy the category; do not restate the category as a design description.",
      "Generalize into design concepts such as component responsibility, interface boundary, state/data ownership, validation point, coordination pattern, monitoring/control point, or safety mechanism.",
      "Create one design element per reviewed category unless categories are explicitly redundant.",
      "Set parentRequirement to all source subsystem requirement ids covered by the category.",
      "Use subsystem, allocated function, and allocated architecture from the input when available.",
      "Subsystem requirements carrying linkedHazards, parentHazard, mitigationStrategy, criticalitySeverity, linkedVerification, or safetyContext are safety-derived and must be represented in the derived design elements.",
      "Safety-derived subsystem requirements may be consolidated into shared design elements, but their ids must remain in parentRequirement so the safety trace is preserved.",
      "Describe design responsibilities and interface dependencies at a practical implementation/design level, using design language rather than requirement language.",
      "Write description as a concrete component behavior sentence: 'The <ComponentName> component receives/calculates/validates/publishes/stores ...'.",
      "Use concrete interface, data transformation, state ownership, decision logic, validation, monitoring, or command publishing behavior from the category.",
      "Avoid generic filler such as 'design responsibility', 'component boundaries', 'verification points', or 'satisfy the linked requirement' unless followed by concrete behavior.",
      "Never describe a design element by repeating a comma-separated source action list. Synthesize the list into one component responsibility.",
      "Do not copy subsystem requirement text into description or designRationale.",
      "Do not invent unsupported source files, tests, hazards, or evidence.",
    ],
    schema: {
      designElements: [{
        id: "DES-001",
        designElementName: "CollisionRiskEvaluator",
        designLevel: "System | Subsystem",
        description: "The CollisionRiskEvaluator component calculates predicted time-to-collision using obstacle range and relative velocity and forwards the result to the emergency decision logic.",
        parentRequirement: "SUB-001",
        allocatedFunction: "",
        allocatedArchitecture: "CSCI / CSC / CSU if supported",
        interfaceDependencies: "",
        designRationale: "Why this design element satisfies the parent requirement",
        linkedSourceCode: "",
      }],
    },
  };
  const rows = await requestAssuranceRows({
    basePayload,
    rowKey: "subsystemRequirementCategories",
    rows: categories,
    compactRow: compactRequirementCategoryForPrompt,
    responseKey: "designElements",
    systemPrompt: "You are a senior software and systems design engineer reverse-engineering design responsibilities from reviewed subsystem requirement categories. Generalize from category intent into architectural/design elements while preserving all parent subsystem requirement traceability. Produce readable component-level design descriptions with concrete behavior and no generic filler. Return only valid JSON matching the requested schema.",
    errorLabel: "System/subsystem design AI",
    fixedBatchSize: ASSURANCE_PROMPT_BATCH_SIZE,
    logPromptResponse: true,
    retryTransient: true,
    markTransientUnavailable: false,
    respectUnavailable: false,
    onProgress,
  });
  const normalized = categories
    .map((category, index) => {
      const raw = rows[index] || {};
      const normalizedRow = normalizeDesignRow({
        ...raw,
        parentRequirement: raw.parentRequirement || category.parentRequirement,
        allocatedFunction: raw.allocatedFunction || category.allocatedFunction,
        allocatedArchitecture: raw.allocatedArchitecture || category.allocatedArchitecture,
        designElementName: raw.designElementName || raw.name || pascalNameFromText(category.requirementIntent || category.categoryName),
        description: raw.description || designDescriptionFromIntent(category.requirementIntent || category.categoryName, raw.designElementName),
        designRationale: raw.designRationale || raw.rationale || `Derived from reviewed category: ${category.categoryName}.`,
      }, index, subsystemRequirements);
      return normalizedRow.designElementName || normalizedRow.description ? normalizedRow : normalizeDesignRow({
        parentRequirement: category.parentRequirement,
        allocatedFunction: category.allocatedFunction,
        allocatedArchitecture: category.allocatedArchitecture,
        designElementName: `${category.categoryName} Design`,
        description: designDescriptionFromIntent(category.requirementIntent || category.categoryName, `${category.categoryName} Design`),
        designRationale: `Derived from reviewed category: ${category.categoryName}.`,
      }, index, subsystemRequirements);
    })
    .filter((row) => row.designElementName || row.description);
  const uniqueNormalized = ensureUniqueGeneratedIds(normalized.map((row, index) => (
    isTooSimilarToParent(row.description, parentRowsForGeneratedRow(row, "parentRequirement", subsystemRequirements))
      ? fallbackDesignElement(subsystemRequirements[index] || {}, index)
      : row
  )), "DES");
  const missingSafetyRows = safetyRowsMissingCoverage(subsystemRequirements, uniqueNormalized, "parentRequirement");
  const firstPassRows = [
    ...uniqueNormalized,
    ...ensureUniqueGeneratedIds(missingSafetyRows.map((row, index) => fallbackDesignElementFromSafetySubsystem(row, uniqueNormalized.length + index)), "DES"),
  ];
  const consolidated = await consolidateDesignElementRows(firstPassRows, subsystemRequirements, projectName, repoName, { targetCount: categories.length, onProgress });
  onProgress?.({
    phase: "System/subsystem design complete",
    completed: subsystemRequirements.length,
    total: subsystemRequirements.length,
    message: `System/subsystem design complete for ${subsystemRequirements.length} subsystem requirement row${subsystemRequirements.length === 1 ? "" : "s"}.`,
  });
  return finalDeduplicateArtifactRows(
    consolidated,
    ARTIFACT_KINDS.DESIGN,
    minimumRowsForTarget(subsystemRequirements.length, ARTIFACT_KINDS.DESIGN)
  );
}

export const DERIVE_BY_KIND = {
  [ARTIFACT_KINDS.SOFTWARE]: deriveSoftwareRequirements,
  [ARTIFACT_KINDS.SYSTEM]: deriveSystemRequirements,
  [ARTIFACT_KINDS.SUBSYSTEM]: deriveSubsystemRequirements,
  [ARTIFACT_KINDS.DESIGN]: deriveDesignElements,
};
