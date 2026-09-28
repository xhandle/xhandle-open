# Regression review of storage repairs — 2026-09-28

Prompt executed: docs/codex-prompts/review-storage-repair-regressions.md.
Conclusion: **not regression-free**. Full automated suite is green, but the following uncovered behaviors need correction before relying on unattended operation.

## P1: legacy recovery can overwrite newer content (confirmed logic reproduction)

src/lib/decompositionRecovery.js:14 returns any recovery record whenever the primary has no decompositionVersion, without checking age, content, or whether the primary is populated. App.js hydration then writes the selected rows back through saveProjectPatch. Existing pre-migration projects can therefore lose newer content or have intentionally removed rows resurrected by an older backup. Introduced in the latest repair's fallback for legacy data.

scripts/diagnostics/review-storage-regressions.cjs evaluates the current helper with primary NEW dated September 28 and checkpoint OLD dated September 27; OLD is selected. This proves selection behavior, not a real Safari data mutation. Correction: make ambiguous legacy recovery a reviewable candidate, not an unconditional replacement; establish content versions through migration without discarding current data.

## P1: failed import can silently become an accepted import after refresh (confirmed logic reproduction)

App.js:1907 schedules decomposition recovery even when writeProjectMap failed. importDecompositionCSV at App.js:14330 reports that nothing changed and returns when saveProjectPatch is false. The rejected imported rows can nevertheless reach the recovery store with a newer version; hydration then selects and applies them on the next load.

The isolated current-code diagnostic forces a primary write failure while allowing recovery: save returns false, but chooseDecompositionRecovery returns REJECTED IMPORT rather than ORIGINAL. Correction: distinguish a staged/uncommitted recovery candidate from an accepted project revision. Either treat a durable fallback as a successful import explicitly or ensure failed import candidates never auto-apply. Do not delete them merely to hide the issue.

## P1: functional import can publish into a different project's UI after navigation (code-path finding)

App.js:14334 now awaits flushRecoveryRecord, potentially for multiple seconds. After it resolves, lines 14349–14351 update shared responseRows/diagram state without checking active project or navigation epoch. The explicit save used the captured original ID, but the currently selected project's autosave can persist the imported rows to that second project.

An earlier asynchronous file read already offered a smaller race; the new durability wait adds a substantial new window. The hazard run guard does not cover imports. Correction: capture project and epoch at import start, persist against that identity, and skip UI publication if navigation occurred. Add an integration test that stalls recovery, switches projects, then releases the write. No live-browser reproduction was performed in this review.

## P2: project deletion leaves recovery data behind (code-path finding)

App.js:6377 deleteProject removes primary data, hazard artifacts, and reviews but never deletes decomposition:<id> or hazard-run:<id> from xhandle-recovery. These copies include source rows and analysis stages and continue taking storage, contrary to the delete confirmation saying locally stored data will be removed. Introduced with the new store. Correction: coordinate queued checkpoint cancellation/tombstones with project deletion and remove the recovery keys after in-flight writes settle; verify they cannot reappear from a late write.

## P2: loading becomes dependent on the new recovery database (code-path finding)

App.js finishProjectLoad always awaits recovery, even when a valid primary decomposition exists. A blocked/unavailable recovery database causes the catch branch to leave projectLoaded false. This protects writes but also prevents ordinary existing project operation when only the supplemental store fails. Previously valid primary data could load independently. Correction: distinguish primary read failure from optional recovery failure, preserve usable primary content, and provide explicit degraded read-only/retry behavior instead of a generic loading dead end.

## Additional remaining risks

- Final hazard UI state is still published before final compare-and-set save succeeds. A failed/stale save can leave visible state and the separate autosave path inconsistent with the durable result; review transaction/UI rollback together.
- Queue coalescing bounds retained snapshots but every submission still performs synchronous JSON serialization. This is not proof of a memory leak; no real heap/overnight profile was captured.
- Checkpoint export remains JSON, without automatic AI resume. Work within an incomplete stage remains uncheckpointed.

## Validation

Full Jest run: **118 suites passed, one suite skipped; 1,100 tests passed, two skipped**. Includes existing diagram, CSV import, preprocessing, hazard generation, persistence, review, and recovery unit tests. Log: /tmp/xhandle-regression-review-tests.log.

Current-code storage diagnostic still confirms accurate quota failure reporting, preservation of corrupt primary storage, and successful save/reload behavior. New isolated diagnostic confirms the two recovery regressions above. git diff --check passed.

No production code changed during this review. No user data cleared or overwritten, no paid AI requests, no real Safari overnight run, and no guarantee that untested UI combinations are regression-free. Deliverables are the prompt, this report, and scripts/diagnostics/review-storage-regressions.cjs.
