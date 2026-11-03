# Code-Based Architecture derivation reliability fixes — November 3, 2026

Implementation prompt: [fix-code-architecture-derivation-reliability.md](../codex-prompts/fix-code-architecture-derivation-reliability.md).
Original findings: [derivation crash review](code-architecture-derivation-crash-review-2026-11-03.md).

## Implemented

- **Summary-only hazard input.** Repository aliases are queried for metadata first. Only the selected run is opened, with identity/revision and architecture/organization staleness checks retained. Summary rows stream in pages of at most 100 rows, using the existing byte limits, page integrity checks and revision validation. Derivation retains the necessary safety requirements, rather than complete source snapshots/narratives or every raw Summary row. Incomplete/pending saves are rejected before starting AI requests. Existing row offsets, hazard references and safety counts remain intact.
- **Legacy compatibility.** Missing Summary indexes are prepared from bounded token batches without hydrating full evidence. Row indexing supports `analysisResult.Summary` and object-valued `summaryRows` as well as `generatedSheets.Summary`; generated sheets take precedence when both array formats exist. Existing atomic, unchunked IndexedDB records still require one whole-record read because IndexedDB cannot partially read an object. Their unrelated payload fields are discarded from the returned requirements source immediately. This is a legacy-format limitation, not a fully bounded read of those old records.
- **Reusable indexes and duplicate scanning.** Source snapshots share weakly held identity/trace indexes within a derivation. Parent resolution and architecture-reference collection reuse the same maps. Fixed-size prompts avoid an unnecessary serialization of the entire source. The final duplicate scan computes canonical keys/token sets once, uses an exact-key/prefix-token candidate index and yields periodically. Regression tests compare fuzzy merging with a simple reference scan, including first-match ordering, trace coverage and minimum row counts. Similarity semantics and the 0.92 threshold remain unchanged; the index does not guarantee linear work for every adversarial text distribution.
- **Repository-scoped job ownership.** An external job coordinator survives tab remounts. The same repository cannot start overlapping derivation stages, since an upstream stage can invalidate downstream data. Other repositories can run independently. Tab navigation and background processing remain available. Subscriptions and coalesced progress expose the running job to a remounted panel. Completed entries retain only bounded messages, not source/results arrays or promises; only 64 completed/idle scopes are retained.
- **Truthful failure reporting.** System/subsystem/design stages attach bounded failure reports. Missing/empty model output counts as incomplete work. Locally synthesized rows carry fallback provenance. A failed consolidation preserves valid first-pass AI provenance and marks partial output. Failed hazard-to-system generation preserves hazard parent coverage with explicit fallback drafts. Completion messages and Activities qualify incomplete derivations. Software failure details are capped, and generic model requests now have a five-minute client deadline (software retains its existing two-minute deadline).

The changes do not replace the current tables/diagrams, alter navigation, or remove Collaborator review prompts. Existing unrelated working changes were retained. No private Electron source was modified for these fixes.

## Verification

- **140 tests passed in 16 suites:** derivation, job lifecycle, panel remount/publication, Summary reads and legacy formats, source selection/staleness, schema/storage/relationship indexes, persistence, hazard paging/working sets, coverage, checkpoint/archive integration and latest-review archive compatibility. Log: `/private/tmp/xhandle-derivation-regression.log`.
- **40 tests passed in five additional suites:** hazard chunk integrity, first-view behavior, recovery, partial data and paging follow-ups. Log: `/private/tmp/xhandle-derivation-index-regression.log`.
- **180 tests total across 21 suites.** Focused ESLint found no errors. Five pre-existing warnings remain: a sourceRows effect dependency and four mixed-operator warnings in an unrelated hazard edit predicate. `git diff --check` passed.
- The actual derivation-module probe measured source-identity reads, using deterministic local model responses:

| Stage | Previous reads, 100 → 150 rows | Fixed reads, 100 → 150 rows |
| --- | ---: | ---: |
| Software | 10,200 → 22,800 | 400 → 600 |
| System | 97,100 → 216,900 | 1,800 → 2,700 |
| Subsystem | 96,900 → 216,600 | 1,600 → 2,400 |
| Design | 79,300 → 175,350 | 1,600 → 2,400 |

These are operation-count measurements, not customer latency predictions. Input grew 50%; the measured source reads now grow 50%, compared with approximately 121–124% before. HTTP-400 probes now return labeled fallback drafts plus failure reports for all three downstream stages. The held-request probe observes the new 300,000ms deadline.

## Isolated runtime checks

All model calls were mocked locally. Electron used a disposable profile, native diagnostic IPC and the current private preload/collector. Chrome used separate headless temporary profiles with the same production-mode diagnostic bundle. No customer project, running preview profile or paid model service was used.

| Runtime | Functional + hazard rows | Full scenario time | Sampled peak JS heap | Largest sampled event-loop delay |
| --- | ---: | ---: | ---: | ---: |
| Electron | 7,500 + 0 | 9.46 s | 132.6 MiB | 55.7 ms |
| Electron | 11,250 + 0 | 10.82 s | 157.3 MiB | 96.7 ms |
| Chrome | 7,500 + 0 | 8.85 s | 140.3 MiB | 47.0 ms |
| Chrome | 11,250 + 0 | 10.97 s | 170.0 MiB | 82.4 ms |
| Electron | 11,250 + 1,000 | 11.73 s | 188.2 MiB | 245.4 ms |
| Chrome | 11,250 + 1,000 | 13.66 s | 190.9 MiB | 138.7 ms |

The scenario covers derivation, persistence, 120 scroll movements through the actual virtualized table, reaching the final row, and reopening the table. The 7,500-row cases also exercise checkpoint reuse with **zero additional model requests**. Native Electron cold reopen also made zero model requests. The mixed workload retained a synthetic full architecture snapshot and roughly 5.5 MiB of narrative input in hazard storage, imported all 1,000 safety requirements, saved 12,250 output rows and scrolled to the final safety row. It mounted at most 22 table rows. No runtime failures were recorded. Initial fixture creation is excluded from the table's scenario times.

These are single synthetic runs, not a statistically controlled browser/desktop comparison or a reproduction of a 634MB customer workspace. Heap samples are not complete native-memory peaks. The final mixed Electron run's sampled process footprint was approximately 1.19 GiB. Actual provider latency, historical runs, retained workspace state and customer data distributions can change results substantially. A 245ms sampled stall remains in that mixed scenario, so this is not a claim that all main-thread stalls are eliminated.

Runtime artifacts: `/private/tmp/xhandle-derivation-reliability-stress`, `/private/tmp/xhandle-derivation-hazard-stress`, `/private/tmp/xhandle-derivation-browser-9ezcxM`, `/private/tmp/xhandle-derivation-browser-uGNb6a`. The public stress harness now supports `XHANDLE_STRESS_HAZARD_ROWS` to reproduce the mixed workload.

## Status and remaining evidence

The four reviewed implementation defects have local fixes and regression coverage. Offer's generic workspace-termination screenshot still does **not** establish a cause. Obtain his Desktop version, termination reason/exit code and correlated native crash evidence before claiming his particular crash is resolved. A representative sanitized customer workspace remains the strongest next validation input.

Nothing was committed, pushed, packaged for release or published as an update. Source pins, installed data and the user's existing preview were left untouched. The general Chrome/Electron responsiveness comparison remains separate from this task and was previously waived as a blocker for this release.
