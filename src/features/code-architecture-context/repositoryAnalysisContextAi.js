import { buildAIAuthOpts } from "../../components/backendConfig";
import {
  getStoredActiveAIProvider,
  getStoredAIProviderModelPreference,
} from "../../lib/aiProviderConfig";

const MAX_GENERATED_CONTEXT_CHARS = 6000;

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeGeneratedRepositoryAnalysisContext(value) {
  return clean(value)
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .slice(0, MAX_GENERATED_CONTEXT_CHARS)
    .trim();
}

function responseText(body = {}) {
  return normalizeGeneratedRepositoryAnalysisContext(
    body?.choices?.[0]?.message?.content
      || body?.result
      || body?.answer
      || body?.content
      || body?.message
      || "",
  );
}

export async function generateRepositoryAnalysisContext({
  repositoryUrl,
  repositoryContext = {},
  existingContext = "",
}) {
  const repoUrl = clean(repositoryUrl);
  if (!repoUrl) throw new Error("Enter a repository URL before generating analysis context.");

  const readmeExcerpt = clean(repositoryContext?.readmeText).slice(0, 18000);
  const folderSummary = clean(repositoryContext?.folderSummary).slice(0, 9000);
  const topLevelEntries = Array.isArray(repositoryContext?.topLevelEntries)
    ? repositoryContext.topLevelEntries.slice(0, 60)
    : [];
  if (!readmeExcerpt && !folderSummary && !topLevelEntries.length) {
    throw new Error("The repository did not provide enough README or structure evidence to generate analysis context.");
  }

  const provider = getStoredActiveAIProvider();
  const model = getStoredAIProviderModelPreference(provider, { includeDefault: true });
  const prompt = [
    "Create concise analysis context for a code-based architecture project.",
    "",
    `Repository URL: ${repoUrl}`,
    `Repository name: ${clean(repositoryContext?.repoName) || "Unspecified"}`,
    `README path: ${clean(repositoryContext?.readmePath) || "Not found"}`,
    "",
    "Repository structure:",
    folderSummary || JSON.stringify(topLevelEntries),
    "",
    "README excerpt:",
    readmeExcerpt || "[No README content was available.]",
    existingContext ? `\nExisting user-authored context to retain when supported and correct when contradicted by repository evidence:\n${clean(existingContext).slice(0, 6000)}` : "",
    "",
    "Return editable plain text of no more than 450 words. Cover:",
    "- product or system purpose and operating domain",
    "- repository scope and important boundaries",
    "- major runtime components, actors, and external systems",
    "- important interfaces, data flows, protocols, hardware boundaries, and configuration surfaces",
    "- terminology or acronyms that should be preserved",
    "- safety-relevant responsibilities and explicit evidence gaps",
    "",
    "Use only supplied repository evidence. Distinguish facts from cautious inferences. Do not generate hazards, requirements, or a functional decomposition. Do not include a preamble, Markdown fence, or commentary about the task.",
  ].filter(Boolean).join("\n");

  const response = await fetch("/api/chat", {
    method: "POST",
    ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      provider,
      model,
      temperature: 0.2,
      max_tokens: 1600,
      messages: [
        {
          role: "system",
          content: "You prepare factual, concise repository analysis context for engineering architecture analysis. Return plain text only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json();
      detail = clean(body?.error || body?.message);
    } catch {}
    throw new Error(`Analysis-context generation failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const generated = responseText(await response.json());
  if (!generated) throw new Error("The selected AI model did not return usable analysis context.");
  return generated;
}

