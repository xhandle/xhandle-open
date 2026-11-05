# Collaborator broad retrieval latency

Executed [the broad-latency task](../prompts/collaborator-broad-latency-2026-11-04.md) after the user clarified that the greeting was only an example. The user identified “Retrieving the most relevant project and architecture context” as the longest stage. This is local preparation before the answer request; changing AI models does not address that wait.

## Findings

The original foreground path awaited a workspace-wide indexing pass, including unrelated large hazard histories and source indexes. The acceptance workload had already demonstrated cold passes of 192–236 seconds. Further instrumentation attributed most cost to hazard mirror/index writes, then source indexing and assurance indexing. Cleanup and a redundant compact-projection rebuild added additional work.

An initial bulk hazard-reader experiment alone did not establish a speed improvement: one full run exceeded the 300-second worker deadline. A later full run with key-page cleanup and projection initialization passed but still took about 270 seconds, including 204 seconds in hazard/feature indexing, 40 seconds in source indexing and 25 seconds in assurance. These observations are retained as evidence that micro-optimizations alone do not resolve foreground blocking. Host load differed; they are not a controlled before/after comparison.

## Implementation

- Deterministic single-domain lookups (explicit software/system/subsystem requirements, report lists/counts, project lists/counts, exact source-file lookups) prepare their required source domains. Other questions retain complete retrieval. CBA project/repository metadata is indexed with the project catalog, independently of decomposition rows.
- Scoped preparation carries explicit types/deferred-domain diagnostics, suppresses whole-workspace totals and unrelated samples, and restricts subsequent read evidence to the prepared domain. A partial cached pass cannot satisfy a broader request. Existing failure/revision checks downgrade exact counts when appropriate.
- Background indexing checkpoints individual domains and pauses during foreground questions. Cancellation releases its worker/lock; it resumes afterward. Project-data and verification writers sharing a source are reconciled together with their requirement dependencies. Permanent cleanup remains serialized.
- Source mirrors/artifacts use bounded batches (128/256), reducing per-file transaction overhead. Complete-refresh cleanup scans key pages and inspects obsolete candidates. New empty projections are marked ready in the same transaction as canonical/index writes, avoiding a second full-body rebuild. Legacy nonempty projections still repair.
- Bulk hazard indexing validates the row/table coordinate indexes once per run, verifies each loaded page digest, checks committed revisions during traversal and root identity at completion, and retains an eight-page cache and bounded row assembly. Interactive hazard-table behavior is unchanged.
- General definitions bypass saved-data retrieval; ordinary unfiltered lists use deterministic read plans; verified aggregate answers omit redundant sampled bodies. Provider, model and reasoning-effort preferences are preserved.
- Backup notifications for attachment previews, recovery mirrors and source-SHA metadata no longer invalidate the entire graph: migration does not consume those stores. Actual authoritative localStorage changes are still compared exactly, and canonical IndexedDB notifications still invalidate their source domains.

## Validation

Final combined regression run: **448 passed across 39 suites**, with one existing optional 520 MiB checksum test skipped. This includes graph retrieval/synchronization, scoped reads, checksum and revision failures, cancellation/worker handoff, shared-source cleanup, permanent deletion, Collaborator review/actions, Reports, archive/backup behavior and provider preferences. Follow-up runs passed 10 scope checks and 116 routing/component checks, verifying that prepared-domain intersections cannot broaden capability filters and that named-function/custom-ID questions retain saved-data retrieval. Focused lint passed; the production build passed with existing warnings.

The optimized App journeys passed in Electron with synthetic Haiku 5.5/medium preferences and Chrome with synthetic Gemini 3.6 Flash/medium preferences. They cover explanations during an unrelated held indexing lock, an ordinary report list without a planner request, complete count evidence, source navigation, idle titles, Stop/thread isolation and persistent report deletion. The mock answer takes 350 ms; these are application regression checks, not provider speed measurements. One earlier Chrome fixture used the unsupported identifier `gemini-test` while demanding an effort header; the app correctly omitted that unsupported setting. Rerunning with a supported identifier passed. No production preference handling was weakened to satisfy the fixture.

Final large Electron workload: 5,500 source records (approximately 600 MiB uncompressed synthetic text), 5,500 software requirements, 27,125 current hazards and 10,000 historical hazards. Actual IndexedDB and workers; Apple M2 with 8 GiB RAM.

| Measurement | Observation |
| --- | ---: |
| First focused software-requirements context, empty graph | 13,696 ms |
| Complete software-requirements count (5,500) | 300 ms |
| Focused context after interrupting background hazard indexing | 158 ms |
| Remaining complete cold index | 125,693 ms |
| Complete current hazard count (27,125) | 2,077 ms |
| Complete history-inclusive count (37,125) | 1,801 ms |
| Deep excerpt from final source file | 18 ms |
| Five subsequent broad hazard-context preparations | 549–757 ms |

The focused lookup asserted that hazard/source indexing was deferred. The background job was actually interrupted, then the full pass completed with all expected counts and final-file evidence. No renderer crash occurred. Sampled renderer-process working-set peak was about 328 MiB (includes worker heaps); the main-window JS-heap peak was about 64 MiB and does not include those workers. The largest sampled 50 ms heartbeat interval was 62.9 ms. Peaks include fixture setup and are not a leak test or capacity guarantee. Source content compresses in browser storage and is not equivalent to the customer's archive.

The shared changes have not been packaged or published to the installed Desktop app. Native fixtures use disposable profiles and local mocked responses; no customer data or paid AI calls are used.

Evidence logs in this local session:

- `/private/tmp/xhandle-broad-latency-final-regressions.log`
- `/private/tmp/xhandle-broad-latency-scope-followup.log`
- `/private/tmp/xhandle-broad-latency-scoped-large.log`
- `/private/tmp/xhandle-broad-latency-electron-verified.log`
- `/private/tmp/xhandle-broad-latency-chrome-verified.log`

Reproduce with the existing acceptance `full-app.cjs` and `large.cjs` drivers. `XHANDLE_ACCEPTANCE_SMALL=1` selects a smaller profiling fixture; it must not be represented as the 5,500-file workload. Intermediate small runs ranged from roughly 7–14 seconds for full indexing under varying host load; they are not a controlled performance comparison.

## Limits

Full initial indexing remains real work for broad questions and large hazard datasets. These changes remove unrelated domains from supported focused lookups, not the need to prepare evidence that an answer actually requires. Real-provider response latency and the customer's project have not been measured. No claim that every prompt is now instant or that regressions are impossible is warranted.
