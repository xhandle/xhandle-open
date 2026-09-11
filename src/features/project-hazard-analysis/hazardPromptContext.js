export const HAZARD_ORGANIZATION_CONTEXT_CHAR_BUDGET = 18000;
export const HAZARD_OPERATIONAL_CONTEXT_CHAR_BUDGET = 12000;
export const HAZARD_USER_CONTEXT_CHAR_BUDGET = 2500;
export const HAZARD_ATTACHED_CONTEXT_FILE_CHAR_BUDGET = 1200;
export const HAZARD_MAX_ATTACHED_CONTEXT_FILES = 3;

const cleanPromptText = (value) => String(value ?? "")
  .replace(/^\uFEFF/, "")
  .split(String.fromCharCode(0)).join("")
  .replace(/\r\n?/g, "\n")
  .trim();

const HAZARD_PRIORITY_ORGANIZATION_SECTIONS = [
  "Safety Significance Classification",
  "Hazard and Loss Taxonomy",
  "Safety Philosophy",
  "Architecture Conventions",
  "Operational Concepts",
  "Known Controls and Evidence",
];

function extractTopLevelMarkdownSection(markdown = "", heading = "") {
  const source = cleanPromptText(markdown);
  const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^#\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^#\\s+|(?![\\s\\S]))`, "im"));
  return match ? `# ${heading}\n${match[1]}`.trim() : "";
}

/**
 * Long organization profiles must not lose the classification policy in a
 * generic head/tail truncation. Assemble the hazard-relevant governed sections
 * first, then use the ordinary bounded-context behavior. The project override
 * remains last so it retains precedence in the prompt.
 */
export function prioritizeHazardOrganizationContext(value, maxChars = HAZARD_ORGANIZATION_CONTEXT_CHAR_BUDGET) {
  const source = cleanPromptText(value);
  if (!source || source.length <= maxChars) return source;

  const sections = HAZARD_PRIORITY_ORGANIZATION_SECTIONS
    .map((heading) => extractTopLevelMarkdownSection(source, heading))
    .filter(Boolean);
  const projectOverride = extractTopLevelMarkdownSection(source, "Project Profile Override");
  if (!sections.length) return boundHazardPromptContext(source, maxChars, "organization calibration");

  const identityPreamble = source.slice(0, Math.min(source.length, 1800)).trim();
  const prioritized = [
    identityPreamble,
    ...sections,
    projectOverride,
  ].filter(Boolean).join("\n\n");
  return boundHazardPromptContext(prioritized, maxChars, "hazard-relevant organization calibration");
}

export function boundHazardPromptContext(value, maxChars, label = "context") {
  const text = cleanPromptText(value);
  const budget = Math.max(0, Number(maxChars) || 0);
  if (!budget || text.length <= budget) return text.slice(0, budget || text.length);

  const marker = `\n\n[${label} shortened to its ${budget.toLocaleString()}-character prompt budget; the beginning and highest-priority trailing overrides are retained.]\n\n`;
  const available = Math.max(0, budget - marker.length);
  const headLength = Math.ceil(available * 0.72);
  const tailLength = Math.max(0, available - headLength);
  return `${text.slice(0, headLength).trimEnd()}${marker}${text.slice(-tailLength).trimStart()}`.slice(0, budget);
}

export function formatGovernedHazardPromptContext({
  organizationContext = "",
  operationalContext = "",
  analysisContext = null,
  contextSources = null,
} = {}) {
  const parts = [];
  const organization = prioritizeHazardOrganizationContext(
    organizationContext,
    HAZARD_ORGANIZATION_CONTEXT_CHAR_BUDGET,
  );
  if (organization) {
    parts.push([
      "Organization calibration (governed guidance):",
      "Project evidence and explicit user instructions take precedence over this profile. Preserve its status labels and uncertainty.",
      organization,
    ].join("\n"));
  }

  const operational = boundHazardPromptContext(
    operationalContext,
    HAZARD_OPERATIONAL_CONTEXT_CHAR_BUDGET,
    "operational context",
  );
  if (operational) parts.push(`Derived project / operational context:\n${operational}`);

  const userText = boundHazardPromptContext(
    analysisContext?.text,
    HAZARD_USER_CONTEXT_CHAR_BUDGET,
    "user-provided context",
  );
  if (userText) parts.push(`User-provided context text:\n${userText}`);

  const fileSummaries = (analysisContext?.files || [])
    .map((file, index) => {
      const name = cleanPromptText(file?.name || `context-${index + 1}.txt`).slice(0, 120);
      const content = boundHazardPromptContext(
        file?.content,
        HAZARD_ATTACHED_CONTEXT_FILE_CHAR_BUDGET,
        `attached context file ${name}`,
      );
      return content ? `Attached context file ${name}:\n${content}` : "";
    })
    .filter(Boolean)
    .slice(0, HAZARD_MAX_ATTACHED_CONTEXT_FILES);
  parts.push(...fileSummaries);

  if (contextSources) {
    const sources = [];
    if (contextSources.readmePath) sources.push(`README: ${cleanPromptText(contextSources.readmePath)}`);
    if (Array.isArray(contextSources.userContextFiles) && contextSources.userContextFiles.length) {
      sources.push(`User files: ${contextSources.userContextFiles.map(cleanPromptText).filter(Boolean).join(", ")}`);
    }
    if (sources.length) parts.push(`Context sources:\n${sources.join("\n")}`);
  }

  return parts.join("\n\n");
}
