import { listArtifacts } from "./workspaceGraphRepository";
import type { ArtifactFilters, WorkspaceArtifact } from "./workspaceGraphTypes";

function haystack(artifact: WorkspaceArtifact) {
  const structured = artifact.structuredData == null
    ? ""
    : JSON.stringify(artifact.structuredData).slice(0, 1200);
  return [
    artifact.title,
    artifact.summary,
    artifact.content ? String(artifact.content).slice(0, 1200) : "",
    artifact.type,
    artifact.status,
    ...(artifact.tags || []),
    structured,
  ].filter(Boolean).join(" ").toLowerCase();
}

function tokenize(query = "") {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .slice(0, 20);
}

export async function searchArtifacts(query = "", filters: ArtifactFilters = {}) {
  const terms = tokenize(query);
  const rows = await listArtifacts({ ...filters, limit: undefined });
  if (!terms.length) return rows.slice(0, filters.limit || 80);

  return rows
    .map((artifact) => {
      const text = haystack(artifact);
      const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
      return { artifact, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(b.artifact.updatedAt || "").localeCompare(String(a.artifact.updatedAt || "")))
    .slice(0, filters.limit || 80)
    .map((entry) => entry.artifact);
}
