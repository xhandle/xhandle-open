# Software requirements missing-store repair

Implemented `docs/codex-prompts/fix-software-requirements-missing-store.md`.

## Behavior

- Assurance storage opens the actual database version and verifies `artifactRows`. If the store is missing, it closes its connection and performs a version upgrade that creates only the missing store. Existing stores and records are preserved; no database deletion is used.
- Concurrent upgrades retry version conflicts. Connections close on version changes. Blocked or timed-out opens produce an actionable error and late connections are closed; abandoned upgrade requests abort rather than silently proceeding.
- Review export and legacy workspace migration readers abort the initial upgrade of an absent database, preventing inspections from creating empty version-1 databases.
- Requirement generation verifies schema availability and a read/write transaction before calling AI. This checks access, not a guarantee of future disk quota.
- Failed saves retain scoped rows in application memory. Leaving and reopening the panel retains those rows and offers Retry save. Retry persists the existing results and clears downstream derived artifacts, without rerunning the model. Unsaved memory does not survive a full page reload; the UI explicitly tells the user to keep the page open until saving succeeds.

## Files

`artifactUtils.js`: initializer, storage readiness check, scoped unsaved retention.
`EngineeringArtifactPanel.js`: preflight and Retry save.
`codeArchitectureReviewExport.js` and `legacyWorkspaceGraphMigrator.ts`: non-creating inspection opens.
Tests: schema audit converted to desired behavior, persistence/retention integration tests, and preflight regression.

## Validation

Six suites / 32 tests passed: schema repair from empty version 1, small and large save/reload, unrelated-store preservation, concurrent initialization, blocked-upgrade recovery, previous revision/chunk regressions, initial-load errors, preflight failure preventing model calls, notification/reopen behavior, retry without another model request, review export, and workspace migration.

Tests use production storage functions with fake-indexeddb; panel tests mock AI and table rendering. No paid requests or customer storage mutations were performed. Native Safari and the customer's exact dataset were not exercised. `git diff --check` passed. Production build passed with lint warnings.

The schema repairs automatically when the feature next opens its storage. This can restore access to existing valid records but cannot reconstruct previous generated results that were never saved. Functional source selection and hazard-analysis reasoning are unchanged. Changes are not committed or pushed.
