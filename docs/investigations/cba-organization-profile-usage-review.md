# CBA organization-profile usage review

Read-only audit, 2026-10-11. Executed `docs/codex-prompts/review-cba-organization-profile-usage.md` against the current working tree, including the preceding uncommitted HARA/FHA fixes. No production code or customer records changed by this review.

## Conclusion

Enabled, valid global organization profiles reach the three currently selectable CBA methods: STPA (`STPA-Textbook`), HARA and FHA. They are included in main generation and subsequent model prompts. However, the implementation does not yet consistently use all relevant enabled profile guidance across the workflow.

## Findings

### High — relevant profile sections can be omitted

`App.js:handleRunCodeArchitectureHazardAnalysis` calls `getProjectOrganizationCalibration` with an explicit eight-section allowlist. It includes Safety Philosophy, Hazard and Loss Taxonomy, Risk Classification, Engineering Rules, Operational Concepts, Standards and Regulatory Context, Glossary, and Known Controls and Evidence. It omits a separately authored `Safety Significance Classification` section, along with Organization and Products and Architecture Conventions. `organizationProfile.js:buildEffectiveOrganizationProfileContext` only returns selected sections, so downstream prioritization cannot restore omitted content. A real context-builder probe confirmed that a classification-rule marker disappears while Safety Philosophy remains.

`hazardPromptContext.js:prioritizeHazardOrganizationContext` further reconstructs profiles exceeding 18,000 characters from a different priority list. That list excludes Risk Classification, Engineering Rules, Standards and Regulatory Context and Glossary. Those sections can disappear entirely rather than merely become shorter. A probe confirmed risk and engineering markers present in the effective CBA context are absent from the final prompt. This particularly matters for HARA/FHA calibration and requirement-writing guidance.

### High — project settings and CBA execution use different project identities

SettingsModal wiring in `App.js` reads and writes project profile settings using `activeProjectId` and displays `activeProject`. CBA execution resolves settings using `activeCodeArchitectureProjectId` (with a fallback to the normal project ID). These are distinct workspace identities. The Settings override/disable UI therefore is not explicitly scoped to the active CBA project. Global enablement works, but users cannot rely on that project control governing the CBA project they are viewing. Browser interaction was not tested; this finding is based on the actual read/write and execution bindings.

### Medium — STPA applicability screening ignores organization guidance

`codeArchitectureHazardRunner.js` passes source rows, model configuration, signal and checkpoint to `screenCodeHazardApplicability`, but not organization context. `codeHazardApplicabilityScreening.js` has no organization-context input and its checkpoint basis omits profile state. Main STPA generation/classification receives the profile later, but the initial command/control screening cannot use it and may reuse screening decisions after profile changes. Any fix must preserve human-reviewed applicability decisions and evidence-based command/control gating; profile text must not fabricate control authority.

### Medium — profile provenance does not imply freshness or application at every stage

The runner saves profile identity, timestamps and application time. `isCodeArchitectureHazardAnalysisStale` checks architecture/Functional model and operational context, but not organization-profile identity, content or enablement. A policy change does not itself flag saved analyses as stale. Main standard-generation and HARA/FHA chunk checkpoint bases include organization context, so their matching cached work is invalidated when the effective text changes. Screening is the exception noted above. Provenance is attached at run level; it is not proof every stage used all profile sections.

Shared deterministic evidence evaluation (`ensureHazardSummaryEvidenceColumns` / `evaluateHazardEvidence`) has no organization-context parameter. Its source-evidence rules remain fixed. This is not inherently a defect—profile guidance should not override evidence safeguards—but it limits any claim that profile rules govern every final classification. Software requirements consume the resulting hazard classifications and requirements, so missing upstream policy can propagate downstream.

### Low for current UI — legacy dispatch paths omit context

The CBA method options currently expose only STPA-Textbook, HARA and FHA. Additional `aiAnalysisLite.js` dispatch paths exist for FMEA, What-If, HRWhatIf, STPA-SEC and legacy STPA. Standard FMEA and What-If forward organization context. HRWhatIf, STPA-SEC and legacy STPA branches do not forward it to their generators. These are latent/API or compatibility paths, not additional methods currently offered in the CBA dropdown. They should not be described as profile-aware.

## What works

- Disabled global profiles, disabled project settings and invalid profiles produce no effective profile context in the shared builder.
- Valid enabled profiles are applied as governed guidance, with project evidence and explicit instructions taking precedence. Project override text is appended with stated precedence.
- `runLiteAIAnalysis` forwards organization context to standard STPA/FMEA/What-If and HARA/FHA.
- The standard engine uses the governed formatter for generation, repair and subsequent assessment prompts. HARA/FHA use it for generation, repair, classification and detailed-cell prompts.
- Real HARA/FHA generator probes verified an organization marker in every model call made by their successful generation/classification fixtures.
- Main generation checkpoint keys include effective organization text. Run normalization retains profile provenance.

## Recommended implementation

1. Resolve profile settings using the active workspace/project identity consistently in both Settings and CBA execution.
2. Define one hazard-profile section contract including dedicated safety classification, risk rules, engineering rules and confirmed standards/tailoring. Preserve these under prompt budgets with explicit per-section allocation; do not silently drop required sections.
3. Pass governed organization context into applicability screening and include its digest in screening cache identity, while preserving reviewed applicability and source-evidence safeguards.
4. Record effective profile digest/enablement/override identity and use it in stale-run detection. Distinguish historical run policy from current policy.
5. Either make supported legacy dispatch paths profile-aware or explicitly restrict their availability. Keep HARA/FHA/STPA method-specific semantics intact.
6. Add end-to-end tests for enabled/disabled/invalid profiles, CBA-specific override scope, long profiles, changed-profile continuation and saved-run reload. Validate downstream requirements against the correctly scoped hazard run.

## Validation

30 tests passed across five suites: organization-profile builder, governed hazard-context formatter, method dispatch, standard workflow completion/checkpoints, and four temporary audit probes. Two probes reproduce section-loss defects; two exercise real HARA/FHA generators with mocked model responses. Existing tests also cover disabled profiles and changed organization context invalidating standard workflow cache reuse.

Probe source retained at `docs/investigations/fixtures/cba-organization-profile.audit.test.js.txt`. To reproduce, temporarily copy it to `src/components/cbaOrganizationProfile.audit.test.js`. Defect assertions are audit evidence, not permanent regression expectations.

No live model calls, browser smoke tests or production build were performed for this read-only audit. Passing profile text does not prove semantic model adherence or standards compliance.
