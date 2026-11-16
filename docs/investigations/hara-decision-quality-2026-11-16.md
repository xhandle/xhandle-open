# HARA decision quality and completion — 2026-11-16

Completed HARA assessments return one S/E/C decision, the locally calculated ASIL, an item-level safety goal, a required response, and an FTTI with its reasoning. Completed results use `Complete` instead of `Draft` or `Needs review`. The decision fields contain the values; their supporting rationales, assumptions and assessment basis distinguish documented evidence from engineering judgment. Inferred capabilities and timing bounds are not presented as established implementation facts.

The selected operational scope is intentional. One scenario is valid and is recorded as scenario-specific coverage, rather than being treated as a deficiency. Different operating situations within that scenario can have different exposure frequencies.

## Generation and validation

- Exposure reasoning concerns the operational situation, excluding malfunction, communication and recovery failure probability. Conflicting exposure decisions for matching situations, modes and conditions receive a separate consistency decision. Large argument sets are processed hierarchically with durable intermediate decisions; source rows are retained.
- Severity concerns potential injury. Automatic repair catches arguments that downgrade life-threatening/fatal outcomes because death is uncertain or an internal fallback may work. Controllability reasoning must address people avoiding harm, rather than repairing or diagnosing software.
- The assessment separates the interface malfunction, vehicle-level hazardous state, operational situation and harm chain. Missed emergencies and false alerts/resource diversion must have distinct risk arguments and safety objectives. Nominal performance limitations are distinguished from E/E malfunction concerns.
- Safety goals receive bounded semantic consolidation into item-level functional objectives. Every source candidate must be mapped exactly once. Unknown, duplicate, omitted, generic or incompatible mappings are rejected. Function-specific mechanisms remain linked candidate requirements. A goal inherits the highest contributing event ASIL; equivalent outcome wording does not create another goal ID.
- Safe responses require a harm-prevention justification. A response not established by source architecture is described as a required measure, rather than as an existing fallback. FTTI requires a fault-to-hazard timing argument; frame periods, processing deadlines and diagnostic timeouts remain separate candidate timing requirements.
- Canonical hazard mismatches retain the original hazard text and identifier alongside the corrected vehicle-level mapping. Missing interface evidence alone does not establish non-applicability. Substantive verification procedures attached to excluded rows remain available as source evidence.
- The generation parser checks exact event coverage, field types, complete decisions, separate rating rationales, people at risk and a shall-style safety goal. Invalid reasoning receives bounded corrective requests. Output truncation automatically reduces the batch size and retries a singleton with a larger output allowance. An invalid or incomplete provider response is not published as a valid classification.

The reasoning contract is shared with Code-Based Architecture HARA. Projects uses the additional assessment repair, exposure reconciliation and safety-goal consolidation stages. Older saved Code HARA records remain readable; absent legacy fields are not retrospectively fabricated.

No customer analysis was regenerated or replaced during development. Regenerate an analysis in the updated application to use the new generation workflow.

## Implementation

- [Shared reasoning checks and evidence basis](../../src/features/project-hazard-analysis/haraAssessmentQuality.js)
- [Projects HARA generation and recovery](../../src/components/aiAnalysisProjectHara.js)
- [Exposure consistency](../../src/components/aiAnalysisHaraConsistency.js)
- [Safety-goal consolidation](../../src/components/aiAnalysisHaraGoals.js)
- [Deterministic ASIL, goal linkage and workbook sheets](../../src/features/project-hazard-analysis/projectHara.js)
- [Code HARA contract and field parity](../../src/features/code-architecture-hazard-analysis/codeArchitectureHara.js)

## Verification

- 1,473 tests pass in 155 targeted hazard-analysis and downstream-source suites. This includes 118 focused checks covering malformed/truncated responses, classification reasoning, source evidence, goal membership, large inputs, storage and reload. Four native Node tests validate the synthetic stress-provider contracts.
- The production renderer and isolated native stage build successfully from the final source. The stage fingerprint matches the tested source.
- All 16 real Electron UI checks pass: Projects generation, singleton and batch output-limit recovery, manual severity preservation, method switching, workbook export and reload; Code HARA columns, searchable multiselects, CSV export, reload and legacy blanks. No renderer errors or failure alerts were recorded.
- The UI fixture was extended to handle the automatic Safety Issues follow-on request. The application behavior was preserved; unexpected provider contracts still fail the fixture.
- Both areas completed 5,376-row HARA runs with exact source identities and zero fallback rows. Projects completed in 15.9 seconds with a maximum measured renderer gap of 1,087 ms; Code-Based Architecture completed in 33.2 seconds with a maximum gap of 631 ms. These are controlled-provider engine timings, not live AI service timings.
- Four additional 672-row cases passed: malformed/truncated/missing-row/rate-limit recovery and cancellation/reload/resume in each area. Resume reused 16 committed Projects assessments and one committed Code assessment without requesting their generation again.
- The first large Projects attempt failed before analysis: the native backend did not start within its 30-second startup timeout, and zero provider requests were sent. A fresh retry passed. The five other stress cases passed on their first attempts. This remains an observed, unreproduced startup timeout; it is not counted as a successful first attempt or claimed to be fixed by the HARA changes.

Local evidence: `/private/tmp/xhandle-hara-checked-gate-20261116.json`, `/private/tmp/xhandle-hara-final-focused-20261116.json`, `/private/tmp/xhandle-hara-checked-electron-20261116/report.json`, and `/private/tmp/xhandle-hara-checked-live-complete-20261116.log`.

Stress evidence: `/private/tmp/xhandle-hara-quality-stress-20261116/report.json` records the initial startup failure and the five passing cases; `/private/tmp/xhandle-hara-project-retry-20261116/report.json` records the successful 5,376-row Projects retry.

These runs use synthetic inputs and controlled AI responses to test application behavior. They do not establish the semantic accuracy of arbitrary live-model output, verify assumed hardware capabilities, or certify an assessment. Native execution was tested on macOS arm64; no installer, notarization, update-feed, Windows or Linux release validation is claimed by this change.

## Engineering references

The reasoning changes follow the concept-phase scope of [ISO 26262-3:2018](https://www.iso.org/standard/68385.html). Public cross-checks include exposure and safety-goal discussions in [NHTSA DOT HS 812 572](https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/13496_812572_alcsynthesis_080318.pdf) and the S/E/C lookup in [NHTSA DOT HS 812 574, Table 21](https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/13497a_812574_hydraulicbrakingsystem.pdf). Nominal functional insufficiencies are separately identified in the scope of [ISO 21448](https://www.iso.org/standard/77490.html).
