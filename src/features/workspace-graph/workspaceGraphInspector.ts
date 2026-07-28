import { validateWorkspaceGraphRuntime } from "./workspaceGraphRuntimeValidator";
import {
  listArtifacts,
  listProjects,
  listRelationships,
  listSourceFiles,
} from "./workspaceGraphRepository";

type InspectorOptions = {
  sampleLimit?: number;
};

export async function inspectWorkspaceGraph({ sampleLimit = 8 }: InspectorOptions = {}) {
  const validation = await validateWorkspaceGraphRuntime({ sampleLimit });
  const [projects, artifacts, relationships, sourceFiles] = await Promise.all([
    listProjects(),
    listArtifacts({ limit: 250 }),
    listRelationships({ limit: 500 }),
    listSourceFiles(null, 100),
  ]);

  const artifactsByType = artifacts.reduce<Record<string, any[]>>((acc, artifact) => {
    const type = artifact.type || "unknown";
    if (!acc[type]) acc[type] = [];
    if (acc[type].length < sampleLimit) {
      acc[type].push({
        id: artifact.id,
        title: artifact.title,
        projectId: artifact.projectId,
        sourceStore: artifact.sourceStore,
        sourceId: artifact.sourceId,
      });
    }
    return acc;
  }, {});

  const relationshipTypeCounts = relationships.reduce<Record<string, number>>((acc, rel) => {
    acc[rel.type] = (acc[rel.type] || 0) + 1;
    return acc;
  }, {});

  return {
    health: validation.ok ? "healthy" : "needs_attention",
    validation,
    counts: {
      projects: projects.length,
      artifacts: artifacts.length,
      relationships: relationships.length,
      sourceFiles: sourceFiles.length,
    },
    migrationErrors: validation.migration?.errors || [],
    artifactsByType,
    relationshipTypeCounts,
    orphanRelationshipCount: validation.orphanRelationships.length,
    sourceCitationSamples: validation.sourceCitationSamples,
  };
}

export async function logWorkspaceGraphInspection(options: InspectorOptions = {}) {
  const inspection = await inspectWorkspaceGraph(options);
  if (typeof console !== "undefined") {
    console.table?.(inspection.counts);
    console.info?.("[workspace-graph] inspection", inspection);
  }
  return inspection;
}
