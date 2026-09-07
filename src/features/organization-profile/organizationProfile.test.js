import {
  buildEffectiveOrganizationProfileContext,
  createOrganizationProfileRecord,
  ensureOrganizationProfileFrontMatter,
  parseOrganizationProfile,
  validateOrganizationProfile,
} from "./organizationProfile";

const markdown = `---
organization: Example Robotics
profile_version: 2.1
status: approved
approved_by: Safety Director
effective_date: 2026-09-06
domains:
  - robotics
---

# Safety Philosophy

Prefer fail-safe behavior.
`;

test("parses organization profile metadata and Markdown sections", () => {
  const parsed = parseOrganizationProfile(markdown);
  expect(parsed.metadata).toMatchObject({
    organization: "Example Robotics",
    profile_version: "2.1",
    status: "approved",
    domains: ["robotics"],
  });
  expect(parsed.sections["Safety Philosophy"]).toBe("Prefer fail-safe behavior.");
});

test("retains nested headings and their content inside a selected parent section", () => {
  const nestedMarkdown = `${markdown.trim()}\n\n## Safe-state rule\n\nUse a context-specific safe state.\n\n### Missing evidence\n\nUse TBD.\n\n# Engineering Rules\n\nProject evidence takes precedence.\n`;
  const parsed = parseOrganizationProfile(nestedMarkdown);
  expect(parsed.sections["Safety Philosophy"]).toContain("## Safe-state rule");
  expect(parsed.sections["Safety Philosophy"]).toContain("### Missing evidence");
  expect(parsed.sections["Safety Philosophy"]).toContain("Use TBD.");
  expect(parsed.sections["Safety Philosophy"]).not.toContain("Project evidence takes precedence.");
  expect(parsed.sections["Safe-state rule"]).toContain("### Missing evidence");
});

test("validates required identity metadata while allowing progressive section authoring", () => {
  const validation = validateOrganizationProfile(markdown);
  expect(validation.valid).toBe(true);
  expect(validation.warnings).toContain("Missing section: Engineering Rules.");
  expect(validateOrganizationProfile("# Profile").valid).toBe(false);
});

test("builds effective context with project override and provenance", () => {
  const context = buildEffectiveOrganizationProfileContext({
    profile: createOrganizationProfileRecord({ enabled: true, markdown }),
    projectProfile: { mode: "inherit", overrideMarkdown: "Use the project-specific safe state." },
  });
  expect(context).toContain("Example Robotics v2.1 (approved)");
  expect(context).toContain("Prefer fail-safe behavior.");
  expect(context).toContain("# Project Profile Override");
});

test("builds a selected-section context with nested governance and a project override", () => {
  const nestedMarkdown = `${markdown.trim()}\n\n## Safe-state rule\n\nUse a context-specific safe state.\n\n# Engineering Rules\n\nProject evidence takes precedence.\n`;
  const context = buildEffectiveOrganizationProfileContext({
    profile: createOrganizationProfileRecord({ enabled: true, markdown: nestedMarkdown }),
    projectProfile: { mode: "inherit", overrideMarkdown: "Customer evidence overrides the baseline." },
    sectionNames: ["Safety Philosophy"],
  });
  expect(context).toContain("## Safe-state rule");
  expect(context).toContain("Use a context-specific safe state.");
  expect(context).not.toContain("Project evidence takes precedence.");
  expect(context).toContain("Customer evidence overrides the baseline.");
});

test("does not inject a disabled organization or project profile", () => {
  expect(buildEffectiveOrganizationProfileContext({
    profile: createOrganizationProfileRecord({ enabled: false, markdown }),
  })).toBe("");
  expect(buildEffectiveOrganizationProfileContext({
    profile: createOrganizationProfileRecord({ enabled: true, markdown }),
    projectProfile: { mode: "disabled" },
  })).toBe("");
});

test("adds draft front matter to a readable Markdown profile", () => {
  const normalized = ensureOrganizationProfileFrontMatter(`# Organization and Products

**Organization:** Atoms Transport
**Profile status:** Hypothetical information. It is not Atoms-approved.
`);
  const parsed = parseOrganizationProfile(normalized.markdown);
  expect(normalized.added).toBe(true);
  expect(parsed.metadata.organization).toBe("Atoms Transport");
  expect(parsed.metadata.status).toBe("draft");
  expect(parsed.metadata.profile_basis).toContain("Hypothetical information");
});
