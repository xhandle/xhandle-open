import {
  getArtifact,
  listArtifacts,
  listRelationships,
} from "./workspaceGraphRepository";
import type { WorkspaceArtifact, WorkspaceRelationship } from "./workspaceGraphTypes";

type CorpusOptions = {
  projectId?: string | null;
  artifactTypes?: string[];
  limit?: number;
};

const DEFAULT_RETRIEVAL_LIMIT = 120;
const MAX_TEXT_LENGTH = 6000;

function boundedText(value: any, max = MAX_TEXT_LENGTH) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}

function artifactText(artifact: WorkspaceArtifact) {
  return [
    artifact.title,
    artifact.summary,
    artifact.content,
    artifact.structuredData ? boundedText(artifact.structuredData, 2500) : "",
  ].filter(Boolean).join("\n\n");
}

function citation(artifact: WorkspaceArtifact) {
  return {
    artifactId: artifact.id,
    projectId: artifact.projectId,
    type: artifact.type,
    title: artifact.title,
    sourceStore: artifact.sourceStore,
    sourceKey: artifact.sourceKey,
    sourceId: artifact.sourceId,
  };
}

function relationshipHints(artifact: WorkspaceArtifact, relationships: WorkspaceRelationship[]) {
  return relationships
    .filter((rel) => rel.fromArtifactId === artifact.id || rel.toArtifactId === artifact.id)
    .slice(0, 24)
    .map((rel) => ({
      id: rel.id,
      type: rel.type,
      direction: rel.fromArtifactId === artifact.id ? "out" : "in",
      relatedArtifactId: rel.fromArtifactId === artifact.id ? rel.toArtifactId : rel.fromArtifactId,
    }));
}

export async function getWorkspaceRetrievalCorpus({
  projectId = null,
  artifactTypes,
  limit = DEFAULT_RETRIEVAL_LIMIT,
}: CorpusOptions = {}) {
  const artifactRows = await listArtifacts({
    projectId,
    type: artifactTypes?.length ? artifactTypes : undefined,
    limit,
  });
  const artifacts = Array.isArray(artifactRows) ? artifactRows : [];
  const relationshipRows = await listRelationships({ projectId, limit: Math.max(limit * 4, 200) });
  const relationships = Array.isArray(relationshipRows) ? relationshipRows : [];
  return artifacts.map((artifact) => ({
    id: `workspace-graph:${artifact.id}`,
    artifactId: artifact.id,
    text: boundedText(artifactText(artifact)),
    metadata: {
      projectId: artifact.projectId || null,
      workspaceId: artifact.workspaceId || null,
      type: artifact.type,
      title: artifact.title,
      status: artifact.status || null,
      tags: artifact.tags || [],
      updatedAt: artifact.updatedAt,
    },
    citations: [citation(artifact)],
    relationshipHints: relationshipHints(artifact, relationships),
  }));
}

export async function getArtifactRetrievalDocument(artifactId: string) {
  const artifact = await getArtifact(artifactId);
  if (!artifact) return null;
  const relationshipRows = await listRelationships({ projectId: artifact.projectId || null, limit: 500 });
  const relationships = Array.isArray(relationshipRows) ? relationshipRows : [];
  return {
    id: `workspace-graph:${artifact.id}`,
    artifactId: artifact.id,
    text: boundedText(artifactText(artifact)),
    metadata: {
      projectId: artifact.projectId || null,
      workspaceId: artifact.workspaceId || null,
      type: artifact.type,
      title: artifact.title,
      status: artifact.status || null,
      tags: artifact.tags || [],
      updatedAt: artifact.updatedAt,
    },
    citations: [citation(artifact)],
    relationshipHints: relationshipHints(artifact, relationships),
  };
}
