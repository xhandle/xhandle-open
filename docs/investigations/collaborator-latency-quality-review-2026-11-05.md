# Collaborator latency and answer-quality review

Reviewed November 5, 2026. Review only; no application code, provider settings, preview process, or release changed. Executed the scope in [the review prompt](../prompts/collaborator-latency-quality-review-2026-11-05.md).

There are further opportunities. The strongest are eliminating redundant AI round trips, reducing index work before targeted reads, and sending each piece of evidence once. These preserve the selected model and reasoning effort. Their actual end-to-end benefit still needs measurement against the same questions and source revisions.

## Evidence and limits

- Newly ran eight focused suites: **196 tests passed**, 11.497 seconds. Covered Collaborator view behavior, context routing, transport, overview retrieval, read sessions/cache, prompt budgets and context building. Output: `/private/tmp/xhandle-latency-quality-review-tests.log`.
- Reviewed existing native Electron and Chrome acceptance artifacts from the preceding implementation. Both exercise routing, scoped retrieval and format recovery with a **mock provider**, not live answer quality. Overview requests still show `context-turn → answer`; a detailed request shows `context-turn → read-plan → answer`. One overview deliberately exercises a format-repair request.
- Previous real-data, local-only measurements: overview preparation 4,207 ms initially, then 165 ms; after the reconciliation fix, a fresh process using an already-prepared catalog took 339 ms, then 140 ms. This is **not** full response latency or a pristine-import benchmark. Earlier broad indexing was still unfinished at 90 seconds; 11 index write transactions consumed approximately 56 seconds. See [the preceding investigation](collaborator-overview-latency-2026-11-05.md).
- No new live provider requests, private project content transfers, full build or stress test were performed. No current live provider percentile measurements are available from this review. Existing renderer timing reports are module-local and bounded; a repository search found their getter used in tests, not an operational diagnostic export.

## Ranked opportunities

### 1. Bypass a redundant routing call for an already-resolved overview

**Impact:** high for ordinary summaries; removes one serial provider request. **Evidence confidence:** high. **Complexity:** low to medium. **Correctness risk:** low only with conservative scope validation.

`XHandleCopilotView.jsx:7462` consults `quickWorkspaceReadPlan` before deciding whether to call the model. That planner does not recognize project overviews. The separate `projectOverviewScope` resolver runs later in `workspaceGraphContextBuilder.ts:361`, after the first AI request has already selected areas. The overview read session then correctly avoids a further read-planning call.

Move/reuse the validated overview decision before the initial model request. For an unambiguous request about one named/current project, obtain the same catalog and source evidence, then make the answer request directly. Normalize the application's plain-text paste envelope consistently so the equivalent pasted question takes the same route. Keep arbitrary attachment contents as untrusted evidence; do not reinterpret embedded document instructions as user scope.

Preserve the existing fallback for ambiguity, domain restrictions, selected records, follow-ups, comparisons, technical audits and questions that require more evidence. Do not replace semantic interpretation with an expanding list of greeting/keyword shortcuts. Expected savings are the duration of the removed routing request, not a measured number of seconds.

### 2. Plan narrow reads before expensive domain indexing

**Impact:** potentially largest for detailed questions after imports/edits. **Evidence confidence:** high for the ordering and historical index cost; new speedup unmeasured. **Complexity:** high. **Correctness risk:** medium to high.

`workspaceGraphContextBuilder.ts:368` awaits migration before candidate retrieval; `workspaceReadSession.js` may subsequently ask the model for a targeted read plan. `workspaceIndexScope.js` maps broad areas such as `cba` to several source families. A narrow question can therefore prepare much more data than its eventual read needs.

Use lightweight project/schema metadata to choose and validate a read plan first when sufficient. Prepare only its necessary source partitions, execute independent reads concurrently with a small concurrency limit, then answer. Where field discovery requires evidence, retain a bounded discovery step. Consider combining context routing and read planning into one validated structured request; this is a larger change than the overview bypass.

Reduce write amplification separately: `workspaceGraphMigrationCore.ts:954` copies full architecture row data into graph artifacts; `workspaceGraphRepository.ts:114` writes both bodies and projections; `workspaceGraphProjection.ts:41` creates up to 96 terms with both project and global entries. Prefer compact searchable metadata with revision-bound pointers to authoritative bodies, fetched on demand. Full records must remain available for technical questions. Preserve searchable fields/recall rather than merely reducing indexed terms.

Existing incremental root signatures are useful, but record completion markers are published near the end of the migration pass (`workspaceGraphMigrationCore.ts:1620`). Resume-safe completed-root checkpoints could avoid repeating work after cancellation. Require atomic publication of a root's records and its revision, safe deletion reconciliation, and incomplete coverage until the relevant domain is complete. Background indexing already exists; simply adding another background worker is not the proposed fix.

### 3. Remove duplicate evidence from the final model prompt

**Impact:** moderate, model/provider dependent. **Evidence confidence:** high for duplicate construction; token/latency savings unmeasured. **Complexity:** low to medium. **Correctness risk:** low with identity/revision-aware deduplication.

`renderCopilotContext` includes `ctx.diagnostics` in its sample (`XHandleCopilotView.jsx:1240` vicinity). The overview sample is in those diagnostics. `prepareWorkspaceReadEvidence` also serializes that same sample as an overview excerpt. Both rendered sections are concatenated into the final system message at `XHandleCopilotView.jsx:7599`. When both fit their budgets, the same functional sample can be sent twice. Catalog artifacts and citation metadata can also overlap. Aggregate-only context already has a useful compaction path; extend the same principle carefully to other read results.

Represent evidence once, keyed by source identity and revision, with citations and coverage attached. Keep instructions and diagnostic status separate from evidence bodies. Verify that deduplication retains the union of fields and citations; do not shorten the unique evidence or user question to claim a speed improvement. More useful unique evidence can then fit in the same budget.

### 4. Improve reuse of validated reads without caching stale answers

**Impact:** moderate for follow-ups/repeated lookups, little benefit for a first request. **Evidence confidence:** high. **Complexity:** medium. **Correctness risk:** medium.

`workspaceReadClient.ts` already caches complete results for 30 seconds, at most four entries/200,000 estimated bytes. Its key includes the full policy query. Any global source or graph revision change clears the cache, and a cache lookup occurs only after earlier routing/context preparation. Overview evidence bypasses this cache.

Cache bounded source evidence using validated operation, resolved project/domain/run/filter scope and relevant source revisions. Keep policy validation for each request. Reuse work for equivalent validated reads rather than identical natural-language phrasing. Project/domain-specific invalidation can preserve unrelated entries, but only after all save/import/delete/restore and cross-window change paths reliably publish scoped revisions. Do not simply remove the query or global invalidation checks. Retain a strict memory cap; do not cache whole analyses or finished AI answers as a shortcut.

### 5. Make ordinary conversation less dependent on JSON-format recovery

**Impact:** moderate when repair happens; normal-path benefit unknown. **Evidence confidence:** high for the repair path, unknown production frequency. **Complexity:** medium to high. **Correctness risk:** medium.

`contextOnDemand.js` asks every initial response, including general answers, to use an answer-or-read JSON envelope. `resolveContextResponse` can invoke a second model request to repair unsupported output. Streaming can show a valid answer before completion, but repair still adds a round trip when needed.

Evaluate validated native structured/tool responses where the selected provider supports them, retaining the portable protocol fallback. Never turn an invalid read request into an ungrounded answer or broaden scope to recover from a parse error. This needs provider-adapter coverage and actual repair-rate measurements before taking priority over items 1–3. Do not choose a different model to conceal protocol failures.

## Quality boundary in the current fast overview

`workspaceOverview.js` reads at most 24 functional relationships, truncates selected fields at 240 characters and, for ordinary Projects, omits functional data if the monolithic legacy store exceeds a 2 MiB parsing budget. It reports partial coverage, which is correct. The first 24 relationships are not necessarily representative of every subsystem, repository or analysis domain.

Do not make overviews faster by shrinking that sample further or apply this path to audits. A future comprehensive overview should use source-revision-bound subsystem/repository summaries or a representative evidence selection, with provenance and drill-down to underlying rows. A generated summary alone must not answer exact counts, absence claims, traceability or detailed verification questions. This is both a quality improvement and a possible reuse opportunity, not a proven latency win yet.

## Lower priorities and existing improvements to preserve

- **Streaming already works:** server provider branches emit streamed text; `chatTransport.js` passes deltas through; the view updates around every 160 ms. That interval is not an explanation for multi-minute waits. Measure first *visible answer*, not the first routing-JSON token.
- **Title generation already yields:** the view schedules titles only while idle and cancels on new work. It is not presently an awaited answer prerequisite.
- **Do not lower reasoning effort, swap the model, skip necessary reads, relax freshness or silently trim user content** as quality-neutral optimizations.
- A reusable read worker or fewer localStorage/thread parses may help small local costs, but current evidence does not establish these as dominant. Profile before adding lifecycle complexity.
- Reordering static instructions ahead of changing timestamps might enable provider prompt reuse where supported, but that benefit is provider-specific and unmeasured here. It should not be the foundation of a provider-neutral speed fix.
- Display genuine retrieval stages and provider waiting/receiving status. Do not fabricate reasoning activity or substitute a more animated loading indicator for faster answers.

## Recommended next implementation and acceptance gate

First implement **overview routing bypass plus evidence deduplication**, keeping the same evidence, selected model and effort. Then tackle **targeted technical-read preparation**, followed by revision-scoped reuse. Add a bounded numeric diagnostic export so slow real requests can be attributed without exporting customer content.

Measure local preparation, each provider call, first visible answer, completion, cache hits, input size and peak memory. Separate new imports, warm catalog/index, recent edits and follow-up turns. Report median and tail latency from repeated matched runs; do not compare a warm mock response to a cold live request.

Acceptance cases must include typed/pasted overview equivalence; general questions with storage blocked; named/current/ambiguous projects; domain-only and multi-project queries; detailed hazard/requirements/traceability questions; exact filtered counts and unique-functions versus relationship counts; attachment-only and mixed-source questions; fresh import/edit/delete/restore across windows; cancellation during indexing/provider streaming; and unsupported model output. Compare factual claims and citation resolution against fixed expected evidence, not response wording alone.

For the first change, require one answer-generation request for a validated ordinary overview, no full-domain indexing, no lost unique sample fields/citations, and unchanged scope/coverage behavior. For detailed reads, require complete coverage before exact-count/absence claims and successful cold/imported as well as warm cases in Chrome and Electron. The existing passing tests are a baseline, not a guarantee that the proposed changes cannot introduce regressions.
