import {
  upsertArtifacts,
  upsertEvidence,
  upsertFolder,
  upsertProject,
  upsertRelationships,
  upsertReview,
  upsertRun,
  upsertSourceFile,
} from "./workspaceGraphRepository";
import {
  DEFAULT_WORKSPACE_ID,
  type WorkspaceArtifact,
  type WorkspaceRelationship,
  type WorkspaceRelationshipType,
} from "./workspaceGraphTypes";

type MigrationOptions = { mode?: "incremental" | "full" };
type MigrationCacheOptions = MigrationOptions & { force?: boolean; maxAgeMs?: number };

const MIGRATION_VERSION = 1;
export const WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY = "xhandle.workspaceGraph.lastMigration";
const DEFAULT_MIGRATION_CACHE_AGE_MS = 15000;
const nowISO = () => new Date().toISOString();
let lastMigrationCache: { fingerprint: string; at: number; result: any } | null = null;
let activeMigration: Promise<any> | null = null;

function safeParse<T = any>(raw: string | null, fallback: T): T {
  try {
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function stableId(prefix: string, ...parts: any[]) {
  const raw = parts
    .map((part) => String(part ?? ""))
    .filter(Boolean)
    .join(":");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  const encoded = encodeURIComponent(raw).replace(/%/g, "").slice(0, 150);
  return `${prefix}:${encoded || "unknown"}:${Math.abs(hash).toString(36)}`;
}

function text(value: any, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function compact(value: any, max = 1200) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}

function titleFromRow(row: any, fallback: string) {
  if (!row || typeof row !== "object") return fallback;
  return text(
    row.title ||
    row.name ||
    row.id ||
    row.Hazard ||
    row.Hazards ||
    row["Failure Mode"] ||
    row.Risk ||
    row.from ||
    row.fromFunction ||
    fallback,
    fallback
  );
}

function artifactFromLegacy({
  id,
  type,
  projectId,
  parentId = null,
  sourceFeature,
  sourceStore,
  sourceKey,
  sourceId,
  title,
  summary,
  content,
  structuredData,
  status,
  tags = [],
  createdAt,
  updatedAt,
}: Partial<WorkspaceArtifact> & Pick<WorkspaceArtifact, "id" | "type" | "title">): WorkspaceArtifact {
  const now = nowISO();
  return {
    id,
    type,
    workspaceId: DEFAULT_WORKSPACE_ID,
    projectId: projectId || "",
    parentId,
    sourceFeature,
    sourceStore,
    sourceKey,
    sourceId,
    title,
    summary,
    content,
    structuredData,
    status,
    tags,
    createdAt: createdAt || updatedAt || now,
    updatedAt: updatedAt || createdAt || now,
    version: 1,
  };
}

function relationship({
  type,
  fromArtifactId,
  toArtifactId,
  projectId = "",
  sourceFeature,
  sourceStore,
  sourceId,
  confidence,
}: {
  type: WorkspaceRelationshipType;
  fromArtifactId: string;
  toArtifactId: string;
  projectId?: string;
  sourceFeature?: string;
  sourceStore?: string;
  sourceId?: string;
  confidence?: number;
}): WorkspaceRelationship {
  const now = nowISO();
  return {
    id: stableId("rel", type, fromArtifactId, toArtifactId, sourceStore, sourceId),
    type,
    workspaceId: DEFAULT_WORKSPACE_ID,
    projectId,
    fromArtifactId,
    toArtifactId,
    confidence,
    sourceFeature,
    sourceStore,
    sourceId,
    createdAt: now,
    updatedAt: now,
  };
}

function readLS<T = any>(key: string, fallback: T): T {
  if (!canUseBrowserStorage()) return fallback;
  return safeParse<T>(localStorage.getItem(key), fallback);
}

function localStorageKeys() {
  if (!canUseBrowserStorage()) return [];
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean) as string[];
}

function legacyStorageFingerprint() {
  if (!canUseBrowserStorage()) return "server";
  const watchedPrefixes = [
    "xhandle.",
    "xhandle:",
    "cbaMeta:",
    "LiteSummaryDiagram::",
    "diagram:positions:",
  ];
  const watchedKeys = localStorageKeys()
    .filter((key) => watchedPrefixes.some((prefix) => key.startsWith(prefix)))
    .sort();
  return watchedKeys
    .map((key) => `${key}:${localStorage.getItem(key)?.length || 0}`)
    .join("|");
}

export function getLatestWorkspaceGraphMigrationDiagnostics() {
  if (!canUseBrowserStorage()) return lastMigrationCache?.result || null;
  return safeParse<any>(localStorage.getItem(WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY), lastMigrationCache?.result || null);
}

async function databaseExists(name: string) {
  const indexedDBWithList = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof indexedDBWithList?.databases !== "function") return true;
  try {
    const databases = await indexedDBWithList.databases();
    return databases.some((entry) => entry.name === name);
  } catch {
    return true;
  }
}

async function openExistingDB(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (!(await databaseExists(name))) return null;
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
  });
}

async function readStoreRows(dbName: string, storeName: string) {
  const db = await openExistingDB(dbName);
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains(storeName)) return [];
    return await new Promise<any[]>((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onerror = () => resolve([]);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    });
  } catch {
    return [];
  } finally {
    try { db.close(); } catch {}
  }
}

function folderArtifactId(folderId: string) {
  return stableId("artifact", "project-folder", folderId);
}

function projectArtifactId(projectId: string) {
  return stableId("artifact", "project", projectId);
}

function knownArtifactIdForLegacyTarget(target: any) {
  const raw = text(target?.artifactId || target?.requirementId || target?.safetyFindingId || target?.patchProposalId || target?.id || target?.targetId || target);
  const kind = text(target?.type || target?.artifactType || target?.targetType || "").toLowerCase();
  if (!raw) return "";
  if (String(raw).startsWith("artifact:")) return raw;
  if (/patch/.test(kind)) return stableId("artifact", "patch_proposal", raw);
  if (/finding|safety/.test(kind)) return stableId("artifact", "safety_finding", raw);
  if (/risk/.test(kind)) return stableId("artifact", "risk", raw);
  if (/requirement|req/.test(kind) || /^req[-_:]/i.test(raw)) return stableId("artifact", "requirement", raw);
  return stableId("artifact", "requirement", raw);
}

async function migrateProjects(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const projects = readLS<any[]>("xhandle.projects", []);
  const folders = readLS<any[]>("xhandle.projectFolders", []);

  for (const folder of folders) {
    if (!folder?.id) continue;
    const id = text(folder.id);
    const artifactId = folderArtifactId(id);
    await upsertFolder({
      id: stableId("folder", "project-folder", id),
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: "",
      name: text(folder.name, "Project Folder"),
      parentId: folder.parentId || null,
      kind: "project",
      sourceStore: "localStorage:xhandle.projectFolders",
      sourceKey: "xhandle.projectFolders",
      sourceId: id,
      sourceData: folder,
      createdAt: folder.createdAt || nowISO(),
      updatedAt: folder.updatedAt || folder.createdAt || nowISO(),
      version: 1,
    });
    artifacts.push(artifactFromLegacy({
      id: artifactId,
      type: "folder",
      parentId: folder.parentId ? folderArtifactId(text(folder.parentId)) : null,
      sourceFeature: "Projects",
      sourceStore: "localStorage:xhandle.projectFolders",
      sourceKey: "xhandle.projectFolders",
      sourceId: id,
      title: text(folder.name, "Project Folder"),
      structuredData: folder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      tags: ["folder", "project-folder"],
    }));
    if (folder.parentId) {
      relationships.push(relationship({
        type: "contains",
        fromArtifactId: folderArtifactId(text(folder.parentId)),
        toArtifactId: artifactId,
        sourceStore: "localStorage:xhandle.projectFolders",
        sourceId: id,
      }));
    }
  }

  for (const project of projects) {
    if (!project?.id) continue;
    const id = text(project.id);
    await upsertProject({
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: id,
      name: text(project.name, "Project"),
      folderId: project.folderId || null,
      sourceStore: "localStorage:xhandle.projects",
      sourceKey: "xhandle.projects",
      sourceId: id,
      sourceData: project,
      createdAt: project.createdAt || nowISO(),
      updatedAt: project.updatedAt || project.createdAt || nowISO(),
      version: 1,
    });
    const artifact = artifactFromLegacy({
      id: projectArtifactId(id),
      type: "project",
      projectId: id,
      parentId: project.folderId ? folderArtifactId(text(project.folderId)) : null,
      sourceFeature: "Projects",
      sourceStore: "localStorage:xhandle.projects",
      sourceKey: "xhandle.projects",
      sourceId: id,
      title: text(project.name, "Project"),
      structuredData: project,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      tags: ["project"],
    });
    artifacts.push(artifact);
    if (project.folderId) {
      relationships.push(relationship({
        type: "contains",
        projectId: id,
        fromArtifactId: folderArtifactId(text(project.folderId)),
        toArtifactId: artifact.id,
        sourceStore: "localStorage:xhandle.projects",
        sourceId: id,
      }));
    }
  }
}

function migrateProjectData(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const projectData = readLS<Record<string, any>>("xhandle.projectData", {});
  Object.entries(projectData || {}).forEach(([projectId, data]) => {
    const parent = projectArtifactId(projectId);
    const rows = Array.isArray(data?.responseRows) ? data.responseRows : [];
    rows.forEach((row, index) => {
      const id = stableId("artifact", "projectData", projectId, "responseRows", index);
      artifacts.push(artifactFromLegacy({
        id,
        type: "functional_decomposition_row",
        projectId,
        parentId: parent,
        sourceFeature: "Functional Decomposition",
        sourceStore: "localStorage:xhandle.projectData",
        sourceKey: `xhandle.projectData.${projectId}.responseRows`,
        sourceId: `${projectId}:responseRows:${index}`,
        title: `${text(row.fromFunction || row.from || "Function")} -> ${text(row.toFunction || row.to || "Function")}`,
        summary: compact(row, 500),
        structuredData: row,
        updatedAt: data?._updatedAt,
        tags: ["functional", "decomposition"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "localStorage:xhandle.projectData" }));
    });

    const risks = Array.isArray(data?.riskRegister) ? data.riskRegister : [];
    risks.forEach((row, index) => {
      const sourceId = row?.id || `${projectId}:riskRegister:${index}`;
      const id = stableId("artifact", "risk", sourceId);
      artifacts.push(artifactFromLegacy({
        id,
        type: "risk",
        projectId,
        parentId: parent,
        sourceFeature: "Risk Register",
        sourceStore: "localStorage:xhandle.projectData",
        sourceKey: `xhandle.projectData.${projectId}.riskRegister`,
        sourceId: text(sourceId),
        title: titleFromRow(row, `Risk ${index + 1}`),
        summary: row?.description || compact(row, 500),
        structuredData: row,
        status: row?.status,
        updatedAt: data?._updatedAt,
        tags: ["risk"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "localStorage:xhandle.projectData" }));
    });

    const summary = data?.analysisResult?.Summary;
    if (Array.isArray(summary) && summary.length > 1) {
      const headers = summary[0] || [];
      summary.slice(1).forEach((row, rowIndex) => {
        const structuredData = { rowIndex, columns: headers, row };
        const id = stableId("artifact", "hazard-summary", projectId, rowIndex);
        artifacts.push(artifactFromLegacy({
          id,
          type: "hazard_analysis_row",
          projectId,
          parentId: parent,
          sourceFeature: "Hazard Analysis",
          sourceStore: "localStorage:xhandle.projectData",
          sourceKey: `xhandle.projectData.${projectId}.analysisResult.Summary`,
          sourceId: `${projectId}:analysisResult:Summary:${rowIndex}`,
          title: titleFromRow(Object.fromEntries(headers.map((header: string, i: number) => [header, row[i]])), `Hazard row ${rowIndex + 1}`),
          summary: compact(structuredData, 500),
          structuredData,
          updatedAt: data?._updatedAt,
          tags: ["hazard", "analysis"],
        }));
        relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "localStorage:xhandle.projectData" }));
      });
    }
  });
}

function migrateRequirements(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const reqProjects = readLS<any[]>("xhandle:req-projects", []);
  reqProjects.forEach((project) => {
    if (!project?.id) return;
    const projectId = text(project.id);
    const id = stableId("artifact", "requirements-project", projectId);
    artifacts.push(artifactFromLegacy({
      id,
      type: "requirements_project",
      projectId,
      parentId: projectArtifactId(projectId),
      sourceFeature: "Requirements",
      sourceStore: "localStorage:xhandle:req-projects",
      sourceKey: "xhandle:req-projects",
      sourceId: projectId,
      title: text(project.name || project.title, "Requirements Project"),
      summary: project.description || "",
      structuredData: project,
      tags: ["requirements", "project"],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
    relationships.push(relationship({
      type: "contains",
      projectId,
      fromArtifactId: projectArtifactId(projectId),
      toArtifactId: id,
      sourceStore: "localStorage:xhandle:req-projects",
      sourceId: projectId,
    }));
  });

  const rows = readLS<any[]>("xhandle:requirements", []);
  rows.forEach((row, index) => {
    const projectId = text(row?.projectId || row?.folderId || "");
    const id = stableId("artifact", "requirement", row?.id || index);
    artifacts.push(artifactFromLegacy({
      id,
      type: "requirement",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "Requirements",
      sourceStore: "localStorage:xhandle:requirements",
      sourceId: text(row?.id || index),
      title: titleFromRow(row, `Requirement ${index + 1}`),
      summary: row?.title || compact(row, 500),
      structuredData: row,
      status: row?.status,
      tags: ["requirement"],
      updatedAt: row?.updatedAt,
      createdAt: row?.createdAt,
    }));
    if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: id, sourceStore: "localStorage:xhandle:requirements" }));
    (Array.isArray(row?.links) ? row.links : []).forEach((link: any) => {
      const target = knownArtifactIdForLegacyTarget(link);
      if (target) relationships.push(relationship({ type: "traces_to", projectId, fromArtifactId: id, toArtifactId: target, sourceStore: "localStorage:xhandle:requirements" }));
    });
  });
}

async function migrateCodeArchitecture(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const cbaProjects = readLS<any[]>("xhandle.codeArchitectureProjects", []);
  cbaProjects.forEach((project) => {
    const projectId = text(project?.id || "");
    (Array.isArray(project?.repos) ? project.repos : []).forEach((repo: any) => {
      const repoArtifactId = stableId("artifact", "repository", projectId, repo?.id || repo?.repoId);
      artifacts.push(artifactFromLegacy({
        id: repoArtifactId,
        type: "repository",
        projectId,
        parentId: projectId ? projectArtifactId(projectId) : null,
        sourceFeature: "Code-Based Architecture",
        sourceStore: "localStorage:xhandle.codeArchitectureProjects",
        sourceId: text(repo?.id || repo?.repoId),
        title: text(repo?.repoName || repo?.repoId || `${repo?.owner || ""}/${repo?.repo || ""}`, "Repository"),
        summary: repo?.repoUrl || "",
        structuredData: { ...repo, token: undefined },
        tags: ["repository", "code-architecture"],
        updatedAt: repo?.updatedAt,
        createdAt: repo?.createdAt,
      }));
      if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: repoArtifactId, sourceStore: "localStorage:xhandle.codeArchitectureProjects" }));
    });
  });

  localStorageKeys()
    .filter((key) => key.startsWith("cbaMeta:"))
    .forEach((key) => {
      const meta = readLS<any>(key, null);
      if (!meta) return;
      const projectId = text(meta.projectId || meta.cbaProjectId || "");
      const repoId = text(meta.repoId || meta.repoName || meta.repositoryId || key.replace(/^cbaMeta:/, ""));
      const repoArtifactId = stableId("artifact", "repository", projectId || "cbaMeta", repoId);
      artifacts.push(artifactFromLegacy({
        id: repoArtifactId,
        type: "repository",
        projectId,
        parentId: projectId ? projectArtifactId(projectId) : null,
        sourceFeature: "Code-Based Architecture",
        sourceStore: "localStorage:cbaMeta:*",
        sourceKey: key,
        sourceId: repoId,
        title: text(meta.repoName || meta.repoId || meta.repository || repoId, "Repository"),
        summary: meta.repoUrl || meta.branch || "",
        structuredData: { ...meta, token: undefined },
        tags: ["repository", "code-architecture", "metadata"],
        updatedAt: meta.updatedAt,
        createdAt: meta.createdAt,
      }));
      if (projectId) {
        relationships.push(relationship({
          type: "contains",
          projectId,
          fromArtifactId: projectArtifactId(projectId),
          toArtifactId: repoArtifactId,
          sourceStore: "localStorage:cbaMeta:*",
          sourceId: repoId,
        }));
      }
    });

  const cbaRecords = await readStoreRows("xhandle", "copilot_baseline");
  cbaRecords.forEach((record) => {
    const key = text(record?.key);
    const rows = Array.isArray(record?.value) ? record.value : [];
    const parts = key.split(":");
    const projectId = parts[1] || "";
    const repoId = parts.slice(2).join(":");
    rows.forEach((row: any, index: number) => {
      const id = stableId("artifact", "cba", key, row?.traceId || row?.edgeId || index);
      const repoArtifactId = repoId ? stableId("artifact", "repository", projectId, repoId) : "";
      artifacts.push(artifactFromLegacy({
        id,
        type: "code_architecture_edge",
        projectId,
        parentId: repoArtifactId || null,
        sourceFeature: "Code-Based Architecture",
        sourceStore: "indexedDB:xhandle/copilot_baseline",
        sourceKey: key,
        sourceId: `${key}:${row?.traceId || row?.edgeId || index}`,
        title: `${text(row.from || row.fromFunction || "Source")} -> ${text(row.to || row.toFunction || "Target")}`,
        summary: compact(row, 700),
        structuredData: row,
        tags: ["code-architecture", "edge"],
        updatedAt: row?.updatedAt,
      }));
      if (repoArtifactId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: repoArtifactId, toArtifactId: id, sourceStore: "indexedDB:xhandle/copilot_baseline" }));
      [row?.fromFile, row?.toFile].filter(Boolean).forEach((path) => {
        const fileId = stableId("artifact", "source-file", repoId || projectId, path);
        artifacts.push(artifactFromLegacy({
          id: fileId,
          type: "source_file",
          projectId,
          parentId: repoArtifactId || null,
          sourceFeature: "Code-Based Architecture",
          sourceStore: "indexedDB:xhandle/copilot_baseline",
          sourceKey: key,
          sourceId: `${key}:${path}`,
          title: text(path, "Source file"),
          summary: "Source file referenced by a code architecture edge.",
          structuredData: { path, repoId },
          tags: ["source-file", "code-architecture"],
        }));
        relationships.push(relationship({ type: "references", projectId, fromArtifactId: id, toArtifactId: fileId, sourceStore: "indexedDB:xhandle/copilot_baseline" }));
      });
    });
  });
}

async function migrateCodeIndex(artifacts: WorkspaceArtifact[]) {
  const records = await readStoreRows("xhandle", "code_index");
  for (const record of records) {
    const key = text(record?.key);
    const value = record?.value || {};
    const path = value.path || key.split(":").slice(-1)[0] || key;
    const repoId = key.startsWith("code:file:") ? key.replace(/^code:file:/, "").split(":").slice(0, -1).join(":") : value.repoId || "";
    const id = stableId("artifact", "source-file", repoId, path);
    const sourceFile = {
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: value.projectId || "",
      repoId,
      path,
      title: path,
      language: value.lang || value.language || "",
      content: value.content || "",
      symbols: [...(value.functions || []), ...(value.exports || [])].filter(Boolean),
      structuredData: value,
      sourceFeature: "Code Index",
      sourceStore: "indexedDB:xhandle/code_index",
      sourceKey: key,
      sourceId: key,
      createdAt: value.createdAt || nowISO(),
      updatedAt: value.updatedAt || nowISO(),
      version: 1,
    };
    await upsertSourceFile(sourceFile);
    artifacts.push(artifactFromLegacy({
      id,
      type: "source_file",
      projectId: sourceFile.projectId,
      sourceFeature: "Code Index",
      sourceStore: "indexedDB:xhandle/code_index",
      sourceKey: key,
      sourceId: key,
      title: path,
      summary: `${sourceFile.language || "source"} file with ${sourceFile.symbols?.length || 0} indexed symbols.`,
      content: sourceFile.content?.slice(0, 4000),
      structuredData: value,
      tags: ["source-file"],
    }));
  }
}

function migrateSysML(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const models = readLS<any[]>("xhandle.designManagement.sysmlV2.models", []);
  models.forEach((model) => {
    const projectId = text(model?.projectId || "");
    const modelId = stableId("artifact", "sysml-model", model?.id);
    artifacts.push(artifactFromLegacy({
      id: modelId,
      type: "sysml_model",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "SysML v2 Modeler",
      sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models",
      sourceId: text(model?.id),
      title: text(model?.name, "SysML Model"),
      summary: model?.description || "",
      structuredData: model,
      tags: ["sysml"],
      updatedAt: model?.updatedAt,
    }));
    (model?.elements || []).forEach((element: any) => {
      const elementId = stableId("artifact", "sysml-element", model?.id, element?.id);
      artifacts.push(artifactFromLegacy({
        id: elementId,
        type: "sysml_element",
        projectId,
        parentId: modelId,
        sourceFeature: "SysML v2 Modeler",
        sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models",
        sourceId: `${model?.id}:${element?.id}`,
        title: text(element?.name, "SysML Element"),
        summary: element?.description || element?.type || "",
        structuredData: element,
        tags: ["sysml", element?.type].filter(Boolean),
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: modelId, toArtifactId: elementId, sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models" }));
    });
    (model?.relationships || []).forEach((rel: any) => {
      if (!rel?.sourceId || !rel?.targetId) return;
      relationships.push(relationship({
        type: "traces_to",
        projectId,
        fromArtifactId: stableId("artifact", "sysml-element", model?.id, rel.sourceId),
        toArtifactId: stableId("artifact", "sysml-element", model?.id, rel.targetId),
        sourceFeature: "SysML v2 Modeler",
        sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models",
        sourceId: `${model?.id}:${rel?.id || rel.sourceId}`,
      }));
    });
  });
}

async function migrateSimpleIndexedStores(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const reviewItems = await readStoreRows("xhandle-results-review", "reviewItems");
  for (const item of reviewItems) {
    const id = stableId("artifact", "review", item?.id);
    const target = item?.artifactId || item?.targetArtifactId || item?.sourceRunId
      ? knownArtifactIdForLegacyTarget({
          id: item?.artifactId || item?.targetArtifactId || item?.sourceRunId,
          type: item?.artifactType || item?.reviewUnitType,
        })
      : "";
    const projectId = text(item?.projectId || "");
    const artifact = artifactFromLegacy({
      id,
      type: "review_item",
      projectId,
      sourceFeature: item?.sourceFeature || "Results Review",
      sourceStore: "indexedDB:xhandle-results-review/reviewItems",
      sourceId: text(item?.id),
      title: `${item?.sourceFeature || "Review"} ${item?.reviewUnitType || "item"}`,
      summary: item?.reviewerFeedback || compact(item?.currentContent || item?.originalContent, 700),
      structuredData: item,
      status: item?.status,
      tags: ["review"],
      updatedAt: item?.updatedAt,
      createdAt: item?.createdAt,
    });
    artifacts.push(artifact);
    await upsertReview({ ...artifact, artifactId: target || undefined });
    if (target) relationships.push(relationship({ type: "reviews", projectId, fromArtifactId: id, toArtifactId: target, sourceStore: "indexedDB:xhandle-results-review/reviewItems" }));
  }

  const hazardRuns = await readStoreRows("xhandle-code-architecture-hazard-analysis", "hazardAnalysisRuns");
  for (const run of hazardRuns) {
    const projectId = text(run?.projectId || "");
    const runId = stableId("run", "cba-hazard", run?.id);
    await upsertRun({
      id: runId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      type: "code_architecture_hazard_analysis",
      title: `${run?.hazardMethod || "Hazard"} analysis`,
      status: run?.reviewStatus,
      artifactIds: [],
      structuredData: run,
      sourceFeature: "Code Architecture Hazard Analysis",
      sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns",
      sourceId: text(run?.id),
      createdAt: run?.createdAt || nowISO(),
      updatedAt: run?.updatedAt || run?.createdAt || nowISO(),
      version: 1,
    });
    const summary = run?.generatedSheets?.Summary;
    if (Array.isArray(summary) && summary.length > 1) {
      const headers = summary[0] || [];
      summary.slice(1).forEach((row: any[], index: number) => {
        const id = stableId("artifact", "cba-hazard-row", run?.id, index);
        artifacts.push(artifactFromLegacy({
          id,
          type: "hazard_analysis_row",
          projectId,
          sourceFeature: "Code Architecture Hazard Analysis",
          sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns",
          sourceId: `${run?.id}:summary:${index}`,
          title: titleFromRow(Object.fromEntries(headers.map((h: string, i: number) => [h, row[i]])), `Hazard row ${index + 1}`),
          summary: compact({ headers, row }, 700),
          structuredData: { rowIndex: index, columns: headers, row },
          status: run?.reviewStatus,
          tags: ["hazard", "code-architecture"],
          updatedAt: run?.updatedAt,
        }));
        relationships.push(relationship({ type: "derived_from", projectId, fromArtifactId: id, toArtifactId: stableId("run", "cba-hazard", run?.id), sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns" }));
      });
    }
  }

  const remediationStores = [
    ["safetyFindings", "safety_finding"],
    ["patchProposals", "patch_proposal"],
    ["reviewDecisions", "review_decision"],
    ["summaryArtifacts", "summary_artifact"],
    ["verificationRuns", "verification_run"],
    ["safetyRemediationEvidence", "implementation_evidence"],
  ];
  for (const [store, type] of remediationStores) {
    const rows = await readStoreRows("xhandle-safety-remediation", store);
    for (const row of rows) {
      const projectId = text(row?.projectId || "");
      const id = stableId("artifact", type, row?.id);
      artifacts.push(artifactFromLegacy({
        id,
        type,
        projectId,
        sourceFeature: "Safety Remediation",
        sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
        sourceId: text(row?.id),
        title: titleFromRow(row, type),
        summary: row?.summary || row?.description || row?.rationale || compact(row, 700),
        structuredData: row,
        status: row?.status || row?.reviewStatus || row?.verificationStatus,
        tags: ["safety-remediation", type],
        updatedAt: row?.updatedAt,
        createdAt: row?.createdAt,
      }));
      if (projectId) {
        relationships.push(relationship({
          type: "contains",
          projectId,
          fromArtifactId: projectArtifactId(projectId),
          toArtifactId: id,
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
          sourceId: text(row?.id),
        }));
      }
      if (type === "verification_run") {
        await upsertRun({
          id: stableId("run", "verification", row?.id),
          workspaceId: DEFAULT_WORKSPACE_ID,
          projectId,
          type: "verification_run",
          title: titleFromRow(row, "Verification run"),
          status: row?.status || row?.verificationStatus,
          artifactIds: [
            row?.patchProposalId ? stableId("artifact", "patch_proposal", row.patchProposalId) : null,
            row?.safetyFindingId ? stableId("artifact", "safety_finding", row.safetyFindingId) : null,
          ].filter(Boolean) as string[],
          structuredData: row,
          sourceFeature: "Safety Remediation",
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
          sourceId: text(row?.id),
          createdAt: row?.createdAt || nowISO(),
          updatedAt: row?.updatedAt || row?.createdAt || nowISO(),
          version: 1,
        });
      }
      if (type === "implementation_evidence") {
        await upsertEvidence({
          id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          projectId,
          artifactId: row?.patchProposalId ? stableId("artifact", "patch_proposal", row.patchProposalId) : undefined,
          title: titleFromRow(row, "Implementation evidence"),
          type: "implementation_evidence",
          content: row?.summary || row?.description || "",
          structuredData: row,
          sourceFeature: "Safety Remediation",
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
          sourceId: text(row?.id),
          createdAt: row?.createdAt || nowISO(),
          updatedAt: row?.updatedAt || row?.createdAt || nowISO(),
          version: 1,
        });
      }
      if (type === "patch_proposal" && row?.safetyFindingId) {
        relationships.push(relationship({
          type: "implements",
          projectId,
          fromArtifactId: id,
          toArtifactId: stableId("artifact", "safety_finding", row.safetyFindingId),
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
        }));
      }
      if ((type === "verification_run" || type === "implementation_evidence") && (row?.patchProposalId || row?.safetyFindingId)) {
        relationships.push(relationship({
          type: "verifies",
          projectId,
          fromArtifactId: id,
          toArtifactId: stableId("artifact", row?.patchProposalId ? "patch_proposal" : "safety_finding", row?.patchProposalId || row?.safetyFindingId),
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
        }));
      }
    }
  }

  const attachments = await readStoreRows("SafetyCaseEvidenceDB", "Attachments");
  for (const item of attachments) {
    const projectId = text(item?.projectId || "");
    const artifactId = stableId("artifact", "safety-evidence-attachment", item?.id);
    const evidence = {
      id: artifactId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      artifactId: item?.nodeId ? stableId("artifact", "safety-case-node", item?.safetyCaseId, item.nodeId) : undefined,
      title: text(item?.title || item?.name, "Evidence attachment"),
      type: item?.type || "file-attachment",
      content: item?.description || "",
      structuredData: { ...item, dataUrl: item?.dataUrl ? "[data-url omitted from LLM graph summary]" : undefined },
      sourceFeature: "Safety Case Evidence",
      sourceStore: "indexedDB:SafetyCaseEvidenceDB/Attachments",
      sourceId: text(item?.id),
      createdAt: item?.createdAt || nowISO(),
      updatedAt: item?.updatedAt || item?.createdAt || nowISO(),
      version: 1,
    };
    await upsertEvidence(evidence);
    artifacts.push(artifactFromLegacy({
      id: artifactId,
      type: "evidence",
      projectId,
      sourceFeature: "Safety Case Evidence",
      sourceStore: "indexedDB:SafetyCaseEvidenceDB/Attachments",
      sourceId: text(item?.id),
      title: evidence.title,
      summary: evidence.content,
      structuredData: evidence.structuredData,
      tags: ["evidence", "attachment"],
    }));
    if (evidence.artifactId) {
      relationships.push(relationship({
        type: "evidences",
        projectId,
        fromArtifactId: artifactId,
        toArtifactId: evidence.artifactId,
        sourceStore: "indexedDB:SafetyCaseEvidenceDB/Attachments",
        sourceId: text(item?.id),
      }));
    }
  }
}

async function migrateTraceabilityDB(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const folders = await readStoreRows("TraceabilityDB", "Folders");
  folders.forEach((folder) => {
    if (!folder?.id) return;
    const id = folderArtifactId(`traceability:${folder.id}`);
    artifacts.push(artifactFromLegacy({
      id,
      type: "folder",
      parentId: folder.parentId ? folderArtifactId(`traceability:${folder.parentId}`) : null,
      sourceFeature: "Traceability",
      sourceStore: "indexedDB:TraceabilityDB/Folders",
      sourceId: text(folder.id),
      title: text(folder.name || folder.title, "Traceability Folder"),
      structuredData: folder,
      tags: ["folder", "traceability"],
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    }));
    if (folder.parentId) {
      relationships.push(relationship({
        type: "contains",
        fromArtifactId: folderArtifactId(`traceability:${folder.parentId}`),
        toArtifactId: id,
        sourceStore: "indexedDB:TraceabilityDB/Folders",
        sourceId: text(folder.id),
      }));
    }
  });

  const projects = await readStoreRows("TraceabilityDB", "Projects");
  projects.forEach((project) => {
    if (!project?.id) return;
    const projectId = text(project.id);
    const artifactId = projectArtifactId(projectId);
    artifacts.push(artifactFromLegacy({
      id: artifactId,
      type: "project",
      projectId,
      parentId: project.folderId ? folderArtifactId(`traceability:${project.folderId}`) : null,
      sourceFeature: "Traceability",
      sourceStore: "indexedDB:TraceabilityDB/Projects",
      sourceId: projectId,
      title: text(project.name || project.title, "Traceability Project"),
      summary: project.description || "",
      structuredData: project,
      tags: ["project", "traceability"],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
    if (project.folderId) {
      relationships.push(relationship({
        type: "contains",
        projectId,
        fromArtifactId: folderArtifactId(`traceability:${project.folderId}`),
        toArtifactId: artifactId,
        sourceStore: "indexedDB:TraceabilityDB/Projects",
        sourceId: projectId,
      }));
    }
  });

  const notes = await readStoreRows("TraceabilityDB", "Notes");
  notes.forEach((note, index) => {
    const projectId = text(note?.projectId || "");
    const id = stableId("artifact", "traceability-note", note?.id || index);
    artifacts.push(artifactFromLegacy({
      id,
      type: "note",
      projectId,
      parentId: note?.folderId ? folderArtifactId(`traceability:${note.folderId}`) : (projectId ? projectArtifactId(projectId) : null),
      sourceFeature: "Traceability",
      sourceStore: "indexedDB:TraceabilityDB/Notes",
      sourceId: text(note?.id || index),
      title: titleFromRow(note, `Note ${index + 1}`),
      summary: note?.summary || note?.content || note?.body || "",
      content: note?.content || note?.body || "",
      structuredData: note,
      tags: ["note", "traceability"],
      createdAt: note?.createdAt,
      updatedAt: note?.updatedAt,
    }));
    const parent = note?.folderId ? folderArtifactId(`traceability:${note.folderId}`) : (projectId ? projectArtifactId(projectId) : "");
    if (parent) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "indexedDB:TraceabilityDB/Notes" }));
  });

  const safetyCases = await readStoreRows("TraceabilityDB", "SafetyCases");
  for (const sc of safetyCases) {
    const projectId = text(sc?.projectId || sc?.sourceProjectId || "");
    const scId = stableId("artifact", "safety-case", sc?.id);
    artifacts.push(artifactFromLegacy({
      id: scId,
      type: "safety_case",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "Safety Case",
      sourceStore: "indexedDB:TraceabilityDB/SafetyCases",
      sourceId: text(sc?.id),
      title: text(sc?.name || sc?.title, "Safety Case"),
      summary: sc?.description || "",
      structuredData: sc,
      tags: ["safety-case"],
      updatedAt: sc?.updatedAt,
      createdAt: sc?.createdAt,
    }));
    if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: scId, sourceStore: "indexedDB:TraceabilityDB/SafetyCases" }));
    (sc?.nodes || []).forEach((node: any) => {
      const nodeId = stableId("artifact", "safety-case-node", sc?.id, node?.id);
      artifacts.push(artifactFromLegacy({
        id: nodeId,
        type: "safety_case_node",
        projectId,
        parentId: scId,
        sourceFeature: "Safety Case",
        sourceStore: "indexedDB:TraceabilityDB/SafetyCases",
        sourceId: `${sc?.id}:${node?.id}`,
        title: text(node?.title || node?.label, "Safety Case Node"),
        summary: node?.description || node?.statement || "",
        structuredData: node,
        status: node?.status,
        tags: ["safety-case", node?.type].filter(Boolean),
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: scId, toArtifactId: nodeId, sourceStore: "indexedDB:TraceabilityDB/SafetyCases" }));
    });
    (sc?.edges || []).forEach((edge: any) => {
      if (!edge?.source || !edge?.target) return;
      relationships.push(relationship({
        type: "traces_to",
        projectId,
        fromArtifactId: stableId("artifact", "safety-case-node", sc?.id, edge.source),
        toArtifactId: stableId("artifact", "safety-case-node", sc?.id, edge.target),
        sourceFeature: "Safety Case",
        sourceStore: "indexedDB:TraceabilityDB/SafetyCases",
        sourceId: `${sc?.id}:${edge?.id || edge.source}`,
      }));
    });
  }

  const requirements = await readStoreRows("TraceabilityDB", "Requirements");
  requirements.forEach((row, index) => {
    const projectId = text(row?.projectId || "");
    const id = stableId("artifact", "traceability-requirement", row?.id || index);
    artifacts.push(artifactFromLegacy({
      id,
      type: "requirement",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "Traceability Requirements",
      sourceStore: "indexedDB:TraceabilityDB/Requirements",
      sourceId: text(row?.id || index),
      title: titleFromRow(row, `Requirement ${index + 1}`),
      summary: row?.title || row?.description || compact(row, 500),
      structuredData: row,
      status: row?.status,
      tags: ["requirement", "traceability"],
    }));
    if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: id, sourceStore: "indexedDB:TraceabilityDB/Requirements" }));
  });
}

export async function migrateLegacyStorageToWorkspaceGraph(_options: MigrationOptions = {}) {
  const startedAt = Date.now();
  const artifacts: WorkspaceArtifact[] = [];
  const relationships: WorkspaceRelationship[] = [];
  const errors: Array<{ step: string; error: string }> = [];

  async function runStep(step: string, fn: () => void | Promise<void>) {
    try {
      await fn();
    } catch (error: any) {
      errors.push({ step, error: error?.message || String(error) });
    }
  }

  await runStep("projects", () => migrateProjects(artifacts, relationships));
  await runStep("projectData", () => migrateProjectData(artifacts, relationships));
  await runStep("requirements", () => migrateRequirements(artifacts, relationships));
  await runStep("codeArchitecture", () => migrateCodeArchitecture(artifacts, relationships));
  await runStep("codeIndex", () => migrateCodeIndex(artifacts));
  await runStep("sysml", () => migrateSysML(artifacts, relationships));
  await runStep("traceability", () => migrateTraceabilityDB(artifacts, relationships));
  await runStep("indexedFeatureStores", () => migrateSimpleIndexedStores(artifacts, relationships));

  const uniqueArtifacts = Array.from(new Map(artifacts.map((artifact) => [artifact.id, artifact])).values());
  const uniqueRelationships = Array.from(new Map(relationships.map((rel) => [rel.id, rel])).values());

  await upsertArtifacts(uniqueArtifacts);
  await upsertRelationships(uniqueRelationships);

  if (canUseBrowserStorage()) {
    try {
      const diagnostics = {
        version: MIGRATION_VERSION,
        migratedAt: nowISO(),
        artifactCount: uniqueArtifacts.length,
        relationshipCount: uniqueRelationships.length,
        errors,
        durationMs: Date.now() - startedAt,
      };
      localStorage.setItem(WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY, JSON.stringify(diagnostics));
    } catch {}
  }

  const result = {
    version: MIGRATION_VERSION,
    migratedAt: nowISO(),
    artifactCount: uniqueArtifacts.length,
    relationshipCount: uniqueRelationships.length,
    errors,
    durationMs: Date.now() - startedAt,
  };
  lastMigrationCache = { fingerprint: legacyStorageFingerprint(), at: Date.now(), result };
  return result;
}

export async function migrateLegacyStorageToWorkspaceGraphIfStale(options: MigrationCacheOptions = {}) {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MIGRATION_CACHE_AGE_MS;
  const fingerprint = legacyStorageFingerprint();
  const now = Date.now();
  if (!options.force && options.mode !== "full" && lastMigrationCache && lastMigrationCache.fingerprint === fingerprint && now - lastMigrationCache.at < maxAgeMs) {
    return { ...lastMigrationCache.result, skipped: true, skipReason: "fresh" };
  }
  if (activeMigration) return activeMigration;
  activeMigration = migrateLegacyStorageToWorkspaceGraph(options)
    .finally(() => {
      activeMigration = null;
    });
  return activeMigration;
}
