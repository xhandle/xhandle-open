import { openWorkspaceGraphDB } from "./workspaceGraphDb";
import {
  getLatestWorkspaceGraphMigrationDiagnostics,
} from "./legacyWorkspaceGraphMigrator";
import {
  WORKSPACE_GRAPH_DB_NAME,
  WORKSPACE_GRAPH_DB_VERSION,
  WORKSPACE_GRAPH_STORES,
  type WorkspaceArtifact,
  type WorkspaceRelationship,
  type WorkspaceSourceFile,
} from "./workspaceGraphTypes";

const EXPECTED_INDEXES: Record<string, string[]> = {
  projects: ["by_workspace", "by_source", "by_source_key"],
  folders: ["by_project", "by_parent", "by_source", "by_source_key"],
  artifacts: ["by_project", "by_type", "by_project_type", "by_source", "by_source_key", "by_updated"],
  relationships: ["by_project", "by_type", "by_from", "by_to", "by_source", "by_source_key"],
  runs: ["by_project", "by_type", "by_source", "by_source_key"],
  reviews: ["by_project", "by_status", "by_artifact", "by_source", "by_source_key"],
  evidence: ["by_project", "by_artifact", "by_source", "by_source_key"],
  sourceFiles: ["by_project", "by_repo", "by_path", "by_source", "by_source_key"],
  summaries: ["by_project", "by_artifact", "by_source", "by_source_key"],
  changeLog: ["by_project", "by_entity", "by_at"],
};

type ValidationOptions = { sampleLimit?: number };

function byType<T extends { type?: string }>(rows: T[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const type = row.type || "unknown";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
}

function sample<T>(rows: T[], limit: number) {
  return rows.slice(0, Math.max(0, limit));
}

export async function validateWorkspaceGraphRuntime({ sampleLimit = 10 }: ValidationOptions = {}) {
  const startedAt = Date.now();
  const diagnostics: any = {
    ok: false,
    dbName: WORKSPACE_GRAPH_DB_NAME,
    dbVersion: WORKSPACE_GRAPH_DB_VERSION,
    opened: false,
    stores: {},
    missingStores: [],
    missingIndexes: {},
    counts: {},
    relationshipTypeCounts: {},
    artifactTypeCounts: {},
    orphanRelationships: [],
    missingContainsForParent: [],
    sourceFilesMissingArtifact: [],
    sourceCitationSamples: [],
    migration: getLatestWorkspaceGraphMigrationDiagnostics(),
    errors: [],
  };

  let db;
  try {
    db = await openWorkspaceGraphDB();
    diagnostics.opened = true;
    const expectedStores = Object.values(WORKSPACE_GRAPH_STORES);
    diagnostics.missingStores = expectedStores.filter((storeName) => !db.objectStoreNames.contains(storeName));

    for (const storeName of expectedStores) {
      if (!db.objectStoreNames.contains(storeName)) continue;
      const tx = db.transaction(storeName as any, "readonly");
      const store = tx.objectStore(storeName as any);
      const indexes = Array.from(store.indexNames);
      const expectedIndexes = EXPECTED_INDEXES[storeName] || [];
      const missing = expectedIndexes.filter((indexName) => !indexes.includes(indexName));
      diagnostics.stores[storeName] = { indexes, missingIndexes: missing };
      if (missing.length) diagnostics.missingIndexes[storeName] = missing;
      diagnostics.counts[storeName] = await store.count();
      await tx.done;
    }

    const artifacts = db.objectStoreNames.contains(WORKSPACE_GRAPH_STORES.artifacts)
      ? await db.getAll(WORKSPACE_GRAPH_STORES.artifacts)
      : [] as WorkspaceArtifact[];
    const relationships = db.objectStoreNames.contains(WORKSPACE_GRAPH_STORES.relationships)
      ? await db.getAll(WORKSPACE_GRAPH_STORES.relationships)
      : [] as WorkspaceRelationship[];
    const sourceFiles = db.objectStoreNames.contains(WORKSPACE_GRAPH_STORES.sourceFiles)
      ? await db.getAll(WORKSPACE_GRAPH_STORES.sourceFiles)
      : [] as WorkspaceSourceFile[];

    const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
    const containsPairs = new Set(
      relationships
        .filter((rel) => rel.type === "contains")
        .map((rel) => `${rel.fromArtifactId}->${rel.toArtifactId}`)
    );
    diagnostics.artifactTypeCounts = byType(artifacts);
    diagnostics.relationshipTypeCounts = byType(relationships);
    diagnostics.orphanRelationships = sample(
      relationships.filter((rel) => !artifactIds.has(rel.fromArtifactId) || !artifactIds.has(rel.toArtifactId)),
      sampleLimit
    );
    diagnostics.missingContainsForParent = sample(
      artifacts.filter((artifact) => artifact.parentId && !containsPairs.has(`${artifact.parentId}->${artifact.id}`)),
      sampleLimit
    );
    diagnostics.sourceFilesMissingArtifact = sample(
      sourceFiles.filter((file) => !artifactIds.has(file.id)),
      sampleLimit
    );
    diagnostics.sourceCitationSamples = sample(
      artifacts
        .filter((artifact) => artifact.sourceStore || artifact.sourceId || artifact.sourceKey)
        .map((artifact) => ({
          artifactId: artifact.id,
          type: artifact.type,
          title: artifact.title,
          sourceStore: artifact.sourceStore,
          sourceKey: artifact.sourceKey,
          sourceId: artifact.sourceId,
        })),
      sampleLimit
    );
  } catch (error: any) {
    diagnostics.errors.push(error?.message || String(error));
  } finally {
    try { db?.close(); } catch {}
  }

  diagnostics.durationMs = Date.now() - startedAt;
  diagnostics.ok = diagnostics.opened &&
    diagnostics.missingStores.length === 0 &&
    Object.keys(diagnostics.missingIndexes).length === 0 &&
    diagnostics.orphanRelationships.length === 0 &&
    diagnostics.missingContainsForParent.length === 0 &&
    diagnostics.sourceFilesMissingArtifact.length === 0 &&
    diagnostics.errors.length === 0;
  return diagnostics;
}
