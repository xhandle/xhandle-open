# Project-loading fixes and memory validation — 2026-11-05

Executed [implementation prompt](../prompts/fix-persistent-project-loading-2026-11-05.md), following the [native-storage investigation](persistent-project-loading-2026-11-05.md). Existing user data and unrelated pending work were preserved. No release, commit or push was performed.

## Changes

- One transaction-free `xhandle` connection keeps the origin storage session open during foreground navigation. It owns no row bodies, creates no schema, closes immediately for upgrades/deletion/pagehide/unmount, and closes after 60 seconds in the background. Failed attempts have a cooldown and retry only on later interaction/source changes; no polling loop.
- Hazard outline metadata is reused across project switches with an **8 MiB aggregate / two-entry** session cache. It retains ordering, bounded group labels and headers, never table cells or analysis snapshots. Searches and filters bypass this cache. Existing viewport row-cache limits remain **400 rows / 16 MiB**, with at most two read workers.
- Both cached-outline paths verify the stored run generation/revision before reuse. Imports, replacements and deletion invalidate stale descriptors. Validation reads metadata only, not chunk bodies.
- Persistent project-read failures stop after one automatic retry instead of looping indefinitely. The existing 60-second inactivity timeout still permits large reads that report progress.
- Worker errors are delivered through the read promise/table error UI. A cancelled request's late bootstrap error no longer propagates as an unrelated global runtime error.
- Added an existing-preview launcher that waits for the previous process and macOS database-lock owner to exit before starting. Electron's existing single-instance guard remains in use. It does not terminate applications or remove lock files.

## Automated checks

105 distinct tests across 14 focused suites passed over the implementation runs. Coverage includes storage upgrade/deletion, missing database, StrictMode/late-open cleanup, background release, read retry exhaustion, cache entry/byte eviction, revision validation, cancellation, worker failure reporting, continuous scrolling and byte limits, virtualization, CSV import/transfer, and navigation without unsolicited graph indexing. The final worker change was followed by the relevant 22-test rerun.

Production build passed with existing repository lint warnings. Strict CI initially rejected those existing warnings; the successful local preview build used `CI=false`. `git diff --check` passed. No independent Safari/Chrome runtime benchmark was performed; the modified renderer paths are shared with browser builds.

## Existing-profile measurements

Used the same aged Electron profile, not a fresh copied database. Final preview: `0.2.14-preview.20261105.8`. Data: 27,125 saved hazard rows and a 4,049-node Functional diagram. No live AI calls or analysis/data edits were made.

| Measurement | Result |
|---|---:|
| First hazard outline preparation in final run | 11.36 s |
| Repeated project entry restoring hazards, five visits | 1.76–1.77 s |
| Ordinary project navigation after first cycle | 0.27–0.29 s |
| Earlier pre-fix warm return to hazards | 11.30 s |

The extra 0.25 s “hazards” steps in the final evidence click an already-selected tab after re-entry; they are polling overhead, not an independent tab-load measurement. An earlier updated-build observation included one 10.16-second return despite no slow native opens; timings depend on hydration and system conditions. Do not describe every load as instantaneous or all delays as eliminated. During that observation the two slowest native `open` calls were 216/135 ms, rather than the repeated ~10-second opens recorded before the fix. No automatic index passes were observed.

The one-time cold native storage initialization is not removed. First hazard preparation still scans the source table. Backgrounding long enough to release the session, browser reload, or an evicted outline can incur cold work again.

## Memory and crash checks

Final run used six navigation cycles and 192 rapid scroll moves spanning distant ranges in both directions. It used normal automatic garbage collection between cycles, sampled every 100 ms, and forced collection only before/after to assess retained memory.

- No renderer crashes, unhandled runtime errors, or sampled table-error states.
- At most 16 table rows mounted, preserving virtualization.
- Peak sampled renderer JavaScript heap: **444 MB**; final retained heap: **163 MB** (decimal units).
- Renderer lifetime peak working set: **1,812.5 MiB**, including the earlier large-diagram test in that process. This includes more than JavaScript and is not a peak isolated to the scroll loop.
- A preceding six-cycle retention test collected after each cycle: retained heap stayed within **466.1–466.7 MB**, then dropped on returning to the ordinary project. This separate run had different already-loaded state and must not be compared as a before/after optimization result.

The first stress run exposed intermittent worker `importScripts` loading errors during rapid scrolling. One instrumented repeat did not reproduce them; their original trigger is not established. Review found the error-propagation gap described above. Tests now verify genuine active failures still reject, late cancelled errors remain cancelled, and workers terminate once. The final build's full stress repeat had zero runtime or table errors.

These checks found no accumulating memory regression in this workload. They do not guarantee crash freedom for larger datasets, long sessions, concurrent analyses or severe system memory pressure. The native storage engine can retain its own caches even though the new session helper retains no records.

## Remaining independent work

The earlier 213-second Collaborator projection-repair operation is an explicit-retrieval issue. Its global repair still clears/rebuilds projections; this change does not rewrite that algorithm or prove what originally created the expensive backing-store state. Ordinary navigation remains free of those indexing passes. A separate incremental-repair change needs its own interrupted-migration, orphan/stale-projection and concurrency validation.

Compact timing/memory evidence: [project-loading-fixes-2026-11-05.json](project-loading-fixes-2026-11-05.json). Detailed temporary samples remain in `/private/tmp/xhandle-storage-fix-memory-final.json` and `/private/tmp/xhandle-storage-fix-results.json`.
