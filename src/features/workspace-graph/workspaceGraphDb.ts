import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  WORKSPACE_GRAPH_DB_NAME,
  WORKSPACE_GRAPH_DB_VERSION,
  WORKSPACE_GRAPH_STORES,
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

export interface WorkspaceGraphSchema extends DBSchema {
  workspaces: { key: string; value: any };
  projects: {
    key: string;
    value: WorkspaceProject;
    indexes: { by_workspace: string; by_source: [string, string]; by_source_key: [string, string] };
  };
  folders: {
    key: string;
    value: WorkspaceFolder;
    indexes: { by_project: string; by_parent: string | null; by_source: [string, string]; by_source_key: [string, string] };
  };
  artifacts: {
    key: string;
    value: WorkspaceArtifact;
    indexes: {
      by_project: string;
      by_type: string;
      by_project_type: [string, string];
      by_source: [string, string];
      by_source_key: [string, string];
      by_updated: string;
    };
  };
  relationships: {
    key: string;
    value: WorkspaceRelationship;
    indexes: {
      by_project: string;
      by_type: string;
      by_from: string;
      by_to: string;
      by_source: [string, string];
      by_source_key: [string, string];
    };
  };
  runs: {
    key: string;
    value: WorkspaceRun;
    indexes: { by_project: string; by_type: string; by_source: [string, string]; by_source_key: [string, string] };
  };
  reviews: {
    key: string;
    value: WorkspaceReview;
    indexes: { by_project: string; by_status: string; by_artifact: string; by_source: [string, string]; by_source_key: [string, string] };
  };
  evidence: {
    key: string;
    value: WorkspaceEvidence;
    indexes: { by_project: string; by_artifact: string; by_source: [string, string]; by_source_key: [string, string] };
  };
  sourceFiles: {
    key: string;
    value: WorkspaceSourceFile;
    indexes: { by_project: string; by_repo: string; by_path: string; by_source: [string, string]; by_source_key: [string, string] };
  };
  summaries: {
    key: string;
    value: WorkspaceSummary;
    indexes: { by_project: string; by_artifact: string; by_source: [string, string]; by_source_key: [string, string] };
  };
  changeLog: {
    key: string;
    value: WorkspaceChange;
    indexes: { by_project: string; by_entity: [string, string]; by_at: string };
  };
}

function createIndexIfMissing(store: IDBObjectStore, name: string, keyPath: string | string[]) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

function getOrCreateStore(
  db: IDBPDatabase<WorkspaceGraphSchema>,
  tx: IDBTransaction,
  name: string,
  options: IDBObjectStoreParameters = { keyPath: "id" }
) {
  return db.objectStoreNames.contains(name)
    ? tx.objectStore(name)
    : db.createObjectStore(name as any, options);
}

export async function openWorkspaceGraphDB() {
  return openDB<WorkspaceGraphSchema>(WORKSPACE_GRAPH_DB_NAME, WORKSPACE_GRAPH_DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.workspaces);

      const projects = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.projects);
      if (projects) {
        createIndexIfMissing(projects, "by_workspace", "workspaceId");
        createIndexIfMissing(projects, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(projects, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const folders = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.folders);
      if (folders) {
        createIndexIfMissing(folders, "by_project", "projectId");
        createIndexIfMissing(folders, "by_parent", "parentId");
        createIndexIfMissing(folders, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(folders, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const artifacts = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.artifacts);
      if (artifacts) {
        createIndexIfMissing(artifacts, "by_project", "projectId");
        createIndexIfMissing(artifacts, "by_type", "type");
        createIndexIfMissing(artifacts, "by_project_type", ["projectId", "type"]);
        createIndexIfMissing(artifacts, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(artifacts, "by_source_key", ["sourceStore", "sourceKey"]);
        createIndexIfMissing(artifacts, "by_updated", "updatedAt");
      }

      const relationships = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.relationships);
      if (relationships) {
        createIndexIfMissing(relationships, "by_project", "projectId");
        createIndexIfMissing(relationships, "by_type", "type");
        createIndexIfMissing(relationships, "by_from", "fromArtifactId");
        createIndexIfMissing(relationships, "by_to", "toArtifactId");
        createIndexIfMissing(relationships, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(relationships, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const runs = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.runs);
      if (runs) {
        createIndexIfMissing(runs, "by_project", "projectId");
        createIndexIfMissing(runs, "by_type", "type");
        createIndexIfMissing(runs, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(runs, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const reviews = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.reviews);
      if (reviews) {
        createIndexIfMissing(reviews, "by_project", "projectId");
        createIndexIfMissing(reviews, "by_status", "status");
        createIndexIfMissing(reviews, "by_artifact", "artifactId");
        createIndexIfMissing(reviews, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(reviews, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const evidence = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.evidence);
      if (evidence) {
        createIndexIfMissing(evidence, "by_project", "projectId");
        createIndexIfMissing(evidence, "by_artifact", "artifactId");
        createIndexIfMissing(evidence, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(evidence, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const sourceFiles = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.sourceFiles);
      if (sourceFiles) {
        createIndexIfMissing(sourceFiles, "by_project", "projectId");
        createIndexIfMissing(sourceFiles, "by_repo", "repoId");
        createIndexIfMissing(sourceFiles, "by_path", "path");
        createIndexIfMissing(sourceFiles, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(sourceFiles, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const summaries = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.summaries);
      if (summaries) {
        createIndexIfMissing(summaries, "by_project", "projectId");
        createIndexIfMissing(summaries, "by_artifact", "artifactId");
        createIndexIfMissing(summaries, "by_source", ["sourceStore", "sourceId"]);
        createIndexIfMissing(summaries, "by_source_key", ["sourceStore", "sourceKey"]);
      }

      const changeLog = getOrCreateStore(db, tx, WORKSPACE_GRAPH_STORES.changeLog);
      if (changeLog) {
        createIndexIfMissing(changeLog, "by_project", "projectId");
        createIndexIfMissing(changeLog, "by_entity", ["entityType", "entityId"]);
        createIndexIfMissing(changeLog, "by_at", "at");
      }
    },
  });
}

export async function ensureWorkspaceGraphDb() {
  const db = await openWorkspaceGraphDB();
  db.close();
  return true;
}
