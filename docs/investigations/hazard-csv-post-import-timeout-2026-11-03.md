# Post-import timeout and saved-table investigation — November 3, 2026

Follow-up: see `hazard-csv-confirmed-file-followup-2026-11-03.md`. The user confirmed the completed file, and a newer saved revision has now passed exhaustive comparison of all 27,125 rows and 74 importable columns. The historical blank revision described below is not the current verified revision.

The user reported a failed 160 MB import in the diagnostics.6 local Electron preview. The screenshot showed both “Saved CSV updates to 27,125 rows” and an IndexedDB opening timeout. Do not infer correct cell content from the success message or row count alone.

## Live findings

Read-only inspection found a saved root with 27,125 Summary rows and 84,072 token pages. Its update timestamp was `2026-11-03T17:20:43.472Z`. Loading diagnostics recorded a 10-second database-open timeout at `17:27:24Z`. A subsequent read opened the database successfully; retrying the existing “Retry loading” and “Retry rows” controls cleared the errors and displayed the table with 27,125 matching rows. This was a view retry, not an import, Undo, or record edit.

However, three current Summary samples (first, middle and last) contained blank hazard/causal-scenario/constraint/requirement/applicability fields. Their stable IDs matched entries in the supplied Downloads CSV, whose corresponding fields were populated. The saved row cache showed the same blank values. The actual `createValueAssembler` decoder confirmed the result; an initial simplified inspection decoder was independently checked before reaching this conclusion.

One row decoded from `csvImportPreviousSummary` matched the supplied CSV's stable ID and all five selected substantive fields. Therefore completed data exists in the previous snapshot. This is not yet a whole-snapshot comparison and does not establish how the current blank publication occurred. The selected file input was already reset, so the last selected filename/contents could not be recovered from that input. The agent asked whether the user had invoked Undo or imported a second file and whether the selected file was the previously supplied Downloads CSV. That clarification remains pending.

No new import, Undo, saved-record replacement, or workspace restart was performed. Do not overwrite either version without resolving the sequence and verifying the intended input.

## Source correction for reload sequencing

Code inspection identified a separate ordering problem: the worker posted its final Apply result immediately on durable publication, before potentially large temporary-store/source-generation cleanup finished. The App could then initiate table reloads, and the client could terminate the worker after a five-second disposal grace period while cleanup still occupied storage. This creates a plausible route to the observed timeout; the existing live evidence does not prove it was the only cause.

The worker now emits a separate durable `committed` notification for truthful cancellation handling, then sends final completion only after cleanup finishes. The client records durability without resolving Apply early, preserves durable success if the worker fails after publication, and keeps the UI in its saving phase during cleanup. The diagnostic harness understands the additional notification. This does not raise timeout limits or suppress corruption checks.

79 tests across seven suites passed, including new delayed-cleanup, cancellation-after-publication, and worker-failure-after-publication cases. Focused lint and `git diff --check` passed. A production build at `/private/tmp/xhandle-hazard-csv-reload-fixes-build` succeeded with existing warnings. A disposable Electron 45 check with 1,000 synthetic rows, derived cache and two 2 MiB evidence values passed import, context assignment, exact Undo and cold reopening, with no runtime errors. Native artifacts: `/private/tmp/xhandle-csv-runtime-ERB0Pe`.

Logs: `/private/tmp/hazard-csv-post-import-inspect.log`, `/private/tmp/hazard-csv-post-import-verify.log`, `/private/tmp/hazard-csv-saved-root.log`, `/private/tmp/hazard-csv-input-inspect.log`, `/private/tmp/hazard-csv-reload-race-tests.log`, `/private/tmp/hazard-csv-reload-race-lint.log`, `/private/tmp/hazard-csv-reload-fixes-build.log`, `/private/tmp/hazard-csv-reload-native.log`. Sample contents remain only in temporary local inspection files and are not included in this report.

The running diagnostics.6 preview still uses its existing build. The newer regression fixes and cleanup-ordering correction have not been loaded into that window, committed, pushed, or published. Correct customer-scale imported content and its causal history remain unresolved; do not report this incident as fully fixed based on the synthetic checks.
