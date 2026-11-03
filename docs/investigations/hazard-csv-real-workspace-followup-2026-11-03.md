# Code-Based Architecture hazard import: real workspace follow-up

The user reported that import still did not work in the local Electron preview. This follow-up inspected the actual Code-Based Architecture hazard tab, rather than inferring behavior from a standalone worker fixture.

## Observations

- The preview was loading the current renderer and had `streamingCsvImport` enabled in the correct Code-Based Architecture hazard panel. An older preview instance was confirmed closed; this was not a wrong-tab or old-build diagnosis.
- No import status was present at the initial inspection. The historical file-selection/confirmation sequence could not be reconstructed.
- Selecting the supplied file through the real panel's file input started preparation. Its real draft contained architecture snapshots, traceability maps, other generated sheets and a 27,125-entry derived `summaryRows` cache. Preparation staged 58,402 pages before reaching validation/Apply readiness.
- That attempt ultimately reached **CSV validated / Apply CSV import** without an error. Rows remain draft cells until Apply performs durable publication. The agent did not click Apply in the user's profile.

The earlier full-file diagnostic fixture did not include the large derived cache present in the real draft. That omission missed a substantial pre-validation cost and made the static preparation message unhelpful during the real attempt. These findings explain a confirmed preparation bottleneck; they do not prove that every earlier reported failure was caused by that delay or by missing confirmation.

## Additional fixes

- `hazardCsvTransferRun` removes only the `summaryRows` cache when a canonical Summary exists. CSV publication already regenerates this cache. Original snapshots, other sheets, user preprocessing, undo data and unknown source fields remain available to the worker. Legacy sources whose only row representation is `summaryRows` are not stripped.
- Apply transfers only the table and metadata needed for source validation, avoiding a second clone of all project evidence and history.
- The core preparation path also omits the derived cache for unpublished drafts and legacy atomic records, independently of which client invokes it.
- CSV worker encoding yields periodically by groups of pages rather than adding a timer after every 16 KiB page. IndexedDB writes and cancellation checks remain bounded; unrelated main-thread save paths retain their default scheduling.
- Preparation emits coalesced activity updates, and the inline import status shows the shared working mark while busy. The preparation phase names existing project data explicitly, rather than appearing to stall before CSV reading.

## Checks and preview

**40 focused regressions passed across five suites**: transfer projection, CSV persistence/undo, worker-client lifecycle, chunk storage and the hazard panel. Tests include regeneration of caches for draft and saved sources, preservation of original evidence and other sheets, and minimal apply snapshots. Focused ESLint and `git diff --check` passed. The production renderer build succeeded with existing warnings.

A fresh isolated Electron run used the complete 160,913,412-byte / 27,125-row file with a derived draft cache. It passed preview-before-publication, sampled saved-cell checks, undo and cold reopening. Preparation took 39.85 seconds, apply 207.37 seconds, and the whole diagnostic scenario including undo took 629.00 seconds. The sampled peak renderer heap was 383.2 MiB and aggregate process working set 887.6 MiB. No runtime errors or process failures were recorded. This single run competed with development/build activity and is not a controlled performance comparison or a promise of instant imports. Artifacts: `/private/tmp/xhandle-csv-runtime-vhZuKe`.

The agent canceled only its own unapplied validation in the original preview, let that instance shut down, and opened **0.2.14-diagnostics.5** with the existing preview profile and the newly built renderer at `/private/tmp/xhandle-hazard-csv-preparation-build`. It returned to the original project and exact hazard tab and selected the supplied CSV for validation again. The new activity mark and advancing CSV percentage were observed in that real workspace. The agent left Apply untouched.

## Confirmed save-integrity defect and final correction

Subsequent monitoring of that real workspace captured **Saved analysis failed integrity verification. Existing results were not changed.** This exposed a second, concrete defect beyond preparation cost. The agent did not click Apply in the user's profile; the exact sequence of manual clicks was not instrumented.

`sourceTokens` used the table-only index's page-digest map as if it listed every authoritative source page. That index intentionally omits pages consisting entirely of deferred architecture evidence or narrative input. Valid large evidence pages were therefore rejected as corruption during a full source rewrite. The earlier runtime fixtures had small evidence values that shared pages with retained table data, so they did not reproduce this failure.

The corrected reader accepts a source page that is absent from the table-only map, while still validating its run/project/repository/generation identity, its own checksum, source grammar, and the complete source digest before publication. If a table-index digest exists it must still match. Tests now explicitly cover large evidence-only pages in draft and saved-run imports, save/reopen/undo with evidence intact, and genuine corruption on omitted pages. Corruption is rejected both when its page checksum is unchanged and when that checksum is recalculated but the authoritative whole-source digest no longer matches.

The final broader regression run passed **207 tests across 17 suites**. The production build and focused ESLint passed with existing repository build warnings. A separate Electron run used a 5,000-row / 28,526,774-byte CSV, a derived row cache, and two 2 MiB deferred evidence values. Import, save, undo and cold reopening all passed with no runtime errors. Artifact: `/private/tmp/xhandle-csv-runtime-TYgFUv`; log: `/private/tmp/hazard-csv-evidence-runtime.log`. This fixture now exercises the table-only/source-page distinction missed by the earlier full-file fixture.

The idle failed preview was replaced by **0.2.14-diagnostics.6**, using `/private/tmp/xhandle-hazard-csv-integrity-build`. In the actual original project, the supplied 27,125-row CSV was selected again and reached **CSV validated / Apply CSV import**, with no error. The agent left that confirmation for the user. Live verification: `/private/tmp/hazard-csv-corrected-live-validation.log`. No CSV changes were applied by the agent to the user's project.

## Historical diagnostic report supplied during follow-up

Report `0eada265-c454-4e95-85e2-2e0ec5f4ac2f`, from diagnostics.3 at 2026-11-03T14:59:27.197Z, records a software-requirements derivation activity: 4,394 functional fallback rows, no available hazard Summary, and a missing Collaborator AI key. Its operation is `requirements.clear-downstream`, despite the current view label saying Hazard & Remediation. It is useful evidence of that separate derivation failure, not evidence identifying the CSV reader/save failure. Manual CSV import does not require an AI key. Do not conflate this historical missing-key report with the newly reproduced table-index integrity defect.

The original CSV and saved analysis records were not replaced. No commits, pushes or desktop updates were published. Logs: `/private/tmp/hazard-csv-real-draft-regression.log`, `/private/tmp/hazard-csv-real-draft-runtime.log`, `/private/tmp/hazard-csv-preparation-build.log`.
