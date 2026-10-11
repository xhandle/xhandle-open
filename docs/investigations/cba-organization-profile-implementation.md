# CBA organization-profile implementation

Implemented using `docs/codex-prompts/implement-cba-organization-profile-usage.md`, 2026-10-11. Preserves the preceding HARA/FHA work in the working tree.

## Behavior

- Settings now resolves project-level profile inheritance, overrides and disabling against the active workspace: the active CBA project in Code-Based Architecture, or the active ordinary project elsewhere. An empty CBA workspace does not fall back to a different ordinary project.
- CBA hazard execution takes the complete effective enabled profile instead of an eight-section allowlist. Dedicated safety-classification sections and custom organization sections can reach STPA, HARA and FHA.
- The governed prompt formatter retains all authored top-level sections, allocates the available character budget across them, redistributes unused space, and explicitly marks shortened sections. Project overrides remain last. Large individual sections still require truncation; retaining a section does not mean every sentence fits. Evidence and explicit user instructions retain precedence.
- STPA command/control applicability screening receives governed organization guidance. Guidance may clarify terminology but cannot establish control authority without relationship evidence. Existing exact-quote validation remains intact. Profile content participates in screening cache identity, so changed guidance cannot reuse an old screening checkpoint. Existing decided Yes/No rows are still skipped and preserved.
- Each new run records an effective profile identity and whether effective guidance was enabled, including when no guidance applied. Run normalization preserves this provenance. The identity is a deterministic non-cryptographic change detector over the complete effective context, not a security signature.
- Profile changes, overrides, enable/disable transitions and applicable legacy runs without verifiable profile identity make saved analysis stale. The hazard panel and remediation freshness check receive current context; software requirements reject a stale policy source instead of silently deriving from it. Historical runs are not rewritten.
- Global profile-change and storage events refresh the active context. Project setting saves also refresh it. The effective CBA context is memoized to avoid parsing the profile independently for every panel on each render.
- Profile-enabled legacy methods without context plumbing are rejected before analysis. Current CBA methods remain STPA-Textbook (displayed as STPA), HARA and FHA. Standard FMEA/What-If aliases remain supported internally. This change does not silently claim legacy STPA/HRWhatIf/STPA-SEC are profile-aware.

## Files

- `App.js`: workspace Settings scope, complete profile selection, reactive memoized profile context, hazard/remediation/requirements wiring.
- `organizationProfile.js`: workspace scope helper and effective-context identity.
- `hazardPromptContext.js`: bounded per-section profile allocation.
- `codeHazardApplicabilityScreening.js`: governed screening prompt and cache basis.
- `codeArchitectureHazardRunner.js`: provenance, screening context, unsupported legacy guard.
- `codeArchitectureHazardUtils.js`, `CodeArchitectureHazardPanel.js`: policy freshness and status text.
- `softwareHazardSource.js`, `EngineeringArtifactPanel.js`: current-policy validation before requirements derivation.

## Validation

139 tests passed across ten suites, followed by the HARA/FHA suite with two additional real-generator mocked-model profile tests (141 distinct tests in total). Coverage includes enabled/disabled profiles, override scope, long/custom sections, policy cache invalidation, preservation of decided applicability, persisted identity, stale software-requirement inputs, legacy rejection, method dispatch and HARA/FHA generation/classification prompts.

Production build: `CI=false npm run build` passed with lint warnings and the existing outdated Browserslist-data notice. `git diff --check` passed.

No live model calls, browser smoke tests, commits, pushes or customer-data mutations were performed. Prompt inclusion and regression tests do not establish semantic model compliance with organizational policy or a safety standard. Existing runs with unverifiable profile provenance may require regeneration; they remain available for inspection.
