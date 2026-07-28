export const WORKSPACE_GRAPH_DB_NAME = "xhandle-workspace-graph";
export const WORKSPACE_GRAPH_DB_VERSION = 2;
export const DEFAULT_WORKSPACE_ID = "workspace:local";

export const WORKSPACE_GRAPH_STORES = {
  workspaces: "workspaces",
  projects: "projects",
  folders: "folders",
  artifacts: "artifacts",
  relationships: "relationships",
  runs: "runs",
  reviews: "reviews",
  evidence: "evidence",
  sourceFiles: "sourceFiles",
  summaries: "summaries",
  changeLog: "changeLog",
} as const;

export type WorkspaceGraphStoreName =
  typeof WORKSPACE_GRAPH_STORES[keyof typeof WORKSPACE_GRAPH_STORES];

export type WorkspaceRelationshipType =
  | "contains"
  | "references"
  | "derived_from"
  | "satisfies"
  | "verifies"
  | "mitigates"
  | "implements"
  | "reviews"
  | "evidences"
  | "traces_to";

export type WorkspaceGraphRecord = {
  id: string;
  workspaceId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  sourceFeature?: string;
  sourceStore?: string;
  sourceKey?: string;
  sourceId?: string;
  version?: number;
};

export type WorkspaceProject = WorkspaceGraphRecord & {
  name: string;
  folderId?: string | null;
  sourceData?: any;
};

export type WorkspaceFolder = WorkspaceGraphRecord & {
  name: string;
  parentId?: string | null;
  kind?: string;
  sourceData?: any;
};

export type WorkspaceArtifact = WorkspaceGraphRecord & {
  type: string;
  parentId?: string | null;
  title: string;
  summary?: string;
  content?: string;
  structuredData?: any;
  status?: string;
  tags?: string[];
};

export type WorkspaceRelationship = {
  id: string;
  type: WorkspaceRelationshipType;
  workspaceId?: string;
  projectId?: string;
  fromArtifactId: string;
  toArtifactId: string;
  confidence?: number;
  sourceFeature?: string;
  sourceStore?: string;
  sourceKey?: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRun = WorkspaceGraphRecord & {
  type: string;
  title: string;
  status?: string;
  artifactIds?: string[];
  structuredData?: any;
};

export type WorkspaceReview = WorkspaceGraphRecord & {
  artifactId?: string;
  status?: string;
  title: string;
  structuredData?: any;
};

export type WorkspaceEvidence = WorkspaceGraphRecord & {
  artifactId?: string;
  title: string;
  type?: string;
  content?: string;
  structuredData?: any;
};

export type WorkspaceSourceFile = WorkspaceGraphRecord & {
  path: string;
  repoId?: string;
  title: string;
  language?: string;
  content?: string;
  symbols?: string[];
  structuredData?: any;
};

export type WorkspaceSummary = WorkspaceGraphRecord & {
  artifactId?: string;
  title: string;
  summary: string;
  structuredData?: any;
};

export type WorkspaceChange = {
  id: string;
  workspaceId?: string;
  projectId?: string;
  entityType: string;
  entityId: string;
  action: string;
  at: string;
  detail?: any;
};

export type ArtifactFilters = {
  projectId?: string | null;
  type?: string | string[];
  sourceStore?: string;
  sourceKey?: string;
  sourceId?: string;
  limit?: number;
};

export type RelationshipFilters = {
  projectId?: string | null;
  type?: WorkspaceRelationshipType | WorkspaceRelationshipType[];
  fromArtifactId?: string;
  toArtifactId?: string;
  limit?: number;
};

export type WorkspaceLLMContext = {
  scope: {
    workspaceId: string;
    projectId?: string | null;
    activeView?: any;
    query?: string;
  };
  workspaceSummary: {
    projectCount: number;
    artifactCount: number;
    relationshipCount: number;
    relevantArtifactCount: number;
  };
  projects: WorkspaceProject[];
  relevantArtifacts: WorkspaceArtifact[];
  relationships: WorkspaceRelationship[];
  runs: WorkspaceRun[];
  reviews: WorkspaceReview[];
  evidence: WorkspaceEvidence[];
  sourceFiles: WorkspaceSourceFile[];
  citations: Array<{
    artifactId?: string;
    sourceStore?: string;
    sourceKey?: string;
    sourceId?: string;
    title?: string;
    type?: string;
  }>;
  diagnostics: Record<string, any>;
};
