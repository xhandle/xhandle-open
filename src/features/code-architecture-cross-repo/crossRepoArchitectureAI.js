import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import {
  buildTraceLinksForCrossRepoRow,
  compactFunctionalRowsForCrossRepoPrompt,
  normalizeCrossRepoRow,
} from "./crossRepoArchitectureUtils";

const CROSS_REPO_MODEL = "gpt-4o-mini";

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  const jsonText = first >= 0 && last > first ? body.slice(first, last + 1) : body;
  return JSON.parse(jsonText);
}

function rowMatchesRepo(row = {}, repo = {}) {
  return row.sourceRepoId === repo.repoId || row.sourceRepoId === repo.repoName || row.sourceRepo === repo.repoName;
}

function findRowByRef(repo = {}, ref = "") {
  const target = String(ref || "").trim();
  if (!target) return { row: null, index: null };
  const index = (repo.rows || []).findIndex((row, idx) =>
    String(row.rowRef || "") === target ||
    String(row.traceId || "") === target ||
    String(idx + 1) === target
  );
  if (index < 0) return { row: null, index: null };
  const row = repo.rows[index];
  const originalIndex = Number(row.rowIndex);
  return { row, index: Number.isFinite(originalIndex) ? originalIndex : index };
}

function enrichGeneratedRow(row = {}, index = 0, repos = []) {
  const sourceRepo = repos.find((repo) =>
    row.sourceProjectId === repo.projectId ||
    row.sourceRepoId === repo.repoId ||
    row.sourceRepo === repo.repoName
  ) || repos.find((repo) => rowMatchesRepo(row, repo));
  const targetRepo = repos.find((repo) =>
    row.targetProjectId === repo.projectId ||
    row.targetRepoId === repo.repoId ||
    row.targetRepo === repo.repoName
  );
  const sourceLookup = findRowByRef(sourceRepo, row.sourceDecompositionRowId || row.sourceTraceId);
  const targetLookup = findRowByRef(targetRepo, row.targetDecompositionRowId || row.targetTraceId);
  const sourceArch = sourceLookup.row || {};
  const targetArch = targetLookup.row || {};
  const normalized = normalizeCrossRepoRow({
    ...row,
    id: row.id || `XRA-${String(index + 1).padStart(3, "0")}`,
    sourceRepo: row.sourceRepo || sourceRepo?.repoName || "",
    sourceProjectId: row.sourceProjectId || sourceRepo?.projectId || "",
    sourceRepoId: row.sourceRepoId || sourceRepo?.repoId || "",
    sourceFunction: row.sourceFunction || sourceArch.from || sourceArch.to || "",
    sourceDecompositionRowId: row.sourceDecompositionRowId || sourceArch.rowRef || sourceArch.traceId || "",
    sourceRowIndex: Number.isFinite(sourceLookup.index) ? sourceLookup.index : row.sourceRowIndex,
    sourceTraceId: row.sourceTraceId || sourceArch.traceId || "",
    sourceCSCI: row.sourceCSCI || sourceArch.csci || "",
    sourceCSC: row.sourceCSC || sourceArch.csc || "",
    sourceCSU: row.sourceCSU || sourceArch.csu || "",
    targetRepo: row.targetRepo || targetRepo?.repoName || "",
    targetProjectId: row.targetProjectId || targetRepo?.projectId || "",
    targetRepoId: row.targetRepoId || targetRepo?.repoId || "",
    targetFunction: row.targetFunction || targetArch.from || targetArch.to || "",
    targetDecompositionRowId: row.targetDecompositionRowId || targetArch.rowRef || targetArch.traceId || "",
    targetRowIndex: Number.isFinite(targetLookup.index) ? targetLookup.index : row.targetRowIndex,
    targetTraceId: row.targetTraceId || targetArch.traceId || "",
    targetCSCI: row.targetCSCI || targetArch.csci || "",
    targetCSC: row.targetCSC || targetArch.csc || "",
    targetCSU: row.targetCSU || targetArch.csu || "",
    reviewStatus: row.reviewStatus || "Proposed",
  }, index);
  return {
    ...normalized,
    traceLinks: buildTraceLinksForCrossRepoRow(normalized),
  };
}

export async function deriveCrossRepoArchitecture({ folder, projectsWithRepos = [] }) {
  const repos = projectsWithRepos
    .flatMap((project) => (project.repos || []).map((repo) =>
      compactFunctionalRowsForCrossRepoPrompt(project, repo, repo.rows || [])
    ))
    .filter((repo) => Array.isArray(repo.rows) && repo.rows.length);

  if (repos.length < 2) return [];

  const payload = {
    folder: {
      id: folder?.id || "",
      name: folder?.name || "System folder",
    },
    repos,
  };

  const systemPrompt = `You are a senior systems architect deriving a folder-level cross-repository system architecture from existing repo-level functional decomposition tables.

Infer likely cross-repo interfaces only when the supplied rows suggest producer/consumer relationships, data/control flow, shared interface names, matching topics/endpoints/messages/configs, subsystem dependencies, or source/target function compatibility.

Rules:
- Do not invent raw source evidence. Use only supplied decomposition row evidence.
- Do not include links within the same repo.
- Prefer fewer, higher-confidence system-level links over speculative noise.
- Every link must preserve source and target project/repo/row traceability when available.
- reviewStatus must be "Proposed".
- confidence must be "High", "Medium", or "Low".
- Return only valid JSON with this schema:
{
  "links": [
    {
      "systemFunction": "string",
      "sourceRepo": "string",
      "sourceProjectId": "string",
      "sourceRepoId": "string",
      "sourceFunction": "string",
      "sourceDecompositionRowId": "string",
      "sourceTraceId": "string",
      "sourceCSCI": "string",
      "sourceCSC": "string",
      "sourceCSU": "string",
      "interfaceType": "Data Flow | Control Flow | Service Call | Shared Configuration | Dependency | Event | Other",
      "interfaceName": "string",
      "dataControlFlow": "string",
      "targetRepo": "string",
      "targetProjectId": "string",
      "targetRepoId": "string",
      "targetFunction": "string",
      "targetDecompositionRowId": "string",
      "targetTraceId": "string",
      "targetCSCI": "string",
      "targetCSC": "string",
      "targetCSU": "string",
      "evidence": "string",
      "confidence": "High | Medium | Low",
      "reviewStatus": "Proposed",
      "notes": "string"
    }
  ]
}`;

  try {
    console.info("[xHandle AI] Cross-repo architecture prompt", payload);
    const response = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: CROSS_REPO_MODEL,
        xhandleModelLocked: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Cross-repo architecture AI failed (${response.status}): ${text}`);
    }
    const data = await response.json();
    const raw = data.answer || data.content || data.message || data.choices?.[0]?.message?.content || "";
    console.info("[xHandle AI] Cross-repo architecture response", raw);
    const parsed = extractJson(raw);
    const links = Array.isArray(parsed.links) ? parsed.links : [];
    return links.map((row, index) => enrichGeneratedRow(row, index, repos));
  } catch (error) {
    console.warn("⚠️ Cross-repo architecture AI failed; using empty deterministic fallback.", error);
    return [];
  }
}
