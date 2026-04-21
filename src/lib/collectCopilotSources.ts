/**
 * xHandle: collect copilot sources shared infrastructure.
 * This file contains shared non-visual infrastructure that multiple parts of xHandle depend on for cross-feature behavior.
 * Shared library modules keep feature code focused on engineering workflows while centralizing reusable concerns such as logging, key management, source collection, and persistence.
 * Related files: src/App.js, src/components/utils/logger.js, src/components/XHandleCopilotView.jsx.
 */

type Req = { id: string; title: string; module?: string; moduleId?: string; projectId?: string; folderId?: string; status?: string; attributes?: any };
type Project = { id: string | number; name: string; createdAt?: string };

export type CopilotContext = {
  project?: { id: string | number; name: string };
  projectHint?: { owner?: string; repo?: string };
  requirements?: Req[];
  functionalDecomposition?: any[];    // LiteSummaryDiagram blocks + latest diagram snapshots
  riskRegister?: any[];               // optional
  riskSummarySheet?: any[][];         // optional
  codeArchitecture?: any[];           // from cba:*
  commits?: any[];                    // server-fetched
  sourcesMeta: { lsKeys: string[] };
};

const CAPS = {
  requirements: 200,
  liteBlocks: 8,
  diagramSnapshots: 6,
  cbaRows: 200,
  riskRows: 200,
};

/**
 * safeParse encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function safeParse<T = any>(v: string | null): T | null {
  try { return v ? JSON.parse(v) as T : null; } catch { return null; }
}

/**
 * lsGet encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param key Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function lsGet<T = any>(key: string): T | null {
  return safeParse<T>(localStorage.getItem(key));
}

/**
 * redact encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param obj Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function redact(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  // remove common sensitive props just in case
  const SENSITIVE_KEYS = ["token", "accessToken", "authToken", "password", "avatar", "email", "backendURL", "accountId"];
  const scrub = (o: any) => {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s.toLowerCase()))) delete o[k];
      else scrub(o[k]);
    }
  };
  scrub(clone);
  return clone;
}

/**
 * pickActiveProject encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
function pickActiveProject(): { project?: {id: string|number; name: string}, activeId?: string|number } {
  const projects = lsGet<Project[]>("xhandle.projects") || [];
  const activeId =
    safeParse<number | string>(localStorage.getItem("xhandle.activeProjectId")) ??
    (lsGet<string>("xhandle:req-active-project") || null);
  const proj = projects.find(p => String(p.id) === String(activeId)) || (projects.length === 1 ? projects[0] : undefined);
  return { project: proj ? { id: proj.id, name: proj.name } : undefined, activeId: proj?.id };
}

/**
 * gatherRequirements encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param activeId Stable identifier for the entity this step works with.
 * @returns the value that the next step in this workflow consumes.
 */
function gatherRequirements(activeId?: string | number): Req[] {
  const all = lsGet<Req[]>("xhandle:requirements") || [];
  const scoped = activeId ? all.filter(r => String(r.projectId) === String(activeId)) : all;
  return redact(scoped).slice(0, CAPS.requirements);
}

/**
 * gatherLiteSummary encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
function gatherLiteSummary(): any[] {
  const keys = Object.keys(localStorage).filter(k => k.startsWith("LiteSummaryDiagram::"));
  // prefer newest-looking keys
  const last = keys.slice(-CAPS.liteBlocks);
  const blocks: any[] = [];
  for (const k of last) {
    const b = lsGet<any>(k);
    if (b && (b.nodes || b.rows || b.headers)) blocks.push(redact({ key: k, ...b }));
  }
  return blocks;
}

/**
 * gatherDiagramSnapshots encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
function gatherDiagramSnapshots(): any[] {
  const keys = Object.keys(localStorage).filter(k => k.startsWith("diagram:positions:"));
  const last = keys.slice(-CAPS.diagramSnapshots);
  return last.map(k => ({ key: k, data: redact(lsGet<any>(k)) })).filter(x => x.data);
}

/**
 * gatherRisk encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
function gatherRisk(): { register: any[]; summary: any[][] } {
  const reg = (lsGet<any[]>("xhandle:risk-register") || []).slice(0, CAPS.riskRows).map(redact);
  const sum = (lsGet<any[][]>("xhandle:risk-summary") || []).slice(0, CAPS.riskRows).map(redact);
  return { register: reg, summary: sum };
}

/**
 * gatherCBA encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
function gatherCBA(): any[] {
  const keys = Object.keys(localStorage).filter(k => k.startsWith("cba:"));
  const rows: any[] = [];
  for (const k of keys) {
    const v = lsGet<any[]>(k);
    if (Array.isArray(v) && v.length) rows.push(...v);
  }
  return redact(rows).slice(0, CAPS.cbaRows);
}

/**
 * fetchCommits encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param projectHint Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function fetchCommits(projectHint?: { owner?: string; repo?: string }): Promise<any[]> {
  if (!projectHint?.owner || !projectHint?.repo) return [];
  try {
    const r = await fetch(`/api/github/commits?owner=${encodeURIComponent(projectHint.owner)}&repo=${encodeURIComponent(projectHint.repo)}`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j.slice(0, 20) : [];
  } catch { return []; }
}

/**
 * collectCopilotSources prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param projectHint Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function collectCopilotSources(projectHint?: { owner?: string; repo?: string }): Promise<CopilotContext> {
  const lsKeys = Object.keys(localStorage);
  const { project, activeId } = pickActiveProject();

  return {
    project,
    projectHint,
    requirements: gatherRequirements(activeId || undefined),
    functionalDecomposition: [
      ...gatherLiteSummary(),
      ...gatherDiagramSnapshots(),
    ],
    ...(() => {
      const { register, summary } = gatherRisk();
      return { riskRegister: register, riskSummarySheet: summary };
    })(),
    codeArchitecture: gatherCBA(),
    commits: await fetchCommits(projectHint),
    sourcesMeta: { lsKeys }, // for debug; safe to remove from system prompt if noisy
  };
}
