export const ORGANIZATION_PROFILE_STORAGE_KEY = "xhandle.organizationProfile";
export const ORGANIZATION_PROFILE_MAX_CHARS = 60000;

export const DEFAULT_ORGANIZATION_PROFILE_MARKDOWN = `---
organization:
profile_version: 1.0
status: draft
approved_by:
effective_date:
domains:
  -
---

# Organization and Products

Describe what the organization builds, its intended uses, customers, and operating environments.

# Safety Philosophy

Define risk tolerance, fail-safe principles, defense-in-depth expectations, human oversight, degraded-mode philosophy, and safe states.

# Architecture Conventions

Define preferred subsystem names, boundaries, interface terminology, controller and actuator responsibilities, and common architecture patterns.

# Hazard and Loss Taxonomy

Define canonical losses, hazard categories, unsafe-control-action terminology, and causal-factor categories.

# Risk Classification

Define likelihood and severity scales, the risk matrix, escalation rules, and risk-acceptance authority.

# Engineering Rules

Define requirements-writing rules, handling of TBD values, traceability expectations, verification requirements, and prohibited assumptions.

# Operational Concepts

Describe common scenarios, modes, actors, environmental conditions, and foreseeable misuse.

# Standards and Regulatory Context

List applicable standards and regulations with applicability and tailoring decisions. Do not list a standard unless its applicability is confirmed.

# Glossary

Define organization-specific terminology, acronyms, names, and preferred language.

# Known Controls and Evidence

Describe existing safety mechanisms, verified capabilities, limitations, evidence, and maturity. Label each item Verified, Assumed, Proposed, or Unknown.
`;

const REQUIRED_SECTIONS = [
  "Organization and Products",
  "Safety Philosophy",
  "Architecture Conventions",
  "Hazard and Loss Taxonomy",
  "Risk Classification",
  "Engineering Rules",
  "Operational Concepts",
  "Standards and Regulatory Context",
  "Glossary",
  "Known Controls and Evidence",
];

const clean = (value) => String(value ?? "").trim();

function parseScalar(value) {
  const text = clean(value);
  if (!text) return "";
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  return text.replace(/^(["'])(.*)\1$/, "$2");
}

function parseFrontMatter(source) {
  const markdown = String(source || "").replace(/^\uFEFF/, "");
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: markdown, hasFrontMatter: false };
  const metadata = {};
  let activeListKey = "";
  match[1].split(/\r?\n/).forEach((line) => {
    const listItem = line.match(/^\s+-\s*(.*)$/);
    if (listItem && activeListKey) {
      const value = parseScalar(listItem[1]);
      if (value) metadata[activeListKey].push(value);
      return;
    }
    const property = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!property) return;
    const [, key, rawValue] = property;
    if (!clean(rawValue)) {
      metadata[key] = [];
      activeListKey = key;
      return;
    }
    metadata[key] = parseScalar(rawValue);
    activeListKey = "";
  });
  Object.keys(metadata).forEach((key) => {
    if (Array.isArray(metadata[key]) && !metadata[key].length) metadata[key] = [];
  });
  return {
    metadata,
    body: markdown.slice(match[0].length),
    hasFrontMatter: true,
  };
}

function parseSections(body) {
  const sections = {};
  const activeHeadings = [];
  String(body || "").split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const name = clean(heading[2]);
      while (activeHeadings.length && activeHeadings[activeHeadings.length - 1].level >= level) {
        activeHeadings.pop();
      }
      // A selected parent section must retain its nested Markdown. This lets
      // callers request "Safety Philosophy" without silently discarding its
      // ##/### governed content.
      activeHeadings.forEach(({ name: parentName }) => sections[parentName].push(line));
      if (!sections[name]) sections[name] = [];
      activeHeadings.push({ level, name });
      return;
    }
    activeHeadings.forEach(({ name }) => sections[name].push(line));
  });
  return Object.fromEntries(Object.entries(sections).map(([heading, lines]) => [heading, clean(lines.join("\n"))]));
}

export function parseOrganizationProfile(markdown = "") {
  const parsed = parseFrontMatter(markdown);
  return {
    markdown: String(markdown || ""),
    metadata: parsed.metadata,
    sections: parseSections(parsed.body),
    hasFrontMatter: parsed.hasFrontMatter,
  };
}

function yamlQuoted(value) {
  return JSON.stringify(clean(value));
}

export function ensureOrganizationProfileFrontMatter(markdown = "") {
  const source = String(markdown || "").replace(/^\uFEFF/, "");
  const parsed = parseOrganizationProfile(source);
  if (parsed.hasFrontMatter) return { markdown: source, added: false };

  const organization = clean(
    source.match(/^\s*\*\*Organization:\*\*\s*(.+?)\s*$/im)?.[1]
      || source.match(/^\s*Organization:\s*(.+?)\s*$/im)?.[1]
  );
  const statusText = clean(
    source.match(/^\s*\*\*Profile status:\*\*\s*(.+?)\s*$/im)?.[1]
      || source.match(/^\s*Profile status:\s*(.+?)\s*$/im)?.[1]
  );
  const status = /^(?:approved|active)\b/i.test(statusText) && !/(?:not|unapproved|hypothetical)/i.test(statusText)
    ? "approved"
    : "draft";
  const frontMatter = [
    "---",
    `organization: ${yamlQuoted(organization)}`,
    "profile_version: 1.0",
    `status: ${status}`,
    "approved_by:",
    "effective_date:",
    "domains:",
    "  -",
    ...(statusText ? [`profile_basis: ${yamlQuoted(statusText)}`] : []),
    "---",
    "",
  ].join("\n");
  return { markdown: `${frontMatter}${source.trimStart()}`, added: true };
}

export function validateOrganizationProfile(markdown = "") {
  const parsed = parseOrganizationProfile(markdown);
  const errors = [];
  const warnings = [];
  if (!clean(markdown)) errors.push("Profile Markdown is empty.");
  if (String(markdown || "").length > ORGANIZATION_PROFILE_MAX_CHARS) {
    errors.push(`Profile exceeds the ${ORGANIZATION_PROFILE_MAX_CHARS.toLocaleString()} character limit.`);
  }
  if (!parsed.hasFrontMatter) errors.push("YAML front matter is required.");
  if (!clean(parsed.metadata.organization)) errors.push("Front matter must define organization.");
  if (!clean(parsed.metadata.profile_version)) errors.push("Front matter must define profile_version.");
  if (!clean(parsed.metadata.status)) warnings.push("Profile status is not defined.");
  if (!clean(parsed.metadata.approved_by)) warnings.push("Approval authority is not defined.");
  if (!clean(parsed.metadata.effective_date)) warnings.push("Effective date is not defined.");
  REQUIRED_SECTIONS.forEach((heading) => {
    if (!Object.prototype.hasOwnProperty.call(parsed.sections, heading)) warnings.push(`Missing section: ${heading}.`);
  });
  if (clean(parsed.metadata.status).toLowerCase() !== "approved") {
    warnings.push("Profile is not marked approved; generated artifacts should treat it as advisory context.");
  }
  return { ...parsed, errors, warnings, valid: errors.length === 0 };
}

export function createOrganizationProfileRecord(overrides = {}) {
  return {
    id: "organization-default",
    enabled: false,
    markdown: DEFAULT_ORGANIZATION_PROFILE_MARKDOWN,
    updatedAt: null,
    ...overrides,
  };
}

export function loadOrganizationProfile() {
  if (typeof window === "undefined") return createOrganizationProfileRecord();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ORGANIZATION_PROFILE_STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return createOrganizationProfileRecord();
    return createOrganizationProfileRecord({
      ...parsed,
      enabled: Boolean(parsed.enabled),
      markdown: clean(parsed.markdown) ? String(parsed.markdown) : DEFAULT_ORGANIZATION_PROFILE_MARKDOWN,
    });
  } catch {
    return createOrganizationProfileRecord();
  }
}

export function saveOrganizationProfile(profile = {}) {
  const normalized = ensureOrganizationProfileFrontMatter(profile.markdown);
  const next = createOrganizationProfileRecord({
    ...profile,
    enabled: Boolean(profile.enabled),
    markdown: normalized.markdown,
    updatedAt: new Date().toISOString(),
  });
  const validation = validateOrganizationProfile(next.markdown);
  if (!validation.valid) return { saved: false, profile: next, validation };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ORGANIZATION_PROFILE_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("xhandle:organization-profile-changed", { detail: next }));
  }
  return { saved: true, profile: next, validation, frontMatterAdded: normalized.added };
}

export function getOrganizationProfileIdentity(profile = loadOrganizationProfile()) {
  const parsed = parseOrganizationProfile(profile.markdown);
  const organization = clean(parsed.metadata.organization) || "Organization profile";
  const version = clean(parsed.metadata.profile_version) || "unversioned";
  const status = clean(parsed.metadata.status) || "unspecified status";
  return `${organization} v${version} (${status})`;
}

export function buildEffectiveOrganizationProfileContext({ profile, projectProfile, sectionNames } = {}) {
  const resolvedProfile = profile || loadOrganizationProfile();
  const mode = clean(projectProfile?.mode || "inherit").toLowerCase();
  if (!resolvedProfile.enabled || mode === "disabled") return "";
  const validation = validateOrganizationProfile(resolvedProfile.markdown);
  if (!validation.valid) return "";
  const override = clean(projectProfile?.overrideMarkdown);
  const selectedSections = Array.isArray(sectionNames) && sectionNames.length
    ? sectionNames
      .filter((heading) => Object.prototype.hasOwnProperty.call(validation.sections, heading))
      .map((heading) => `# ${heading}\n\n${validation.sections[heading]}`)
      .join("\n\n")
    : resolvedProfile.markdown.trim();
  return [
    "# xHandle Organization Calibration Context",
    "",
    `Profile: ${getOrganizationProfileIdentity(resolvedProfile)}`,
    "Apply this profile as governed contextual guidance. Project facts and explicit user instructions take precedence. Treat draft or unapproved content as advisory, preserve stated uncertainty, and do not invent compliance or implementation evidence.",
    "",
    selectedSections,
    ...(override ? [
      "",
      "# Project Profile Override",
      "",
      "The following project-specific context overrides conflicting organization-level guidance for this project only:",
      "",
      override,
    ] : []),
  ].join("\n");
}
