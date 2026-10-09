# Code-Based Architecture hazard regression review

2026-10-08: reviewed main at ea194ba plus existing uncommitted publication fixes. Executed `docs/codex-prompts/review-cba-hazard-regressions.md`. No application changes or customer-data operations were performed.

Normal-path tests pass, but the following findings prevent an unconditional clean bill of health.

## 1. P1: concurrent hazard saves lose other runs

`codeArchitectureHazardStore.js:75,113`: each save reads every run, clears the store, and writes its own replacement list. Concurrent callers overwrite each other's additions, including across projects/tabs. Deletes have the same read/replace pattern.

Native IndexedDB reproduction: eight simultaneous saves for distinct projects resolved successfully, but only `parallel-7` remained.

Use per-record atomic writes/deletes, with revision checks for competing edits to the same run. Add concurrent save/delete tests. This dates to f300c9ff (July 28), not the recent updates.

## 2. P1: fallback saves disappear from normal reads

`codeArchitectureHazardStore.js:64,87`: failed IndexedDB writes fall back to localStorage and report success. Subsequent successful IndexedDB reads ignore that fallback.

Injected a quota failure for hazard-store puts: save resolved, localStorage contained the new run, but the next project-scoped read returned null. This can make completed results disappear on reload/reselection. Architecture chunk-storage fixes do not cover this separate database.

Implement explicit recovery/merge of pending fallback records or report an unsaved state. Test failed writes followed by successful reads. Also a longstanding July defect.

## 3. P1: failed generation leaves partial results usable downstream

`App.js:14413,14462,17690`; `codeArchitectureHazardRunner.js:120`; `SafetyRemediationPanel.js:229`.

Intermediate output replaces the active run. Failure restores the previous run only if it had userPreprocessing. Ordinary partial output has no incomplete status and has a current architecture fingerprint, so downstream remediation's existence/staleness gate can accept it.

The actual runner body, with mocked AI/source-audit/save dependencies, emitted a partial summary then threw. No completed run was saved; the partial object was not marked incomplete and passed the freshness check. App control-flow inspection shows why it remains active for ordinary prior runs. No live remediation request was made.

Separate preview from the last completed run; mark lifecycle status and require completion downstream; restore the prior run on failure/cancellation. Present before ea194ba; its recent scope guards do not solve this lifecycle issue.

## 4. P2: stale Functional models offer Run but reject execution

`codeArchitectureHazardUtils.js:666`; `CodeArchitectureHazardPanel.js:242`; `codeArchitectureHazardRunner.js:38`.

The effective-row helper falls back to detailed rows when Functional annotations are stale/incomplete. Drafts and button eligibility accept those rows, but the runner prohibits them. Reproduction produced seven draft variants and an enabled Run button, then immediately threw the regenerate-Functional-model error.

Share one readiness decision between draft, button and runner. Show an actionable regeneration state, or an explicit supported detailed-analysis choice. The guard arrived with Functional processing in 10ae665; ea194ba's eligibility fix did not cover this case.

## 5. P2: freshness checks omit inputs and differ downstream

`App.js:17693`; `codeArchitectureHazardUtils.js:236,1670`.

The hazard panel passes operational contexts into the stale check; remediation passes only architecture rows. Changing a scenario reproduced true for the panel check and false for the remediation check. Detailed-mode fingerprints also omit function/control-action descriptions: a description-only change reproduced false for staleness despite changing analysis input.

Centralize freshness across actual analysis inputs and downstream consumers. Add scenario and description-only regressions. Both omissions predate recent Functional work; Functional-mode fingerprints do include descriptions.

## Validation

- Primary targeted tests: 14 suites, 125 tests passed.
- Additional assurance/diagram/import tests: 11 suites, 67 tests passed. Suites overlap; these are execution totals, not 192 unique tests.
- Passing coverage includes eligibility, contexts, guide-phrase inputs, hazard CSV and preprocessing, cancelled late completion, Functional hierarchy/CSV, navigation utilities, source equivalence and requirements artifact generation.
- Native Chromium and mocked-runner reproduction results: `cba-hazard-regression-results.json`; reproduction script: `cba-hazard-regression-reproduction.cjs` (local dev build and Playwright required).
- Fresh browser context, synthetic data, and blocked API calls; no paid generation. Recent project-scoped loading/progress guards remain present; no additional CSV hierarchy/navigation defect was established.

## Limits

No Safari run, customer workspace inspection, live AI quality assessment, or full end-to-end requirements/remediation generation. This read-only review did not require a new production build. Existing publication-fix changes were preserved. No fixes, commit or push were performed. Prioritize findings 1–3, then unify readiness and freshness, with permanent regressions for the demonstrated failures.
