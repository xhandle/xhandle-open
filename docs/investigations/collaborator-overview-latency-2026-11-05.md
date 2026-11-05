# Project overview latency investigation

The reported Electron preview request was a 27-byte pasted text attachment: “summarize the vulnerableapp”. The UI showed 5m24s at “Finding relevant saved information”. Reading the existing conversation confirmed that the eventual answer was an ordinary project overview.

## Observed cause

The context request selected several analysis domains. The context builder awaited their full derived search-index migration before querying. On the disposable copy of the preview's storage, 11 artifact/index write transactions consumed about 56 seconds; source reads were much cheaper. A migration can run for five minutes before its worker deadline. This is inappropriate preparation for a short overview.

An initial improvement caches the incomplete legacy-projection marker, avoiding repeated whole-store counts on each write batch. It is covered by a regression test preserving subsequent projection repair. Measurement showed that change alone did **not** resolve the indexing delay.

## Change

Recognize narrowly scoped project overview requests after project resolution. Prepare only project/repository catalog records, and read up to 24 functional relationships directly from the selected project's source. The result excludes embedded code/source evidence and limits text fields. Code architecture roots are sought by project key, skipping checkpoint/chunk key ranges. Ordinary Projects legacy data has a 2 MiB parsing budget. Source sampling has cancellation and a five-second budget; unavailable samples are identified rather than invented.

The evidence is explicitly a partial overview, not a complete review of requirements, hazards, tests, or source code. The read session returns that evidence without another AI planning call or a full index read. Detailed questions, counts, comparisons and reviews retain their governed read path. The provider and model settings are unchanged.

## Measurements

Disposable Electron profile cloned from the preview, with all HTTP(S) blocked; real VulnerableApp data, no AI call:

- First overview context preparation: 4,207 ms (catalog migration/reconciliation 3,906 ms).
- Second overview context preparation: 165 ms.
- Previous broader migration: still incomplete after a 90-second measurement; artifact-index writes dominated.

These are local preparation timings, not end-to-end live AI response timings. Complex analysis-domain index construction remains a separate performance limitation.

After skipping reconciliation entirely when no sources need pruning, a fresh Electron process with the already-prepared catalog measured 339 ms, followed by 140 ms. Both returned 24 saved architecture sample rows from the correct project (8,875 characters of bounded overview evidence). These are not measurements of a newly imported workspace with an unprepared catalog.

## Validation

- 284 tests passed across 20 suites. Two integration tests exceeded their default five-second deadlines during a concurrent diagnostic run; both passed sequentially, and the final complete test run passed in 13.6 seconds.
- Optimized production build succeeded (existing lint warnings).
- Actual optimized app: 14 acceptance scenarios passed in Electron and 14 in Chrome, including typed/pasted overviews, detailed technical questions, general questions, exact counts, cancellation and format recovery. No runtime errors. These use a local mock AI provider, not live answer-quality or provider-latency tests.
- Typed/pasted summaries included source architecture evidence, excluded unrelated project evidence, and made no AI read-planning call.
- `git diff --check` passed.
- Preview: `0.2.14-preview.20261105.4`, renderer `/private/tmp/xhandle-overview-build`, same isolated development profile and AI configuration. No release published.
