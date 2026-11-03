# Confirmed-file follow-up — November 3, 2026

The user confirmed clicking Import and selecting `VulnerableApp-master_hazard_analysis_2026-11-03(1).csv`. Treat the similarly named blank export as a ruled-out explanation for their reported action. This report supersedes the pending clarification and unresolved-current-state notes in `hazard-csv-post-import-timeout-2026-11-03.md`.

## Verified outcome

The current saved revision in the updated local preview matches the confirmed CSV: **27,125 rows, 74 importable columns, zero mismatched, unmatched or missing rows**. The verifier streamed the exact 160,913,412-byte file, matched stable row IDs, and compared SHA-256 hashes of all normalized mapped cell values for every saved Summary row. It excluded the raw ID from the cell hash because identity was checked separately, and excluded Classification Resolution Status because the application calculates it from evidence. Counts represent 2,007,250 compared cell values, in addition to row identity checks. No row contents were written into repository artifacts.

The saved revision verified here has update time `2026-11-03T18:16:12.432Z`. It is newer than the `17:20:43.472Z` revision inspected when blank fields were observed. Its generation/revision differs from that earlier inspection. The completed revision was already present when the profile was copied; the agent did not need to overwrite it. The historical sequence that produced the older blank revision is not established, and this review does not attribute it to a wrong file or Undo.

Selecting the confirmed CSV through the updated App's actual Import control returned **“Every row already matches. Nothing was changed.”** No Apply was issued in that preview. The UI inspection found the saved-row search and rendered table rows, with no storage-timeout or stale-results message.

## Fixes and regression checks

The real-file desktop test exposed a repeat-import defect: all 27,125 rows were reported changed solely because the exported Classification Resolution Status differed from the application's calculated value. Reapplying would calculate the same status again. The shared CSV planner now ignores incoming resolution text as an independent engineering decision; substantive changes still trigger normal status calculation. Exact Undo remains separate and restores the previous status verbatim. New tests cover resolution-only input and a repeated completed-file import preserving the original Undo snapshot.

The earlier cleanup-ordering fix is included: durability is acknowledged separately, and final Apply completion waits for temporary cleanup before the App reloads the table. Selected filename and decimal MB size remain visible throughout the import status. Undo completion now explicitly says it restored the previous hazard table.

**280 tests across 26 suites passed.** Focused ESLint and `git diff --check` passed. The production build at `/private/tmp/xhandle-hazard-csv-followup-build` succeeded with existing repository warnings.

The exact 160.9 MB CSV was exercised through a native Electron file input using a disposable profile and a synthetic baseline retaining actual row identities/interface fields. The first import saved successfully and selected completed fields matched after saving and fresh-process reopening. Its initial repeat-import assertion detected the status-only false changes described above. After the planner fix, repeat validation of all 27,125 rows proposed zero changes, and cold reopening again passed. The repeat test completed in approximately 40.8 seconds and recorded no renderer errors/process failures. This fixture does not reproduce every field of the original project; the separate exhaustive read-only verification of the copied real workspace supplies the full cell comparison.

## Local preview and data preservation

Diagnostics.7 is open, unpackaged, with desktop updates disabled. Project: `/private/tmp/xhandle-csv-followup-preview/project`; profile: `/private/tmp/xhandle-csv-confirmed-preview-o6t0i940`; process at opening: 67356. It includes the accumulated local CSV fixes. The older preview process had already exited when checked. Its profile was copied using an APFS clone before opening the updated preview; the original profile remains at `/private/tmp/xhandle-current-preview-rvq5p7`. Installed Desktop data and the original CSV were not modified. No commits, pushes, pinned-build changes or releases were performed.

The UI import helper initially expected a draft rather than a saved-run prop and stopped before selecting a file; that inspection guard was corrected. Later, the helper's completion condition expected a new save and did not initially recognize a successful no-change result. The waiting helpers were stopped without terminating Electron or running an extra import. A read-only verifier then checked the exact run displayed in the UI. These helper issues were not application import failures.

## Artifacts

- Exhaustive real-workspace verification: `/private/tmp/hazard-csv-confirmed-ui-verify-all.log`.
- App Import/no-change result: `/private/tmp/hazard-csv-confirmed-ui-import.log`.
- Final UI/version/profile check: `/private/tmp/hazard-csv-confirmed-final-ui.log`.
- Exact-file native test: `/private/tmp/hazard-csv-full-import-repro.log`; first saved dataset/profile: `/private/tmp/xhandle-csv-runtime-DrXSK8`.
- Fresh-process initial verification and status-only plan: `/private/tmp/hazard-csv-full-import-read-plan.log`.
- Corrected full-file repeat test: `/private/tmp/hazard-csv-full-repeat-fixed.log`; artifacts: `/private/tmp/xhandle-csv-runtime-4ovgFa` (reusing only the disposable test profile).
- Final regression/build/lint: `/private/tmp/hazard-csv-confirmed-final-tests.log`, `/private/tmp/hazard-csv-followup-build.log`, `/private/tmp/hazard-csv-confirmed-final-lint.log`.

The exhaustive verifier is a temporary, read-only diagnostic bundle, not an application feature. It reports counts rather than customer cell contents. No claim is made that this establishes absence of all future import or renderer failures, or that the historical blank publication's exact cause has been reproduced.
