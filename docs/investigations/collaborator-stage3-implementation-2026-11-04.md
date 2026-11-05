# Collaborator Stage 3 — scoped workspace read tools

Implemented locally from [the executed prompt](../prompts/collaborator-stage3-2026-11-04.md), preserving pending Reports and Stage 1/2 work. Authoritative project/source records are unchanged. No commit, push, desktop package or published update was made.

## Behavior

Ordinary Collaborator questions can now obtain targeted evidence before generating an answer, rather than relying only on the small initial context sample:

- Full-field, literal text search across permitted indexed records, with excerpts around matches deep in a record. Reference searches distinguish `H-1` from `H-10` and support Unicode text.
- Paginated row queries with equality, substring, existence and numeric comparison filters. Applied filters, artifact types, project/repository/run scope and coverage are returned with results.
- Exact row counts, grouped counts and distinct-value unions. Functional endpoint counts can use distinct from/to labels instead of counting decomposition relationships as functions. Unknown columns, unreadable records and budget exhaustion invalidate exact-count claims.
- Exact record, field and section reads with bounded excerpts and continuation offsets.
- Relationship traversal within the permitted projects, including related artifact types. Later calls can read validated records returned by earlier lookups without broadening project scope.
- Saved-version lists grouped by run/source and sorted newest first. Comparison of two individual stored records identifies changed fields and includes changed passages even when they occur deep in report text. It does not claim to compare every row of two complete analysis runs.
- Authoritative source-text excerpts from an exact repository-relative code-index key, following chunked text pages instead of hydrating unused source payloads.

Simple counts, quoted searches, exact references, source paths and certain version lookups use direct local plans without an additional AI planning request. More complex questions use one bounded JSON planning request through the existing selected provider/model/effort, followed by up to four validated local reads and the normal answer request. General definitions do not require a project lookup. No provider preferences were changed, and no live AI calls were made during development validation.

## Scope, freshness and budgets

Project names are treated as literal data. Explicit unknown or duplicate names ask for clarification. The visible project/repository supplies the default scope; explicit named projects and workspace-wide requests resolve separately. An explicitly visible saved hazard run is retained as the boundary, even when it is older than the newest saved run. Otherwise current hazard queries select the newest run per repository/method. Historical architecture repository suffixes and repository identity aliases are handled.

Read plans cannot write, execute scripts, run SQL, fetch external URLs, access arbitrary filesystem paths, request unknown operations, exceed result limits or add projects outside the resolved policy. Result references bind only to earlier returned records. Retrieved text is supplied as untrusted evidence. Existing governed mutation and Collaborator review paths remain separate.

Read scans use a Web Worker in modern Chrome/Electron and the existing shared mutation lock. Stop terminates an active worker or releases a caller waiting for the lock; an aborted queued read cannot start a late worker. Source snapshot changes and an atomic graph-write revision token invalidate results if data changes during a read. Counts become null and coverage becomes stale. Raw external IndexedDB writes bypassing supported writers/notifications remain outside that guarantee.

Current limits are deliberately bounded:

- Four local calls per plan, eight seconds by default and a twelve-second maximum execution budget.
- At most 100,000 metadata records scanned and 256 MiB of decoded/serialized body work across the plan; this byte counter is cumulative processing, not retained dataset memory.
- Sixty-four metadata records per page; body reads use batches based on an estimated 2 MiB payload. Only records with an estimated body size at or below 1 MiB are eligible for full-body reads. Size estimates are guards, not exact JavaScript heap measurements.
- Twenty returned rows per call; 6,000-character read excerpts; 100 scalar groups; 50,000 distinct values within a 4 MiB distinct-key budget; 1,000 saved run/version groups.
- A 22,000-character targeted-evidence prompt budget, shared across calls while retaining whole rows and source citations. Complete scan/count coverage is distinct from truncated displayed rows/excerpts.

Coverage distinguishes complete, partial, stale, unindexed, inaccessible, not-found and not-searched results. Exact totals and absence claims are allowed only within the returned complete scope/domain and applied filters. Unowned records are excluded from project-scoped tools. Canonical explicit repository APIs retain their prior global/unowned-record behavior.

Schema remains graph version 3. Migration signature version 6 refreshes supported source projections with body-read guards, schema field names and repository/run metadata. Existing unmanaged graph projections receive a one-time hint repair. A legacy opaque source/graph record can still require a whole-record read during initial repair; modern chunked source text stays paged. No assertion of zero memory risk is made for legacy data.

The primary tables, diagrams, tabs, review controls and existing interaction flow were not redesigned. Read evidence replaces contradictory legacy cross-project fallback data when a read policy is active. Existing source citation links are reused. Project archive and backup compatibility checks continue to pass.

## Validation

333 tests passed across 28 targeted suites, combining the complete 332-test run with the affected read suites rerun after adding the final deep-comparison case. One existing opt-in 520 MiB internal-checksum parser test was skipped.

The thirty new read-tool tests cover deep text beyond snippets; complete filtered counts and grouping; distinct endpoint counts; short identifiers; pagination; named-project ambiguity; unknown project/repository names; current/history/visible-run and repository aliases; exact reads/sections; deep report comparisons; oversize-body guards; project-safe traversal; dependent references; source excerpts; plan validation; budgeted output/citations; hint upgrades; source/canonical-write races; cancellation while queued/active; no planner call for simple counts; malformed planner rejection; incomplete-index diagnostics; and generic-definition behavior. Existing migration, query, report/test navigation, review persistence, mutation/undo, cleanup, archive and backup regressions also passed.

- `/private/tmp/xhandle-stage3-final-regressions.log`: 28 suites, 332 passed, one skipped.
- `/private/tmp/xhandle-stage3-comparison-followup.log`: three affected read suites, 30 passed.
- `/private/tmp/xhandle-stage3-lint-final.log`: no lint errors; two pre-existing Collaborator warnings.
- `/private/tmp/xhandle-stage3-build.log`: optimized production build passed with existing application warnings.
- `git diff --check` passed.

## Native runtime checks

Actual IndexedDB and Web Workers in disposable Electron 45 and headless Chrome 156 profiles on the local M2/8 GiB Mac. External requests were blocked. No installed workspace or customer data was used. The harness exercises actual graph/read modules and the current scope/prompt helpers.

The existing nine Stage 2 runtime check groups still pass. Each runtime additionally seeded 27,125 synthetic requirement records with approximately 2,200 padding characters per record, a late match in the last record, and a two-value severity field. Three complete scan samples per runtime:

| Operation, 27,125 records | Electron (ms) | Chrome (ms) |
| --- | ---: | ---: |
| Exact row count | 629 | 747 |
| Full-record search for the last row's late text | 1,029 | 1,050 |
| Grouped severity count | 997 | 1,376 |

All three scans completed with the expected totals/matches. They ran in real read workers. A subsequent ordinary simple-count session used a fourth read worker and made zero planner-model requests. The maximum observed ten-millisecond main-renderer heartbeat interval during the three scans was 12 ms in each runtime. These are single scan samples and timer observations, not p95 scan measurements or full-application frame-rate/peak-memory guarantees.

The retained warm context/prompt checks use thirty samples per fixture size and read zero full artifact bodies during ordinary sampled retrieval. For 27,125 artifacts, final Electron median/p95 was 100.6/116.7 ms; Chrome was 91.5/113.0 ms. Full-record searches intentionally read bounded bodies in the read worker.

Reproduce:

```sh
node scripts/diagnostics/collaborator-stage3/run.cjs chrome
node scripts/diagnostics/collaborator-stage3/run.cjs electron /path/to/Electron
```

The runner prints its disposable evidence directory. Logs: `/private/tmp/xhandle-stage3-electron-final.log` and `/private/tmp/xhandle-stage3-chrome.log`. Builds, native runs and the broad suite were serialized to limit local memory pressure.

## Remaining work

Stage 4 remains: correlate local preparation/planning with provider first-output/completion metrics, improve provider streaming and progress, and evaluate end-to-end response latency on representative questions without silently changing model/provider preferences.

Follow-up: Stage 4 now has a [local implementation and validation report](collaborator-stage4-implementation-2026-11-04.md). Its real-provider/customer-scale acceptance gates remain outstanding; this paragraph records the status at Stage 3 completion.

The read tools do not make every possible query exhaustive. Unsupported capabilities, ambiguous ownership, missing schemas, oversized legacy records and exceeded budgets remain explicit limitations. Numeric sums, semantic/vector search, automatic cross-run semantic reconciliation, complete-run diffs and persisted multi-turn result-page cursors are not introduced here. Explicit offsets and bounded within-plan result references are supported. More capability adapters and follow-up navigation can extend this interface without exposing the whole workspace to each answer request.

Before release, test the complete application with Offer's representative large project, real history/source sizes, active concurrent analysis and the selected AI provider. These synthetic checks do not reproduce the 634 MB workspace, all 5,500 real source files, 16 GiB hardware, peak process memory or customer network/model delays. This work is local and has not been made available as a desktop update.
