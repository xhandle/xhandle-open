# Paged hazard first-view implementation review — 2026-10-28

## Verdict

**Not ready to release.** Bounded first-page storage reads are implemented and pass focused tests, but the current App does not build and integration regressions remain. No claim of seconds-to-interactive on the real large project, or absence of freezes/crashes, is justified yet.

This review ran the prompt in `docs/codex-prompts/review-paged-hazard-first-view.md` against the current working tree. Unrelated existing edits were preserved. Review artifacts and characterization tests were added; findings were not silently patched, and nothing was committed or released.

## Findings

### 1. P1 — Production build is blocked by missing exports

`src/App.js:215` imports `resolveCodeArchitectureHazardRun` and `deletePagedHazardRow` from the feature barrel, but `src/features/code-architecture-hazard-analysis/index.js:9` exports neither. `npm run build` fails with the missing resolver export. Both names must be exported or imported from the store directly. Existing helper tests bypass App, explaining why they pass.

### 2. P1 — Incomplete runs without a main Summary are stuck in an upgrade loop

`hazardRowIndex.js:48` requires an array header, but large runs can contain evidence and a pending attempt before a main `generatedSheets.Summary` exists. `codeArchitectureHazardStore.js:149` translates that failure to a mandatory upgrade. `prepareHazardTableIndex` rebuilds the same null-header index, so retry never succeeds. A reproduction saves a large incomplete run with partial results, performs the upgrade, and observes the same upgrade-required error afterward. Its authoritative data remains readable by the full API. Support absent/empty main tables explicitly and expose the retained partial results.

### 3. P1 — Descriptor saves report success while dropping edits

`codeArchitectureHazardStore.js:201` resolves a paged descriptor by returning the original full record, discarding changes on the supplied descriptor. The save method calls this resolver at line 271 and publishes the original contents successfully. A reproduction adds `reviewStatus: 'reviewed'` to a loaded descriptor and saves it; the persisted record lacks that edit. Reject descriptor writes explicitly or use revision-checked mutation operations. Current CSV and narrative callbacks resolve before editing; this finding is a broken save contract, not a claim that those two callbacks always lose edits.

### 4. P2 — Functional trace navigation and split-view hazard links regress

`PagedHazardPanel.js:96` always supplies an empty `functionalTraceIds` set. `CodeArchitectureHazardSummaryTable.js:519` therefore routes Functional hazard trace links to CSU. The complete loader computes the real Functional trace IDs. Additionally, `App.js:17950` passes `run.generatedSheets.Summary` into the split diagram, but the paged descriptor deliberately has no generatedSheets. Preserve correct trace resolution and provide on-demand linked-row access without hydrating the whole run.

### 5. P2 — CSV undo, saved narrative findings and stale-result warnings disappear

The descriptor returned at `codeArchitectureHazardStore.js:154` omits `csvImportPreviousSummary` and `narrativeReview`. The panel gates undo on the former (`CodeArchitectureHazardPanel.js:368`), and `HazardNarrativeReview.js:15` initializes displayed findings from the latter. A storage reproduction confirms both are retained on disk but absent from the descriptor. Provide lightweight presence metadata and explicit loading of these details. `PagedHazardPanel.js:96` also hardcodes `isStale: false`, bypassing the normal stale-result calculation; a generic page status does not replace that warning.

### 6. P2 — Memory bounds are incomplete for filter options and full-record actions

`pagedHazardRows.js:44` retains up to 500 complete cell strings. The per-row limit is 8 MiB, so an item-count cap alone can still retain enormous text in a worker and clone it into the renderer. This is an inspected bound failure, not an observed customer crash in this review. Add an aggregate byte budget and a way to select/search long values without copying them all into UI options.

The descriptor resolver still hydrates the whole source for continuation, CSV baseline handling, and narrative review. Those paths preserve data but are not covered by the bounded first-page guarantee. They require their own memory measurements before claiming the crash problem is eliminated.

## Additional review concerns

- The paged metadata/root read does not revalidate metadata after reading the root, unlike the compact-reader branch. Subsequent page reads reject mismatched revisions, so this is a recoverable loading race rather than proven data corruption.
- The row-index validator checks main spans thoroughly but does not apply the same coordinate checks to partial spans.
- Highlight navigation resets filters and sets a page offset concurrently with a query effect that resets the offset to zero. Add integration coverage for off-page trace targets with active filters, including pages shortened by the byte cap.
- Grouping is explicitly per-page and global quick-search registration is skipped for remote pages. These are behavior changes that need an explicit product decision and integration tests, rather than being assumed equivalent to the prior table.

## Validation

- Broad hazard-analysis and project-transfer suites: **99 passed, 1 skipped; 907 tests passed, 1 skipped**. Log: `/tmp/paged-review-tests.log`.
- Added three characterization tests: **3 passed**. They reproduce current defects (missing action metadata, discarded descriptor edit, repeated upgrade requirement); passing here confirms the defects, not correctness. File: `pagedFirstViewReview.characterization.test.js`; log: `/tmp/paged-review-characterization.log`.
- Existing paged storage tests verify a zero-source-chunk descriptor read, a bounded 100-row first page, a match outside the first page, partial-row access, complete resolution, and deletion preserving evidence/partial results.
- Production build: **failed** on the missing export. Log: `/tmp/paged-review-build.log`.
- `git diff --check`: passed.
- No installed workspace databases were modified. No customer analysis or paid AI requests were run.

## Performance evidence limits and next gate

The existing `benchmark-hazard-first-view.cjs` renders the table directly, replaces the prepared panel, and does not use the new paged App path. Its earlier timing cannot validate this implementation. The current build failure blocks a production App benchmark; no new whole-App cold-start timing is reported.

After fixing the findings, build the App and test a fresh renderer/profile with a representative large, wide table and partial results. Measure first interactive rows, renderer/worker peak memory, event-loop stalls, filter/export behavior outside page one, trace navigation, CSV undo, and continuation. Test cancellation and project switching while work is pending. Keep original saved data intact throughout. Do not release based solely on the storage-helper timing or unit-test totals.
