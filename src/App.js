import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import VnVCenterPro from './components/VnVCenterPro';
import ReadmeModal from './components/ReadmeModal';
import React from "react";
import { ActivityProvider, ActivitiesButton, useActivityCenter } from "./components/activity/ActivityCenter";
import {
  Plus,
  X,
  FolderGit2,
  Folder,
  FolderPlus,
  FileText,
  Settings as SettingsIcon,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Trash2,             // for delete buttons
  MoreVertical,
  Download,
  PanelLeftClose,
  Maximize2,
  Minimize2,
  Loader2,
  ShieldCheck,
  ClipboardCheck,
  Sparkles,
} from 'lucide-react';
import XHandleCopilotView from "./components/XHandleCopilotView";
import { handleLitePromptSubmit } from './components/LitePromptHandler';
import { runLiteAIAnalysis } from './components/aiAnalysisLite';
import LiteSummaryDiagram from './components/LiteSummaryDiagram';
import PromptWizard from './components/PromptWizard';
import ConversationalWizard from './components/ConversationalWizard';
import LiteSummaryDiagramReactFlow from './components/LiteSummaryDiagramReactFlow';
import { generateAgenticRiskReport } from './components/generateAgenticReport';
import SafetyReportViewer from './components/SafetyReportViewer';
import { exportReport } from "./components/utils/exportUtils";
import {
  PieChart, Pie, Cell, Legend, Tooltip,
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer
} from 'recharts';
import { createPortal } from 'react-dom';
import { GitCommit } from 'lucide-react';
import DesignManagementView from './features/design-management/DesignManagementView';
import SafetyCaseView from './features/safety-case/SafetyCaseView';
import TraceabilityAuditorPanel from './components/TraceabilityAuditorPanel';
import { Gate } from './license/LicenseContext';
import TopNavBar from './components/TopNavBar';
import SettingsModal from './components/SettingsModal';
import {
  FileTypeSelectorModal,
  filterSelectableRepoFiles,
  generateFunctionalDecompositionFromGitHub,
  FunctionalDecompositionTable,
  getDefaultBranch,
  listRepoFilesViaGitHub,
} from './components/generateFunctionalDecompositionFromGitHub';
import { backendURL, buildAIAuthOpts } from './components/backendConfig';
import { Sun, Moon } from 'lucide-react';
import { useDarkMode } from './hooks/useDarkMode';
import { ensureTraceabilitySchema } from "./components/utils/traceabilityDb";
import {
  AI_PROVIDER_OPTIONS,
  fetchUserAIProviderSettings,
  getAIProviderLabel,
  getProviderKeyHelpText,
  getProviderKeyPlaceholder,
  normalizeAIProvider,
  saveUserAIProviderSettings,
  validateProviderApiKey,
} from "./lib/aiProviderConfig";
import { initializeLocalBackupRuntime } from "./lib/localBackupService";
import { notifyBackupDataChanged } from "./lib/localBackupEvents";
import {
  appendRequirementRows,
  createRequirementModule,
  loadRequirements,
  populateRequirementModule,
} from "./features/requirements/actions";
import { getActionProvider } from "./features/app/actionRegistry";
import {
  ResultsReviewProvider,
  ReviewCenter,
  ReviewStatusBadge,
  REVIEW_STATUSES,
  REVIEW_UNIT_TYPES,
  createReviewId,
  createReviewItemsFromGeneratedTable,
  normalizeReviewItem,
  useResultsReview,
} from "./features/results-review";
import {
  SafetyRemediationPanel,
  architectureElementFromRow,
  getRepoMeta,
  safetyRemediationStore,
} from "./features/safety-remediation";
import {
  CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE,
  CodeArchitectureHazardPanel,
  CODE_ARCHITECTURE_HAZARD_GENERATION_MODE_OPTIONS,
  deleteCodeArchitectureHazardRuns,
  ensureCodeArchitectureTraceIds,
  getCodeArchitectureHazardRuns,
  getLatestCodeArchitectureHazardRun,
  isCodeArchitectureHazardAnalysisStale,
  runCodeArchitectureHazardAnalysis,
  saveCodeArchitectureHazardRun,
} from "./features/code-architecture-hazard-analysis";
import {
  ARTIFACT_KINDS,
  EngineeringArtifactPanel,
  TraceabilityMatrixPanel,
  architectureLabelFromRef,
  architectureRefToFocusTarget,
  artifactKindForLinkType,
  functionalRowIndexForTraceValue,
  loadArtifactRows,
  loadArtifactRowsAsync,
  saveArtifactRowsAsync,
} from "./features/code-architecture-assurance";
import {
  ARTIFACT_DEFINITIONS,
  TRACEABILITY_MATRIX_COLUMNS,
} from "./features/code-architecture-assurance/artifactDefinitions";
import { buildTraceabilityRows } from "./features/code-architecture-assurance/TraceabilityMatrixPanel";
import {
  XHANDLE_IDB_CBA_STORE,
  XHANDLE_IDB_NAME,
  codeArchitectureMetaKey,
  codeArchitectureRowsKey,
  readCbaRowsFromIndexedDB,
  readFirstCbaRowsFromIndexedDB,
  writeCbaRowsToIndexedDB,
} from "./features/code-architecture-assurance/codeArchitectureStorage";
import {
  formatDuration,
  formatUsd,
} from "./features/code-architecture-assurance/codeArchitectureMetrics";
import {
  CrossRepoArchitecturePanel,
  CROSS_REPO_ARCHITECTURE_KIND,
  getCbaProjectsInFolderTree,
  getCrossRepoGeneratedMeta,
} from "./features/code-architecture-cross-repo";
import {
  chooseCodeArchitectureReviewDestination,
  collectCodeArchitectureReviewPackage,
  downloadCodeArchitectureReviewApp,
  isHostedCodeArchitectureReviewPackagerConfigured,
  REVIEW_ANALYSIS_SECTIONS,
} from "./features/code-architecture-review/codeArchitectureReviewExport";

const CODE_ARCHITECTURE_REVIEW_ANALYSIS_OPTIONS = [
  { key: REVIEW_ANALYSIS_SECTIONS.HAZARD, label: "Hazard & Remediation" },
  { key: REVIEW_ANALYSIS_SECTIONS.SOFTWARE, label: "Software Requirements", artifactKind: ARTIFACT_KINDS.SOFTWARE },
  { key: REVIEW_ANALYSIS_SECTIONS.SYSTEM, label: "System Requirements", artifactKind: ARTIFACT_KINDS.SYSTEM },
  { key: REVIEW_ANALYSIS_SECTIONS.SUBSYSTEM, label: "Subsystem Requirements", artifactKind: ARTIFACT_KINDS.SUBSYSTEM },
  { key: REVIEW_ANALYSIS_SECTIONS.DESIGN, label: "System / Subsystem Design", artifactKind: ARTIFACT_KINDS.DESIGN },
  { key: REVIEW_ANALYSIS_SECTIONS.TRACEABILITY, label: "Traceability Matrix" },
];

const PROJECT_RISK_PROFILE_OMITTED_COLUMNS = new Set([
  "Trace ID",
  "From Node ID",
  "Control Edge ID",
  "To Node ID",
  "Architecture Row Ref",
  "Architecture Element ID",
  "Function (From) Related File(s)",
  "Function (To) Related File(s)",
  "Consolidated Requirement",
  "Related Source File(s)",
  "Source Symbols",
  "Source Line Ranges",
  "Subsystem",
  "CSCI",
  "CSC",
  "CSU",
]);

const PROJECT_DRAFT_HAZARD_BASE_HEADERS = [
  "Function (From)",
  "Control Action",
  "Function (To)",
  "Subsystem Allocation",
];

const PROJECT_DRAFT_HAZARD_METHOD_HEADERS = {
  STPA: [
    "Loss",
    "Hazard",
    "Unsafe Control Action",
    "Mitigation Strategy",
    "System Requirement",
  ],
  "STPA-Textbook": [
    "Loss",
    "Hazard",
    "Unsafe Control Action",
    "Mitigation Strategy",
    "System Requirement",
  ],
  "FMEA-Textbook": [
    "Loss",
    "Hazard",
    "Failure Mode",
    "Causal Factor",
    "Mitigation Strategy",
    "System Requirement",
  ],
  HARA: [
    "Item / Function",
    "Loss",
    "Hazard",
    "Hazardous Event",
    "Malfunction",
    "Severity",
    "Exposure",
    "Controllability",
    "ASIL",
    "Safety Goal",
    "Rationale",
    "Safety Significant",
    "Safety Significance Rationale",
  ],
  FHA: [
    "Function",
    "Functional Degradation / Loss",
    "Hazard",
    "Mishap",
    "Effect",
    "Severity Category",
    "Software Control Category",
    "Software Criticality Index",
    "LOR Tasks",
    "Causal Factors",
    "Mitigation Strategy",
    "Software Safety Requirement",
    "Verification",
    "Rationale",
    "Safety Significant",
    "Safety Significance Rationale",
  ],
  "WhatIf-Textbook": [
    "Loss",
    "Hazard",
    "What-If Scenario",
    "Causal Factor",
    "Mitigation Strategy",
    "System Requirement",
  ],
};

function getProjectDraftHazardHeaders(method = "STPA") {
  const methodHeaders = PROJECT_DRAFT_HAZARD_METHOD_HEADERS[method] || PROJECT_DRAFT_HAZARD_METHOD_HEADERS.STPA;
  return Array.from(new Set([...PROJECT_DRAFT_HAZARD_BASE_HEADERS, ...methodHeaders]));
}

function buildProjectDraftHazardRow(functionalRow = {}, headers = getProjectDraftHazardHeaders()) {
  const fallbackSubsystem = String(functionalRow?.subsystem || "").trim() || "Unallocated";
  const knownValues = {
    "Function (From)": functionalRow?.fromFunction || "",
    "Control Action": functionalRow?.controlAction || "",
    "Function (To)": functionalRow?.toFunction || "",
    "Subsystem Allocation": fallbackSubsystem,
    "Item / Function": functionalRow?.fromFunction || functionalRow?.toFunction || "",
    "Function": functionalRow?.fromFunction || functionalRow?.toFunction || "",
  };
  return headers.map((header) => knownValues[header] || "");
}

const PROJECT_DRAFT_HAZARD_HEADER_ALIASES = {
  "Function (From)": ["Function (From)", "From Function", "Source Function", "Controller"],
  "Control Action": ["Control Action", "Unsafe Control Action", "UCA", "Action", "What-If Scenario", "Failure Mode", "Malfunction"],
  "Function (To)": ["Function (To)", "To Function", "Target Function", "Controlled Process"],
  "Subsystem Allocation": ["Subsystem Allocation", "Subsystem"],
  "Unsafe Control Action": ["Unsafe Control Action", "UCA", "Control Action"],
  "Mitigation Strategy": ["Mitigation Strategy", "Controls", "Safeguard", "Recommendation"],
  "System Requirement": ["System Requirement", "Software Safety Requirement", "Safety Goal", "Design Requirement"],
  "Causal Factor": ["Causal Factor", "Causal Factors", "Cause", "Causes"],
  "Failure Mode": ["Failure Mode", "Malfunction"],
  "Item / Function": ["Item / Function", "Function"],
  "Function": ["Function", "Item / Function"],
};

function alignSummaryRowToHeaders(sourceHeaders = [], row = [], targetHeaders = [], fallbackRow = []) {
  const normalizedSourceHeaders = sourceHeaders.map((header) => normalizeAllocationText(header));
  const usedSourceIndexes = new Set();
  const aligned = targetHeaders.map((header, index) => {
    const candidates = PROJECT_DRAFT_HAZARD_HEADER_ALIASES[header] || [header];
    const sourceIndex = candidates
      .map((candidate) => normalizedSourceHeaders.indexOf(normalizeAllocationText(candidate)))
      .find((candidateIndex) => candidateIndex >= 0);
    if (sourceIndex >= 0) usedSourceIndexes.add(sourceIndex);
    const generatedValue = sourceIndex >= 0 ? row?.[sourceIndex] : "";
    return generatedValue || fallbackRow[index] || "";
  });
  const remainingGeneratedValues = row
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => !usedSourceIndexes.has(index) && String(cell || "").trim())
    .map(({ cell }) => cell);
  let remainingIndex = 0;
  return aligned.map((cell, index) => {
    if (String(cell || "").trim()) return cell;
    if (index < PROJECT_DRAFT_HAZARD_BASE_HEADERS.length) return cell;
    const nextValue = remainingGeneratedValues[remainingIndex];
    if (nextValue) remainingIndex += 1;
    return nextValue || cell;
  });
}

function findBestGeneratedHazardSummary(sheets = {}) {
  const candidateNames = [
    "Summary",
    "Security Summary",
    "FMEA",
    "What-If",
    "What If",
    "HARA",
    "FHA",
    "Unsafe Control Actions",
    "Unsafe Control Action",
    "Causal Factors",
  ];
  const candidates = candidateNames
    .map((name) => sheets?.[name])
    .filter((sheet) => Array.isArray(sheet) && Array.isArray(sheet[0]) && Array.isArray(sheet[1]));
  if (candidates.length) return candidates[0];
  return Object.values(sheets || {}).find((sheet) => (
    Array.isArray(sheet) &&
    Array.isArray(sheet[0]) &&
    Array.isArray(sheet[1])
  ));
}

function isMeaningfullyGeneratedDraftRow(row = [], fallbackRow = []) {
  return row.some((cell, index) => (
    index >= PROJECT_DRAFT_HAZARD_BASE_HEADERS.length &&
    String(cell || "").trim() &&
    String(cell || "").trim() !== String(fallbackRow[index] || "").trim()
  ));
}

function getFunctionalControlActionKey(functionalRow = {}) {
  return [
    functionalRow?.fromFunction,
    functionalRow?.controlAction,
    functionalRow?.toFunction,
  ].map(normalizeAllocationText).join("::");
}

function buildHazardRowControlActionKey(row = [], headers = []) {
  const fromIdx = findSummaryColumn(headers, ["Function (From)", "From Function", "Source Function", "Controller"]);
  const actionIdx = findSummaryColumn(headers, ["Control Action", "Unsafe Control Action", "UCA", "Action", "What-If Scenario", "Failure Mode", "Malfunction"]);
  const toIdx = findSummaryColumn(headers, ["Function (To)", "To Function", "Target Function", "Controlled Process"]);
  return [
    fromIdx >= 0 ? row?.[fromIdx] : "",
    actionIdx >= 0 ? row?.[actionIdx] : "",
    toIdx >= 0 ? row?.[toIdx] : "",
  ].map(normalizeAllocationText).join("::");
}

function findExistingHazardRowForFunctionalRow(functionalRow = {}, summary = null) {
  if (!Array.isArray(summary) || !Array.isArray(summary[0]) || summary.length < 2) return null;
  const headers = summary[0];
  const targetKey = getFunctionalControlActionKey(functionalRow);
  return summary.slice(1).find((row) => buildHazardRowControlActionKey(row, headers) === targetKey) || null;
}

function stripProjectRiskProfileColumns(sheets = {}) {
  if (!sheets || typeof sheets !== "object") return sheets;
  return Object.fromEntries(Object.entries(sheets).map(([sheetName, sheetRows]) => {
    if (!Array.isArray(sheetRows) || !Array.isArray(sheetRows[0])) return [sheetName, sheetRows];
    const keepIndexes = sheetRows[0]
      .map((header, index) => ({ header: String(header || "").trim(), index }))
      .filter(({ header }) => !PROJECT_RISK_PROFILE_OMITTED_COLUMNS.has(header))
      .map(({ index }) => index);
    if (keepIndexes.length === sheetRows[0].length) return [sheetName, sheetRows];
    return [sheetName, sheetRows.map((row) => keepIndexes.map((index) => row?.[index] ?? ""))];
  }));
}

function normalizeAllocationText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findSummaryColumn(headers = [], candidates = []) {
  const normalized = headers.map((header) => normalizeAllocationText(header));
  return candidates
    .map((candidate) => normalized.indexOf(normalizeAllocationText(candidate)))
    .find((index) => index >= 0) ?? -1;
}

function rowIncludesPhrase(rowText, phrase) {
  const needle = normalizeAllocationText(phrase);
  return Boolean(needle && rowText.includes(needle));
}

function buildSubsystemAllocationForSummaryRow(row = [], headers = [], functionalRows = []) {
  const fromIdx = findSummaryColumn(headers, ["Function (From)", "From Function", "Source Function", "Controller"]);
  const actionIdx = findSummaryColumn(headers, ["Control Action", "Unsafe Control Action", "UCA", "Action"]);
  const toIdx = findSummaryColumn(headers, ["Function (To)", "To Function", "Target Function", "Controlled Process"]);
  const from = fromIdx >= 0 ? normalizeAllocationText(row[fromIdx]) : "";
  const action = actionIdx >= 0 ? normalizeAllocationText(row[actionIdx]) : "";
  const to = toIdx >= 0 ? normalizeAllocationText(row[toIdx]) : "";
  const rowText = normalizeAllocationText(row.join(" "));

  let bestScore = 0;
  const matches = [];

  (functionalRows || []).forEach((functionalRow) => {
    const subsystem = String(functionalRow?.subsystem || "").trim();
    if (!subsystem) return;
    const fnFrom = normalizeAllocationText(functionalRow?.fromFunction);
    const fnAction = normalizeAllocationText(functionalRow?.controlAction);
    const fnTo = normalizeAllocationText(functionalRow?.toFunction);

    let score = 0;
    if (from && fnFrom && from === fnFrom) score += 6;
    else if (rowIncludesPhrase(rowText, fnFrom)) score += 4;
    if (action && fnAction && action === fnAction) score += 6;
    else if (rowIncludesPhrase(rowText, fnAction)) score += 4;
    if (to && fnTo && to === fnTo) score += 6;
    else if (rowIncludesPhrase(rowText, fnTo)) score += 3;

    if (!score) return;
    if (score > bestScore) {
      bestScore = score;
      matches.length = 0;
    }
    if (score === bestScore) matches.push(subsystem);
  });

  const allocations = Array.from(new Set(matches)).filter(Boolean);
  return allocations.length ? allocations.join("; ") : "Unallocated";
}

function addSubsystemAllocationsToProjectHazardSummary(sheets = {}, functionalRows = []) {
  if (!sheets || typeof sheets !== "object") return sheets;
  const summary = sheets.Summary;
  if (!Array.isArray(summary) || !Array.isArray(summary[0]) || summary.length < 2) return sheets;
  const headers = summary[0].map((header) => String(header || ""));
  const existingIdx = headers.findIndex((header) => normalizeAllocationText(header) === "subsystem allocation");
  const nextHeaders = existingIdx >= 0 ? headers : [...headers, "Subsystem Allocation"];
  const nextSummary = [
    nextHeaders,
    ...summary.slice(1).map((row) => {
      const nextRow = [...row];
      const allocation = buildSubsystemAllocationForSummaryRow(nextRow, headers, functionalRows);
      if (existingIdx >= 0) nextRow[existingIdx] = allocation;
      else nextRow.push(allocation);
      return nextRow;
    }),
  ];
  return { ...sheets, Summary: nextSummary };
}

function analysisOptionsForReviewTargets(targetOptions = [], selectedTargetIds = []) {
  const selectedSet = new Set(selectedTargetIds);
  const selectedTargets = targetOptions.filter((target) => target.available !== false && selectedSet.has(target.id));
  return CODE_ARCHITECTURE_REVIEW_ANALYSIS_OPTIONS.map((option) => {
    const count = selectedTargets.reduce((sum, target) => (
      sum + Number(target.analysisCounts?.[option.key] || 0)
    ), 0);
    return {
      ...option,
      count,
      available: count > 0,
    };
  });
}

const CODE_ARCHITECTURE_WORKBOOK_SHEET_OPTIONS = [
  { key: "functional", label: "Architecture Diagram table" },
  { key: "hazard", label: "Hazard analysis" },
  { key: ARTIFACT_KINDS.SOFTWARE, label: "Software requirements" },
  { key: ARTIFACT_KINDS.SYSTEM, label: "System requirements" },
  { key: ARTIFACT_KINDS.SUBSYSTEM, label: "Subsystem requirements" },
  { key: ARTIFACT_KINDS.DESIGN, label: "System / subsystem design" },
  { key: "traceability", label: "Traceability matrix" },
  { key: "remediation", label: "Safety remediation" },
];

function CodeArchitectureWorkbookExportModal({
  projectName = "",
  repoName = "",
  scope = "project",
  selectedSheets = [],
  isExporting = false,
  message = "",
  onScopeChange,
  onToggleSheet,
  onSelectAll,
  onDeselectAll,
  onCancel,
  onConfirm,
}) {
  const selectedSet = new Set(selectedSheets);
  const scopeLabel = scope === "analysis" ? (repoName || "current analysis") : (projectName || "project");
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Export Workbook</h2>
          <p className="mt-1 text-sm text-slate-500">Choose the analysis scope and sheets to include in the workbook.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5">
            <span className="mb-2 block text-sm font-semibold text-slate-800">Scope</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { key: "project", label: "Entire project", detail: projectName || "All repos in this project" },
                { key: "analysis", label: "Current analysis", detail: repoName || "Active repository only" },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onScopeChange?.(option.key)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    scope === option.key
                      ? "border-blue-500 bg-blue-50 text-blue-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{option.detail}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">Workbook contents</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onSelectAll} className="text-xs font-semibold text-blue-700 hover:underline">Select all</button>
                <button type="button" onClick={onDeselectAll} className="text-xs font-semibold text-slate-500 hover:underline">Clear</button>
              </div>
            </div>
            <div className="space-y-2">
              {CODE_ARCHITECTURE_WORKBOOK_SHEET_OPTIONS.map((option) => (
                <label key={option.key} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option.key)}
                    onChange={() => onToggleSheet?.(option.key)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</div>}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
          <span className="min-w-0 truncate text-xs text-slate-500">Exporting {scopeLabel}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" disabled={isExporting}>
              Cancel
            </button>
            <button type="button" onClick={onConfirm} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={isExporting}>
              {isExporting ? "Exporting..." : "Export Workbook"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ProjectExportModal({
  projects = [],
  selectedProjectId = "",
  isExporting = false,
  message = "",
  onSelectionChange,
  onCancel,
  onConfirm,
}) {
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Export Project</h2>
          <p className="mt-1 text-sm text-slate-500">Choose one project and export its locally stored artifacts as JSON.</p>
        </div>
        <div className="px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-800">Project</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={selectedProjectId}
              onChange={(event) => onSelectionChange?.(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" disabled={isExporting}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={isExporting || !selectedProjectId}>
            {isExporting ? "Exporting..." : "Export Project"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CodeArchitectureReviewAnalysisModal({
  appName = "",
  reviewAppTarget = "mac",
  destinationDirectory = "",
  isHostedPackager = false,
  targetOptions = [],
  selectedTargetIds = [],
  options = [],
  selectedKeys = [],
  onAppNameChange,
  onReviewAppTargetChange,
  onChooseDestination,
  onDestinationDirectoryChange,
  onToggleTarget,
  onSelectAllTargets,
  onDeselectAllTargets,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onCancel,
  onConfirm,
}) {
  const [isChoosingDestination, setIsChoosingDestination] = useState(false);
  const [destinationError, setDestinationError] = useState("");
  const selectedSet = new Set(selectedKeys);
  const selectedTargetSet = new Set(selectedTargetIds);
  const targetAvailableCount = targetOptions.filter((option) => option.available !== false).length;
  const selectedTargetCount = targetOptions.filter((option) => option.available !== false && selectedTargetSet.has(option.id)).length;
  const availableCount = options.filter((option) => option.available).length;
  const selectedCount = options.filter((option) => option.available && selectedSet.has(option.key)).length;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Generate Review App</h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose the projects and completed analysis results to include. Architecture Diagram is always included for each selected target.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-semibold text-slate-800">Review app name</span>
            <input
              type="text"
              value={appName}
              onChange={(event) => onAppNameChange?.(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="e.g., LinoRobot2 Architecture Review"
              autoFocus
            />
          </label>
          <div className="mb-5">
            <span className="mb-2 block text-sm font-semibold text-slate-800">Review app platform</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {[
                { key: "mac", label: "Mac" },
                { key: "win", label: "Windows" },
              ].map((target) => (
                <button
                  key={target.key}
                  type="button"
                  onClick={() => onReviewAppTargetChange?.(target.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                    reviewAppTarget === target.key
                      ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {target.label}
                </button>
              ))}
            </div>
          </div>
          {!isHostedPackager && (
            <div className="mb-5">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-800">Destination folder</span>
                <div className="flex min-w-0 gap-2">
                  <input
                    type="text"
                    value={destinationDirectory}
                    onChange={(event) => onDestinationDirectoryChange?.(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    placeholder="Leave blank for dist-review"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!onChooseDestination || isChoosingDestination) return;
                      setDestinationError("");
                      setIsChoosingDestination(true);
                      try {
                        await onChooseDestination();
                      } catch (error) {
                        setDestinationError(error?.message || "Could not choose a destination folder.");
                      } finally {
                        setIsChoosingDestination(false);
                      }
                    }}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                    disabled={isChoosingDestination}
                  >
                    {isChoosingDestination ? "Opening..." : "Choose..."}
                  </button>
                </div>
              </label>
              <p className="mt-2 text-xs text-slate-500">
                The local packager will write the review app zip to the selected destination.
              </p>
              {destinationError && (
                <p className="mt-2 text-xs font-medium text-red-600">{destinationError}</p>
              )}
            </div>
          )}
          <div className="mb-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Review scope</h3>
                <p className="text-xs text-slate-500">
                  {selectedTargetCount} of {targetAvailableCount} available selected
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onSelectAllTargets}
                  disabled={!targetAvailableCount}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={onDeselectAllTargets}
                  disabled={!targetAvailableCount}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Deselect all
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {targetOptions.map((target) => {
                const available = target.available !== false;
                return (
                  <label
                    key={target.id}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${
                      available
                        ? "cursor-pointer border-slate-200 bg-white hover:bg-slate-50"
                        : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                      checked={available && selectedTargetSet.has(target.id)}
                      disabled={!available}
                      onChange={() => onToggleTarget?.(target.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800">{target.label}</span>
                      <span className="block text-xs text-slate-500">{target.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Analysis results</h3>
              <p className="text-xs font-medium text-slate-500">
                {selectedCount} of {availableCount} available selected
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={!availableCount}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onDeselectAll}
                disabled={!availableCount}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Deselect all
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {options.map((option) => (
              <label
                key={option.key}
                className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${
                  option.available
                    ? "cursor-pointer border-slate-200 bg-white hover:bg-slate-50"
                    : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                  checked={option.available && selectedSet.has(option.key)}
                  disabled={!option.available}
                  onChange={() => onToggle(option.key)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
                  <span className="block text-xs text-slate-500">
                    {option.available
                      ? `${option.count} row${option.count === 1 ? "" : "s"} available`
                      : "Analysis has not been run"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!String(appName || "").trim() || selectedTargetCount === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Generate Review App
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const CollaboratorNavIcon = React.memo(function CollaboratorNavIcon({ active = false }) {
  return (
    <div className="flex h-[30px] w-[30px] items-center justify-center">
      <img
        src="/x_Logo.PNG"
        alt=""
        draggable={false}
        decoding="async"
        className={`h-full w-full object-contain ${active ? "drop-shadow-[0_0_6px_#2D7DFE]" : ""}`}
      />
    </div>
  );
});

const CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE = "code_architecture_functional_decomposition_table";
const DEFAULT_START_SECTION = "code-architecture";

function ProjectMenuPortal({ anchorEl, setPortalRef, onRename, onInvite, onDelete }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    function computePosition() {
      if (!anchorEl) return;
      const r = anchorEl.getBoundingClientRect();

      const MENU_W = 160; // w-40
      const MENU_H = 120; // ~3 items + padding
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

      {onInvite && (
        <button
          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
          onClick={onInvite}
          role="menuitem"
        >
          Invite collaborator(s)
        </button>
      )}

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

function FolderMenuPortal({ anchorEl, setPortalRef, onNewProject, onNewFolder, onRename, onDelete }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const MENU_W = 168;
  const MENU_H = 160;

  useEffect(() => {
    function computePosition() {
      if (!anchorEl) return;
      const r = anchorEl.getBoundingClientRect();

      const GAP = 8;
      const openUp = r.bottom + MENU_H + GAP > window.innerHeight;
      const top = openUp
        ? Math.max(8, r.top - MENU_H - GAP)
        : Math.min(window.innerHeight - MENU_H - 8, r.bottom + GAP);
      const left = Math.min(window.innerWidth - MENU_W - 8, Math.max(8, r.right - MENU_W));

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
      className="fixed z-[1000] bg-white border rounded-lg shadow-md overflow-hidden"
      style={{ top: pos.top, left: pos.left, width: MENU_W }}
      role="menu"
      aria-label="Folder options"
    >
      <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={onNewProject} role="menuitem">
        New project
      </button>
      <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={onNewFolder} role="menuitem">
        New subfolder
      </button>
      <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={onRename} role="menuitem">
        Rename
      </button>
      <button className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-50" onClick={onDelete} role="menuitem">
        Delete
      </button>
    </div>,
    document.body
  );
}

function InviteCollaboratorsModal({ projectName, onClose, onSubmit }) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState("write");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleInvite = async () => {
    setError("");
    const list = emails
      .split(/[, \n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) {
      setError("Enter at least one email.");
      return;
    }
    setSending(true);
    try {
      await onSubmit({ emails: list, role });
      onClose();
    } catch (e) {
      setError(String(e?.message || e) || "Failed to create invite.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-[201] w-full max-w-lg rounded-2xl border-2 border-indigo-500 bg-white shadow-xl">
        <div className="px-5 py-4 border-b">
          <h2 className="text-base font-semibold">Invite collaborators</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Project: <span className="font-medium">{projectName}</span>
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-600">Email addresses</label>
            <textarea
              rows={3}
              className="w-full mt-1 border rounded px-3 py-2 text-sm"
              placeholder="alice@company.com, bob@company.com"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Comma, space, or newline separated. Local invites are stored on this machine.
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-600">Permission</label>
            <select
              className="w-48 mt-1 border rounded px-2 py-1 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="read">Read-only</option>
              <option value="write">Read &amp; write</option>
            </select>
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
          <button className="px-3 py-2 rounded border" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6] disabled:opacity-60"
            onClick={handleInvite}
            disabled={sending}
          >
            {sending ? "Creating..." : "Create invite(s)"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
const makeId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const PROJECTS_KEY = 'xhandle.projects';
const ACTIVE_PROJECT_ID_KEY = 'xhandle.activeProjectId';
const PROJECT_DATA_KEY = 'xhandle.projectData';
const PROJECTS_OPEN_KEY = 'xhandle.sidebarProjectsOpen';
const PROJECT_FOLDERS_KEY = 'xhandle.projectFolders';
const PROJECT_FOLDERS_OPEN_KEY = 'xhandle.sidebarProjectFoldersOpen';
const PROJECT_FOLDER_DASHBOARDS_KEY = 'xhandle.projectFolderDashboards';
const CBA_PROJECTS_KEY = 'xhandle.codeArchitectureProjects';
const ACTIVE_CBA_PROJECT_ID_KEY = 'xhandle.activeCodeArchitectureProjectId';
const CBA_PROJECTS_OPEN_KEY = 'xhandle.sidebarCodeArchitectureProjectsOpen';
const CBA_FOLDERS_KEY = 'xhandle.codeArchitectureFolders';
const CBA_FOLDERS_OPEN_KEY = 'xhandle.sidebarCodeArchitectureFoldersOpen';

// Keep projects hidden on Console
const SHOW_CONSOLE_PROJECTS = false;
const normalizeRepoIdentity = ({ owner = "", repo = "", repoId = "" } = {}) =>
  repoId || [owner, repo].filter(Boolean).join("/");

const normalizeRepoIdentityText = (value = "") => String(value || "").trim().toLowerCase();

function codeArchitectureReposMatch(a = {}, b = {}) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const aRepoId = normalizeRepoIdentityText(a.repoId || normalizeRepoIdentity(a));
  const bRepoId = normalizeRepoIdentityText(b.repoId || normalizeRepoIdentity(b));
  if (aRepoId && bRepoId && aRepoId === bRepoId) return true;
  const aOwner = normalizeRepoIdentityText(a.owner);
  const bOwner = normalizeRepoIdentityText(b.owner);
  const aRepo = normalizeRepoIdentityText(a.repo || a.repoName);
  const bRepo = normalizeRepoIdentityText(b.repo || b.repoName);
  return Boolean(aOwner && bOwner && aRepo && bRepo && aOwner === bOwner && aRepo === bRepo);
}

function codeArchitectureMetricsSummary(metrics = null) {
  if (!metrics) return "";
  const parts = [];
  if (metrics.durationMs) parts.push(formatDuration(metrics.durationMs));
  if (metrics.aiCallCount) parts.push(`${metrics.aiCallCount} AI call${metrics.aiCallCount === 1 ? "" : "s"}`);
  if (metrics.totalTokens) parts.push(`${metrics.totalTokens.toLocaleString()} tokens`);
  if (metrics.estimatedCostAvailable) parts.push(`est. ${formatUsd(Number(metrics.estimatedCostUsd || 0))}`);
  return parts.join(" · ");
}

function normalizeCodeArchitectureGroundingStats(grounding = null) {
  if (!grounding || typeof grounding !== "object") return null;
  const rejectionReasons = grounding.rejectionReasons && typeof grounding.rejectionReasons === "object"
    ? Object.fromEntries(
      Object.entries(grounding.rejectionReasons)
        .map(([key, value]) => [key, Number(value || 0)])
        .filter(([, value]) => value > 0)
    )
    : {};
  return {
    accepted: Number(grounding.accepted || 0),
    rejected: Number(grounding.rejected || 0),
    weakEvidenceCount: Number(grounding.weakEvidenceCount || 0),
    duplicateRowCount: Number(grounding.duplicateRowCount || 0),
    normalizedPathCount: Number(grounding.normalizedPathCount || 0),
    rejectionReasons,
  };
}

function codeArchitectureGroundingSummary(grounding = null) {
  const stats = normalizeCodeArchitectureGroundingStats(grounding);
  if (!stats) return "";
  const parts = [];
  if (stats.accepted) parts.push(`${stats.accepted.toLocaleString()} accepted`);
  if (stats.rejected) parts.push(`${stats.rejected.toLocaleString()} rejected`);
  if (stats.duplicateRowCount) parts.push(`${stats.duplicateRowCount.toLocaleString()} duplicate${stats.duplicateRowCount === 1 ? "" : "s"} removed`);
  if (stats.weakEvidenceCount) parts.push(`${stats.weakEvidenceCount.toLocaleString()} weak evidence`);
  return parts.join(" · ");
}

function parseGitHubRepoUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withoutGitSuffix = raw.replace(/\.git(?:[#?].*)?$/i, "");
  const sshMatch = withoutGitSuffix.match(/^git@github\.com:([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i);
  if (sshMatch) {
    return {
      owner: decodeURIComponent(sshMatch[1]),
      repo: decodeURIComponent(sshMatch[2]),
      repoUrl: `https://github.com/${sshMatch[1]}/${sshMatch[2]}`,
    };
  }
  const normalized = /^https?:\/\//i.test(withoutGitSuffix)
    ? withoutGitSuffix
    : `https://${withoutGitSuffix.replace(/^github\.com\//i, "github.com/")}`;
  try {
    const url = new URL(normalized);
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return {
      owner: decodeURIComponent(owner),
      repo: decodeURIComponent(repo),
      repoUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    const pathMatch = withoutGitSuffix.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s#?]+)/i);
    if (!pathMatch) return null;
    return {
      owner: decodeURIComponent(pathMatch[1]),
      repo: decodeURIComponent(pathMatch[2]),
      repoUrl: `https://github.com/${pathMatch[1]}/${pathMatch[2]}`,
    };
  }
}

function makeRepoConfig({
  owner = "",
  repo = "",
  repoUrl = "",
  token = "",
  selectedExtensions = [],
  analysisContext = null,
  branch = "",
  commitSha = "",
  filesFound = 0,
} = {}) {
  const trimmedOwner = String(owner || "").trim();
  const trimmedRepo = String(repo || "").trim();
  const repoId = normalizeRepoIdentity({ owner: trimmedOwner, repo: trimmedRepo });
  const now = new Date().toISOString();
  return {
    id: makeId(),
    owner: trimmedOwner,
    repo: trimmedRepo,
    repoId,
    repoName: repoId,
    repoUrl: String(repoUrl || "").trim() || (trimmedOwner && trimmedRepo ? `https://github.com/${trimmedOwner}/${trimmedRepo}` : ""),
    token: String(token || "").trim(),
    selectedExtensions: Array.isArray(selectedExtensions) ? selectedExtensions : [],
    analysisContext: analysisContext || { text: "", files: [] },
    branch,
    commitSha,
    filesFound,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeCodeArchitectureProjects(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((project) => project && project.id)
    .map((project) => {
      const repos = Array.isArray(project.repos) ? project.repos : [];
      const normalizedRepos = repos
        .filter((repo) => repo && (repo.owner || repo.repo || repo.repoId))
        .map((repo) => {
          const owner = String(repo.owner || "").trim();
          const name = String(repo.repo || repo.repoName || "").replace(/^.*\//, "").trim();
          const repoId = repo.repoId || normalizeRepoIdentity({ owner, repo: name });
          return {
            id: repo.id || makeId(),
            owner,
            repo: name,
            repoId,
            repoName: repo.repoName || repoId,
            repoUrl: repo.repoUrl || (owner && name ? `https://github.com/${owner}/${name}` : ""),
            token: repo.token || "",
            selectedExtensions: Array.isArray(repo.selectedExtensions) ? repo.selectedExtensions : [],
            analysisContext: repo.analysisContext || { text: "", files: [] },
            operationalContext: repo.operationalContext || "",
            contextSources: repo.contextSources || null,
            branch: repo.branch || "",
            commitSha: repo.commitSha || "",
            filesFound: Number(repo.filesFound || 0),
            createdAt: repo.createdAt || project.createdAt || new Date().toISOString(),
            updatedAt: repo.updatedAt || project.updatedAt || project.createdAt || new Date().toISOString(),
            lastAnalyzedAt: repo.lastAnalyzedAt || null,
          };
        });
      return {
        id: project.id,
        name: project.name || "Code architecture project",
        folderId: project.folderId || null,
        repos: normalizedRepos,
        activeRepoId: project.activeRepoId || normalizedRepos[0]?.id || null,
        createdAt: project.createdAt || new Date().toISOString(),
        updatedAt: project.updatedAt || project.createdAt || new Date().toISOString(),
      };
    });
}

function migrateLegacyCodeArchitectureProjects() {
  try {
    const existing = normalizeCodeArchitectureProjects(JSON.parse(localStorage.getItem(CBA_PROJECTS_KEY) || "[]"));
    if (existing.length) return existing;
    const owner = localStorage.getItem("repoOwner") || "";
    const repo = localStorage.getItem("repoName") || "";
    if (!owner || !repo) return [];
    const token = localStorage.getItem("githubToken") || "";
    const repoConfig = makeRepoConfig({ owner, repo, token });
    const project = {
      id: makeId(),
      name: `${owner}/${repo}`,
      folderId: null,
      repos: [repoConfig],
      activeRepoId: repoConfig.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(CBA_PROJECTS_KEY, JSON.stringify([project]));
    return [project];
  } catch {
    return [];
  }
}

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
    'xhandle.projectFolders',
    'xhandle.sidebarProjectFoldersOpen',
    'xhandle.projectFolderDashboards',
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


function readProjectMap() {
  try { return JSON.parse(localStorage.getItem(PROJECT_DATA_KEY) || '{}'); }
  catch { return {}; }
}
function writeProjectMap(map) {
  try { localStorage.setItem(PROJECT_DATA_KEY, JSON.stringify(map)); }
  catch {}
}
function saveProjectPatch(projectId, patch) {
  if (!projectId) return;
  const map = readProjectMap();
  const prev = map[projectId] || {};
  map[projectId] = { ...prev, ...patch, _updatedAt: new Date().toISOString() };
  writeProjectMap(map);
}
function loadProjectData(projectId) {
  const map = readProjectMap();
  return map[projectId] || null;
}
function projectExportFileName(projectName) {
  const safeName = String(projectName || "xhandle-project")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "xhandle-project";
  return `${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
}
function projectStorageKeyPart(projectId) {
  return `proj_${String(projectId || "").toLowerCase().trim().replace(/[^a-z0-9]+/gi, "_")}`;
}
function isProjectScopedLocalStorageKey(key, projectId) {
  const rawKey = String(key || "");
  const diagramBase = `diagram:positions:${projectId}`;
  const liteBase = `LiteSummaryDiagram::${projectStorageKeyPart(projectId)}::`;
  return rawKey === diagramBase || rawKey.startsWith(`${diagramBase}:`) || rawKey.startsWith(liteBase);
}
function collectProjectLocalStorageEntries(projectId) {
  if (!projectId || typeof localStorage === "undefined") return [];
  const entries = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!isProjectScopedLocalStorageKey(key, projectId)) continue;
    entries.push({ key, value: localStorage.getItem(key) || "" });
  }
  return entries;
}
function remapProjectScopedLocalStorageKey(key, oldProjectId, newProjectId) {
  const rawKey = String(key || "");
  if (!oldProjectId || !newProjectId) return rawKey;
  const oldDiagramBase = `diagram:positions:${oldProjectId}`;
  if (rawKey === oldDiagramBase || rawKey.startsWith(`${oldDiagramBase}:`)) {
    return `diagram:positions:${newProjectId}${rawKey.slice(oldDiagramBase.length)}`;
  }
  const oldLiteBase = `LiteSummaryDiagram::${projectStorageKeyPart(oldProjectId)}::`;
  if (rawKey.startsWith(oldLiteBase)) {
    return `LiteSummaryDiagram::${projectStorageKeyPart(newProjectId)}::${rawKey.slice(oldLiteBase.length)}`;
  }
  return rawKey;
}
function hasAnalysisSummary(value) {
  return Array.isArray(value?.Summary) && value.Summary.length > 0;
}

function functionalRowSignature(rows) {
  return JSON.stringify((rows || []).map((row) => ({
    subsystem: String(row?.subsystem || "").trim(),
    fromFunction: String(row?.fromFunction || "").trim(),
    fromDetails: String(row?.fromDetails || "").trim(),
    controlAction: String(row?.controlAction || "").trim(),
    controlDetails: String(row?.controlDetails || "").trim(),
    toFunction: String(row?.toFunction || "").trim(),
    toDetails: String(row?.toDetails || "").trim(),
  })));
}

function parseJsonObjectFromText(text) {
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

function parseJsonArrayFromText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw;
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.risks)) return parsed.risks;
    if (Array.isArray(parsed?.riskRegister)) return parsed.riskRegister;
  } catch {}
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

function extractAIText(payload) {
  const candidates = [
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.result,
    payload?.answer,
    payload?.content,
    payload?.message,
    payload?.text,
    payload?.data?.result,
    payload?.data?.content,
  ];
  return candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean) || "";
}

function generateDiagramCategoryDescription(name, functions = [], rows = []) {
  const uniqueFunctions = Array.from(new Set(
    (functions || []).map((fn) => String(fn || "").trim()).filter(Boolean)
  ));
  const functionSet = new Set(uniqueFunctions.map((fn) => fn.toLowerCase()));
  const relatedRows = (rows || []).filter((row) =>
    functionSet.has(String(row?.fromFunction || "").trim().toLowerCase()) ||
    functionSet.has(String(row?.toFunction || "").trim().toLowerCase())
  );
  const details = Array.from(new Set(
    relatedRows
      .flatMap((row) => [row?.fromDetails, row?.controlDetails, row?.toDetails])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
  const actions = Array.from(new Set(
    relatedRows.map((row) => String(row?.controlAction || "").trim()).filter(Boolean)
  ));
  const title = cleanDiagramCategoryName(name || "Category");
  const detailPreview = details.slice(0, 4).join(" ");
  const actionPreview = actions.slice(0, 5).join(", ");
  const functionPreview = uniqueFunctions.slice(0, 5).join(", ");
  const functionRemainder = uniqueFunctions.length > 5 ? `, and ${uniqueFunctions.length - 5} more` : "";

  if (detailPreview) {
    return `${title} groups ${uniqueFunctions.length || relatedRows.length} related function${(uniqueFunctions.length || relatedRows.length) === 1 ? "" : "s"} including ${functionPreview}${functionRemainder}. It is responsible for the behaviors described by its functions and interfaces: ${detailPreview}`;
  }
  if (actionPreview) {
    return `${title} groups ${uniqueFunctions.length || relatedRows.length} related function${(uniqueFunctions.length || relatedRows.length) === 1 ? "" : "s"} that coordinate ${actions.length} interface/control action${actions.length === 1 ? "" : "s"}: ${actionPreview}. This category owns the related control flow, data exchange, and coordination responsibilities in the generated architecture.`;
  }
  return `${title} groups related functions in the generated functional architecture and should be reviewed as a subsystem boundary for shared responsibilities, interfaces, data/state ownership, and safety-relevant behavior.`;
}

function normalizeWizardDiagramCategories(plan, rows) {
  const allFunctions = Array.from(new Set(
    (rows || []).flatMap((row) => [row?.fromFunction, row?.toFunction])
      .map((fn) => String(fn || "").trim())
      .filter(Boolean)
  ));
  const exactByLower = new Map(allFunctions.map((fn) => [fn.toLowerCase(), fn]));
  const assignedFunctionNames = new Set();

  const categories = (Array.isArray(plan?.categories) ? plan.categories : [])
    .map((category, index) => {
      const fnSet = new Set();
      (Array.isArray(category?.rowIndexes) ? category.rowIndexes : []).forEach((rowIndex) => {
        const row = rows[Number(rowIndex)];
        if (!row) return;
        if (row.fromFunction) fnSet.add(String(row.fromFunction).trim());
        if (row.toFunction) fnSet.add(String(row.toFunction).trim());
      });
      (category?.functions || category?.functionNames || []).forEach((fn) => {
        const exact = exactByLower.get(String(fn || "").trim().toLowerCase());
        if (exact) fnSet.add(exact);
      });
      const functions = Array.from(fnSet)
        .filter(Boolean)
        .filter((fn) => {
          const key = fn.toLowerCase();
          if (assignedFunctionNames.has(key)) return false;
          assignedFunctionNames.add(key);
          return true;
        });
      return {
        name: cleanDiagramCategoryName(category?.name || `Category ${index + 1}`),
        functions,
        description: String(category?.description || "").trim(),
      };
    })
    .filter((category) => category.name && category.functions.length)
    .filter((category) => !/\b(unallocated|unassigned|uncategorized|other functions?)\b/i.test(category.name))
    .filter((category) => !isGenericDiagramCategoryName(category.name))
    .slice(0, 10);

  if (!categories.length && allFunctions.length) {
    categories.push({ name: "System Architecture", functions: [] });
  }

  const functionToCategory = new Map();
  categories.forEach((category) => {
    category.functions = Array.from(new Set(category.functions));
    category.functions.forEach((fn) => functionToCategory.set(fn, category));
  });
  const assigned = new Set(functionToCategory.keys());
  const unassigned = allFunctions.filter((fn) => !assigned.has(fn));
  unassigned.forEach((fn) => {
    const relatedRows = (rows || []).filter((row) =>
      String(row?.fromFunction || "").trim() === fn || String(row?.toFunction || "").trim() === fn
    );
    const relatedCategory = relatedRows
      .flatMap((row) => [String(row?.fromFunction || "").trim(), String(row?.toFunction || "").trim()])
      .map((relatedFn) => functionToCategory.get(relatedFn))
      .find(Boolean);
    const targetCategory = relatedCategory || categories[0];
    targetCategory.functions.push(fn);
    functionToCategory.set(fn, targetCategory);
  });

  categories.forEach((category) => {
    category.functions = Array.from(new Set(category.functions)).filter(Boolean);
    category.description = category.description || generateDiagramCategoryDescription(category.name, category.functions, rows);
  });
  return categories;
}

function cleanDiagramCategoryName(value) {
  const cleaned = String(value || "Category")
    .replace(/\bcomputer software configuration item\b/gi, "")
    .replace(/\bcsci\b/gi, "")
    .replace(/\s*[-:|/]\s*$/g, "")
    .replace(/^\s*[-:|/]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (cleaned || "Category").slice(0, 60);
}

function isGenericDiagramCategoryName(value) {
  return /^(manages?|conducts?|controls?|verifies?|monitors?|provides?|handles?|supports?|processes?|system)$/i.test(
    cleanDiagramCategoryName(value)
  );
}

function parseWizardPromptContext(wizardPrompt) {
  try {
    const parsed = JSON.parse(String(wizardPrompt || ""));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return { raw: String(wizardPrompt || "") };
}

function extractWizardComponentNames(context) {
  const text = String(context?.functionalComponents || context?.components || "");
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").split(/\s*[:;-]\s*/)[0])
    .map((name) => cleanDiagramCategoryName(name))
    .filter((name) => name.length >= 4 && !/^(component|module|system)$/i.test(name))
    .slice(0, 30);
}

const FALLBACK_CATEGORY_RULES = [
  {
    name: "Command and Operator Interface",
    terms: ["operator", "user interface", "console", "command", "control processor", "launch control", "external command", "manual", "crew", "display"],
  },
  {
    name: "Security and Authentication",
    terms: ["auth", "authenticate", "credential", "secure", "cyber", "authorization", "access", "identity", "encryption"],
  },
  {
    name: "Sensing and Safety Monitoring",
    terms: ["sensor", "sensing", "monitor", "environment", "telemetry", "alert", "redundancy", "safety verification", "diagnostic", "health", "status"],
  },
  {
    name: "Actuation and Mechanical Control",
    terms: ["actuat", "mechanical", "alignment", "align", "fire control", "launch tube", "servo", "motor", "movement", "position"],
  },
  {
    name: "Power and Support Systems",
    terms: ["power", "battery", "energy", "supply", "thermal", "support", "cooling"],
  },
  {
    name: "Data Logging and Audit",
    terms: ["log", "logging", "audit", "record", "history", "trace", "review", "evidence"],
  },
  {
    name: "Communications and External Interfaces",
    terms: ["communication", "communicate", "interface", "network", "external", "uplink", "downlink", "message", "protocol"],
  },
];

function scoreTextForTerms(text, terms) {
  const lower = String(text || "").toLowerCase();
  return terms.reduce((score, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = lower.match(new RegExp(escaped, "g"));
    return score + (matches ? matches.length : 0);
  }, 0);
}

function fallbackWizardDiagramCategories(rows, wizardPrompt = "") {
  const context = parseWizardPromptContext(wizardPrompt);
  const wizardComponents = extractWizardComponentNames(context);
  const componentRules = wizardComponents.map((component) => ({
    name: component,
    terms: component.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 2),
  })).filter((rule) => rule.terms.length);
  const rules = [...componentRules, ...FALLBACK_CATEGORY_RULES];
  const buckets = new Map();

  (rows || []).forEach((row, index) => {
    const rowText = [
      row?.fromFunction,
      row?.fromDetails,
      row?.controlAction,
      row?.controlDetails,
      row?.toFunction,
      row?.toDetails,
      row?.subsystem,
    ].filter(Boolean).join("\n");
    const ranked = rules
      .map((rule) => ({ ...rule, score: scoreTextForTerms(rowText, rule.terms) }))
      .filter((rule) => rule.score > 0)
      .sort((a, b) => b.score - a.score);
    const name = cleanDiagramCategoryName(row?.subsystem || ranked[0]?.name || row?.fromFunction || row?.toFunction || "System Architecture");
    if (!buckets.has(name)) buckets.set(name, { name, rowIndexes: [], functions: [] });
    const bucket = buckets.get(name);
    bucket.rowIndexes.push(index);
    if (row?.fromFunction) bucket.functions.push(String(row.fromFunction).trim());
    if (row?.toFunction) bucket.functions.push(String(row.toFunction).trim());
  });

  const categories = Array.from(buckets.values())
    .filter((category) => category.functions.length)
    .sort((a, b) => b.rowIndexes.length - a.rowIndexes.length)
    .slice(0, 8);
  return { categories };
}

async function classifyPromptWizardDiagramCategories(rows, wizardPrompt) {
  const signature = functionalRowSignature(rows);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const compactRows = rows.slice(0, 160).map((row, index) => ({
    index,
    subsystem: row.subsystem || "",
    fromFunction: row.fromFunction || "",
    fromDetails: row.fromDetails || "",
    controlAction: row.controlAction || "",
    controlDetails: row.controlDetails || "",
    toFunction: row.toFunction || "",
    toDetails: row.toDetails || "",
  }));

  const prompt = `
You are a senior systems architect. xHandle has already generated a functional decomposition from the prompt wizard. Perform the second pass once: classify the functions into CSCI-level categories for the functional diagram.

CSCI = Computer Software Configuration Item. In this diagram, a CSCI is a major subsystem, responsibility area, or configuration-controlled item that can contain multiple functions.

Rules:
- Use only the supplied wizard prompt and functional decomposition rows.
- Read the System Overview first and use it as the mission/context for interpreting every row.
- Review every row by row index before assigning categories.
- When a row has a subsystem value, treat it as the preferred CSCI/category grouping hint unless the function descriptions clearly contradict it.
- Assign each row to a category based on the source function, destination function, interface/control action, and the detailed descriptions for that row.
- Create concise subsystem/responsibility category names from the system context, such as "Launch Control", "Authentication and Cybersecurity", "Sensing and Safety Monitoring", or "Operator Interface".
- Create one category description after reviewing the generated function and interface descriptions.
- Prefer 3-8 CSCI categories.
- Do not create CSC or CSU levels.
- Do not rename functions.
- Allocate every row to exactly one CSCI category.
- Do not use generic verb-only category names such as "Manages", "Controls", "Conducts", "Verifies", "Monitors", "Provides", or "Processes".
- Make each category description detailed enough for architecture review: describe the subsystem mission, main responsibilities, key functions included, important interfaces/control flows, data or state it owns/transforms, and safety/quality concerns visible in the rows.
- Base descriptions on fromDetails, controlDetails, and toDetails, not just a list of function names.
- Use 35-70 words per category description when evidence supports it.
- Avoid generic descriptions such as "groups related functions" unless you also state the concrete responsibilities and interfaces.
- Return strict JSON only.

Return this schema:
{
  "categories": [
    {
      "name": "Brake Control CSCI",
      "description": "Coordinates brake command interpretation, control-law execution, actuator command output, and feedback monitoring.",
      "rowIndexes": [0, 1],
      "functions": ["exact function name"]
    }
  ]
}

Original wizard prompt:
${String(wizardPrompt || "").slice(0, 6000)}

Functional decomposition rows:
${JSON.stringify(compactRows, null, 2)}
  `.trim();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Return only strict JSON. No prose or markdown." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2500,
      }),
    });
    if (!response.ok) throw new Error(`Category AI HTTP ${response.status}`);
    const data = await response.json();
    const plan = parseJsonObjectFromText(data?.choices?.[0]?.message?.content || "");
    const categories = normalizeWizardDiagramCategories(plan, rows);
    if (!categories.length) throw new Error("Category AI returned no usable categories.");
    return { signature, categories, source: "wizard-ai", generatedAt: new Date().toISOString() };
  } catch (error) {
    console.warn("Prompt wizard category classification failed; using fallback CSCI categories.", error);
    return {
      signature,
      categories: normalizeWizardDiagramCategories(fallbackWizardDiagramCategories(rows, wizardPrompt), rows),
      source: "wizard-fallback",
      generatedAt: new Date().toISOString(),
    };
  }
}
function removeProjectData(projectId) {
  const map = readProjectMap();
  if (map && Object.prototype.hasOwnProperty.call(map, projectId)) {
    delete map[projectId];
    writeProjectMap(map);
  }
}

function repairDuplicateProjectIds(rawProjects) {
  const list = Array.isArray(rawProjects) ? rawProjects : [];
  const seen = new Set();
  let changed = false;
  const map = readProjectMap();

  const repaired = list.map((project) => {
    if (!project?.id || seen.has(project.id)) {
      const oldId = project?.id;
      const newId = makeId();
      seen.add(newId);
      changed = true;
      if (oldId && map[oldId] && !map[newId]) {
        map[newId] = { ...map[oldId], _updatedAt: new Date().toISOString() };
      }
      return { ...project, id: newId };
    }
    seen.add(project.id);
    return project;
  });

  if (changed) {
    writeProjectMap(map);
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(repaired)); } catch {}
  }

  return repaired;
}

function normalizeProjectFolders(rawFolders) {
  const list = Array.isArray(rawFolders) ? rawFolders : [];
  const seen = new Set();

  return list
    .filter((folder) => folder && typeof folder === "object")
    .map((folder) => {
      const id = folder.id && !seen.has(folder.id) ? folder.id : makeId();
      seen.add(id);
      return {
        id,
        name: String(folder.name || "Untitled folder"),
        parentId: folder.parentId || null,
        createdAt: folder.createdAt || new Date().toISOString(),
        updatedAt: folder.updatedAt || folder.createdAt || new Date().toISOString(),
      };
    })
    .filter((folder, _index, folders) => !folder.parentId || folders.some((entry) => entry.id === folder.parentId));
}

const FOLDER_DASHBOARD_PANEL_TYPES = [
  { type: "overview", label: "Overview" },
  { type: "projectList", label: "Projects" },
  { type: "riskStatus", label: "Risk status" },
  { type: "recentActivity", label: "Recent activity" },
];

function makeFolderDashboardPanel(type, title) {
  const option = FOLDER_DASHBOARD_PANEL_TYPES.find((entry) => entry.type === type) || FOLDER_DASHBOARD_PANEL_TYPES[0];
  return {
    id: makeId(),
    type: option.type,
    title: title || option.label,
    size: option.type === "projectList" ? "wide" : "normal",
  };
}

function getDefaultFolderDashboardPanels() {
  return [
    { id: "overview", type: "overview", title: "Folder overview", size: "normal" },
    { id: "project-list", type: "projectList", title: "Projects", size: "wide" },
    { id: "risk-status", type: "riskStatus", title: "Risk status", size: "normal" },
    { id: "recent-activity", type: "recentActivity", title: "Recent activity", size: "normal" },
  ];
}

function normalizeFolderDashboardMap(rawMap) {
  const map = rawMap && typeof rawMap === "object" && !Array.isArray(rawMap) ? rawMap : {};
  return Object.fromEntries(
    Object.entries(map).map(([folderId, panels]) => [
      folderId,
      Array.isArray(panels) && panels.length
        ? panels.map((panel) => ({
            id: panel?.id || makeId(),
            type: FOLDER_DASHBOARD_PANEL_TYPES.some((entry) => entry.type === panel?.type) ? panel.type : "overview",
            title: String(panel?.title || FOLDER_DASHBOARD_PANEL_TYPES.find((entry) => entry.type === panel?.type)?.label || "Panel"),
            size: panel?.size === "wide" ? "wide" : "normal",
          }))
        : getDefaultFolderDashboardPanels(),
    ])
  );
}
// Ensure IndexedDB exists for project storage used by Copilot create flow
function ensureTraceabilityDB() {
  return ensureTraceabilitySchema();
}

function LiteXHandle() {
    const resultsReview = useResultsReview();
    // Local-only open-source builds skip hosted auth and start unlocked.
    const [gate, setGate] = useState({ phase: 'ok', user: { id: 'local-user' }, provider: 'local', last4: null, error: null });
    const [savingKey, setSavingKey] = useState(false);
    const [aiProviderInput, setAiProviderInput] = useState('openai');
    const [providerKeyInput, setProviderKeyInput] = useState('');
    const [showSettingsModal, setShowSettingsModal] = useState(false);
const [repoConnected, setRepoConnected] = useState(false);
const [isGeneratingCodeArchitectureReviewApp, setIsGeneratingCodeArchitectureReviewApp] = useState(false);
const [codeArchitectureReviewAnalysisModal, setCodeArchitectureReviewAnalysisModal] = useState(null);
const codeArchitectureReviewAnalysisSelectionRef = useRef(null);
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

const [section, setSection] = useState(DEFAULT_START_SECTION); // 'projects' | 'console' | 'risk' | 'reports' | 'settings'

  // Docked Copilot (persistent)
  const [dockOpen, setDockOpen] = useState(() => localStorage.getItem('xhandle.copilotDockOpen') === 'true');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dockExpanded, setDockExpanded] = useState(false);
  // Reserve space for the right dock so it doesn't overlay content
  const dockPaddingClass = dockOpen && !dockCollapsed
    ? dockExpanded
      ? 'pr-[min(760px,100vw)]'
      : 'pr-[380px] md:pr-[420px]'
    : '';
const [codeArchitectureProjects, setCodeArchitectureProjects] = useState(() => migrateLegacyCodeArchitectureProjects());
const [codeArchitectureFolders, setCodeArchitectureFolders] = useState(() => {
  try { return normalizeProjectFolders(JSON.parse(localStorage.getItem(CBA_FOLDERS_KEY) || "[]")); }
  catch { return []; }
});
const [activeCodeArchitectureProjectId, setActiveCodeArchitectureProjectId] = useState(() => {
  return null;
});
const [activeCodeArchitectureFolderId, setActiveCodeArchitectureFolderId] = useState(null);
const [isCodeArchitectureProjectsOpen, setIsCodeArchitectureProjectsOpen] = useState(() => {
  const saved = localStorage.getItem(CBA_PROJECTS_OPEN_KEY);
  return saved ? saved === "true" : true;
});
const [openCodeArchitectureFolderIds, setOpenCodeArchitectureFolderIds] = useState(() => {
  try { return JSON.parse(localStorage.getItem(CBA_FOLDERS_OPEN_KEY) || "{}"); }
  catch { return {}; }
});
const [showNewCodeArchitectureProject, setShowNewCodeArchitectureProject] = useState(false);
const [showNewCodeArchitectureFolder, setShowNewCodeArchitectureFolder] = useState(false);
const [showCodeArchitectureProjectExport, setShowCodeArchitectureProjectExport] = useState(false);
const [codeArchitectureProjectExportSelection, setCodeArchitectureProjectExportSelection] = useState("");
const [isExportingCodeArchitectureProject, setIsExportingCodeArchitectureProject] = useState(false);
const [codeArchitectureProjectExportMsg, setCodeArchitectureProjectExportMsg] = useState("");
const [showCodeArchitectureWorkbookExport, setShowCodeArchitectureWorkbookExport] = useState(false);
const [codeArchitectureWorkbookExportScope, setCodeArchitectureWorkbookExportScope] = useState("project");
const [codeArchitectureWorkbookExportSheets, setCodeArchitectureWorkbookExportSheets] = useState(
  CODE_ARCHITECTURE_WORKBOOK_SHEET_OPTIONS.map((option) => option.key)
);
const [isExportingCodeArchitectureWorkbook, setIsExportingCodeArchitectureWorkbook] = useState(false);
const [codeArchitectureWorkbookExportMsg, setCodeArchitectureWorkbookExportMsg] = useState("");
const [newCodeArchitectureProjectName, setNewCodeArchitectureProjectName] = useState("");
const [newCodeArchitectureFolderName, setNewCodeArchitectureFolderName] = useState("");
const [newCodeArchitectureTargetFolderId, setNewCodeArchitectureTargetFolderId] = useState(null);
const [newCodeArchitectureFolderParentId, setNewCodeArchitectureFolderParentId] = useState(null);
const [newCodeArchitectureError, setNewCodeArchitectureError] = useState("");
const [newCodeArchitectureFolderError, setNewCodeArchitectureFolderError] = useState("");
const [editingCodeArchitectureProjectId, setEditingCodeArchitectureProjectId] = useState(null);
const [editingCodeArchitectureProjectName, setEditingCodeArchitectureProjectName] = useState("");
const [editingCodeArchitectureFolderId, setEditingCodeArchitectureFolderId] = useState(null);
const [editingCodeArchitectureFolderName, setEditingCodeArchitectureFolderName] = useState("");
const [codeArchitectureRenameError, setCodeArchitectureRenameError] = useState("");
const [openCodeArchitectureProjectMenuId, setOpenCodeArchitectureProjectMenuId] = useState(null);
const [openCodeArchitectureFolderMenuId, setOpenCodeArchitectureFolderMenuId] = useState(null);
const [draggingCodeArchitectureProjectId, setDraggingCodeArchitectureProjectId] = useState(null);
const [dragOverCodeArchitectureFolderId, setDragOverCodeArchitectureFolderId] = useState(null);
const codeArchitectureProjectMenuAnchorEls = useRef({});
const codeArchitectureProjectMenuPortalRefs = useRef({});
const codeArchitectureFolderMenuAnchorEls = useRef({});
const codeArchitectureFolderMenuPortalRefs = useRef({});
const codeArchitectureProjectImportInputRef = useRef(null);
const [showCodeArchitectureRepoConfig, setShowCodeArchitectureRepoConfig] = useState(false);
const [codeArchitectureRepoConfigProjectId, setCodeArchitectureRepoConfigProjectId] = useState(null);
const [codeArchitectureRepoConfigRepoId, setCodeArchitectureRepoConfigRepoId] = useState(null);
const [codeArchitectureRepoDraft, setCodeArchitectureRepoDraft] = useState({
  repoUrl: "",
  owner: "",
  repo: "",
  token: "",
  analysisContextText: "",
  analysisContextFiles: [],
});
const [codeArchitectureRepoConfigMessage, setCodeArchitectureRepoConfigMessage] = useState("");
const [isCodeArchitectureRepoVerifying, setIsCodeArchitectureRepoVerifying] = useState(false);
const [isCodeArchitectureRepoAnalyzing, setIsCodeArchitectureRepoAnalyzing] = useState(false);
const [codeArchitectureRepoFilesForModal, setCodeArchitectureRepoFilesForModal] = useState([]);
const [codeArchitectureFileSelectorOpen, setCodeArchitectureFileSelectorOpen] = useState(false);
const codeArchitectureFileSelectorResolver = useRef(null);
const [cbaTableData, setCbaTableData] = useState([]);
const [selectedCbaElement, setSelectedCbaElement] = useState(null);
const [codeArchitectureWorkspaceTab, setCodeArchitectureWorkspaceTab] = useState("architecture");
const [codeArchitectureFolderView, setCodeArchitectureFolderView] = useState("projects");
const [codeArchitectureArtifactFocus, setCodeArchitectureArtifactFocus] = useState(null);
const [hazardRemediationTab, setHazardRemediationTab] = useState("hazard-analysis");
const [codeArchitectureFunctionalReviewRunId, setCodeArchitectureFunctionalReviewRunId] = useState("");
const [codeArchitectureFunctionalTableOpenKey, setCodeArchitectureFunctionalTableOpenKey] = useState(null);
const [highlightedCodeArchitectureFunctionalRowIndex, setHighlightedCodeArchitectureFunctionalRowIndex] = useState(null);
const [codeArchitectureHazardSummaryOpenKey, setCodeArchitectureHazardSummaryOpenKey] = useState(null);
const [highlightedCodeArchitectureHazardRowIndex, setHighlightedCodeArchitectureHazardRowIndex] = useState(null);
const [pendingCodeArchitectureDiagramTarget, setPendingCodeArchitectureDiagramTarget] = useState(null);
const [codeArchitectureHazardMethod, setCodeArchitectureHazardMethod] = useState("STPA-Textbook");
const [codeArchitectureHazardGenerationMode, setCodeArchitectureHazardGenerationMode] = useState("standard");
const [codeArchitectureHazardRun, setCodeArchitectureHazardRun] = useState(null);
const [isRunningCodeArchitectureHazard, setIsRunningCodeArchitectureHazard] = useState(false);
const [codeArchitectureHazardProgress, setCodeArchitectureHazardProgress] = useState({
  step: 0,
  total: 9,
  message: "",
});

function getSavedGitHubSelectedExtensions() {
  try {
    const raw = localStorage.getItem("githubSelectedExtensions");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

const activeCodeArchitectureProject = useMemo(
  () => codeArchitectureProjects.find((project) => project.id === activeCodeArchitectureProjectId) || null,
  [codeArchitectureProjects, activeCodeArchitectureProjectId]
);
const activeCodeArchitectureFolder = useMemo(
  () => codeArchitectureFolders.find((folder) => folder.id === activeCodeArchitectureFolderId) || null,
  [codeArchitectureFolders, activeCodeArchitectureFolderId]
);
const activeCodeArchitectureRepo = useMemo(() => {
  const repos = activeCodeArchitectureProject?.repos || [];
  return repos.find((repo) => repo.id === activeCodeArchitectureProject?.activeRepoId) || repos[0] || null;
}, [activeCodeArchitectureProject]);
const activeCodeArchitectureRowsKey = activeCodeArchitectureProject && activeCodeArchitectureRepo
  ? codeArchitectureRowsKey(activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id)
  : null;
const activeCodeArchitectureStoredMeta = useMemo(() => {
  if (!activeCodeArchitectureProject || !activeCodeArchitectureRepo) return null;
  try {
    return JSON.parse(localStorage.getItem(codeArchitectureMetaKey(activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id)) || "null");
  } catch {
    return null;
  }
}, [activeCodeArchitectureProject, activeCodeArchitectureRepo]);
const activeCodeArchitectureRepoMeta = useMemo(() => {
  if (!activeCodeArchitectureRepo) return getRepoMeta();
  return {
    owner: activeCodeArchitectureRepo.owner || "",
    repo: activeCodeArchitectureRepo.repo || "",
    repoId: activeCodeArchitectureRepo.repoId || normalizeRepoIdentity(activeCodeArchitectureRepo),
    repoName: activeCodeArchitectureRepo.repoName || activeCodeArchitectureRepo.repoId || normalizeRepoIdentity(activeCodeArchitectureRepo),
    repoUrl: activeCodeArchitectureRepo.repoUrl || "",
    branch: activeCodeArchitectureRepo.branch || "main",
    commitSha: activeCodeArchitectureRepo.commitSha || "",
    analysisContext: activeCodeArchitectureRepo.analysisContext || { text: "", files: [] },
    operationalContext: activeCodeArchitectureStoredMeta?.operationalContext || activeCodeArchitectureRepo.operationalContext || "",
    contextSources: activeCodeArchitectureStoredMeta?.contextSources || activeCodeArchitectureRepo.contextSources || null,
  };
}, [activeCodeArchitectureRepo, activeCodeArchitectureStoredMeta]);
const activeCodeArchitectureUnavailableRowCount = Number(activeCodeArchitectureStoredMeta?.rowCount || 0);
const activeCodeArchitectureMetricsSummary = codeArchitectureMetricsSummary(activeCodeArchitectureStoredMeta?.metrics);
const activeCodeArchitectureGroundingSummary = codeArchitectureGroundingSummary(activeCodeArchitectureStoredMeta?.grounding);

async function readCodeArchitectureRowsForRepo(project, repo, primaryKey) {
  if (!project || !repo || !primaryKey) return { rows: [], sourceKey: primaryKey || "" };
  const candidateKeys = [primaryKey];
  try {
    const meta = JSON.parse(localStorage.getItem(codeArchitectureMetaKey(project.id, repo.id)) || "null");
    if (meta?.indexedDB?.key) candidateKeys.push(meta.indexedDB.key);
    if (meta?.storageKey) candidateKeys.push(meta.storageKey);
  } catch {}
  if (repo.owner && repo.repo) candidateKeys.push(`cba:${repo.owner}/${repo.repo}`);
  if (repo.repoId) candidateKeys.push(codeArchitectureRowsKey(project.id, repo.repoId));
  if (repo.repoName) candidateKeys.push(codeArchitectureRowsKey(project.id, repo.repoName));
  (project.repos || [])
    .filter((entry) => entry.id !== repo.id && codeArchitectureReposMatch(entry, repo))
    .forEach((entry) => {
      if (entry.id) candidateKeys.push(codeArchitectureRowsKey(project.id, entry.id));
      if (entry.repoId) candidateKeys.push(codeArchitectureRowsKey(project.id, entry.repoId));
      if (entry.repoName) candidateKeys.push(codeArchitectureRowsKey(project.id, entry.repoName));
    });

  const uniqueKeys = Array.from(new Set(candidateKeys.filter(Boolean)));
  const result = await readFirstCbaRowsFromIndexedDB(uniqueKeys);
  return { rows: result.rows, sourceKey: result.key || primaryKey };
}

function codeArchitectureReviewRowsForRepo(project, repo, reviewItems = []) {
  if (!project || !repo || !Array.isArray(reviewItems) || reviewItems.length === 0) return [];
  const repoIds = [
    repo.id,
    repo.repoId,
    repo.repoName,
    repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : "",
    "repo",
  ];
  (project.repos || [])
    .filter((entry) => codeArchitectureReposMatch(entry, repo))
    .forEach((entry) => {
      repoIds.push(entry.id, entry.repoId, entry.repoName);
      if (entry.owner && entry.repo) repoIds.push(`${entry.owner}/${entry.repo}`);
    });
  const artifactPrefixes = Array.from(new Set(repoIds.filter(Boolean).map(
    (repoId) => `code-architecture-functional-decomposition:${project.id}:${repoId}:row:`
  )));
  const byRowIndex = new Map();
  reviewItems.forEach((item) => {
    if (item.artifactType !== CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE) return;
    if (item.projectId && item.projectId !== project.id) return;
    if (!artifactPrefixes.some((prefix) => String(item.artifactId || "").startsWith(prefix))) return;
    const rowIndex = Number(
      item.currentContent?.rowIndex ??
      item.originalContent?.rowIndex ??
      item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex
    );
    if (!Number.isFinite(rowIndex)) return;
    const existing = byRowIndex.get(rowIndex);
    const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
    const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
    if (!existing || itemTime >= existingTime) byRowIndex.set(rowIndex, item);
  });

  return Array.from(byRowIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([rowIndex, item]) => {
      const row = item.currentContent?.row || item.originalContent?.row || {};
      return {
        from: row.from || row.fromFunction || "",
        fromFile: row.fromFile || "",
        fromDetails: row.fromDetails || "",
        action: row.action || row.controlAction || "",
        controlActionDetails: row.controlActionDetails || row.controlDetails || "",
        to: row.to || row.toFunction || "",
        toFile: row.toFile || "",
        toDetails: row.toDetails || "",
        architecture: row.architecture || {
          subsystem: row.subsystem || "",
          csci: row.csci || "",
          csc: row.csc || "",
          csu: row.csu || "",
          rationale: row.architectureRationale || "",
        },
        recoveredFromReviewItemId: item.id,
        recoveredRowIndex: rowIndex,
      };
    })
    .filter((row) => row.from || row.action || row.to);
}

useEffect(() => {
  localStorage.setItem(CBA_PROJECTS_KEY, JSON.stringify(codeArchitectureProjects));
}, [codeArchitectureProjects]);
useEffect(() => {
  localStorage.setItem(CBA_FOLDERS_KEY, JSON.stringify(codeArchitectureFolders));
}, [codeArchitectureFolders]);
useEffect(() => {
  localStorage.setItem(CBA_PROJECTS_OPEN_KEY, String(isCodeArchitectureProjectsOpen));
}, [isCodeArchitectureProjectsOpen]);
useEffect(() => {
  localStorage.setItem(CBA_FOLDERS_OPEN_KEY, JSON.stringify(openCodeArchitectureFolderIds));
}, [openCodeArchitectureFolderIds]);
useEffect(() => {
  if (activeCodeArchitectureProjectId) localStorage.setItem(ACTIVE_CBA_PROJECT_ID_KEY, activeCodeArchitectureProjectId);
  else localStorage.removeItem(ACTIVE_CBA_PROJECT_ID_KEY);
}, [activeCodeArchitectureProjectId]);

useEffect(() => {
  if (!activeCodeArchitectureRowsKey) {
    setCbaLoading(false);
    setCbaTableData([]);
    setSelectedCbaElement(null);
    setCodeArchitectureHazardRun(null);
    return;
  }
  let cancelled = false;
  setCbaLoadingLabel("Loading saved analysis...");
  setCbaLoading(true);
  readCodeArchitectureRowsForRepo(activeCodeArchitectureProject, activeCodeArchitectureRepo, activeCodeArchitectureRowsKey)
    .then(({ rows, sourceKey }) => {
      if (cancelled) return;
      let recoverySource = sourceKey;
      let recoveredRows = Array.isArray(rows) ? rows : [];
      if (recoveredRows.length === 0) {
        const reviewRows = codeArchitectureReviewRowsForRepo(
          activeCodeArchitectureProject,
          activeCodeArchitectureRepo,
          resultsReview.reviewItems
        );
        if (reviewRows.length) {
          recoveredRows = reviewRows;
          recoverySource = "results-review";
        }
      }
      const rowsWithTraceIds = ensureCodeArchitectureTraceIds(recoveredRows);
      setCbaTableData(rowsWithTraceIds);
      if (rowsWithTraceIds.length && activeCodeArchitectureRowsKey) {
        writeCbaRowsToIndexedDB(activeCodeArchitectureRowsKey, rowsWithTraceIds).catch(() => {});
        if (recoverySource && recoverySource !== activeCodeArchitectureRowsKey) {
          try {
            localStorage.setItem(codeArchitectureMetaKey(activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id), JSON.stringify({
              ...(activeCodeArchitectureStoredMeta || {}),
              repoId: activeCodeArchitectureRepo.repoId || normalizeRepoIdentity(activeCodeArchitectureRepo),
              repoName: activeCodeArchitectureRepo.repoName || normalizeRepoIdentity(activeCodeArchitectureRepo),
              rowCount: rowsWithTraceIds.length,
              storage: "indexedDB",
              indexedDB: { database: XHANDLE_IDB_NAME, store: XHANDLE_IDB_CBA_STORE, key: activeCodeArchitectureRowsKey },
              recoveredFromKey: recoverySource,
              updatedAt: new Date().toISOString(),
            }));
          } catch {}
        }
      }
      setSelectedCbaElement(null);
      setCodeArchitectureHazardRun(null);
    })
    .finally(() => {
      if (!cancelled) setCbaLoading(false);
    });
  return () => {
    cancelled = true;
  };
}, [activeCodeArchitectureProject, activeCodeArchitectureRepo, activeCodeArchitectureRowsKey, activeCodeArchitectureStoredMeta, resultsReview.reviewItems]);

function updateCodeArchitectureProject(projectId, updater) {
  setCodeArchitectureProjects((prev) =>
    prev.map((project) => {
      if (project.id !== projectId) return project;
      const patch = typeof updater === "function" ? updater(project) : updater;
      return { ...project, ...patch, updatedAt: new Date().toISOString() };
    })
  );
}

function upsertCodeArchitectureRepo(projectId, repoConfig, { setActive = true } = {}) {
  updateCodeArchitectureProject(projectId, (project) => {
    const repos = Array.isArray(project.repos) ? project.repos : [];
    const existingIndex = repos.findIndex((entry) => codeArchitectureReposMatch(entry, repoConfig));
    const existingRepo = existingIndex >= 0 ? repos[existingIndex] : null;
    const nextRepo = { ...(existingRepo || {}), ...repoConfig, id: existingRepo?.id || repoConfig.id || makeId(), updatedAt: new Date().toISOString() };
    const nextRepos = existingIndex >= 0
      ? repos.map((entry, index) => (index === existingIndex ? nextRepo : entry))
      : [nextRepo, ...repos];
    return {
      repos: nextRepos,
      activeRepoId: setActive ? nextRepo.id : project.activeRepoId || nextRepos[0]?.id || null,
    };
  });
}

function openCodeArchitectureRepoConfig(projectId = activeCodeArchitectureProjectId, repoId = null) {
  const project = codeArchitectureProjects.find((entry) => entry.id === projectId) || null;
  const repoConfig = repoId
    ? (project?.repos || []).find((entry) => entry.id === repoId)
    : null;
  setCodeArchitectureRepoConfigProjectId(projectId);
  setCodeArchitectureRepoConfigRepoId(repoConfig?.id || null);
  setCodeArchitectureRepoDraft({
    repoUrl: repoConfig?.repoUrl || (repoConfig?.owner && repoConfig?.repo ? `https://github.com/${repoConfig.owner}/${repoConfig.repo}` : ""),
    owner: repoConfig?.owner || "",
    repo: repoConfig?.repo || "",
    token: repoConfig?.token || "",
    analysisContextText: repoConfig?.analysisContext?.text || "",
    analysisContextFiles: repoConfig?.analysisContext?.files || [],
  });
  setCodeArchitectureRepoConfigMessage("");
  setShowCodeArchitectureRepoConfig(true);
}

async function verifyCodeArchitectureRepo({ silent = false } = {}) {
  const parsedRepoUrl = parseGitHubRepoUrl(codeArchitectureRepoDraft.repoUrl);
  const owner = (codeArchitectureRepoDraft.owner.trim() || parsedRepoUrl?.owner || "").trim();
  const repo = (codeArchitectureRepoDraft.repo.trim() || parsedRepoUrl?.repo || "").trim();
  const token = codeArchitectureRepoDraft.token.trim();
  if (!owner || !repo) {
    setCodeArchitectureRepoConfigMessage("Paste a GitHub repo URL or enter owner and repo.");
    return null;
  }
  setIsCodeArchitectureRepoVerifying(true);
  if (!silent) setCodeArchitectureRepoConfigMessage("Verifying repository...");
  try {
    const headers = { "Content-Type": "application/json" };
    const response = await fetch(`${backendURL}/api/github/repo-files`, {
      method: "POST",
      headers,
      body: JSON.stringify(token ? { owner, repo, token } : { owner, repo }),
    });
    const defaultBranch = await getDefaultBranch(owner, repo, token || undefined);
    const repoFiles = filterSelectableRepoFiles(await listRepoFilesViaGitHub(owner, repo, token || undefined, defaultBranch));
    const json = await response.json().catch(() => ({}));
    if (!response.ok && !repoFiles.length) throw new Error(json?.error || `Verification failed (HTTP ${response.status})`);
    const count = repoFiles.length || (Array.isArray(json) ? json.length : Number(json?.files?.length || json?.count || 0));
    const repoConfig = makeRepoConfig({
      owner,
      repo,
      repoUrl: parsedRepoUrl?.repoUrl,
      token,
      analysisContext: {
        text: codeArchitectureRepoDraft.analysisContextText,
        files: codeArchitectureRepoDraft.analysisContextFiles,
      },
      branch: defaultBranch,
      filesFound: count || repoFiles.length,
    });
    if (codeArchitectureRepoConfigRepoId) repoConfig.id = codeArchitectureRepoConfigRepoId;
    if (!silent) setCodeArchitectureRepoConfigMessage(`Connected. Found ${count || repoFiles.length} repo files.`);
    setCodeArchitectureRepoFilesForModal(repoFiles);
    return { repoConfig, repoFiles };
  } catch (error) {
    setCodeArchitectureRepoConfigMessage(error?.message || String(error));
    return null;
  } finally {
    setIsCodeArchitectureRepoVerifying(false);
  }
}

function awaitCodeArchitectureFileTypes(files) {
  setCodeArchitectureRepoFilesForModal(files || []);
  setCodeArchitectureFileSelectorOpen(true);
  return new Promise((resolve) => {
    codeArchitectureFileSelectorResolver.current = resolve;
  });
}

async function saveCodeArchitectureRepoConfig({ analyze = false } = {}) {
  const projectId = codeArchitectureRepoConfigProjectId || activeCodeArchitectureProjectId;
  if (!projectId) {
    setCodeArchitectureRepoConfigMessage("Create or select a Code-Based Architecture project first.");
    return;
  }
  setIsCodeArchitectureRepoAnalyzing(Boolean(analyze));
  try {
    const verified = await verifyCodeArchitectureRepo({ silent: analyze });
    if (!verified?.repoConfig) return;
    let selectedExtensions = verified.repoConfig.selectedExtensions || [];
    if (analyze) {
      selectedExtensions = await awaitCodeArchitectureFileTypes(verified.repoFiles);
      if (!selectedExtensions.length) {
        setCodeArchitectureRepoConfigMessage("Analysis cancelled. No file types selected.");
        return;
      }
    }
    const repoConfig = {
      ...verified.repoConfig,
      selectedExtensions,
      analysisContext: {
        text: codeArchitectureRepoDraft.analysisContextText,
        files: codeArchitectureRepoDraft.analysisContextFiles,
      },
    };
    upsertCodeArchitectureRepo(projectId, repoConfig);
    setActiveCodeArchitectureProjectId(projectId);
    setActiveCodeArchitectureFolderId(null);
    if (analyze) {
      setShowCodeArchitectureRepoConfig(false);
      await handleBaselineRepo({
        projectId,
        repoConfig,
        selectedExtensions,
        analysisContext: repoConfig.analysisContext,
      });
    } else {
      setCodeArchitectureRepoConfigMessage("Repository saved.");
    }
  } finally {
    setIsCodeArchitectureRepoAnalyzing(false);
  }
}

function normalizeImportedCodeArchitectureRows(value) {
  const rawRows = Array.isArray(value)
    ? value
    : Array.isArray(value?.rows)
      ? value.rows
      : Array.isArray(value?.data)
        ? value.data
        : [];
  return ensureCodeArchitectureTraceIds(rawRows.map((row) => ({
    from: row.from || row.fromFunction || row["Function (From)"] || "",
    fromFile: row.fromFile || row.fromRelatedFiles || row["Function (From) Related File(s)"] || "",
    fromDetails: row.fromDetails || row.fromFunctionDetails || row["Function (From) Details"] || "",
    action: row.action || row.controlAction || row["Control Action"] || "",
    controlActionDetails: row.controlActionDetails || row.controlDetails || row["Control Action Details"] || "",
    to: row.to || row.toFunction || row["Function (To)"] || "",
    toFile: row.toFile || row.toRelatedFiles || row["Function (To) Related File(s)"] || "",
    toDetails: row.toDetails || row.toFunctionDetails || row["Function (To) Details"] || "",
    architecture: row.architecture || {
      subsystem: row.subsystem || row["Subsystem"] || "Application Subsystem",
      csci: row.csci || row["CSCI"] || "",
      csc: row.csc || row["CSC"] || "",
      csu: row.csu || row["CSU"] || "",
      rationale: row.architectureRationale || row["Architecture Rationale"] || "",
    },
    codeEvidence: row.codeEvidence || null,
    sourceEvidence: row.sourceEvidence || null,
    rowRef: row.rowRef || null,
    traceId: row.traceId || null,
    fromNodeId: row.fromNodeId || null,
    edgeId: row.edgeId || null,
    toNodeId: row.toNodeId || null,
  }))).filter((row) => row.from || row.action || row.to);
}

async function saveImportedCodeArchitectureRows({ project, file, rows, repoPackage = null }) {
  const importedAt = new Date().toISOString();
  const safeFileName = String(
    repoPackage?.repoName ||
    repoPackage?.repo?.repoName ||
    repoPackage?.repo?.repo ||
    file.name.replace(/\.[^.]+$/, "")
  ).trim() || "Imported Architecture";
  const repoOwner = String(repoPackage?.repo?.owner || "manual").trim() || "manual";
  const repoName = String(repoPackage?.repo?.repo || safeFileName).trim() || safeFileName;
  const repoConfig = makeRepoConfig({
    owner: repoOwner,
    repo: repoName,
    repoUrl: repoPackage?.repo?.repoUrl || "",
    branch: repoPackage?.repo?.branch || "imported",
    commitSha: repoPackage?.repo?.commitSha || "",
    filesFound: rows.length,
  });
  repoConfig.repoId = repoPackage?.repo?.repoId || `${repoOwner}/${repoName}`;
  repoConfig.repoName = safeFileName;
  repoConfig.imported = true;
  repoConfig.importedFileName = file.name;
  repoConfig.lastAnalyzedAt = importedAt;
  repoConfig.operationalContext = repoPackage?.metadata?.operationalContext || repoPackage?.repo?.operationalContext || "";
  repoConfig.contextSources = repoPackage?.metadata?.contextSources || repoPackage?.repo?.contextSources || null;

  const storageKey = codeArchitectureRowsKey(project.id, repoConfig.id);
  const rowsPersisted = await writeCbaRowsToIndexedDB(storageKey, rows);
  localStorage.setItem(codeArchitectureMetaKey(project.id, repoConfig.id), JSON.stringify({
    repoId: repoConfig.repoId,
    repoName: repoConfig.repoName,
    rowCount: rowsPersisted ? rows.length : 0,
    storage: rowsPersisted ? "indexedDB" : "unavailable",
    storageError: rowsPersisted ? "" : "Imported rows could not be saved to browser storage.",
    importSource: file.name,
    importedAt,
    metrics: repoPackage?.metadata?.metrics || null,
    grounding: normalizeCodeArchitectureGroundingStats(repoPackage?.metadata?.grounding),
    operationalContext: repoConfig.operationalContext,
    contextSources: repoConfig.contextSources,
    indexedDB: { database: XHANDLE_IDB_NAME, store: XHANDLE_IDB_CBA_STORE, key: storageKey },
    updatedAt: importedAt,
  }));
  return repoConfig;
}

function codeArchitectureExportFileName(projectName) {
  const safeName = String(projectName || "code-architecture-project")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "code-architecture-project";
  return `${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
}

function codeArchitectureRepoIdentityCandidates(repo = {}) {
  return Array.from(new Set([
    repo?.id,
    repo?.repoId,
    repo?.repoName,
    [repo?.owner, repo?.repo].filter(Boolean).join("/"),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filterCodeArchitectureReviewItemsForRepo(project, repo) {
  const repoIds = codeArchitectureRepoIdentityCandidates(repo);
  const prefixes = repoIds.flatMap((repoId) => [
    `code-architecture-functional-decomposition:${project.id}:${repoId}`,
    `code-architecture-hazard-summary:${project.id}:${repoId}`,
  ]);
  return (resultsReview.reviewItems || []).filter((item) => {
    if (item.projectId && item.projectId !== project.id) return false;
    const text = [item.artifactId, item.sourceRunId].filter(Boolean).join(" ");
    return prefixes.some((prefix) => text.includes(prefix));
  });
}

async function collectCodeArchitectureRepoAnalysis(project, repo) {
  const repoIds = codeArchitectureRepoIdentityCandidates(repo);
  const artifactRows = {};
  await Promise.all([
    ARTIFACT_KINDS.SOFTWARE,
    ARTIFACT_KINDS.SYSTEM,
    ARTIFACT_KINDS.SUBSYSTEM,
    ARTIFACT_KINDS.DESIGN,
  ].map(async (kind) => {
    for (const repoId of repoIds) {
      const rows = await loadArtifactRowsAsync(kind, project.id, repoId);
      if (rows.length) {
        artifactRows[kind] = rows;
        return;
      }
    }
    artifactRows[kind] = [];
  }));

  const allHazardRuns = await getCodeArchitectureHazardRuns({ projectId: project.id });
  const repoIdSet = new Set(repoIds);
  const hazardRuns = allHazardRuns.filter((run) => repoIdSet.has(String(run.repoId || "").trim()));
  const remediationState = await safetyRemediationStore.loadAll();
  const safetyFindings = (remediationState.safetyFindings || []).filter((finding) => {
    const findingProjectId = String(finding.projectId || "").trim();
    const findingRepoId = String(finding.repoId || finding.repoName || "").trim();
    return (!findingProjectId || findingProjectId === project.id) && (!findingRepoId || repoIdSet.has(findingRepoId));
  });
  const findingIds = new Set(safetyFindings.map((finding) => finding.id).filter(Boolean));
  const patchProposals = (remediationState.patchProposals || []).filter((patch) => findingIds.has(patch.safetyFindingId));
  const patchIds = new Set(patchProposals.map((patch) => patch.id).filter(Boolean));
  const reviewDecisions = (remediationState.reviewDecisions || []).filter((decision) => findingIds.has(decision.targetId) || patchIds.has(decision.targetId));
  const verificationRuns = (remediationState.verificationRuns || []).filter((run) => findingIds.has(run.safetyFindingId) || patchIds.has(run.patchProposalId));
  const safetyRemediationEvidence = (remediationState.safetyRemediationEvidence || []).filter((item) => findingIds.has(item.safetyFindingId) || patchIds.has(item.patchProposalId));

  return {
    artifactRows,
    hazardRuns,
    safetyRemediation: {
      safetyFindings,
      patchProposals,
      reviewDecisions,
      verificationRuns,
      safetyRemediationEvidence,
    },
    reviewItems: filterCodeArchitectureReviewItemsForRepo(project, repo),
  };
}

function remapImportedCodeArchitectureReviewValue(value, { project, repoConfig, repoPackage, originalProjectId }) {
  if (!value) return value;
  let next = String(value);
  next = next.replace(/code-architecture-functional-decomposition:[^:]+:[^:\s]+/g, `code-architecture-functional-decomposition:${project.id}:${repoConfig.id}`);
  next = next.replace(/code-architecture-hazard-summary:[^:]+:[^:\s]+/g, `code-architecture-hazard-summary:${project.id}:${repoConfig.id}`);
  if (originalProjectId) {
    next = next.replace(new RegExp(escapeRegExp(originalProjectId), "g"), project.id);
  }
  for (const repoId of codeArchitectureRepoIdentityCandidates(repoPackage?.repo || {})) {
    if (repoId && repoId !== repoConfig.id) {
      next = next.replace(new RegExp(escapeRegExp(repoId), "g"), repoConfig.id);
    }
  }
  return next;
}

async function restoreImportedCodeArchitectureRepoAnalysis({ project, repoConfig, repoPackage }) {
  const analysis = repoPackage?.analysis || {};
  const importedAt = new Date().toISOString();
  const artifactRows = analysis.artifactRows || {};
  await Promise.all(Object.entries(artifactRows).map(([kind, rows]) => (
    saveArtifactRowsAsync(kind, project.id, repoConfig.id, Array.isArray(rows) ? rows : [])
  )));

  const runIdMap = new Map();
  for (const run of (analysis.hazardRuns || [])) {
    const nextId = `imported-${makeId()}`;
    if (run?.id) runIdMap.set(run.id, nextId);
    await saveCodeArchitectureHazardRun({
      ...run,
      id: nextId,
      projectId: project.id,
      repoId: repoConfig.id,
      importedFromRunId: run?.id || null,
      updatedAt: importedAt,
    });
  }

  const remediation = analysis.safetyRemediation || {};
  const findingIdMap = new Map();
  const patchIdMap = new Map();
  const findings = (remediation.safetyFindings || []).map((finding) => {
    const nextId = `imported-${makeId()}`;
    if (finding?.id) findingIdMap.set(finding.id, nextId);
    return {
      ...finding,
      id: nextId,
      projectId: project.id,
      repoId: repoConfig.id,
      hazardAnalysisRunId: runIdMap.get(finding?.hazardAnalysisRunId) || finding?.hazardAnalysisRunId || null,
      importedFromFindingId: finding?.id || null,
      updatedAt: importedAt,
    };
  });
  const patches = (remediation.patchProposals || []).map((patch) => {
    const nextId = `imported-${makeId()}`;
    if (patch?.id) patchIdMap.set(patch.id, nextId);
    return {
      ...patch,
      id: nextId,
      safetyFindingId: findingIdMap.get(patch?.safetyFindingId) || patch?.safetyFindingId,
      importedFromPatchId: patch?.id || null,
      updatedAt: importedAt,
    };
  });
  const decisions = (remediation.reviewDecisions || []).map((decision) => ({
    ...decision,
    id: `imported-${makeId()}`,
    targetId: findingIdMap.get(decision?.targetId) || patchIdMap.get(decision?.targetId) || decision?.targetId,
    importedFromDecisionId: decision?.id || null,
    updatedAt: importedAt,
  }));
  const verificationRuns = (remediation.verificationRuns || []).map((run) => ({
    ...run,
    id: `imported-${makeId()}`,
    safetyFindingId: findingIdMap.get(run?.safetyFindingId) || run?.safetyFindingId,
    patchProposalId: patchIdMap.get(run?.patchProposalId) || run?.patchProposalId,
    importedFromVerificationRunId: run?.id || null,
    updatedAt: importedAt,
  }));
  const evidence = (remediation.safetyRemediationEvidence || []).map((item) => ({
    ...item,
    id: `imported-${makeId()}`,
    safetyFindingId: findingIdMap.get(item?.safetyFindingId) || item?.safetyFindingId,
    patchProposalId: patchIdMap.get(item?.patchProposalId) || item?.patchProposalId,
    importedFromEvidenceId: item?.id || null,
    updatedAt: importedAt,
  }));
  await Promise.all([
    findings.length ? safetyRemediationStore.upsertFindings(findings) : Promise.resolve(),
    patches.length ? safetyRemediationStore.upsertPatchProposals(patches) : Promise.resolve(),
    decisions.length ? safetyRemediationStore.upsertReviewDecisions(decisions) : Promise.resolve(),
    verificationRuns.length ? safetyRemediationStore.upsertVerificationRuns(verificationRuns) : Promise.resolve(),
    evidence.length ? safetyRemediationStore.upsertSafetyRemediationEvidence(evidence) : Promise.resolve(),
  ]);

  const originalProjectId = repoPackage?.projectId || repoPackage?.project?.id || (analysis.reviewItems || []).find((item) => item?.projectId)?.projectId || "";
  const reviewItems = (analysis.reviewItems || []).map((item) => ({
    ...item,
    id: `imported-${makeId()}`,
    projectId: project.id,
    artifactId: remapImportedCodeArchitectureReviewValue(item?.artifactId, { project, repoConfig, repoPackage, originalProjectId }),
    sourceRunId: remapImportedCodeArchitectureReviewValue(item?.sourceRunId, { project, repoConfig, repoPackage, originalProjectId }),
    importedFromReviewItemId: item?.id || null,
    updatedAt: importedAt,
  }));
  if (reviewItems.length) {
    await resultsReview.createReviewItems(reviewItems);
  }
}

async function collectCodeArchitectureProjectExport(projectId) {
  const project = codeArchitectureProjects.find((entry) => entry.id === projectId);
  if (!project) throw new Error("Select a project to export.");
  const repos = Array.isArray(project.repos) ? project.repos : [];
  const exportedRepos = [];
  for (const repo of repos) {
    const primaryKey = codeArchitectureRowsKey(project.id, repo.id);
    const isCurrentRepo = project.id === activeCodeArchitectureProject?.id && repo.id === activeCodeArchitectureRepo?.id;
    const readResult = isCurrentRepo && Array.isArray(cbaTableData) && cbaTableData.length
      ? { rows: cbaTableData, sourceKey: primaryKey }
      : await readCodeArchitectureRowsForRepo(project, repo, primaryKey);
    let meta = null;
    try { meta = JSON.parse(localStorage.getItem(codeArchitectureMetaKey(project.id, repo.id)) || "null"); } catch {}
    exportedRepos.push({
      projectId: project.id,
      repo: {
        id: repo.id,
        owner: repo.owner || "",
        repo: repo.repo || "",
        repoId: repo.repoId || normalizeRepoIdentity(repo),
        repoName: repo.repoName || repo.repoId || normalizeRepoIdentity(repo),
        repoUrl: repo.repoUrl || "",
        selectedExtensions: repo.selectedExtensions || [],
        analysisContext: repo.analysisContext || { text: "", files: [] },
        operationalContext: repo.operationalContext || "",
        contextSources: repo.contextSources || null,
        branch: repo.branch || "",
        commitSha: repo.commitSha || "",
        filesFound: repo.filesFound || 0,
        imported: !!repo.imported,
        createdAt: repo.createdAt || null,
        updatedAt: repo.updatedAt || null,
        lastAnalyzedAt: repo.lastAnalyzedAt || null,
      },
      rows: ensureCodeArchitectureTraceIds(readResult.rows || []),
      metadata: meta || null,
      analysis: await collectCodeArchitectureRepoAnalysis(project, repo),
      sourceKey: readResult.sourceKey || primaryKey,
    });
  }
  return {
    type: "xhandle-code-architecture-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name || "Code Architecture Project",
      folderId: null,
      createdAt: project.createdAt || null,
      updatedAt: project.updatedAt || null,
      activeRepoName: repos.find((repo) => repo.id === project.activeRepoId)?.repoName || null,
    },
    repos: exportedRepos,
  };
}

async function loadWorkbookXlsx() {
  try {
    return await import(/* webpackChunkName: "xlsx" */ "xlsx");
  } catch {
    throw new Error("XLSX export is unavailable. Install the xlsx package to export workbooks.");
  }
}

function codeArchitectureWorkbookFileName(projectName, scope) {
  const safeName = String(projectName || "code-architecture")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "code-architecture";
  const suffix = scope === "analysis" ? "analysis-workbook" : "project-workbook";
  return `${safeName}-${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

function codeArchitectureSheetName(baseName, usedNames) {
  const cleaned = String(baseName || "Sheet")
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Sheet";
  let name = cleaned.slice(0, 31);
  let index = 2;
  while (usedNames.has(name)) {
    const suffix = ` ${index}`;
    name = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  usedNames.add(name);
  return name;
}

function codeArchitectureCellValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(codeArchitectureCellValue).filter(Boolean).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

const CODE_ARCHITECTURE_PRIMITIVE_TARGET_PREFIXES = ["torch.", "np.", "numpy.", "einops.", "scipy.", "math."];

function normalizeCodeArchitecturePrimitiveCallAction(action = "", to = "") {
  const actionText = String(action || "").trim();
  const toText = String(to || "").trim();
  if (!actionText || !toText) return actionText;
  if (!CODE_ARCHITECTURE_PRIMITIVE_TARGET_PREFIXES.some((prefix) => toText.startsWith(prefix))) return actionText;
  if (!/^call\b/i.test(actionText)) return actionText;
  const quotedCall = /^call\s+`([^`]+)`$/i.exec(actionText);
  const plainCall = /^call\s+([A-Za-z_][A-Za-z0-9_.]*)$/i.exec(actionText);
  const namedTarget = quotedCall?.[1] || plainCall?.[1] || "";
  if (!namedTarget || namedTarget === toText) return actionText;
  return `Call ${toText}`;
}

function rowsForCodeArchitectureColumns(rows = [], columns = []) {
  return rows.map((row) => {
    const out = {};
    columns.forEach((column) => {
      out[column.label] = codeArchitectureCellValue(
        typeof column.getValue === "function" ? column.getValue(row) : row?.[column.key]
      );
    });
    return out;
  });
}

function functionalRowsForWorkbook(rows = []) {
  return rows.map((row, index) => ({
    "Row": row.rowRef || index + 1,
    "Function (From)": row.from || row.fromFunction || "",
    "Function (From) File(s)": row.fromFile || "",
    "Function (From) Details": row.fromDetails || row.fromFunctionDetails || "",
    "Control Action": normalizeCodeArchitecturePrimitiveCallAction(
      row.action || row.controlAction || "",
      row.to || row.toFunction || "",
    ),
    "Control Action Details": row.controlActionDetails || row.controlDetails || "",
    "Function (To)": row.to || row.toFunction || "",
    "Function (To) File(s)": row.toFile || "",
    "Function (To) Details": row.toDetails || row.toFunctionDetails || "",
    "Subsystem": row.architecture?.subsystem || row.subsystem || "",
    "CSCI": row.architecture?.csci || row.csci || "",
    "CSC": row.architecture?.csc || row.csc || "",
    "CSU": row.architecture?.csu || row.csu || "",
    "Architecture Rationale": row.architecture?.rationale || row.architectureRationale || "",
  }));
}

function latestCodeArchitectureHazardRun(hazardRuns = [], fallbackRun = null) {
  const candidates = [...(Array.isArray(hazardRuns) ? hazardRuns : []), fallbackRun].filter(Boolean);
  return candidates.sort((a, b) => (
    (Date.parse(b?.updatedAt || b?.createdAt || 0) || 0) - (Date.parse(a?.updatedAt || a?.createdAt || 0) || 0)
  ))[0] || null;
}

function hazardSummaryRowsForWorkbook(run) {
  const summary = run?.generatedSheets?.Summary;
  if (!Array.isArray(summary) || !summary.length) return [];
  if (Array.isArray(summary[0])) {
    const headers = summary[0].map((header, index) => String(header || `Column ${index + 1}`));
    return summary.slice(1).map((row) => {
      const out = {};
      headers.forEach((header, index) => {
        out[header] = codeArchitectureCellValue(row?.[index]);
      });
      return out;
    });
  }
  return summary.map((row) => ({ ...row }));
}

function remediationRowsForWorkbook(remediation = {}) {
  const findings = Array.isArray(remediation.safetyFindings) ? remediation.safetyFindings : [];
  const patches = Array.isArray(remediation.patchProposals) ? remediation.patchProposals : [];
  const decisions = Array.isArray(remediation.reviewDecisions) ? remediation.reviewDecisions : [];
  const verificationRuns = Array.isArray(remediation.verificationRuns) ? remediation.verificationRuns : [];
  const evidence = Array.isArray(remediation.safetyRemediationEvidence) ? remediation.safetyRemediationEvidence : [];
  return [
    ...findings.map((item) => ({
      Type: "Finding",
      ID: item.id || "",
      Title: item.title || item.summary || "",
      Status: item.status || "",
      Severity: item.severity || "",
      Detail: item.description || item.detail || "",
      LinkedFinding: "",
      Updated: item.updatedAt || item.createdAt || "",
    })),
    ...patches.map((item) => ({
      Type: "Patch Proposal",
      ID: item.id || "",
      Title: item.title || item.summary || "",
      Status: item.status || "",
      Severity: "",
      Detail: item.description || item.rationale || "",
      LinkedFinding: item.safetyFindingId || "",
      Updated: item.updatedAt || item.createdAt || "",
    })),
    ...decisions.map((item) => ({
      Type: "Review Decision",
      ID: item.id || "",
      Title: item.decision || item.status || "",
      Status: item.status || "",
      Severity: "",
      Detail: item.notes || item.comment || "",
      LinkedFinding: item.targetId || "",
      Updated: item.updatedAt || item.createdAt || "",
    })),
    ...verificationRuns.map((item) => ({
      Type: "Verification Run",
      ID: item.id || "",
      Title: item.name || item.result || "",
      Status: item.status || item.result || "",
      Severity: "",
      Detail: item.summary || item.notes || "",
      LinkedFinding: item.safetyFindingId || item.patchProposalId || "",
      Updated: item.updatedAt || item.createdAt || "",
    })),
    ...evidence.map((item) => ({
      Type: "Evidence",
      ID: item.id || "",
      Title: item.title || item.name || "",
      Status: item.status || "",
      Severity: "",
      Detail: item.description || item.notes || "",
      LinkedFinding: item.safetyFindingId || item.patchProposalId || "",
      Updated: item.updatedAt || item.createdAt || "",
    })),
  ];
}

function appendJsonSheet(XLSX, workbook, usedSheetNames, name, rows) {
  const normalizedRows = Array.isArray(rows) && rows.length ? rows : [{ Notice: "No rows available" }];
  const sheet = XLSX.utils.json_to_sheet(normalizedRows);
  XLSX.utils.book_append_sheet(workbook, sheet, codeArchitectureSheetName(name, usedSheetNames));
}

async function collectCodeArchitectureWorkbookRepoData(project, repo) {
  const primaryKey = codeArchitectureRowsKey(project.id, repo.id);
  const isCurrentRepo = project.id === activeCodeArchitectureProject?.id && repo.id === activeCodeArchitectureRepo?.id;
  const readResult = isCurrentRepo && Array.isArray(cbaTableData) && cbaTableData.length
    ? { rows: cbaTableData, sourceKey: primaryKey }
    : await readCodeArchitectureRowsForRepo(project, repo, primaryKey);
  const cbaRows = ensureCodeArchitectureTraceIds(readResult.rows || []);
  const analysis = await collectCodeArchitectureRepoAnalysis(project, repo);
  const artifactRows = analysis.artifactRows || {};
  const artifacts = {
    softwareRows: artifactRows[ARTIFACT_KINDS.SOFTWARE] || [],
    systemRows: artifactRows[ARTIFACT_KINDS.SYSTEM] || [],
    subsystemRows: artifactRows[ARTIFACT_KINDS.SUBSYSTEM] || [],
    designRows: artifactRows[ARTIFACT_KINDS.DESIGN] || [],
  };
  return {
    repo,
    cbaRows,
    artifacts,
    hazardRun: latestCodeArchitectureHazardRun(
      analysis.hazardRuns,
      isCurrentRepo ? codeArchitectureHazardRun : null
    ),
    safetyRemediation: analysis.safetyRemediation || {},
  };
}

async function exportCodeArchitectureWorkbook() {
  if (!activeCodeArchitectureProject?.id) {
    setCodeArchitectureWorkbookExportMsg("Select a Code-Based Architecture project to export.");
    return;
  }
  if (!codeArchitectureWorkbookExportSheets.length) {
    setCodeArchitectureWorkbookExportMsg("Select at least one workbook sheet.");
    return;
  }
  const repos = codeArchitectureWorkbookExportScope === "analysis"
    ? [activeCodeArchitectureRepo].filter(Boolean)
    : (activeCodeArchitectureProject.repos || []);
  if (!repos.length) {
    setCodeArchitectureWorkbookExportMsg("There is no analyzed repository to export.");
    return;
  }

  setIsExportingCodeArchitectureWorkbook(true);
  setCodeArchitectureWorkbookExportMsg("");
  try {
    const XLSX = await loadWorkbookXlsx();
    const workbook = XLSX.utils.book_new();
    const usedSheetNames = new Set();
    appendJsonSheet(XLSX, workbook, usedSheetNames, "Summary", [{
      Project: activeCodeArchitectureProject.name || "",
      Scope: codeArchitectureWorkbookExportScope === "analysis" ? "Current analysis" : "Entire project",
      Repositories: repos.length,
      ExportedAt: new Date().toISOString(),
    }]);

    for (const repo of repos) {
      const repoData = await collectCodeArchitectureWorkbookRepoData(activeCodeArchitectureProject, repo);
      const prefix = String(repo.repoName || repo.repoId || repo.repo || "repo").slice(0, 12);
      if (codeArchitectureWorkbookExportSheets.includes("functional")) {
        appendJsonSheet(XLSX, workbook, usedSheetNames, `${prefix} Architecture`, functionalRowsForWorkbook(repoData.cbaRows));
      }
      if (codeArchitectureWorkbookExportSheets.includes("hazard")) {
        appendJsonSheet(XLSX, workbook, usedSheetNames, `${prefix} Hazards`, hazardSummaryRowsForWorkbook(repoData.hazardRun));
      }
      [
        ARTIFACT_KINDS.SOFTWARE,
        ARTIFACT_KINDS.SYSTEM,
        ARTIFACT_KINDS.SUBSYSTEM,
        ARTIFACT_KINDS.DESIGN,
      ].forEach((kind) => {
        if (!codeArchitectureWorkbookExportSheets.includes(kind)) return;
        const definition = ARTIFACT_DEFINITIONS[kind];
        const artifactRowsByKind = {
          [ARTIFACT_KINDS.SOFTWARE]: repoData.artifacts.softwareRows,
          [ARTIFACT_KINDS.SYSTEM]: repoData.artifacts.systemRows,
          [ARTIFACT_KINDS.SUBSYSTEM]: repoData.artifacts.subsystemRows,
          [ARTIFACT_KINDS.DESIGN]: repoData.artifacts.designRows,
        };
        appendJsonSheet(
          XLSX,
          workbook,
          usedSheetNames,
          `${prefix} ${definition?.idPrefix || kind}`,
          rowsForCodeArchitectureColumns(artifactRowsByKind[kind] || [], definition?.columns || [])
        );
      });
      if (codeArchitectureWorkbookExportSheets.includes("traceability")) {
        appendJsonSheet(
          XLSX,
          workbook,
          usedSheetNames,
          `${prefix} Traceability`,
          rowsForCodeArchitectureColumns(
            buildTraceabilityRows({ cbaRows: repoData.cbaRows, ...repoData.artifacts }),
            TRACEABILITY_MATRIX_COLUMNS
          )
        );
      }
      if (codeArchitectureWorkbookExportSheets.includes("remediation")) {
        appendJsonSheet(XLSX, workbook, usedSheetNames, `${prefix} Remediation`, remediationRowsForWorkbook(repoData.safetyRemediation));
      }
    }

    const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = codeArchitectureWorkbookFileName(activeCodeArchitectureProject.name, codeArchitectureWorkbookExportScope);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setShowCodeArchitectureWorkbookExport(false);
  } catch (error) {
    console.error("[cba] Failed to export code architecture workbook", error);
    setCodeArchitectureWorkbookExportMsg(error?.message || "Failed to export workbook.");
  } finally {
    setIsExportingCodeArchitectureWorkbook(false);
  }
}

async function exportSelectedCodeArchitectureProject() {
  if (!codeArchitectureProjectExportSelection) {
    setCodeArchitectureProjectExportMsg("Select one project to export.");
    return;
  }
  setIsExportingCodeArchitectureProject(true);
  setCodeArchitectureProjectExportMsg("");
  try {
    const payload = await collectCodeArchitectureProjectExport(codeArchitectureProjectExportSelection);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = codeArchitectureExportFileName(payload.project?.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setShowCodeArchitectureProjectExport(false);
  } catch (error) {
    console.error("[cba] Failed to export code architecture project", error);
    setCodeArchitectureProjectExportMsg(error?.message || "Failed to export project.");
  } finally {
    setIsExportingCodeArchitectureProject(false);
  }
}

async function importCodeArchitectureProjectFromFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const now = new Date().toISOString();
    const projectName = String(parsed?.project?.name || parsed?.projectName || file.name.replace(/\.[^.]+$/, "") || "Imported Architecture").trim();
    const project = {
      id: makeId(),
      name: projectName,
      folderId: null,
      repos: [],
      activeRepoId: null,
      createdAt: now,
      updatedAt: now,
    };
    const packageRepos = parsed?.type === "xhandle-code-architecture-project" && Array.isArray(parsed?.repos)
      ? parsed.repos
      : null;
    const importedRepos = [];
    let firstRows = [];
    if (packageRepos) {
      for (const repoPackage of packageRepos) {
        const rows = normalizeImportedCodeArchitectureRows(repoPackage?.rows || repoPackage);
        if (!rows.length) continue;
        const repoConfig = await saveImportedCodeArchitectureRows({ project, file, rows, repoPackage });
        await restoreImportedCodeArchitectureRepoAnalysis({ project, repoConfig, repoPackage });
        importedRepos.push(repoConfig);
        if (!firstRows.length) firstRows = rows;
      }
    } else {
      const rows = normalizeImportedCodeArchitectureRows(parsed);
      if (rows.length) {
        const repoConfig = await saveImportedCodeArchitectureRows({ project, file, rows });
        importedRepos.push(repoConfig);
        firstRows = rows;
      }
    }
    if (!importedRepos.length) {
      alert("No code architecture rows were found in that JSON file.");
      return;
    }
    const importedProject = {
      ...project,
      repos: importedRepos,
      activeRepoId: importedRepos[0].id,
      updatedAt: new Date().toISOString(),
    };
    setCodeArchitectureProjects((prev) => [importedProject, ...prev]);
    setActiveCodeArchitectureProjectId(importedProject.id);
    setActiveCodeArchitectureFolderId(null);
    setCbaTableData(firstRows);
    setSelectedCbaElement(null);
    setCodeArchitectureHazardRun(null);
    setCodeArchitectureWorkspaceTab("architecture");
    setCodeArchitectureFunctionalTableOpenKey(`imported-project-${Date.now()}`);
    setSection("code-architecture");
    setIsSidebarOpen(true);
    setIsCodeArchitectureProjectsOpen(true);
    notifyBackupDataChanged("code-architecture-project-import");
  } catch (error) {
    console.error("[cba] Failed to import code architecture project JSON", error);
    alert(error?.message || "Failed to import code architecture project JSON.");
  }
}

async function handleBaselineRepo({
  owner,
  repo,
  token,
  selectedExtensions,
  analysisContext,
  projectId,
  repoConfig,
} = {}) {
  setSection("code-architecture");
  setCodeArchitectureWorkspaceTab("architecture");
  setCodeArchitectureFunctionalTableOpenKey(null);
  setHighlightedCodeArchitectureFunctionalRowIndex(null);
  setPendingCodeArchitectureDiagramTarget(null);

  const targetProjectId = projectId || activeCodeArchitectureProjectId;
  const targetProject = codeArchitectureProjects.find((entry) => entry.id === targetProjectId) || activeCodeArchitectureProject;
  const sourceRepoConfig = repoConfig || activeCodeArchitectureRepo;
  const finalOwner = (owner || sourceRepoConfig?.owner || localStorage.getItem("repoOwner") || "").trim();
  const finalRepo = (repo || sourceRepoConfig?.repo || localStorage.getItem("repoName") || "").trim();
  const finalToken = (token || sourceRepoConfig?.token || localStorage.getItem("githubToken") || "").trim();

  if (!finalOwner || !finalRepo) {
    throw new Error("Missing owner/repo. Connect a GitHub repository in Code-Based Architecture first.");
  }

  const effectiveSelectedExtensions = selectedExtensions?.length
    ? selectedExtensions
    : sourceRepoConfig?.selectedExtensions?.length
      ? sourceRepoConfig.selectedExtensions
      : getSavedGitHubSelectedExtensions();
  const effectiveRepoConfig = sourceRepoConfig || makeRepoConfig({
    owner: finalOwner,
    repo: finalRepo,
    token: finalToken,
    selectedExtensions: effectiveSelectedExtensions,
    analysisContext,
  });
  const storageKey = targetProject?.id && effectiveRepoConfig?.id
    ? codeArchitectureRowsKey(targetProject.id, effectiveRepoConfig.id)
    : `cba:${finalOwner}/${finalRepo}`;
  const id = `cba-${targetProject?.id || finalOwner}/${effectiveRepoConfig?.id || finalRepo}`;
  const sourceRunId = `code-architecture-functional-${targetProject?.id || "default"}-${effectiveRepoConfig?.id || finalRepo}-${Date.now()}`;
  setCodeArchitectureFunctionalReviewRunId(sourceRunId);
  setCbaLoadingLabel("Analyzing repository...");

  startActivity(id, {
    title: "Generating code-based architecture",
    message: "Preparing repository analysis...",
    step: 0,
    total: 0,
  });

  try {
    const result = await generateFunctionalDecompositionFromGitHub(
      setCbaTableData,
      setCbaLoading,
      null,
      {
        repoConfig: { ...effectiveRepoConfig, owner: finalOwner, repo: finalRepo, token: finalToken },
        projectId: targetProject?.id || "",
        storageKey,
        selectedExtensions: effectiveSelectedExtensions,
        analysisContext: analysisContext || effectiveRepoConfig.analysisContext,
        onProgress: ({ completedFiles = 0, totalFiles = 0, currentFile = "", message = "" } = {}) => {
          updateActivity(id, {
            step: completedFiles,
            total: totalFiles,
            message: message || (currentFile
              ? `Analyzing file ${Math.min(completedFiles + 1, totalFiles)} of ${totalFiles}: ${currentFile}`
              : `Analyzed ${completedFiles} of ${totalFiles} files`),
          });
        },
      }
    );
    const resultRows = Array.isArray(result) ? result : result?.rows;
    const resultMetadata = Array.isArray(result) ? {} : (result?.metadata || {});
    const generatedRowCount = Array.isArray(resultRows) ? resultRows.length : 0;
    const openTableFirstForLargeResult = generatedRowCount > 300;
    let generatedRowsPersisted = generatedRowCount === 0;
    if (targetProject?.id && effectiveRepoConfig?.id) {
      const rows = resultRows;
      const metadata = resultMetadata;
      let rowsPersisted = Boolean(metadata.storageSaved);
      if (Array.isArray(rows) && rows.length > 0 && !rowsPersisted) {
        rowsPersisted = await writeCbaRowsToIndexedDB(storageKey, rows);
      }
      generatedRowsPersisted = rowsPersisted || generatedRowCount === 0;
      const updatedRepo = {
        ...effectiveRepoConfig,
        owner: finalOwner,
        repo: finalRepo,
        token: finalToken,
        repoId: effectiveRepoConfig.repoId || `${finalOwner}/${finalRepo}`,
        repoName: effectiveRepoConfig.repoName || `${finalOwner}/${finalRepo}`,
        repoUrl: effectiveRepoConfig.repoUrl || `https://github.com/${finalOwner}/${finalRepo}`,
        selectedExtensions: effectiveSelectedExtensions,
        analysisContext: analysisContext || effectiveRepoConfig.analysisContext || { text: "", files: [] },
        operationalContext: metadata.operationalContext || effectiveRepoConfig.operationalContext || "",
        contextSources: metadata.contextSources || effectiveRepoConfig.contextSources || null,
        branch: metadata.branch || metadata.ref || effectiveRepoConfig.branch || "",
        commitSha: metadata.commitSha || effectiveRepoConfig.commitSha || "",
        filesFound: metadata.filesFound || effectiveRepoConfig.filesFound || 0,
        lastAnalyzedAt: new Date().toISOString(),
      };
      upsertCodeArchitectureRepo(targetProject.id, updatedRepo);
      try {
        localStorage.setItem(codeArchitectureMetaKey(targetProject.id, effectiveRepoConfig.id), JSON.stringify({
          repoId: updatedRepo.repoId,
          repoName: updatedRepo.repoName,
          rowCount: rowsPersisted && Array.isArray(rows) ? rows.length : 0,
          storage: rowsPersisted ? "indexedDB" : "unavailable",
          storageError: rowsPersisted ? "" : (metadata.storageError || "Generated rows could not be saved to browser storage."),
          metrics: metadata.metrics || null,
          grounding: normalizeCodeArchitectureGroundingStats(metadata.grounding),
          operationalContext: updatedRepo.operationalContext,
          contextSources: updatedRepo.contextSources,
          indexedDB: { database: XHANDLE_IDB_NAME, store: XHANDLE_IDB_CBA_STORE, key: storageKey },
          updatedAt: new Date().toISOString(),
        }));
      } catch {}
      if (Array.isArray(rows) && rows.length > 0) {
        try {
          const reviewRows = rows.map((row) => ({
            from: row.from || "",
            fromFile: row.fromFile || "",
            fromDetails: row.fromDetails || "",
            action: row.action || "",
            controlActionDetails: row.controlActionDetails || "",
            to: row.to || "",
            toFile: row.toFile || "",
            toDetails: row.toDetails || "",
            subsystem: row.architecture?.subsystem || "Application Subsystem",
            csci: row.architecture?.csci || "",
            csc: row.architecture?.csc || "",
            csu: row.architecture?.csu || "",
            architectureRationale: row.architecture?.rationale || "",
          }));
          await resultsReview.createReviewItems(createReviewItemsFromGeneratedTable({
            sourceFeature: "Code-Based Architecture Functional Decomposition",
            sourceMethod: "GitHub repository analysis",
            sourceRunId,
            artifactType: CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE,
            artifactId: `code-architecture-functional-decomposition:${targetProject.id}:${effectiveRepoConfig.id}`,
            projectId: targetProject.id,
            rows: reviewRows,
            columns: [
              "from",
              "fromFile",
              "fromDetails",
              "action",
              "controlActionDetails",
              "to",
              "toFile",
              "toDetails",
              "subsystem",
              "csci",
              "csc",
              "csu",
              "architectureRationale",
            ],
          }));
        } catch (error) {
          console.warn("[results-review] Failed to register code architecture functional decomposition review items", error);
        }
      }
    }

    const failedFileCount = Number(resultMetadata.failedFileCount || 0);
    const skippedForScaleCount = Number(resultMetadata.skippedForScale || 0);
    const rowCount = generatedRowCount;
    const metricsSummary = codeArchitectureMetricsSummary(resultMetadata.metrics);
    const metricsSuffix = metricsSummary ? ` (${metricsSummary})` : "";
    if (failedFileCount > 0 && rowCount === 0) {
      finishActivity(id, "error", `AI service was unavailable for ${failedFileCount} file${failedFileCount === 1 ? "" : "s"}; run analysis again to retry.`);
    } else if (failedFileCount > 0) {
      finishActivity(id, "success", `Architecture ready with ${failedFileCount} file${failedFileCount === 1 ? "" : "s"} skipped; rerun to retry.${metricsSuffix}`);
    } else if (!generatedRowsPersisted && rowCount > 0) {
      finishActivity(id, "success", `Architecture ready for this session, but browser storage did not save ${rowCount} rows. Export or rerun after freeing storage.${metricsSuffix}`);
    } else if (skippedForScaleCount > 0 && openTableFirstForLargeResult) {
      finishActivity(id, "success", `Architecture ready from ${resultMetadata.selectedFiles || 0} files; ${skippedForScaleCount} skipped by size limits. Opened table view for ${rowCount} rows.${metricsSuffix}`);
    } else if (skippedForScaleCount > 0) {
      finishActivity(id, "success", `Architecture ready from ${resultMetadata.selectedFiles || 0} files; ${skippedForScaleCount} skipped by size limits.${metricsSuffix}`);
    } else if (openTableFirstForLargeResult) {
      finishActivity(id, "success", `Architecture ready; opened table view for ${rowCount} rows.${metricsSuffix}`);
    } else {
      finishActivity(id, "success", `Architecture ready${metricsSuffix}`);
    }
    setSection("code-architecture");
    setCodeArchitectureWorkspaceTab("architecture");
    setCodeArchitectureFunctionalTableOpenKey(openTableFirstForLargeResult ? `generated-${Date.now()}` : null);
    setHighlightedCodeArchitectureFunctionalRowIndex(null);
    setPendingCodeArchitectureDiagramTarget(null);
  } catch (e) {
    finishActivity(id, "error", String(e?.message || e));
    throw e;
  } finally {
    setCbaLoading(false);
  }
}


const [cbaLoading, setCbaLoading] = useState(false);
const [cbaLoadingLabel, setCbaLoadingLabel] = useState("Loading saved analysis...");

useEffect(() => {
  if (!activeCodeArchitectureProject || !activeCodeArchitectureRepo || !activeCodeArchitectureRowsKey) {
    setCbaLoading(false);
    return;
  }
  if (!Array.isArray(cbaTableData) || cbaTableData.length === 0) return;

  const metaKey = codeArchitectureMetaKey(activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id);
  let cancelled = false;
  writeCbaRowsToIndexedDB(activeCodeArchitectureRowsKey, cbaTableData)
    .then((rowsPersisted) => {
      if (cancelled) return;
      try {
        localStorage.setItem(metaKey, JSON.stringify({
          repoId: activeCodeArchitectureRepo.repoId || normalizeRepoIdentity(activeCodeArchitectureRepo),
          repoName: activeCodeArchitectureRepo.repoName || normalizeRepoIdentity(activeCodeArchitectureRepo),
          rowCount: rowsPersisted ? cbaTableData.length : 0,
          storage: rowsPersisted ? "indexedDB" : "unavailable",
          storageError: rowsPersisted ? "" : "Code architecture rows could not be saved to browser storage.",
          metrics: activeCodeArchitectureStoredMeta?.metrics || null,
          grounding: normalizeCodeArchitectureGroundingStats(activeCodeArchitectureStoredMeta?.grounding),
          operationalContext: activeCodeArchitectureStoredMeta?.operationalContext || activeCodeArchitectureRepo.operationalContext || "",
          contextSources: activeCodeArchitectureStoredMeta?.contextSources || activeCodeArchitectureRepo.contextSources || null,
          indexedDB: {
            database: XHANDLE_IDB_NAME,
            store: XHANDLE_IDB_CBA_STORE,
            key: activeCodeArchitectureRowsKey,
          },
          updatedAt: new Date().toISOString(),
        }));
      } catch (error) {
        console.warn("[cba] Unable to save code architecture metadata to localStorage; full rows remain in IndexedDB.", error);
      }
    });
  return () => {
    cancelled = true;
  };
}, [activeCodeArchitectureProject, activeCodeArchitectureRepo, activeCodeArchitectureRowsKey, activeCodeArchitectureStoredMeta?.grounding, activeCodeArchitectureStoredMeta?.metrics, activeCodeArchitectureStoredMeta?.operationalContext, activeCodeArchitectureStoredMeta?.contextSources, cbaTableData]);

useEffect(() => {
  if (!cbaTableData?.length) {
    setSelectedCbaElement(null);
    return;
  }
  setSelectedCbaElement((current) => current || architectureElementFromRow(cbaTableData[0], 0));
}, [cbaTableData]);

const [lastNonCopilotSection, setLastNonCopilotSection] = useState(
  () => localStorage.getItem('xhandle.lastNonCopilotSection') || DEFAULT_START_SECTION
);

    const refreshGate = async () => {
      const data = await fetchUserAIProviderSettings().catch(() => ({ provider: 'local', last4: null }));
      setGate({
        phase: 'ok',
        user: { id: 'local-user' },
        provider: data?.provider || 'local',
        last4: data?.last4 || null,
        error: null,
      });
    };

    useEffect(() => { refreshGate(); }, []);

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
    setSection(lastNonCopilotSection || DEFAULT_START_SECTION);
  }
}, [dockOpen, section, lastNonCopilotSection]);

// Initialize IDB stores early so “object store not found” can’t occur later
useEffect(() => {
  ensureTraceabilityDB().catch(() => {});
}, []);

useEffect(() => {
  initializeLocalBackupRuntime().catch(() => {});
}, []);


    const signOut = async () => {
      await refreshGate();
    };

    const saveUserAIProvider = async () => {
      const provider = normalizeAIProvider(aiProviderInput);
      const validationError = validateProviderApiKey(provider, providerKeyInput);
      if (validationError) return alert(validationError);

      setSavingKey(true);
      try {
        await saveUserAIProviderSettings(provider, providerKeyInput);
        setProviderKeyInput('');
        await refreshGate();
      } catch (e) {
        alert(e.message || String(e));
      } finally {
        setSavingKey(false);
      }
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
    try { return repairDuplicateProjectIds(JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]')); }
    catch { return []; }
  });
  const [projectFolders, setProjectFolders] = useState(() => {
    try { return normalizeProjectFolders(JSON.parse(localStorage.getItem(PROJECT_FOLDERS_KEY) || '[]')); }
    catch { return []; }
  });
  const [folderDashboards, setFolderDashboards] = useState(() => {
    try { return normalizeFolderDashboardMap(JSON.parse(localStorage.getItem(PROJECT_FOLDER_DASHBOARDS_KEY) || '{}')); }
    catch { return {}; }
  });
  const [activeProjectId, setActiveProjectId] = useState(null);
  const activeProjectIdRef = useRef(activeProjectId);
  const [activeProjectFolderId, setActiveProjectFolderId] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewProjectFolder, setShowNewProjectFolder] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectFolderName, setNewProjectFolderName] = useState('');
  const [newProjectFolderParentId, setNewProjectFolderParentId] = useState(null);
  const [newProjectTargetFolderId, setNewProjectTargetFolderId] = useState(null);
  const [newFolderDashboardPanelType, setNewFolderDashboardPanelType] = useState("overview");
  const [newProjectError, setNewProjectError] = useState('');
  const [newProjectFolderError, setNewProjectFolderError] = useState('');
  const [draggingProjectId, setDraggingProjectId] = useState(null);
  const [dragOverProjectFolderId, setDragOverProjectFolderId] = useState(null);

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
}, [projects, activeProjectId]);

  const [projectLoaded, setProjectLoaded] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState(null);

  // Rename state
const [editingProjectId, setEditingProjectId] = useState(null);
const [editingProjectName, setEditingProjectName] = useState('');
const [editingProjectFolderId, setEditingProjectFolderId] = useState(null);
const [editingProjectFolderName, setEditingProjectFolderName] = useState('');
const [renameError, setRenameError] = useState('');
// Three-dots menu state
const [openProjectMenuId, setOpenProjectMenuId] = useState(null);
const [openProjectFolderMenuId, setOpenProjectFolderMenuId] = useState(null);
const [showProjectExport, setShowProjectExport] = useState(false);
const [projectExportSelection, setProjectExportSelection] = useState("");
const [isExportingProject, setIsExportingProject] = useState(false);
const [projectExportMsg, setProjectExportMsg] = useState("");
const projectMenuPortalRefs = useRef({}); // portal root (for outside-click)
const projectMenuAnchorEls = useRef({});  // the trigger button element
const projectFolderMenuPortalRefs = useRef({});
const projectFolderMenuAnchorEls = useRef({});
const projectImportInputRef = useRef(null);
const riskDiagramContainerRef = useRef(null);
const [inviteForProjectId, setInviteForProjectId] = useState(null);

// --- Project cap from entitlements (fallbacks for safety) ---
function guardNewProjectIntent() {
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
}, [projects, activeProjectId, riskRegister]);

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
}, [projects, activeProjectId, riskRegister]);

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

const buildRequirementsFromSummary = (summary) => {
  if (!summary || !Array.isArray(summary) || summary.length < 2) return [];
  const headers = summary[0].map(h => String(h || ''));
  const rows = summary.slice(1);

  const reqCols = headers
    .map((h, i) => (/requirement|system requirement|derived requirement|safety requirement|safety requirements\/constraints|constraint|mitigation/i.test(h) ? i : -1))
    .filter(i => i >= 0);

  const sevIdx = headers.findIndex(h => /severity/i.test(h));
  const likIdx = headers.findIndex(h => /likelihood|probability/i.test(h));
  const safetySignificanceIdx = headers.findIndex(h => /^safety\s+significant$/i.test(h.trim()));
  const safetyRationaleIdx = headers.findIndex(h => /^safety\s+significance\s+rationale$/i.test(h.trim()));
  const hasSafetySignificanceTags = safetySignificanceIdx >= 0
    && rows.some((row) => String(row?.[safetySignificanceIdx] || "").trim());

  const out = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    if (hasSafetySignificanceTags) {
      const tag = String(row?.[safetySignificanceIdx] || "").trim().toLowerCase();
      if (tag !== "yes") continue;
    }
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
    if (hasSafetySignificanceTags) {
      attrs['Safety Significant'] = String(row?.[safetySignificanceIdx] || "").trim();
      if (safetyRationaleIdx >= 0 && row?.[safetyRationaleIdx]) {
        attrs['Safety Significance Rationale'] = String(row[safetyRationaleIdx]);
      }
    }

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
    headers.findIndex(h => /\brisk\b|\bfailure mode\b|\buca\b|\bunsafe control action(s)?\b|\bwhat[-\s]?if\b|\bscenario\b/i.test(h)) !== -1
      ? headers.findIndex(h => /\brisk\b|\bfailure mode\b|\buca\b|\bunsafe control action(s)?\b|\bwhat[-\s]?if\b|\bscenario\b/i.test(h))
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

function clampRiskScore(value, fallback = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(5, Math.max(1, Math.round(numeric)));
}

function normalizeRiskStatus(value) {
  const text = String(value || "").trim();
  return ['Open','In Progress','Mitigated','Accepted','Closed'].includes(text) ? text : 'Open';
}

function normalizeRiskAssessmentRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const title = String(row?.title || row?.hazard || row?.risk || row?.name || "").trim();
      const description = String(row?.description || row?.unsafeControlAction || row?.uca || row?.rationale || row?.summary || "").trim();
      if (!title && !description) return null;
      const tags = Array.isArray(row?.tags)
        ? row.tags.map((tag) => String(tag || "").trim()).filter(Boolean).join(", ")
        : String(row?.tags || "").trim();
      const sourceIndexes = Array.isArray(row?.sourceIndexes)
        ? row.sourceIndexes.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
        : [];
      const sourceIndex = Number(row?.sourceIndex);
      return {
        id: row?.id || makeId(),
        title: title || `Risk ${index + 1}`,
        description: description || title,
        likelihood: clampRiskScore(row?.likelihood, 3),
        severity: clampRiskScore(row?.severity, 3),
        status: normalizeRiskStatus(row?.status),
        owner: String(row?.owner || "").trim(),
        dueDate: String(row?.dueDate || "").trim(),
        tags,
        sourceIndex: sourceIndexes[0] || (Number.isFinite(sourceIndex) && sourceIndex > 0 ? sourceIndex : null),
        sourceIndexes,
      };
    })
    .filter(Boolean);
}

function applyStableRiskIds(existingRows = [], consolidatedRows = []) {
  const usedExistingIds = new Set();
  const existingBySourceIndex = new Map();
  (existingRows || []).forEach((row) => {
    getRiskSourceIndexes(row).forEach((sourceIndex) => {
      if (!existingBySourceIndex.has(sourceIndex)) existingBySourceIndex.set(sourceIndex, []);
      existingBySourceIndex.get(sourceIndex).push(row);
    });
  });

  return (consolidatedRows || []).map((row) => {
    const sourceIndexes = getRiskSourceIndexes(row);
    let bestMatch = null;
    let bestOverlap = 0;
    sourceIndexes.forEach((sourceIndex) => {
      (existingBySourceIndex.get(sourceIndex) || []).forEach((candidate) => {
        if (!candidate?.id || usedExistingIds.has(candidate.id)) return;
        const overlap = getRiskSourceIndexes(candidate).filter((index) => sourceIndexes.includes(index)).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestMatch = candidate;
        }
      });
    });
    const nextId = bestMatch?.id || row.id || makeId();
    usedExistingIds.add(nextId);
    return { ...row, id: nextId };
  });
}

function getRiskPriority(score) {
  const numeric = Number(score) || 0;
  if (numeric >= 20) return "P0";
  if (numeric >= 15) return "P1";
  if (numeric >= 9) return "P2";
  return "P3+";
}

function getRiskScore(row) {
  return (Number(row?.likelihood) || 0) * (Number(row?.severity) || 0);
}

function getRiskSourceIndexes(row) {
  const indexes = Array.isArray(row?.sourceIndexes) ? row.sourceIndexes : [];
  const sourceIndex = Number(row?.sourceIndex);
  return Array.from(new Set([
    ...indexes.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0),
    ...(Number.isFinite(sourceIndex) && sourceIndex > 0 ? [sourceIndex] : []),
  ])).sort((a, b) => a - b);
}

function downloadMarkdownFile(filename, markdown) {
  const blob = new Blob([markdown || ""], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getSafetyIssueReportBounds(markdown, issueId) {
  const id = String(issueId || "").trim();
  if (!id) return null;
  const source = String(markdown || "");
  const startMarker = `<!-- SAFETY_ISSUE_REPORT_START id="${id}" -->`;
  const endMarker = `<!-- SAFETY_ISSUE_REPORT_END id="${id}" -->`;
  const start = source.indexOf(startMarker);
  if (start < 0) return null;
  const contentStart = start + startMarker.length;
  const end = source.indexOf(endMarker, contentStart);
  if (end < 0) return null;
  return { start, contentStart, end, endWithMarker: end + endMarker.length, startMarker, endMarker };
}

function extractSafetyIssueReportMarkdown(markdown, issue) {
  const source = String(markdown || "").trim();
  if (!source || !issue?.id) return source;
  const bounds = getSafetyIssueReportBounds(source, issue.id);
  if (bounds) return source.slice(bounds.contentStart, bounds.end).trim();
  const title = String(issue.title || "").trim();
  if (!title) return source;
  const headingPattern = new RegExp(
    `(^#{2,4}\\s+.*${escapeRegExp(title)}.*(?:\\n|$))([\\s\\S]*?)(?=^#{2,4}\\s+|$)`,
    "im"
  );
  return source.match(headingPattern)?.[0]?.trim() || source;
}

function replaceSafetyIssueReportMarkdown(markdown, issueId, nextIssueMarkdown) {
  const source = String(markdown || "");
  const next = String(nextIssueMarkdown || "").trim();
  const bounds = getSafetyIssueReportBounds(source, issueId);
  if (!bounds) return next;
  return [
    source.slice(0, bounds.contentStart),
    `\n${next}\n`,
    source.slice(bounds.end),
  ].join("");
}

  // Collapsible state for sidebar projects
  const [isProjectsOpen, setIsProjectsOpen] = useState(() => {
    const saved = localStorage.getItem(PROJECTS_OPEN_KEY);
    return saved ? saved === 'true' : true;
  });
  const [openProjectFolderIds, setOpenProjectFolderIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROJECT_FOLDERS_OPEN_KEY) || '{}'); }
    catch { return {}; }
  });

  useEffect(() => {
    function handleOutside(e) {
      if (!openProjectMenuId && !openProjectFolderMenuId) return;

      // Ignore clicks on the trigger button
      if (e.target.closest('[data-project-menu-trigger="true"]')) return;
      if (e.target.closest('[data-project-folder-menu-trigger="true"]')) return;

      const menuEl = openProjectMenuId ? projectMenuPortalRefs.current[openProjectMenuId] : null;
      if (openProjectMenuId && menuEl && !menuEl.contains(e.target)) {
        setOpenProjectMenuId(null);
      }
      const folderMenuEl = openProjectFolderMenuId ? projectFolderMenuPortalRefs.current[openProjectFolderMenuId] : null;
      if (openProjectFolderMenuId && folderMenuEl && !folderMenuEl.contains(e.target)) {
        setOpenProjectFolderMenuId(null);
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') {
        setOpenProjectMenuId(null);
        setOpenProjectFolderMenuId(null);
      }
    }

    document.addEventListener('click', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('click', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [openProjectMenuId, openProjectFolderMenuId]);

  useEffect(() => {
    function handleOutside(e) {
      if (!openCodeArchitectureProjectMenuId && !openCodeArchitectureFolderMenuId) return;
      if (e.target.closest('[data-cba-project-menu-trigger="true"]')) return;
      if (e.target.closest('[data-cba-folder-menu-trigger="true"]')) return;
      const projectMenuEl = openCodeArchitectureProjectMenuId ? codeArchitectureProjectMenuPortalRefs.current[openCodeArchitectureProjectMenuId] : null;
      if (openCodeArchitectureProjectMenuId && projectMenuEl && !projectMenuEl.contains(e.target)) {
        setOpenCodeArchitectureProjectMenuId(null);
      }
      const folderMenuEl = openCodeArchitectureFolderMenuId ? codeArchitectureFolderMenuPortalRefs.current[openCodeArchitectureFolderMenuId] : null;
      if (openCodeArchitectureFolderMenuId && folderMenuEl && !folderMenuEl.contains(e.target)) {
        setOpenCodeArchitectureFolderMenuId(null);
      }
    }
    function handleEsc(e) {
      if (e.key === "Escape") {
        setOpenCodeArchitectureProjectMenuId(null);
        setOpenCodeArchitectureFolderMenuId(null);
      }
    }
    document.addEventListener("click", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("click", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [openCodeArchitectureProjectMenuId, openCodeArchitectureFolderMenuId]);

  useEffect(() => {
    const onProjectsUpdated = () => {
      try {
        const list = JSON.parse(localStorage.getItem("xhandle.projects") || "[]");
        setProjects(list);
        const folders = JSON.parse(localStorage.getItem(PROJECT_FOLDERS_KEY) || "[]");
        setProjectFolders(normalizeProjectFolders(folders));
        const dashboards = JSON.parse(localStorage.getItem(PROJECT_FOLDER_DASHBOARDS_KEY) || "{}");
        setFolderDashboards(normalizeFolderDashboardMap(dashboards));
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
  useEffect(() => { localStorage.setItem(PROJECT_FOLDERS_KEY, JSON.stringify(projectFolders)); }, [projectFolders]);
  useEffect(() => { localStorage.setItem(PROJECT_FOLDER_DASHBOARDS_KEY, JSON.stringify(folderDashboards)); }, [folderDashboards]);
  useEffect(() => {
    if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_ID_KEY, activeProjectId);
    else localStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
  }, [activeProjectId]);
  useEffect(() => { localStorage.setItem(PROJECTS_OPEN_KEY, String(isProjectsOpen)); }, [isProjectsOpen]);
  useEffect(() => { localStorage.setItem(PROJECT_FOLDERS_OPEN_KEY, JSON.stringify(openProjectFolderIds)); }, [openProjectFolderIds]);

  const createProject = () => {
    const name = newProjectName.trim();
    if (!name) { setNewProjectError('Please enter a project name.'); return; }
    if (projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      setNewProjectError('A project with this name already exists.');
      return;
    }
    const id = makeId();
    const proj = { id, name, folderId: newProjectTargetFolderId || null, createdAt: new Date().toISOString() };
    setProjects(prev => [proj, ...prev]);
    // NEW: initialize agentReportResult
    saveProjectPatch(id, {
      responseRows: [],
      diagramCategories: null,
      analysisResult: null,
      riskMethod: 'STPA',
      agentReportResult: null,
      riskAssessmentReportMarkdown: "",
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
    setActiveProjectFolderId(null);
    setNewProjectName('');
    setNewProjectTargetFolderId(null);
    setNewProjectError('');
    setShowNewProject(false);
    setSection('projects');

  };

  async function collectProjectExport(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error("Select a project to export.");
    return {
      type: "xhandle-project",
      version: 1,
      exportedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name || "Project",
        folderId: null,
        createdAt: project.createdAt || null,
        updatedAt: project.updatedAt || null,
      },
      data: loadProjectData(project.id) || {},
      localStorageEntries: collectProjectLocalStorageEntries(project.id),
      reviewItems: (resultsReview.reviewItems || []).filter((item) => item.projectId === project.id),
    };
  }

  async function exportSelectedProject() {
    if (!projectExportSelection) {
      setProjectExportMsg("Select one project to export.");
      return;
    }
    setIsExportingProject(true);
    setProjectExportMsg("");
    try {
      const payload = await collectProjectExport(projectExportSelection);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = projectExportFileName(payload.project?.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setShowProjectExport(false);
    } catch (error) {
      console.error("[projects] Failed to export project", error);
      setProjectExportMsg(error?.message || "Failed to export project.");
    } finally {
      setIsExportingProject(false);
    }
  }

  async function importProjectFromFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const now = new Date().toISOString();
      const originalProject = parsed?.type === "xhandle-project" ? parsed.project : parsed?.project;
      const originalProjectId = originalProject?.id || parsed?.projectId || null;
      const projectData = parsed?.type === "xhandle-project"
        ? (parsed.data || {})
        : (parsed?.data || parsed?.projectData || parsed);
      const baseName = String(
        originalProject?.name ||
        parsed?.projectName ||
        projectData?.name ||
        file.name.replace(/\.[^.]+$/, "") ||
        "Imported Project"
      ).trim();
      const importedProject = {
        id: makeId(),
        name: baseName || "Imported Project",
        folderId: null,
        createdAt: now,
        updatedAt: now,
        importedFromProjectId: originalProjectId,
        importedAt: now,
      };
      const data = projectData && typeof projectData === "object" && !Array.isArray(projectData)
        ? { ...projectData, _importedAt: now, _updatedAt: now }
        : { importedPayload: projectData, _importedAt: now, _updatedAt: now };
      const map = readProjectMap();
      map[importedProject.id] = data;
      writeProjectMap(map);

      const localStorageEntries = Array.isArray(parsed?.localStorageEntries)
        ? parsed.localStorageEntries
        : Array.isArray(parsed?.localStorage)
          ? parsed.localStorage
          : [];
      localStorageEntries.forEach((entry) => {
        const sourceKey = typeof entry === "string" ? entry : entry?.key;
        if (!sourceKey) return;
        const value = typeof entry === "string" ? "" : String(entry?.value ?? "");
        const targetKey = remapProjectScopedLocalStorageKey(sourceKey, originalProjectId, importedProject.id);
        if (targetKey && isProjectScopedLocalStorageKey(targetKey, importedProject.id)) {
          localStorage.setItem(targetKey, value);
        }
      });

      const reviewItems = (Array.isArray(parsed?.reviewItems) ? parsed.reviewItems : []).map((item) => ({
        ...item,
        id: `imported-${makeId()}`,
        projectId: importedProject.id,
        importedFromReviewItemId: item?.id || null,
        updatedAt: now,
      }));
      if (reviewItems.length) await resultsReview.createReviewItems(reviewItems);

      setProjects((prev) => [importedProject, ...prev]);
      setActiveProjectId(importedProject.id);
      setActiveProjectFolderId(null);
      setSection("projects");
      setIsSidebarOpen(true);
      setIsProjectsOpen(true);
      notifyBackupDataChanged("project-import");
    } catch (error) {
      console.error("[projects] Failed to import project JSON", error);
      alert(error?.message || "Failed to import project JSON.");
    }
  }

  const createProjectFolder = () => {
    const name = newProjectFolderName.trim();
    if (!name) { setNewProjectFolderError('Please enter a folder name.'); return; }
    if (projectFolders.some((folder) => folder.parentId === (newProjectFolderParentId || null) && folder.name.toLowerCase() === name.toLowerCase())) {
      setNewProjectFolderError('A folder with this name already exists here.');
      return;
    }

    const id = makeId();
    const folder = {
      id,
      name,
      parentId: newProjectFolderParentId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProjectFolders((prev) => [folder, ...prev]);
    setFolderDashboards((prev) => ({ ...prev, [id]: getDefaultFolderDashboardPanels() }));
    if (newProjectFolderParentId) {
      setOpenProjectFolderIds((prev) => ({ ...prev, [newProjectFolderParentId]: true, [id]: true }));
    } else {
      setOpenProjectFolderIds((prev) => ({ ...prev, [id]: true }));
    }
    setNewProjectFolderName('');
    setNewProjectFolderParentId(null);
    setNewProjectFolderError('');
    setShowNewProjectFolder(false);
    setActiveProjectId(null);
    setActiveProjectFolderId(id);
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
      setActiveProjectFolderId(null);
      if (!nextId) {
        setResponseRows([]);
        setAnalysisResult(null);
        setRiskMethod('STPA');
        setAgentReportResult(null); // NEW: clear report in UI state
        setRequirements([]);
        setShowPromptWizard(true);
      }
    }
    removeProjectData(projectId);
    resultsReview.deleteReviewItemsForProject(projectId).catch((error) => {
      console.warn("[results-review] Failed to remove review items for deleted project", error);
    });
  };

  // Legacy Collaborator fallback only. Native LLM grounding is built from
  // src/features/workspace-graph inside XHandleCopilotView before each request.
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

    let sysmlModelsLS = [];
    try {
      const parsed = JSON.parse(ls.getItem("xhandle.designManagement.sysmlV2.models") || "[]");
      sysmlModelsLS = Array.isArray(parsed) ? parsed : [];
    } catch {}

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

    // 5) Code-based architecture (CBA): scoped project/repo summaries plus legacy fallback
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
    const codeArchitectureProjectSummaries = (codeArchitectureProjects || []).map((project) => {
      const folder = project.folderId ? codeArchitectureFolders.find((entry) => entry.id === project.folderId) : null;
      const repos = Array.isArray(project.repos) ? project.repos : [];
      return {
        id: project.id,
        name: project.name,
        folder: folder ? { id: folder.id, name: folder.name } : null,
        activeRepoId: project.activeRepoId || null,
        repos: repos.map((repoConfig) => {
          let meta = null;
          try { meta = JSON.parse(ls.getItem(codeArchitectureMetaKey(project.id, repoConfig.id)) || "null"); } catch {}
          const isActive = project.id === activeCodeArchitectureProjectId && repoConfig.id === activeCodeArchitectureRepo?.id;
          return {
            id: repoConfig.id,
            repoId: repoConfig.repoId,
            repoName: repoConfig.repoName,
            repoUrl: repoConfig.repoUrl,
            branch: repoConfig.branch || "",
            commitSha: repoConfig.commitSha || "",
            active: Boolean(isActive),
            rowCount: meta?.rowCount || (isActive && Array.isArray(cbaTableData) ? cbaTableData.length : 0),
            rowSample: isActive && Array.isArray(cbaTableData) ? cbaTableData.slice(0, 8) : [],
            updatedAt: meta?.updatedAt || repoConfig.updatedAt || null,
          };
        }),
      };
    });

    // 6) A few convenience hints (what you already had, preserved)
    const owner = ls.getItem("repoOwner") || undefined;
    const repo  = ls.getItem("repoName") || undefined;

    const compactRows = (rows, limit = 40) => (Array.isArray(rows) ? rows.slice(0, limit) : []);
    const summarizeProject = (project) => {
      const data = projectDataLS?.[project.id] || map?.[project.id] || {};
      return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt || null,
        counts: {
          requirements: Array.isArray(data.requirements) ? data.requirements.length : 0,
          functionalDecomposition: Array.isArray(data.responseRows) ? data.responseRows.length : 0,
          riskRegister: Array.isArray(data.riskRegister) ? data.riskRegister.length : 0,
          riskSummaryRows: Array.isArray(data.analysisResult?.Summary) ? Math.max(data.analysisResult.Summary.length - 1, 0) : 0,
          tests: Array.isArray(data.vnvArtifacts?.tests || data.vnvArtifacts?.testCases)
            ? (data.vnvArtifacts?.tests || data.vnvArtifacts?.testCases).length
            : 0,
        },
        samples: {
          requirements: compactRows(data.requirements, 8),
          functionalDecomposition: compactRows(data.responseRows, 8),
          riskRegister: compactRows(data.riskRegister, 8),
          riskSummarySheet: compactRows(data.analysisResult?.Summary, 8),
          tests: compactRows(data.vnvArtifacts?.tests || data.vnvArtifacts?.testCases, 8),
        },
      };
    };

    const workspaceProjects = projects.map(summarizeProject);
    const workspaceSysMLModels = sysmlModelsLS.map((model) => ({
      id: model.id,
      projectId: model.projectId || null,
      name: model.name,
      description: model.description || "",
      activeView: model.activeView || null,
      elementCount: Array.isArray(model.elements) ? model.elements.length : 0,
      relationshipCount: Array.isArray(model.relationships) ? model.relationships.length : 0,
      elements: compactRows(model.elements, 25).map((element) => ({
        id: element.id,
        type: element.type,
        name: element.name,
        description: element.description,
        ownerId: element.ownerId,
        traceLinks: compactRows(element.traceLinks, 5),
      })),
      relationships: compactRows(model.relationships, 25).map((relationship) => ({
        id: relationship.id,
        type: relationship.type,
        sourceId: relationship.sourceId,
        targetId: relationship.targetId,
        label: relationship.label,
      })),
    }));
    const designProvider = getActionProvider("requirements");
    const designManagementState = designProvider?.getState?.() || null;

    // ---- Compose a single context (prefer live state → persisted → LS blobs) ----
    const ctx = {
      // meta / hinting. xCopilot reasons across local workspace data by default.
      scope: "workspace",
      project: proj ? { id: proj.id, name: proj.name, createdAt: proj.createdAt } : null,
      focus: {
        project: proj ? { id: proj.id, name: proj.name, createdAt: proj.createdAt } : null,
        section,
        activeTab,
        screen: {
          feature: section,
          view: activeTab || null,
          designManagement: designManagementState,
        },
      },
      projectHint, // you already memoize owner/repo/baselineKey elsewhere

      workspace: {
        projects: workspaceProjects,
        projectCount: projects.length,
        codeArchitecture: {
          projects: codeArchitectureProjectSummaries,
          projectCount: codeArchitectureProjects.length,
          folderCount: codeArchitectureFolders.length,
          activeProjectId: activeCodeArchitectureProjectId || null,
          activeRepoId: activeCodeArchitectureRepo?.id || null,
          legacyRows: codeArchitecture.slice(0, 40),
        },
        activeProjectId: activeProjectId || null,
        requirements: compactRows(reqsLS, 80),
        sysmlModels: workspaceSysMLModels,
        legacyCodeArchitectureRows: compactRows(codeArchitecture, 120),
        liteSummaries,
        diagramSnapshots,
      },

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
        workspaceProjectCount: projects.length,
        sysmlModelCount: workspaceSysMLModels.length,
      },
    };

    return ctx;
  }

  function getCollaboratorAppFocus() {
    return {
      section,
      activeTab,
      activeProjectId: activeProjectId || null,
      activeCodeArchitectureProjectId: activeCodeArchitectureProjectId || null,
      activeCodeArchitectureRepoId: activeCodeArchitectureRepo?.id || null,
      activeCodeArchitectureRepoKey: activeCodeArchitectureRowsKey || null,
      activeCodeArchitectureRepo: activeCodeArchitectureRepo ? {
        id: activeCodeArchitectureRepo.id,
        owner: activeCodeArchitectureRepo.owner || "",
        repo: activeCodeArchitectureRepo.repo || "",
        repoId: activeCodeArchitectureRepo.repoId || "",
        branch: activeCodeArchitectureRepo.branch || "main",
      } : null,
    };
  }

  const normalizeWorkflowRequirementRows = (rows = []) => (
    (Array.isArray(rows) ? rows : [])
      .map((row, index) => ({
        id: row?.id || row?.requirementId || `AGENT-REQ-${Date.now()}-${index + 1}`,
        title: row?.title || row?.name || row?.requirement || row?.text || `Agent requirement ${index + 1}`,
        module: row?.module || "Requirements Specification",
        source: row?.source || "xHandle Collaborator Agentic Workflow",
        attributes: {
          ...(row?.attributes || {}),
          Description: row?.description || row?.attributes?.Description || row?.title || row?.name || "",
        },
        links: Array.isArray(row?.links) ? row.links : [],
        ...row,
      }))
      .filter((row) => String(row.title || "").trim())
  );

  const buildRequirementsSpecificationRows = (requirementRows = [], { source = "xHandle Collaborator Agentic Workflow" } = {}) => {
    const requirementsOnly = (requirementRows || []).filter((row) => !row.heading);
    const hasSpecHeadings = (requirementRows || []).some((row) =>
      row.heading && /purpose|scope|overall description|specific requirements|verification|traceability/i.test(String(row.title || ""))
    );
    if (hasSpecHeadings) return requirementRows;

    const section = (title, description) => ({
      title,
      heading: true,
      attributes: { Description: description, Source: source },
      source,
    });

    const bodyRows = requirementsOnly.map((row, index) => ({
      ...row,
      id: row.id || `REQ-${String(index + 1).padStart(3, "0")}`,
      title: row.title || `Requirement ${index + 1}`,
      status: row.status || "Proposed",
      attributes: {
        Priority: row.attributes?.Priority || "TBD",
        Verification: row.attributes?.Verification || "Analysis/Test",
        Rationale: row.attributes?.Rationale || "Derived from hazard mitigation workflow.",
        Source: row.attributes?.Source || source,
        ...(row.attributes || {}),
      },
    }));

    return [
      section("1. Introduction", "Defines the purpose, scope, references, and intended audience for this requirements specification."),
      section("1.1 Purpose", "Capture safety and system requirements generated by xHandle Collaborator from the current project artifacts."),
      section("1.2 Scope", "Applies to the active xHandle project and the artifacts used by the selected agentic workflow."),
      section("1.3 References", "Source artifacts may include hazard analysis rows, mitigations, architecture data, functional decomposition, and Collaborator workflow outputs."),
      section("2. Overall Description", "Summarizes system context, assumptions, constraints, user needs, and safety-relevant operating conditions."),
      section("2.1 Product Perspective", "Describe external interfaces, operational environment, dependencies, and relevant system boundaries."),
      section("2.2 Assumptions and Constraints", "List assumptions, regulatory constraints, design constraints, safety constraints, and unresolved TBDs."),
      section("3. Specific Requirements", "Normative shall statements generated or curated for implementation and verification."),
      ...bodyRows,
      section("4. Verification and Validation", "Defines expected verification approach and test traceability for each requirement."),
      section("4.1 Verification Methods", "Use inspection, analysis, demonstration, and test methods as appropriate for each requirement."),
      section("5. Traceability", "Maintains links from hazards and mitigations to requirements, verification cases, and review evidence."),
      section("5.1 Open Issues and TBDs", "Track incomplete rationale, missing source evidence, ambiguous requirement wording, and unassigned verification coverage."),
    ];
  };

  const populateRequirementsModuleFromWorkflow = async (rows, { mode = "append", source = "xHandle Collaborator Agentic Workflow", moduleName: requestedModuleName = "" } = {}) => {
    const normalized = normalizeWorkflowRequirementRows(rows);
    if (!normalized.length) return { rows: [], module: null, moduleName: null };

    const moduleName =
      String(requestedModuleName || "").trim() ||
      normalized.find((row) => String(row.module || "").trim())?.module ||
      "Requirements Specification";
    const moduleRows = buildRequirementsSpecificationRows(normalized, { source }).map((row) => ({
      ...row,
      module: moduleName,
      attributes: {
        ...(row.attributes || {}),
        Source: row.attributes?.Source || source,
      },
    }));

    const provider = getActionProvider("requirements");
    let result = null;

    if (provider?.createModule && (provider?.appendModuleRows || provider?.replaceModuleRows)) {
      const module = await provider.createModule({
        name: moduleName,
        description: "Requirements generated by xHandle Collaborator Agentic Workflow.",
      });
      result = mode === "replace" && provider.replaceModuleRows
        ? await provider.replaceModuleRows({ moduleRef: module.id || moduleName, rows: moduleRows, mode: "replace" })
        : await provider.appendModuleRows({ moduleRef: module.id || moduleName, rows: moduleRows });
      provider.openModule?.({ moduleRef: module.id || moduleName });
    } else {
      const module = await createRequirementModule({
        name: moduleName,
        description: "Requirements generated by xHandle Collaborator Agentic Workflow.",
      });
      result = mode === "replace"
        ? await populateRequirementModule({ moduleId: module.id, rows: moduleRows })
        : await appendRequirementRows({ moduleId: module.id, rows: moduleRows });
    }

    const nextRows = loadRequirements();
    setRequirements(nextRows);
    setSection("requirements");
    return {
      module: result?.module || null,
      moduleName: result?.module?.name || moduleName,
      rows: result?.rows || moduleRows,
      allRequirements: nextRows,
    };
  };

  const normalizeWorkflowTestRows = (rows = []) => (
    (Array.isArray(rows) ? rows : [])
      .map((row, index) => ({
        id: row?.id || row?.testId || `AGENT-T-${Date.now()}-${index + 1}`,
        title: row?.title || row?.name || `Agent verification test ${index + 1}`,
        name: row?.name || row?.title || `Agent verification test ${index + 1}`,
        type: row?.type || row?.kind || "Verification",
        status: row?.status || "Draft",
        links: row?.links || (row?.requirementId ? { requirementId: row.requirementId } : {}),
      source: row?.source || "xHandle Collaborator Agentic Workflow",
        ...row,
      }))
      .filter((row) => String(row.title || row.name || "").trim())
  );

  const mergeRowsById = (existing = [], incoming = [], mode = "append") => {
    const base = mode === "replace" ? [] : (Array.isArray(existing) ? existing : []);
    const byId = new Map(base.map((row) => [row.id || row.title || row.name, row]));
    incoming.forEach((row) => byId.set(row.id || row.title || row.name || makeId(), row));
    return Array.from(byId.values());
  };

  const rebuildWorkflowTrace = (tests = []) => (
    (Array.isArray(tests) ? tests : []).map((test) => ({
      TestId: test.id,
      Requirement: test.links?.requirementId || test.requirementId || "unlinked",
      Hazards: (test.links?.hazardIds || test.hazardIds || []).join(", "),
    }))
  );

  const applyWorkflowArtifacts = async ({
    artifacts = {},
    mode = "append",
    targetProjectId,
    source = "xHandle Collaborator Agentic Workflow",
    requirementsModuleName = "",
  } = {}) => {
    const ensureWorkspaceGeneratedProject = () => {
      const existing = projects.find((project) => project.id === "workspace-generated-artifacts")
        || projects.find((project) => /workspace generated artifacts/i.test(project.name || ""));
      if (existing) return existing.id;
      const created = {
        id: "workspace-generated-artifacts",
        name: "Workspace Generated Artifacts",
        createdAt: new Date().toISOString(),
      };
      setProjects((prev) => (prev.some((project) => project.id === created.id) ? prev : [...prev, created]));
      saveProjectPatch(created.id, {
        _createdBy: "xHandle Collaborator",
        _description: "Workspace-level generated artifacts used when no explicit project or artifact target is selected.",
      });
      return created.id;
    };
    const projectId = targetProjectId || activeProjectId || ensureWorkspaceGeneratedProject();

    const applied = [];
    const patch = {};

    if (Array.isArray(artifacts.functionalDecompositionRows)) {
      const rows = artifacts.functionalDecompositionRows;
      patch.responseRows = rows;
      if (projectId === activeProjectId) setResponseRows(rows);
      applied.push({ artifact: "functionalDecompositionRows", count: rows.length, mode: "replace" });
    }

    if (Array.isArray(artifacts.riskSummaryRows)) {
      const summaryRows = artifacts.riskSummaryRows;
      const nextAnalysis = { ...(loadProjectData(projectId)?.analysisResult || {}), Summary: summaryRows };
      patch.analysisResult = nextAnalysis;
      patch.riskRegister = buildRiskRegisterFromSummary(summaryRows);
      if (projectId === activeProjectId) {
        setAnalysisResult((prev) => ({ ...(prev || {}), Summary: summaryRows }));
        setRiskRegister(patch.riskRegister);
      }
      applied.push({ artifact: "riskSummaryRows", count: Math.max(summaryRows.length - 1, 0), mode: "replace" });
    }

    if (Array.isArray(artifacts.mitigationRows)) {
      const existingMitigations = loadProjectData(projectId)?.mitigationRows || [];
      patch.mitigationRows = mergeRowsById(existingMitigations, artifacts.mitigationRows.map((text, index) => ({
        id: `AGENT-MIT-${index + 1}`,
        title: String(text || "").trim(),
        source,
      })).filter((row) => row.title), mode);
      applied.push({ artifact: "mitigationRows", count: artifacts.mitigationRows.length, mode });
    }

    if (Array.isArray(artifacts.requirementsRows)) {
      const incoming = normalizeWorkflowRequirementRows(artifacts.requirementsRows);
      let nextRequirements = incoming;
      let moduleName = String(requirementsModuleName || "").trim() || incoming[0]?.module || "Requirements Specification";
      if (projectId === activeProjectId) {
        const moduleResult = await populateRequirementsModuleFromWorkflow(incoming, { mode, source, moduleName });
        nextRequirements = moduleResult.allRequirements || incoming;
        moduleName = moduleResult.moduleName || moduleName;
      } else {
        nextRequirements = mergeRowsById(loadProjectData(projectId)?.requirements || [], incoming, mode);
      }
      patch.requirements = nextRequirements;
      patch.lastAgenticRequirementsModule = moduleName;
      applied.push({ artifact: "requirementsRows", count: incoming.length, mode, moduleName });
    }

    if (Array.isArray(artifacts.testRows)) {
      const incoming = normalizeWorkflowTestRows(artifacts.testRows);
      let nextVnv = null;
      const makeNext = (prev = {}) => {
        const tests = mergeRowsById(prev.tests || prev.testCases || [], incoming, mode);
        return {
          ...prev,
          tests,
          testCases: tests,
          trace: rebuildWorkflowTrace(tests),
          summary: {
            ...(prev.summary || {}),
            generatedAt: new Date().toISOString(),
            totals: {
              ...(prev.summary?.totals || {}),
              testCases: tests.length,
              requirements: Array.isArray(requirements) ? requirements.length : 0,
              hazards: Array.isArray(riskRegister) ? riskRegister.length : 0,
            },
          },
        };
      };
      if (projectId === activeProjectId) {
        setVnvArtifacts((prev) => {
          nextVnv = makeNext(prev || {});
          saveProjectPatch(projectId, { vnvArtifacts: nextVnv });
          return nextVnv;
        });
      } else {
        nextVnv = makeNext(loadProjectData(projectId)?.vnvArtifacts || {});
      }
      patch.vnvArtifacts = nextVnv;
      applied.push({ artifact: "testRows", count: incoming.length, mode });
    }

    if (artifacts.coverageSummary) {
      const existingVnv = patch.vnvArtifacts || loadProjectData(projectId)?.vnvArtifacts || {};
      patch.vnvArtifacts = { ...existingVnv, coverage: artifacts.coverageSummary };
      if (projectId === activeProjectId) setVnvArtifacts((prev) => ({ ...(prev || {}), coverage: artifacts.coverageSummary }));
      applied.push({ artifact: "coverageSummary", count: 1, mode: "replace" });
    }

    if (artifacts.traceabilityState) {
      patch.traceabilityState = artifacts.traceabilityState;
      applied.push({ artifact: "traceabilityState", count: 1, mode: "replace" });
    }

    if (artifacts.complianceMappings) {
      patch.complianceMappings = artifacts.complianceMappings;
      applied.push({ artifact: "complianceMappings", count: Array.isArray(artifacts.complianceMappings) ? artifacts.complianceMappings.length : 1, mode });
    }

    if (artifacts.reportMarkdown) {
      const report = {
        markdown: artifacts.reportMarkdown,
        report: artifacts.reportMarkdown,
        source,
        generatedAt: new Date().toISOString(),
      };
      patch.agentReportResult = report;
      patch.systemDesignSafetyReport = report;
      if (projectId === activeProjectId) setAgentReportResult(report);
      applied.push({ artifact: "reportMarkdown", count: 1, mode: "replace" });
    }

    if (Object.keys(patch).length) saveProjectPatch(projectId, patch);
    return {
      ok: true,
      projectId,
      workspaceScoped: !targetProjectId && !activeProjectId,
      applied,
    };
  };

  const shortId = (id, fallback = "") =>
    (id || "")
      .toString()
      .replace(/[^a-zA-Z0-9]/g, "")   // strip hyphens, etc.
      .slice(0, 6) || fallback;

  // ── Rename helpers ─────────────────────────────────────────────────────
const beginRename = (project) => {
  setEditingProjectId(project.id);
  setEditingProjectName(project.name);
  setEditingProjectFolderId(null);
  setRenameError('');
};

const beginRenameFolder = (folder) => {
  setEditingProjectFolderId(folder.id);
  setEditingProjectFolderName(folder.name);
  setEditingProjectId(null);
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

const commitFolderRename = () => {
  const name = (editingProjectFolderName || '').trim();
  const folder = projectFolders.find((entry) => entry.id === editingProjectFolderId);
  if (!name) { setRenameError('Please enter a folder name.'); return; }
  if (folder && projectFolders.some((entry) => entry.id !== editingProjectFolderId && entry.parentId === folder.parentId && entry.name.toLowerCase() === name.toLowerCase())) {
    setRenameError('A folder with this name already exists here.');
    return;
  }
  setProjectFolders((prev) =>
    prev.map((entry) => entry.id === editingProjectFolderId ? { ...entry, name, updatedAt: new Date().toISOString() } : entry)
  );
  setEditingProjectFolderId(null);
  setEditingProjectFolderName('');
  setRenameError('');
};

const cancelRename = () => {
  setEditingProjectId(null);
  setEditingProjectName('');
  setEditingProjectFolderId(null);
  setEditingProjectFolderName('');
  setRenameError('');
};

const deleteProjectFolder = (folderId) => {
  const folder = projectFolders.find((entry) => entry.id === folderId);
  if (!folder) return;
  if (!window.confirm(`Delete folder "${folder.name}"? Projects and subfolders inside it will move up one level.`)) return;

  setProjectFolders((prev) =>
    prev
      .filter((entry) => entry.id !== folderId)
      .map((entry) => entry.parentId === folderId ? { ...entry, parentId: folder.parentId || null, updatedAt: new Date().toISOString() } : entry)
  );
  setProjects((prev) => prev.map((project) => project.folderId === folderId ? { ...project, folderId: folder.parentId || null } : project));
  setOpenProjectFolderIds((prev) => {
    const next = { ...prev };
    delete next[folderId];
    return next;
  });
  setFolderDashboards((prev) => {
    const next = { ...prev };
    delete next[folderId];
    return next;
  });
  if (activeProjectFolderId === folderId) {
    setActiveProjectFolderId(folder.parentId || null);
    setActiveProjectId(null);
  }
};

const moveProjectToFolder = (projectId, folderId) => {
  if (!projectId) return;
  const nextFolderId = folderId || null;
  setProjects((prev) =>
    prev.map((project) =>
      project.id === projectId
        ? { ...project, folderId: nextFolderId, updatedAt: new Date().toISOString() }
        : project
    )
  );
  if (nextFolderId) {
    setOpenProjectFolderIds((prev) => ({ ...prev, [nextFolderId]: true }));
    setActiveProjectId(null);
    setActiveProjectFolderId(nextFolderId);
  }
  setDraggingProjectId(null);
  setDragOverProjectFolderId(null);
};

const createCodeArchitectureProject = () => {
  const name = newCodeArchitectureProjectName.trim();
  if (!name) { setNewCodeArchitectureError("Please enter a project name."); return; }
  if (codeArchitectureProjects.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
    setNewCodeArchitectureError("A Code-Based Architecture project with this name already exists.");
    return;
  }
  const now = new Date().toISOString();
  const project = {
    id: makeId(),
    name,
    folderId: newCodeArchitectureTargetFolderId || null,
    repos: [],
    activeRepoId: null,
    createdAt: now,
    updatedAt: now,
  };
  setCodeArchitectureProjects((prev) => [project, ...prev]);
  setActiveCodeArchitectureProjectId(project.id);
  setActiveCodeArchitectureFolderId(null);
  setNewCodeArchitectureProjectName("");
  setNewCodeArchitectureTargetFolderId(null);
  setNewCodeArchitectureError("");
  setShowNewCodeArchitectureProject(false);
  setSection("code-architecture");
  setIsSidebarOpen(true);
  setIsCodeArchitectureProjectsOpen(true);
  setTimeout(() => openCodeArchitectureRepoConfig(project.id), 0);
};

const createCodeArchitectureFolder = () => {
  const name = newCodeArchitectureFolderName.trim();
  const parentId = newCodeArchitectureFolderParentId || null;
  if (!name) { setNewCodeArchitectureFolderError("Please enter a folder name."); return; }
  if (codeArchitectureFolders.some((folder) => folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase())) {
    setNewCodeArchitectureFolderError("A folder with this name already exists here.");
    return;
  }
  const now = new Date().toISOString();
  const folder = { id: makeId(), name, parentId, createdAt: now, updatedAt: now };
  setCodeArchitectureFolders((prev) => [folder, ...prev]);
  setOpenCodeArchitectureFolderIds((prev) => ({ ...prev, [folder.id]: true, ...(parentId ? { [parentId]: true } : {}) }));
  setActiveCodeArchitectureProjectId(null);
  setActiveCodeArchitectureFolderId(folder.id);
  setCodeArchitectureFolderView("projects");
  setNewCodeArchitectureFolderName("");
  setNewCodeArchitectureFolderParentId(null);
  setNewCodeArchitectureFolderError("");
  setShowNewCodeArchitectureFolder(false);
  setSection("code-architecture");
};

const beginRenameCodeArchitectureProject = (project) => {
  setEditingCodeArchitectureProjectId(project.id);
  setEditingCodeArchitectureProjectName(project.name);
  setEditingCodeArchitectureFolderId(null);
  setCodeArchitectureRenameError("");
};

const beginRenameCodeArchitectureFolder = (folder) => {
  setEditingCodeArchitectureFolderId(folder.id);
  setEditingCodeArchitectureFolderName(folder.name);
  setEditingCodeArchitectureProjectId(null);
  setCodeArchitectureRenameError("");
};

const commitCodeArchitectureRename = () => {
  const name = editingCodeArchitectureProjectName.trim();
  if (!name) { setCodeArchitectureRenameError("Please enter a project name."); return; }
  if (codeArchitectureProjects.some((project) => project.id !== editingCodeArchitectureProjectId && project.name.toLowerCase() === name.toLowerCase())) {
    setCodeArchitectureRenameError("A Code-Based Architecture project with this name already exists.");
    return;
  }
  setCodeArchitectureProjects((prev) => prev.map((project) => project.id === editingCodeArchitectureProjectId ? { ...project, name, updatedAt: new Date().toISOString() } : project));
  setEditingCodeArchitectureProjectId(null);
  setEditingCodeArchitectureProjectName("");
  setCodeArchitectureRenameError("");
};

const commitCodeArchitectureFolderRename = () => {
  const name = editingCodeArchitectureFolderName.trim();
  const folder = codeArchitectureFolders.find((entry) => entry.id === editingCodeArchitectureFolderId);
  if (!name) { setCodeArchitectureRenameError("Please enter a folder name."); return; }
  if (folder && codeArchitectureFolders.some((entry) => entry.id !== editingCodeArchitectureFolderId && entry.parentId === folder.parentId && entry.name.toLowerCase() === name.toLowerCase())) {
    setCodeArchitectureRenameError("A folder with this name already exists here.");
    return;
  }
  setCodeArchitectureFolders((prev) => prev.map((entry) => entry.id === editingCodeArchitectureFolderId ? { ...entry, name, updatedAt: new Date().toISOString() } : entry));
  setEditingCodeArchitectureFolderId(null);
  setEditingCodeArchitectureFolderName("");
  setCodeArchitectureRenameError("");
};

const cancelCodeArchitectureRename = () => {
  setEditingCodeArchitectureProjectId(null);
  setEditingCodeArchitectureProjectName("");
  setEditingCodeArchitectureFolderId(null);
  setEditingCodeArchitectureFolderName("");
  setCodeArchitectureRenameError("");
};

const deleteCodeArchitectureProject = (projectId) => {
  const project = codeArchitectureProjects.find((entry) => entry.id === projectId);
  if (!project) return;
  if (!window.confirm(`Delete Code-Based Architecture project "${project.name}"? This will remove the local project entry.`)) return;
  const remaining = codeArchitectureProjects.filter((entry) => entry.id !== projectId);
  setCodeArchitectureProjects(remaining);
  if (activeCodeArchitectureProjectId === projectId) {
    setActiveCodeArchitectureProjectId(null);
    setCbaTableData([]);
    setSelectedCbaElement(null);
  }
};

const deleteCodeArchitectureFolder = (folderId) => {
  const folder = codeArchitectureFolders.find((entry) => entry.id === folderId);
  if (!folder) return;
  if (!window.confirm(`Delete folder "${folder.name}"? Projects and subfolders inside it will move up one level.`)) return;
  setCodeArchitectureFolders((prev) =>
    prev
      .filter((entry) => entry.id !== folderId)
      .map((entry) => entry.parentId === folderId ? { ...entry, parentId: folder.parentId || null, updatedAt: new Date().toISOString() } : entry)
  );
  setCodeArchitectureProjects((prev) => prev.map((project) => project.folderId === folderId ? { ...project, folderId: folder.parentId || null, updatedAt: new Date().toISOString() } : project));
  setOpenCodeArchitectureFolderIds((prev) => {
    const next = { ...prev };
    delete next[folderId];
    return next;
  });
  if (activeCodeArchitectureFolderId === folderId) {
    setActiveCodeArchitectureFolderId(folder.parentId || null);
    setActiveCodeArchitectureProjectId(null);
  }
};

const moveCodeArchitectureProjectToFolder = (projectId, folderId) => {
  if (!projectId) return;
  const nextFolderId = folderId || null;
  setCodeArchitectureProjects((prev) => prev.map((project) => project.id === projectId ? { ...project, folderId: nextFolderId, updatedAt: new Date().toISOString() } : project));
  if (nextFolderId) {
    setOpenCodeArchitectureFolderIds((prev) => ({ ...prev, [nextFolderId]: true }));
    setActiveCodeArchitectureProjectId(null);
    setActiveCodeArchitectureFolderId(nextFolderId);
  }
  setDraggingCodeArchitectureProjectId(null);
  setDragOverCodeArchitectureFolderId(null);
};


const NavItem = ({ icon: Icon, iconProps, label, active, onClick, disabled }) => (
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
        : (disabled ? 'Collaborator is docked' : undefined)
    }
  >
    <span className="shrink-0"><Icon size={18} {...iconProps} /></span>
    {isSidebarOpen && <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>}
  </button>
);



// Create a new project from a selection coming from the diagram modal
function handleCreateProjectFromSelection({ name, selectedNodes, filteredRows }) {
  if (!guardNewProjectIntent()) return;

  const desired = String(name || '').trim() || 'New Project';
  let finalName = desired;
  let suffix = 2;
  while (projects.some(p => p.name.toLowerCase() === finalName.toLowerCase())) {
    finalName = `${desired} (${suffix++})`;
  }

  const id = makeId();
  const proj = { id, name: finalName, createdAt: new Date().toISOString() };

  setProjects(prev => [proj, ...prev]);

  saveProjectPatch(id, {
    responseRows: Array.isArray(filteredRows) ? filteredRows : [],
    diagramCategories: null,
    analysisResult: null,
    riskMethod: 'STPA',
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
  const stepDescriptionsMap = {
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
    "STPA-Textbook": { total: 9, steps: { 1:"Identifying unsafe control actions...",2:"Populating STPA control contexts...",3:"Identifying textbook causal factors...",4:"Generating safety constraints...",5:"Deriving safety requirements...",6:"Consolidating safety requirements...",7:"Mapping hazards to unsafe control actions...",8:"Linking losses to hazards...",9:"Compiling STPA traceability matrix..." } },
    FMEA: { total: 9, steps: { 1:"Seeding failure mode candidates...",2:"Analyzing effects and causes...",3:"Extracting causal factors...",4:"Generating mitigation strategies...",5:"Deriving system requirements...",6:"Consolidating requirements...",7:"Mapping hazards to failure effects...",8:"Linking losses to hazards...",9:"Compiling safety summary..." } },
    "FMEA-Textbook": { total: 9, steps: { 1:"Seeding textbook failure modes...",2:"Analyzing textbook effects and causes...",3:"Extracting textbook causal factors...",4:"Generating recommended controls...",5:"Deriving design requirements...",6:"Consolidating requirements...",7:"Mapping failure modes to hazards...",8:"Linking losses to hazards...",9:"Compiling textbook FMEA summary..." } },
    HARA: { total: 9, steps: { 1:"Preparing HARA item/function context...",2:"Identifying hazardous events and S/E/C ratings...",3:"Reviewing controllability rationale...",4:"Assigning ASIL classifications...",5:"Deriving safety goals...",6:"Consolidating HARA rows...",7:"Mapping hazards to potential harm...",8:"Checking HARA traceability...",9:"Compiling HARA summary..." } },
    FHA: { total: 9, steps: { 1:"Preparing FHA function context...",2:"Identifying functional degradation and loss scenarios...",3:"Classifying mishap severity...",4:"Classifying software control category...",5:"Deriving MIL-STD-882E software criticality index...",6:"Identifying causal factors...",7:"Deriving controls and software safety requirements...",8:"Preparing verification and LOR links...",9:"Compiling FHA summary..." } },
    WhatIf:{ total: 9, steps: { 1:"Seeding what-if scenario table...",2:"Populating consequences and causes...",3:"Extracting causal factors...",4:"Generating mitigation strategies...",5:"Deriving system requirements...",6:"Consolidating requirements...",7:"Mapping hazards to what-if paths...",8:"Linking losses to hazards...",9:"Compiling safety summary..." } },
    "WhatIf-Textbook": { total: 9, steps: { 1:"Seeding textbook what-if scenarios...",2:"Populating scenario consequences and causes...",3:"Extracting textbook causal factors...",4:"Generating safeguards and recommendations...",5:"Deriving design requirements...",6:"Consolidating requirements...",7:"Mapping scenarios to hazards...",8:"Linking losses to hazards...",9:"Compiling textbook What-If summary..." } },
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
  };

  const agentStepDescriptions = {
    1: "Assessing summary quality...",
    2: "Chunking and summarizing data...",
    3: "Auditing summary chunks...",
    4: "Revising low-confidence summaries...",
    5: "Synthesizing final safety report..."
  };

  const [responseRows, setResponseRows] = useState([]);
  const [diagramCategories, setDiagramCategories] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [columnFilters, setColumnFilters] = useState({});
  const dropdownRefs = useRef({});
  const hazardRowRefs = useRef({});
  const [highlightedHazardRowIndex, setHighlightedHazardRowIndex] = useState(null);
  const [hazardReviewRunId, setHazardReviewRunId] = useState(null);
  const [draftHazardRowsByIndex, setDraftHazardRowsByIndex] = useState({});
  const [draftHazardGeneratingIndex, setDraftHazardGeneratingIndex] = useState(null);
  const [draftHazardFilterColumnIndex, setDraftHazardFilterColumnIndex] = useState(null);
  const [draftHazardColumnFilters, setDraftHazardColumnFilters] = useState({});
  const [draftHazardColumnSearches, setDraftHazardColumnSearches] = useState({});
  const draftHazardDropdownRefs = useRef({});
  const [pendingReviewSourceJump, setPendingReviewSourceJump] = useState(null);
  const [filterColumnIndex, setFilterColumnIndex] = useState(null);
  const [columnSearches, setColumnSearches] = useState({});
  const functionalDropdownRefs = useRef({});
  const functionalRowRefs = useRef({});
  const [highlightedFunctionalRowIndex, setHighlightedFunctionalRowIndex] = useState(null);
  const [functionalReviewRunId, setFunctionalReviewRunId] = useState(null);
  const [functionalFilterColumn, setFunctionalFilterColumn] = useState(null);
  const [functionalColumnFilters, setFunctionalColumnFilters] = useState({});
  const [functionalColumnSearches, setFunctionalColumnSearches] = useState({});
  const [isGeneratingDecomposition, setIsGeneratingDecomposition] = useState(false);
  const [showFunctionalDiagram, setShowFunctionalDiagram] = useState(true);
  const [riskMethod, setRiskMethod] = useState("STPA");
  const [projectRiskProfileGenerationMode, setProjectRiskProfileGenerationMode] = useState("standard");
  const [isGeneratingRiskAssessment, setIsGeneratingRiskAssessment] = useState(false);
  const [riskAssessmentReportMarkdown, setRiskAssessmentReportMarkdown] = useState("");
  const [isGeneratingRiskAssessmentReport, setIsGeneratingRiskAssessmentReport] = useState(false);
  const [generatingSafetyIssueReportIds, setGeneratingSafetyIssueReportIds] = useState(new Set());
  const [selectedRiskPriority, setSelectedRiskPriority] = useState("All");
  const [activeRiskId, setActiveRiskId] = useState(null);
  const [riskReportMode, setRiskReportMode] = useState("preview");
  const [showSafetyIssueReportDrawer, setShowSafetyIssueReportDrawer] = useState(true);
  const [isSafetyIssueReportFullscreen, setIsSafetyIssueReportFullscreen] = useState(false);
  const [progress, setProgress] = useState({ step: 0, total: stepDescriptionsMap["STPA"].total });
  const [agentReportResult, setAgentReportResult] = useState(null); // NEW: persisted report state
  const [isGeneratingAgentReport, setIsGeneratingAgentReport] = useState(false);
  const [functionalDiagramImage, setFunctionalDiagramImage] = useState(null);
  const [showPromptWizard, setShowPromptWizard] = useState(true);
  const [cleanOnceKey, setCleanOnceKey] = useState(null);
  const [promptMode, setPromptMode] = useState('structured');
  const [loadedProjectId, setLoadedProjectId] = useState(null);
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

  const { startActivity, updateActivity, finishActivity } = useActivityCenter();
const [analysisActivityId, setAnalysisActivityId] = useState(null);
useEffect(() => {
  if (!analysisActivityId || !isAnalyzing) return;
  updateActivity(analysisActivityId, {
    step: progress.step || 0,
    total: progress.total || 0,
    message: stepDescriptionsMap[riskMethod]?.steps[progress.step] || "Working…"
  });
}, [analysisActivityId, isAnalyzing, progress.step, progress.total, riskMethod, updateActivity]);

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
  }, [riskMethod]);

  useEffect(() => {
    let cancelled = false;
    async function loadCodeArchitectureHazardRun() {
      const repoMeta = activeCodeArchitectureRepoMeta;
      const repoId = repoMeta.repoId || repoMeta.repoName || "";
      if (!repoId) {
        if (!cancelled) setCodeArchitectureHazardRun(null);
        return;
      }
      try {
        const filters = { repoId };
        if (activeCodeArchitectureProjectId) filters.projectId = activeCodeArchitectureProjectId;
        let latest = await getLatestCodeArchitectureHazardRun(filters);
        if (!latest && activeCodeArchitectureProjectId) {
          latest = await getLatestCodeArchitectureHazardRun({ repoId });
        }
        if (!cancelled) setCodeArchitectureHazardRun(latest || null);
      } catch (error) {
        console.warn("[code-architecture-hazard-analysis] Failed to load latest run", error);
        if (!cancelled) setCodeArchitectureHazardRun(null);
      }
    }
    loadCodeArchitectureHazardRun();
    const onChanged = () => loadCodeArchitectureHazardRun();
    window.addEventListener("xhandle:code-architecture-hazard-analysis:changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("xhandle:code-architecture-hazard-analysis:changed", onChanged);
    };
  }, [activeCodeArchitectureProjectId, activeCodeArchitectureRepoMeta, cbaTableData]);

  useEffect(() => {
    if (!activeCodeArchitectureProject || !activeCodeArchitectureRepo) return;
    const projectId = activeCodeArchitectureProject.id || "no-project";
    const repoId = activeCodeArchitectureRepo.id || activeCodeArchitectureRepo.repoId || activeCodeArchitectureRepo.repoName || "no-repo";
    Promise.all([
      loadArtifactRowsAsync(ARTIFACT_KINDS.SOFTWARE, projectId, repoId),
      loadArtifactRowsAsync(ARTIFACT_KINDS.SYSTEM, projectId, repoId),
      loadArtifactRowsAsync(ARTIFACT_KINDS.SUBSYSTEM, projectId, repoId),
      loadArtifactRowsAsync(ARTIFACT_KINDS.DESIGN, projectId, repoId),
    ]).catch((error) => {
      console.warn("[code-architecture-assurance] Failed to prefetch artifact rows", error);
    });
  }, [activeCodeArchitectureProject, activeCodeArchitectureRepo]);


// Map labels dynamically to match the analysis / functional decomposition
const CANDIDATE_LABELS = {
  hazard: ['Hazard','Hazards','Failure Mode','Risk','Risk Title','What-If','Scenario','Event'],
  uca: ['Unsafe Control Actions','Unsafe Control Action','UCA','Effect','Cause','Causal Factor','Causal Factors','What-If Detail','Consequence','Description'],
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

const hazardLabel = useMemo(
  () => pickLabel(CANDIDATE_LABELS.hazard, 'Hazard'),
  [availableSummaryHeaders]
);

const ucaLabel = useMemo(
  () => pickLabel(CANDIDATE_LABELS.uca, 'Unsafe Control Actions'),
  [availableSummaryHeaders]
);

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

  useEffect(() => {
    const handleClickOutside = (event) => {
      const activeRef = functionalDropdownRefs.current[functionalFilterColumn];
      if (activeRef && !activeRef.contains(event.target)) {
        setFunctionalColumnSearches({});
        setFunctionalFilterColumn(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [functionalFilterColumn]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      const activeRef = draftHazardDropdownRefs.current[draftHazardFilterColumnIndex];
      if (activeRef && !activeRef.contains(event.target)) {
        setDraftHazardColumnSearches({});
        setDraftHazardFilterColumnIndex(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [draftHazardFilterColumnIndex]);

  // Load per-project state whenever activeProjectId changes
  useEffect(() => {
    setProjectLoaded(false);
    setLoadedProjectId(null);
    setLoadingProjectId(activeProjectId || null);
    if (!activeProjectId) {
      setResponseRows([]);
      setDiagramCategories(null);
      setAnalysisResult(null);
      setDraftHazardRowsByIndex({});
      setDraftHazardGeneratingIndex(null);
      setDraftHazardColumnFilters({});
      setDraftHazardColumnSearches({});
      setDraftHazardFilterColumnIndex(null);
      setRiskMethod('STPA');
      setProjectRiskProfileGenerationMode('standard');
      setAgentReportResult(null); // NEW: reset when no project
      setRiskAssessmentReportMarkdown("");
      setGeneratingSafetyIssueReportIds(new Set());
      setActiveRiskId(null);
      setSelectedRiskPriority("All");
      setRiskReportMode("preview");
      setRiskRegister([]);
      setRequirements([]);
      setShowPromptWizard(true);
      setProjectLoaded(false);
      setLoadedProjectId(null);
      setLoadingProjectId(null);
      return;
    }
    const data = loadProjectData(activeProjectId);
    const projectIdForLoad = activeProjectId;
    setResponseRows(data?.responseRows || []);
    setDiagramCategories(data?.diagramCategories || null);
    setAnalysisResult(data?.analysisResult ? stripProjectRiskProfileColumns(data.analysisResult) : null);
    setDraftHazardRowsByIndex(data?.draftHazardRowsByIndex || {});
    setDraftHazardGeneratingIndex(null);
    setDraftHazardColumnFilters({});
    setDraftHazardColumnSearches({});
    setDraftHazardFilterColumnIndex(null);
    setRiskMethod(data?.riskMethod || 'STPA');
    setProjectRiskProfileGenerationMode(data?.projectRiskProfileGenerationMode || 'standard');
    setAgentReportResult(data?.agentReportResult || null); // NEW: restore report
    setRiskAssessmentReportMarkdown(data?.riskAssessmentReportMarkdown || "");
    setGeneratingSafetyIssueReportIds(new Set());
    setActiveRiskId(null);
    setSelectedRiskPriority("All");
    setRiskReportMode("preview");
    setRiskRegister(data?.riskRegister || []);
    setShowPromptWizard(!(data?.responseRows && data.responseRows.length > 0));
    setRequirements(data?.requirements || []);   // ← add this
    const loadTimer = setTimeout(() => {
      setLoadedProjectId(projectIdForLoad);
      setProjectLoaded(true);
      setLoadingProjectId((current) => (current === projectIdForLoad ? null : current));
    }, 0);

    return () => clearTimeout(loadTimer);
  }, [activeProjectId]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (!projectLoaded || !responseRows.length || !diagramCategories?.categories?.length) return;
    const hasGenericNames = diagramCategories.categories.some((category) => isGenericDiagramCategoryName(category?.name));
    const needsFallbackRepair = diagramCategories.source === "wizard-fallback" || hasGenericNames;
    if (!needsFallbackRepair) return;

    const repaired = {
      signature: `${functionalRowSignature(responseRows)}::fallback-v2`,
      categories: normalizeWizardDiagramCategories(fallbackWizardDiagramCategories(responseRows), responseRows),
      source: "wizard-fallback-v2",
      generatedAt: new Date().toISOString(),
    };
    if (repaired.categories.length) setDiagramCategories(repaired);
  }, [projectLoaded, responseRows, diagramCategories]);

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
  if (!activeProjectId || loadingProjectId || !projectLoaded || loadedProjectId !== activeProjectId) return;
  const existingProjectData = loadProjectData(activeProjectId) || {};
  const patch = {
    responseRows,
    diagramCategories,
    riskMethod,
    projectRiskProfileGenerationMode,
	    agentReportResult,
    riskAssessmentReportMarkdown,
	    riskRegister,
	    requirements,        // ← add this
    draftHazardRowsByIndex,
	  };
  if (analysisResult !== null && analysisResult !== undefined) {
    patch.analysisResult = analysisResult;
  } else if (!hasAnalysisSummary(existingProjectData.analysisResult)) {
    patch.analysisResult = analysisResult;
  }
  saveProjectPatch(activeProjectId, patch);
}, [
  activeProjectId,
  loadingProjectId,
  projectLoaded,
  loadedProjectId,
  responseRows,
  diagramCategories,
  analysisResult,
  riskMethod,
  projectRiskProfileGenerationMode,
  agentReportResult,
  riskAssessmentReportMarkdown,
	  riskRegister, // <-- ensure riskRegister is in the deps
	  requirements,
  draftHazardRowsByIndex,
	]);

const handleProjectDiagramRowsUpdate = useCallback((nextRowsOrUpdater) => {
  const projectIdAtUpdate = activeProjectId;
  if (!projectIdAtUpdate || loadingProjectId || !projectLoaded || loadedProjectId !== projectIdAtUpdate) return;
  setResponseRows((currentRows) => {
    if (activeProjectId !== projectIdAtUpdate || loadingProjectId || !projectLoaded || loadedProjectId !== projectIdAtUpdate) {
      return currentRows;
    }
    const nextRows = typeof nextRowsOrUpdater === "function"
      ? nextRowsOrUpdater(currentRows)
      : nextRowsOrUpdater;
    return Array.isArray(nextRows) ? nextRows : currentRows;
  });
}, [activeProjectId, loadingProjectId, projectLoaded, loadedProjectId]);

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
    console.error("Agentic report failed:", err);
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
    if (!showFunctionalDiagram) return;
    if (!responseRows?.length) return;
    const waitForDiagram = async (maxRetries = 10, delay = 200) => {
      for (let i = 0; i < maxRetries; i++) {
        if (diagramRef.current?.isReady?.()) return true;
        await new Promise((r) => setTimeout(r, delay));
      }
      return false;
    };
    const exportDiagram = async () => {
      const isReady = await waitForDiagram();
      if (!isReady) return;
      const image = await diagramRef.current.exportAsImage();
      setFunctionalDiagramImage(image);
    };
    exportDiagram();
  }, [analysisResult, showFunctionalDiagram, responseRows?.length]);

  const getUniqueColumnValues = (colIdx, searchText = '') => {
    const rows = analysisResult?.Summary?.slice(1) ?? [];
    const unique = new Set();
    rows.forEach(row => {
      const value = row[colIdx];
      if (value !== undefined && value !== null && String(value).trim() !== '') unique.add(String(value));
    });
    return Array.from(unique)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
      .filter(val => String(val).toLowerCase().includes(searchText.toLowerCase()));
  };
  const toggleFilterValue = (colIdx, value) => {
    const current = columnFilters[colIdx] || [];
    const updated = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    setColumnFilters({ ...columnFilters, [colIdx]: updated });
  };
  const setColumnFilterValues = (colIdx, values) => {
    setColumnFilters((prev) => ({ ...prev, [colIdx]: values }));
  };
  const clearAllHazardFilters = () => {
    setColumnFilters({});
    setColumnSearches({});
    setFilterColumnIndex(null);
  };
  const applyFilters = (rows) => rows.filter((row) =>
    Object.entries(columnFilters).every(([colIdx, allowed]) =>
      allowed.length === 0 || allowed.includes(String(row[colIdx] ?? ''))
    )
  );
  const activeHazardFilterCount = Object.values(columnFilters)
    .reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0);
  const filteredHazardSummaryRows = (analysisResult?.Summary?.slice(1) || [])
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) =>
      Object.entries(columnFilters).every(([colIdx, allowed]) =>
        allowed.length === 0 || allowed.includes(String(row[colIdx] ?? ''))
      )
    );

  useEffect(() => {
    if (!activeProjectId || activeTab !== 'Hazard Analysis' || hasAnalysisSummary(analysisResult)) return;
    const savedAnalysis = loadProjectData(activeProjectId)?.analysisResult;
    if (hasAnalysisSummary(savedAnalysis)) {
      setAnalysisResult(savedAnalysis);
    }
  }, [activeProjectId, activeTab, analysisResult]);

  useEffect(() => {
    setDraftHazardGeneratingIndex(null);
    setDraftHazardColumnFilters({});
    setDraftHazardColumnSearches({});
    setDraftHazardFilterColumnIndex(null);
  }, [activeProjectId, riskMethod]);

  const draftHazardHeaders = useMemo(() => getProjectDraftHazardHeaders(riskMethod), [riskMethod]);
  const draftHazardSummaryRows = useMemo(() => (
    responseRows.map((row, index) => ({
      row: draftHazardRowsByIndex[index]?.row || buildProjectDraftHazardRow(row, draftHazardHeaders),
      originalIndex: index,
      generated: Boolean(draftHazardRowsByIndex[index]?.generated),
    }))
  ), [draftHazardHeaders, draftHazardRowsByIndex, responseRows]);

  const getUniqueDraftHazardColumnValues = (colIdx, searchText = '') => {
    const unique = new Set();
    draftHazardSummaryRows.forEach(({ row }) => {
      const value = row[colIdx];
      if (value !== undefined && value !== null && String(value).trim() !== '') unique.add(String(value));
    });
    return Array.from(unique)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
      .filter((val) => String(val).toLowerCase().includes(String(searchText || '').toLowerCase()));
  };
  const toggleDraftHazardFilterValue = (colIdx, value) => {
    setDraftHazardColumnFilters((prev) => {
      const current = prev[colIdx] || [];
      const updated = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
      return { ...prev, [colIdx]: updated };
    });
  };
  const setDraftHazardColumnFilterValues = (colIdx, values) => {
    setDraftHazardColumnFilters((prev) => ({ ...prev, [colIdx]: values }));
  };
  const clearAllDraftHazardFilters = () => {
    setDraftHazardColumnFilters({});
    setDraftHazardColumnSearches({});
    setDraftHazardFilterColumnIndex(null);
  };
  const activeDraftHazardFilterCount = Object.values(draftHazardColumnFilters)
    .reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0);
  const filteredDraftHazardSummaryRows = draftHazardSummaryRows.filter(({ row }) =>
    Object.entries(draftHazardColumnFilters).every(([colIdx, allowed]) =>
      !allowed?.length || allowed.includes(String(row[colIdx] ?? ''))
    )
  );
  const riskAssessmentSource = useMemo(() => {
    if (Array.isArray(analysisResult?.Summary?.[0]) && analysisResult.Summary.length > 1) {
      const [headers, ...rows] = analysisResult.Summary;
      return {
        source: "completed",
        headers: headers.map((header) => String(header || "")),
        rows: rows.map((row, index) => ({
          sourceIndex: index + 1,
          values: row,
        })),
      };
    }
    const generatedDraftRows = draftHazardSummaryRows
      .filter((item) => item.generated)
      .map((item) => ({
        sourceIndex: item.originalIndex + 1,
        values: item.row,
      }));
    return {
      source: "draft",
      headers: draftHazardHeaders,
      rows: generatedDraftRows,
    };
  }, [analysisResult, draftHazardHeaders, draftHazardSummaryRows]);
  const canGenerateRiskAssessment = riskAssessmentSource.rows.length > 0;
  const riskAssessmentSourceRowsByIndex = useMemo(() => {
    const map = new Map();
    riskAssessmentSource.rows.forEach((entry) => {
      const cells = {};
      riskAssessmentSource.headers.forEach((header, index) => {
        const label = String(header || `Column ${index + 1}`).trim();
        const value = String(entry.values?.[index] ?? "").trim();
        if (label && value) cells[label] = value;
      });
      map.set(Number(entry.sourceIndex), {
        sourceIndex: Number(entry.sourceIndex),
        cells,
        values: entry.values || [],
      });
    });
    return map;
  }, [riskAssessmentSource]);
  const risksWithEvidence = useMemo(() => {
    return (riskRegister || [])
      .map((risk) => {
        const score = getRiskScore(risk);
        const priority = getRiskPriority(score);
        const sourceIndexes = getRiskSourceIndexes(risk);
        const evidence = sourceIndexes
          .map((sourceIndex) => riskAssessmentSourceRowsByIndex.get(sourceIndex))
          .filter(Boolean);
        const reportGenerated = Boolean(getSafetyIssueReportBounds(riskAssessmentReportMarkdown, risk.id));
        const reportGenerating = generatingSafetyIssueReportIds.has(risk.id);
        return { ...risk, score, priority, sourceIndexes, evidence, reportGenerated, reportGenerating };
      })
      .sort((a, b) => b.score - a.score);
  }, [riskRegister, riskAssessmentSourceRowsByIndex, riskAssessmentReportMarkdown, generatingSafetyIssueReportIds]);
  const riskPriorityCounts = useMemo(() => {
    const counts = { All: risksWithEvidence.length, P0: 0, P1: 0, P2: 0, "P3+": 0 };
    risksWithEvidence.forEach((risk) => {
      counts[risk.priority] = (counts[risk.priority] || 0) + 1;
    });
    return counts;
  }, [risksWithEvidence]);
  const displayedRiskCards = selectedRiskPriority === "All"
    ? risksWithEvidence
    : risksWithEvidence.filter((risk) => risk.priority === selectedRiskPriority);
  const activeRisk = risksWithEvidence.length
    ? risksWithEvidence.find((risk) => risk.id === activeRiskId) || displayedRiskCards[0] || risksWithEvidence[0]
    : null;
  const activeSafetyIssueReportMarkdown = extractSafetyIssueReportMarkdown(riskAssessmentReportMarkdown, activeRisk);

  const draftHazardReviewItems = useMemo(() => {
    const draftArtifactPrefix = `hazard-summary-draft:${activeProjectId || "default"}:row:`;
    return (resultsReview.reviewItems || []).filter((item) =>
      item.sourceFeature === "AI Hazard Analysis" &&
      item.artifactType === "hazard_summary_draft_table" &&
      String(item.artifactId || "").startsWith(draftArtifactPrefix)
    );
  }, [activeProjectId, resultsReview.reviewItems]);

  const draftHazardReviewByRow = useMemo(() => {
    const map = new Map();
    draftHazardReviewItems.forEach((item) => {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex;
      if (!Number.isFinite(Number(rowIndex))) return;
      const existing = map.get(Number(rowIndex));
      const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
      const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
      if (!existing || itemTime >= existingTime) map.set(Number(rowIndex), item);
    });
    return map;
  }, [draftHazardReviewItems]);

  const draftHazardReviewDrawerOptions = useMemo(() => ({
    sourceFeature: "AI Hazard Analysis",
    sourceMethod: riskMethod,
    artifactType: "hazard_summary_draft_table",
    reviewItemIds: draftHazardReviewItems.map((item) => item.id),
    startAtFirstPending: true,
  }), [draftHazardReviewItems, riskMethod]);

  useEffect(() => {
    if (!activeProjectId || !projectLoaded || loadedProjectId !== activeProjectId) return;
    if (Object.keys(draftHazardRowsByIndex || {}).length > 0) return;
    if (!draftHazardReviewItems.length) return;
    const restored = {};
    draftHazardReviewItems.forEach((item) => {
      const rowIndex = Number(item.currentContent?.rowIndex ?? item.originalContent?.rowIndex);
      if (!Number.isFinite(rowIndex) || !Array.isArray(item.currentContent?.row)) return;
      restored[rowIndex] = {
        row: item.currentContent.row,
        generated: true,
      };
    });
    if (!Object.keys(restored).length) return;
    setDraftHazardRowsByIndex(restored);
    saveProjectPatch(activeProjectId, { draftHazardRowsByIndex: restored });
  }, [
    activeProjectId,
    draftHazardReviewItems,
    draftHazardRowsByIndex,
    loadedProjectId,
    projectLoaded,
  ]);

  const hazardSummaryReviewItems = useMemo(() => {
    const projectArtifactPrefix = `hazard-summary:${activeProjectId || "default"}:row:`;
    const filters = {
      sourceFeature: "AI Hazard Analysis",
      artifactType: "hazard_summary_table",
    };
    if (hazardReviewRunId) filters.sourceRunId = hazardReviewRunId;
    const filtered = resultsReview.getReviewItems(filters);
    if (filtered.length || hazardReviewRunId) return filtered;
    return (resultsReview.reviewItems || []).filter((item) =>
      item.artifactType === "hazard_summary_table" &&
      String(item.artifactId || "").startsWith(projectArtifactPrefix)
    );
  }, [activeProjectId, hazardReviewRunId, resultsReview]);

  const hazardSummaryReviewByRow = useMemo(() => {
    const map = new Map();
    hazardSummaryReviewItems.forEach((item) => {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex;
      if (!Number.isFinite(Number(rowIndex))) return;
      const existing = map.get(Number(rowIndex));
      const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
      const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
      if (!existing || itemTime >= existingTime) map.set(Number(rowIndex), item);
    });
    return map;
  }, [hazardSummaryReviewItems]);

  const hazardReviewDrawerOptions = useMemo(() => ({
    sourceFeature: "AI Hazard Analysis",
    sourceMethod: riskMethod,
    sourceRunId: hazardReviewRunId,
    artifactType: "hazard_summary_table",
    startAtFirstPending: true,
  }), [hazardReviewRunId, riskMethod]);

  const functionalReviewItems = useMemo(() => {
    const projectArtifactPrefix = `functional-decomposition:${activeProjectId || "default"}:row:`;
    const filters = {
      sourceFeature: "Prompt Wizard",
      artifactType: "functional_decomposition_table",
    };
    if (functionalReviewRunId) filters.sourceRunId = functionalReviewRunId;
    const filtered = resultsReview.getReviewItems(filters);
    if (filtered.length || functionalReviewRunId) return filtered;
    return (resultsReview.reviewItems || []).filter((item) =>
      item.artifactType === "functional_decomposition_table" &&
      String(item.artifactId || "").startsWith(projectArtifactPrefix)
    );
  }, [activeProjectId, functionalReviewRunId, resultsReview]);

  const functionalReviewByRow = useMemo(() => {
    const map = new Map();
    functionalReviewItems.forEach((item) => {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex;
      if (!Number.isFinite(Number(rowIndex))) return;
      const existing = map.get(Number(rowIndex));
      const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
      const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
      if (!existing || itemTime >= existingTime) map.set(Number(rowIndex), item);
    });
    return map;
  }, [functionalReviewItems]);

  const functionalReviewDrawerOptions = useMemo(() => ({
    sourceFeature: "Prompt Wizard",
    sourceMethod: promptMode,
    sourceRunId: functionalReviewRunId,
    artifactType: "functional_decomposition_table",
    startAtFirstPending: true,
  }), [functionalReviewRunId, promptMode]);

  const activeCodeArchitectureRepoIdForReview = activeCodeArchitectureRepo?.id || activeCodeArchitectureRepoMeta?.repoId || activeCodeArchitectureRepoMeta?.repoName || "repo";
  const activeCodeArchitectureRepoReviewIds = useMemo(() => {
    const ids = [
      activeCodeArchitectureRepo?.id,
      activeCodeArchitectureRepoMeta?.repoId,
      activeCodeArchitectureRepoMeta?.repoName,
      activeCodeArchitectureRepoMeta?.owner && activeCodeArchitectureRepoMeta?.repo
        ? `${activeCodeArchitectureRepoMeta.owner}/${activeCodeArchitectureRepoMeta.repo}`
        : "",
      "repo",
    ].filter(Boolean);
    return Array.from(new Set(ids.map(String)));
  }, [
    activeCodeArchitectureRepo?.id,
    activeCodeArchitectureRepoMeta?.owner,
    activeCodeArchitectureRepoMeta?.repo,
    activeCodeArchitectureRepoMeta?.repoId,
    activeCodeArchitectureRepoMeta?.repoName,
  ]);
  const codeArchitectureFunctionalArtifactRoot = `code-architecture-functional-decomposition:${activeCodeArchitectureProjectId || "default"}:${activeCodeArchitectureRepoIdForReview}`;

  const codeArchitectureFunctionalReviewItems = useMemo(() => {
    const projectArtifactPrefix = `${codeArchitectureFunctionalArtifactRoot}:row:`;
    return (resultsReview.reviewItems || []).filter((item) =>
      item.artifactType === CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE &&
      String(item.artifactId || "").startsWith(projectArtifactPrefix) &&
      (!codeArchitectureFunctionalReviewRunId || item.sourceRunId === codeArchitectureFunctionalReviewRunId)
    );
  }, [codeArchitectureFunctionalArtifactRoot, codeArchitectureFunctionalReviewRunId, resultsReview.reviewItems]);

  const codeArchitectureFunctionalReviewByRow = useMemo(() => {
    const map = new Map();
    codeArchitectureFunctionalReviewItems.forEach((item) => {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex;
      if (!Number.isFinite(Number(rowIndex))) return;
      const existing = map.get(Number(rowIndex));
      const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
      const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
      if (!existing || itemTime >= existingTime) map.set(Number(rowIndex), item);
    });
    return map;
  }, [codeArchitectureFunctionalReviewItems]);

  const codeArchitectureFunctionalReviewDrawerOptions = useMemo(() => ({
    sourceFeature: "Code-Based Architecture Functional Decomposition",
    sourceMethod: "GitHub repository analysis",
    sourceRunId: codeArchitectureFunctionalReviewRunId,
    artifactType: CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE,
    startAtFirstPending: true,
  }), [codeArchitectureFunctionalReviewRunId]);

  const codeArchitectureHazardReviewItems = useMemo(() => {
    const projectId = activeCodeArchitectureProjectId || codeArchitectureHazardRun?.projectId || "default";
    const projectArtifactPrefixes = activeCodeArchitectureRepoReviewIds.map(
      (repoId) => `code-architecture-hazard-summary:${projectId}:${repoId}:row:`
    );
    return (resultsReview.reviewItems || []).filter((item) =>
      item.artifactType === CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE &&
      projectArtifactPrefixes.some((prefix) => String(item.artifactId || "").startsWith(prefix)) &&
      (!codeArchitectureHazardRun?.id || item.sourceRunId === codeArchitectureHazardRun.id)
    );
  }, [activeCodeArchitectureProjectId, activeCodeArchitectureRepoReviewIds, codeArchitectureHazardRun?.id, codeArchitectureHazardRun?.projectId, resultsReview.reviewItems]);

  const codeArchitectureHazardReviewByRow = useMemo(() => {
    const map = new Map();
    const summaryRows = Array.isArray(codeArchitectureHazardRun?.generatedSheets?.Summary)
      ? codeArchitectureHazardRun.generatedSheets.Summary.slice(1)
      : [];
    const summaryRowKeys = summaryRows.map((row) => JSON.stringify(row || []));
    codeArchitectureHazardReviewItems.forEach((item) => {
      const reviewRow = Array.isArray(item.currentContent?.row)
        ? item.currentContent.row
        : (Array.isArray(item.originalContent?.row) ? item.originalContent.row : null);
      if (reviewRow) {
        const matchedIndex = summaryRowKeys.indexOf(JSON.stringify(reviewRow));
        if (matchedIndex >= 0) {
          const existing = map.get(matchedIndex);
          const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
          const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
          if (!existing || itemTime >= existingTime) map.set(matchedIndex, item);
          return;
        }
      }
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex;
      if (!Number.isFinite(Number(rowIndex))) return;
      if (reviewRow && summaryRows.length) return;
      const existing = map.get(Number(rowIndex));
      const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
      const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
      if (!existing || itemTime >= existingTime) map.set(Number(rowIndex), item);
    });
    return map;
  }, [codeArchitectureHazardReviewItems, codeArchitectureHazardRun?.generatedSheets?.Summary]);

  const codeArchitectureHazardReviewDrawerOptions = useMemo(() => ({
    sourceFeature: "Code-Based Architecture Hazard Analysis",
    sourceMethod: codeArchitectureHazardMethod,
    sourceRunId: codeArchitectureHazardRun?.id || "",
    artifactType: CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE,
    startAtFirstPending: true,
  }), [codeArchitectureHazardMethod, codeArchitectureHazardRun?.id]);

  const handleOpenHazardSummaryRow = useCallback((sourceIndex) => {
    const targetIndex = Number(sourceIndex);
    if (!Number.isFinite(targetIndex)) return;

    setActiveTab('Hazard Analysis');
    setShowDiagram(false);
    setColumnFilters({});
    setFilterColumnIndex(null);
    setHighlightedHazardRowIndex(targetIndex);

    setTimeout(() => {
      const rowEl = hazardRowRefs.current[targetIndex];
      rowEl?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 80);

    setTimeout(() => {
      setHighlightedHazardRowIndex((current) => (current === targetIndex ? null : current));
    }, 2600);
  }, []);

  const handleOpenFunctionalRow = useCallback((sourceIndex) => {
    const targetIndex = Number(sourceIndex);
    if (!Number.isFinite(targetIndex)) return;

    setActiveTab('Functional Diagramming');
    setShowFunctionalDiagram(false);
    setFunctionalColumnFilters({});
    setFunctionalFilterColumn(null);
    setHighlightedFunctionalRowIndex(targetIndex);

    setTimeout(() => {
      const rowEl = functionalRowRefs.current[targetIndex];
      rowEl?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 80);

    setTimeout(() => {
      setHighlightedFunctionalRowIndex((current) => (current === targetIndex ? null : current));
    }, 2600);
  }, []);

  const handleOpenCodeArchitectureHazardSummaryRow = useCallback((sourceIndex) => {
    const targetIndex = Number(sourceIndex);
    if (!Number.isFinite(targetIndex)) return;

    setSection("code-architecture");
    setCodeArchitectureWorkspaceTab("safety");
    setCodeArchitectureHazardSummaryOpenKey(`open-${Date.now()}`);
    setHighlightedCodeArchitectureHazardRowIndex(targetIndex);

    setTimeout(() => {
      setHighlightedCodeArchitectureHazardRowIndex((current) => (current === targetIndex ? null : current));
    }, 2600);
  }, []);

  const handleOpenCodeArchitectureFunctionalRow = useCallback((target) => {
    const targetIndex = Number(
      typeof target === "object" && target !== null
        ? target.rowIndex ?? target.sourceIndex
        : target
    );
    if (!Number.isFinite(targetIndex)) return;

    setSection("code-architecture");
    setCodeArchitectureWorkspaceTab("architecture");
    setCodeArchitectureFunctionalTableOpenKey(`open-${Date.now()}`);
    setHighlightedCodeArchitectureFunctionalRowIndex(targetIndex);

    setTimeout(() => {
      setHighlightedCodeArchitectureFunctionalRowIndex((current) => (current === targetIndex ? null : current));
    }, 2600);
  }, []);

  const readCodeArchitectureRepoRows = useCallback((projectId, repoId) => (
    readCbaRowsFromIndexedDB(codeArchitectureRowsKey(projectId, repoId))
  ), []);

  const handleOpenCrossRepoFunctionalRow = useCallback(({ projectId, repoId, rowIndex, rowRef, traceId } = {}) => {
    if (!projectId) return;
    const targetProject = codeArchitectureProjects.find((project) => project.id === projectId);
    const targetRepo = (targetProject?.repos || []).find((repo) =>
      repo.id === repoId ||
      repo.repoId === repoId ||
      repo.repoName === repoId
    );
    const targetRepoId = targetRepo?.id || repoId || targetProject?.activeRepoId || targetProject?.repos?.[0]?.id || "";
    setSection("code-architecture");
    setActiveCodeArchitectureFolderId(null);
    setActiveCodeArchitectureProjectId(projectId);
    if (targetRepoId) updateCodeArchitectureProject(projectId, { activeRepoId: targetRepoId });
    setCodeArchitectureWorkspaceTab("architecture");
    setCodeArchitectureFunctionalTableOpenKey(`open-${Date.now()}`);

    const numericIndex = Number(rowIndex);
    if (Number.isFinite(numericIndex) && numericIndex >= 0) {
      setHighlightedCodeArchitectureFunctionalRowIndex(numericIndex);
      setTimeout(() => {
        setHighlightedCodeArchitectureFunctionalRowIndex((current) => (current === numericIndex ? null : current));
      }, 2600);
      return;
    }

    if (targetRepoId && (rowRef || traceId)) {
      readCbaRowsFromIndexedDB(codeArchitectureRowsKey(projectId, targetRepoId)).then((rows) => {
        const target = String(traceId || rowRef || "").trim();
        const foundIndex = (Array.isArray(rows) ? rows : []).findIndex((row, index) =>
          String(row.traceId || "") === target ||
          String(row.rowRef || "") === target ||
          String(index + 1) === target
        );
        if (foundIndex >= 0) {
          setHighlightedCodeArchitectureFunctionalRowIndex(foundIndex);
          setTimeout(() => {
            setHighlightedCodeArchitectureFunctionalRowIndex((current) => (current === foundIndex ? null : current));
          }, 2600);
        }
      });
    }
  }, [codeArchitectureProjects]);

  const handleOpenCodeArchitectureArtifactRows = useCallback((tab, rowIds) => {
    const ids = Array.isArray(rowIds) ? rowIds : [rowIds];
    const cleanIds = ids.map((id) => String(id || "").trim()).filter(Boolean);
    if (!tab || !cleanIds.length) return;

    setSection("code-architecture");
    setCodeArchitectureWorkspaceTab(tab);
    const focusKey = Date.now();
    setCodeArchitectureArtifactFocus({ tab, rowIds: cleanIds, key: focusKey });
  }, []);

  const handleCodeArchitectureArtifactFocusResolved = useCallback(() => {
    setTimeout(() => {
      setCodeArchitectureArtifactFocus(null);
    }, 2600);
  }, []);

  const handleOpenCodeArchitectureAssuranceTrace = useCallback(({ linkType, value, row }) => {
    if (linkType === "architecture-source") {
      const refs = Array.isArray(row?.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
      const ref = refs.find((entry) => architectureLabelFromRef(entry) === value) || refs[0] || null;
      if (ref) {
        setPendingCodeArchitectureDiagramTarget(architectureRefToFocusTarget(ref));
        setSection("code-architecture");
        setCodeArchitectureWorkspaceTab("architecture");
      }
      return;
    }
    if (linkType === "functional-row") {
      const targetIndex = functionalRowIndexForTraceValue(cbaTableData, value);
      if (targetIndex >= 0) handleOpenCodeArchitectureFunctionalRow(targetIndex);
      return;
    }
    if (linkType === "hazard-row") {
      const rawTarget = String(value || "").trim();
      const numeric = Number(rawTarget.replace(/^HZ-?/i, ""));
      if (Number.isFinite(numeric) && numeric > 0) {
        handleOpenCodeArchitectureHazardSummaryRow(numeric - 1);
      }
      return;
    }
    const kind = artifactKindForLinkType(linkType);
    if (kind) handleOpenCodeArchitectureArtifactRows(kind, value);
  }, [cbaTableData, handleOpenCodeArchitectureArtifactRows, handleOpenCodeArchitectureFunctionalRow, handleOpenCodeArchitectureHazardSummaryRow]);

  const getReviewItemProjectId = useCallback((item) => {
    if (!item) return null;
    if (item.projectId) return item.projectId;
    const artifactId = String(item.artifactId || "");
    const artifactParts = artifactId.split(":");
    if (["hazard-summary", "functional-decomposition", "code-architecture-hazard-summary", "code-architecture-functional-decomposition"].includes(artifactParts[0]) && artifactParts[1]) {
      return artifactParts[1];
    }
    const searchable = [item.id, item.artifactId, item.sourceRunId].filter(Boolean).join(" ");
    return projects.find((project) => project?.id && searchable.includes(project.id))?.id || null;
  }, [projects]);

  const jumpToReviewSource = useCallback((item) => {
    if (!item) return;
    const projectId = getReviewItemProjectId(item);
    if (item.artifactType === CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE || item.artifactType === CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE) {
      if (projectId) {
        setActiveCodeArchitectureProjectId(projectId);
        setActiveCodeArchitectureFolderId(null);
        const artifactParts = String(item.artifactId || "").split(":");
        if (artifactParts[2]) {
          setCodeArchitectureProjects((prev) => prev.map((project) =>
            project.id === projectId
              ? { ...project, activeRepoId: artifactParts[2], updatedAt: new Date().toISOString() }
              : project
          ));
        }
      }
      setSection("code-architecture");
      setPendingReviewSourceJump(item);
      return;
    }
    if (projectId && projectId !== activeProjectId) {
      setActiveProjectId(projectId);
    }
    setSection("projects");
    setPendingReviewSourceJump(item);
  }, [activeProjectId, getReviewItemProjectId]);

  useEffect(() => {
    if (!pendingReviewSourceJump) return;
    const isCodeArchitectureReviewItem =
      pendingReviewSourceJump.artifactType === CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE ||
      pendingReviewSourceJump.artifactType === CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE;
    const projectId = getReviewItemProjectId(pendingReviewSourceJump);
    if (!isCodeArchitectureReviewItem) {
      if (projectId && activeProjectId !== projectId) return;
      if (projectId && (!projectLoaded || loadedProjectId !== projectId)) return;
    }

    const item = pendingReviewSourceJump;
    setPendingReviewSourceJump(null);

    if (item.artifactType === "functional_decomposition_table") {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
      handleOpenFunctionalRow(rowIndex);
      return;
    }
    if (item.artifactType === "hazard_summary_table" || item.artifactType === "hazard_summary_draft_table") {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
      handleOpenHazardSummaryRow(rowIndex);
      return;
    }
    if (item.artifactType === CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE) {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
      handleOpenCodeArchitectureHazardSummaryRow(rowIndex);
      return;
    }
    if (item.artifactType === CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE) {
      const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
      handleOpenCodeArchitectureFunctionalRow(rowIndex);
      return;
    }
    if (/safety_case/i.test(item.artifactType || item.reviewUnitType || "")) {
      setSection("safety-case");
      return;
    }
    if (/requirement/i.test(item.artifactType || item.reviewUnitType || "")) {
      setSection("requirements");
      return;
    }
    setSection("projects");
  }, [
    activeProjectId,
    getReviewItemProjectId,
    handleOpenCodeArchitectureFunctionalRow,
    handleOpenCodeArchitectureHazardSummaryRow,
    handleOpenFunctionalRow,
    handleOpenHazardSummaryRow,
    loadedProjectId,
    pendingReviewSourceJump,
    projectLoaded,
  ]);

  useEffect(() => {
    const focusHandler = (event) => {
      const item = event.detail?.reviewItem;
      if (item?.artifactType === "hazard_summary_table" || item?.artifactType === "hazard_summary_draft_table") {
        const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
        handleOpenHazardSummaryRow(rowIndex);
        return;
      }
      if (item?.artifactType === "functional_decomposition_table") {
        const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
        handleOpenFunctionalRow(rowIndex);
        return;
      }
      if (item?.artifactType === CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE) {
        const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
        handleOpenCodeArchitectureHazardSummaryRow(rowIndex);
        return;
      }
      if (item?.artifactType === CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE) {
        const rowIndex = item.currentContent?.rowIndex ?? item.originalContent?.rowIndex;
        handleOpenCodeArchitectureFunctionalRow(rowIndex);
      }
    };
    const updateHandler = (event) => {
      const item = event.detail?.reviewItem;
      const action = event.detail?.action;
      const shouldApplyReviewedRow = action === "approve_with_modifications" || action === "update_current_content";
      if (item?.artifactType === "hazard_summary_table") {
        const rowIndex = Number(item.currentContent?.rowIndex ?? item.originalContent?.rowIndex);
        if (!Number.isFinite(rowIndex)) return;

        handleOpenHazardSummaryRow(rowIndex);

        if (shouldApplyReviewedRow && Array.isArray(item.currentContent?.row)) {
          setAnalysisResult((prev) => {
            if (!prev?.Summary || !Array.isArray(prev.Summary)) return prev;
            const nextSummary = prev.Summary.map((row, idx) => (idx === rowIndex + 1 ? item.currentContent.row : row));
            return { ...prev, Summary: nextSummary };
          });
        }
        return;
      }
      if (item?.artifactType === "hazard_summary_draft_table") {
        const rowIndex = Number(item.currentContent?.rowIndex ?? item.originalContent?.rowIndex);
        if (!Number.isFinite(rowIndex)) return;

        handleOpenHazardSummaryRow(rowIndex);

        if (shouldApplyReviewedRow && Array.isArray(item.currentContent?.row)) {
          setDraftHazardRowsByIndex((prev) => ({
            ...prev,
            [rowIndex]: {
              row: item.currentContent.row,
              generated: true,
            },
          }));
          const projectId = getReviewItemProjectId(item) || activeProjectId;
          if (projectId) {
            const savedDraftRows = {
              ...(loadProjectData(projectId)?.draftHazardRowsByIndex || {}),
              [rowIndex]: {
                row: item.currentContent.row,
                generated: true,
              },
            };
            saveProjectPatch(projectId, { draftHazardRowsByIndex: savedDraftRows });
          }
        }
        return;
      }
      if (item?.artifactType === "functional_decomposition_table") {
        const rowIndex = Number(item.currentContent?.rowIndex ?? item.originalContent?.rowIndex);
        if (!Number.isFinite(rowIndex)) return;

        handleOpenFunctionalRow(rowIndex);

        if (shouldApplyReviewedRow && item.currentContent?.row && typeof item.currentContent.row === "object" && !Array.isArray(item.currentContent.row)) {
          setResponseRows((prev) => prev.map((row, idx) => (idx === rowIndex ? { ...row, ...item.currentContent.row } : row)));
        }
        return;
      }
      if (item?.artifactType === CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE) {
        const rowIndex = Number(item.currentContent?.rowIndex ?? item.originalContent?.rowIndex);
        if (!Number.isFinite(rowIndex)) return;

        handleOpenCodeArchitectureFunctionalRow(rowIndex);

        if (shouldApplyReviewedRow && item.currentContent?.row && typeof item.currentContent.row === "object" && !Array.isArray(item.currentContent.row)) {
          const reviewedRow = item.currentContent.row;
          setCbaTableData((prev) => {
            const next = prev.map((row, idx) => (idx === rowIndex ? {
              ...row,
              from: reviewedRow.from ?? row.from,
              fromFile: reviewedRow.fromFile ?? row.fromFile,
              fromDetails: reviewedRow.fromDetails ?? row.fromDetails,
              action: reviewedRow.action ?? row.action,
              controlActionDetails: reviewedRow.controlActionDetails ?? row.controlActionDetails,
              to: reviewedRow.to ?? row.to,
              toFile: reviewedRow.toFile ?? row.toFile,
              toDetails: reviewedRow.toDetails ?? row.toDetails,
              architecture: {
                ...(row.architecture || {}),
                subsystem: reviewedRow.subsystem ?? row.architecture?.subsystem,
                csci: reviewedRow.csci ?? row.architecture?.csci,
                csc: reviewedRow.csc ?? row.architecture?.csc,
                csu: reviewedRow.csu ?? row.architecture?.csu,
                rationale: reviewedRow.architectureRationale ?? row.architecture?.rationale,
              },
            } : row));
            writeCbaRowsToIndexedDB(activeCodeArchitectureRowsKey, next).catch(() => {});
            return next;
          });
        }
        return;
      }
      if (item?.artifactType === CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE) {
        const rowIndex = Number(item.currentContent?.rowIndex ?? item.originalContent?.rowIndex);
        if (!Number.isFinite(rowIndex)) return;

        handleOpenCodeArchitectureHazardSummaryRow(rowIndex);

        if (shouldApplyReviewedRow && Array.isArray(item.currentContent?.row)) {
          setCodeArchitectureHazardRun((prev) => {
            if (!prev?.generatedSheets?.Summary || !Array.isArray(prev.generatedSheets.Summary)) return prev;
            const nextSummary = prev.generatedSheets.Summary.map((row, idx) => (idx === rowIndex + 1 ? item.currentContent.row : row));
            const nextRun = {
              ...prev,
              generatedSheets: {
                ...prev.generatedSheets,
                Summary: nextSummary,
              },
              updatedAt: new Date().toISOString(),
            };
            saveCodeArchitectureHazardRun(nextRun).catch(() => {});
            return nextRun;
          });
        }
      }
    };

    window.addEventListener("xhandle:results-review:focus", focusHandler);
    window.addEventListener("xhandle:results-review:item-updated", updateHandler);
    return () => {
      window.removeEventListener("xhandle:results-review:focus", focusHandler);
      window.removeEventListener("xhandle:results-review:item-updated", updateHandler);
    };
  }, [
    activeCodeArchitectureRowsKey,
    activeProjectId,
    getReviewItemProjectId,
    handleOpenCodeArchitectureFunctionalRow,
    handleOpenCodeArchitectureHazardSummaryRow,
    handleOpenHazardSummaryRow,
    handleOpenFunctionalRow,
  ]);

  const generateFunctionalRowsFromWizard = async (combinedPrompt, onProgress = () => {}, projectIdAtStart = activeProjectId) => {
    let parsedRows = [];
    onProgress({
      step: 1,
      total: 2,
      message: "Generating functional architecture decomposition..."
    });
    await handleLitePromptSubmit(
      combinedPrompt,
      (response) => {
        const jsonMatch = response.match(/```json\s*([\s\S]*?)```/i);
        const cleanJson = jsonMatch ? jsonMatch[1] : response;
        try {
          const parsed = JSON.parse(cleanJson);
          parsedRows = Array.isArray(parsed) ? parsed : [];
        } catch (err) {
          console.error("Failed to parse response as JSON array", err);
          parsedRows = [];
        }
      },
      () => {},
      {}
    );

    onProgress({
      step: 2,
      total: 2,
      message: "Classifying functional architecture categories..."
    });
    const categories = parsedRows.length
      ? await classifyPromptWizardDiagramCategories(parsedRows, combinedPrompt)
      : null;
    if (projectIdAtStart && activeProjectIdRef.current !== projectIdAtStart) {
      return parsedRows;
    }
    setResponseRows(parsedRows);
    setDiagramCategories(categories);
    return parsedRows;
  };

  const handlePromptWizardSubmit = async (combinedPrompt) => {
    const projectIdAtStart = activeProjectId;
    const activityId = `wizard-decomposition-${activeProjectId || "default"}`;
    const sourceRunId = `functional-decomposition-${activeProjectId || "default"}-${Date.now()}`;
    setFunctionalReviewRunId(sourceRunId);
    startActivity(activityId, {
      title: "Generating functional architecture",
      step: 0,
      total: 2,
      message: "Starting prompt wizard generation..."
    });

    setIsGeneratingDecomposition(true);
    try {
      const parsedRows = await generateFunctionalRowsFromWizard(combinedPrompt, (progressPatch) => {
        updateActivity(activityId, progressPatch);
      }, projectIdAtStart);
      if (projectIdAtStart && activeProjectIdRef.current !== projectIdAtStart) {
        finishActivity(activityId, "error", "Project changed before generation completed");
        return;
      }
      if (parsedRows.length > 0) {
        try {
          await resultsReview.createReviewItems(createReviewItemsFromGeneratedTable({
            sourceFeature: "Prompt Wizard",
            sourceMethod: promptMode,
            sourceRunId,
            artifactType: "functional_decomposition_table",
            artifactId: `functional-decomposition:${activeProjectId || "default"}`,
            rows: parsedRows,
            columns: functionalTableColumns.map((column) => column.key),
          }));
        } catch (error) {
          console.warn("[results-review] Failed to register functional decomposition review items", error);
        }
      }
      finishActivity(activityId, "success", `${parsedRows.length} functions ready`);
      setShowPromptWizard(false);
      setCleanOnceKey(`wizard-${Date.now()}`);
    } catch (error) {
      console.error("Prompt wizard decomposition failed:", error);
      finishActivity(activityId, "error", error?.message || "Generation failed");
      alert(error?.message || "Sorry — functional architecture generation failed.");
    } finally {
      setIsGeneratingDecomposition(false);
    }
  };

  const handleRowChange = (index, field, value) => {
    const updated = [...responseRows];
    updated[index][field] = value;
    setResponseRows(updated);
  };
  const handleAddRow = () => setResponseRows([...responseRows, { subsystem:'', fromFunction:'', fromDetails:'', controlAction:'', controlDetails:'', toFunction:'', toDetails:'' }]);
  const handleRemoveRow = (index) => setResponseRows(responseRows.filter((_, i) => i !== index));
  const functionalTableColumns = [
    { key: 'subsystem', label: 'Subsystem' },
    { key: 'fromFunction', label: 'Function (From)' },
    { key: 'fromDetails', label: 'Function (From) Details' },
    { key: 'controlAction', label: 'Control Action' },
    { key: 'controlDetails', label: 'Control Action Details' },
    { key: 'toFunction', label: 'Function (To)' },
    { key: 'toDetails', label: 'Function (To) Details' },
  ];
  const getFunctionalCellValue = (row, field) => String(row?.[field] ?? '').trim();
  const getUniqueFunctionalColumnValues = (field, searchText = '') => {
    const unique = new Set();
    responseRows.forEach((row) => {
      const value = getFunctionalCellValue(row, field);
      if (value) unique.add(value);
    });
    const q = String(searchText || '').toLowerCase();
    return Array.from(unique)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
      .filter((val) => val.toLowerCase().includes(q));
  };
  const setFunctionalFilterValues = (field, values) => {
    setFunctionalColumnFilters((prev) => ({ ...prev, [field]: values }));
  };
  const toggleFunctionalFilterValue = (field, value) => {
    setFunctionalColumnFilters((prev) => {
      const current = prev[field] || [];
      const updated = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...prev, [field]: updated };
    });
  };
  const clearAllFunctionalFilters = () => {
    setFunctionalColumnFilters({});
    setFunctionalColumnSearches({});
    setFunctionalFilterColumn(null);
  };
  const activeFunctionalFilterCount = Object.values(functionalColumnFilters)
    .reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0);
  const filteredFunctionalRows = responseRows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) =>
      Object.entries(functionalColumnFilters).every(([field, allowed]) =>
        !allowed?.length || allowed.includes(getFunctionalCellValue(row, field))
      )
    );
  const activeProjectDiagramKey = activeProjectId
    ? `diagram:${activeProjectId}:${loadedProjectId === activeProjectId && projectLoaded ? "ready" : "loading"}`
    : "diagram:none";
  const activeProjectDiagramReady = Boolean(
    activeProjectId &&
    loadedProjectId === activeProjectId &&
    projectLoaded &&
    !loadingProjectId
  );

  const handleRunAnalysis = async (selectedMethod) => {
    const usesProjectRiskProfileGenerationMode = selectedMethod === "STPA-Textbook";
    const selectedGenerationMode = usesProjectRiskProfileGenerationMode
      ? projectRiskProfileGenerationMode
      : undefined;
    const sourceRunId = `hazard-${activeProjectId || "default"}-${Date.now()}`;
    const targetHeaders = getProjectDraftHazardHeaders(selectedMethod);
    const existingSummary = Array.isArray(analysisResult?.Summary) ? analysisResult.Summary : null;
    const startingDraftRows = loadProjectData(activeProjectId)?.draftHazardRowsByIndex || draftHazardRowsByIndex || {};
    const rowsToGenerate = [];
    const preservedDraftRows = {};

    responseRows.forEach((functionalRow, originalIndex) => {
      const fallbackRow = buildProjectDraftHazardRow(functionalRow, targetHeaders);
      const savedDraft = startingDraftRows[originalIndex];
      const savedDraftRow = Array.isArray(savedDraft?.row)
        ? alignSummaryRowToHeaders(draftHazardHeaders, savedDraft.row, targetHeaders, fallbackRow)
        : null;
      const savedDraftIsMeaningful = savedDraftRow
        ? (savedDraft?.generated || isMeaningfullyGeneratedDraftRow(savedDraftRow, fallbackRow))
        : false;
      if (savedDraftIsMeaningful) {
        preservedDraftRows[originalIndex] = {
          row: savedDraftRow,
          generated: true,
        };
        return;
      }

      const completedRow = findExistingHazardRowForFunctionalRow(functionalRow, existingSummary);
      if (completedRow) {
        const completedHeaders = existingSummary[0] || [];
        const alignedCompletedRow = alignSummaryRowToHeaders(completedHeaders, completedRow, targetHeaders, fallbackRow);
        if (isMeaningfullyGeneratedDraftRow(alignedCompletedRow, fallbackRow)) {
          preservedDraftRows[originalIndex] = {
            row: alignedCompletedRow,
            generated: true,
          };
          return;
        }
      }

      rowsToGenerate.push({ functionalRow, originalIndex, fallbackRow });
    });

    if (responseRows.length > 0 && rowsToGenerate.length === 0) {
      const finalSheets = {
        ...(analysisResult || {}),
        Summary: [
          targetHeaders,
          ...responseRows
            .map((functionalRow, index) => preservedDraftRows[index]?.row || buildProjectDraftHazardRow(functionalRow, targetHeaders))
            .filter((row, index) => isMeaningfullyGeneratedDraftRow(row, buildProjectDraftHazardRow(responseRows[index], targetHeaders))),
        ],
      };
      setDraftHazardRowsByIndex((prev) => ({ ...prev, ...preservedDraftRows }));
      setAnalysisResult(finalSheets);
      if (activeProjectId) {
        saveProjectPatch(activeProjectId, {
          analysisResult: finalSheets,
          riskMethod: selectedMethod,
          draftHazardRowsByIndex: {
            ...(loadProjectData(activeProjectId)?.draftHazardRowsByIndex || {}),
            ...preservedDraftRows,
          },
          ...(usesProjectRiskProfileGenerationMode
            ? { projectRiskProfileGenerationMode: selectedGenerationMode }
            : {}),
        });
      }
      setShowDiagram(false);
      setActiveTab('Hazard Analysis');
      window.alert("All control actions already have hazard analysis rows, so nothing was overwritten.");
      return;
    }

    const functionalDecompositionSheet = [
      ["Function (From)", "Control Action", "Function (To)"],
      ...rowsToGenerate.map(({ functionalRow }) => [functionalRow.fromFunction || "", functionalRow.controlAction || "", functionalRow.toFunction || ""])
    ];
    const sheets = { "Functional Decomposition": functionalDecompositionSheet };
    const dummySetFolders = async (updater) => { const prev = {}; const newState = await updater(prev); return newState; };
    const currentFolder = "LiteProject";

    // NEW: start activity
    const actId = `hazard-${activeProjectId || "default"}`;
    setHazardReviewRunId(sourceRunId);
    setAnalysisActivityId(actId);
    startActivity(actId, {
      title: "Running hazard analysis",
      step: 0,
      total: stepDescriptionsMap[selectedMethod]?.total || 9,
      message: "Starting analysis..."
    });

    setIsAnalyzing(true);
    setProgress({ step: 0, total: stepDescriptionsMap[selectedMethod]?.total || 9 });

    const rawFinalSheets = await runLiteAIAnalysis({
      tableRows: rowsToGenerate.map(({ functionalRow }) => functionalRow),
      sheets,
      setFolders: dummySetFolders,
      currentFolder,
      setChatPrompt: () => {},
      setChatResponse: () => {},
      setProgress,              // keeps your UI updated
      hazardMethod: selectedMethod,
      ...(usesProjectRiskProfileGenerationMode
        ? { hazardGenerationMode: selectedGenerationMode, fhaGenerationMode: selectedGenerationMode }
        : {}),
    });
    const generatedSheets = addSubsystemAllocationsToProjectHazardSummary(
      stripProjectRiskProfileColumns(rawFinalSheets),
      rowsToGenerate.map(({ functionalRow }) => functionalRow)
    );
    const generatedSummary = findBestGeneratedHazardSummary(generatedSheets);
    const generatedHeaders = Array.isArray(generatedSummary?.[0]) ? generatedSummary[0] : [];
    const generatedRows = Array.isArray(generatedSummary) ? generatedSummary.slice(1) : [];
    const generatedDraftRows = {};

    rowsToGenerate.forEach(({ functionalRow, originalIndex, fallbackRow }, generatedIndex) => {
      const generatedRow = generatedRows[generatedIndex];
      const nextRow = Array.isArray(generatedRow)
        ? alignSummaryRowToHeaders(generatedHeaders, generatedRow, targetHeaders, fallbackRow)
        : fallbackRow;
      if (isMeaningfullyGeneratedDraftRow(nextRow, fallbackRow)) {
        generatedDraftRows[originalIndex] = {
          row: nextRow,
          generated: true,
        };
      }
    });

    const mergedDraftRows = {
      ...startingDraftRows,
      ...preservedDraftRows,
      ...generatedDraftRows,
    };
    const mergedSummaryRows = responseRows
      .map((functionalRow, index) => {
        const fallbackRow = buildProjectDraftHazardRow(functionalRow, targetHeaders);
        const row = mergedDraftRows[index]?.row || fallbackRow;
        return isMeaningfullyGeneratedDraftRow(row, fallbackRow) ? row : null;
      })
      .filter(Boolean);
    const finalSheets = {
      ...generatedSheets,
      Summary: [targetHeaders, ...mergedSummaryRows],
    };

    setAnalysisResult(finalSheets);
    setDraftHazardRowsByIndex(mergedDraftRows);
    if (activeProjectId) {
      saveProjectPatch(activeProjectId, {
        analysisResult: finalSheets,
        riskMethod: selectedMethod,
        draftHazardRowsByIndex: mergedDraftRows,
        ...(usesProjectRiskProfileGenerationMode
          ? { projectRiskProfileGenerationMode: selectedGenerationMode }
          : {}),
      });
    }
    if (Array.isArray(finalSheets?.Summary) && finalSheets.Summary.length > 1) {
      try {
        const [columns, ...rows] = finalSheets.Summary;
        await resultsReview.createReviewItems(createReviewItemsFromGeneratedTable({
          sourceFeature: "AI Hazard Analysis",
          sourceMethod: selectedMethod,
          sourceRunId,
          artifactType: "hazard_summary_table",
          artifactId: `hazard-summary:${activeProjectId || "default"}`,
          rows,
          columns,
        }));
      } catch (error) {
        console.warn("[results-review] Failed to register hazard Summary review items", error);
      }
    }
    setIsAnalyzing(false);
    setShowDiagram(false);
    setActiveTab('Hazard Analysis');

    // NEW: finish activity
    finishActivity(actId, "success", "Analysis complete");
  };

  const handleProjectRiskMethodChange = (nextMethod) => {
    setRiskMethod(nextMethod);
    setDraftHazardColumnFilters({});
    setDraftHazardColumnSearches({});
    setDraftHazardFilterColumnIndex(null);
    if (activeProjectId) {
      saveProjectPatch(activeProjectId, {
        riskMethod: nextMethod,
      });
    }
  };

  const handleProjectRiskProfileGenerationModeChange = (nextMode) => {
    setProjectRiskProfileGenerationMode(nextMode);
    setDraftHazardColumnFilters({});
    setDraftHazardColumnSearches({});
    setDraftHazardFilterColumnIndex(null);
    if (activeProjectId) {
      saveProjectPatch(activeProjectId, {
        projectRiskProfileGenerationMode: nextMode,
      });
    }
  };

  const handleGenerateDraftHazardRow = async (functionalRowIndex) => {
    if (draftHazardGeneratingIndex !== null) return;
    const functionalRow = responseRows[functionalRowIndex];
    if (!functionalRow) return;

    const selectedMethod = riskMethod;
    const usesProjectRiskProfileGenerationMode = selectedMethod === "STPA-Textbook";
    const selectedGenerationMode = usesProjectRiskProfileGenerationMode
      ? projectRiskProfileGenerationMode
      : undefined;
    const functionalDecompositionSheet = [
      ["Function (From)", "Control Action", "Function (To)"],
      [functionalRow.fromFunction || "", functionalRow.controlAction || "", functionalRow.toFunction || ""],
    ];
    const sheets = { "Functional Decomposition": functionalDecompositionSheet };
    const dummySetFolders = async (updater) => {
      const prev = {};
      return typeof updater === "function" ? updater(prev) : updater;
    };
    const targetHeaders = getProjectDraftHazardHeaders(selectedMethod);
    const fallbackRow = buildProjectDraftHazardRow(functionalRow, targetHeaders);

    setDraftHazardGeneratingIndex(functionalRowIndex);
    try {
      const rawSheets = await runLiteAIAnalysis({
        tableRows: [functionalRow],
        sheets,
        setFolders: dummySetFolders,
        currentFolder: "LiteProject",
        setChatPrompt: () => {},
        setChatResponse: () => {},
        setProgress: () => {},
        hazardMethod: selectedMethod,
        omitConsolidatedRequirement: true,
        ...(usesProjectRiskProfileGenerationMode
          ? { hazardGenerationMode: selectedGenerationMode, fhaGenerationMode: selectedGenerationMode }
          : {}),
      });
      const generatedSheets = addSubsystemAllocationsToProjectHazardSummary(
        stripProjectRiskProfileColumns(rawSheets),
        [functionalRow]
      );
      const summary = findBestGeneratedHazardSummary(generatedSheets);
      const generatedHeaders = Array.isArray(summary?.[0]) ? summary[0] : [];
      const generatedRow = Array.isArray(summary?.[1]) ? summary[1] : null;
      const nextRow = generatedRow
        ? alignSummaryRowToHeaders(generatedHeaders, generatedRow, targetHeaders, fallbackRow)
        : fallbackRow;
      const generated = isMeaningfullyGeneratedDraftRow(nextRow, fallbackRow);
      if (!generated) {
        throw new Error("The selected method completed but did not return usable hazard values for this row.");
      }

      setDraftHazardRowsByIndex((prev) => ({
        ...prev,
        [functionalRowIndex]: {
          row: nextRow,
          generated,
        },
      }));
      if (activeProjectId) {
        const savedDraftRows = {
          ...(loadProjectData(activeProjectId)?.draftHazardRowsByIndex || {}),
          [functionalRowIndex]: {
            row: nextRow,
            generated,
          },
        };
        saveProjectPatch(activeProjectId, { draftHazardRowsByIndex: savedDraftRows });
      }
      const reviewItem = normalizeReviewItem({
        id: createReviewId(
          `hazard-draft-${activeProjectId || "default"}`,
          "hazard_summary_draft_table",
          `row:${functionalRowIndex}`
        ),
        artifactType: "hazard_summary_draft_table",
        artifactId: `hazard-summary-draft:${activeProjectId || "default"}:row:${functionalRowIndex}`,
        reviewUnitType: REVIEW_UNIT_TYPES.TABLE_ROW,
        sourceFeature: "AI Hazard Analysis",
        sourceMethod: selectedMethod,
        sourceRunId: `hazard-draft-${activeProjectId || "default"}`,
        projectId: activeProjectId || "",
        originalContent: { rowIndex: functionalRowIndex, columns: targetHeaders, row: nextRow },
        currentContent: { rowIndex: functionalRowIndex, columns: targetHeaders, row: nextRow },
        traceLinks: [{ type: "table_row", rowIndex: functionalRowIndex }],
      });
      await resultsReview.createReviewItems([reviewItem]);
    } catch (error) {
      console.error("[project-hazard-draft] Failed to generate draft hazard row", error);
      window.alert(error?.message || "Unable to generate this hazard row. Check your AI provider settings and try again.");
    } finally {
      setDraftHazardGeneratingIndex(null);
    }
  };

  const handleDraftHazardCellChange = (functionalRowIndex, columnIndex, value) => {
    const functionalRow = responseRows[functionalRowIndex];
    if (!functionalRow) return;
    let nextRowForReview = null;
    setDraftHazardRowsByIndex((prev) => {
      const existing = prev[functionalRowIndex];
      const baseRow = existing?.row || buildProjectDraftHazardRow(functionalRow, draftHazardHeaders);
      const nextRow = baseRow.map((cell, index) => (index === columnIndex ? value : cell));
      nextRowForReview = nextRow;
      return {
        ...prev,
        [functionalRowIndex]: {
          row: nextRow,
          generated: existing?.generated || isMeaningfullyGeneratedDraftRow(nextRow, buildProjectDraftHazardRow(functionalRow, draftHazardHeaders)),
        },
      };
    });

    if (activeProjectId && nextRowForReview) {
      const savedDraftRows = {
        ...(loadProjectData(activeProjectId)?.draftHazardRowsByIndex || {}),
        [functionalRowIndex]: {
          row: nextRowForReview,
          generated: true,
        },
      };
      saveProjectPatch(activeProjectId, { draftHazardRowsByIndex: savedDraftRows });
    }

    const reviewItem = draftHazardReviewByRow.get(functionalRowIndex);
    if (reviewItem && nextRowForReview) {
      resultsReview.updateReviewItem(reviewItem.id, {
        currentContent: {
          ...(reviewItem.currentContent || {}),
          rowIndex: functionalRowIndex,
          columns: draftHazardHeaders,
          row: nextRowForReview,
        },
      }).catch((error) => {
        console.warn("[results-review] Failed to sync draft hazard cell edit", error);
      });
    }
  };

  const generateSafetyIssueReportsMarkdown = async (rowsForReport = riskRegister) => {
    const risksForReport = (rowsForReport || [])
      .map((risk) => {
        const score = getRiskScore(risk);
        const priority = getRiskPriority(score);
        const sourceIndexes = getRiskSourceIndexes(risk);
        const evidence = sourceIndexes
          .map((sourceIndex) => riskAssessmentSourceRowsByIndex.get(sourceIndex))
          .filter(Boolean);
        return { ...risk, score, priority, sourceIndexes, evidence };
      })
      .sort((a, b) => b.score - a.score);
    if (!risksForReport.length || isGeneratingRiskAssessmentReport) return "";
    setIsGeneratingRiskAssessmentReport(true);
    try {
      const mdCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
      const sourceLinks = (indexes = []) => indexes.length
        ? indexes.map((index) => `[Source Row ${index}](#hazard-source-row-${index})`).join(", ")
        : "Not linked";
      const listBlock = (value) => {
        const items = Array.isArray(value) ? value : [value];
        return items
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .map((item) => `- ${item}`)
          .join("\n") || "- Not specified in the available evidence.";
      };
      const renderEvidenceRows = (issue, report) => {
        const evidenceRows = Array.isArray(report?.keyEvidenceRows) && report.keyEvidenceRows.length
          ? report.keyEvidenceRows
          : issue.evidence.map((item) => ({
              sourceIndex: item.sourceIndex,
              hazardUnsafeCondition: Object.entries(item.cells || {}).slice(0, 2).map(([label, value]) => `${label}: ${value}`).join("; "),
              affectedFunctionOrSubsystem: Object.entries(item.cells || {}).find(([label]) => /function|subsystem|component|allocation/i.test(label))?.[1] || "",
              controlActionOrFailureMode: Object.entries(item.cells || {}).find(([label]) => /control|action|failure|unsafe/i.test(label))?.[1] || "",
              whyThisMatters: "This source row is part of the hazard-analysis evidence consolidated into the safety issue.",
            }));
        return [
          "| Evidence Link | Hazard/Unsafe Condition | Affected Function or Subsystem | Control Action or Failure Mode | Why This Matters |",
          "| --- | --- | --- | --- | --- |",
          ...evidenceRows.map((row) => {
            const sourceIndex = Number(row?.sourceIndex) || issue.sourceIndexes[0] || "";
            return `| ${sourceIndex ? `[Source Row ${sourceIndex}](#hazard-source-row-${sourceIndex})` : "Not linked"} | ${mdCell(row?.hazardUnsafeCondition)} | ${mdCell(row?.affectedFunctionOrSubsystem)} | ${mdCell(row?.controlActionOrFailureMode)} | ${mdCell(row?.whyThisMatters)} |`;
          }),
        ].join("\n");
      };
      const normalizeIssueReport = (issue, parsed) => ({
        executiveSummary: parsed?.executiveSummary || `This ${issue.priority} safety issue consolidates hazard-analysis evidence related to ${issue.title}.`,
        observedConditionType: /implementation/i.test(parsed?.observedConditionType) ? "Implementation" : "System",
        observedCondition: parsed?.observedCondition || issue.description || "No observed condition was returned.",
        keyEvidenceRows: Array.isArray(parsed?.keyEvidenceRows) ? parsed.keyEvidenceRows : [],
        safetySignificance: parsed?.safetySignificance || "Safety significance should be reviewed against the linked hazard-analysis evidence.",
        existingControlsMitigations: parsed?.existingControlsMitigations || "No explicit controls or mitigations were identified in the available evidence.",
        uncertaintySystemBoundary: parsed?.uncertaintySystemBoundary || "Assumptions and boundary conditions should be confirmed during review.",
        recommendedEngineeringAction: parsed?.recommendedEngineeringAction || "Define and assign mitigation actions proportional to the priority of this safety issue.",
        recommendedVerification: parsed?.recommendedVerification || "Verify mitigations with targeted analysis, review, and testing tied to the source evidence.",
        finalAssessment: parsed?.finalAssessment || "Open pending engineering disposition and verification.",
      });
      const renderIssueReport = (issue, report) => {
        const observedHeading = report.observedConditionType === "Implementation"
          ? "Observed Implementation Condition"
          : "Observed System Condition";
        return [
          `<!-- SAFETY_ISSUE_REPORT_START id="${issue.id}" -->`,
          `### **Safety Issue: ${issue.title}**`,
          "",
          "| Field | Value |",
          "| --- | --- |",
          `| Issue ID | ${mdCell(issue.id)} |`,
          `| Priority | ${mdCell(issue.priority)} |`,
          `| Likelihood | ${mdCell(issue.likelihood)} |`,
          `| Severity | ${mdCell(issue.severity)} |`,
          `| Score | ${mdCell(issue.score)} |`,
          `| Status | ${mdCell(issue.status || "Open")} |`,
          `| Owner | ${mdCell(issue.owner || "Unassigned")} |`,
          `| Due Date | ${mdCell(issue.dueDate || "Not set")} |`,
          `| Source Rows | ${sourceLinks(issue.sourceIndexes)} |`,
          "",
          "### **Executive Summary**",
          listBlock(report.executiveSummary),
          "",
          `### **${observedHeading}**`,
          listBlock(report.observedCondition),
          "",
          "### **Key Evidence**",
          renderEvidenceRows(issue, report),
          "",
          "### **Safety Significance**",
          listBlock(report.safetySignificance),
          "",
          "### **Existing Controls / Mitigations**",
          listBlock(report.existingControlsMitigations),
          "",
          "### **Uncertainty / System Boundary**",
          listBlock(report.uncertaintySystemBoundary),
          "",
          "### **Recommended Engineering Action**",
          listBlock(report.recommendedEngineeringAction),
          "",
          "### **Recommended Verification**",
          listBlock(report.recommendedVerification),
          "",
          "### **Final Assessment**",
          listBlock(report.finalAssessment),
          `<!-- SAFETY_ISSUE_REPORT_END id="${issue.id}" -->`,
        ].join("\n");
      };
      const buildReportsMarkdown = (issueReports) => {
        const issueIndex = [
          "| Issue ID | Priority | Safety Issue | Score | Status | Source Rows |",
          "| --- | --- | --- | --- | --- | --- |",
          ...risksForReport.map((issue) => `| ${mdCell(shortId(issue.id, issue.id))} | ${issue.priority} | ${mdCell(issue.title)} | ${issue.score} | ${mdCell(issue.status || "Open")} | ${sourceLinks(issue.sourceIndexes)} |`),
        ].join("\n");
        const prioritySections = ["P0", "P1", "P2", "P3+"].map((priority) => {
          const reports = issueReports
            .filter(({ issue }) => issue.priority === priority)
            .map(({ issue, report }) => renderIssueReport(issue, report));
          return [
            `## **${priority} Safety Issues**`,
            "",
            reports.length ? reports.join("\n\n") : `_No ${priority} safety issue reports generated yet._`,
          ].join("\n");
        });
        return [
          "# **Safety Issue Reports**",
          "",
          `Project: **${activeProject?.name || "Untitled project"}**`,
          `Hazard Method: **${riskMethod}**`,
          "",
          "## **Issue Index**",
          "",
          issueIndex,
          "",
          ...prioritySections,
        ].join("\n\n").trim();
      };
      const issueReports = [];
      setGeneratingSafetyIssueReportIds(new Set(risksForReport.map((issue) => issue.id)));
      for (const issue of risksForReport) {
        const prompt = `
Create detailed content for one Safety Issue Report. Return strict JSON only.

Project: ${activeProject?.name || "Untitled project"}
Hazard method: ${riskMethod}

Safety issue:
${JSON.stringify({
  id: issue.id,
  title: issue.title,
  description: issue.description,
  likelihood: issue.likelihood,
  severity: issue.severity,
  score: issue.score,
  priority: issue.priority,
  status: issue.status,
  owner: issue.owner,
  dueDate: issue.dueDate,
  tags: issue.tags,
  sourceIndexes: issue.sourceIndexes,
  hazardEvidence: issue.evidence.map((item) => ({ sourceIndex: item.sourceIndex, cells: item.cells })),
}, null, 2)}

Required JSON schema:
{
  "executiveSummary": ["2-4 detailed bullets explaining the issue and priority"],
  "observedConditionType": "System or Implementation",
  "observedCondition": ["2-4 detailed bullets describing the observed condition using only supplied evidence"],
  "keyEvidenceRows": [
    {
      "sourceIndex": 1,
      "hazardUnsafeCondition": "specific hazard or unsafe condition",
      "affectedFunctionOrSubsystem": "affected function, subsystem, component, interface, or allocation",
      "controlActionOrFailureMode": "unsafe control action, failure mode, control action, or data/control flow",
      "whyThisMatters": "why this evidence supports the safety issue"
    }
  ],
  "safetySignificance": ["2-4 detailed bullets explaining credible safety impact and escalation path"],
  "existingControlsMitigations": ["2-4 bullets distinguishing explicit controls from inferred or missing controls"],
  "uncertaintySystemBoundary": ["2-4 bullets listing assumptions, unknowns, and boundary questions"],
  "recommendedEngineeringAction": ["3-5 concrete design, process, allocation, interface, or assurance actions"],
  "recommendedVerification": ["3-5 specific test, analysis, review, traceability, or acceptance evidence actions"],
  "finalAssessment": ["1-3 decisive bullets summarizing disposition and next review focus"]
}

Rules:
- Use the same level of detail for every section.
- Do not invent facts not supported by the safety issue or evidence.
- Preserve sourceIndex values exactly in keyEvidenceRows.
- Return only strict JSON. No Markdown. No code fences.
        `.trim();
        const response = await fetch(`${backendURL}/api/chat`, {
          method: "POST",
          ...buildAIAuthOpts({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: "Return only strict JSON. No prose or markdown." },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 2800,
          }),
        });
        if (!response.ok) throw new Error(`Safety issue report AI HTTP ${response.status}`);
        const parsed = parseJsonObjectFromText(extractAIText(await response.json())) || {};
        issueReports.push({ issue, report: normalizeIssueReport(issue, parsed) });
        const partialMarkdown = buildReportsMarkdown(issueReports);
        setRiskAssessmentReportMarkdown(partialMarkdown);
        setRiskReportMode("preview");
        setGeneratingSafetyIssueReportIds((prev) => {
          const next = new Set(prev);
          next.delete(issue.id);
          return next;
        });
        if (activeProjectId) saveProjectPatch(activeProjectId, { riskAssessmentReportMarkdown: partialMarkdown });
      }
      const markdown = buildReportsMarkdown(issueReports);
      setRiskAssessmentReportMarkdown(markdown);
      setRiskReportMode("preview");
      if (activeProjectId) saveProjectPatch(activeProjectId, { riskAssessmentReportMarkdown: markdown });
      return markdown;
    } catch (error) {
      console.error("[risk-assessment] AI safety issue report generation failed", error);
      window.alert(error?.message || "Unable to generate the Safety Issue Reports. Check your AI provider settings and try again.");
      return "";
    } finally {
      setIsGeneratingRiskAssessmentReport(false);
      setGeneratingSafetyIssueReportIds(new Set());
    }
  };

  const handleGenerateRiskAssessment = async () => {
    if (!canGenerateRiskAssessment || isGeneratingRiskAssessment || isGeneratingRiskAssessmentReport) return;
    setIsGeneratingRiskAssessment(true);
    try {
      const compactHazardRows = riskAssessmentSource.rows.map(({ sourceIndex, values }) => {
        const rowObject = { sourceIndex };
        riskAssessmentSource.headers.forEach((header, index) => {
          const value = values?.[index];
          if (value !== undefined && value !== null && String(value).trim()) {
            rowObject[header || `Column ${index + 1}`] = String(value).trim();
          }
        });
        return rowObject;
      });
      const prompt = `
You are consolidating a project hazard analysis into actionable safety issues for the risk assessment workspace.

Input source: ${riskAssessmentSource.source === "completed" ? "completed hazard analysis summary" : "generated draft hazard rows"}
Selected hazard method: ${riskMethod}
Total hazard rows supplied: ${compactHazardRows.length}

Complete hazard row list:
${JSON.stringify(compactHazardRows, null, 2)}

Create a complete consolidated safety issue register from the entire hazard row list:
- Analyze the full set of hazard rows together before deciding groups. Do not consolidate one row at a time.
- Use the entire supplied hazard list as the source of truth for determining which safety issues exist, how hazard rows group together, and how priorities should be assigned.
- Consolidate duplicate, overlapping, or closely related hazard rows into one safety issue when they share the same unsafe state, causal chain, affected function/subsystem, mitigation theme, requirement gap, or credible accident path.
- Do not copy the hazard table row-for-row unless the rows truly represent distinct safety issues.
- Preserve traceability by including sourceIndexes for every hazard row represented by each consolidated safety issue.
- Every supplied sourceIndex from the complete hazard row list must appear in exactly one consolidated safety issue unless the row is unusable; if unusable, include it in the closest issue and note the uncertainty in description.
- Use concise, engineering-specific safety issue titles.
- Put the hazardous condition, unsafe control action/failure mode, affected functions/subsystems, and mitigation/requirement rationale in description.
- Score likelihood and severity from 1 to 5 using the full hazard evidence across all source rows in the consolidated issue. Use 3 when evidence is insufficient.
- Prioritize comparatively across the complete list: P0-equivalent issues should have the highest severity/likelihood combination, P1/P2 should reflect meaningful but lower urgency, and P3+ should be lower-priority residual or localized concerns.
- Use status "Open" unless the evidence clearly indicates the issue is already mitigated or accepted.
- Keep owner and dueDate empty unless explicitly stated.
- Use tags for method, subsystem/allocation, hazard family, or mitigation theme.
- Return strict JSON only.

Return this schema:
[
  {
    "title": "Concise safety issue title",
    "description": "Consolidated safety issue description",
    "likelihood": 3,
    "severity": 4,
    "status": "Open",
    "owner": "",
    "dueDate": "",
    "tags": ["STPA", "Guidance"],
    "sourceIndexes": [1, 3]
  }
]
      `.trim();
      const response = await fetch(`${backendURL}/api/chat`, {
        method: "POST",
        ...buildAIAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "Return only strict JSON. No prose or markdown." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 2500,
        }),
      });
      if (!response.ok) throw new Error(`Risk assessment AI HTTP ${response.status}`);
      const content = extractAIText(await response.json());
      const generated = normalizeRiskAssessmentRows(parseJsonArrayFromText(content));
      if (!generated.length) throw new Error("The AI returned no usable safety issue rows.");
      const suppliedSourceIndexes = new Set(compactHazardRows.map((row) => Number(row.sourceIndex)).filter((index) => Number.isFinite(index) && index > 0));
      const coveredSourceIndexes = new Set(generated.flatMap((row) => getRiskSourceIndexes(row)));
      const missingSourceIndexes = Array.from(suppliedSourceIndexes).filter((index) => !coveredSourceIndexes.has(index));
      if (missingSourceIndexes.length) {
        console.warn("[risk-assessment] Consolidation response omitted hazard source rows", missingSourceIndexes);
      }
      const nextRows = applyStableRiskIds(riskRegister, generated);
      setRiskRegister(nextRows);
      if (activeProjectId) saveProjectPatch(activeProjectId, { riskRegister: nextRows });
      setIsGeneratingRiskAssessment(false);
      const markdown = await generateSafetyIssueReportsMarkdown(nextRows);
      if (activeProjectId && markdown) {
        saveProjectPatch(activeProjectId, {
          riskRegister: nextRows,
          riskAssessmentReportMarkdown: markdown,
        });
      }
    } catch (error) {
      console.error("[risk-assessment] AI risk assessment generation failed", error);
      window.alert(error?.message || "Unable to generate the risk assessment. Check your AI provider settings and try again.");
    } finally {
      setIsGeneratingRiskAssessment(false);
    }
  };

  const handleRunCodeArchitectureHazardAnalysis = async (
    selectedMethod = codeArchitectureHazardMethod,
    options = {}
  ) => {
    const selectedHazardGenerationMode =
      options.hazardGenerationMode || options.fhaGenerationMode || codeArchitectureHazardGenerationMode;
    const repoMeta = activeCodeArchitectureRepoMeta;
    const repoId = repoMeta.repoId || repoMeta.repoName || "repo";
    const reviewRepoId = activeCodeArchitectureRepo?.id || repoId;
    const cbaProjectId = activeCodeArchitectureProjectId || activeProjectId || "";
    const actId = `cba-hazard-${cbaProjectId || "default"}-${repoId}`;
    setCodeArchitectureHazardMethod(selectedMethod);
    setCodeArchitectureHazardGenerationMode(selectedHazardGenerationMode);
    setIsRunningCodeArchitectureHazard(true);
    setCodeArchitectureHazardProgress({
      step: 0,
      total: stepDescriptionsMap[selectedMethod]?.total || 9,
      message: "Starting code architecture hazard analysis...",
    });
    startActivity(actId, {
      title: "Running code architecture hazard analysis",
      step: 0,
      total: stepDescriptionsMap[selectedMethod]?.total || 9,
      message: "Starting analysis...",
    });

    try {
      const run = await runCodeArchitectureHazardAnalysis({
        cbaRows: cbaTableData,
        method: selectedMethod,
        hazardGenerationMode: selectedHazardGenerationMode,
        repoMeta,
        projectId: cbaProjectId,
        onPartialRunUpdate: (partialRun) => {
          setCodeArchitectureHazardRun(partialRun);
        },
        setProgress: (nextProgress) => {
          const step = nextProgress?.step || 0;
          const total = nextProgress?.total || stepDescriptionsMap[selectedMethod]?.total || 9;
          const message = nextProgress?.message
            || stepDescriptionsMap[selectedMethod]?.steps?.[step]
            || "Running code architecture hazard analysis...";
          setCodeArchitectureHazardProgress({ step, total, message });
          updateActivity(actId, {
            step,
            total,
            message,
            completed: nextProgress?.completed,
          });
        },
        onActivityUpdate: (patch) => {
          const step = patch?.step ?? 0;
          const total = patch?.total || stepDescriptionsMap[selectedMethod]?.total || 9;
          const message = patch?.message || "Running code architecture hazard analysis...";
          setCodeArchitectureHazardProgress({ step, total, message });
          updateActivity(actId, {
            step,
            total,
            message,
            completed: patch?.completed,
          });
        },
      });
      setCodeArchitectureHazardRun(run);
      if (Array.isArray(run?.generatedSheets?.Summary) && run.generatedSheets.Summary.length > 1) {
        try {
          const [columns, ...rows] = run.generatedSheets.Summary;
          await resultsReview.createReviewItems(createReviewItemsFromGeneratedTable({
            sourceFeature: "Code-Based Architecture Hazard Analysis",
            sourceMethod: selectedMethod,
            sourceRunId: run.id,
            artifactType: CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE,
            artifactId: `code-architecture-hazard-summary:${cbaProjectId || run.projectId || "default"}:${reviewRepoId}`,
            projectId: cbaProjectId || run.projectId || "default",
            rows,
            columns,
          }));
        } catch (error) {
          console.warn("[results-review] Failed to register code architecture hazard Summary review items", error);
        }
      }
      finishActivity(actId, "success", "Code architecture hazard analysis complete");
    } catch (error) {
      console.error("[code-architecture-hazard-analysis] Run failed", error);
      setCodeArchitectureHazardProgress((prev) => ({
        ...prev,
        message: error?.message || "Code architecture hazard analysis failed.",
      }));
      finishActivity(actId, "error", error?.message || "Code architecture hazard analysis failed");
    } finally {
      setIsRunningCodeArchitectureHazard(false);
    }
  };

  const handleClearCodeArchitectureHazardContents = async () => {
    const repoMeta = activeCodeArchitectureRepoMeta || {};
    const repoId = repoMeta.repoId || repoMeta.repoName || "repo";
    const projectId = activeCodeArchitectureProjectId || activeProjectId || "";
    const summaryCount = Math.max(0, (codeArchitectureHazardRun?.generatedSheets?.Summary?.length || 1) - 1);
    const confirmed = window.confirm(
      `Permanently clear code architecture hazard analysis contents${summaryCount ? ` (${summaryCount} summary row${summaryCount === 1 ? "" : "s"})` : ""} for this repository? This cannot be undone.`,
    );
    if (!confirmed) return;
    await deleteCodeArchitectureHazardRuns({ projectId, repoId });
    setCodeArchitectureHazardRun(null);
    setCodeArchitectureHazardProgress({
      step: 0,
      total: stepDescriptionsMap[codeArchitectureHazardMethod]?.total || 9,
      message: "",
    });
  };

  const handleDeleteCodeArchitectureHazardSummaryRow = useCallback(async (rowIndex) => {
    const targetIndex = Number(rowIndex);
    if (!Number.isFinite(targetIndex)) return;
    const summary = codeArchitectureHazardRun?.generatedSheets?.Summary;
    if (!Array.isArray(summary) || targetIndex < 0 || targetIndex >= summary.length - 1) return;
    const confirmed = window.confirm("Delete this hazard summary row? This cannot be undone.");
    if (!confirmed) return;
    const nextSummary = summary.filter((_, index) => index !== targetIndex + 1);
    const nextRun = {
      ...codeArchitectureHazardRun,
      generatedSheets: {
        ...codeArchitectureHazardRun.generatedSheets,
        Summary: nextSummary,
      },
      updatedAt: new Date().toISOString(),
    };
    await saveCodeArchitectureHazardRun(nextRun);
    setCodeArchitectureHazardRun(nextRun);
  }, [codeArchitectureHazardRun]);


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

  const exportHazardAnalysisCSV = () => {
    const hasCompletedSummary = Array.isArray(analysisResult?.Summary?.[0]);
    const headers = hasCompletedSummary
      ? analysisResult.Summary[0]
      : draftHazardHeaders;
    const rows2D = hasCompletedSummary
      ? filteredHazardSummaryRows.map(({ row }) => row)
      : filteredDraftHazardSummaryRows.map(({ row }) => row);
    if (!headers?.length || !rows2D.length) return;
    const escapeCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows2D].map(r => r.map(escapeCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const ts = new Date().toISOString().slice(0, 10);
    const filename = `hazard_analysis_${ts}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

const activeProjectFolder = useMemo(
  () => projectFolders.find((folder) => folder.id === activeProjectFolderId) || null,
  [projectFolders, activeProjectFolderId]
);

const folderDashboardPanels = useMemo(
  () => (activeProjectFolderId && folderDashboards[activeProjectFolderId]?.length
    ? folderDashboards[activeProjectFolderId]
    : getDefaultFolderDashboardPanels()),
  [activeProjectFolderId, folderDashboards]
);

const folderDashboardProjectIds = useMemo(() => {
  if (!activeProjectFolderId) return new Set();
  const folderIds = new Set([activeProjectFolderId]);
  let changed = true;
  while (changed) {
    changed = false;
    projectFolders.forEach((folder) => {
      if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
    });
  }
  return new Set(projects.filter((project) => folderIds.has(project.folderId || null)).map((project) => project.id));
}, [activeProjectFolderId, projectFolders, projects]);

const folderDashboardProjects = useMemo(
  () => projects.filter((project) => folderDashboardProjectIds.has(project.id)),
  [projects, folderDashboardProjectIds]
);

const folderDashboardRisks = useMemo(() => {
  const map = readProjectMap();
  return folderDashboardProjects.flatMap((project) => {
    const rows = Array.isArray(map?.[project.id]?.riskRegister) ? map[project.id].riskRegister : [];
    return rows.map((risk) => ({ ...risk, projectId: project.id, projectName: project.name }));
  });
}, [folderDashboardProjects]);

const folderDashboardRiskStatusData = useMemo(() => {
  const counts = { Open: 0, "In Progress": 0, Mitigated: 0, Accepted: 0, Closed: 0 };
  folderDashboardRisks.forEach((risk) => {
    const status = risk?.status || "Open";
    counts[status] = (counts[status] || 0) + 1;
  });
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}, [folderDashboardRisks]);

const folderDashboardActivity = useMemo(() => {
  const map = readProjectMap();
  return folderDashboardProjects
    .map((project) => {
      const data = map?.[project.id] || {};
      const risks = Array.isArray(data.riskRegister) ? data.riskRegister.length : 0;
      const functions = Array.isArray(data.responseRows) ? data.responseRows.length : 0;
      return {
        project,
        count: risks || functions,
        label: risks ? `${risks} risks` : `${functions} functions`,
        when: data._updatedAt || project.updatedAt || project.createdAt || "",
      };
    })
    .filter((entry) => entry.count || entry.when)
    .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
    .slice(0, 6);
}, [folderDashboardProjects]);

const projectsDashboardRows = useMemo(() => {
  const map = readProjectMap();
  return (projects || [])
    .map((project) => {
      const data = map?.[project.id] || {};
      const risks = Array.isArray(data.riskRegister) ? data.riskRegister : [];
      const functions = Array.isArray(data.responseRows) ? data.responseRows : [];
      const openRisks = risks.filter((risk) => (risk?.status || "Open") !== "Closed").length;
      const folder = project.folderId ? projectFolders.find((entry) => entry.id === project.folderId) : null;
      return {
        ...project,
        folderName: folder?.name || "Top level",
        riskCount: risks.length,
        openRisks,
        functionCount: functions.length,
        updatedAt: data._updatedAt || project.updatedAt || project.createdAt || "",
      };
    })
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}, [projects, projectFolders, activeProjectId, riskRegister]);

const projectsDashboardOpenRisks = useMemo(
  () => consoleRiskRegister.filter((risk) => (risk?.status || "Open") !== "Closed").length,
  [consoleRiskRegister]
);

const codeArchitectureDashboardRows = useMemo(() => {
  return (codeArchitectureProjects || [])
    .map((project) => {
      const folder = project.folderId ? codeArchitectureFolders.find((entry) => entry.id === project.folderId) : null;
      const repos = Array.isArray(project.repos) ? project.repos : [];
      const activeRepo = repos.find((entry) => entry.id === project.activeRepoId) || repos[0] || null;
      const isCurrentWorkspaceRepo = project.id === activeCodeArchitectureProject?.id && activeRepo?.id === activeCodeArchitectureRepo?.id;
      const meta = activeRepo ? (() => {
        try { return JSON.parse(localStorage.getItem(codeArchitectureMetaKey(project.id, activeRepo.id)) || "null"); }
        catch { return null; }
      })() : null;
      return {
        ...project,
        folderName: folder?.name || "Top level",
        repoCount: repos.length,
        activeRepoName: activeRepo?.repoName || activeRepo?.repoId || "No repo connected",
        rowCount: isCurrentWorkspaceRepo ? cbaTableData.length : Number(meta?.rowCount || 0),
        metricsSummary: codeArchitectureMetricsSummary(meta?.metrics),
        updatedAt: project.updatedAt || activeRepo?.updatedAt || project.createdAt || "",
      };
    })
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}, [codeArchitectureProjects, codeArchitectureFolders, activeCodeArchitectureProject, activeCodeArchitectureRepo, cbaTableData]);

const reviewCenterProjects = useMemo(() => ([
  ...projects,
  ...(codeArchitectureProjects || []).map((project) => ({
    id: project.id,
    name: `${project.name || "Code Architecture"} Code Architecture`,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    _reviewProjectType: "code-architecture",
  })),
]), [projects, codeArchitectureProjects]);

const hazardSummaryRowCount = useCallback((run) => (
  Array.isArray(run?.generatedSheets?.Summary)
    ? Math.max(0, run.generatedSheets.Summary.length - 1)
    : 0
), []);

const repoIdentityCandidatesForReview = useCallback((repo = {}) => (
  Array.from(new Set([
    repo?.id,
    repo?.repoId,
    repo?.repoName,
    [repo?.owner, repo?.repo].filter(Boolean).join("/"),
  ].map((value) => String(value || "").trim()).filter(Boolean)))
), []);

const safetyRemediationFindingCountForRepo = useCallback(async ({ projectId, repoIds }) => {
  try {
    const repoIdSet = new Set(repoIds);
    const state = await safetyRemediationStore.loadAll();
    return (state.safetyFindings || []).filter((finding) => {
      const findingProjectId = String(finding?.projectId || "").trim();
      const findingRepoId = String(finding?.repoId || finding?.repoName || "").trim();
      if (projectId && findingProjectId && findingProjectId !== String(projectId)) return false;
      if (repoIdSet.size && findingRepoId && !repoIdSet.has(findingRepoId)) return false;
      return true;
    }).length;
  } catch {
    return 0;
  }
}, []);

const analysisCountsForRepo = useCallback(async ({ project, repo }) => {
  const projectId = project?.id || "";
  const repoIds = repoIdentityCandidatesForReview(repo);
  const artifactCounts = {};
  await Promise.all([
    ARTIFACT_KINDS.SOFTWARE,
    ARTIFACT_KINDS.SYSTEM,
    ARTIFACT_KINDS.SUBSYSTEM,
    ARTIFACT_KINDS.DESIGN,
  ].map(async (kind) => {
    const counts = await Promise.all(repoIds.map(async (repoId) => {
      const rows = projectId && repoId ? await loadArtifactRowsAsync(kind, projectId, repoId) : [];
      return Array.isArray(rows) ? rows.length : 0;
    }));
    artifactCounts[kind] = Math.max(0, ...counts);
  }));
  const activeHazardMatches = codeArchitectureHazardRun && (
    repoIds.includes(String(codeArchitectureHazardRun.repoId || "").trim())
  );
  const hazardRun = activeHazardMatches && hazardSummaryRowCount(codeArchitectureHazardRun) > 0
    ? codeArchitectureHazardRun
    : (await Promise.all(repoIds.map((repoId) => (
      getLatestCodeArchitectureHazardRun({ projectId, repoId })
    )))).find((run) => hazardSummaryRowCount(run) > 0);
  const remediationCount = await safetyRemediationFindingCountForRepo({ projectId, repoIds });
  const traceabilityCount = Object.values(artifactCounts).reduce((sum, count) => sum + count, 0);
  return {
    [REVIEW_ANALYSIS_SECTIONS.HAZARD]: Math.max(hazardSummaryRowCount(hazardRun), remediationCount),
    [REVIEW_ANALYSIS_SECTIONS.SOFTWARE]: artifactCounts[ARTIFACT_KINDS.SOFTWARE] || 0,
    [REVIEW_ANALYSIS_SECTIONS.SYSTEM]: artifactCounts[ARTIFACT_KINDS.SYSTEM] || 0,
    [REVIEW_ANALYSIS_SECTIONS.SUBSYSTEM]: artifactCounts[ARTIFACT_KINDS.SUBSYSTEM] || 0,
    [REVIEW_ANALYSIS_SECTIONS.DESIGN]: artifactCounts[ARTIFACT_KINDS.DESIGN] || 0,
    [REVIEW_ANALYSIS_SECTIONS.TRACEABILITY]: traceabilityCount,
  };
}, [codeArchitectureHazardRun, hazardSummaryRowCount, repoIdentityCandidatesForReview, safetyRemediationFindingCountForRepo]);

const addAnalysisCounts = useCallback((base = {}, next = {}) => (
  CODE_ARCHITECTURE_REVIEW_ANALYSIS_OPTIONS.reduce((acc, option) => {
    acc[option.key] = Number(base[option.key] || 0) + Number(next[option.key] || 0);
    return acc;
  }, {})
), []);

const buildCodeArchitectureReviewTargetOptions = useCallback(async () => {
  const targets = [];
  for (const project of codeArchitectureProjects || []) {
    const reposWithRows = [];
    let rowCount = 0;
    let analysisCounts = {};
    for (const projectRepo of project.repos || []) {
      const activeRows = project.id === activeCodeArchitectureProject?.id && projectRepo.id === activeCodeArchitectureRepo?.id
        ? cbaTableData
        : null;
      const rows = Array.isArray(activeRows) && activeRows.length
        ? activeRows
        : await readCbaRowsFromIndexedDB(codeArchitectureRowsKey(project.id, projectRepo.id));
      if (!Array.isArray(rows) || rows.length === 0) continue;
      reposWithRows.push(projectRepo);
      rowCount += rows.length;
      analysisCounts = addAnalysisCounts(analysisCounts, await analysisCountsForRepo({ project, repo: projectRepo }));
    }
    if (reposWithRows.length) {
      const folder = project.folderId
        ? codeArchitectureFolders.find((entry) => entry.id === project.folderId) || null
        : null;
      targets.push({
        id: `project:${project.id}`,
        type: "project",
        label: project.name || "Code Architecture Project",
        description: `${reposWithRows.length} analyzed repo${reposWithRows.length === 1 ? "" : "s"} · ${rowCount} architecture row${rowCount === 1 ? "" : "s"}`,
        available: true,
        project,
        folder,
        repos: reposWithRows,
        rowCount,
        analysisCounts,
      });
    }
  }

  for (const folder of codeArchitectureFolders || []) {
    const crossRepoRows = await loadArtifactRowsAsync(CROSS_REPO_ARCHITECTURE_KIND, folder.id, "folder");
    const crossRepoRowCount = Array.isArray(crossRepoRows) ? crossRepoRows.length : 0;
    const folderProjects = getCbaProjectsInFolderTree(codeArchitectureProjects, codeArchitectureFolders, folder.id);
    let analysisCounts = {};
    const analyzedProjectIds = new Set();
    let analyzedRepoCount = 0;
    let functionalRowCount = 0;
    for (const project of folderProjects) {
      for (const projectRepo of project.repos || []) {
        const rows = await readCbaRowsFromIndexedDB(codeArchitectureRowsKey(project.id, projectRepo.id));
        if (!Array.isArray(rows) || rows.length === 0) continue;
        analyzedProjectIds.add(project.id);
        analyzedRepoCount += 1;
        functionalRowCount += rows.length;
        analysisCounts = addAnalysisCounts(analysisCounts, await analysisCountsForRepo({ project, repo: projectRepo }));
      }
    }
    const generatedMeta = getCrossRepoGeneratedMeta(folder.id);
    const hasCrossRepoArchitecture = crossRepoRowCount > 0 || Boolean(generatedMeta?.generatedAt) || analyzedProjectIds.size >= 2;
    if (!hasCrossRepoArchitecture) continue;
    const crossRepoHazardRun = await getLatestCodeArchitectureHazardRun({ projectId: folder.id, repoId: "folder" });
    analysisCounts[REVIEW_ANALYSIS_SECTIONS.HAZARD] = Math.max(
      Number(analysisCounts[REVIEW_ANALYSIS_SECTIONS.HAZARD] || 0),
      hazardSummaryRowCount(crossRepoHazardRun)
    );
    const rowDescription = crossRepoRowCount
      ? `${crossRepoRowCount} cross-repo row${crossRepoRowCount === 1 ? "" : "s"}`
      : `${functionalRowCount} architecture row${functionalRowCount === 1 ? "" : "s"} across ${analyzedRepoCount} repo${analyzedRepoCount === 1 ? "" : "s"}`;
    targets.push({
      id: `cross-repo:${folder.id}`,
      type: "cross-repo",
      label: `${folder.name || "Folder"} Cross-Repo Architecture`,
      description: `${analyzedProjectIds.size || folderProjects.length} project${(analyzedProjectIds.size || folderProjects.length) === 1 ? "" : "s"} · ${rowDescription}`,
      available: true,
      folder,
      rowCount: crossRepoRowCount || functionalRowCount,
      analysisCounts,
    });
  }

  return targets;
}, [
  activeCodeArchitectureProject,
  activeCodeArchitectureRepo,
  addAnalysisCounts,
  analysisCountsForRepo,
  cbaTableData,
  codeArchitectureFolders,
  codeArchitectureProjects,
  hazardSummaryRowCount,
]);

const defaultCodeArchitectureReviewAppName = useCallback(({ project, repo, targets } = {}) => {
  if (Array.isArray(targets) && targets.length === 1) {
    return `${targets[0].label || "Code Architecture"} Review`;
  }
  if (Array.isArray(targets) && targets.length > 1) {
    return `${targets.length} Code Architecture Reviews`;
  }
  const projectName = String(project?.name || "Code Architecture").trim();
  const repoName = String(repo?.repoName || repo?.repoId || repo?.id || "").trim();
  return `${[projectName, repoName].filter(Boolean).join(" - ")} Review`;
}, []);

const requestCodeArchitectureReviewAnalysisSelection = useCallback((targetOptions, defaultAppName) => (
  new Promise((resolve) => {
    const selectedTargetIds = targetOptions.filter((option) => option.available !== false).map((option) => option.id);
    const options = analysisOptionsForReviewTargets(targetOptions, selectedTargetIds);
    const selectedKeys = options.filter((option) => option.available).map((option) => option.key);
    codeArchitectureReviewAnalysisSelectionRef.current = resolve;
    setCodeArchitectureReviewAnalysisModal({
      targetOptions,
      selectedTargetIds,
      options,
      selectedKeys,
      appName: defaultAppName || "Code Architecture Review",
      reviewAppTarget: "mac",
      destinationDirectory: "",
    });
  })
), []);

const handleExportCodeArchitectureReviewPackage = useCallback(async () => {
  if (isGeneratingCodeArchitectureReviewApp) return;
  let activityId = null;
  try {
    const targetOptions = await buildCodeArchitectureReviewTargetOptions();
    const availableTargets = targetOptions.filter((target) => target.available !== false);
    if (!availableTargets.length) {
      alert("Analyze at least one Code-Based Architecture project or cross-repo architecture before exporting a review app.");
      return;
    }
    const selection = await requestCodeArchitectureReviewAnalysisSelection(
      targetOptions,
      defaultCodeArchitectureReviewAppName({ targets: availableTargets })
    );
    if (!selection) return;
    const selectedTargetIds = new Set(selection.selectedTargetIds || []);
    const selectedTargets = targetOptions.filter((target) => target.available !== false && selectedTargetIds.has(target.id));
    if (!selectedTargets.length) return;
    const isHostedReviewPackager = isHostedCodeArchitectureReviewPackagerConfigured();
    const analysisOptions = analysisOptionsForReviewTargets(targetOptions, selectedTargets.map((target) => target.id));
    const selectedAnalysisKeys = selection.selectedKeys || [];
    const appDisplayName = selection.appName || defaultCodeArchitectureReviewAppName({ targets: selectedTargets });
    const reviewAppTarget = selection.reviewAppTarget || "mac";
    const destinationDirectory = isHostedReviewPackager ? "" : String(selection.destinationDirectory || "").trim();
    const includedAnalysis = Object.fromEntries(
      analysisOptions.map((option) => [option.key, option.available && selectedAnalysisKeys.includes(option.key)])
    );
    const primaryProjectTarget = selectedTargets.find((target) => target.type === "project");
    const primaryProject = primaryProjectTarget?.project || activeCodeArchitectureProject || codeArchitectureProjects[0] || null;
    const primaryRepo = primaryProjectTarget?.repos?.[0] || activeCodeArchitectureRepo || null;
    setIsGeneratingCodeArchitectureReviewApp(true);
    activityId = `code-architecture-review-app:${Date.now()}`;
    startActivity(activityId, {
      title: `Generating ${appDisplayName}`,
      step: 2,
      total: 100,
      message: "Collecting review package data...",
    });
    const selectedProjectIds = new Set(selectedTargets.flatMap((target) => (
      target.type === "project"
        ? [target.project?.id]
        : getCbaProjectsInFolderTree(codeArchitectureProjects, codeArchitectureFolders, target.folder?.id).map((entry) => entry.id)
    )).filter(Boolean));
    const selectedFolderIds = new Set(selectedTargets
      .filter((target) => target.type === "cross-repo" && target.folder?.id)
      .map((target) => target.folder.id));
    const relevantReviewItems = (resultsReview.reviewItems || []).filter((item) => {
      const text = [item.id, item.artifactId, item.sourceRunId, item.projectId]
        .filter(Boolean)
        .join(" ");
      return (
        selectedProjectIds.has(item.projectId) ||
        selectedFolderIds.has(item.projectId) ||
        Array.from(selectedProjectIds).some((projectId) => text.includes(projectId)) ||
        Array.from(selectedFolderIds).some((folderId) => text.includes(folderId))
      );
    });
    const reviewTargets = selectedTargets.map((target) => (
      target.type === "cross-repo"
        ? {
          type: "cross-repo",
          folder: target.folder,
          folders: codeArchitectureFolders,
          projects: codeArchitectureProjects,
        }
        : {
          type: "project",
          project: target.project,
          folder: target.folder,
          repos: target.repos,
          activeRepo: target.project?.id === activeCodeArchitectureProject?.id ? activeCodeArchitectureRepo : target.repos?.[0] || null,
          cbaRows: target.project?.id === activeCodeArchitectureProject?.id ? cbaTableData : null,
        }
    ));
    const reviewPackage = await collectCodeArchitectureReviewPackage({
      project: primaryProject,
      folder: primaryProjectTarget?.folder || null,
      repo: primaryRepo,
      repos: primaryProjectTarget?.repos || [],
      reviewTargets,
      hazardRun: codeArchitectureHazardRun,
      appDisplayName,
      reviewAppTarget,
      includedAnalysis,
      reviewItems: relevantReviewItems,
      uiState: {
        activeWorkspaceTab: codeArchitectureWorkspaceTab,
        hazardRemediationTab,
      },
    });
    updateActivity(activityId, {
      step: 8,
      total: 100,
      message: `Sending review package to ${isHostedReviewPackager ? "hosted" : "local"} app builder...`,
    });
    await downloadCodeArchitectureReviewApp(reviewPackage, {
      reviewAppTarget,
      destinationDirectory,
      onProgress: (job) => {
        const percent = Math.max(0, Math.min(100, Number(job?.percent || 0)));
        const counts = job?.counts || null;
        const countsText = counts
          ? ` ${counts.totalItems || 0} items across ${counts.repositories || 0} repo${counts.repositories === 1 ? "" : "s"}.`
          : "";
        updateActivity(activityId, {
          step: percent,
          total: 100,
          message: `${job?.message || "Generating review app..."}${countsText}`,
        });
      },
    });
    finishActivity(activityId, "success", `${appDisplayName} downloaded.`);
  } catch (error) {
    if (activityId) {
      finishActivity(activityId, "error", error?.message || "Failed to generate Code-Based Architecture review app.");
    }
    alert(error?.message || "Failed to generate Code-Based Architecture review app.");
  } finally {
    setIsGeneratingCodeArchitectureReviewApp(false);
  }
}, [
  activeCodeArchitectureProject,
  activeCodeArchitectureRepo,
  buildCodeArchitectureReviewTargetOptions,
  cbaTableData,
  defaultCodeArchitectureReviewAppName,
  codeArchitectureProjects,
  codeArchitectureFolders,
  codeArchitectureHazardRun,
  codeArchitectureWorkspaceTab,
  finishActivity,
  hazardRemediationTab,
  isGeneratingCodeArchitectureReviewApp,
  requestCodeArchitectureReviewAnalysisSelection,
  resultsReview.reviewItems,
  startActivity,
  updateActivity,
]);

const codeArchitectureFolderProjectIds = useMemo(() => {
  if (!activeCodeArchitectureFolderId) return new Set();
  const folderIds = new Set([activeCodeArchitectureFolderId]);
  let changed = true;
  while (changed) {
    changed = false;
    codeArchitectureFolders.forEach((folder) => {
      if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
    });
  }
  return new Set(codeArchitectureProjects.filter((project) => folderIds.has(project.folderId || null)).map((project) => project.id));
}, [activeCodeArchitectureFolderId, codeArchitectureFolders, codeArchitectureProjects]);

const codeArchitectureFolderProjects = useMemo(
  () => codeArchitectureDashboardRows.filter((project) => codeArchitectureFolderProjectIds.has(project.id)),
  [codeArchitectureDashboardRows, codeArchitectureFolderProjectIds]
);

const updateFolderDashboardPanels = (updater) => {
  if (!activeProjectFolderId) return;
  setFolderDashboards((prev) => {
    const current = prev[activeProjectFolderId]?.length ? prev[activeProjectFolderId] : getDefaultFolderDashboardPanels();
    return { ...prev, [activeProjectFolderId]: updater(current) };
  });
};

const addFolderDashboardPanel = () => {
  updateFolderDashboardPanels((current) => [...current, makeFolderDashboardPanel(newFolderDashboardPanelType)]);
};

const removeFolderDashboardPanel = (panelId) => {
  updateFolderDashboardPanels((current) => current.filter((panel) => panel.id !== panelId));
};

const moveFolderDashboardPanel = (panelId, direction) => {
  updateFolderDashboardPanels((current) => {
    const index = current.findIndex((panel) => panel.id === panelId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
    const next = [...current];
    const [panel] = next.splice(index, 1);
    next.splice(nextIndex, 0, panel);
    return next;
  });
};

const updateFolderDashboardPanel = (panelId, patch) => {
  updateFolderDashboardPanels((current) =>
    current.map((panel) => panel.id === panelId ? { ...panel, ...patch } : panel)
  );
};

const renderFolderDashboardPanel = (panel, index) => {
  const panelClass = panel.size === "wide" ? "lg:col-span-2" : "";
  const removable = folderDashboardPanels.length > 1;

  const body = (() => {
    if (panel.type === "projectList") {
      return (
        <div className="space-y-2">
          {folderDashboardProjects.length === 0 ? (
            <div className="text-sm text-gray-500">No projects in this folder yet.</div>
          ) : folderDashboardProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => { setActiveProjectId(project.id); setActiveProjectFolderId(null); }}
              className="w-full rounded-lg border border-gray-100 px-3 py-2 text-left hover:bg-gray-50"
            >
              <div className="text-sm font-medium text-gray-900 truncate">{project.name}</div>
              <div className="text-[11px] text-gray-500">{project.createdAt ? `Created ${new Date(project.createdAt).toLocaleDateString()}` : "Project"}</div>
            </button>
          ))}
        </div>
      );
    }

    if (panel.type === "riskStatus") {
      const hasRisks = folderDashboardRisks.length > 0;
      return hasRisks ? (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={folderDashboardRiskStatusData} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={110} />
              <Tooltip />
              <Bar dataKey="value">
                {folderDashboardRiskStatusData.map((_, i) => (
                  <Cell key={i} fill={['#2D7DFE', '#F59E0B', '#10B981', '#7A37FF', '#EF4444'][i % 5]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-sm text-gray-500">No risks in these projects yet.</div>
      );
    }

    if (panel.type === "recentActivity") {
      return (
        <div className="space-y-3">
          {folderDashboardActivity.length === 0 ? (
            <div className="text-sm text-gray-500">No recent project updates yet.</div>
          ) : folderDashboardActivity.map((entry) => (
            <button
              key={entry.project.id}
              type="button"
              onClick={() => { setActiveProjectId(entry.project.id); setActiveProjectFolderId(null); }}
              className="w-full text-left text-sm"
            >
              <span className="font-medium">{entry.project.name}</span>
              {entry.label && <span className="text-gray-500"> · {entry.label}</span>}
              {entry.when && <div className="text-[11px] text-gray-400">{new Date(entry.when).toLocaleString()}</div>}
            </button>
          ))}
        </div>
      );
    }

    const openRisks = folderDashboardRisks.filter((risk) => (risk?.status || "Open") !== "Closed").length;
    const subfolderCount = projectFolders.filter((folder) => folder.parentId === activeProjectFolderId).length;
    return (
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-2xl font-semibold">{folderDashboardProjects.length}</div>
          <div className="text-xs text-gray-500">Projects</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">{subfolderCount}</div>
          <div className="text-xs text-gray-500">Subfolders</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">{openRisks}</div>
          <div className="text-xs text-gray-500">Open risks</div>
        </div>
      </div>
    );
  })();

  return (
    <section key={panel.id} className={`rounded-xl border border-gray-200 bg-white p-4 ${panelClass}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm font-medium"
          value={panel.title}
          onChange={(e) => updateFolderDashboardPanel(panel.id, { title: e.target.value })}
          aria-label="Panel title"
        />
        <select
          className="rounded-md border border-gray-200 px-2 py-1 text-xs"
          value={panel.type}
          onChange={(e) => {
            const option = FOLDER_DASHBOARD_PANEL_TYPES.find((entry) => entry.type === e.target.value);
            updateFolderDashboardPanel(panel.id, { type: e.target.value, title: option?.label || panel.title });
          }}
          aria-label="Panel type"
        >
          {FOLDER_DASHBOARD_PANEL_TYPES.map((option) => (
            <option key={option.type} value={option.type}>{option.label}</option>
          ))}
        </select>
        <select
          className="rounded-md border border-gray-200 px-2 py-1 text-xs"
          value={panel.size}
          onChange={(e) => updateFolderDashboardPanel(panel.id, { size: e.target.value })}
          aria-label="Panel size"
        >
          <option value="normal">Normal</option>
          <option value="wide">Wide</option>
        </select>
        <button type="button" className="rounded-md border p-1 text-gray-600 hover:bg-gray-50" onClick={() => moveFolderDashboardPanel(panel.id, -1)} disabled={index === 0} title="Move panel up">
          <ArrowUp size={14} />
        </button>
        <button type="button" className="rounded-md border p-1 text-gray-600 hover:bg-gray-50" onClick={() => moveFolderDashboardPanel(panel.id, 1)} disabled={index === folderDashboardPanels.length - 1} title="Move panel down">
          <ArrowDown size={14} />
        </button>
        <button type="button" className="rounded-md border p-1 text-red-500 hover:bg-red-50 disabled:opacity-40" onClick={() => removeFolderDashboardPanel(panel.id)} disabled={!removable} title="Remove panel">
          <Trash2 size={14} />
        </button>
      </div>
      {body}
    </section>
  );
};

// Hint the Copilot about repo/baseline context (optional keys)
const projectHint = useMemo(() => ({
  owner: localStorage.getItem("repoOwner") || undefined,
  repo: localStorage.getItem("repoName") || undefined,
  baselineKey: localStorage.getItem("activeBaselineKey") || undefined,
}), [activeProjectId]);

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

    // Gate the whole app
    if (gate.phase === 'checking') return null;

    if (gate.phase === 'onboarding') {
      const providerLabel = getAIProviderLabel(aiProviderInput);
      return (
        <div className="min-h-screen flex items-center justify-center bg-white p-6">
          <div className="w-full max-w-md border rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold">Choose your AI provider</h1>
                <p className="text-sm text-gray-500">
                  Pick one provider at a time. Your API key is saved encrypted and you can change it later in Settings.
                </p>
              </div>
              <button className="text-xs text-gray-600 underline" onClick={signOut}>Sign out</button>
            </div>

            {gate.error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                We signed you in, but loading AI provider setup hit an error: {gate.error}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">AI provider</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm bg-white"
                value={aiProviderInput}
                onChange={(e) => setAiProviderInput(e.target.value)}
              >
                {AI_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <input
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder={getProviderKeyPlaceholder(aiProviderInput)}
              value={providerKeyInput}
              onChange={e => setProviderKeyInput(e.target.value)}
            />
            <p className="text-xs text-gray-500">{getProviderKeyHelpText(aiProviderInput)}</p>
            <button
              onClick={saveUserAIProvider}
              disabled={savingKey}
              className="w-full px-3 py-2 rounded bg-[#2D7DFE] text-white text-sm disabled:opacity-60"
            >
              {savingKey ? 'Saving…' : `Save ${providerLabel} key`}
            </button>

            {gate.last4 && (
              <p className="text-xs text-gray-500">
                Existing {gate.provider ? getAIProviderLabel(gate.provider) : "AI provider"} key on file (last 4): <b>{gate.last4}</b>
              </p>
            )}
          </div>
        </div>
      );
    }

  const hazardAnalysisControls = responseRows.length > 0 ? (
    <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
      <div className="flex items-center space-x-2">
        <label className="text-sm text-gray-700">Method:</label>
        <select
          className="text-sm border rounded px-2 py-1"
          value={riskMethod}
          onChange={(e) => handleProjectRiskMethodChange(e.target.value)}
          disabled={isAnalyzing || draftHazardGeneratingIndex !== null}
        >
          <option value="STPA">STPA</option>
          <option value="STPA-Textbook">STPA (standard/detailed)</option>
          <option value="FMEA-Textbook">FMEA</option>
          <option value="HARA">HARA</option>
          <option value="FHA">FHA</option>
          <option value="WhatIf-Textbook">What-if</option>
        </select>
      </div>
      {riskMethod === "STPA-Textbook" && (
        <select
          className="max-w-full text-sm border rounded px-2 py-1"
          value={projectRiskProfileGenerationMode}
          onChange={(e) => handleProjectRiskProfileGenerationModeChange(e.target.value)}
          disabled={isAnalyzing || draftHazardGeneratingIndex !== null}
          aria-label="STPA generation mode"
        >
          {CODE_ARCHITECTURE_HAZARD_GENERATION_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} - {option.description}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => handleRunAnalysis(riskMethod)}
        className="px-3 py-2 text-white rounded bg-[#2D7DFE] hover:bg-[#1E61D6] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isAnalyzing || draftHazardGeneratingIndex !== null}
      >
        {isAnalyzing ? 'Developing risk profile...' : 'Develop risk profile'}
      </button>
      <button
        type="button"
        onClick={exportHazardAnalysisCSV}
        className="px-3 py-2 text-white rounded bg-[#10B981] hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={
          (Array.isArray(analysisResult?.Summary?.[0])
            ? filteredHazardSummaryRows.length
            : filteredDraftHazardSummaryRows.length) === 0
        }
        title="Export the visible hazard analysis table rows as CSV"
      >
        Export CSV
      </button>
    </div>
  ) : null;

  return (
<>
      {/* Fixed top nav (56px tall) */}
      <div className="fixed inset-x-0 top-0 z-40">
              <TopNavBar
  userInitials={(gate.user?.email || 'U?').slice(0,2).toUpperCase()}
  onSearch={(q) => {}}
  onCreate={() => {
    if (!guardNewProjectIntent()) return;
    setSection('projects');
    setShowNewProject(true);
  }}
  onOpenSettings={() => setShowSettingsModal(true)}
  onOpenReadme={() => setShowReadmeModal(true)}
  onSignOut={signOut}
  rightActions={
    <div className="flex items-center gap-2 shrink-0">
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
        <div className={`fixed top-14 right-0 bottom-0 z-[1000] border-l bg-white shadow-2xl flex flex-col transition-[width] duration-200 ease-out ${
          dockExpanded ? "w-[min(760px,100vw)]" : "w-[380px] md:w-[420px]"
        }`}>
          {/* Dock header */}
          <div className="h-10 border-b flex items-center justify-between px-2 text-xs">
            <div className="font-semibold">Collaborator</div>
            <div className="flex items-center gap-1">
  <button
    className="px-2 py-1 rounded hover:bg-gray-100"
    title={dockExpanded ? "Collapse Collaborator" : "Expand Collaborator"}
    aria-pressed={dockExpanded}
    onClick={() => setDockExpanded((expanded) => !expanded)}
  >
    {dockExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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
                appFocus={getCollaboratorAppFocus()}
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
            Collaborator docked (collapsed)
            </div>
          )}
        </div>
      ) : null,
      document.body
    )}

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

        <div className="px-3 py-2 flex flex-col gap-1">
<div className="order-3">
  <NavItem
    icon={ClipboardCheck}
    label="Review Center"
    active={section === 'review-center'}
    onClick={() => setSection('review-center')}
  />
</div>

<div className="order-1">
  <div className={`w-full ${isSidebarOpen ? '' : 'flex justify-center'}`}>
    <div className={`flex items-center ${isSidebarOpen ? 'gap-1' : ''} w-full min-w-0`}>
      <div className="min-w-0 flex-1">
        <NavItem
          icon={GitCommit}
          label={isSidebarOpen ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
              <span className={`shrink-0 transition-transform ${isCodeArchitectureProjectsOpen ? 'rotate-90' : ''}`}>
                <ChevronRight size={14} />
              </span>
              <span className="min-w-0 truncate">Code-Based Architecture</span>
              {codeArchitectureProjects.length > 0 && (
                <span className="shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                  {codeArchitectureProjects.length}
                </span>
              )}
            </span>
          ) : 'Code-Based Architecture'}
          active={section === 'code-architecture'}
          onClick={() => {
            setSection('code-architecture');
            setActiveCodeArchitectureProjectId(null);
            setActiveCodeArchitectureFolderId(null);
            setIsCodeArchitectureProjectsOpen((open) => !open);
          }}
        />
      </div>
      <button
        className={`rounded-lg hover:bg-gray-100 text-gray-700 ${isSidebarOpen ? 'p-1.5 shrink-0' : 'w-0 p-0 overflow-hidden opacity-0 pointer-events-none shrink'}`}
        title="New code architecture project"
        aria-label="New code architecture project"
        onClick={() => {
          setSection('code-architecture');
          setNewCodeArchitectureTargetFolderId(null);
          setNewCodeArchitectureError('');
          setShowNewCodeArchitectureProject(true);
        }}
      >
        <Plus size={16} className="block" />
      </button>
      <button
        className={`rounded-lg hover:bg-gray-100 text-gray-700 ${isSidebarOpen ? 'p-1.5 shrink-0' : 'w-0 p-0 overflow-hidden opacity-0 pointer-events-none shrink'}`}
        title="New code architecture folder"
        aria-label="New code architecture folder"
        onClick={() => {
          setSection('code-architecture');
          setNewCodeArchitectureFolderParentId(null);
          setNewCodeArchitectureFolderError('');
          setShowNewCodeArchitectureFolder(true);
        }}
      >
        <FolderPlus size={16} className="block" />
      </button>
    </div>
  </div>

  {isSidebarOpen && isCodeArchitectureProjectsOpen && (codeArchitectureProjects.length > 0 || codeArchitectureFolders.length > 0) && (
    <div
      className={`mt-1 ml-9 pr-1 max-h-56 overflow-auto space-y-1 rounded-lg transition-colors ${
        draggingCodeArchitectureProjectId && dragOverCodeArchitectureFolderId === "__root__" ? "bg-blue-50 ring-1 ring-[#2D7DFE]" : ""
      }`}
      role="list"
      aria-label="Code-Based Architecture projects"
      onDragOver={(e) => {
        if (!draggingCodeArchitectureProjectId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverCodeArchitectureFolderId("__root__");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCodeArchitectureFolderId(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const projectId = e.dataTransfer.getData("application/x-xhandle-cba-project-id") || draggingCodeArchitectureProjectId;
        moveCodeArchitectureProjectToFolder(projectId, null);
      }}
    >
      {(() => {
        const foldersByParent = new Map();
        const projectsByFolder = new Map();
        codeArchitectureFolders.forEach((folder) => {
          const key = folder.parentId || null;
          if (!foldersByParent.has(key)) foldersByParent.set(key, []);
          foldersByParent.get(key).push(folder);
        });
        codeArchitectureProjects.forEach((project) => {
          const key = project.folderId || null;
          if (!projectsByFolder.has(key)) projectsByFolder.set(key, []);
          projectsByFolder.get(key).push(project);
        });
        foldersByParent.forEach((items) => items.sort((a, b) => a.name.localeCompare(b.name)));

        const renderCbaProject = (project, depth = 0) => (
          <div
            key={project.id}
            className={`group relative rounded-lg ${draggingCodeArchitectureProjectId === project.id ? 'opacity-50' : ''}`}
            draggable={editingCodeArchitectureProjectId !== project.id}
            onDragStart={(e) => {
              setDraggingCodeArchitectureProjectId(project.id);
              setDragOverCodeArchitectureFolderId(null);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-xhandle-cba-project-id", project.id);
              e.dataTransfer.setData("text/plain", project.name || "Code architecture project");
            }}
            onDragEnd={() => {
              setDraggingCodeArchitectureProjectId(null);
              setDragOverCodeArchitectureFolderId(null);
            }}
          >
            <div className="flex items-center justify-between" style={{ paddingLeft: depth * 12 }}>
              {editingCodeArchitectureProjectId === project.id ? (
                <div className="flex-1 flex items-center gap-2 px-2 py-1.5">
                  <input
                    autoFocus
                    className="flex-1 bg-white border rounded px-2 py-1 text-sm min-w-0"
                    value={editingCodeArchitectureProjectName}
                    onChange={(e) => { setEditingCodeArchitectureProjectName(e.target.value); if (codeArchitectureRenameError) setCodeArchitectureRenameError(''); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitCodeArchitectureRename(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelCodeArchitectureRename(); }
                    }}
                    placeholder="Project name"
                  />
                  <button onClick={(e) => { e.stopPropagation(); commitCodeArchitectureRename(); }} className="text-sm text-[#2D7DFE] hover:underline">Save</button>
                  <button onClick={(e) => { e.stopPropagation(); cancelCodeArchitectureRename(); }} className="text-sm text-gray-600 hover:underline">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setSection('code-architecture');
                    setActiveCodeArchitectureProjectId(project.id);
                    setActiveCodeArchitectureFolderId(null);
                  }}
                  className={`flex-1 text-left px-2 py-1.5 rounded-lg truncate transition-colors ${
                    activeCodeArchitectureProjectId === project.id ? 'bg-[#ECEEFF] text-[#0F0F12]' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  title={project.name}
                >
                  {project.name}
                </button>
              )}
              {editingCodeArchitectureProjectId !== project.id && (
                <button
                  ref={(el) => (codeArchitectureProjectMenuAnchorEls.current[project.id] = el)}
                  data-cba-project-menu-trigger="true"
                  onMouseDown={(e) => { e.stopPropagation(); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenCodeArchitectureFolderMenuId(null);
                    setOpenCodeArchitectureProjectMenuId((current) => current === project.id ? null : project.id);
                  }}
                  className="ml-1 p-1.5 rounded hover:bg-gray-100 text-gray-600 invisible group-hover:visible"
                  title="More options"
                >
                  <MoreVertical size={16} />
                </button>
              )}
            </div>
            {openCodeArchitectureProjectMenuId === project.id && (
              <ProjectMenuPortal
                anchorEl={codeArchitectureProjectMenuAnchorEls.current[project.id]}
                setPortalRef={(el) => (codeArchitectureProjectMenuPortalRefs.current[project.id] = el)}
                onRename={() => { setOpenCodeArchitectureProjectMenuId(null); beginRenameCodeArchitectureProject(project); }}
                onDelete={() => { setOpenCodeArchitectureProjectMenuId(null); deleteCodeArchitectureProject(project.id); }}
              />
            )}
            {editingCodeArchitectureProjectId === project.id && codeArchitectureRenameError && (
              <div className="px-2 text-[11px] text-red-600 mt-1">{codeArchitectureRenameError}</div>
            )}
          </div>
        );

        const renderCbaFolder = (folder, depth = 0) => {
          const childFolders = foldersByParent.get(folder.id) || [];
          const childProjects = projectsByFolder.get(folder.id) || [];
          const isOpen = openCodeArchitectureFolderIds[folder.id] !== false;
          return (
            <div
              key={folder.id}
              className={`relative rounded-lg transition-colors ${
                draggingCodeArchitectureProjectId && dragOverCodeArchitectureFolderId === folder.id ? "bg-blue-50 ring-1 ring-[#2D7DFE]" : ""
              }`}
              onDragOver={(e) => {
                if (!draggingCodeArchitectureProjectId) return;
                e.preventDefault();
                e.stopPropagation();
                setDragOverCodeArchitectureFolderId(folder.id);
                if (!isOpen) setOpenCodeArchitectureFolderIds((prev) => ({ ...prev, [folder.id]: true }));
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCodeArchitectureFolderId(null);
              }}
              onDrop={(e) => {
                if (!draggingCodeArchitectureProjectId) return;
                e.preventDefault();
                e.stopPropagation();
                const projectId = e.dataTransfer.getData("application/x-xhandle-cba-project-id") || draggingCodeArchitectureProjectId;
                moveCodeArchitectureProjectToFolder(projectId, folder.id);
              }}
            >
              <div className="group flex items-center justify-between" style={{ paddingLeft: depth * 12 }}>
                {editingCodeArchitectureFolderId === folder.id ? (
                  <div className="flex-1 flex items-center gap-2 px-2 py-1.5">
                    <input
                      autoFocus
                      className="flex-1 bg-white border rounded px-2 py-1 text-sm min-w-0"
                      value={editingCodeArchitectureFolderName}
                      onChange={(e) => { setEditingCodeArchitectureFolderName(e.target.value); if (codeArchitectureRenameError) setCodeArchitectureRenameError(''); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitCodeArchitectureFolderRename(); }
                        if (e.key === 'Escape') { e.preventDefault(); cancelCodeArchitectureRename(); }
                      }}
                      placeholder="Folder name"
                    />
                    <button onClick={(e) => { e.stopPropagation(); commitCodeArchitectureFolderRename(); }} className="text-sm text-[#2D7DFE] hover:underline">Save</button>
                    <button onClick={(e) => { e.stopPropagation(); cancelCodeArchitectureRename(); }} className="text-sm text-gray-600 hover:underline">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setSection('code-architecture');
                      setActiveCodeArchitectureProjectId(null);
                      setActiveCodeArchitectureFolderId(folder.id);
                      setCodeArchitectureFolderView("projects");
                    }}
                    className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-lg inline-flex items-center gap-1.5 ${
                      activeCodeArchitectureFolderId === folder.id ? 'bg-[#ECEEFF] text-[#0F0F12]' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    title={folder.name}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenCodeArchitectureFolderIds((prev) => ({ ...prev, [folder.id]: !isOpen }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenCodeArchitectureFolderIds((prev) => ({ ...prev, [folder.id]: !isOpen }));
                        }
                      }}
                      className="shrink-0 rounded hover:bg-gray-200"
                    >
                      <ChevronRight size={13} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </span>
                    <Folder size={14} className="shrink-0 text-gray-500" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                )}
                {editingCodeArchitectureFolderId !== folder.id && (
                  <div className="ml-1 hidden group-hover:flex items-center">
                    <button
                      ref={(el) => (codeArchitectureFolderMenuAnchorEls.current[folder.id] = el)}
                      data-cba-folder-menu-trigger="true"
                      onMouseDown={(e) => { e.stopPropagation(); }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenCodeArchitectureProjectMenuId(null);
                        setOpenCodeArchitectureFolderMenuId((current) => current === folder.id ? null : folder.id);
                      }}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                      title="Folder options"
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                )}
              </div>
              {openCodeArchitectureFolderMenuId === folder.id && (
                <FolderMenuPortal
                  anchorEl={codeArchitectureFolderMenuAnchorEls.current[folder.id]}
                  setPortalRef={(el) => (codeArchitectureFolderMenuPortalRefs.current[folder.id] = el)}
                  onNewProject={() => {
                    setOpenCodeArchitectureFolderMenuId(null);
                    setNewCodeArchitectureTargetFolderId(folder.id);
                    setNewCodeArchitectureError('');
                    setShowNewCodeArchitectureProject(true);
                  }}
                  onNewFolder={() => {
                    setOpenCodeArchitectureFolderMenuId(null);
                    setNewCodeArchitectureFolderParentId(folder.id);
                    setNewCodeArchitectureFolderError('');
                    setShowNewCodeArchitectureFolder(true);
                  }}
                  onRename={() => { setOpenCodeArchitectureFolderMenuId(null); beginRenameCodeArchitectureFolder(folder); }}
                  onDelete={() => { setOpenCodeArchitectureFolderMenuId(null); deleteCodeArchitectureFolder(folder.id); }}
                />
              )}
              {isOpen && (
                <div className="space-y-1">
                  {childFolders.map((child) => renderCbaFolder(child, depth + 1))}
                  {childProjects.map((child) => renderCbaProject(child, depth + 1))}
                </div>
              )}
            </div>
          );
        };

        return (
          <>
            {(foldersByParent.get(null) || []).map((folder) => renderCbaFolder(folder, 0))}
            {(projectsByFolder.get(null) || []).map((project) => renderCbaProject(project, 0))}
          </>
        );
      })()}
    </div>
  )}
</div>

<div className="order-6">
  <NavItem
    icon={ShieldCheck}
    label="Safety Case"
    active={section === 'safety-case'}
    onClick={() => setSection('safety-case')}
  />
</div>

<div className="order-4">
  <NavItem
    icon={FileText}
    label="Design Management"
    active={section === 'requirements'}
    onClick={() => setSection('requirements')}
  />
</div>

<div className="order-5">
  <NavItem
    icon={FlaskConical}
    label="System Test"
    active={section === 'vnv'}
    onClick={() => setSection('vnv')}
  />
</div>

{/* xHandle Copilot dock */}
<div className="order-7">
  <NavItem
    icon={CollaboratorNavIcon}
    iconProps={{ active: dockOpen }}
    label="Collaborator"
    active={dockOpen}
    onClick={() => {
      setDockOpen(true);
      setDockCollapsed(false);
      try { localStorage.setItem('xhandle.copilotDockOpen','true'); } catch {}
    }}
  />
</div>







          {/* Projects row with + and collapsible list */}
          <div className="order-2">
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
    {projects.length}
  </span>
)}

                  </span>
                ) : 'Projects'}
                active={section === 'projects'}
                onClick={() => {
                  setSection('projects');
                  setActiveProjectId(null);
                  setActiveProjectFolderId(null);
                  setIsProjectsOpen(o => !o);
                }}
              />
<button
  className={`rounded-lg hover:bg-gray-100 text-gray-700
  ${isSidebarOpen ? 'p-1.5 shrink-0' : 'w-0 p-0 overflow-hidden opacity-0 pointer-events-none shrink'}`}
  title="New project"
  aria-label="New project"
  aria-hidden={!isSidebarOpen}
  tabIndex={isSidebarOpen ? 0 : -1}
  onClick={() => {
    if (!guardNewProjectIntent()) return;
    setSection('projects');
    setNewProjectTargetFolderId(null);
    setNewProjectError('');
    setShowNewProject(true);
  }}
>
  <Plus size={16} className="block" />
</button>
<button
  className={`rounded-lg hover:bg-gray-100 text-gray-700
  ${isSidebarOpen ? 'p-1.5 shrink-0' : 'w-0 p-0 overflow-hidden opacity-0 pointer-events-none shrink'}`}
  title="New folder"
  aria-label="New folder"
  aria-hidden={!isSidebarOpen}
  tabIndex={isSidebarOpen ? 0 : -1}
  onClick={() => {
    setSection('projects');
    setNewProjectFolderParentId(null);
    setNewProjectFolderError('');
    setShowNewProjectFolder(true);
  }}
>
  <FolderPlus size={16} className="block" />
</button>



            </div>
          </div>

          {/* Collapsible list */}
          {isSidebarOpen && isProjectsOpen && (projects.length > 0 || projectFolders.length > 0) && (
            <div
              className={`mt-1 ml-9 pr-1 max-h-56 overflow-auto space-y-1 rounded-lg transition-colors ${
                draggingProjectId && dragOverProjectFolderId === "__root__" ? "bg-blue-50 ring-1 ring-[#2D7DFE]" : ""
              }`}
              role="list"
              aria-label="Projects"
              onDragOver={(e) => {
                if (!draggingProjectId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverProjectFolderId("__root__");
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOverProjectFolderId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const projectId = e.dataTransfer.getData("application/x-xhandle-project-id") || draggingProjectId;
                moveProjectToFolder(projectId, null);
              }}
            >
{(() => {
  const foldersByParent = new Map();
  const projectsByFolder = new Map();
  projectFolders.forEach((folder) => {
    const key = folder.parentId || null;
    if (!foldersByParent.has(key)) foldersByParent.set(key, []);
    foldersByParent.get(key).push(folder);
  });
  projects.forEach((project) => {
    const key = project.folderId || null;
    if (!projectsByFolder.has(key)) projectsByFolder.set(key, []);
    projectsByFolder.get(key).push(project);
  });
  foldersByParent.forEach((items) => items.sort((a, b) => a.name.localeCompare(b.name)));

  const renderProject = (p, depth = 0) => (
  <div
    key={p.id}
    className={`group relative rounded-lg ${draggingProjectId === p.id ? 'opacity-50' : ''}`}
    draggable={editingProjectId !== p.id}
    onDragStart={(e) => {
      setDraggingProjectId(p.id);
      setDragOverProjectFolderId(null);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-xhandle-project-id", p.id);
      e.dataTransfer.setData("text/plain", p.name || "Project");
    }}
    onDragEnd={() => {
      setDraggingProjectId(null);
      setDragOverProjectFolderId(null);
    }}
  >
    <div className="flex items-center justify-between" style={{ paddingLeft: depth * 12 }}>
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
          onClick={() => { setSection('projects'); setActiveProjectId(p.id); setActiveProjectFolderId(null); }}
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
         setOpenProjectFolderMenuId(null);
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
  onInvite={() => { setOpenProjectMenuId(null); setInviteForProjectId(p.id); }}
  onDelete={() => { setOpenProjectMenuId(null); deleteProject(p.id); }}
/>


)}


    {editingProjectId === p.id && renameError && (
      <div className="px-2 text-[11px] text-red-600 mt-1">{renameError}</div>
    )}
  </div>
  );

  const renderFolder = (folder, depth = 0) => {
    const childFolders = foldersByParent.get(folder.id) || [];
    const childProjects = projectsByFolder.get(folder.id) || [];
    const isOpen = openProjectFolderIds[folder.id] !== false;

    return (
      <div
        key={folder.id}
        className={`relative rounded-lg transition-colors ${
          draggingProjectId && dragOverProjectFolderId === folder.id ? "bg-blue-50 ring-1 ring-[#2D7DFE]" : ""
        }`}
        onDragOver={(e) => {
          if (!draggingProjectId) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDragOverProjectFolderId(folder.id);
          if (!isOpen) setOpenProjectFolderIds((prev) => ({ ...prev, [folder.id]: true }));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragOverProjectFolderId(null);
        }}
        onDrop={(e) => {
          if (!draggingProjectId) return;
          e.preventDefault();
          e.stopPropagation();
          const projectId = e.dataTransfer.getData("application/x-xhandle-project-id") || draggingProjectId;
          moveProjectToFolder(projectId, folder.id);
        }}
      >
        <div className="group flex items-center justify-between" style={{ paddingLeft: depth * 12 }}>
          {editingProjectFolderId === folder.id ? (
            <div className="flex-1 flex items-center gap-2 px-2 py-1.5">
              <input
                autoFocus
                className="flex-1 bg-white border rounded px-2 py-1 text-sm min-w-0"
                value={editingProjectFolderName}
                onChange={(e) => { setEditingProjectFolderName(e.target.value); if (renameError) setRenameError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitFolderRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                }}
                placeholder="Folder name"
              />
              <button onClick={(e) => { e.stopPropagation(); commitFolderRename(); }} className="text-sm text-[#2D7DFE] hover:underline" title="Save folder name">
                Save
              </button>
              <button onClick={(e) => { e.stopPropagation(); cancelRename(); }} className="text-sm text-gray-600 hover:underline" title="Cancel rename">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setSection('projects');
                setActiveProjectId(null);
                setActiveProjectFolderId(folder.id);
              }}
              className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-lg inline-flex items-center gap-1.5 ${
                activeProjectFolderId === folder.id ? 'bg-[#ECEEFF] text-[#0F0F12]' : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={folder.name}
            >
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenProjectFolderIds((prev) => ({ ...prev, [folder.id]: !isOpen }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenProjectFolderIds((prev) => ({ ...prev, [folder.id]: !isOpen }));
                  }
                }}
                className="shrink-0 rounded hover:bg-gray-200"
                aria-label={isOpen ? "Collapse folder" : "Expand folder"}
              >
                <ChevronRight size={13} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              </span>
              <Folder size={14} className="shrink-0 text-gray-500" />
              <span className="truncate">{folder.name}</span>
            </button>
          )}

          {editingProjectFolderId !== folder.id && (
            <div className="ml-1 hidden group-hover:flex items-center">
              <button
                ref={(el) => (projectFolderMenuAnchorEls.current[folder.id] = el)}
                data-project-folder-menu-trigger="true"
                onMouseDown={(e) => { e.stopPropagation(); }}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenProjectMenuId(null);
                  setOpenProjectFolderMenuId((cur) => (cur === folder.id ? null : folder.id));
                }}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                aria-haspopup="menu"
                aria-expanded={openProjectFolderMenuId === folder.id}
                title="Folder options"
                aria-label="Folder options"
              >
                <MoreVertical size={15} />
              </button>
            </div>
          )}
        </div>
        {openProjectFolderMenuId === folder.id && (
          <FolderMenuPortal
            anchorEl={projectFolderMenuAnchorEls.current[folder.id]}
            setPortalRef={(el) => (projectFolderMenuPortalRefs.current[folder.id] = el)}
            onNewProject={() => {
              setOpenProjectFolderMenuId(null);
              if (!guardNewProjectIntent()) return;
              setNewProjectTargetFolderId(folder.id);
              setNewProjectError('');
              setShowNewProject(true);
            }}
            onNewFolder={() => {
              setOpenProjectFolderMenuId(null);
              setNewProjectFolderParentId(folder.id);
              setNewProjectFolderError('');
              setShowNewProjectFolder(true);
            }}
            onRename={() => {
              setOpenProjectFolderMenuId(null);
              beginRenameFolder(folder);
            }}
            onDelete={() => {
              setOpenProjectFolderMenuId(null);
              deleteProjectFolder(folder.id);
            }}
          />
        )}
        {editingProjectFolderId === folder.id && renameError && (
          <div className="px-2 text-[11px] text-red-600 mt-1" style={{ marginLeft: depth * 12 }}>{renameError}</div>
        )}
        {isOpen && (
          <div className="space-y-1">
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {childProjects.map((child) => renderProject(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = foldersByParent.get(null) || [];
  const rootProjects = projectsByFolder.get(null) || [];
  return [
    ...rootFolders.map((folder) => renderFolder(folder, 0)),
    ...rootProjects.map((project) => renderProject(project, 0)),
  ];
})()}


            </div>
          )}
        </div>
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
    appFocus={getCollaboratorAppFocus()}
  />
)}




{section === 'review-center' && React.createElement(ReviewCenter, {
  activeProjectId,
  projects: reviewCenterProjects,
  onOpenSource: jumpToReviewSource,
  onExportCodeArchitectureReviewPackage: handleExportCodeArchitectureReviewPackage,
  isExportingCodeArchitectureReviewPackage: isGeneratingCodeArchitectureReviewApp,
})}

    {/* CODE BASED ANALYSIS */}
{section === 'code-architecture' && (
  <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white px-3 py-1 md:px-5 lg:px-7">
    <div className="mb-2 flex shrink-0 items-center justify-between">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        Code-Based Architecture
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border" title="Code architecture projects">
          {codeArchitectureProjects.length}
        </span>
      </h1>
    </div>

    {!activeCodeArchitectureProject && !activeCodeArchitectureFolder && (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden pb-3">
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">All projects</p>
            <h2 className="text-xl font-semibold text-gray-900">Code architecture dashboard</h2>
	          </div>
	          <div className="flex flex-wrap items-center gap-2">
	            <input
	              ref={codeArchitectureProjectImportInputRef}
	              type="file"
	              accept=".json,application/json"
	              className="hidden"
	              onChange={importCodeArchitectureProjectFromFile}
	            />
	            <button
	              type="button"
	              onClick={() => {
                setNewCodeArchitectureTargetFolderId(null);
                setNewCodeArchitectureError('');
                setShowNewCodeArchitectureProject(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
            >
	              <Plus size={15} />
	              Project
	            </button>
	            <button
	              type="button"
	              onClick={() => codeArchitectureProjectImportInputRef.current?.click()}
	              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
	              title="Import a code architecture JSON file as a new project"
	            >
	              <FileText size={15} />
	              Import Project
	            </button>
	            <button
	              type="button"
	              onClick={() => {
	                const firstProjectId = codeArchitectureDashboardRows[0]?.id || codeArchitectureProjects[0]?.id || "";
	                setCodeArchitectureProjectExportSelection(firstProjectId);
	                setCodeArchitectureProjectExportMsg("");
	                setShowCodeArchitectureProjectExport(true);
	              }}
	              disabled={!codeArchitectureProjects.length}
	              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
	              title="Export one Code-Based Architecture project"
	            >
	              <FileText size={15} />
	              Export Project
	            </button>
	            <button
	              type="button"
	              onClick={() => {
                setNewCodeArchitectureFolderParentId(null);
                setNewCodeArchitectureFolderError('');
                setShowNewCodeArchitectureFolder(true);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <FolderPlus size={15} />
              Folder
            </button>
          </div>
        </div>

        <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-semibold">{codeArchitectureProjects.length}</div>
            <div className="text-xs text-gray-500">Projects</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-semibold">{codeArchitectureFolders.length}</div>
            <div className="text-xs text-gray-500">Folders</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-semibold">{codeArchitectureProjects.reduce((sum, project) => sum + (project.repos?.length || 0), 0)}</div>
            <div className="text-xs text-gray-500">Repositories</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-semibold">{codeArchitectureDashboardRows.reduce((sum, project) => sum + (project.rowCount ? 1 : 0), 0)}</div>
            <div className="text-xs text-gray-500">Analyzed repos</div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2 lg:grid-rows-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 shrink-0 text-sm font-semibold text-gray-900">Hazard status</h3>
            <div className="min-h-0 overflow-auto text-sm text-gray-500">Run code architecture hazard analysis inside a connected repo project.</div>
          </section>
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 shrink-0 text-sm font-semibold text-gray-900">Recent activity</h3>
            {codeArchitectureDashboardRows.length === 0 ? (
              <div className="min-h-0 overflow-auto text-sm text-gray-500">Nothing to show yet.</div>
            ) : (
              <div className="min-h-0 space-y-3 overflow-auto pr-1">
                {codeArchitectureDashboardRows.map((project) => (
                  <div key={project.id} className="text-sm text-gray-800">
                    <span className="font-medium">{project.name}</span>
                    <span className="text-gray-500"> · {project.activeRepoName}</span>
                    {project.updatedAt && <div className="text-[11px] text-gray-400">{new Date(project.updatedAt).toLocaleString()}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
            <h3 className="mb-3 shrink-0 text-sm font-semibold text-gray-900">Code architecture projects</h3>
            {codeArchitectureDashboardRows.length === 0 ? (
              <div className="min-h-0 overflow-auto text-sm text-gray-500">Create a Code-Based Architecture project and connect a GitHub repo to begin.</div>
            ) : (
              <div className="min-h-0 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-white text-xs text-gray-500">
                    <tr>
                      <th className="border-b px-3 py-2 font-medium">Project</th>
                      <th className="border-b px-3 py-2 font-medium">Folder</th>
                      <th className="border-b px-3 py-2 font-medium">Repositories</th>
                      <th className="border-b px-3 py-2 font-medium">Active repo</th>
                      <th className="border-b px-3 py-2 font-medium">Rows</th>
                      <th className="border-b px-3 py-2 font-medium">Metrics</th>
                      <th className="border-b px-3 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codeArchitectureDashboardRows.map((project) => (
                      <tr key={project.id} className="hover:bg-gray-50">
                        <td className="border-b px-3 py-2">
                          <button
                            type="button"
                            onClick={() => { setActiveCodeArchitectureProjectId(project.id); setActiveCodeArchitectureFolderId(null); }}
                            className="font-medium text-[#2D7DFE] hover:underline"
                          >
                            {project.name}
                          </button>
                        </td>
                        <td className="border-b px-3 py-2 text-gray-600">{project.folderName}</td>
                        <td className="border-b px-3 py-2 text-gray-600">{project.repoCount}</td>
                        <td className="border-b px-3 py-2 text-gray-600">{project.activeRepoName}</td>
                        <td className="border-b px-3 py-2 text-gray-600">{project.rowCount}</td>
                        <td className="border-b px-3 py-2 text-gray-500">{project.metricsSummary || "Not captured"}</td>
                        <td className="border-b px-3 py-2 text-gray-500">{project.updatedAt ? new Date(project.updatedAt).toLocaleString() : "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    )}

    {activeCodeArchitectureFolder && (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden pb-2">
        <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-2 pr-2">
              <Folder size={15} className="shrink-0 text-slate-500" />
              <h2 className="truncate text-lg font-semibold text-gray-900">{activeCodeArchitectureFolder.name}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {codeArchitectureFolderProjects.length} project{codeArchitectureFolderProjects.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setCodeArchitectureFolderView("projects")}
                className={`rounded-md px-2.5 py-1 text-sm font-semibold ${
                  codeArchitectureFolderView === "projects"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Projects
              </button>
              <button
                type="button"
                onClick={() => setCodeArchitectureFolderView("cross-repo")}
                className={`rounded-md px-2.5 py-1 text-sm font-semibold ${
                  codeArchitectureFolderView === "cross-repo"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Cross-Repo Architecture
              </button>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setNewCodeArchitectureTargetFolderId(activeCodeArchitectureFolder.id);
                setNewCodeArchitectureError('');
                setShowNewCodeArchitectureProject(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
            >
              <Plus size={15} />
              Project
            </button>
            <button
              type="button"
              onClick={() => {
                setNewCodeArchitectureFolderParentId(activeCodeArchitectureFolder.id);
                setNewCodeArchitectureFolderError('');
                setShowNewCodeArchitectureFolder(true);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <FolderPlus size={15} />
              Folder
            </button>
          </div>
        </div>
        {codeArchitectureFolderView === "cross-repo" ? (
          <div className="min-h-0 flex-1">
            <CrossRepoArchitecturePanel
              folder={activeCodeArchitectureFolder}
              folders={codeArchitectureFolders}
              projects={codeArchitectureProjects}
              onOpenFunctionalRow={handleOpenCrossRepoFunctionalRow}
              readCbaRows={readCodeArchitectureRepoRows}
              resultsReview={resultsReview}
            />
          </div>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 shrink-0 text-sm font-semibold text-gray-900">Projects</h3>
            {codeArchitectureFolderProjects.length === 0 ? (
              <div className="min-h-0 overflow-auto text-sm text-gray-500">No Code-Based Architecture projects in this folder yet.</div>
            ) : (
              <div className="min-h-0 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-white text-xs text-gray-500">
                    <tr>
                      <th className="border-b px-3 py-2 font-medium">Project</th>
                      <th className="border-b px-3 py-2 font-medium">Repositories</th>
                      <th className="border-b px-3 py-2 font-medium">Active repo</th>
                      <th className="border-b px-3 py-2 font-medium">Rows</th>
                      <th className="border-b px-3 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codeArchitectureFolderProjects.map((project) => (
                      <tr key={project.id} className="hover:bg-gray-50">
                        <td className="border-b px-3 py-2">
                          <button
                            type="button"
                            onClick={() => { setActiveCodeArchitectureProjectId(project.id); setActiveCodeArchitectureFolderId(null); }}
                            className="font-medium text-[#2D7DFE] hover:underline"
                          >
                            {project.name}
                          </button>
                        </td>
                        <td className="border-b px-3 py-2 text-gray-600">{project.repoCount}</td>
                        <td className="border-b px-3 py-2 text-gray-600">{project.activeRepoName}</td>
                        <td className="border-b px-3 py-2 text-gray-600">{project.rowCount}</td>
                        <td className="border-b px-3 py-2 text-gray-500">{project.updatedAt ? new Date(project.updatedAt).toLocaleString() : "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </section>
    )}

    {activeCodeArchitectureProject && (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-3">
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">Code architecture project</p>
            <h2 className="text-xl font-semibold text-gray-900">{activeCodeArchitectureProject.name}</h2>
            <p className="text-xs text-gray-500">{activeCodeArchitectureRepo ? activeCodeArchitectureRepo.repoName || activeCodeArchitectureRepo.repoId : "No GitHub repo connected"}</p>
            {activeCodeArchitectureMetricsSummary && (
              <p className="mt-1 text-xs text-gray-500">Last run: {activeCodeArchitectureMetricsSummary}</p>
            )}
            {activeCodeArchitectureGroundingSummary && (
              <p className="mt-1 text-xs text-gray-500">Analysis quality: {activeCodeArchitectureGroundingSummary}</p>
            )}
	          </div>
	          <div className="flex flex-wrap items-center gap-2">
	            {activeCodeArchitectureProject.repos?.length > 0 && (
	              <select
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                value={activeCodeArchitectureProject.activeRepoId || activeCodeArchitectureProject.repos[0]?.id || ""}
                onChange={(event) => {
                  const repoId = event.target.value;
                  updateCodeArchitectureProject(activeCodeArchitectureProject.id, { activeRepoId: repoId });
                }}
              >
                {activeCodeArchitectureProject.repos.map((repoConfig) => (
                  <option key={repoConfig.id} value={repoConfig.id}>{repoConfig.repoName || repoConfig.repoId}</option>
                ))}
	              </select>
	            )}
	            <button
	              type="button"
	              onClick={() => {
	                setCodeArchitectureWorkbookExportScope("project");
	                setCodeArchitectureWorkbookExportSheets(CODE_ARCHITECTURE_WORKBOOK_SHEET_OPTIONS.map((option) => option.key));
	                setCodeArchitectureWorkbookExportMsg("");
	                setShowCodeArchitectureWorkbookExport(true);
	              }}
	              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
	              title="Export this Code-Based Architecture project or analysis as a workbook"
	            >
	              <Download size={15} />
	              Export
	            </button>
	            <button
	              type="button"
              onClick={() => openCodeArchitectureRepoConfig(activeCodeArchitectureProject.id, activeCodeArchitectureRepo?.id || null)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <SettingsIcon size={15} />
              GitHub config
            </button>
            <button
              type="button"
              onClick={() => openCodeArchitectureRepoConfig(activeCodeArchitectureProject.id, null)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Plus size={15} />
              Repo
            </button>
            {activeCodeArchitectureRepo && (
              <button
                type="button"
                onClick={() => handleBaselineRepo({ projectId: activeCodeArchitectureProject.id, repoConfig: activeCodeArchitectureRepo })}
                className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
              >
                Analyze
              </button>
            )}
          </div>
        </div>

        {cbaLoading
          ? (
            <div className="min-h-0 overflow-auto rounded-xl border bg-white p-8 text-gray-600 text-sm">{cbaLoadingLabel}</div>
          )
	          : !activeCodeArchitectureRepo ? (
	            <div className="min-h-0 overflow-auto rounded-xl border bg-white p-8 text-gray-600 text-sm">
	              Connect a GitHub repository to start analysis.
	            </div>
	          )
          : cbaTableData.length > 0 ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1.5">
              <button
                type="button"
                onClick={() => setCodeArchitectureWorkspaceTab("architecture")}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  codeArchitectureWorkspaceTab === "architecture"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Architecture Diagram
              </button>
              <button
                type="button"
                onClick={() => setCodeArchitectureWorkspaceTab("safety")}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  codeArchitectureWorkspaceTab === "safety"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Hazard & Remediation
              </button>
              {[
                [ARTIFACT_KINDS.SOFTWARE, "Software Requirements"],
                [ARTIFACT_KINDS.SYSTEM, "System Requirements"],
                [ARTIFACT_KINDS.SUBSYSTEM, "Subsystem Requirements"],
                [ARTIFACT_KINDS.DESIGN, "System / Subsystem Design"],
                ["traceability-matrix", "Traceability Matrix"],
              ].map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCodeArchitectureWorkspaceTab(tab)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    codeArchitectureWorkspaceTab === tab
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {codeArchitectureWorkspaceTab === "architecture" ? (
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-white p-3">
                <FunctionalDecompositionTable
                  data={cbaTableData}
                  repoMeta={activeCodeArchitectureRepoMeta}
                  onRequestCreateProject={handleCreateProjectFromSelection}
                  reviewItems={codeArchitectureFunctionalReviewItems}
                  reviewByRow={codeArchitectureFunctionalReviewByRow}
                  reviewDrawerOptions={codeArchitectureFunctionalReviewDrawerOptions}
                  forceTableOpenKey={codeArchitectureFunctionalTableOpenKey}
                  highlightedRowIndex={highlightedCodeArchitectureFunctionalRowIndex}
                  hazardSummary={codeArchitectureHazardRun?.generatedSheets?.Summary}
                  assuranceArtifacts={{
                    softwareRequirements: loadArtifactRows(ARTIFACT_KINDS.SOFTWARE, activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id),
                    systemRequirements: loadArtifactRows(ARTIFACT_KINDS.SYSTEM, activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id),
                    subsystemRequirements: loadArtifactRows(ARTIFACT_KINDS.SUBSYSTEM, activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id),
                    designElements: loadArtifactRows(ARTIFACT_KINDS.DESIGN, activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id),
                  }}
                  onOpenHazardRow={(rowIndex) => {
                    handleOpenCodeArchitectureHazardSummaryRow(rowIndex);
                    setHazardRemediationTab("hazard-analysis");
                  }}
                  onOpenFunctionalRow={handleOpenCodeArchitectureFunctionalRow}
                  onOpenAssuranceArtifactRow={handleOpenCodeArchitectureArtifactRows}
                  focusTarget={pendingCodeArchitectureDiagramTarget}
                  onFocusTargetHandled={() => setPendingCodeArchitectureDiagramTarget(null)}
                  onSelectArchitectureElement={(element) => {
                    setSelectedCbaElement(element);
                    setCodeArchitectureWorkspaceTab("safety");
                    setHazardRemediationTab("remediation");
                  }}
                  reviewMode={false}
                />
              </div>
            ) : codeArchitectureWorkspaceTab === ARTIFACT_KINDS.SOFTWARE ? (
              <div className="min-h-0 flex-1">
                <EngineeringArtifactPanel
                  key={ARTIFACT_KINDS.SOFTWARE}
                  kind={ARTIFACT_KINDS.SOFTWARE}
                  cbaRows={cbaTableData}
                  project={activeCodeArchitectureProject}
                  repo={activeCodeArchitectureRepo}
                  focusTarget={codeArchitectureArtifactFocus}
                  onFocusResolved={handleCodeArchitectureArtifactFocusResolved}
                  onOpenTrace={handleOpenCodeArchitectureAssuranceTrace}
                  hazardAnalysis={codeArchitectureHazardRun}
                  reviewMode={false}
                />
              </div>
            ) : codeArchitectureWorkspaceTab === ARTIFACT_KINDS.SYSTEM ? (
              <div className="min-h-0 flex-1">
                <EngineeringArtifactPanel
                  key={ARTIFACT_KINDS.SYSTEM}
                  kind={ARTIFACT_KINDS.SYSTEM}
                  cbaRows={cbaTableData}
                  sourceRows={loadArtifactRows(ARTIFACT_KINDS.SOFTWARE, activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id)}
                  project={activeCodeArchitectureProject}
                  repo={activeCodeArchitectureRepo}
                  focusTarget={codeArchitectureArtifactFocus}
                  onFocusResolved={handleCodeArchitectureArtifactFocusResolved}
                  onOpenTrace={handleOpenCodeArchitectureAssuranceTrace}
                  reviewMode={false}
                />
              </div>
            ) : codeArchitectureWorkspaceTab === ARTIFACT_KINDS.SUBSYSTEM ? (
              <div className="min-h-0 flex-1">
                <EngineeringArtifactPanel
                  key={ARTIFACT_KINDS.SUBSYSTEM}
                  kind={ARTIFACT_KINDS.SUBSYSTEM}
                  cbaRows={cbaTableData}
                  sourceRows={loadArtifactRows(ARTIFACT_KINDS.SYSTEM, activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id)}
                  project={activeCodeArchitectureProject}
                  repo={activeCodeArchitectureRepo}
                  focusTarget={codeArchitectureArtifactFocus}
                  onFocusResolved={handleCodeArchitectureArtifactFocusResolved}
                  onOpenTrace={handleOpenCodeArchitectureAssuranceTrace}
                  reviewMode={false}
                />
              </div>
            ) : codeArchitectureWorkspaceTab === ARTIFACT_KINDS.DESIGN ? (
              <div className="min-h-0 flex-1">
                <EngineeringArtifactPanel
                  key={ARTIFACT_KINDS.DESIGN}
                  kind={ARTIFACT_KINDS.DESIGN}
                  cbaRows={cbaTableData}
                  sourceRows={loadArtifactRows(ARTIFACT_KINDS.SUBSYSTEM, activeCodeArchitectureProject.id, activeCodeArchitectureRepo.id)}
                  project={activeCodeArchitectureProject}
                  repo={activeCodeArchitectureRepo}
                  focusTarget={codeArchitectureArtifactFocus}
                  onFocusResolved={handleCodeArchitectureArtifactFocusResolved}
                  onOpenTrace={handleOpenCodeArchitectureAssuranceTrace}
                  reviewMode={false}
                />
              </div>
            ) : codeArchitectureWorkspaceTab === "traceability-matrix" ? (
              <div className="min-h-0 flex-1">
                <TraceabilityMatrixPanel
                  cbaRows={cbaTableData}
                  project={activeCodeArchitectureProject}
                  repo={activeCodeArchitectureRepo}
                  onOpenTrace={handleOpenCodeArchitectureAssuranceTrace}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1.5">
                  <button
                    type="button"
                    onClick={() => setHazardRemediationTab("hazard-analysis")}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                      hazardRemediationTab === "hazard-analysis"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Code Architecture Hazard Analysis
                  </button>
                  <button
                    type="button"
                    onClick={() => setHazardRemediationTab("remediation")}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                      hazardRemediationTab === "remediation"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Safety Remediation
                  </button>
                </div>
                {hazardRemediationTab === "hazard-analysis" ? (
                  <div className="min-h-0 flex-1">
                    <CodeArchitectureHazardPanel
                      cbaRows={cbaTableData}
                      latestRun={codeArchitectureHazardRun}
                      method={codeArchitectureHazardMethod}
                      onMethodChange={setCodeArchitectureHazardMethod}
                      hazardGenerationMode={codeArchitectureHazardGenerationMode}
                      onHazardGenerationModeChange={setCodeArchitectureHazardGenerationMode}
                      onRunAnalysis={handleRunCodeArchitectureHazardAnalysis}
                      onClearContents={handleClearCodeArchitectureHazardContents}
                      isRunning={isRunningCodeArchitectureHazard}
                      progress={codeArchitectureHazardProgress}
                      reviewItems={codeArchitectureHazardReviewItems}
                      reviewByRow={codeArchitectureHazardReviewByRow}
                      reviewDrawerOptions={codeArchitectureHazardReviewDrawerOptions}
                      forceSummaryOpenKey={codeArchitectureHazardSummaryOpenKey}
                      highlightedRowIndex={highlightedCodeArchitectureHazardRowIndex}
                      onDeleteSummaryRow={handleDeleteCodeArchitectureHazardSummaryRow}
                      onOpenArchitectureTarget={(target) => {
                        setPendingCodeArchitectureDiagramTarget(target);
                        setCodeArchitectureWorkspaceTab("architecture");
                      }}
                      reviewMode={false}
                    />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1">
                    <SafetyRemediationPanel
                      project={activeCodeArchitectureProject}
                      projectId={activeCodeArchitectureProject.id}
                      cbaRows={cbaTableData}
                      selectedElement={selectedCbaElement}
                      hazardSummarySheet={codeArchitectureHazardRun?.generatedSheets?.Summary}
                      codeArchitectureHazardAnalysis={codeArchitectureHazardRun}
                      isCodeArchitectureHazardAnalysisStale={
                        codeArchitectureHazardRun
                          ? isCodeArchitectureHazardAnalysisStale({ run: codeArchitectureHazardRun, cbaRows: cbaTableData })
                          : false
                      }
                      riskRegister={riskRegister}
                      repoMeta={activeCodeArchitectureRepoMeta}
                      onOpenHazardSummaryRow={(rowIndex) => {
                        handleOpenCodeArchitectureHazardSummaryRow(rowIndex);
                        setHazardRemediationTab("hazard-analysis");
                      }}
                      reviewMode={false}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-0 overflow-auto rounded-xl border bg-white p-8 text-gray-600 text-sm">
            {activeCodeArchitectureUnavailableRowCount > 0 ? (
              <>
                Analysis metadata lists <span className="font-medium">{activeCodeArchitectureUnavailableRowCount}</span> row{activeCodeArchitectureUnavailableRowCount === 1 ? "" : "s"} for {activeCodeArchitectureRepo.repoName || activeCodeArchitectureRepo.repoId}, but the stored table rows are unavailable in browser storage. Run <span className="font-medium">Analyze</span> again to rebuild the table and diagram.
              </>
            ) : (
              <>
                Click <span className="font-medium">Analyze</span> to fetch repo files, build a dependency graph,
                and generate the functional interaction table for {activeCodeArchitectureRepo.repoName || activeCodeArchitectureRepo.repoId}.
              </>
            )}
          </div>
        )}
      </div>
    )}
  </div>
)}

{section === 'safety-case' && (
  <SafetyCaseView activeProjectId={activeProjectId} />
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
      title="Active projects"
    >
      {projects.length}
    </span>
  </h1>
</div>

{!activeProjectId && !activeProjectFolder && (
  <section className="mb-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm text-gray-500">All projects</p>
        <h2 className="text-xl font-semibold text-gray-900">Projects dashboard</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={projectImportInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={importProjectFromFile}
        />
        <button
          type="button"
          onClick={() => {
            if (!guardNewProjectIntent()) return;
            setNewProjectTargetFolderId(null);
            setNewProjectError('');
            setShowNewProject(true);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
        >
          <Plus size={15} />
          Project
        </button>
        <button
          type="button"
          onClick={() => projectImportInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          title="Import a project JSON file as a new project"
        >
          <FileText size={15} />
          Import Project
        </button>
        <button
          type="button"
          onClick={() => {
            const firstProjectId = projectsDashboardRows[0]?.id || projects[0]?.id || "";
            setProjectExportSelection(firstProjectId);
            setProjectExportMsg("");
            setShowProjectExport(true);
          }}
          disabled={!projects.length}
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Export one project"
        >
          <FileText size={15} />
          Export Project
        </button>
        <button
          type="button"
          onClick={() => {
            setNewProjectFolderParentId(null);
            setNewProjectFolderError('');
            setShowNewProjectFolder(true);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <FolderPlus size={15} />
          Folder
        </button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-2xl font-semibold">{projects.length}</div>
        <div className="text-xs text-gray-500">Projects</div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-2xl font-semibold">{projectFolders.length}</div>
        <div className="text-xs text-gray-500">Folders</div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-2xl font-semibold">{consoleRiskRegister.length}</div>
        <div className="text-xs text-gray-500">Total risks</div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-2xl font-semibold">{projectsDashboardOpenRisks}</div>
        <div className="text-xs text-gray-500">Open risks</div>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Risk status</h3>
        {consoleRiskRegister.length === 0 ? (
          <div className="text-sm text-gray-500">No risks across projects yet.</div>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={consoleRiskStatusData} layout="vertical">
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={110} />
                <Tooltip />
                <Bar dataKey="value">
                  {consoleRiskStatusData.map((_, i) => (
                    <Cell key={i} fill={['#2D7DFE', '#F59E0B', '#10B981', '#7A37FF', '#EF4444'][i % 5]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Recent activity</h3>
        <div className="space-y-3">
          {consoleRecentActivity.length === 0 ? (
            <div className="text-sm text-gray-500">Nothing to show yet.</div>
          ) : consoleRecentActivity.slice(0, 6).map((act, i) => (
            <div key={i} className="text-sm text-gray-800">
              <span className="font-medium">{act.user}</span> updated{" "}
              <span className="text-[#2D7DFE]">{act.item}</span>
              {act.status && <span className="text-gray-500"> · {act.status}</span>}
              {act.when && <div className="text-[11px] text-gray-400">{act.when}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Projects</h3>
        {projectsDashboardRows.length === 0 ? (
          <div className="text-sm text-gray-500">Create a project to start building your workspace.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="border-b px-3 py-2 font-medium">Project</th>
                  <th className="border-b px-3 py-2 font-medium">Folder</th>
                  <th className="border-b px-3 py-2 font-medium">Functions</th>
                  <th className="border-b px-3 py-2 font-medium">Risks</th>
                  <th className="border-b px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {projectsDashboardRows.map((project) => (
                  <tr key={project.id} className="hover:bg-gray-50">
                    <td className="border-b px-3 py-2">
                      <button
                        type="button"
                        onClick={() => { setActiveProjectId(project.id); setActiveProjectFolderId(null); }}
                        className="font-medium text-[#2D7DFE] hover:underline"
                      >
                        {project.name}
                      </button>
                    </td>
                    <td className="border-b px-3 py-2 text-gray-600">{project.folderName}</td>
                    <td className="border-b px-3 py-2 text-gray-600">{project.functionCount}</td>
                    <td className="border-b px-3 py-2 text-gray-600">{project.openRisks} open / {project.riskCount} total</td>
                    <td className="border-b px-3 py-2 text-gray-500">
                      {project.updatedAt ? new Date(project.updatedAt).toLocaleString() : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  </section>
)}

{activeProjectFolder && (
  <section className="mb-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="inline-flex items-center gap-2 text-sm text-gray-500">
          <Folder size={15} />
          Project folder
        </div>
        <h2 className="mt-1 text-xl font-semibold text-gray-900">{activeProjectFolder.name}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!guardNewProjectIntent()) return;
            setNewProjectTargetFolderId(activeProjectFolder.id);
            setNewProjectError('');
            setShowNewProject(true);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-3 py-2 text-sm text-white hover:bg-[#1E61D6]"
        >
          <Plus size={15} />
          Project
        </button>
        <button
          type="button"
          onClick={() => {
            setNewProjectFolderParentId(activeProjectFolder.id);
            setNewProjectFolderError('');
            setShowNewProjectFolder(true);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <FolderPlus size={15} />
          Folder
        </button>
      </div>
    </div>

    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-[#F8FAFC] p-3">
      <span className="text-xs font-medium text-gray-600">Add panel</span>
      <select
        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm"
        value={newFolderDashboardPanelType}
        onChange={(e) => setNewFolderDashboardPanelType(e.target.value)}
      >
        {FOLDER_DASHBOARD_PANEL_TYPES.map((option) => (
          <option key={option.type} value={option.type}>{option.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={addFolderDashboardPanel}
        className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => updateFolderDashboardPanels(() => getDefaultFolderDashboardPanels())}
        className="ml-auto rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        Reset
      </button>
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {folderDashboardPanels.map((panel, index) => renderFolderDashboardPanel(panel, index))}
    </div>
  </section>
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
    onClick={() => {
      setActiveTab(t);
      if (t === 'Hazard Analysis') setShowDiagram(false);
    }}
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
{activeTab === 'Functional Diagramming' && (
  <div className="text-center">
                  {showPromptWizard && (
                    <>

                    </>
                  )}

                  {showPromptWizard && (
                    <div className="mx-auto w-full max-w-[min(96vw,calc(100vw-9rem))]">
                      {/* Mode Toggle */}
                      <div className="flex items-center justify-center mb-4">
  <div className="inline-flex p-1 bg-gray-100 rounded-xl">
    <button
      className={`px-3 py-1.5 rounded-lg text-sm ${promptMode==='structured' ? 'bg-white shadow' : ''}`}
      onClick={() => setPromptMode('structured')}
      disabled={isGeneratingDecomposition}
    >
      Structured
    </button>
    <button
      className={`px-3 py-1.5 rounded-lg text-sm ${promptMode==='conversational' ? 'bg-white shadow' : ''}`}
      onClick={() => setPromptMode('conversational')}
      disabled={isGeneratingDecomposition}
    >
      Conversational
    </button>
  </div>
</div>


                      {/* Wizard / Realtime */}
                      {promptMode === 'structured' ? (
                        <PromptWizard
                          onSubmit={handlePromptWizardSubmit}
                          onSkip={() => {
                            setResponseRows([
                              { fromFunction: 'Node 1', fromDetails: '...', controlAction: 'Control', controlDetails: '...', toFunction: 'Node 2', toDetails: '...' }
                            ]);
                            setDiagramCategories(null);
                            setShowPromptWizard(false);
                            setCleanOnceKey(`wizard-${Date.now()}`);
                          }}
                        />
                      ) : (
                        <ConversationalWizard
                          onSubmit={handlePromptWizardSubmit}
                          onSkip={() => {
                            setResponseRows([
                              { fromFunction: 'Node 1', fromDetails: '...', controlAction: 'Control', controlDetails: '...', toFunction: 'Node 2', toDetails: '...' }
                            ]);
                            setDiagramCategories(null);
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
                          <div className="relative h-[calc(100vh-285px)] min-h-[560px] w-full rounded-2xl bg-white overflow-visible">
                          {activeProjectDiagramReady ? (
                            <LiteSummaryDiagramReactFlow
  key={activeProjectDiagramKey}
  ref={diagramRef}
  rows={responseRows}
  autoCategories={diagramCategories}
  cleanOnceKey={cleanOnceKey}
  onCleanApplied={() => setCleanOnceKey(null)}   // ← clear after first use
  storageKey={`diagram:positions:${activeProjectId}`} // ← per-project persistence
  onUpdateRows={handleProjectDiagramRowsUpdate}
  onRequestCreateProject={handleCreateProjectFromSelection}   // ← ADD THIS
  hazardSummary={analysisResult?.Summary}
  onOpenHazardRow={handleOpenHazardSummaryRow}
/>
                          ) : (
                            <div className="flex h-full min-h-[560px] items-center justify-center text-sm font-medium text-gray-500">
                              Loading project diagram...
                            </div>
                          )}


                          </div>
                        </div>
                      </div>

                      {/* Table */}
                      <div className={`${showFunctionalDiagram ? 'hidden' : ''} relative mb-10 h-[calc(100vh-260px)] min-h-[420px] w-full overflow-auto rounded-md shadow-sm`}>
                        <table className="min-w-full border-separate border-spacing-0 text-sm text-left">
                          <thead>
                            <tr className="text-[#4B5563] text-sm font-medium">
                              {functionalReviewItems.length > 0 && (
                                <th className="sticky top-0 z-30 px-4 py-3 border-b border-gray-200 bg-white whitespace-nowrap">
                                  Review
                                </th>
                              )}
                              {functionalTableColumns.map((column) => (
                                <th key={column.key} className="sticky top-0 z-30 px-4 py-3 border-b border-gray-200 bg-white whitespace-nowrap">
                                  <div ref={(el) => (functionalDropdownRefs.current[column.key] = el)} className="relative">
                                    <button
                                      type="button"
                                      onClick={() => setFunctionalFilterColumn((prev) => (prev === column.key ? null : column.key))}
                                      className={`w-full min-w-44 rounded-md border px-3 py-2 text-left transition flex items-center justify-between gap-3 ${
                                        functionalFilterColumn === column.key || (functionalColumnFilters[column.key] || []).length
                                          ? 'border-[#2D7DFE] bg-[#EEF4FF] text-[#0B3EA8]'
                                          : 'border-gray-200 bg-white text-[#4B5563] hover:border-gray-300'
                                      }`}
                                      title={`Filter ${column.label}`}
                                    >
                                      <span className="min-w-0 flex-1 truncate">{column.label}</span>
                                      <span className="shrink-0 inline-flex items-center gap-2">
                                        {(functionalColumnFilters[column.key] || []).length > 0 && (
                                          <span className="rounded-full bg-[#2D7DFE] px-2 py-0.5 text-[11px] font-semibold text-white">
                                            {(functionalColumnFilters[column.key] || []).length}
                                          </span>
                                        )}
                                        <svg
                                          width="14"
                                          height="14"
                                          viewBox="0 0 20 20"
                                          fill="currentColor"
                                          className={`${functionalFilterColumn === column.key ? 'rotate-180' : ''} transition-transform`}
                                          aria-hidden="true"
                                        >
                                          <path d="M5.5 7.5 10 12l4.5-4.5h-9Z" />
                                        </svg>
                                      </span>
                                    </button>
                                    {functionalFilterColumn === column.key && (
                                      <div className="absolute left-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                        <div className="p-3 border-b sticky top-0 bg-white z-10 space-y-2">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="text-xs font-semibold text-gray-700 truncate">{column.label}</div>
                                            {(functionalColumnFilters[column.key] || []).length > 0 && (
                                              <button
                                                type="button"
                                                onClick={() => setFunctionalFilterValues(column.key, [])}
                                                className="text-[11px] text-[#2D7DFE] hover:underline"
                                              >
                                                Clear
                                              </button>
                                            )}
                                          </div>
                                          <input
                                            type="text"
                                            placeholder={`Search ${column.label}...`}
                                            value={functionalColumnSearches[column.key] || ''}
                                            onChange={(e) =>
                                              setFunctionalColumnSearches({ ...functionalColumnSearches, [column.key]: e.target.value })
                                            }
                                            className="w-full px-3 py-2 text-xs border rounded-md"
                                          />
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => setFunctionalFilterValues(column.key, getUniqueFunctionalColumnValues(column.key, functionalColumnSearches[column.key] || ''))}
                                              className="px-2 py-1 text-[11px] border rounded-md bg-[#F8FAFC] hover:bg-[#EEF2F7]"
                                            >
                                              Select Visible
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setFunctionalFilterValues(column.key, [])}
                                              className="px-2 py-1 text-[11px] border rounded-md bg-[#F8FAFC] hover:bg-[#EEF2F7]"
                                            >
                                              Clear All
                                            </button>
                                          </div>
                                        </div>
                                        <div className="max-h-72 overflow-y-auto p-2">
                                          {getUniqueFunctionalColumnValues(column.key, functionalColumnSearches[column.key] || '').length === 0 ? (
                                            <div className="px-2 py-3 text-xs text-gray-500">No matching values</div>
                                          ) : getUniqueFunctionalColumnValues(column.key, functionalColumnSearches[column.key] || '').map((val) => (
                                            <label
                                              key={val}
                                              className="flex items-start gap-2 px-2 py-2 rounded-md text-xs text-gray-700 hover:bg-[#F8FAFC]"
                                            >
                                              <input
                                                type="checkbox"
                                                checked={(functionalColumnFilters[column.key] || []).includes(val)}
                                                onChange={() => toggleFunctionalFilterValue(column.key, val)}
                                                className="mt-0.5"
                                              />
                                              <span className="break-words">{val}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </th>
                              ))}
                              <th className="sticky top-0 z-30 px-6 py-4 border-b border-gray-200 bg-white whitespace-nowrap">
                                Remove
                              </th>
                            </tr>
                            {activeFunctionalFilterCount > 0 && (
                              <tr>
                                <th colSpan={functionalTableColumns.length + 1 + (functionalReviewItems.length > 0 ? 1 : 0)} className="sticky top-[64px] z-20 bg-[#F8FAFC] border-b border-gray-200 px-4 py-2 text-left">
                                  <div className="flex items-center justify-between gap-3 text-xs text-gray-600">
                                    <span>
                                      Showing {filteredFunctionalRows.length} of {responseRows.length} rows with {activeFunctionalFilterCount} selected filter{activeFunctionalFilterCount === 1 ? '' : 's'}.
                                    </span>
                                    <button
                                      type="button"
                                      onClick={clearAllFunctionalFilters}
                                      className="rounded border border-gray-200 bg-white px-2 py-1 text-[#2D7DFE] hover:bg-blue-50"
                                    >
                                      Clear filters
                                    </button>
                                  </div>
                                </th>
                              </tr>
                            )}
                          </thead>
                          <tbody className="text-[#374151] text-sm">
                            {filteredFunctionalRows.map(({ row, originalIndex }, idx) => {
                              const reviewItem = functionalReviewByRow.get(originalIndex);
                              const rejected = reviewItem?.status === REVIEW_STATUSES.REJECTED;
                              const highlighted = highlightedFunctionalRowIndex === originalIndex;
                              return (
                                <tr
                                  key={originalIndex}
                                  ref={(el) => {
                                    if (el) functionalRowRefs.current[originalIndex] = el;
                                    else delete functionalRowRefs.current[originalIndex];
                                  }}
                                  className={`transition-colors ${
                                    highlighted
                                      ? 'bg-[#FFF7D6] ring-2 ring-[#F3B63F] ring-inset'
                                      : rejected
                                        ? 'bg-rose-50/60'
                                        : idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"
                                  }`}
                                >
                                  {functionalReviewItems.length > 0 && (
                                    <td className="px-6 py-4 align-top border-b border-gray-100">
                                      <ReviewStatusBadge
                                        reviewItem={reviewItem}
                                        openOptions={{
                                          ...functionalReviewDrawerOptions,
                                          reviewItemIds: functionalReviewItems.map((item) => item.id),
                                        }}
                                      />
                                    </td>
                                  )}
                                  {functionalTableColumns.map(({ key: field }) => (
                                    <td key={field} className={`px-6 py-4 align-top whitespace-pre-wrap border-b border-gray-100 ${rejected ? 'text-rose-900' : ''}`}>
                                      <textarea
                                        className={`w-full resize-none bg-transparent focus:outline-none text-sm ${rejected ? 'line-through decoration-rose-400' : ''}`}
                                        value={row[field]}
                                        onChange={(e) => handleRowChange(originalIndex, field, e.target.value)}
                                        style={{ minHeight: '40px' }}
                                      />
                                    </td>
                                  ))}
                                  <td className="px-6 py-4 text-center text-red-500 font-bold cursor-pointer align-middle border-b border-gray-100">
                                    <button onClick={() => handleRemoveRow(originalIndex)}>×</button>
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredFunctionalRows.length === 0 && (
                              <tr>
                                <td colSpan={functionalTableColumns.length + 1 + (functionalReviewItems.length > 0 ? 1 : 0)} className="px-6 py-8 text-center text-sm text-gray-500">
                                  No rows match the current filters.
                                </td>
                              </tr>
                            )}
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
    {hazardAnalysisControls}
    {!analysisResult?.Summary ? (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 text-sm text-gray-600">
          <div>
            <p className="font-medium text-gray-900">Incomplete hazard analysis draft</p>
            <p>Known functional decomposition fields are populated. Use the row magic button to generate a hazard row with the selected method.</p>
          </div>
        </div>
        <div className="relative mb-10 h-[calc(100vh-235px)] min-h-[420px] w-full overflow-auto rounded-md shadow-sm">
          <table className="min-w-full border-separate border-spacing-0 text-sm text-left">
            <thead>
              <tr className="text-[#4B5563] text-sm font-medium">
                <th className="sticky top-0 z-30 px-4 py-3 border-b border-gray-200 bg-white whitespace-nowrap">
                  Generate
                </th>
                {draftHazardHeaders.map((header, idx) => (
                  <th
                    key={`${header}-${idx}`}
                    className="sticky top-0 z-30 px-4 py-3 border-b border-gray-200 bg-white whitespace-nowrap"
                  >
                    <div ref={(el) => (draftHazardDropdownRefs.current[idx] = el)} className="relative">
                      <button
                        type="button"
                        onClick={() => setDraftHazardFilterColumnIndex((prev) => (prev === idx ? null : idx))}
                        className={`w-full min-w-44 rounded-md border px-3 py-2 text-left transition flex items-center justify-between gap-3 ${
                          draftHazardFilterColumnIndex === idx || (draftHazardColumnFilters[idx] || []).length
                            ? 'border-[#2D7DFE] bg-[#EEF4FF] text-[#0B3EA8]'
                            : 'border-gray-200 bg-white text-[#4B5563] hover:border-gray-300'
                        }`}
                        title={`Filter ${header}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{header}</span>
                        <span className="shrink-0 inline-flex items-center gap-2">
                          {(draftHazardColumnFilters[idx] || []).length > 0 && (
                            <span className="rounded-full bg-[#2D7DFE] px-2 py-0.5 text-[11px] font-semibold text-white">
                              {(draftHazardColumnFilters[idx] || []).length}
                            </span>
                          )}
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className={`${draftHazardFilterColumnIndex === idx ? 'rotate-180' : ''} transition-transform`}
                            aria-hidden="true"
                          >
                            <path d="M5.5 7.5 10 12l4.5-4.5h-9Z" />
                          </svg>
                        </span>
                      </button>
                      {draftHazardFilterColumnIndex === idx && (
                        <div className="absolute left-0 mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                          <div className="p-3 border-b sticky top-0 bg-white z-10 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-gray-700 truncate">{header}</div>
                              {(draftHazardColumnFilters[idx] || []).length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setDraftHazardColumnFilterValues(idx, [])}
                                  className="text-[11px] text-[#2D7DFE] hover:underline"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            <input
                              type="text"
                              placeholder={`Search ${header}...`}
                              value={draftHazardColumnSearches[idx] || ''}
                              onChange={(e) =>
                                setDraftHazardColumnSearches({ ...draftHazardColumnSearches, [idx]: e.target.value })
                              }
                              className="w-full px-3 py-2 text-xs border rounded-md"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDraftHazardColumnFilterValues(idx, getUniqueDraftHazardColumnValues(idx, draftHazardColumnSearches[idx] || ''))}
                                className="px-2 py-1 text-[11px] border rounded-md bg-[#F8FAFC] hover:bg-[#EEF2F7]"
                              >
                                Select Visible
                              </button>
                              <button
                                type="button"
                                onClick={() => setDraftHazardColumnFilterValues(idx, [])}
                                className="px-2 py-1 text-[11px] border rounded-md bg-[#F8FAFC] hover:bg-[#EEF2F7]"
                              >
                                Clear All
                              </button>
                            </div>
                          </div>
                          <div className="max-h-72 overflow-y-auto p-2">
                            {getUniqueDraftHazardColumnValues(idx, draftHazardColumnSearches[idx] || '').length === 0 ? (
                              <div className="px-2 py-3 text-xs text-gray-500">No matching values</div>
                            ) : getUniqueDraftHazardColumnValues(idx, draftHazardColumnSearches[idx] || '').map((val) => (
                              <label
                                key={val}
                                className="flex items-start gap-2 px-2 py-2 rounded-md text-xs text-gray-700 hover:bg-[#F8FAFC]"
                              >
                                <input
                                  type="checkbox"
                                  checked={(draftHazardColumnFilters[idx] || []).includes(val)}
                                  onChange={() => toggleDraftHazardFilterValue(idx, val)}
                                  className="mt-0.5"
                                />
                                <span className="break-words">{val}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
              {activeDraftHazardFilterCount > 0 && (
                <tr>
                  <th colSpan={draftHazardHeaders.length + 1} className="sticky top-[64px] z-20 bg-[#F8FAFC] border-b border-gray-200 px-4 py-2 text-left">
                    <div className="flex items-center justify-between gap-3 text-xs text-gray-600">
                      <span>
                        Showing {filteredDraftHazardSummaryRows.length} of {draftHazardSummaryRows.length} rows with {activeDraftHazardFilterCount} selected filter{activeDraftHazardFilterCount === 1 ? '' : 's'}.
                      </span>
                      <button
                        type="button"
                        onClick={clearAllDraftHazardFilters}
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-[#2D7DFE] hover:bg-blue-50"
                      >
                        Clear filters
                      </button>
                    </div>
                  </th>
                </tr>
              )}
            </thead>
            <tbody className="text-[#374151] text-sm">
              {filteredDraftHazardSummaryRows.map(({ row, originalIndex, generated }, idx) => {
                const generating = draftHazardGeneratingIndex === originalIndex;
                const reviewItem = draftHazardReviewByRow.get(originalIndex);
                return (
                  <tr
                    id={`hazard-source-row-${originalIndex + 1}`}
                    key={originalIndex}
                    className={`${idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"} transition-colors`}
                  >
                    <td className="px-6 py-4 align-top border-b border-gray-100">
                      <div className="flex flex-col items-start gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerateDraftHazardRow(originalIndex)}
                          disabled={draftHazardGeneratingIndex !== null}
                          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium ${
                            generated
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-[#2D7DFE] bg-white text-[#1c5fde] hover:bg-blue-50'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                          title="Autogenerate this hazard row with the selected method"
                        >
                          <Sparkles size={14} aria-hidden="true" />
                          {generating ? 'Generating...' : generated ? 'Regenerate' : 'Generate'}
                        </button>
                        {reviewItem && (
                          <ReviewStatusBadge
                            reviewItem={reviewItem}
                            openOptions={draftHazardReviewDrawerOptions}
                          />
                        )}
                      </div>
                    </td>
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} className="px-6 py-4 align-top whitespace-pre-wrap border-b border-gray-100">
                        <textarea
                          className="min-h-[44px] w-full resize-none bg-transparent text-sm text-gray-900 focus:outline-none"
                          value={cell}
                          onChange={(event) => handleDraftHazardCellChange(originalIndex, colIdx, event.target.value)}
                          rows={2}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {draftHazardSummaryRows.length === 0 && (
                <tr>
                  <td colSpan={draftHazardHeaders.length + 1} className="px-6 py-8 text-center text-sm text-gray-500">
                    No functional decomposition rows are available yet.
                  </td>
                </tr>
              )}
              {draftHazardSummaryRows.length > 0 && filteredDraftHazardSummaryRows.length === 0 && (
                <tr>
                  <td colSpan={draftHazardHeaders.length + 1} className="px-6 py-8 text-center text-sm text-gray-500">
                    No rows match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
          <div className="relative mb-10 h-[calc(100vh-235px)] min-h-[420px] w-full overflow-auto rounded-md shadow-sm">
            <table className="min-w-full border-separate border-spacing-0 text-sm text-left">
              <thead>
                <tr className="text-[#4B5563] text-sm font-medium">
                  {hazardSummaryReviewItems.length > 0 && (
                    <th className="sticky top-0 z-30 px-4 py-3 border-b border-gray-200 bg-white whitespace-nowrap">
                      Review
                    </th>
                  )}
                  {analysisResult["Summary"][0].map((header, idx) => (
                    <th
                      key={idx}
                      className="sticky top-0 z-30 px-4 py-3 border-b border-gray-200 bg-white whitespace-nowrap"
                    >
                      <div ref={(el) => (dropdownRefs.current[idx] = el)} className="relative">
                        <button
                          type="button"
                          onClick={() => setFilterColumnIndex((prev) => (prev === idx ? null : idx))}
                          className={`w-full min-w-44 rounded-md border px-3 py-2 text-left transition flex items-center justify-between gap-3 ${
                            filterColumnIndex === idx || (columnFilters[idx] || []).length
                              ? 'border-[#2D7DFE] bg-[#EEF4FF] text-[#0B3EA8]'
                              : 'border-gray-200 bg-white text-[#4B5563] hover:border-gray-300'
                          }`}
                          title={`Filter ${header}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{header}</span>
                          <span className="shrink-0 inline-flex items-center gap-2">
                            {(columnFilters[idx] || []).length > 0 && (
                              <span className="rounded-full bg-[#2D7DFE] px-2 py-0.5 text-[11px] font-semibold text-white">
                                {(columnFilters[idx] || []).length}
                              </span>
                            )}
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className={`${filterColumnIndex === idx ? 'rotate-180' : ''} transition-transform`}
                              aria-hidden="true"
                            >
                              <path d="M5.5 7.5 10 12l4.5-4.5h-9Z" />
                            </svg>
                          </span>
                        </button>
                        {filterColumnIndex === idx && (
                          <div className="absolute left-0 mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                            <div className="p-3 border-b sticky top-0 bg-white z-10 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-gray-700 truncate">{header}</div>
                                {(columnFilters[idx] || []).length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setColumnFilterValues(idx, [])}
                                    className="text-[11px] text-[#2D7DFE] hover:underline"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                              <input
                                type="text"
                                placeholder={`Search ${header}...`}
                                value={columnSearches[idx] || ''}
                                onChange={(e) =>
                                  setColumnSearches({ ...columnSearches, [idx]: e.target.value })
                                }
                                className="w-full px-3 py-2 text-xs border rounded-md"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setColumnFilterValues(idx, getUniqueColumnValues(idx, columnSearches[idx] || ''))}
                                  className="px-2 py-1 text-[11px] border rounded-md bg-[#F8FAFC] hover:bg-[#EEF2F7]"
                                >
                                  Select Visible
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setColumnFilterValues(idx, [])}
                                  className="px-2 py-1 text-[11px] border rounded-md bg-[#F8FAFC] hover:bg-[#EEF2F7]"
                                >
                                  Clear All
                                </button>
                              </div>
                            </div>
                            <div className="max-h-72 overflow-y-auto p-2">
                              {getUniqueColumnValues(idx, columnSearches[idx] || '').length === 0 ? (
                                <div className="px-2 py-3 text-xs text-gray-500">No matching values</div>
                              ) : getUniqueColumnValues(idx, columnSearches[idx] || '').map((val) => (
                                <label
                                  key={val}
                                  className="flex items-start gap-2 px-2 py-2 rounded-md text-xs text-gray-700 hover:bg-[#F8FAFC]"
                                >
                                  <input
                                    type="checkbox"
                                    checked={(columnFilters[idx] || []).includes(val)}
                                    onChange={() => toggleFilterValue(idx, val)}
                                    className="mt-0.5"
                                  />
                                  <span className="break-words">{val}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
                {activeHazardFilterCount > 0 && (
                  <tr>
                    <th colSpan={analysisResult["Summary"][0].length + (hazardSummaryReviewItems.length > 0 ? 1 : 0)} className="sticky top-[64px] z-20 bg-[#F8FAFC] border-b border-gray-200 px-4 py-2 text-left">
                      <div className="flex items-center justify-between gap-3 text-xs text-gray-600">
                        <span>
                          Showing {filteredHazardSummaryRows.length} of {analysisResult["Summary"].length - 1} rows with {activeHazardFilterCount} selected filter{activeHazardFilterCount === 1 ? '' : 's'}.
                        </span>
                        <button
                          type="button"
                          onClick={clearAllHazardFilters}
                          className="rounded border border-gray-200 bg-white px-2 py-1 text-[#2D7DFE] hover:bg-blue-50"
                        >
                          Clear filters
                        </button>
                      </div>
                    </th>
                  </tr>
                )}
              </thead>
              <tbody className="text-[#374151] text-sm">
                {filteredHazardSummaryRows
                  .map(({ row, originalIndex }, idx) => {
                    const reviewItem = hazardSummaryReviewByRow.get(originalIndex);
                    const rejected = reviewItem?.status === REVIEW_STATUSES.REJECTED;
                    const highlighted = highlightedHazardRowIndex === originalIndex;
                    return (
                      <tr
                        id={`hazard-source-row-${originalIndex + 1}`}
                        key={originalIndex}
                        ref={(el) => {
                          if (el) hazardRowRefs.current[originalIndex] = el;
                          else delete hazardRowRefs.current[originalIndex];
                        }}
                        className={`transition-colors ${
                          highlighted
                            ? 'bg-[#FFF7D6] ring-2 ring-[#F3B63F] ring-inset'
                            : rejected
                              ? 'bg-rose-50/60'
                              : idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"
                        }`}
                      >
                        {hazardSummaryReviewItems.length > 0 && (
                          <td className="px-6 py-4 align-top border-b border-gray-100">
                            <ReviewStatusBadge
                              reviewItem={reviewItem}
                              openOptions={{
                                ...hazardReviewDrawerOptions,
                                reviewItemIds: hazardSummaryReviewItems.map((item) => item.id),
                              }}
                            />
                          </td>
                        )}
                        {row.map((cell, colIdx) => (
                          <td key={colIdx} className={`px-6 py-4 align-top whitespace-pre-wrap border-b border-gray-100 ${rejected ? 'text-rose-900 line-through decoration-rose-400' : ''}`}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                {filteredHazardSummaryRows.length === 0 && (
                  <tr>
                    <td colSpan={analysisResult["Summary"][0].length + (hazardSummaryReviewItems.length > 0 ? 1 : 0)} className="px-6 py-8 text-center text-sm text-gray-500">
                      No rows match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </>
    )}
  </section>
)}

{activeTab === 'Risk Assessment' && (
  <section className="mt-2 space-y-5">
    <div className="flex flex-wrap items-center gap-2">
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
          + Add Safety Issue
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
          onClick={handleGenerateRiskAssessment}
          className="inline-flex items-center gap-2 px-3 py-2 text-white rounded bg-[#0F766E] hover:bg-[#115E59] text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canGenerateRiskAssessment || isGeneratingRiskAssessment || isGeneratingRiskAssessmentReport}
          title={canGenerateRiskAssessment ? 'Use AI to consolidate hazard analysis rows into safety issues and generate Safety Issue Reports' : 'Generate hazard analysis rows first'}
        >
          <Sparkles size={16} aria-hidden="true" />
          {isGeneratingRiskAssessment
            ? 'Generating safety issues...'
            : isGeneratingRiskAssessmentReport
              ? 'Writing Safety Issue Reports...'
              : 'AI Generate Risk Assessment'}
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
          title="Export safety issue register as CSV"
        >
          Export CSV
        </button>

        <button
          onClick={() => downloadMarkdownFile(`safety_issue_reports_${new Date().toISOString().slice(0,10)}.md`, riskAssessmentReportMarkdown)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!riskAssessmentReportMarkdown.trim()}
          title="Download the editable Safety Issue Reports as Markdown"
        >
          <Download size={16} aria-hidden="true" />
          Export MD
        </button>

      </div>

      {riskRegister.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm">
          <p className="mb-2">No safety issues yet for this project.</p>
          {analysisResult?.Summary ? (
            <p>
              Use <span className="font-medium">Import from Analysis</span> above to pull items from your latest risk profile,
              or click <span className="font-medium">+ Add Safety Issue</span> to create one manually.
            </p>
          ) : (
            <p>
              Click <span className="font-medium">+ Add Safety Issue</span> to create one manually. To import automatically, run
              <span className="font-medium"> “Develop risk profile”</span> on the Analysis tab first.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className={`relative transition-[padding] duration-300 ${showSafetyIssueReportDrawer && !isSafetyIssueReportFullscreen ? '2xl:pr-[700px]' : ''}`}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <div className="text-sm font-semibold text-gray-900">Consolidated Safety Issues</div>
                <div className="mt-3 grid grid-cols-5 gap-1">
                  {['All','P0','P1','P2','P3+'].map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      onClick={() => setSelectedRiskPriority(priority)}
                      className={`rounded-md border px-2 py-1.5 text-xs font-semibold ${
                        selectedRiskPriority === priority
                          ? 'border-[#2D7DFE] bg-[#EEF4FF] text-[#0B3EA8]'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {priority}
                      <span className="ml-1 text-[11px] font-medium">{riskPriorityCounts[priority] || 0}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-[680px] overflow-y-auto p-2">
                {displayedRiskCards.map((risk) => (
                  <button
                    key={risk.id}
                    type="button"
                    onClick={() => setActiveRiskId(risk.id)}
                    className={`mb-2 w-full rounded-md border p-3 text-left transition ${
                      activeRisk?.id === risk.id
                        ? 'border-[#2D7DFE] bg-[#F5F8FF] shadow-sm'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{risk.title}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-gray-600">{risk.description}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {risk.reportGenerating && (
                          <Loader2
                            size={16}
                            className="animate-spin text-[#2D7DFE]"
                            aria-label="Generating Safety Issue Report"
                          />
                        )}
                        <span className={`rounded px-2 py-1 text-xs font-bold ${
                          risk.priority === 'P0' ? 'bg-red-100 text-red-700' :
                          risk.priority === 'P1' ? 'bg-orange-100 text-orange-700' :
                          risk.priority === 'P2' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {risk.priority}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span className="rounded bg-gray-100 px-2 py-0.5">Score {risk.score}</span>
                      <span className="rounded bg-gray-100 px-2 py-0.5">L{risk.likelihood}</span>
                      <span className="rounded bg-gray-100 px-2 py-0.5">S{risk.severity}</span>
                      <span className="rounded bg-gray-100 px-2 py-0.5">{risk.evidence.length} evidence row{risk.evidence.length === 1 ? '' : 's'}</span>
                    </div>
                  </button>
                ))}
                {displayedRiskCards.length === 0 && (
                  <div className="px-3 py-8 text-center text-sm text-gray-500">No safety issues in this priority group.</div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <div className="text-sm font-semibold text-gray-900">Safety Issue Detail</div>
                <div className="text-xs text-gray-500">Linked hazard-analysis rows are shown below the editable fields.</div>
              </div>
              {activeRisk ? (
                <div className="max-h-[680px] overflow-y-auto p-4">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-1 text-xs font-bold ${
                      activeRisk.priority === 'P0' ? 'bg-red-100 text-red-700' :
                      activeRisk.priority === 'P1' ? 'bg-orange-100 text-orange-700' :
                      activeRisk.priority === 'P2' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {activeRisk.priority}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">Score {activeRisk.score}</span>
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">Status {activeRisk.status || 'Open'}</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="md:col-span-2 block text-xs font-semibold text-gray-600">
                      Title
                      <input
                        className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-[#2D7DFE] focus:outline-none"
                        value={activeRisk.title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, title: v } : x));
                        }}
                      />
                    </label>
                    <label className="md:col-span-2 block text-xs font-semibold text-gray-600">
                      Description
                      <textarea
                        className="mt-1 min-h-28 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-[#2D7DFE] focus:outline-none"
                        value={activeRisk.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, description: v } : x));
                        }}
                      />
                    </label>
                    <label className="block text-xs font-semibold text-gray-600">
                      Likelihood
                      <select
                        className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                        value={activeRisk.likelihood}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, likelihood: v } : x));
                        }}
                      >
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-gray-600">
                      Severity
                      <select
                        className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                        value={activeRisk.severity}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, severity: v } : x));
                        }}
                      >
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-gray-600">
                      Status
                      <select
                        className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                        value={activeRisk.status}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, status: v } : x));
                        }}
                      >
                        {['Open','In Progress','Mitigated','Accepted','Closed'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-gray-600">
                      Owner
                      <input
                        className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                        value={activeRisk.owner || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, owner: v } : x));
                        }}
                      />
                    </label>
                    <label className="block text-xs font-semibold text-gray-600">
                      Due Date
                      <input
                        type="date"
                        className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                        value={activeRisk.dueDate || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, dueDate: v } : x));
                        }}
                      />
                    </label>
                    <label className="block text-xs font-semibold text-gray-600">
                      Tags
                      <input
                        className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                        value={activeRisk.tags || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRiskRegister(prev => prev.map(x => x.id === activeRisk.id ? { ...x, tags: v } : x));
                        }}
                      />
                    </label>
                  </div>

                  <div className="mt-6">
                    <div className="mb-2 text-sm font-semibold text-gray-900">Hazard Analysis Evidence</div>
                    {activeRisk.evidence.length ? (
                      <div className="space-y-3">
                        {activeRisk.evidence.map((item) => (
                          <div
                            id={`hazard-source-row-${item.sourceIndex}`}
                            key={item.sourceIndex}
                            className="scroll-mt-24 rounded-md border border-gray-200 bg-[#F8FAFC] p-3"
                          >
                            <div className="mb-2 text-xs font-semibold text-gray-700">Source Row {item.sourceIndex}</div>
                            <dl className="grid gap-2 text-xs md:grid-cols-2">
                              {Object.entries(item.cells).map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <dt className="font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                                  <dd className="mt-0.5 whitespace-pre-wrap text-gray-800">{value}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                        This risk has no linked source rows yet. Regenerate consolidated risks from hazard analysis to add traceability.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-6 text-sm text-gray-500">Select a consolidated safety issue to review details.</div>
              )}
            </div>

            {!showSafetyIssueReportDrawer && (
              <button
                type="button"
                onClick={() => {
                  setShowSafetyIssueReportDrawer(true);
                  setIsSafetyIssueReportFullscreen(false);
                }}
                className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-2 rounded-l-lg border border-r-0 border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-lg hover:bg-gray-50"
                title="Show Safety Issue Report drawer"
              >
                <FileText size={16} aria-hidden="true" />
                <span className="[writing-mode:vertical-rl] rotate-180">Reports</span>
              </button>
            )}

            <div className={`fixed z-30 rounded-lg border border-gray-200 bg-white shadow-2xl transition-all duration-300 ease-out ${
              isSafetyIssueReportFullscreen
                ? 'left-4 right-4 bottom-4 top-24 w-auto'
                : 'bottom-4 right-4 top-24 w-[min(92vw,680px)]'
            } ${
              showSafetyIssueReportDrawer ? 'translate-x-0 opacity-100' : 'translate-x-[calc(100%+2rem)] opacity-0 pointer-events-none'
            }`}>
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Safety Issue Report</div>
                  <div className="text-xs text-gray-500">
                    {activeRisk ? `Showing ${shortId(activeRisk.id, "selected")} · export downloads all reports.` : 'Select a safety issue to view its report.'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
                    {['preview','edit'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setRiskReportMode(mode)}
                        className={`rounded px-2 py-1 text-xs font-medium capitalize ${
                          riskReportMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSafetyIssueReportFullscreen((value) => !value)}
                    className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                    title={isSafetyIssueReportFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
                    aria-label={isSafetyIssueReportFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
                  >
                    {isSafetyIssueReportFullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSafetyIssueReportDrawer(false);
                      setIsSafetyIssueReportFullscreen(false);
                    }}
                    className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                    title="Hide Safety Issue Report drawer"
                    aria-label="Hide Safety Issue Report drawer"
                  >
                    <PanelLeftClose size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="h-[calc(100%-65px)] overflow-y-auto p-4">
                {activeRisk ? (
                  activeRisk.reportGenerated ? (
                    riskReportMode === 'edit' ? (
                    <textarea
                      className="min-h-[610px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm leading-6 text-gray-900 focus:border-[#2D7DFE] focus:outline-none"
                      value={activeSafetyIssueReportMarkdown}
                      onChange={(e) => {
                        const nextMarkdown = replaceSafetyIssueReportMarkdown(
                          riskAssessmentReportMarkdown,
                          activeRisk.id,
                          e.target.value
                        );
                        setRiskAssessmentReportMarkdown(nextMarkdown);
                      }}
                    />
                    ) : (
                    <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-table:text-xs">
                      <SafetyReportViewer reportText={activeSafetyIssueReportMarkdown} />
                    </div>
                    )
                  ) : (
                    <div className="flex min-h-[280px] items-center justify-center rounded-md border border-dashed border-gray-300 p-6 text-sm text-gray-500">
                      {activeRisk.reportGenerating ? (
                        <div className="flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin text-[#2D7DFE]" aria-hidden="true" />
                          <span>Generating this Safety Issue Report...</span>
                        </div>
                      ) : (
                        <span>This Safety Issue Report has not been generated yet.</span>
                      )}
                    </div>
                  )
                ) : (
                  <div className="rounded-md border border-dashed border-gray-300 p-6 text-sm text-gray-500">
                    Select a safety issue to view its report.
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>

        </>
      )}
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
      title="AI report generation is unavailable"
    >
      Generate AI Report
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
          <p className="text-gray-500 text-sm">Loading local workspace…</p>
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
            Project-wide monitoring and triage are available in the local workspace.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-6 text-gray-700 text-sm">
          This feature is enabled for local open-source use.
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
            <p className="text-gray-500 text-sm">Loading local workspace…</p>
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
            Aggregated risk management is available in the local workspace.
          </p>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-700 text-sm">
          This feature is enabled for local open-source use.
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
          <h1 className="text-2xl font-semibold">Design Management</h1>
          <p className="text-gray-500 text-sm">Loading local workspace…</p>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-600 text-sm animate-pulse">
          Checking your access…
        </div>
      </div>
    }
    fallback={
      <div className="flex flex-col flex-1 min-h-0 overflow-auto bg-white py-1 px-3 md:px-5 lg:px-7 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Design Management</h1>
          <p className="text-gray-500 text-sm">
            Object-oriented design artifacts, custom attributes, and bi-directional links are available locally.
          </p>
        </div>
        <div className="rounded-xl border bg-white p-6 text-gray-700 text-sm">
          This feature is enabled for local open-source use.
        </div>
      </div>
    }
  >
    <DesignManagementView
      requirements={requirements}
      setRequirements={setRequirements}
      onApplyWorkflowArtifacts={applyWorkflowArtifacts}
    />
  </Gate>
)}

{section === 'vnv' && (
  <div className="flex-1 min-h-0 overflow-hidden bg-white p-1 w-full">
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
  onAIProviderSaved={refreshGate}
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

{inviteForProjectId && (
  <InviteCollaboratorsModal
    projectName={projects.find(p => p.id === inviteForProjectId)?.name || "Project"}
    onClose={() => setInviteForProjectId(null)}
    onSubmit={async ({ emails, role }) => {
      const projectId = inviteForProjectId;
      const origin = window.location.origin;

      const linkFromToken = (token) =>
        `${origin}/local-invite/${encodeURIComponent(token)}`;

      async function createInvite(email) {
        const token = makeId();
        try {
          const key = "xhandle.localInvites";
          const invites = JSON.parse(localStorage.getItem(key) || "[]");
          invites.push({ token, projectId, email, role, createdAt: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(invites));
        } catch {}
        return token;
      }

      const results = [];
      for (const email of emails) {
        const token = await createInvite(email);
        results.push({ email, link: linkFromToken(token) });
      }

      const lines = results.map((r) => `${r.email}: ${r.link}`);
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        alert(`Invite link(s) copied to your clipboard:\n\n${lines.join("\n")}`);
      } catch {
        alert(`Invite link(s):\n\n${lines.join("\n")}`);
      }
    }}
  />
)}

        {showCodeArchitectureWorkbookExport && (
          <CodeArchitectureWorkbookExportModal
            projectName={activeCodeArchitectureProject?.name || ""}
            repoName={activeCodeArchitectureRepo?.repoName || activeCodeArchitectureRepo?.repoId || ""}
            scope={codeArchitectureWorkbookExportScope}
            selectedSheets={codeArchitectureWorkbookExportSheets}
            isExporting={isExportingCodeArchitectureWorkbook}
            message={codeArchitectureWorkbookExportMsg}
            onScopeChange={(scope) => {
              setCodeArchitectureWorkbookExportScope(scope);
              setCodeArchitectureWorkbookExportMsg("");
            }}
            onToggleSheet={(key) => {
              setCodeArchitectureWorkbookExportSheets((prev) => (
                prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]
              ));
              setCodeArchitectureWorkbookExportMsg("");
            }}
            onSelectAll={() => {
              setCodeArchitectureWorkbookExportSheets(CODE_ARCHITECTURE_WORKBOOK_SHEET_OPTIONS.map((option) => option.key));
              setCodeArchitectureWorkbookExportMsg("");
            }}
            onDeselectAll={() => {
              setCodeArchitectureWorkbookExportSheets([]);
              setCodeArchitectureWorkbookExportMsg("");
            }}
            onCancel={() => {
              if (!isExportingCodeArchitectureWorkbook) setShowCodeArchitectureWorkbookExport(false);
            }}
            onConfirm={exportCodeArchitectureWorkbook}
          />
        )}

        {showCodeArchitectureProjectExport && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => {
              if (!isExportingCodeArchitectureProject) setShowCodeArchitectureProjectExport(false);
            }} />
            <div className="relative z-[101] w-full max-w-lg rounded-2xl border-2 border-[#2D7DFE] bg-white shadow-xl">
              <div className="px-5 py-4 border-b">
                <h2 className="text-base font-semibold text-slate-800">Export Code-Based Architecture project</h2>
                <p className="text-xs text-slate-500 mt-0.5">Choose one project to export as a JSON package.</p>
              </div>
              <div className="max-h-[55vh] overflow-auto px-5 py-4">
                {codeArchitectureDashboardRows.length === 0 ? (
                  <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    No Code-Based Architecture projects are available to export.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {codeArchitectureDashboardRows.map((project) => (
                      <label
                        key={project.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                          codeArchitectureProjectExportSelection === project.id
                            ? "border-[#2D7DFE] bg-blue-50"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="codeArchitectureProjectExport"
                          className="mt-1"
                          checked={codeArchitectureProjectExportSelection === project.id}
                          onChange={() => setCodeArchitectureProjectExportSelection(project.id)}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-gray-900">{project.name}</span>
                          <span className="block text-xs text-gray-500">
                            {project.repoCount} repo{project.repoCount === 1 ? "" : "s"} · {project.rowCount || 0} rows · {project.activeRepoName}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {codeArchitectureProjectExportMsg && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {codeArchitectureProjectExportMsg}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowCodeArchitectureProjectExport(false)}
                  disabled={isExportingCodeArchitectureProject}
                  className="px-3 py-2 rounded border text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={exportSelectedCodeArchitectureProject}
                  disabled={isExportingCodeArchitectureProject || !codeArchitectureProjectExportSelection}
                  className="px-3 py-2 rounded text-sm bg-[#2D7DFE] text-white hover:bg-[#1E61D6] disabled:opacity-50"
                >
                  {isExportingCodeArchitectureProject ? "Exporting..." : "Export"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showNewCodeArchitectureProject && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => {
              setShowNewCodeArchitectureProject(false);
              setNewCodeArchitectureProjectName('');
              setNewCodeArchitectureTargetFolderId(null);
              setNewCodeArchitectureError('');
            }} />
            <div className="relative z-[101] w-full max-w-md rounded-2xl border-2 border-[#2D7DFE] bg-white shadow-xl">
              <div className="px-5 py-4 border-b">
                <h2 className="text-base font-semibold text-slate-800">Create Code-Based Architecture project</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {newCodeArchitectureTargetFolderId
                    ? `Inside ${codeArchitectureFolders.find((folder) => folder.id === newCodeArchitectureTargetFolderId)?.name || 'selected folder'}`
                    : 'Create a repo-backed architecture analysis workspace.'}
                </p>
              </div>
              <div className="px-5 py-4">
                <label className="block text-sm font-medium mb-1">Project name</label>
                <input
                  autoFocus
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring"
                  value={newCodeArchitectureProjectName}
                  onChange={(e) => {
                    setNewCodeArchitectureProjectName(e.target.value);
                    if (newCodeArchitectureError) setNewCodeArchitectureError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createCodeArchitectureProject();
                    if (e.key === 'Escape') {
                      setShowNewCodeArchitectureProject(false);
                      setNewCodeArchitectureProjectName('');
                      setNewCodeArchitectureTargetFolderId(null);
                      setNewCodeArchitectureError('');
                    }
                  }}
                  placeholder="e.g., Interlock System"
                />
                {newCodeArchitectureError && <div className="text-xs text-red-600 mt-1">{newCodeArchitectureError}</div>}
              </div>
              <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
                <button onClick={() => {
                  setShowNewCodeArchitectureProject(false);
                  setNewCodeArchitectureProjectName('');
                  setNewCodeArchitectureTargetFolderId(null);
                  setNewCodeArchitectureError('');
                }} className="px-3 py-2 rounded border text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={createCodeArchitectureProject} className="px-3 py-2 rounded text-sm bg-[#2D7DFE] text-white hover:bg-[#1E61D6]">
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {showNewCodeArchitectureFolder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => {
              setShowNewCodeArchitectureFolder(false);
              setNewCodeArchitectureFolderName('');
              setNewCodeArchitectureFolderParentId(null);
              setNewCodeArchitectureFolderError('');
            }} />
            <div className="relative z-[101] w-full max-w-md rounded-2xl border-2 border-[#2D7DFE] bg-white shadow-xl">
              <div className="px-5 py-4 border-b">
                <h2 className="text-base font-semibold text-slate-800">Create Code-Based Architecture folder</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {newCodeArchitectureFolderParentId
                    ? `Inside ${codeArchitectureFolders.find((folder) => folder.id === newCodeArchitectureFolderParentId)?.name || 'selected folder'}`
                    : 'Organize repo architecture projects in the sidebar.'}
                </p>
              </div>
              <div className="px-5 py-4">
                <label className="block text-sm font-medium mb-1">Folder name</label>
                <input
                  autoFocus
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring"
                  value={newCodeArchitectureFolderName}
                  onChange={(e) => {
                    setNewCodeArchitectureFolderName(e.target.value);
                    if (newCodeArchitectureFolderError) setNewCodeArchitectureFolderError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createCodeArchitectureFolder();
                    if (e.key === 'Escape') {
                      setShowNewCodeArchitectureFolder(false);
                      setNewCodeArchitectureFolderName('');
                      setNewCodeArchitectureFolderParentId(null);
                      setNewCodeArchitectureFolderError('');
                    }
                  }}
                  placeholder="e.g., Vehicle software"
                />
                {newCodeArchitectureFolderError && <div className="text-xs text-red-600 mt-1">{newCodeArchitectureFolderError}</div>}
              </div>
              <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
                <button onClick={() => {
                  setShowNewCodeArchitectureFolder(false);
                  setNewCodeArchitectureFolderName('');
                  setNewCodeArchitectureFolderParentId(null);
                  setNewCodeArchitectureFolderError('');
                }} className="px-3 py-2 rounded border text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={createCodeArchitectureFolder} className="px-3 py-2 rounded text-sm bg-[#2D7DFE] text-white hover:bg-[#1E61D6]">
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {showCodeArchitectureRepoConfig && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowCodeArchitectureRepoConfig(false)} />
            <div className="relative z-[121] w-full max-w-2xl rounded-2xl border bg-white shadow-xl">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">GitHub repo configuration</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Connect, verify, and analyze a repository for this Code-Based Architecture project.</p>
                </div>
                <button className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" onClick={() => setShowCodeArchitectureRepoConfig(false)}>✕</button>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Repository URL</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={codeArchitectureRepoDraft.repoUrl}
                    onChange={(e) => {
                      const repoUrl = e.target.value;
                      const parsed = parseGitHubRepoUrl(repoUrl);
                      setCodeArchitectureRepoDraft((draft) => ({
                        ...draft,
                        repoUrl,
                        owner: parsed?.owner || draft.owner,
                        repo: parsed?.repo || draft.repo,
                      }));
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData?.getData("text") || "";
                      const parsed = parseGitHubRepoUrl(pasted);
                      if (!parsed) return;
                      e.preventDefault();
                      setCodeArchitectureRepoDraft((draft) => ({
                        ...draft,
                        repoUrl: parsed.repoUrl,
                        owner: parsed.owner,
                        repo: parsed.repo,
                      }));
                    }}
                    placeholder="https://github.com/github-org/repo-name"
                  />
                  <p className="mt-1 text-xs text-slate-500">Paste a GitHub URL, or enter owner and repository manually below.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Owner</label>
                    <input className="w-full border rounded px-3 py-2 text-sm" value={codeArchitectureRepoDraft.owner} onChange={(e) => setCodeArchitectureRepoDraft((draft) => ({ ...draft, owner: e.target.value }))} placeholder="github-org" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Repository</label>
                    <input className="w-full border rounded px-3 py-2 text-sm" value={codeArchitectureRepoDraft.repo} onChange={(e) => setCodeArchitectureRepoDraft((draft) => ({ ...draft, repo: e.target.value }))} placeholder="repo-name" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">GitHub token</label>
                  <input type="password" className="w-full border rounded px-3 py-2 text-sm" value={codeArchitectureRepoDraft.token} onChange={(e) => setCodeArchitectureRepoDraft((draft) => ({ ...draft, token: e.target.value }))} placeholder="Optional for public repos" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Analysis context</label>
                  <textarea className="min-h-24 w-full border rounded px-3 py-2 text-sm" value={codeArchitectureRepoDraft.analysisContextText} onChange={(e) => setCodeArchitectureRepoDraft((draft) => ({ ...draft, analysisContextText: e.target.value }))} placeholder="Optional context about the product, repo boundaries, terminology, or safety focus." />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Context files</label>
                  <input
                    type="file"
                    multiple
                    className="w-full rounded border px-3 py-2 text-sm"
                    onChange={async (event) => {
                      const files = Array.from(event.target.files || []);
                      const loaded = await Promise.all(files.map((file) => new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve({
                          name: file.name,
                          content: String(reader.result || "").slice(0, 60000),
                        });
                        reader.onerror = () => resolve(null);
                        reader.readAsText(file);
                      })));
                      setCodeArchitectureRepoDraft((draft) => ({
                        ...draft,
                        analysisContextFiles: loaded.filter(Boolean),
                      }));
                    }}
                  />
                  {codeArchitectureRepoDraft.analysisContextFiles.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      {codeArchitectureRepoDraft.analysisContextFiles.length} context file{codeArchitectureRepoDraft.analysisContextFiles.length === 1 ? "" : "s"} attached.
                    </div>
                  )}
                </div>
                {codeArchitectureRepoConfigMessage && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{codeArchitectureRepoConfigMessage}</div>
                )}
              </div>
              <div className="px-5 py-4 border-t flex flex-wrap items-center justify-end gap-2">
                <button onClick={() => setShowCodeArchitectureRepoConfig(false)} className="px-3 py-2 rounded border text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={() => saveCodeArchitectureRepoConfig({ analyze: false })} disabled={isCodeArchitectureRepoVerifying || isCodeArchitectureRepoAnalyzing} className="px-3 py-2 rounded border text-sm hover:bg-gray-50 disabled:opacity-60">
                  {isCodeArchitectureRepoVerifying ? "Verifying..." : "Verify & save"}
                </button>
                <button onClick={() => saveCodeArchitectureRepoConfig({ analyze: true })} disabled={isCodeArchitectureRepoVerifying || isCodeArchitectureRepoAnalyzing} className="px-3 py-2 rounded text-sm bg-[#2D7DFE] text-white hover:bg-[#1E61D6] disabled:opacity-60">
                  {isCodeArchitectureRepoAnalyzing ? "Starting..." : "Analyze"}
                </button>
              </div>
            </div>
          </div>
        )}

        <FileTypeSelectorModal
          open={codeArchitectureFileSelectorOpen}
          files={codeArchitectureRepoFilesForModal}
          onCancel={() => {
            setCodeArchitectureFileSelectorOpen(false);
            codeArchitectureFileSelectorResolver.current?.([]);
            codeArchitectureFileSelectorResolver.current = null;
          }}
          onConfirm={(selectedExtensions) => {
            setCodeArchitectureFileSelectorOpen(false);
            codeArchitectureFileSelectorResolver.current?.(selectedExtensions || []);
            codeArchitectureFileSelectorResolver.current = null;
          }}
        />

        {showProjectExport && (
          <ProjectExportModal
            projects={projectsDashboardRows.length ? projectsDashboardRows : projects}
            selectedProjectId={projectExportSelection}
            isExporting={isExportingProject}
            message={projectExportMsg}
            onSelectionChange={(projectId) => {
              setProjectExportSelection(projectId);
              setProjectExportMsg("");
            }}
            onCancel={() => setShowProjectExport(false)}
            onConfirm={exportSelectedProject}
          />
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
                setNewProjectTargetFolderId(null);
                setNewProjectError('');
              }}
            />
            {/* Dialog */}
            <div className="relative z-[101] w-full max-w-md rounded-2xl border-2 border-[#2D7DFE] bg-white shadow-xl">
              <div className="px-5 py-4 border-b">
                <h2 className="text-base font-semibold text-slate-800">Create new project</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {newProjectTargetFolderId
                    ? `Inside ${projectFolders.find((folder) => folder.id === newProjectTargetFolderId)?.name || 'selected folder'}`
                    : 'Give your project a short, memorable name.'}
                </p>
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
                      setNewProjectTargetFolderId(null);
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
    {projects.length} active project{projects.length === 1 ? "" : "s"}.
  </div>
)}
              </div>

              <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowNewProject(false);
                    setNewProjectName('');
                    setNewProjectTargetFolderId(null);
                    setNewProjectError('');
                  }}
                  className="px-3 py-2 rounded border text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
  onClick={createProject}
  className="px-3 py-2 rounded text-sm bg-[#2D7DFE] text-white hover:bg-[#1E61D6]"
>
  Create
</button>

              </div>
            </div>
          </div>
        )}
        {/* New Project Folder Modal */}
        {showNewProjectFolder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => {
                setShowNewProjectFolder(false);
                setNewProjectFolderName('');
                setNewProjectFolderParentId(null);
                setNewProjectFolderError('');
              }}
            />
            <div className="relative z-[101] w-full max-w-md rounded-2xl border-2 border-[#2D7DFE] bg-white shadow-xl">
              <div className="px-5 py-4 border-b">
                <h2 className="text-base font-semibold text-slate-800">Create project folder</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {newProjectFolderParentId
                    ? `Inside ${projectFolders.find((folder) => folder.id === newProjectFolderParentId)?.name || 'selected folder'}`
                    : 'Organize related projects in the sidebar.'}
                </p>
              </div>

              <div className="px-5 py-4">
                <label className="block text-sm font-medium mb-1">Folder name</label>
                <input
                  autoFocus
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring"
                  value={newProjectFolderName}
                  onChange={(e) => {
                    setNewProjectFolderName(e.target.value);
                    if (newProjectFolderError) setNewProjectFolderError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createProjectFolder();
                    if (e.key === 'Escape') {
                      setShowNewProjectFolder(false);
                      setNewProjectFolderName('');
                      setNewProjectFolderParentId(null);
                      setNewProjectFolderError('');
                    }
                  }}
                  placeholder="e.g., Sensor platforms"
                />
                {newProjectFolderError && (
                  <div className="text-xs text-red-600 mt-1">{newProjectFolderError}</div>
                )}
              </div>

              <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowNewProjectFolder(false);
                    setNewProjectFolderName('');
                    setNewProjectFolderParentId(null);
                    setNewProjectFolderError('');
                  }}
                  className="px-3 py-2 rounded border text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createProjectFolder}
                  className="px-3 py-2 rounded text-sm bg-[#2D7DFE] text-white hover:bg-[#1E61D6]"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
{codeArchitectureReviewAnalysisModal && (
  <CodeArchitectureReviewAnalysisModal
    appName={codeArchitectureReviewAnalysisModal.appName}
    reviewAppTarget={codeArchitectureReviewAnalysisModal.reviewAppTarget || "mac"}
    destinationDirectory={codeArchitectureReviewAnalysisModal.destinationDirectory || ""}
    isHostedPackager={isHostedCodeArchitectureReviewPackagerConfigured()}
    targetOptions={codeArchitectureReviewAnalysisModal.targetOptions}
    selectedTargetIds={codeArchitectureReviewAnalysisModal.selectedTargetIds}
    options={codeArchitectureReviewAnalysisModal.options}
    selectedKeys={codeArchitectureReviewAnalysisModal.selectedKeys}
    onAppNameChange={(appName) => {
      setCodeArchitectureReviewAnalysisModal((current) => (
        current ? { ...current, appName } : current
      ));
    }}
    onReviewAppTargetChange={(reviewAppTarget) => {
      setCodeArchitectureReviewAnalysisModal((current) => (
        current ? { ...current, reviewAppTarget } : current
      ));
    }}
    onChooseDestination={async () => {
      const selection = await chooseCodeArchitectureReviewDestination();
      if (!selection?.cancelled && selection?.path) {
        setCodeArchitectureReviewAnalysisModal((current) => (
          current ? { ...current, destinationDirectory: selection.path } : current
        ));
      }
    }}
    onDestinationDirectoryChange={(destinationDirectory) => {
      setCodeArchitectureReviewAnalysisModal((current) => (
        current ? { ...current, destinationDirectory } : current
      ));
    }}
    onToggleTarget={(targetId) => {
      setCodeArchitectureReviewAnalysisModal((current) => {
        if (!current) return current;
        const target = current.targetOptions.find((entry) => entry.id === targetId);
        if (!target || target.available === false) return current;
        const selectedTargets = new Set(current.selectedTargetIds);
        if (selectedTargets.has(targetId)) selectedTargets.delete(targetId);
        else selectedTargets.add(targetId);
        const selectedTargetIds = Array.from(selectedTargets);
        const options = analysisOptionsForReviewTargets(current.targetOptions, selectedTargetIds);
        const availableKeys = new Set(options.filter((option) => option.available).map((option) => option.key));
        return {
          ...current,
          selectedTargetIds,
          options,
          selectedKeys: current.selectedKeys.filter((key) => availableKeys.has(key)),
        };
      });
    }}
    onSelectAllTargets={() => {
      setCodeArchitectureReviewAnalysisModal((current) => {
        if (!current) return current;
        const selectedTargetIds = current.targetOptions
          .filter((target) => target.available !== false)
          .map((target) => target.id);
        const options = analysisOptionsForReviewTargets(current.targetOptions, selectedTargetIds);
        const availableKeys = new Set(options.filter((option) => option.available).map((option) => option.key));
        return {
          ...current,
          selectedTargetIds,
          options,
          selectedKeys: current.selectedKeys.filter((key) => availableKeys.has(key)),
        };
      });
    }}
    onDeselectAllTargets={() => {
      setCodeArchitectureReviewAnalysisModal((current) => {
        if (!current) return current;
        const options = analysisOptionsForReviewTargets(current.targetOptions, []);
        return { ...current, selectedTargetIds: [], options, selectedKeys: [] };
      });
    }}
    onToggle={(key) => {
      setCodeArchitectureReviewAnalysisModal((current) => {
        if (!current) return current;
        const option = current.options.find((entry) => entry.key === key);
        if (!option?.available) return current;
        const selected = new Set(current.selectedKeys);
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        return { ...current, selectedKeys: Array.from(selected) };
      });
    }}
    onSelectAll={() => {
      setCodeArchitectureReviewAnalysisModal((current) => (
        current
          ? { ...current, selectedKeys: current.options.filter((option) => option.available).map((option) => option.key) }
          : current
      ));
    }}
    onDeselectAll={() => {
      setCodeArchitectureReviewAnalysisModal((current) => (
        current ? { ...current, selectedKeys: [] } : current
      ));
    }}
    onCancel={() => {
      codeArchitectureReviewAnalysisSelectionRef.current?.(null);
      codeArchitectureReviewAnalysisSelectionRef.current = null;
      setCodeArchitectureReviewAnalysisModal(null);
    }}
    onConfirm={() => {
      const selectedKeys = codeArchitectureReviewAnalysisModal.selectedKeys;
      const selectedTargetIds = codeArchitectureReviewAnalysisModal.selectedTargetIds;
      const appName = String(codeArchitectureReviewAnalysisModal.appName || "").trim();
      const reviewAppTarget = codeArchitectureReviewAnalysisModal.reviewAppTarget || "mac";
      const destinationDirectory = String(codeArchitectureReviewAnalysisModal.destinationDirectory || "").trim();
      if (!appName || !selectedTargetIds?.length) return;
      codeArchitectureReviewAnalysisSelectionRef.current?.({ appName, selectedKeys, selectedTargetIds, reviewAppTarget, destinationDirectory });
      codeArchitectureReviewAnalysisSelectionRef.current = null;
      setCodeArchitectureReviewAnalysisModal(null);
    }}
  />
)}
      </main>
    </div>          {/* closes .flex */}
  </div>            {/* closes .pt-14 */}
  </>
  );
}


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

function Badge({ children }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded bg-gray-100 border border-gray-200">
      {children}
    </span>
  );
}

function EmptyState({ text }) {
  return <div className="text-sm text-gray-500">{text}</div>;
}

function App() {
  return (
    <ActivityProvider>
      <ResultsReviewProvider>
        <LiteXHandle />
      </ResultsReviewProvider>
    </ActivityProvider>
  );
}

export default App;
