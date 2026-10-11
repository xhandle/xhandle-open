# Context-save performance review

Date: 2026-10-10. Baseline: `2c7d7cf`. Production code unchanged.

Executed prompt: `docs/codex-prompts/review-context-save-performance.md`.

## Scope and conclusion

Assumed operational contexts in Code-Based Architecture hazard analysis; clarification of the exact context UI was requested but had not arrived at report time. Also inspected Projects operational-context persistence. Repository configuration context was not profiled.

Large tables can make this save expensive. The operation is not merely writing a small context record: imported analyses rebuild rows, persist the whole run, notify a listener that reloads that run, and invalidate derived table state. There is also unconditional CSV-draft construction when the context array changes. These are code-confirmed paths; their exact contribution on the customer's browser remains unmeasured.

## Findings, in recommended priority order

1. **Context changes rebuild an entire CSV draft during App rendering.** `App.js:14556`, `codeArchitectureCsvDraft`, depends on `codeArchitectureHazardContexts` and is computed irrespective of whether a completed run already supplies the displayed table. `codeArchitectureHazardCsv.js:buildCodeArchitectureHazardCsvDraft` builds hazard inputs, expands eligible relationships into guide-phrase/context rows, creates summary cells and normalizes the resulting run. Even an unchanged Save produces a new normalized context array. This affects generated runs as well as imported runs. Row expansion and normalization happen synchronously; browser timing is still needed.

2. **Imported context edits rewrite all matching rows and the full run before closing.** `App.js:14345`, `handleSaveCodeArchitectureHazardContexts`, calls `codeHazardImportContext.js:assignImportedHazardContext`, then awaits `codeArchitectureHazardStore.js:saveCodeArchitectureHazardRun`. Assignment copies full-width rows even on an unchanged save, updates preprocessing context/conflicts, and reconstructs `summaryRows`. `codeArchitectureHazardUtils.js:770` repeatedly searches/lowercases headers per field and per row, and copies every summary field into derived records. The run includes both the sheet and derived row representation, potentially also the CSV undo sheet and other generated sheets. IndexedDB receives the entire run, not a context patch. With no `csvImportPreviousSummary`, assignment returns immediately; do not attribute this particular cost to every analysis.

3. **The save reloads its own run, with an old-context ordering hazard.** `codeArchitectureHazardStore.js:emitChanged` synchronously dispatches the run-change event before returning to the saving handler. `App.js:7908–7945` listens and starts `getLatestCodeArchitectureHazardRun`, then reads saved contexts and calls assignment again. The handler persists the new context record only after the awaited run save. The reload therefore repeats a full read and alignment, and may publish a second run object. If its asynchronous read completes before the new contexts are stored, it can align against the previous context and save again. This is a possible interleaving, not a reproduced customer data-loss claim. Avoid introducing a simplistic context-first write: two stores need failure-aware ordering and scoped notifications.

4. **Review matching performs repeated whole-table searches.** `App.js:9463`, `codeArchitectureHazardReviewByRow`, serializes summary rows and uses `indexOf` for each review item's serialized row. Worst-case matching is O(review items × summary rows), in addition to serialization. Context edits change row contents and can turn old review content into full-table misses. Hidden review controls do not remove this computation. It reruns when a new Summary arrives. Matching cannot simply be dropped without preserving review identity and freshness semantics.

5. **Table work is reduced by deferred cells, but not fully bounded to visible rows.** `CodeArchitectureHazardPanel.js:89` normalizes Summary when the whole run/draft identity changes. `CodeArchitectureHazardSummaryTable.js` rebuilds row items, filters/groups and creates `DeferredHazardRow` instances for all expanded group items. Each deferred row calculates an estimated height. There is existing deferred rendering; this is not a claim that every off-screen cell renders eagerly. Quantify the remaining React work with a profiler before choosing a rendering change.

6. **Projects context saves have a separate broad-write cost.** `App.js:8947` calls `saveProjectPatch`, which reads the project map and `writeProjectMap` JSON-stringifies and synchronously writes the entire map (`App.js:1903–1943`). Cost can therefore track other retained project data, not only the visible table. Code Architecture's standalone context store itself only serializes the small context array.

Additional contributors: global `xhandle:data-changed` events schedule an App render after 150 ms (`App.js:3873`), and schedule auto-backup when configured (`localBackupService.js:494,569`). Backup is conditional/debounced, not demonstrated to be the cause here. The context modal correctly awaits `onSave` before closing, but its button remains labeled “Save contexts” while disabled; synchronous work can delay painting that state (`HazardOperationalContextManager.jsx:47`). No LLM request occurs on the Save path; AI suggestion generation is a separate action.

## Synthetic validation

Ran the real imported-context assignment function in Jest/jsdom with 76-column synthetic sheets, plus a reproduction of existing review matching. One warm-up, then median of three measurements on this machine. Each sheet has unique raw IDs, Yes applicability, one context changing scenario, descriptive synthetic cell values, an undo Summary, and no preprocessing ownership entries. Therefore it excludes extra governance-record work. The JSON measurement is a serialization proxy, **not IndexedDB timing**. The fixture fills most cells and its byte sizes are not estimates of customer data. No browser database or customer record was touched.

| Rows | Context assignment (ms) | Unchanged assignment (ms) | Review matching, stale rows (ms) | JSON serialization proxy (ms) | Serialized synthetic run (MB, characters/1e6) |
|---:|---:|---:|---:|---:|---:|
| 100 | 7.0 | 0.2 | 1.3 | 2.5 | 2.1 |
| 1,000 | 65.2 | 0.9 | 14.5 | 29.1 | 20.5 |
| 2,807 | 208.2 | 2.5 | 60.1 | 103.6 | 57.5 |
| 10,000 | 738.5 | 10.4 | 235.9 | 346.4 | 204.9 |

These measurements establish synchronous work scaling with rows, not total Save latency. Draft generation, browser cloning/storage, event-driven reloads, garbage collection, and React painting were not measured. Small tables can still lag if the run contains large other sheets or the Projects map is large.

Executed `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath` with `contextSave.audit.test.js`, `codeHazardImportContext.test.js`, and `HazardOperationalContextManager.test.jsx`: **3 suites, 7 tests passed**. The temporary audit test was removed from src and retained as `docs/investigations/fixtures/context-save-audit.test.js.txt`. To reproduce, copy it temporarily into `src/features/code-architecture-hazard-analysis/` and run the same command, then remove that copy. Existing tests cover retained imported decisions, no-op identity, unambiguous context assignment, and async modal completion; they do not establish browser responsiveness or event-race safety. No production build needed for this documentation-only audit.

## Minimal proposed implementation sequence

1. Add scoped measurements around save, assignment, storage, reload and first table paint. Profile both imported and generated runs, unchanged and edited contexts, with small and large synthetic data in Safari/Chrome.
2. Prevent originating saves from redundantly loading/re-aligning themselves; coordinate context/run persistence and notifications. Guard by project, repository and run identity and preserve failure reporting. Add a delayed-read test reproducing the old-context interleaving before changing ordering.
3. Construct CSV drafts only when needed; keep a lightweight stable workspace identity separately because the current draft supplies import guards. Return early for equivalent contexts. Ensure context edits still invalidate genuinely context-dependent drafts.
4. Pre-index summary headers and review row keys; preserve current duplicate matching and review freshness. Reuse unchanged row references and avoid unnecessary derived summary rebuilds. Do not change applicability, rationale, gating or hazard reasoning.
5. Measure again before deeper persistence changes. If full-run cloning remains dominant, introduce a tested context patch/overlay or row-oriented storage behind the existing API rather than moving the whole database as a first step. A worker can move CPU work but does not remove cloning or rendering costs.
6. If profiling warrants it, isolate table renders and bound off-screen row work; use a visible Saving state that can paint. Never report success early or lose imported decisions to make the UI feel faster.

Required regression coverage for a future fix: No/Yes applicability and rationale preserved, changed-context provenance handled consistently, reload retains edits, unchanged save avoids large writes, self-notifications do not reload/revert, save failure remains visible, project/repository switches cannot commit into another workspace, and CSV draft/export plus context filters retain current behavior.
