import { openWorkspaceGraphDB, ensureWorkspaceGraphDb as ensureDb } from "./workspaceGraphDb";
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_GRAPH_STORES,
  type ArtifactFilters,
  type RelationshipFilters,
  type WorkspaceArtifact,
  type WorkspaceChange,
  type WorkspaceEvidence,
  type WorkspaceFolder,
  type WorkspaceProject,
  type WorkspaceRelationship,
  type WorkspaceReview,
  type WorkspaceRun,
  type WorkspaceSourceFile,
  type WorkspaceSummary,
} from "./workspaceGraphTypes";

const nowISO = () => new Date().toISOString();

function stamp<T extends { id: string; createdAt?: string; updatedAt?: string; workspaceId?: string; version?: number }>(record: T): T {
  const now = nowISO();
  return {
    ...record,
    workspaceId: record.workspaceId || DEFAULT_WORKSPACE_ID,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    version: Number(record.version || 1),
  };
}

function matchesProject<T extends { projectId?: string }>(row: T, projectId?: string | null) {
  return !projectId || !row.projectId || row.projectId === projectId;
}

function typeSet(type?: string | string[]) {
  if (!type) return null;
  return new Set(Array.isArray(type) ? type : [type]);
}

function sortByUpdatedThenId<T extends { id: string; updatedAt?: string }>(rows: T[]) {
  return rows.sort((a, b) => (
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) ||
    String(a.id).localeCompare(String(b.id))
  ));
}

export const ensureWorkspaceGraphDb = ensureDb;

export async function upsertProject(project: WorkspaceProject) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(project);
  await db.put(WORKSPACE_GRAPH_STORES.projects, row);
  db.close();
  return row;
}

export async function upsertFolder(folder: WorkspaceFolder) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(folder);
  await db.put(WORKSPACE_GRAPH_STORES.folders, row);
  db.close();
  return row;
}

export async function upsertArtifact(artifact: WorkspaceArtifact) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(artifact);
  await db.put(WORKSPACE_GRAPH_STORES.artifacts, row);
  db.close();
  return row;
}

export async function upsertArtifacts(artifacts: WorkspaceArtifact[] = []) {
  const db = await openWorkspaceGraphDB();
  const tx = db.transaction(WORKSPACE_GRAPH_STORES.artifacts, "readwrite");
  const rows = artifacts.filter(Boolean).map(stamp);
  await Promise.all(rows.map((row) => tx.store.put(row)));
  await tx.done;
  db.close();
  return rows;
}

export async function upsertRelationship(relationship: WorkspaceRelationship) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(relationship);
  await db.put(WORKSPACE_GRAPH_STORES.relationships, row);
  db.close();
  return row;
}

export async function upsertRelationships(relationships: WorkspaceRelationship[] = []) {
  const db = await openWorkspaceGraphDB();
  const tx = db.transaction(WORKSPACE_GRAPH_STORES.relationships, "readwrite");
  const rows = relationships.filter(Boolean).map(stamp);
  await Promise.all(rows.map((row) => tx.store.put(row)));
  await tx.done;
  db.close();
  return rows;
}

export async function upsertRun(run: WorkspaceRun) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(run);
  await db.put(WORKSPACE_GRAPH_STORES.runs, row);
  db.close();
  return row;
}

export async function upsertReview(review: WorkspaceReview) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(review);
  await db.put(WORKSPACE_GRAPH_STORES.reviews, row);
  db.close();
  return row;
}

export async function upsertEvidence(evidence: WorkspaceEvidence) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(evidence);
  await db.put(WORKSPACE_GRAPH_STORES.evidence, row);
  db.close();
  return row;
}

export async function upsertSourceFile(sourceFile: WorkspaceSourceFile) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(sourceFile);
  await db.put(WORKSPACE_GRAPH_STORES.sourceFiles, row);
  db.close();
  return row;
}

export async function upsertSummary(summary: WorkspaceSummary) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(summary);
  await db.put(WORKSPACE_GRAPH_STORES.summaries, row);
  db.close();
  return row;
}

export async function listProjects() {
  const db = await openWorkspaceGraphDB();
  const rows = await db.getAll(WORKSPACE_GRAPH_STORES.projects);
  db.close();
  return rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function listArtifacts(filters: ArtifactFilters = {}) {
  const db = await openWorkspaceGraphDB();
  let rows = await db.getAll(WORKSPACE_GRAPH_STORES.artifacts);
  db.close();
  const types = typeSet(filters.type);
  rows = rows.filter((row) => matchesProject(row, filters.projectId));
  if (types) rows = rows.filter((row) => types.has(row.type));
  if (filters.sourceStore) rows = rows.filter((row) => row.sourceStore === filters.sourceStore);
  if (filters.sourceKey) rows = rows.filter((row) => row.sourceKey === filters.sourceKey);
  if (filters.sourceId) rows = rows.filter((row) => row.sourceId === filters.sourceId);
  sortByUpdatedThenId(rows);
  rows.sort((a, b) => (
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) ||
    String(a.id).localeCompare(String(b.id))
  ));
  return typeof filters.limit === "number" ? rows.slice(0, filters.limit) : rows;
}

export async function listRelationships(filters: RelationshipFilters = {}) {
  const db = await openWorkspaceGraphDB();
  let rows = await db.getAll(WORKSPACE_GRAPH_STORES.relationships);
  db.close();
  const types = typeSet(filters.type);
  rows = rows.filter((row) => matchesProject(row, filters.projectId));
  if (types) rows = rows.filter((row) => types.has(row.type));
  if (filters.fromArtifactId) rows = rows.filter((row) => row.fromArtifactId === filters.fromArtifactId);
  if (filters.toArtifactId) rows = rows.filter((row) => row.toArtifactId === filters.toArtifactId);
  return typeof filters.limit === "number" ? rows.slice(0, filters.limit) : rows;
}

export async function listRuns(projectId?: string | null, limit = 80) {
  const db = await openWorkspaceGraphDB();
  const rows = await db.getAll(WORKSPACE_GRAPH_STORES.runs);
  db.close();
  return sortByUpdatedThenId(rows.filter((row) => matchesProject(row, projectId))).slice(0, limit);
}

export async function listReviews(projectId?: string | null, limit = 100) {
  const db = await openWorkspaceGraphDB();
  const rows = await db.getAll(WORKSPACE_GRAPH_STORES.reviews);
  db.close();
  return sortByUpdatedThenId(rows.filter((row) => matchesProject(row, projectId))).slice(0, limit);
}

export async function listEvidence(projectId?: string | null, limit = 80) {
  const db = await openWorkspaceGraphDB();
  const rows = await db.getAll(WORKSPACE_GRAPH_STORES.evidence);
  db.close();
  return sortByUpdatedThenId(rows.filter((row) => matchesProject(row, projectId))).slice(0, limit);
}

export async function listSourceFiles(projectId?: string | null, limit = 40) {
  const db = await openWorkspaceGraphDB();
  const rows = await db.getAll(WORKSPACE_GRAPH_STORES.sourceFiles);
  db.close();
  return sortByUpdatedThenId(rows.filter((row) => matchesProject(row, projectId))).slice(0, limit);
}

export async function getArtifact(id: string) {
  const db = await openWorkspaceGraphDB();
  const row = await db.get(WORKSPACE_GRAPH_STORES.artifacts, id);
  db.close();
  return row || null;
}

export async function getNeighborhood(artifactId: string, { depth = 1 } = {}) {
  const seen = new Set<string>([artifactId]);
  const artifacts = new Map<string, WorkspaceArtifact>();
  const relationships: WorkspaceRelationship[] = [];
  let frontier = new Set<string>([artifactId]);

  for (let level = 0; level < Math.max(1, depth); level += 1) {
    const allRels = await listRelationships({});
    const next = new Set<string>();
    const currentFrontier = new Set(frontier);
    allRels.forEach((rel) => {
      if (!currentFrontier.has(rel.fromArtifactId) && !currentFrontier.has(rel.toArtifactId)) return;
      relationships.push(rel);
      [rel.fromArtifactId, rel.toArtifactId].forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          next.add(id);
        }
      });
    });
    frontier = next;
    if (!frontier.size) break;
  }

  await Promise.all(Array.from(seen).map(async (id) => {
    const artifact = await getArtifact(id);
    if (artifact) artifacts.set(id, artifact);
  }));

  return { artifacts: Array.from(artifacts.values()), relationships: Array.from(new Map(relationships.map((rel) => [rel.id, rel])).values()) };
}

export async function recordChange(change: Omit<WorkspaceChange, "id" | "at"> & Partial<Pick<WorkspaceChange, "id" | "at">>) {
  const db = await openWorkspaceGraphDB();
  const at = change.at || nowISO();
  const row = {
    ...change,
    id: change.id || `change:${change.entityType}:${change.entityId}:${Date.now()}`,
    at,
    workspaceId: change.workspaceId || DEFAULT_WORKSPACE_ID,
  } as WorkspaceChange;
  await db.put(WORKSPACE_GRAPH_STORES.changeLog, row);
  db.close();
  return row;
}
