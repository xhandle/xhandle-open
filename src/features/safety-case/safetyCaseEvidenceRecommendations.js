import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";

const MAX_AI_CANDIDATES = 40;
const MAX_RECOMMENDATIONS = 8;

function extractJson(text) {
  const raw = typeof text === "string" ? text : JSON.stringify(text);
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  return JSON.parse(body);
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["the", "and", "for", "with", "this", "that", "from", "into", "claim", "goal"].includes(token));
}

function nodeText(node) {
  return [
    node?.type,
    node?.title,
    node?.description,
    node?.metadata?.justification,
    node?.status,
  ].filter(Boolean).join(" ");
}

function artifactText(artifact) {
  return [
    artifact?.category,
    artifact?.title,
    artifact?.description,
    artifact?.summary,
    artifact?.sourceLabel,
    artifact?.type,
  ].filter(Boolean).join(" ");
}

function categoryBoost(node, artifact) {
  const target = nodeText(node).toLowerCase();
  const category = String(artifact?.category || "").toLowerCase();
  let score = 0;
  if (/hazard|risk|uca|unsafe/.test(target) && /hazard|risk/.test(category)) score += 10;
  if (/requirement|shall|mitigat|control/.test(target) && /requirement/.test(category)) score += 8;
  if (/verification|validation|test|evidence/.test(target) && /verification|validation|test/.test(category)) score += 8;
  if (/architecture|design|interface|component|module/.test(target) && /architecture|diagram|functional/.test(category)) score += 7;
  if (/functional|decomposition|function|control action/.test(target) && /functional|diagram/.test(category)) score += 7;
  return score;
}

function heuristicRecommendations(node, groups, limit = MAX_RECOMMENDATIONS) {
  const nodeTokens = new Set(tokenize(nodeText(node)));
  const artifacts = groups.flatMap((group) => group.artifacts.map((artifact) => ({ ...artifact, category: artifact.category || group.category })));
  return artifacts
    .map((artifact) => {
      const artifactTokens = tokenize(artifactText(artifact));
      const overlap = artifactTokens.reduce((count, token) => count + (nodeTokens.has(token) ? 1 : 0), 0);
      const score = overlap * 3 + categoryBoost(node, artifact);
      return {
        id: artifact.id,
        title: artifact.title,
        category: artifact.category,
        source: artifact.sourceLabel || artifact.source,
        score,
        confidence: score >= 18 ? "high" : score >= 9 ? "medium" : "low",
        reason: score
          ? `Matches this ${node?.type || "node"} by topic and ${artifact.category} evidence type.`
          : `Potential supporting evidence from ${artifact.category}.`,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function compactCandidate(artifact, category) {
  return {
    id: artifact.id,
    category,
    title: artifact.title,
    location: artifact.description,
    source: artifact.sourceLabel || artifact.source,
    summary: artifact.summary,
    type: artifact.type,
  };
}

async function aiRecommendations({ node, safetyCase, groups, candidates, limit }) {
  const response = await fetch(`${backendURL}/api/chat`, {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: "You are a senior safety case evidence-linking assistant. Recommend only evidence IDs provided by the user. Do not invent evidence. Prefer evidence that substantiates the selected node and belongs to the active safety case project. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Recommend evidence links for the selected safety case node.",
            schema: {
              recommendations: [
                { id: "candidate evidence id", reason: "short user-facing reason", confidence: "high|medium|low" },
              ],
            },
            selectedNode: {
              id: node?.id,
              type: node?.type,
              title: node?.title,
              description: node?.description,
              justification: node?.metadata?.justification,
              status: node?.status,
            },
            safetyCaseProject: {
              id: safetyCase?.id,
              name: safetyCase?.name,
              projectId: safetyCase?.projectId,
              sourceProjectId: safetyCase?.sourceProjectId,
            },
            candidates,
            limit,
          }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(response.status === 401 ? "No AI key is configured for Collaborator." : `AI scan failed: ${response.status}`);
  const data = await response.json();
  const text = data.answer || data.content || data.message || data.choices?.[0]?.message?.content || "";
  const parsed = extractJson(text);
  return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
}

export async function recommendEvidenceLinksForNode({ node, safetyCase, groups, limit = MAX_RECOMMENDATIONS }) {
  const heuristic = heuristicRecommendations(node, groups, Math.max(limit, MAX_RECOMMENDATIONS));
  const artifactsById = new Map(groups.flatMap((group) => group.artifacts.map((artifact) => [artifact.id, { ...artifact, category: artifact.category || group.category }])));
  const candidateIds = new Set(heuristic.map((item) => item.id));
  const fallbackCandidates = groups
    .flatMap((group) => group.artifacts.map((artifact) => ({ ...artifact, category: artifact.category || group.category })))
    .filter((artifact) => !candidateIds.has(artifact.id))
    .slice(0, Math.max(0, MAX_AI_CANDIDATES - candidateIds.size));
  const candidates = [
    ...heuristic.map((item) => artifactsById.get(item.id)).filter(Boolean),
    ...fallbackCandidates,
  ].slice(0, MAX_AI_CANDIDATES).map((artifact) => compactCandidate(artifact, artifact.category));

  try {
    const ai = await aiRecommendations({ node, safetyCase, groups, candidates, limit });
    const seen = new Set();
    const recommendations = ai
      .filter((item) => artifactsById.has(item.id) && !seen.has(item.id) && seen.add(item.id))
      .slice(0, limit)
      .map((item) => {
        const artifact = artifactsById.get(item.id);
        return {
          id: item.id,
          title: artifact.title,
          category: artifact.category,
          source: artifact.sourceLabel || artifact.source,
          confidence: ["high", "medium", "low"].includes(item.confidence) ? item.confidence : "medium",
          reason: String(item.reason || "Recommended by Collaborator for this selected node."),
        };
      });
    if (recommendations.length) return { recommendations, source: "ai", message: "Collaborator recommendations are ready." };
  } catch (error) {
    return {
      recommendations: heuristic.slice(0, limit),
      source: "local",
      message: `${error?.message || "AI scan unavailable"} Using local relevance matching instead.`,
    };
  }

  return {
    recommendations: heuristic.slice(0, limit),
    source: "local",
    message: heuristic.length ? "No AI recommendations were returned. Using local relevance matching instead." : "No strong evidence matches were found for this node.",
  };
}
