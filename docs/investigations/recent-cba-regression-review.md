# Recent Code-Based Architecture regression review

Executed docs/codex-prompts/review-recent-cba-regressions.md against the current working tree, including uncommitted work. Read-only production review; no production changes or user-data changes made.

## Findings

### P1 — Unsupported HARA/FHA classification can qualify a software safety requirement

Locations: src/components/aiAnalysisHaraFha.js:531 and :811; src/features/code-architecture-assurance/artifactAI.js:674.

The new classification path accepts an allowed safetyClassification string without requiring substantive classification evidence or rationale. Normalization maps Safety — Direct/Related to Safety Significant=Yes, even when the same row's rationale says it was not generated. The downstream requirement importer accepts that row when the hazard/rating/software allocation fields are populated. The shared STPA safety-classification audit is not applied here.

Reproduction: return valid generation rows followed by classification objects containing only id and safetyClassification='Safety — Direct'. Both HARA and FHA publish Yes with a missing-rationale warning, and both import their software requirements. Reproduced by the saved audit fixture.

Classification: introduced by the recent shared HARA/FHA classification change. Fix: validate classification evidence and consistency using the shared policy before granting a resolved classification; retry incomplete classification, otherwise retain Needs Review and exclude unresolved allocations from automatic safety requirement handoff. Preserve applicability and method ratings.

### P1 — Seven-phrase expansion blocks continuation/regeneration of legacy reviewed HARA/FHA runs

Locations: src/features/code-architecture-hazard-analysis/codeArchitectureHazardPreprocessing.js:13–54; codeArchitectureHazardRunner.js:56.

Legacy reviewed rows use blank, Functional malfunction, or Functional degradation or loss as their guide phrase. Newly expanded rows use seven specific phrases. Those owned rows cannot match; prepareCodeHazardPreprocessing throws before generation. Regenerate still invokes this preparation, so choosing regenerate alone does not solve it. This correctly avoids spreading a whole-function decision over seven distinct deviations, but lacks a usable migration workflow. Review-notice UI is also globally hidden, reducing discoverability of the existing review path.

Reproduction: covered by codeArchitectureHazardPreprocessing.test.js's legacy specific-phrase mismatch tests. Inspection confirms the same preparation precedes generation regardless of regenerate.

Classification: introduced compatibility break from the seven-phrase change. Fix: preserve old analysis/review history, provide an explicit migration/new-assessment path, retain exact phrase matches, and leave newly introduced phrases unresolved without copying old decisions. Do not silently clear human decisions.

### P2 — FHA's requested rationale columns remain permanently empty on new generated runs

Locations: src/features/code-architecture-hazard-analysis/CodeArchitectureHazardSummaryTable.js:116–125; src/components/haraFhaSharedWorkflow.js; aiAnalysisHaraFha.js FHA prompt/normalization/sheet builders.

Severity Rationale, Software Control Category Rationale, and SWCI Rationale / Derivation exist only as display columns padded with empty strings. The model contract and stored sheets do not contain those fields. The generic Rationale field is separate. Consequently, a successful new run still leaves these requested columns blank, and normal raw-summary exports omit them.

Reproduction: generated a valid FHA response; asserted all three headers absent in the resulting Summary. Saved audit fixture passes, confirming the gap.

Classification: incomplete recent feature implementation, not loss of previously generated rationale data. Fix: generate and validate distinct severity/SCC rationales, derive SwCI rationale from the implemented severity/SCC mapping, and persist/export them. Do not relabel the generic rationale as three independent justifications.

### P2 — Late repository-context response can overwrite a newer modal draft

Locations: src/App.js:4435–4494 and :21810–21902.

The asynchronous generator captures the initial repository, then unconditionally writes results into the current draft. Repo/owner/context fields remain editable while generation runs, and the modal can be closed/reopened. If a user starts A and edits/reopens B before completion, A's completion can overwrite B's owner/repo/context. Local context generation has the same unconditional context assignment pattern.

Evidence: control-flow inspection; no live browser reproduction. Classification: existing risk in the inspected implementation, not attributed to the last commit-pinning fix. Fix: capture a request/scope identity, invalidate on close/source/project changes, and reject stale completions; protect context edits made after the request started.

## Areas checked without another confirmed defect

- All direct repository-context/source-file callers inspected. Main GitHub analysis resolves a commit before reads; local paths use sourceProvider; Generate from source now resolves once for inventory and README. No second branch-name caller of the strict source reader was found.
- Existing tests cover immutable fallback reads, source byte checks, local-independent context generation, scoped applicability, seven-phrase publication, CSV identities, table defaults and collaborator selection clearing/reselection.
- The table context Clear change does not intentionally delete table data and now clears hazard/engineering highlights when parent selection becomes null.

## Validation and limits

8 suites / 73 tests passed, including three audit probes that demonstrate current defects rather than assert corrected behavior. Fixture: docs/investigations/fixtures/recentCbaRegression.audit.test.js.txt. It can be copied to src/components/recentCbaRegression.audit.test.js for execution. The temporary executable copy was removed after the run.

No live provider calls, GitHub repository requests, customer data, Safari smoke test, or whole-product audit. Existing passing suites did not catch the reproduced classification and absent-rationale issues. No production build rerun for this read-only review. No commit or push.
