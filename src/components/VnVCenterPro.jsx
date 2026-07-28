import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck,
  Copy,
  Download,
  FileInput,
  FilePlus2,
  Folder,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

const DOCS_KEY = "xhandle:vnv-test-case-documents";
const FOLDERS_KEY = "xhandle:vnv-test-case-folders";
const ACTIVE_DOC_KEY = "xhandle:vnv-active-document-id";
const PROJECT_DATA_KEY = "xhandle.projectData";

function uuid(prefix = "vnv") {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function nowISO() {
  return new Date().toISOString();
}

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function slug(value, fallback = "test-case-document") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function readProjectMap() {
  if (typeof localStorage === "undefined") return {};
  return safeParse(localStorage.getItem(PROJECT_DATA_KEY), {});
}

function loadAllDocs() {
  if (typeof localStorage === "undefined") return [];
  const docs = safeParse(localStorage.getItem(DOCS_KEY), []);
  return Array.isArray(docs) ? docs.map(normalizeDocument).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) : [];
}

function saveAllDocs(docs) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs || []));
    window.dispatchEvent?.(new CustomEvent("xhandle:vnv-documents-updated", { detail: docs || [] }));
  } catch {}
}

function loadFolders() {
  if (typeof localStorage === "undefined") return [];
  const folders = safeParse(localStorage.getItem(FOLDERS_KEY), []);
  return Array.isArray(folders) ? folders : [];
}

function saveFolders(folders) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders || []));
  } catch {}
  return folders || [];
}

function getActiveDocumentId() {
  try {
    return localStorage.getItem(ACTIVE_DOC_KEY) || null;
  } catch {
    return null;
  }
}

function setActiveDocumentId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_DOC_KEY, id);
    else localStorage.removeItem(ACTIVE_DOC_KEY);
  } catch {}
}

function normalizeRequirement(row, index = 0) {
  const attrs = row?.attributes || {};
  const id = row?.id || row?.requirementId || row?.tag || row?.key || attrs.ID || `REQ-${index + 1}`;
  const title = row?.title || row?.name || row?.Requirement || row?.requirement || row?.text || attrs.Requirement || id;
  return {
    id: String(id),
    title: String(title),
    description: String(row?.description || row?.summary || row?.rationale || attrs.Description || attrs.Rationale || ""),
    module: String(row?.module || row?.moduleName || attrs.Module || "Requirements"),
    verification: String(attrs.Verification || row?.verification || row?.method || "Test"),
    acceptance: String(attrs.Acceptance || attrs["Acceptance Criteria"] || row?.acceptance || row?.expected || ""),
    priority: String(row?.priority || attrs.Priority || "P2"),
    sourceType: row?.sourceType || row?.targetType || attrs.SourceType || "Requirement",
  };
}

function extractSafetyGoalsFromAnalysisResult(analysisResult) {
  const summary = analysisResult?.Summary;
  if (!Array.isArray(summary) || summary.length < 2 || !Array.isArray(summary[0])) return [];
  const [headers, ...rows] = summary;
  const goalIdx = headers.findIndex((header) => /safety\s*goal/i.test(String(header || "")));
  if (goalIdx < 0) return [];
  const hazardIdx = headers.findIndex((header) => /hazard|hazardous event|failure condition/i.test(String(header || "")));
  const asilIdx = headers.findIndex((header) => /asil|risk|rac|severity/i.test(String(header || "")));
  const seen = new Set();
  return rows.map((row, index) => {
    const goal = String(row?.[goalIdx] || "").trim();
    if (!goal) return null;
    const key = goal.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return null;
    seen.add(key);
    const hazard = hazardIdx >= 0 ? String(row?.[hazardIdx] || "").trim() : "";
    const asil = asilIdx >= 0 ? String(row?.[asilIdx] || "").trim() : "";
    return normalizeRequirement({
      id: `SG-${index + 1}`,
      title: goal,
      description: [hazard ? `Hazard context: ${hazard}` : "", asil ? `Risk classification: ${asil}` : ""].filter(Boolean).join(" | "),
      module: "Safety Goals",
      verification: "Test",
      acceptance: "Evidence demonstrates the safety goal is satisfied in the defined operational context.",
      priority: /D|C|high|catastrophic|critical/i.test(asil) ? "P1" : "P2",
      sourceType: "Safety Goal",
    });
  }).filter(Boolean);
}

function mergeTargets(items) {
  const merged = new Map();
  (items || []).forEach((item, index) => {
    const target = normalizeRequirement(item, index);
    const key = `${target.sourceType}:${target.id}`;
    if (!merged.has(key)) merged.set(key, target);
  });
  return Array.from(merged.values());
}

function getVerificationTargetsForProject(projectId, activeProjectId, activeRequirements = [], activeAnalysisResult = null) {
  let targets = [];
  const projectData = readProjectMap()?.[projectId] || {};

  if (String(projectId || "") === String(activeProjectId || "") && Array.isArray(activeRequirements) && activeRequirements.length) {
    targets.push(...activeRequirements.map(normalizeRequirement));
  }

  if (Array.isArray(projectData.requirements) && projectData.requirements.length) {
    targets.push(...projectData.requirements.map(normalizeRequirement));
  }

  const globalRequirements = safeParse(localStorage.getItem("xhandle:requirements"), []);
  const scoped = Array.isArray(globalRequirements)
    ? globalRequirements.filter((row) => !row?.projectId || String(row.projectId) === String(projectId))
    : [];
  targets.push(...scoped.map(normalizeRequirement));
  if (String(projectId || "") === String(activeProjectId || "") && activeAnalysisResult) {
    targets.push(...extractSafetyGoalsFromAnalysisResult(activeAnalysisResult));
  }
  targets.push(...extractSafetyGoalsFromAnalysisResult(projectData.analysisResult));
  return mergeTargets(targets);
}

function createTestCaseFromRequirement(requirement, index) {
  const sourceType = requirement.sourceType || "Requirement";
  const baseId = String(requirement.id || `REQ-${index + 1}`).replace(/\s+/g, "-");
  const expected = requirement.acceptance || `The implemented behavior satisfies ${sourceType.toLowerCase()} ${requirement.id}.`;
  return {
    id: `TC-${baseId}`,
    title: `Verify ${requirement.title}`,
    requirementId: requirement.id,
    requirementTitle: requirement.title,
    targetType: sourceType,
    method: /analysis|inspect|review/i.test(requirement.verification) ? requirement.verification : "Test",
    priority: requirement.priority || "P2",
    status: "Draft",
    objective: `Demonstrate that ${requirement.title}`,
    preconditions: [
      "System under test is configured for the target operational context.",
      "Required instrumentation, logs, and review evidence capture are available.",
    ],
    steps: [
      "Review the requirement text, acceptance criteria, and linked design or hazard context.",
      "Configure the system with nominal inputs and operating conditions relevant to the requirement.",
      "Exercise the behavior or scenario addressed by the requirement.",
      "Record observed outputs, logs, decisions, and deviations.",
    ],
    expectedResults: [expected],
    evidence: "",
    notes: "",
  };
}

function buildDocumentFromRequirements({ project, requirements, folderId, name }) {
  const timestamp = nowISO();
  const normalizedRequirements = (requirements || []).map(normalizeRequirement);
  const testCases = normalizedRequirements.map(createTestCaseFromRequirement);
  return normalizeDocument({
    id: uuid("vnv-doc"),
    projectId: project?.id || null,
    sourceProjectId: project?.id || null,
    folderId: folderId || null,
    name: name || `${project?.name || "Project"} Test Case Document`,
    description: "Generated V&V test case document derived from project requirements and safety goals.",
    scope: "Verify that requirements and safety goals are satisfied by executable tests, inspections, demonstrations, or analysis as appropriate.",
    assumptions: [
      "Verification targets are approved enough to form a test baseline.",
      "Each generated test case must be reviewed before execution.",
    ],
    entryCriteria: [
      "Requirements and safety goals are uniquely identified.",
      "The test environment and required evidence capture are available.",
    ],
    exitCriteria: [
      "All applicable test cases have an execution status and linked evidence.",
      "Failures, blockers, and uncovered requirements are dispositioned.",
    ],
    requirements: normalizedRequirements,
    testCases,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createBlankDocument({ projectId, folderId, name }) {
  const timestamp = nowISO();
  return normalizeDocument({
    id: uuid("vnv-doc"),
    projectId: projectId || null,
    sourceProjectId: projectId || null,
    folderId: folderId || null,
    name: name || "Untitled Test Case Document",
    description: "",
    scope: "",
    assumptions: [],
    entryCriteria: [],
    exitCriteria: [],
    requirements: [],
    testCases: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function normalizeDocument(raw = {}) {
  return {
    id: raw.id || uuid("vnv-doc"),
    projectId: raw.projectId ?? raw.sourceProjectId ?? null,
    sourceProjectId: raw.sourceProjectId ?? raw.projectId ?? null,
    folderId: raw.folderId ?? null,
    name: raw.name || "Untitled Test Case Document",
    description: raw.description || "",
    scope: raw.scope || "",
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
    entryCriteria: Array.isArray(raw.entryCriteria) ? raw.entryCriteria.map(String) : [],
    exitCriteria: Array.isArray(raw.exitCriteria) ? raw.exitCriteria.map(String) : [],
    requirements: Array.isArray(raw.requirements) ? raw.requirements.map(normalizeRequirement) : [],
    testCases: Array.isArray(raw.testCases) ? raw.testCases.map((test, index) => ({
      id: test?.id || `TC-${index + 1}`,
      title: test?.title || test?.name || `Test Case ${index + 1}`,
      requirementId: test?.requirementId || test?.links?.requirementId || "",
      requirementTitle: test?.requirementTitle || "",
      targetType: test?.targetType || test?.sourceType || "Requirement",
      method: test?.method || test?.kind || "Test",
      priority: test?.priority || "P2",
      status: test?.status || "Draft",
      objective: test?.objective || test?.description || "",
      preconditions: Array.isArray(test?.preconditions) ? test.preconditions.map(String) : [],
      steps: Array.isArray(test?.steps) ? test.steps.map(String) : [],
      expectedResults: Array.isArray(test?.expectedResults) ? test.expectedResults.map(String) : (test?.expected ? [String(test.expected)] : []),
      evidence: test?.evidence || "",
      notes: test?.notes || "",
    })) : [],
    createdAt: raw.createdAt || nowISO(),
    updatedAt: raw.updatedAt || nowISO(),
  };
}

function documentStats(document) {
  const tests = document?.testCases || [];
  const reqIds = new Set((document?.requirements || []).map((req) => req.id));
  const covered = new Set(tests.map((test) => test.requirementId).filter(Boolean));
  const executed = tests.filter((test) => /pass|fail|blocked|executed/i.test(test.status || "")).length;
  const safetyGoals = (document?.requirements || []).filter((req) => /safety\s*goal/i.test(req.sourceType || "")).length;
  return {
    requirements: reqIds.size,
    safetyGoals,
    testCases: tests.length,
    coveredRequirements: Array.from(reqIds).filter((id) => covered.has(id)).length,
    executed,
    coveragePct: reqIds.size ? Math.round((Array.from(reqIds).filter((id) => covered.has(id)).length / reqIds.size) * 100) : 0,
  };
}

function toListText(items) {
  return (items || []).join("\n");
}

function fromListText(value) {
  return String(value || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function exportMarkdown(document) {
  const lines = [
    `# ${document.name}`,
    "",
    `Generated/Updated: ${document.updatedAt}`,
    "",
    "## Description",
    document.description || "-",
    "",
    "## Scope",
    document.scope || "-",
    "",
    "## Entry Criteria",
    ...(document.entryCriteria.length ? document.entryCriteria.map((item) => `- ${item}`) : ["-"]),
    "",
    "## Exit Criteria",
    ...(document.exitCriteria.length ? document.exitCriteria.map((item) => `- ${item}`) : ["-"]),
    "",
    "## Test Cases",
  ];

  (document.testCases || []).forEach((test) => {
    lines.push(
      "",
      `### ${test.id}: ${test.title}`,
      "",
      `- Verification Target: ${test.requirementId || "-"}`,
      `- Target Type: ${test.targetType || "Requirement"}`,
      `- Method: ${test.method || "Test"}`,
      `- Priority: ${test.priority || "P2"}`,
      `- Status: ${test.status || "Draft"}`,
      "",
      `Objective: ${test.objective || "-"}`,
      "",
      "Steps:",
      ...(test.steps.length ? test.steps.map((step, index) => `${index + 1}. ${step}`) : ["1. -"]),
      "",
      "Expected Results:",
      ...(test.expectedResults.length ? test.expectedResults.map((item) => `- ${item}`) : ["-"]),
    );
  });

  return lines.join("\n");
}

function downloadFile(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[84vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button className="rounded px-2 py-1 text-sm hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function GenerateDocumentModal({ folders, generation, onChange, onClose, onGenerate, projects, activeProjectId, activeRequirements, activeAnalysisResult }) {
  const selectedTargets = getVerificationTargetsForProject(generation.sourceProjectId, activeProjectId, activeRequirements, activeAnalysisResult);
  const targetCounts = selectedTargets.reduce((acc, target) => {
    const key = /safety\s*goal/i.test(target.sourceType || "") ? "safetyGoals" : "requirements";
    acc[key] += 1;
    return acc;
  }, { requirements: 0, safetyGoals: 0 });
  return (
    <Modal title="Generate Test Case Document From Verification Targets" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Source xHandle project</label>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={generation.sourceProjectId || ""}
            onChange={(event) => {
              const project = projects.find((item) => String(item.id) === String(event.target.value));
              onChange({
                ...generation,
                sourceProjectId: event.target.value,
                name: project?.name ? `${project.name} Test Case Document` : generation.name,
              });
            }}
          >
            <option value="">Choose a project...</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <div className="mt-1 text-xs text-gray-500">
            {selectedTargets.length} verification target{selectedTargets.length === 1 ? "" : "s"} available: {targetCounts.requirements} requirement{targetCounts.requirements === 1 ? "" : "s"}, {targetCounts.safetyGoals} safety goal{targetCounts.safetyGoals === 1 ? "" : "s"}.
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Document name</label>
          <input className="w-full rounded-md border px-3 py-2" value={generation.name} onChange={(event) => onChange({ ...generation, name: event.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Destination folder</label>
          <select className="w-full rounded-md border px-3 py-2" value={generation.folderId || ""} onChange={(event) => onChange({ ...generation, folderId: event.target.value || null })}>
            <option value="">No folder</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{`${"  ".repeat(folder.depth || 0)}${folder.name}`}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="rounded-md border px-3 py-2 text-xs" onClick={onClose}>Cancel</button>
          <button className="inline-flex items-center gap-1.5 rounded-md bg-[#2D7DFE] px-3 py-2 text-xs font-semibold text-white" onClick={() => onGenerate(generation)}>
            <Sparkles size={14} /> Generate
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ToolbarButton({ icon: Icon, children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

export default function VnVCenterPro({
  activeProject,
  activeProjectId,
  analysisResult,
  requirements,
  vnvArtifacts,
  setVnvArtifacts,
  saveProjectPatch,
  projects = [],
}) {
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [document, setDocument] = useState(null);
  const [selectedTestId, setSelectedTestId] = useState(null);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [message, setMessage] = useState("");
  const [tableFilters, setTableFilters] = useState({
    id: "",
    title: "",
    requirementId: "",
    requirementDetails: "",
    targetType: "",
    method: "",
    status: "",
  });
  const [generation, setGeneration] = useState({
    sourceProjectId: activeProjectId || "",
    name: `${activeProject?.name || "Project"} Test Case Document`,
    folderId: null,
  });

  const refresh = useCallback(() => {
    const list = loadAllDocs();
    const folderList = loadFolders();
    setDocuments(list);
    setFolders(folderList);
    const activeId = getActiveDocumentId();
    const active = (activeId && list.find((item) => item.id === activeId)) || list[0] || null;
    setDocument(active);
    if (active?.folderId) setSelectedFolderId(active.folderId);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    setGeneration((current) => ({
      ...current,
      sourceProjectId: current.sourceProjectId || activeProjectId || "",
      name: current.name || `${activeProject?.name || "Project"} Test Case Document`,
      folderId: current.folderId ?? selectedFolderId,
    }));
  }, [activeProject?.name, activeProjectId, selectedFolderId]);

  const folderRows = useMemo(() => {
    const byParent = folders.reduce((acc, folder) => {
      const key = folder.parentId || "root";
      if (!acc[key]) acc[key] = [];
      acc[key].push(folder);
      return acc;
    }, {});
    const rows = [];
    const visit = (parentId = "root", depth = 0) => {
      (byParent[parentId] || []).sort((a, b) => a.name.localeCompare(b.name)).forEach((folder) => {
        rows.push({ ...folder, depth });
        visit(folder.id, depth + 1);
      });
    };
    visit();
    return rows;
  }, [folders]);

  const filteredDocuments = useMemo(
    () => documents.filter((item) => (selectedFolderId ? item.folderId === selectedFolderId : true)),
    [documents, selectedFolderId]
  );

  const selectedFolderName = folders.find((folder) => folder.id === selectedFolderId)?.name || "All Test Case Documents";
  const selectedTest = useMemo(() => document?.testCases?.find((test) => test.id === selectedTestId) || document?.testCases?.[0] || null, [document, selectedTestId]);
  const stats = useMemo(() => documentStats(document), [document]);
  const requirementDetailsById = useMemo(() => {
    const details = new Map();
    (document?.requirements || []).forEach((requirement) => {
      details.set(requirement.id, [
        requirement.sourceType || "Requirement",
        requirement.title,
        requirement.description,
        requirement.acceptance ? `Acceptance: ${requirement.acceptance}` : "",
      ].filter(Boolean).join(" | "));
    });
    return details;
  }, [document]);
  const filteredTestCases = useMemo(() => {
    const matches = (value, filter) => String(value || "").toLowerCase().includes(String(filter || "").trim().toLowerCase());
    return (document?.testCases || []).filter((test) => (
      matches(test.id, tableFilters.id)
      && matches(test.title, tableFilters.title)
      && matches(test.requirementId, tableFilters.requirementId)
      && matches(requirementDetailsById.get(test.requirementId) || test.requirementTitle, tableFilters.requirementDetails)
      && matches(test.targetType, tableFilters.targetType)
      && matches(test.method, tableFilters.method)
      && matches(test.status, tableFilters.status)
    ));
  }, [document?.testCases, requirementDetailsById, tableFilters]);
  const setTableFilter = (key, value) => setTableFilters((current) => ({ ...current, [key]: value }));

  const persist = useCallback((next = document, notice = "Test case document saved.") => {
    if (!next) return null;
    const saved = normalizeDocument({ ...next, updatedAt: nowISO() });
    const all = loadAllDocs();
    const updated = [saved, ...all.filter((item) => item.id !== saved.id)];
    saveAllDocs(updated);
    setActiveDocumentId(saved.id);
    setDocument(saved);
    setDocuments(updated);
    setMessage(notice);

    const savedStats = documentStats(saved);
    const legacyArtifacts = {
      ...(vnvArtifacts || {}),
      summary: {
        generatedAt: saved.updatedAt,
        totals: {
          requirements: savedStats.requirements,
          safetyGoals: savedStats.safetyGoals,
          testCases: saved.testCases.length,
          coveredRequirements: savedStats.coveredRequirements,
        },
      },
      testCases: saved.testCases,
      tests: saved.testCases,
      trace: saved.testCases.map((test) => ({ TestId: test.id, Target: test.requirementId, TargetType: test.targetType, Status: test.status })),
      testCaseDocument: saved,
    };
    setVnvArtifacts?.(legacyArtifacts);
    if (saved.sourceProjectId || activeProjectId) {
      saveProjectPatch?.(saved.sourceProjectId || activeProjectId, { vnvArtifacts: legacyArtifacts });
    }
    try {
      localStorage.setItem("xhandle:vnv-center", JSON.stringify(saved.testCases.map((test) => ({
        ...test,
        projectId: saved.sourceProjectId || saved.projectId,
        projectName: projects.find((project) => String(project.id) === String(saved.sourceProjectId || saved.projectId))?.name || activeProject?.name || "",
      }))));
    } catch {}
    return saved;
  }, [activeProject?.name, activeProjectId, projects, saveProjectPatch, setVnvArtifacts, vnvArtifacts, document]);

  const createFolder = () => {
    const name = window.prompt("Folder name", "New Folder");
    if (!name) return;
    const folder = { id: uuid("vnv-folder"), name: name.trim() || "New Folder", parentId: selectedFolderId || null, createdAt: nowISO(), updatedAt: nowISO() };
    const next = saveFolders([...folders, folder]);
    setFolders(next);
    setSelectedFolderId(folder.id);
  };

  const renameFolder = (folder) => {
    const name = window.prompt("Folder name", folder.name);
    if (name === null) return;
    const next = saveFolders(folders.map((item) => item.id === folder.id ? { ...item, name: name.trim() || item.name, updatedAt: nowISO() } : item));
    setFolders(next);
  };

  const deleteFolder = (folder) => {
    if (!window.confirm(`Delete folder "${folder.name}"? Documents will move to no folder.`)) return;
    const nextFolders = saveFolders(folders.filter((item) => item.id !== folder.id && item.parentId !== folder.id));
    const nextDocs = loadAllDocs().map((item) => item.folderId === folder.id ? { ...item, folderId: null, updatedAt: nowISO() } : item);
    saveAllDocs(nextDocs);
    setFolders(nextFolders);
    setSelectedFolderId(null);
    refresh();
  };

  const createBlank = () => {
    const name = window.prompt("Test case document name", "Untitled Test Case Document");
    if (name === null) return;
    const created = createBlankDocument({ projectId: activeProjectId, folderId: selectedFolderId, name });
    persist(created, "Blank test case document created.");
    setSelectedTestId(null);
  };

  const generateFromProject = ({ sourceProjectId, name, folderId } = generation) => {
    if (!sourceProjectId) {
      setMessage("Choose a project to generate from.");
      setGenerateModalOpen(true);
      return;
    }
    const project = projects.find((item) => String(item.id) === String(sourceProjectId)) || { id: sourceProjectId, name: activeProject?.name || "Selected Project" };
    const sourceTargets = getVerificationTargetsForProject(sourceProjectId, activeProjectId, requirements, analysisResult);
    if (!sourceTargets.length) {
      setMessage("No requirements or safety goals were found for that project.");
      return;
    }
    const generated = buildDocumentFromRequirements({ project, requirements: sourceTargets, folderId: folderId ?? selectedFolderId, name });
    persist(generated, `Generated ${generated.testCases.length} test case${generated.testCases.length === 1 ? "" : "s"} from verification targets.`);
    setGenerateModalOpen(false);
    setSelectedTestId(generated.testCases[0]?.id || null);
  };

  const duplicateDocument = () => {
    if (!document) return;
    const copy = normalizeDocument({
      ...document,
      id: uuid("vnv-doc"),
      name: `${document.name} Copy`,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    persist(copy, "Test case document duplicated.");
  };

  const deleteDocument = () => {
    if (!document) return;
    if (!window.confirm(`Delete "${document.name}"?`)) return;
    const next = loadAllDocs().filter((item) => item.id !== document.id);
    saveAllDocs(next);
    setActiveDocumentId(null);
    setDocument(next[0] || null);
    setDocuments(next);
    setSelectedTestId(null);
    setMessage("Test case document deleted.");
  };

  const importJson = async (file) => {
    if (!file) return;
    try {
      const imported = normalizeDocument(JSON.parse(await file.text()));
      persist({ ...imported, folderId: imported.folderId ?? selectedFolderId }, "Imported test case document.");
    } catch (error) {
      setMessage(error.message || "Invalid test case document JSON.");
    }
  };

  const updateDocument = (patch) => {
    setDocument((current) => current ? normalizeDocument({ ...current, ...patch }) : current);
  };

  const updateSelectedTest = (patch) => {
    if (!document || !selectedTest) return;
    const nextTests = document.testCases.map((test) => test.id === selectedTest.id ? { ...test, ...patch } : test);
    updateDocument({ testCases: nextTests });
    if (patch.id && patch.id !== selectedTest.id) setSelectedTestId(patch.id);
  };

  if (!document) {
    return (
      <div className="flex h-full flex-col overflow-auto bg-white px-6 py-5">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold">V&V Center</h1>
          <p className="text-sm text-gray-500">Generate and manage test case documents from project requirements and safety goals.</p>
        </div>
        <div className="flex min-h-[520px] items-center justify-center rounded-lg border bg-gray-50 p-8 text-center">
          <div className="max-w-2xl">
            <ClipboardCheck className="mx-auto mb-4 text-[#2D7DFE]" size={44} />
            <h2 className="text-2xl font-semibold">Build a Test Case Document</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">Create a V&V document workspace that derives test cases from requirements and safety goals, then review, edit, execute, and export the resulting traceable test set.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button className="rounded-md bg-[#2D7DFE] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f66d1]" onClick={() => setGenerateModalOpen(true)}>Generate From Targets</button>
              <button className="rounded-md border bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={createBlank}>Create Blank Document</button>
            </div>
          </div>
        </div>
        {generateModalOpen && (
          <GenerateDocumentModal
            activeProjectId={activeProjectId}
            activeAnalysisResult={analysisResult}
            activeRequirements={requirements}
            folders={folderRows}
            generation={generation}
            onChange={setGeneration}
            onClose={() => setGenerateModalOpen(false)}
            onGenerate={generateFromProject}
            projects={projects}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="border-b px-4 py-2">
        <h1 className="text-xl font-semibold">V&V Center</h1>
        <p className="text-xs text-gray-500">Requirement and safety-goal-driven test case documents with project-style management.</p>
        {message && <div className="mt-2 text-xs text-gray-500">{message}</div>}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto border-b bg-gray-50 px-2 py-1.5">
        <ToolbarButton icon={FilePlus2} onClick={createBlank}>New Document</ToolbarButton>
        <ToolbarButton icon={Sparkles} onClick={() => setGenerateModalOpen(true)}>Generate</ToolbarButton>
        <ToolbarButton icon={Save} onClick={() => persist()}>Save</ToolbarButton>
        <ToolbarButton icon={Copy} onClick={duplicateDocument}>Duplicate</ToolbarButton>
        <ToolbarButton icon={Download} onClick={() => downloadFile(`${slug(document.name)}.json`, JSON.stringify(document, null, 2))}>JSON</ToolbarButton>
        <ToolbarButton icon={Download} onClick={() => downloadFile(`${slug(document.name)}.md`, exportMarkdown(document), "text/markdown")}>Markdown</ToolbarButton>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <Upload size={14} /> Import
          <input className="hidden" type="file" accept="application/json,.json" onChange={(event) => importJson(event.target.files?.[0])} />
        </label>
        <ToolbarButton icon={Trash2} className="text-red-600 hover:bg-red-50" onClick={deleteDocument}>Delete</ToolbarButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        {leftPanelCollapsed ? (
          <div className="flex shrink-0 border-r bg-gray-50 p-1.5 xl:w-10 xl:flex-col">
            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white text-gray-600 shadow-sm hover:bg-gray-50" title="Show V&V documents" onClick={() => setLeftPanelCollapsed(false)}>
              <PanelLeftOpen size={16} />
            </button>
          </div>
        ) : (
          <aside className="max-h-44 w-full shrink-0 overflow-auto border-r bg-gray-50 p-2 xl:max-h-none xl:w-52">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase text-gray-500">Test Case Projects</div>
              <div className="flex items-center gap-1">
                <button className="rounded-md p-1.5 text-gray-600 hover:bg-white" title="New folder" onClick={createFolder}><FolderPlus size={16} /></button>
                <button className="rounded-md p-1.5 text-gray-600 hover:bg-white" title="Hide test case projects" onClick={() => setLeftPanelCollapsed(true)}><PanelLeftClose size={16} /></button>
              </div>
            </div>
            {folderRows.map((folder) => (
              <div key={folder.id} className="group flex items-center gap-1">
                <button
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${selectedFolderId === folder.id ? "bg-white font-medium text-[#2D7DFE]" : "text-gray-700 hover:bg-white"}`}
                  onClick={() => setSelectedFolderId(folder.id)}
                  style={{ paddingLeft: `${8 + folder.depth * 16}px` }}
                  title={folder.name}
                >
                  <Folder size={15} />
                  <span className="truncate">{folder.name}</span>
                </button>
                <button className="invisible rounded p-1 text-gray-600 hover:bg-white group-hover:visible" title="Rename folder" onClick={() => renameFolder(folder)}><Pencil size={13} /></button>
                <button className="invisible rounded p-1 text-red-600 hover:bg-red-50 group-hover:visible" title="Delete folder" onClick={() => deleteFolder(folder)}><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="mt-3 border-t pt-2">
              <div className="mb-2 text-xs font-semibold text-gray-500">{selectedFolderName}</div>
              <div className="space-y-1">
                {filteredDocuments.map((item) => {
                  const itemStats = documentStats(item);
                  return (
                    <button
                      key={item.id}
                      className={`w-full rounded-md px-2 py-2 text-left text-sm ${document?.id === item.id ? "bg-[#ECEEFF] text-gray-900" : "text-gray-700 hover:bg-white"}`}
                      onClick={() => {
                        setActiveDocumentId(item.id);
                        setDocument(item);
                        setSelectedTestId(item.testCases?.[0]?.id || null);
                      }}
                    >
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="truncate text-[11px] text-gray-500">{itemStats.testCases} tests, {itemStats.coveragePct}% target coverage</div>
                    </button>
                  );
                })}
                {!filteredDocuments.length && <div className="rounded-md border border-dashed bg-white p-3 text-xs text-gray-500">No test case documents in this folder.</div>}
              </div>
            </div>
          </aside>
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-auto p-2">
          <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-md border bg-white p-2"><div className="text-xs text-gray-500">Targets</div><div className="text-lg font-semibold">{stats.requirements}</div></div>
            <div className="rounded-md border bg-white p-2"><div className="text-xs text-gray-500">Safety Goals</div><div className="text-lg font-semibold">{stats.safetyGoals}</div></div>
            <div className="rounded-md border bg-white p-2"><div className="text-xs text-gray-500">Test Cases</div><div className="text-lg font-semibold">{stats.testCases}</div></div>
            <div className="rounded-md border bg-white p-2"><div className="text-xs text-gray-500">Coverage</div><div className="text-lg font-semibold">{stats.coveragePct}%</div></div>
          </div>

          <details className="rounded-lg border bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              <span>Document Details</span>
              <span className="truncate text-xs font-normal text-gray-500">{document.name}</span>
            </summary>
            <div className="space-y-2 border-t p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Document name</label>
                  <input className="w-full rounded-md border px-2 py-1.5 text-sm" value={document.name} onChange={(event) => updateDocument({ name: event.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Source project</label>
                  <input className="w-full rounded-md border bg-gray-50 px-2 py-1.5 text-sm" value={projects.find((project) => String(project.id) === String(document.sourceProjectId))?.name || activeProject?.name || "Selected Project"} readOnly />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
                <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5 text-sm" value={document.description} onChange={(event) => updateDocument({ description: event.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Scope</label>
                <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5 text-sm" value={document.scope} onChange={(event) => updateDocument({ scope: event.target.value })} />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Assumptions</label>
                  <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5 text-sm" value={toListText(document.assumptions)} onChange={(event) => updateDocument({ assumptions: fromListText(event.target.value) })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Entry Criteria</label>
                  <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5 text-sm" value={toListText(document.entryCriteria)} onChange={(event) => updateDocument({ entryCriteria: fromListText(event.target.value) })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Exit Criteria</label>
                  <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5 text-sm" value={toListText(document.exitCriteria)} onChange={(event) => updateDocument({ exitCriteria: fromListText(event.target.value) })} />
                </div>
              </div>
            </div>
          </details>

          <div className="mt-2 rounded-lg border bg-white">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-sm font-semibold">Generated Test Cases</h2>
              <button
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs hover:bg-gray-50"
                onClick={() => {
                  const test = createTestCaseFromRequirement({ id: `MANUAL-${document.testCases.length + 1}`, title: "Manual requirement, safety goal, or verification objective", sourceType: "Verification Target" }, document.testCases.length);
                  updateDocument({ testCases: [...document.testCases, test] });
                  setSelectedTestId(test.id);
                }}
              >
                <FileInput size={14} /> Add Test
              </button>
            </div>
            <div className="max-h-[calc(100vh-360px)] min-h-[300px] overflow-auto">
              <table className="min-w-[980px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500 shadow-sm">
                  <tr>
                    <th className="px-2 py-2">ID</th>
                    <th className="px-2 py-2">Title</th>
                    <th className="px-2 py-2">Target</th>
                    <th className="px-2 py-2">Target Details</th>
                    <th className="px-2 py-2">Target Type</th>
                    <th className="px-2 py-2">Method</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                  <tr className="border-t bg-white normal-case">
                    <th className="px-2 pb-2">
                      <input className="w-20 rounded border px-2 py-1 text-xs font-normal" value={tableFilters.id} onChange={(event) => setTableFilter("id", event.target.value)} placeholder="ID" />
                    </th>
                    <th className="px-2 pb-2">
                      <input className="w-36 rounded border px-2 py-1 text-xs font-normal" value={tableFilters.title} onChange={(event) => setTableFilter("title", event.target.value)} placeholder="Title" />
                    </th>
                    <th className="px-2 pb-2">
                      <input className="w-28 rounded border px-2 py-1 text-xs font-normal" value={tableFilters.requirementId} onChange={(event) => setTableFilter("requirementId", event.target.value)} placeholder="Target" />
                    </th>
                    <th className="px-2 pb-2">
                      <input className="w-40 rounded border px-2 py-1 text-xs font-normal" value={tableFilters.requirementDetails} onChange={(event) => setTableFilter("requirementDetails", event.target.value)} placeholder="Details" />
                    </th>
                    <th className="px-2 pb-2">
                      <select className="w-28 rounded border px-2 py-1 text-xs font-normal" value={tableFilters.targetType} onChange={(event) => setTableFilter("targetType", event.target.value)}>
                        <option value="">All</option>
                        {["Requirement", "Safety Goal", "Verification Target"].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </th>
                    <th className="px-2 pb-2">
                      <select className="w-24 rounded border px-2 py-1 text-xs font-normal" value={tableFilters.method} onChange={(event) => setTableFilter("method", event.target.value)}>
                        <option value="">All</option>
                        {["Test", "Analysis", "Inspection", "Demonstration"].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </th>
                    <th className="px-2 pb-2">
                      <select className="w-24 rounded border px-2 py-1 text-xs font-normal" value={tableFilters.status} onChange={(event) => setTableFilter("status", event.target.value)}>
                        <option value="">All</option>
                        {["Draft", "Ready", "Pass", "Fail", "Blocked", "Deferred"].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTestCases.map((test) => (
                    <tr key={test.id} className={`cursor-pointer border-t hover:bg-gray-50 ${selectedTest?.id === test.id ? "bg-[#F4F8FF]" : ""}`} onClick={() => setSelectedTestId(test.id)}>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{test.id}</td>
                      <td className="px-2 py-2">{test.title}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{test.requirementId || "-"}</td>
                      <td className="max-w-xs px-2 py-2 text-xs text-gray-600">
                        <div className="line-clamp-2" title={requirementDetailsById.get(test.requirementId) || test.requirementTitle || ""}>
                          {requirementDetailsById.get(test.requirementId) || test.requirementTitle || "-"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs">{test.targetType || "Requirement"}</td>
                      <td className="px-2 py-2">{test.method}</td>
                      <td className="px-2 py-2">{test.status}</td>
                    </tr>
                  ))}
                  {!filteredTestCases.length && (
                    <tr><td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={7}>{document.testCases.length ? "No test cases match the current filters." : "No test cases yet. Generate from targets or add one manually."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>

        {rightPanelCollapsed ? (
          <div className="flex max-h-[calc(100vh-8rem)] shrink-0 overflow-hidden border-l bg-white p-1.5 xl:w-10 xl:flex-col">
            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white text-gray-600 shadow-sm hover:bg-gray-50" title="Show test case inspector" onClick={() => setRightPanelCollapsed(false)}>
              <PanelRightOpen size={16} />
            </button>
          </div>
        ) : (
          <div className="relative min-h-0 max-h-[calc(100vh-8rem)] w-full shrink-0 overflow-hidden xl:w-72">
            <button
              className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-gray-600 hover:bg-gray-100"
              title="Hide test case inspector"
              aria-label="Hide test case inspector"
              onClick={() => setRightPanelCollapsed(true)}
            >
              <PanelRightClose size={16} />
            </button>
            <aside className="h-full max-h-[calc(100vh-8rem)] w-full overflow-y-auto overscroll-contain border-l bg-white p-2">
              <div className="flex items-center justify-between gap-2 pr-8">
                <h2 className="min-w-0 truncate text-sm font-semibold">Test Case Inspector</h2>
                {selectedTest && (
                  <button
                    className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50"
                    title="Delete test case"
                    onClick={() => {
                      updateDocument({ testCases: document.testCases.filter((test) => test.id !== selectedTest.id) });
                      setSelectedTestId(document.testCases.find((test) => test.id !== selectedTest.id)?.id || null);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              {!selectedTest ? (
                <div className="mt-3 rounded-md border border-dashed p-4 text-sm text-gray-500">Select a test case to edit it.</div>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">ID</label>
                <input className="w-full rounded-md border px-2 py-1.5" value={selectedTest.id} onChange={(event) => updateSelectedTest({ id: event.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Title</label>
                <input className="w-full rounded-md border px-2 py-1.5" value={selectedTest.title} onChange={(event) => updateSelectedTest({ title: event.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Method</label>
                  <select className="w-full rounded-md border px-2 py-1.5" value={selectedTest.method} onChange={(event) => updateSelectedTest({ method: event.target.value })}>
                    {["Test", "Analysis", "Inspection", "Demonstration"].map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Status</label>
                  <select className="w-full rounded-md border px-2 py-1.5" value={selectedTest.status} onChange={(event) => updateSelectedTest({ status: event.target.value })}>
                    {["Draft", "Ready", "Pass", "Fail", "Blocked", "Deferred"].map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Target ID</label>
                <input className="w-full rounded-md border px-2 py-1.5 font-mono text-xs" value={selectedTest.requirementId} onChange={(event) => updateSelectedTest({ requirementId: event.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Target Type</label>
                <select className="w-full rounded-md border px-2 py-1.5" value={selectedTest.targetType || "Requirement"} onChange={(event) => updateSelectedTest({ targetType: event.target.value })}>
                  {["Requirement", "Safety Goal", "Verification Target"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Objective</label>
                <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5" value={selectedTest.objective} onChange={(event) => updateSelectedTest({ objective: event.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Preconditions</label>
                <textarea className="min-h-16 w-full rounded-md border px-2 py-1.5" value={toListText(selectedTest.preconditions)} onChange={(event) => updateSelectedTest({ preconditions: fromListText(event.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Steps</label>
                <textarea className="min-h-20 w-full rounded-md border px-2 py-1.5" value={toListText(selectedTest.steps)} onChange={(event) => updateSelectedTest({ steps: fromListText(event.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Expected Results</label>
                <textarea className="min-h-16 w-full rounded-md border px-2 py-1.5" value={toListText(selectedTest.expectedResults)} onChange={(event) => updateSelectedTest({ expectedResults: fromListText(event.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Evidence</label>
                <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5" value={selectedTest.evidence} onChange={(event) => updateSelectedTest({ evidence: event.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <textarea className="min-h-14 w-full rounded-md border px-2 py-1.5" value={selectedTest.notes} onChange={(event) => updateSelectedTest({ notes: event.target.value })} />
              </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      {generateModalOpen && (
        <GenerateDocumentModal
          activeProjectId={activeProjectId}
          activeAnalysisResult={analysisResult}
          activeRequirements={requirements}
          folders={folderRows}
          generation={generation}
          onChange={setGeneration}
          onClose={() => setGenerateModalOpen(false)}
          onGenerate={generateFromProject}
          projects={projects}
        />
      )}
    </div>
  );
}
