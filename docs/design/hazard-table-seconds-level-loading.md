# Seconds-level hazard table loading

## Requirement and current evidence

The avLocalizationWithOutHDMap hazard tab reportedly spends approximately five minutes on **Loading saved results**. This is the storage/restoration stage, not the later table layout stage. The exact workspace has not been profiled here.

Set an acceptance target of at most five seconds from opening the tab to a usable first viewport on the customer's M4/16 GB machine, using representative cold and warm large projects. Treat this as a target pending measurement, not a guarantee for arbitrary dataset size or damaged/unavailable storage.

The current path reconstructs and verifies the complete saved analysis before the panel receives its Summary sheet. Chunking bounds transient read buffers but does not eliminate total payload cost. It also includes database opening/legacy fallback migration and metadata/revision checks. Increasing memory or analysis concurrency does not remove this dependency.

A disposable Chromium benchmark with 15,000 table rows and 24,000,000 evidence characters produced 1,554 chunks. Serial range emulation took 797 ms / 1,554 read requests; bounded batches took 755.5 ms / 98 requests. Maximum sampled event-loop gaps were 16.7 and 17.1 ms respectively. This small improvement does not explain or resolve the reported five minutes. The synthetic records and warm local disk are not representative proof of the user's result.

## Instrument first

The latest-read path now exposes a bounded list of eight metadata-only diagnostic records at `window.__xhandleHazardLoadDiagnostics`. It records storage open/migration, metadata read, root read, hydration/integrity verification, and revision-recheck durations, plus chunk progress and completion status. It contains no project IDs, row data, or evidence. An active phase may be inspected while loading. Use the actual slow project's trace to determine whether the bottleneck is transaction contention/migration, a massive payload, repeated cancellation, or reading/verification CPU time.

## Durable design

1. Separate a **table projection** from the full resumable run. Store only rendered columns, stable row IDs, grouping/filter keys, source references, and a compact manifest. Do not duplicate evidence, request history, architecture snapshots, or checkpoints into each display row.
2. Store projection rows in bounded pages, keyed by immutable generation and row range. The manifest carries count, schema version, source revision and page integrity information. Fetch only viewport pages plus small bounded lookahead; release offscreen pages through an explicit byte-budgeted cache.
3. Build projections during save/import, using existing streaming traversal where possible. Publish the authoritative run and matching projection manifest atomically only after all pages validate. Cancellation, quota failure or interrupted save must leave the previous generation usable. Reclaim old generations after readers retire.
4. Legacy projects require a one-time projection build. Keep the source unchanged; allow cancellation and retry. Do not claim an existing huge legacy run's first conversion meets the five-second target. Subsequent opens must avoid complete run hydration. Diagnose this user's current data before choosing a conversion path.
5. Keep projection results and full run objects as distinct types/APIs. Never pass a projection as a complete `latestRun`, and never save it over authoritative results. Analysis continuation reads verified checkpoints separately. Edits must use version-checked authoritative writes or explicitly acquire the full editable run before enabling an action that needs it.
6. Preserve complete-dataset semantics. Counts come from the manifest. Search/filter/sort operate on persisted indexes or scan pages in bounded background work; do not silently search only loaded rows. Focus by row ID fetches the correct page. Export traverses all records and does not depend on viewport cache contents.
7. Keep UI work short and cancel stale requests on project changes. App focus must not restart active loads. Verify integrity per requested page rather than rehashing all unrelated evidence on each table open.

## Release gates

- Measure cold/warm load distributions on actual small and largest projects in Chrome and packaged Electron; separately validate Safari compatibility.
- Verify the five-second first-usable-viewport target, responsive navigation/cancellation, bounded additional memory and absence of sustained long renderer tasks.
- Test data round trips, saved partial results and continuation, missing/corrupt pages, stale manifest, deletion, simultaneous save/read, quota exhaustion, cancellation, schema migration, and crash recovery.
- Test full-dataset filtering/sorting/export and distant-row navigation against the existing implementation for identical results.
- Do not release a projection implementation based solely on synthetic loader benchmarks or a partial-results preview.

## Current implementation scope

Only bounded read batching and diagnostics have been implemented in this investigation. The projection architecture above is a proposed next implementation, not completed work. Existing integrity checks, snapshot isolation and cancellation remain active. No preview, relaxed integrity check, destructive conversion or memory-limit increase was introduced.
