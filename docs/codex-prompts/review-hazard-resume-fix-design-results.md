# Review: concrete fixes for hazard continuation

Production code unchanged. No user storage accessed and no provider calls made. This review determines fixes; it does not implement them.

## Priority 1: eliminate repeated serialization in finalization

`fastHazardSemanticReview.js:4`, `compactReviewEntries`, interns each context/evidence/interface using `pool.findIndex(item => JSON.stringify(item) === key)`. This runs during final result construction even when no narrative review requests are sent. Growing pools make this quadratic; large evidence strings amplify the cost.

Use one Map from serialized value to index per pool. Serialize each candidate once, append on first occurrence, and retain the same first-seen ordering and JSON.stringify equality semantics. Use Map.has rather than truthiness (index zero is valid). Preserve undefined and null behavior. Do not change the persisted structure or checkpoint keys. Avoid replacing JSON.stringify with a different canonicalization policy as part of this fix.

Evidence: isolated 1,000-row fixture with distinct evidence/interfaces produced 1,002,999 JSON.stringify calls in current packing versus 3,000 in an indexed prototype. A separate equality test covered repeated entries, undefined and null. This proves algorithmic improvement on the fixture, not the duration or dominant cost in the customer's Safari run. Prototype is archived in the adjacent audit file.

## Priority 2: make finalization cooperative and observable

`fastHazardRunner.js:175–202` constructs sheets, reconciles edits, validates, packs review entries, and normalizes rows without yielding. Setting progress to 96 before this function does not guarantee a paint.

Extract a pure finalization iterator with bounded row/time batches. Drive it asynchronously with task yields and AbortSignal checks before/after each batch and before publication. Cover all bulk passes, including summary normalization, not just the outer function. Precompute header-to-column mappings and method field mappings once. Keep intermediate arrays private until validation completes. Retain the synchronous exported helpers for existing callers if needed; share row-level logic so results remain identical. A resolved Promise is insufficient to guarantee browser rendering between batches. Do not rely solely on requestAnimationFrame, which pauses in hidden tabs.

Expose distinct stages: restoring assessments, building results, validating results, preparing review data, saving results. Progress should represent completed units within a stage; avoid fake time-based percentages. Keep save pending separate from saved completion. Check cancellation and active attempt/project identity before publishing. Partial-result construction in the error path must also yield; cancellation must not accidentally discard already recoverable assessments.

## Priority 3: report checkpoint recovery accurately

`resultsFirstHazardPipeline.js:88` restores assessments without reporting their count. Publish progress after recovery and exclusions, including cached-only runs. Track recovered, newly generated, and excluded counts independently; stop labeling the entire results map as newlyAccepted. Verify consumers before changing telemetry fields. Metrics emitted in finally must include outcome and must not imply persisted completion.

`fastHazardRunner.js:153` initializes validatedAssessments to zero in the interruption manifest. Present the active attempt's recovery progress separately from the prior manifest, rather than presenting zero as the current live count. Do not issue full-run writes for every progress update. Preserve discoverable recovery metadata and prior completed results.

## Priority 4: index governed-edit matching without changing semantics

Both `prepareCodeHazardPreprocessing` and `reconcileCodeHazardPreprocessing` scan prior/owned rows for each output row. Preparation also allocates summary.slice(1) repeatedly.

Build indexes once, using candidate arrays or counts so duplicate identities remain ambiguous rather than silently picking the last match. Preserve exact-ID preference in reconciliation: use it only when exactly one match exists; otherwise apply the existing composite fallback. The fallback compares only identity columns present in the summary, so its index key must use that same available-column set.

Preparation needs separate trace and name-based candidate indexes: when both traces exist use trace equality; when either is missing use the name tuple. Preserve guide phrase, preprocessing basis context, legacy HARA/FHA empty-guide-phrase handling, reviewed No exclusions, unmatched-edit errors, conflict reporting, archived edits and selected-context rules. A simple Map(id,row) is insufficient. Use structured tuple serialization to avoid delimiter collisions. Validate optimized output against the original implementation on generated fixtures before replacement.

## Persistence scope

Keep `saveCodeArchitectureHazardRun` serialized write ownership/epoch handling and `waitForHazardSave` behavior intact. A timeout stops waiting, not the writer. Increasing that timeout cannot fix synchronous CPU work. Record timings for DB opening, structured clone/put and transaction completion separately. Consider changing storage representation only if profiling still demonstrates a persistence bottleneck after the focused fixes; no schema migration is justified by this screenshot alone.

## Acceptance tests before implementation is declared ready

- 27,125 cached assessments: zero provider calls, visible recovery count, final save confirmation.
- Mixed restored/new/excluded assessments: correct non-overlapping counters.
- Indexed packing: byte-equivalent persisted JSON, duplicate/undefined/null cases, bounded serialization counts.
- Preprocessing: duplicate IDs, missing identity columns, missing traces, changed basis, legacy HARA/FHA, human No, partial results.
- Finalization: scheduler gets control between bounded batches, cancel during every phase, no late publication after project switch.
- Slow/failed final writes: results remain visible, retry saves without regeneration, correct save ordering.
- Actual large-project Safari run: capture stage timings, long tasks, peak memory and durable reload. Synthetic tests cannot establish browser responsiveness or eliminate all regressions.

## Review validation

The packing prototype and existing semantic-review suite passed (12 tests). Existing preprocessing and save-wait suites also passed; exact count recorded in the final response. No production patch has been applied.
