# Hazard CSV import feedback

The user reported no response after selecting a prereviewed hazard CSV. Static inspection found that the panel awaited file reading, then used window.confirm; a false/suppressed confirmation returned silently. Success and unchanged-file feedback also relied on browser alerts. The exact browser cause was not captured.

Replaced that flow with an in-page preview and Apply CSV import / Cancel import controls. Reading, validation, saving, success, unchanged-file and failure states now have persistent inline feedback. Validation errors still expose the existing issue list. Application rechecks that the preview still belongs to the same summary/run before saving; the existing App project/run guards remain in place. A save failure retains the preview for retry. No CSV matching or applicability-preservation rules were loosened.

A likely file in Downloads, alpamayo_hazard_analysis_guide_phrase_applicability_reviewed.csv, has 385 unique IDs, 344 Yes and 41 No decisions. Its initial rows describe Qibus interfaces and unspecified operational context. The filename does not establish that its rows match the currently selected alpamayo project. No customer browser data was read or changed and the CSV itself was unchanged.

Validation: 36 tests across panel and CSV suites passed, including confirmation before saving, no native confirmation/alert dependency, visible save failures and unchanged-file feedback. Production build result is reported in the completion message.

## Context-aware top-right Import

The user confirmed importing `alpamayo_hazard_analysis_control_gated_guide_phrase_review.csv` through the architecture menu rather than the hazard toolbar. That menu always used the decomposition/project importer, which rejects hazard CSVs. In the active Code Architecture Hazard Analysis tab, it now opens the same hazard file input and review/apply workflow as the toolbar. Other views retain architecture import behavior.

The supplied CSV has 2,807 unique row IDs and correctly named applicability columns: 178 Yes and 2,629 No. A fresh isolated Chromium test applied the file to a matching synthetic baseline with blank applicability fields, saved it through the hazard store, and read back all reviewed decisions unchanged. This verifies the file path through parser/merge/storage, not correspondence to live project rows. API calls were blocked and no customer browser state was modified.

The 36 hazard import tests pass, including the shared file-input ref used by the menu. Imports still require a matching current table and explicit Apply CSV import.

## Preserve imports across architecture refreshes and context saves

The architecture-loading effect in App cleared `codeArchitectureHazardRun` after adopting rows even for a reload in the same project/repository. The independent hazard loader watches stable project/repository identity, so it need not reload after that clear. The panel then chooses a newly built blank CSV draft instead of the saved imported run. Removed this redundant clear; scope changes and explicit deletion retain their own clear/load behavior. Existing context freshness and preprocessing invalidation checks remain unchanged.

Native browser diagnostic `verify-hazard-context-import.cjs` seeds synthetic architecture and hazard data, imports reviewed applicability through the actual hazard UI, applies it, adds/saves an operational scenario, checks the imported rationale remains visible, reloads and checks it again. Passed with API requests blocked in an isolated context. This verifies that sequence, not the user's live browser data. 49 focused tests and production build passed (existing build warnings).

## Imported rows and saved operational contexts

Imported preprocessing CSV rows can carry `context-unspecified` even after the user saves a named operational scenario. The context selector itself uses the separate project/repository context store, leaving imported Summary rows and their visible context column unchanged. `assignImportedHazardContext` now updates unassigned imported rows when exactly one operational context exists, whether the CSV was applied to a draft or an existing analysis run. It runs on context save, import, and saved-run load, so prior imports are repaired when the project is reopened. Multiple contexts are never guessed; runs without a CSV import are untouched. Raw Analysis Row IDs and guide-phrase decisions remain stable. The changed scenario basis is retained as review evidence and surfaced in user preprocessing conflicts.

The context manager awaits successful run persistence before closing and reports save failures. Unit tests cover single versus multiple contexts, preserving ownership and values, later context edits, and an import into an existing analysis run. A native Chromium test uses the real App and synthetic rows to import reviewed applicability into an existing run, save an operational scenario, verify the persisted Summary has the scenario, mode, applicability, and rationale, then reload and verify the table still shows the review. 25 focused tests and production build passed with existing warnings.
