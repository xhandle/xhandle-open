# Review of paged hazard follow-up fixes — 2026-10-28

## Verdict

**Not ready to release.** The targeted stale-edit, governed-review descriptor, and partial-display regressions now have passing tests. However, the revision protection exposes a continuation recovery bug, and the Review Center update handler introduces a repeated-edit regression. Both are reproduced with real IndexedDB storage. This review changed no production code or customer data.

Executed `docs/codex-prompts/review-paged-hazard-followup-fixes.md`.

## Findings

### P1 — Interrupted continuation rejects its own final partial-result save

Locations: `src/features/code-architecture-hazard-analysis/fastHazardRunner.js:164–167`, `:251–252`; revision propagation in `codeArchitectureHazardStore.js:298`.

A resolved previous run carries its source revision. The runner spreads that run into `recoverable`, then saves an initial recovery manifest. Save advances the token on `recoverable`, but not on `previousRun`. When generation is interrupted, the runner creates `recovery` from the unchanged `previousRun`. Its old token now conflicts with the initial manifest save from this very same attempt. This occurs without any other client editing the run.

Reproduction uses the actual runner, a real saved paged descriptor, the real resolver/store, and a mocked generation interruption containing one validated assessment. The final recovery object has one validated assessment but `finalSavePending: true` and “Saved analysis changed. Reload it before saving edits.” Durable storage retains the earlier empty manifest with zero validated assessments. The published Summary remains intact. This does not establish loss of separately saved generation checkpoints: generation is mocked, and checkpoints may allow a later continuation to recover work. It does establish that the final partial-result record is not saved correctly.

Fix direction: retain and propagate the successfully committed recovery snapshot/revision within the running attempt, including late initial-save completion and cancellation. Preserve conflicts with independent edits; do not disable revision checking. Test interruption after a completed initial save, delayed initial save, explicit Stop, and a concurrent external edit.

### P2 — The second Review Center edit to a row is rejected as missing

Location: `src/App.js:9960`, with exact-content matching in `hazardReviewRowIndex.js`.

The handler always searches using `item.originalContent.row` when present. After the first edit, the stored row contains the modified contents, while originalContent correctly retains the original audit snapshot. Exact row matching consequently fails on the next edit even though its stable Raw Analysis Row ID still exists. The handler alerts “The reviewed row no longer exists. Reload the review.” The second change is not saved.

Reproduction invokes the actual App updateHandler extracted from its AST against real storage: original → first edit succeeds; first edit → second edit with the same review item's original snapshot fails. Stored contents remain at the first edit.

Fix direction: resolve by stable row ID and validate against the immediate pre-edit contents/revision, retaining originalContent for audit. Do not fall back blindly to an old numeric row position. Test consecutive edits, approval after an edit, row deletion/reordering, and external conflicting edits.

## Tests and build

- Broad hazard, transfer, collaborator, functional-decomposition, and diagram tests: **107 suites, 1,071 tests passed; one suite/test skipped**. `/tmp/paged-review4-tests.log`. This completed before the new reproductions were added.
- Two new reproductions: **passed**, confirming the defects described above. `src/features/code-architecture-hazard-analysis/pagedRecoveryReview.characterization.test.js`; `/tmp/paged-review4-repro.log`. These assertions intentionally describe current faulty behavior and must be reversed when fixed.
- Server transfer tests: **4 passed**. `/tmp/paged-review4-server.log`.
- Production build: **passed with warnings**. `/tmp/paged-review4-build.log`.
- `git diff --check`: passed.

## Performance

Disposable Electron saved-panel benchmark: 15,000 result rows, approximately 32 million evidence/review characters, 3,175 source chunks, and 1,224 indexed pages.

- Descriptor: 23.0 ms.
- First usable rows: 197.9 ms.
- Next page: 119.1 ms.
- Rendered rows: 101 including the group row.
- Maximum measured event-loop interval: 67.8 ms.
- Peak renderer working set: 206,448 KiB (approximately 202 MiB).

`/tmp/paged-review4-benchmark.log`. The fast saved-page path remains intact in this synthetic test. This does not certify full customer projects, Safari, packaged Desktop, or large mutation/continuation actions. Those actions can still resolve a full run, and complete collaborator review snapshots retain the documented 32 MiB limit. No paid AI calls or live customer analyses were performed.
