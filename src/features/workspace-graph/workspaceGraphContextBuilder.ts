import {
  getLatestWorkspaceGraphMigrationDiagnostics,
  migrateLegacyStorageToWorkspaceGraphIfStale,
} from "./legacyWorkspaceGraphMigrator";
import {
  getArtifact,
  getNeighborhood,
  listArtifacts,
  listEvidence,
  listProjects,
  listRelationships,
  listReviews,
  listRuns,
  listSourceFiles,
} from "./workspaceGraphRepository";
import { searchArtifacts } from "./workspaceGraphSearch";
import {
  DEFAULT_WORKSPACE_ID,
  type WorkspaceArtifact,
  type WorkspaceLLMContext,
  type WorkspaceRelationship,
  type WorkspaceSourceFile,
} from "./workspaceGraphTypes";

const DEFAULT_TOKEN_BUDGET = 6000;

type WorkspaceContextArgs = {
  projectId?: string | null;
  activeView?: any;
  query?: string;
  tokenBudget?: number;
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
    activeProjectId: activeView.activeProjectId || null,
    activeCodeArchitectureProjectId: activeView.activeCodeArchitectureProjectId || null,
    activeCodeArchitectureRepoId: activeView.activeCodeArchitectureRepoId || null,
    activeCodeArchitectureRepoKey: activeView.activeCodeArchitectureRepoKey || null,
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
  };
}

function citationForArtifact(artifact: WorkspaceArtifact) {
  return {
    artifactId: artifact.id,
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

async function migrateWithDiagnostics(diagnostics: Record<string, any>) {
  try {
    diagnostics.migration = await migrateLegacyStorageToWorkspaceGraphIfStale({ mode: "incremental" });
    diagnostics.latestMigration = getLatestWorkspaceGraphMigrationDiagnostics();
  } catch (error: any) {
    diagnostics.migrationError = error?.message || String(error);
    diagnostics.latestMigration = getLatestWorkspaceGraphMigrationDiagnostics();
  }
}

export async function buildWorkspaceLLMContext({
  projectId = null,
  activeView = null,
  query = "",
  tokenBudget = DEFAULT_TOKEN_BUDGET,
}: WorkspaceContextArgs = {}): Promise<WorkspaceLLMContext> {
  const diagnostics: Record<string, any> = {};
  const limits = scaleLimits(tokenBudget);
  const focusedActiveView = compactActiveView(activeView);

  await migrateWithDiagnostics(diagnostics);

  const allProjects = await listProjects();
  const projects = clamp(Array.isArray(allProjects) ? allProjects : [], limits.projects);
  const totalArtifactRows = await listArtifacts({ projectId });
  const totalArtifacts = Array.isArray(totalArtifactRows) ? totalArtifactRows : [];
  const totalRelationshipRows = await listRelationships({ projectId });
  const totalRelationships = Array.isArray(totalRelationshipRows) ? totalRelationshipRows : [];
  const searchedRows = query
    ? await searchArtifacts(query, { projectId, limit: limits.artifacts })
    : [];
  const searched = Array.isArray(searchedRows) ? searchedRows : [];
  const seedArtifacts = searched.length
    ? searched
    : clamp(totalArtifacts, limits.artifacts);
  const activeProjectArtifacts = projectId
    ? clamp(totalArtifacts.filter((artifact) => artifact.projectId === projectId), Math.max(8, Math.round(limits.artifacts * 0.25)))
    : [];

  const neighborhood = neighborhoodFromRows(
    totalArtifacts,
    totalRelationships,
    clamp(seedArtifacts, limits.neighborhoodSeeds)
  );
  const neighborhoodArtifacts = neighborhood.artifacts;
  const neighborhoodRelationships = neighborhood.relationships;

  const relevantArtifacts = clamp(
    uniqueById([...seedArtifacts, ...neighborhoodArtifacts, ...activeProjectArtifacts]).map(compactArtifact),
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

  const sourceFileRows = await listSourceFiles(projectId, limits.sourceFiles * 2);
  const allSourceFiles = Array.isArray(sourceFileRows) ? sourceFileRows : [];
  const sourceFiles = clamp(allSourceFiles.map(compactSourceFile), limits.sourceFiles);
  diagnostics.truncation = truncationDiagnostics({
    projects: projects.length,
    artifacts: totalArtifacts.length,
    relevantArtifacts: uniqueById([...seedArtifacts, ...neighborhoodArtifacts, ...activeProjectArtifacts]).length,
    relationships: uniqueById([...relationshipsTouching(totalRelationships, relevantIds), ...neighborhoodRelationships]).length,
    sourceFiles: allSourceFiles.length,
  }, limits);
  diagnostics.selection = {
    queryMatchedArtifactCount: searched.length,
    neighborhoodArtifactCount: uniqueById(neighborhoodArtifacts).length,
    activeProjectArtifactCount: activeProjectArtifacts.length,
  };

  return {
    scope: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      activeView: focusedActiveView,
      query,
    },
    workspaceSummary: {
      projectCount: projects.length,
      artifactCount: totalArtifacts.length,
      relationshipCount: totalRelationships.length,
      relevantArtifactCount: relevantArtifacts.length,
    },
    projects,
    relevantArtifacts,
    relationships,
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
  const projectArtifactRows = await listArtifacts({ projectId });
  const projectArtifacts = Array.isArray(projectArtifactRows) ? projectArtifactRows : [];
  const projectRelationshipRows = await listRelationships({ projectId });
  const projectRelationships = Array.isArray(projectRelationshipRows) ? projectRelationshipRows : [];
  const relevantArtifacts = clamp(artifacts.map(compactArtifact), limits.artifacts);
  const sourceFileRows = await listSourceFiles(projectId, limits.sourceFiles * 2);
  const allSourceFiles = Array.isArray(sourceFileRows) ? sourceFileRows : [];
  const sourceFiles = clamp(allSourceFiles.map(compactSourceFile), limits.sourceFiles);
  diagnostics.truncation = truncationDiagnostics({
    projects: projects.length,
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
      projectCount: projects.length,
      artifactCount: projectArtifacts.length,
      relationshipCount: projectRelationships.length,
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
