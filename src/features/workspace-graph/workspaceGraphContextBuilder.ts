import {projectOverviewScope, readProjectOverviewSample} from './workspaceOverview';
import type { WorkspaceIndexProgress } from './workspaceGraphMigrationCore';
import { queryWorkspaceCandidates, workspaceGraphCounts, relationshipsForArtifacts } from './workspaceGraphQueries';
import {
  getLatestWorkspaceGraphMigrationDiagnostics,
  migrateLegacyStorageToWorkspaceGraphIfStale,
} from "./legacyWorkspaceGraphMigrator";
import {
  getArtifact,
  getNeighborhood,
  listEvidence,
  listProjects,
  listReviews,
  listRuns,
  listSourceFiles,
} from "./workspaceGraphRepository";
import { searchArtifacts } from "./workspaceGraphSearch";
import { artifactTypesForAreas } from "./workspaceGraphCapabilities";
import { workspaceIndexScope, requestedWorkspaceIndexScope, scopeWorkspaceIndex } from './workspaceIndexScope';
import {
  DEFAULT_WORKSPACE_ID,
  type WorkspaceArtifact,
  type WorkspaceLLMContext,
  type WorkspaceRelationship,
  type WorkspaceSourceFile,
} from "./workspaceGraphTypes";

const DEFAULT_TOKEN_BUDGET = 6000;
const HAZARD_CONTEXT_ARTIFACT_TYPES = new Set([
  "hazard_analysis_row",
  "code_architecture_hazard_row",
  "risk",
  "safety_finding",
  "safety_case",
  "safety_case_node",
]);

function isHazardAnalysisQuery(query = "") {
  return /\b(hazards?|hazardous|unsafe control actions?|ucas?|guide phrases?|guide words?|stpa|fha|hara|what[- ]if|risk assessments?|safety issues?|causal factors?|mitigations?)\b/i.test(String(query || ""));
}

type WorkspaceContextArgs = {
  onProgress?: (value:WorkspaceIndexProgress)=>void;
  projectId?: string | null;
  activeView?: any;
  query?: string;
  tokenBudget?: number;
  areas?: string[];
  contextOnDemand?: boolean;
  signal?: AbortSignal;
};

type ArtifactContextArgs = {
  artifactId: string;
  depth?: number;
  tokenBudget?: number;
};

function clamp<T>(rows: T[] = [], limit: number) {
  return rows.slice(0, Math.max(0, limit));
}

function compactValue(value: any, max = 900): any {
  if (value == null) return value;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (raw.length <= max) return value;
  return `${raw.slice(0, max)}...`;
}

function compactFunctionalCanvasSelection(selection: any) {
  if (!selection || typeof selection !== "object" || !selection.hasSelection) return null;
  return {
    hasSelection: true,
    selectedNodes: clamp(Array.isArray(selection.selectedNodes) ? selection.selectedNodes : [], 12).map((node: any) => ({
      id: compactValue(node?.id || "", 180),
      type: compactValue(node?.type || "", 80),
      label: compactValue(node?.label || "", 220),
      description: compactValue(node?.description || "", 700),
      subsystem: compactValue(node?.subsystem || "", 220),
      memberFunctions: clamp(Array.isArray(node?.memberFunctions) ? node.memberFunctions : [], 30).map((label: any) => compactValue(label, 220)),
      comments: clamp(Array.isArray(node?.comments) ? node.comments : [], 12).map((comment: any) => ({
        id: compactValue(comment?.id || "", 180),
        text: compactValue(comment?.text || "", 700),
        createdAt: comment?.createdAt || null,
      })),
    })),
    selectedEdge: selection.selectedEdge ? {
      id: compactValue(selection.selectedEdge.id || "", 180),
      label: compactValue(selection.selectedEdge.label || "", 260),
      source: compactValue(selection.selectedEdge.source || "", 220),
      target: compactValue(selection.selectedEdge.target || "", 220),
      description: compactValue(selection.selectedEdge.description || "", 700),
      aggregated: Boolean(selection.selectedEdge.aggregated),
      count: Number(selection.selectedEdge.count || 1),
      rowNumbers: clamp(Array.isArray(selection.selectedEdge.rowNumbers) ? selection.selectedEdge.rowNumbers : [], 40),
      summary: compactValue(selection.selectedEdge.summary || "", 800),
      comments: clamp(Array.isArray(selection.selectedEdge.comments) ? selection.selectedEdge.comments : [], 12).map((comment: any) => ({
        id: compactValue(comment?.id || "", 180),
        text: compactValue(comment?.text || "", 700),
        createdAt: comment?.createdAt || null,
      })),
    } : null,
    selectedRows: clamp(Array.isArray(selection.selectedRows) ? selection.selectedRows : [], 40).map((row: any) => ({
      rowNumber: Number(row?.rowNumber || 0),
      subsystem: compactValue(row?.subsystem || "", 220),
      fromFunction: compactValue(row?.fromFunction || "", 220),
      fromDetails: compactValue(row?.fromDetails || "", 700),
      controlAction: compactValue(row?.controlAction || "", 260),
      controlDetails: compactValue(row?.controlDetails || "", 700),
      toFunction: compactValue(row?.toFunction || "", 220),
      toDetails: compactValue(row?.toDetails || "", 700),
    })),
    updatedAt: selection.updatedAt || null,
  };
}

function compactActiveSelection(selection: any) {
  if (!selection || typeof selection !== "object") return null;
  if (selection.kind === "functional-canvas" || selection.source === "functional-diagram") {
    const compacted = compactFunctionalCanvasSelection({ ...selection, hasSelection: true });
    return compacted ? { kind: "functional-canvas", source: "functional-diagram", projectId: selection.projectId || "", ...compacted } : null;
  }
  return {
    kind: compactValue(selection.kind || "workspace-item", 80),
    source: compactValue(selection.source || "", 120),
    projectId: compactValue(selection.projectId || "", 180),
    id: compactValue(selection.id || "", 220),
    title: compactValue(selection.title || selection.label || "", 320),
    tableId: compactValue(selection.tableId || "", 120),
    tableLabel: compactValue(selection.tableLabel || "", 180),
    primary: compactValue(selection.primary || null, 1800),
    selectedRows: clamp(Array.isArray(selection.selectedRows) ? selection.selectedRows : [], 8).map((row: any) => ({
      rowId: compactValue(row?.rowId || "", 220),
      rowIndex: Number(row?.rowIndex || 0),
      rowNumber: Number(row?.rowNumber || 0),
      values: compactValue(row?.values || null, 5000),
    })),
    selectedCells: clamp(Array.isArray(selection.selectedCells) ? selection.selectedCells : [], 16).map((cell: any) => ({
      rowId: compactValue(cell?.rowId || "", 220),
      rowIndex: Number(cell?.rowIndex || 0),
      rowNumber: Number(cell?.rowNumber || 0),
      columnIndex: Number(cell?.columnIndex || 0),
      columnLabel: compactValue(cell?.columnLabel || "", 220),
      value: compactValue(cell?.value, 1800),
    })),
    values: compactValue(selection.values || null, 5000),
    updatedAt: selection.updatedAt || null,
  };
}

function compactArtifact(artifact: WorkspaceArtifact): WorkspaceArtifact {
  return {
    ...artifact,
    content: compactValue(artifact.content, 900),
    structuredData: compactValue(artifact.structuredData, 900),
  };
}

function compactSourceFile(file: WorkspaceSourceFile): WorkspaceSourceFile {
  return {
    ...file,
    content: compactValue(file.content, 900),
    structuredData: compactValue(file.structuredData, 700),
  };
}

function compactActiveView(activeView: any) {
  if (!activeView || typeof activeView !== "object") return activeView || null;
  return {
    section: activeView.section || null,
    activeTab: activeView.activeTab || null,
    viewedProjectId: activeView.viewedProjectId || null,
    viewedProjectName: activeView.viewedProjectName || "",
    viewedProjectType: activeView.viewedProjectType || null,
    selectedFunctionalProjectId: activeView.selectedFunctionalProjectId || null,
    selectedCodeArchitectureProjectId: activeView.selectedCodeArchitectureProjectId || null,
    activeProjectId: activeView.activeProjectId || null,
    activeCodeArchitectureProjectId: activeView.activeCodeArchitectureProjectId || null,
    activeCodeArchitectureRepoId: activeView.activeCodeArchitectureRepoId || null,
    activeCodeArchitectureRepoKey: activeView.activeCodeArchitectureRepoKey || null,
    activeCodeArchitectureWorkspaceTab: activeView.activeCodeArchitectureWorkspaceTab || null,
    activeCodeArchitectureHazardRunId: activeView.activeCodeArchitectureHazardRunId || null,
    activeCodeArchitectureRepo: activeView.activeCodeArchitectureRepo
      ? {
          id: activeView.activeCodeArchitectureRepo.id || null,
          owner: activeView.activeCodeArchitectureRepo.owner || "",
          repo: activeView.activeCodeArchitectureRepo.repo || "",
          repoId: activeView.activeCodeArchitectureRepo.repoId || "",
          branch: activeView.activeCodeArchitectureRepo.branch || "",
        }
      : null,
    functionalCanvasSelection: compactFunctionalCanvasSelection(activeView.functionalCanvasSelection),
    activeSelections: clamp(Array.isArray(activeView.activeSelections) ? activeView.activeSelections : [], 8)
      .map(compactActiveSelection)
      .filter(Boolean),
  };
}

function artifactsForActiveSelections(artifacts: WorkspaceArtifact[], activeView: any) {
  const selections = Array.isArray(activeView?.activeSelections) ? activeView.activeSelections : [];
  if (!selections.length) return [];
  const exactIds = new Set<string>();
  const functionalIndexes = new Set<number>();
  const hazardIndexes = new Set<number>();
  const codeArchitectureIndexes = new Set<number>();
  const codeArchitectureHazardIndexes = new Set<number>();
  selections.forEach((selection: any) => {
    [selection?.id, selection?.primary?.rowId]
      .filter(Boolean)
      .forEach((value) => exactIds.add(String(value)));
    (selection?.selectedRows || []).forEach((row: any) => {
      if (row?.rowId) exactIds.add(String(row.rowId));
      const index = Number(row?.rowIndex);
      if (!Number.isInteger(index) || index < 0) return;
      if (selection?.tableId === "functional-decomposition") functionalIndexes.add(index);
      if (selection?.tableId === "hazard-analysis") hazardIndexes.add(index);
      if (selection?.tableId === "code-architecture-functional-decomposition") codeArchitectureIndexes.add(index);
      if (selection?.tableId === "code-architecture-hazard-analysis") codeArchitectureHazardIndexes.add(index);
    });
  });
  return artifacts.filter((artifact) => {
    if (exactIds.has(String(artifact.id)) || exactIds.has(String(artifact.sourceId || ""))) return true;
    if (
      exactIds.has(String(artifact.structuredData?.id || "")) ||
      exactIds.has(String(artifact.structuredData?.internalId || "")) ||
      exactIds.has(String(artifact.structuredData?.traceId || ""))
    ) return true;
    if (Array.from(exactIds).some((id) => id && String(artifact.sourceId || "").includes(id))) return true;
    if (artifact.type === "functional_decomposition_row") {
      if(functionalIndexes.has(Number((artifact as any).rowIndex)))return true;
      const match = String(artifact.sourceId || "").match(/responseRows:(\d+)$/i);
      if (match && functionalIndexes.has(Number(match[1]))) return true;
    }
    if (artifact.type === "hazard_analysis_row") {
      const rowIndex = Number((artifact as any).rowIndex ?? artifact.structuredData?.rowIndex);
      if (Number.isInteger(rowIndex) && hazardIndexes.has(rowIndex)) return true;
      const match = String(artifact.sourceId || "").match(/Summary:(\d+)$/i);
      if (match && hazardIndexes.has(Number(match[1]))) return true;
    }
    if (artifact.type === "code_architecture_edge") {
      const rowIndex = Number((artifact as any).rowIndex ?? artifact.structuredData?._rowIndex ?? artifact.structuredData?.rowIndex);
      if (Number.isInteger(rowIndex) && codeArchitectureIndexes.has(rowIndex)) return true;
    }
    if (artifact.type === "code_architecture_hazard_row") {
      const rowIndex = Number((artifact as any).rowIndex ?? artifact.structuredData?.rowIndex);
      if (Number.isInteger(rowIndex) && codeArchitectureHazardIndexes.has(rowIndex)) return true;
    }
    return false;
  });
}

function citationForArtifact(artifact: WorkspaceArtifact) {
  return {
    artifactId: artifact.id,
    projectId: artifact.projectId,
    sourceStore: artifact.sourceStore,
    sourceKey: artifact.sourceKey,
    sourceId: artifact.sourceId,
    title: artifact.title,
    type: artifact.type,
  };
}

function citationForSourceFile(file: WorkspaceSourceFile) {
  return {
    artifactId: file.id,
    projectId: file.projectId,
    sourceStore: file.sourceStore,
    sourceKey: file.sourceKey,
    sourceId: file.sourceId,
    title: file.path || file.title,
    type: "source_file",
  };
}

function uniqueById<T extends { id: string }>(rows: T[]) {
  const seen = new Map<string, T>();
  rows.forEach((row) => {
    if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
  });
  return Array.from(seen.values());
}

function relationshipsTouching(
  relationships: WorkspaceRelationship[],
  artifactIds: Set<string>
) {
  return relationships.filter((rel) => (
    artifactIds.has(rel.fromArtifactId) || artifactIds.has(rel.toArtifactId)
  ));
}

function neighborhoodFromRows(
  artifacts: WorkspaceArtifact[],
  relationships: WorkspaceRelationship[],
  seeds: WorkspaceArtifact[]
) {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const seedIds = new Set(seeds.map((artifact) => artifact.id));
  const touching = relationshipsTouching(relationships, seedIds);
  const neighborIds = new Set<string>();
  touching.forEach((rel) => {
    neighborIds.add(rel.fromArtifactId);
    neighborIds.add(rel.toArtifactId);
  });
  return {
    artifacts: Array.from(neighborIds).map((id) => byId.get(id)).filter(Boolean) as WorkspaceArtifact[],
    relationships: touching,
  };
}

function scaleLimits(tokenBudget = DEFAULT_TOKEN_BUDGET) {
  const scale = Math.max(0.45, Math.min(1.6, tokenBudget / DEFAULT_TOKEN_BUDGET));
  return {
    artifacts: Math.round(24 * scale),
    neighborhoodSeeds: Math.round(5 * scale),
    relationships: Math.round(48 * scale),
    projects: Math.round(16 * scale),
    runs: Math.round(8 * scale),
    reviews: Math.round(12 * scale),
    evidence: Math.round(12 * scale),
    sourceFiles: Math.round(10 * scale),
  };
}

function truncationDiagnostics(raw: Record<string, number>, limits: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(raw).map(([key, count]) => [key, {
      total: count,
      limit: limits[key] ?? null,
      truncated: typeof limits[key] === "number" ? count > limits[key] : false,
    }])
  );
}

async function migrateWithDiagnostics(diagnostics: Record<string, any>, signal?: AbortSignal, steps?:string[], projectIds?:string[], onProgress?:WorkspaceContextArgs["onProgress"]) {
  try {
    diagnostics.migration = await migrateLegacyStorageToWorkspaceGraphIfStale({ mode: "incremental", signal, steps, projectIds, onProgress });
    diagnostics.latestMigration = getLatestWorkspaceGraphMigrationDiagnostics();
  } catch (error: any) {
    if(signal?.aborted)throw error;
    diagnostics.migrationError = error?.message || String(error);
    diagnostics.latestMigration = getLatestWorkspaceGraphMigrationDiagnostics();
  }
}

export async function buildWorkspaceLLMContext({
  projectId = null,
  activeView = null,
  query = "",
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  areas = [],
  contextOnDemand = false,
  signal,
  onProgress,
}: WorkspaceContextArgs = {}): Promise<WorkspaceLLMContext> {
  const diagnostics: Record<string, any> = {};
  const limits = scaleLimits(tokenBudget);
  const focusedActiveView = compactActiveView(activeView);

  const overview = contextOnDemand ? projectOverviewScope(query, {projectId, areas}) : null;
  if (overview) projectId = overview.projectId;
  const requestedScope=overview ? {steps:['projects'],types:['project','repository'],deterministic:false} : workspaceIndexScope(query,areas) || (contextOnDemand ? requestedWorkspaceIndexScope(areas) : null);
  const {indexScope,projectIds}=contextOnDemand?scopeWorkspaceIndex(requestedScope,{query,projectId,areas}):{indexScope:requestedScope,projectIds:undefined};
  if(projectIds?.length===1)projectId=projectIds[0];
  const progress=(step:string)=>{if(!signal?.aborted){try{onProgress?.({step,durationMs:0,complete:false});}catch{}}};
  progress('opening');
  await migrateWithDiagnostics(diagnostics, signal,indexScope?.steps,projectIds,onProgress);
  progress('searching');
  if(indexScope)diagnostics.indexScope=indexScope;

  if (overview) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('Overview sample exceeded its read budget.')), 5000);
    let rejectRead: (error:any)=>void = () => {};
    const stopped = new Promise<never>((_resolve,reject) => { rejectRead = reject; });
    stopped.catch(() => {});
    const stopRead = () => rejectRead(controller.signal.reason || new DOMException('Overview cancelled.','AbortError'));
    controller.signal.addEventListener('abort',stopRead,{once:true});
    if (controller.signal.aborted) stopRead();
    try {
      diagnostics.overview = !areas.length || areas.some(area => ['functional','cba'].includes(area))
        ? await Promise.race([readProjectOverviewSample(overview, {signal:controller.signal}), stopped])
        : {rows:[],sources:[],reason:'Only project catalog metadata was requested.'};
    } catch (error:any) {
      if (signal?.aborted) throw error;
      diagnostics.overview = {rows:[],sources:[],reason:error.message};
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort',stopRead); }
  }
  const allProjects = await listProjects();
  const projects = clamp(Array.isArray(allProjects) ? allProjects : [], limits.projects);
  const allowedTypes = indexScope?new Set<string>(indexScope.types):artifactTypesForAreas(areas);
  const counts = await workspaceGraphCounts(projectId);
  const candidateResult = await queryWorkspaceCandidates(query, { projectId, types: allowedTypes, limit: Math.max(96,limits.artifacts*3), activeView: focusedActiveView, signal });
  const allArtifacts = candidateResult.rows;
  const totalArtifacts = allArtifacts;
  progress("relationships");
  const totalRelationships = await relationshipsForArtifacts(totalArtifacts.slice(0,limits.artifacts).map(row=>row.id), {limit:limits.relationships*2,signal});
  diagnostics.retrieval = { candidateCount: totalArtifacts.length, candidatesTruncated: candidateResult.truncated, fullBodiesLoaded: false };
  const searchedRows = query
    ? await searchArtifacts(query, { projectId, limit: limits.artifacts }, totalArtifacts)
    : [];
  const searched = Array.isArray(searchedRows) ? searchedRows : [];
  const seedArtifacts = searched.length
    ? searched
    : clamp(totalArtifacts, limits.artifacts);
  const activeSelectionArtifacts = artifactsForActiveSelections(totalArtifacts, focusedActiveView);
  const hazardFocused = isHazardAnalysisQuery(query);
  const hazardEvidence = hazardFocused
    ? clamp(
        totalArtifacts.filter((artifact) => HAZARD_CONTEXT_ARTIFACT_TYPES.has(String(artifact?.type || ""))),
        limits.artifacts
      )
    : [];
  const contentPrioritizedSeeds = hazardFocused
    ? clamp(uniqueById([
        ...searched.filter((artifact) => HAZARD_CONTEXT_ARTIFACT_TYPES.has(String(artifact?.type || ""))),
        ...hazardEvidence,
        ...searched,
      ]), limits.artifacts)
    : seedArtifacts;
  const prioritizedSeeds = clamp(uniqueById([
    ...activeSelectionArtifacts,
    ...contentPrioritizedSeeds,
  ]), limits.artifacts);
  const activeProjectArtifacts = projectId
    ? clamp(totalArtifacts.filter((artifact) => artifact.projectId === projectId), Math.max(8, Math.round(limits.artifacts * 0.25)))
    : [];

  const neighborhood = neighborhoodFromRows(
    totalArtifacts,
    totalRelationships,
    clamp(prioritizedSeeds, limits.neighborhoodSeeds)
  );
  const neighborhoodArtifacts = neighborhood.artifacts;
  const neighborhoodRelationships = neighborhood.relationships;

  const relevantArtifacts = clamp(
    uniqueById([...prioritizedSeeds, ...neighborhoodArtifacts, ...activeProjectArtifacts]).map(compactArtifact),
    limits.artifacts
  );
  const relevantIds = new Set(relevantArtifacts.map((artifact) => artifact.id));
  const relationships = clamp(
    uniqueById([
      ...relationshipsTouching(totalRelationships, relevantIds),
      ...neighborhoodRelationships,
    ]),
    limits.relationships
  );

  const sourceFileRows = !indexScope||indexScope.types.includes('source_file')?await listSourceFiles(projectId, limits.sourceFiles * 2):[];
  const allSourceFiles = Array.isArray(sourceFileRows) ? sourceFileRows : [];
  const sourceFiles = clamp(allSourceFiles.map(compactSourceFile), limits.sourceFiles);
  diagnostics.truncation = truncationDiagnostics({
    projects: Array.isArray(allProjects) ? allProjects.length : 0,
    artifacts: totalArtifacts.length,
    relevantArtifacts: uniqueById([...prioritizedSeeds, ...neighborhoodArtifacts, ...activeProjectArtifacts]).length,
    relationships: uniqueById([...relationshipsTouching(totalRelationships, relevantIds), ...neighborhoodRelationships]).length,
    sourceFiles: allSourceFiles.length,
  }, limits);
  diagnostics.selection = {
    queryMatchedArtifactCount: searched.length,
    neighborhoodArtifactCount: uniqueById(neighborhoodArtifacts).length,
    activeProjectArtifactCount: activeProjectArtifacts.length,
    activeSelectionArtifactCount: activeSelectionArtifacts.length,
    hazardFocused,
    hazardEvidenceCount: hazardEvidence.length,
  };

  return {
    scope: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      activeView: focusedActiveView,
      query,
    },
    workspaceSummary: {
      projectCount: counts.projectCount,
      artifactCount: indexScope?null:counts.artifactCount,
      relationshipCount: indexScope?null:counts.relationshipCount,
      relevantArtifactCount: relevantArtifacts.length,
    },
    projects,
    relevantArtifacts,
    relationships,
    runs: indexScope?[]:clamp(await listRuns(projectId, limits.runs), limits.runs),
    reviews: indexScope?[]:clamp(await listReviews(projectId, limits.reviews), limits.reviews),
    evidence: indexScope?[]:clamp(await listEvidence(projectId, limits.evidence), limits.evidence),
    sourceFiles,
    citations: [
      ...relevantArtifacts.map(citationForArtifact),
      ...sourceFiles.map(citationForSourceFile),
    ],
    diagnostics,
  };
}

export async function buildArtifactLLMContext({
  artifactId,
  depth = 1,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
}: ArtifactContextArgs): Promise<WorkspaceLLMContext> {
  const diagnostics: Record<string, any> = {};
  const limits = scaleLimits(tokenBudget);

  await migrateWithDiagnostics(diagnostics);

  const root = await getArtifact(artifactId);
  const neighborhood = await getNeighborhood(artifactId, { depth });
  const artifacts = uniqueById([
    ...(root ? [root] : []),
    ...neighborhood.artifacts,
  ]);
  const projectId = root?.projectId || artifacts.find((artifact) => artifact.projectId)?.projectId || null;
  const allProjects = await listProjects();
  const projects = clamp(Array.isArray(allProjects) ? allProjects : [], limits.projects);
  const counts = await workspaceGraphCounts(projectId);
  const relevantArtifacts = clamp(artifacts.map(compactArtifact), limits.artifacts);
  const sourceFileRows = await listSourceFiles(projectId, limits.sourceFiles * 2);
  const allSourceFiles = Array.isArray(sourceFileRows) ? sourceFileRows : [];
  const sourceFiles = clamp(allSourceFiles.map(compactSourceFile), limits.sourceFiles);
  diagnostics.truncation = truncationDiagnostics({
    projects: Array.isArray(allProjects) ? allProjects.length : 0,
    artifacts: artifacts.length,
    relevantArtifacts: artifacts.length,
    relationships: neighborhood.relationships.length,
    sourceFiles: allSourceFiles.length,
  }, limits);

  return {
    scope: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      activeView: { artifactId, depth },
      query: root?.title || artifactId,
    },
    workspaceSummary: {
      projectCount: Array.isArray(allProjects) ? allProjects.length : 0,
      artifactCount: counts.artifactCount,
      relationshipCount: counts.relationshipCount,
      relevantArtifactCount: relevantArtifacts.length,
    },
    projects,
    relevantArtifacts,
    relationships: clamp(uniqueById(neighborhood.relationships), limits.relationships),
    runs: clamp(await listRuns(projectId, limits.runs), limits.runs),
    reviews: clamp(await listReviews(projectId, limits.reviews), limits.reviews),
    evidence: clamp(await listEvidence(projectId, limits.evidence), limits.evidence),
    sourceFiles,
    citations: [
      ...relevantArtifacts.map(citationForArtifact),
      ...sourceFiles.map(citationForSourceFile),
    ],
    diagnostics,
  };
}
