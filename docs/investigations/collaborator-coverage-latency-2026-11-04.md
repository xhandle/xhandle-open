# Collaborator coverage and latency audit — 2026-11-04

## Outcome and boundaries

Collaborator has a useful foundation (typed artifacts, source links, selected-row context, streaming, governed mutations and review prompts), but ordinary questions receive a small, lossy snapshot. Several defects actively remove relevant information. Changing models alone will not fix them.

This was a read-only application audit. No application source, personal workspace, installed desktop app, or provider settings were changed. No paid AI requests, commits, pushes or releases were performed. Existing unpublished Reports changes were preserved. Only this document and temporary diagnostic artifacts were created.

The recommended coding model was Astra High for a bounded audit, followed by Sol High for implementation. This run used the active session; it did not launch another model or delegate to subagents.

## Prompt executed

> Audit xHandle Collaborator read-only for workspace coverage, grounding correctness, and response latency. Trace the ordinary question path and specialized review/action paths. Inventory current authoritative stores, adapters, freshness, project/repository isolation, retrieval, truncation, citations and cancellation. Identify concrete defects with file/line evidence. Measure cold/warm local retrieval and renderer stalls using bounded synthetic data in a disposable profile; distinguish those measurements from live-provider and customer-scale performance. Reproduce suspected correctness failures. Run relevant existing regressions. Deliver prioritized findings, a phased implementation plan, and measurable acceptance criteria. Preserve Collaborator review prompts and current diagram/table/tab behavior; do not restore retired Review Center features. Do not edit application code, touch personal project data, make paid AI calls, commit, push, or release. Write only audit artifacts and temporary harnesses. Do not claim model switching or zero-regression guarantees.

## Highest-priority findings

### 1. Ordinary wording excludes Code-Based Architecture records (P1, reproduced)

`src/components/XHandleCopilotView.jsx:3662` defines the requirements scope as only `requirement`/`sysml_requirement`; the risk scope omits `code_architecture_hazard_row`. `buildScopedContext` at line 3684 filters already-retrieved candidates with these sets. The ordinary request invokes that filtering at line 7720.

Consequently, asking about “software requirements” or “hazards” while viewing a CBA project can discard the correct CBA results. Explicitly mentioning code architecture adds another scope and can make the same data visible. The function scope similarly omits CBA edges. Filtering after candidate selection also means out-of-scope candidates can consume the retrieval budget before being removed.

Both native browser tests reproduced a CBA hazard candidate and a CBA software-requirement candidate being reduced to zero under their natural question scopes. The 27,125-record benchmark retrieved 36 CBA hazard candidates, then the risk scope removed all 36.

Fix first: use a single capability/type registry and resolve scope before retrieval. Test natural wording in every workspace, including mixed requirements/hazard/function questions.

### 2. Refresh is a full migration on the question path (P1, measured)

`workspaceGraphContextBuilder.ts:329` awaits migration before reading context. `legacyWorkspaceGraphMigrator.ts:26` sets a 15-second cache, and `:1341` ignores the requested incremental mode and runs all source importers. The cache is in-memory and checks localStorage key lengths, not source revisions.

`readStoreRows` at `:215` retains all cursor results; code baselines/source records are hydrated, and historical hazard runs are fully hydrated. The migrator accumulates artifacts/relationships, then upserts everything. It also saves full hydrated runs in the graph (`:971`) and complete source-file records (`:840`). These can duplicate large analyses already stored elsewhere.

This is both latency and memory risk. A 5,000-row unchunked hazard fixture caused 5,000 artifact writes, 5,000 relationship writes and a copied run with approximately 5.85 million serialized characters. No crash or memory leak was observed or established; customer-sized chunked histories were not loaded.

Fix: bounded background indexing, per-source revision tracking and resumable batches. Store compact searchable metadata and authoritative record pointers, not full historical payload copies. Keep a defined synchronization boundary for “read my latest edit.” Avoid merely extending the cache timeout, which would worsen freshness.

### 3. Existing indexes are bypassed and full stores are read repeatedly (P1, measured)

`workspaceGraphRepository.ts:150` reads every artifact, filters afterward and sorts twice. `:168` reads every relationship. Runs, evidence, reviews and source files follow the same full-read pattern. The database already declares project/type/from/to indexes (`workspaceGraphDb.ts:120`).

`workspaceGraphContextBuilder.ts:355` loads artifacts, then `searchArtifacts` loads them again. A project-specific question therefore materializes other projects' records too, even though they may be filtered out afterward.

Fix: indexed queries with explicit result/byte limits, one retrieval pass, indexed relationship traversal, exact counts via database operations, and bounded body reads only for selected evidence. Do not parallelize several full-store reads as a substitute; that can increase peak memory.

### 4. Edits can be stale; deleted source artifacts can remain indefinitely (P1, reproduced)

`legacyWorkspaceGraphMigrator.ts:170` fingerprints key names and string lengths. Equal-length localStorage changes and IndexedDB-only writes do not invalidate the fresh cache. Both runtimes retained “Alpha” after changing the source to “Bravo” until a forced migration. An IndexedDB hazard edit was also skipped within the cache window.

More seriously, migration upserts but does not reconcile missing source records (`:1368`). Deleting the synthetic requirement from its source and forcing a full migration still left “Bravo” searchable. This is a source-item deletion reproduction, not a claim that the dedicated permanent-project-deletion cleanup is broken.

Fix: source generation/revision tracking and transactional reconciliation, including deletions. Preserve intentional removed-project retention and existing permanent-cleanup serialization. Distinguish retained history from current results instead of silently mixing them.

### 5. Search and prompt truncation lose evidence and citations (P1/P2, reproduced)

`workspaceGraphSearch.ts:4` searches only the first 1,200 characters of content/structured data (alongside titles/summaries/tags). It serializes structured data before slicing, so the limit does not bound serialization cost. Tokens of two characters or fewer and non-ASCII-only terms are discarded (`:19`). A unique term after character 1,300 returned no match; querying “AI” returned unrelated recent records.

`workspaceGraphContextBuilder.ts:146` further truncates artifact fields to 900 characters. `XHandleCopilotView.jsx:845` shortens CBA hazard structured snippets to 600 characters because the larger hazard allowance does not include that artifact type. `renderCopilotContext` at `:1166` takes 18 ordinary/36 hazard artifacts and then cuts the entire serialized sample at 14,000/32,000 characters. In the synthetic prompt, that final cut removed the citation section entirely. This is character slicing, not a token-aware evidence budget.

Fix: field-aware retrieval, exact identifiers/short terms, full-text indexing, record-level complete excerpts, reserved citation space and explicit coverage metadata. Query tools must support full-record retrieval and pagination; do not just increase all limits.

### 6. Some capabilities are not in the canonical context (P1 for the requested vision)

The new generated-report library and persisted V&V test cases were absent after forced migration in both runtimes. Ordinary question answering prefers the canonical graph over the legacy fallback, so having a sample elsewhere in App state is insufficient.

| Capability / data | Current coverage | Remaining gap |
| --- | --- | --- |
| Projects/folders | Project and folder adapters | Project count truncation; retained/current distinction |
| Functional decomposition | `xhandle.projectData.responseRows`, selected canvas context | No comprehensive persisted manual diagram/container adapter; selection is not the whole diagram |
| Project hazards and risks | Legacy/durable analysis and risk adapters | Lossy samples; drafts/current results need consistent precedence |
| CBA architecture | `xhandle/copilot_baseline`, repository metadata | Full hydration; function scope excludes CBA edge type; repository/snapshot boundaries need explicit query constraints |
| CBA hazards | Historical runs and summary-row adapters | Natural hazard scope exclusion; full history hydration; no explicit latest-run query |
| CBA software/system/subsystem requirements and designs | Assurance `artifactRows`, including chunk parents | Natural requirements scope exclusion; adapter creates containment links but does not build typed derivation links from every row reference |
| Safety remediation | Findings, proposals, decisions, verification, evidence | Broad reads and snippet limits |
| Design Management / SysML | Traceability requirements/notes and SysML model elements/relationships | Not equivalent to complete coverage of every module, baseline or attachment |
| Safety cases | Case/node/edge adapters and attachment records | No general binary-document extraction/search path through these adapters |
| Saved reports | Legacy Safety Issue reports | New `xhandle-generated-reports` library not indexed, including saved report versions/diagrams |
| System Test / V&V | Legacy App summary can contain test samples | `vnvArtifacts.tests/testCases` has no canonical migration adapter; reproduced |
| Collaborator reviews | Review-item store and specialized review workflows | Preserve these; retired Review Center UI is not required |
| Source files | Code index adapter and file snippets | Projectless source records can enter any project query; file lookup fallback reads legacy localStorage after sampling recent indexed files |
| Baselines, saved diagram layouts, chat/attachments | Separate stores and/or selected/history context | No general query adapters for `BaselinesDB`, persisted `diagram_positions`, all chat threads or attachment contents |

This table identifies inspected paths and missing adapters, not a claim that every branch of every capability has been exercised. Internal caches, credentials and recovery blobs should not automatically become searchable user content.

### 7. Ordinary answers cannot request more evidence (P1 architectural limitation)

`buildCollaboratorChatPayload` (`XHandleCopilotView.jsx:1374`) sends messages/settings, without workspace read-tool definitions. The ordinary answer path (`:7699`–`:7890`) retrieves a snapshot once, then streams prose. The standalone retrieval-corpus/document helpers have no production callers found outside their exports. Specialized review/generation/action routes exist, but do not provide a general-purpose read/query loop.

As a result, asking for all affected requirements, a cross-project comparison or exact counts cannot reliably be satisfied from the supplied sample. `resolveCollaboratorProjectBoundary` also normally chooses one visible project; cross-workspace requests depend on phrase matching (`:7194`).

Fix: a provider-compatible read-tool layer for search, exact record/section reads, counts/aggregations, relationship traversal and bounded comparisons. Keep mutations in the existing governed path. Resolve project/repository/run identity explicitly and validate returned source links. Add semantic search only after exact retrieval and source freshness are correct.

### 8. Counts and scope can misrepresent what was searched (P2, reproduced/static)

`workspaceGraphContextBuilder.ts:352` caps projects before setting `projectCount` and truncation totals. With 31 projects and the ordinary 5,000 budget, it reported 13 and `truncated:false`. Other totals describe selected or partially bounded data, not necessarily the entire workspace.

`matchesProject` (`workspaceGraphRepository.ts:32`) deliberately admits records with no project ID. Source indexing frequently assigns an empty project ID (`legacyWorkspaceGraphMigrator.ts:852`). Repository/snapshot filters are not part of `ArtifactFilters`. This is a scoping risk, not proof of cross-user data exposure; the workspace is local.

Fix: separate true totals, matched totals and evidence returned; mark partial scans. Treat unknown ownership explicitly rather than assuming project relevance.

### 9. Latency attribution and cancellation need completion (P2)

Existing server metrics already capture request size, model/effort, time to first output and completion (`server/aiRequestMetrics.js:46`). Reuse them. The frontend payload does not label the Collaborator workflow, and local migration/retrieval/prompt stages are not correlated with that server request ID.

OpenAI and Claude have streaming paths. Gemini currently awaits its entire completion and only then emits SSE (`server.js:2386`), so apparent streaming cannot improve its first-answer latency. The customer's current provider/effort was not read, so this is a conditional limitation, not an attribution of their delay.

Additional costs: App constructs its synchronous legacy fallback context during renders (`App.js:6717`, `:16361`, `:17302`); chat storage parses/serializes bounded but potentially megabyte-sized thread history; new-thread titling makes an independent AI request. The titling call is not serially awaited by the ordinary answer path. Diagram generation can intentionally perform preliminary/repair calls; ordinary questions do not always do so.

The graph context/migration functions do not accept the prompt's AbortSignal. Stop is checked after retrieval, so heavy local work can continue after cancellation.

## Measurements

Actual native IndexedDB, isolated Electron 45 and headless Chrome 156, separate disposable profiles on the local M2/8 GiB Mac. No application workspace was opened. HTTP/HTTPS requests were blocked. The harness bundled the actual graph modules and extracted unchanged scope/prompt functions from the current component. It wrapped read methods for timing/counting; it did not replace storage with mocks.

Warm cases used two synthetic projects, alternating artifact ownership, 2,048 padding characters per artifact, one relationship per artifact, and a single-project hazard query. Three samples per size; migration was primed and verified skipped. The graph contained no source/review/evidence history in these cases.

| Total indexed artifacts | Electron median (range), ms | Chrome median (range), ms | Artifact records read per request | Candidates before scope filtering |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 20.4 (18.8–31.4) | 20.1 (19.9–35.4) | 2,000 | 36 |
| 10,000 | 184.9 (154.7–214.6) | 173.8 (161.7–297.0) | 20,000 | 36 |
| 27,125 | 480.7 (408.0–626.9) | 474.8 (429.2–741.4) | 54,250 | 36 |

The largest warm case also read all 27,125 relationships. Maximum observed 10-ms-timer gaps were 55.5 ms in Electron and 58.9 ms in Chrome. These include scheduling/GC and are not a formal long-task or frame-rate measurement.

Cold source migration used one unchunked legacy hazard run with 5,000 rows and approximately 1 KiB of evidence text per row: 1,066 ms total in Electron (899 ms migration), 1,688 ms in Chrome (1,468 ms migration). Maximum timer gaps were 82.2/73.6 ms. This was a single cold sample per runtime, not a percentile distribution. The hydrated graph run payload alone serialized to 5,854,456 characters before the prompt formatter removed its body.

Heap-before/after samples are recorded, but GC timing and fixture lifetime make them unsuitable as peak-memory or leak evidence. These tests do not reproduce Offer's 634 MB project, all historical runs, UI interaction under active analysis, or provider/network latency. They establish local avoidable work and correctness failures; they cannot explain the entirety of the reported slowness or predict a speedup multiplier.

## Verification and reproducibility

- 121 existing tests passed across six suites: Collaborator component helpers, graph migration, context builder, retrieval, active selection and Collaborator review store.
- 11 observed-behavior reproductions confirmed separately in Electron and Chrome: CBA hazard exclusion, CBA requirement exclusion, late-field search miss, short-token fallback, equal-length stale edit, retained deleted artifact, missing generated report, missing V&V test, incorrect project count, clipped citation section and stale IndexedDB edit.
- Passing existing tests does not validate the missing scenarios; these findings need permanent regression cases when implemented.
- Initial Electron harness invocation inherited Node-only mode; it failed before creating a test window. Clearing that flag and using Electron's built-in module resolved harness setup. Final native runs completed successfully.
- Audit assets: `/private/tmp/xhandle-collaborator-audit-2026-11-04/` contains `prompt.md`, `build.cjs`, `entry.js`, `extracted.js`, `main.cjs`, `chrome.cjs`, `results.json`, `chrome-results.json`, runtime logs and `regressions.log`. Temporary profiles contain synthetic data only.

## Recommended implementation sequence

1. **Correctness and coverage first.** Fix capability/type scopes and query-before-limit ordering; add generated report and V&V adapters; repair counts, preserve complete citation metadata, and reproduce edits/deletions against real IndexedDB. Establish source generation and ownership contracts before expanding access. Do not delete intentional retained history.
2. **Remove per-question full migration and broad reads.** Background, bounded indexing with durable revisions, cancellation, restart recovery and source-specific reconciliation; query existing indexes; fetch bodies lazily; keep short-question memory independent of total workspace payload. Preserve the existing permanent cleanup lock and backup/import behavior.
3. **Add targeted read tools.** Search across explicitly resolved scopes, read exact record/section, query/aggregate complete datasets, traverse stored derivation links, compare versions and return source links. Use bounded result pages and a total request/time/token budget. Clearly distinguish missing, unindexed, inaccessible, stale and not-yet-searched data. Treat retrieved document text as data, never executable instructions.
4. **Tune response latency with evidence.** Correlate local stages with existing server metrics, show useful progress immediately, enable genuine provider streaming where supported, make title generation optional/background, cache by source revision and benchmark runtime models on the same question set. Preserve user-selected provider and effort. Avoid a mandatory extra model round trip for straightforward exact queries.

Start with phase 1 as a reviewable change, then phase 2. Do not attempt all of this as one large rewrite. Sol High is a reasonable implementation choice; reserve a bounded Astra High review for architecture or difficult failures. This does not choose the customer-facing Collaborator model.

## Acceptance gates for implementation

- Every supported capability has registered sources and tests for lookup, edit, import, deletion, restore and project/repository/run isolation. Unsupported capabilities are identified explicitly.
- Natural hazard/requirement/function questions work in both Projects and CBA without requiring users to name internal categories.
- Exact totals come from complete queries, not sampled context. Old/new run comparisons identify versions and do not silently mix current data with retained history.
- Stable source links reach the correct row/report section/diagram item; evidence truncation never removes its provenance.
- Read-your-writes after successful save/import; deleted current records disappear from current queries. Failed/incomplete indexing retains honest partial-state diagnostics.
- Query cancellation stops local work and provider calls; stale results cannot replace a newer question/project selection.
- Suggested initial targets, to validate rather than promise: warm local preparation p95 under 200 ms on the 27,125-record fixture; no workspace-wide payload hydration for a focused question; no repeated indexing-caused main-thread tasks over 50 ms; responsiveness measured while switching tabs and scrolling. Gather at least 30 repeated samples and separate cold indexing from query latency.
- Add a bounded large-fixture benchmark matching 5,500 source files, 27,125 hazards, requirements and several historical runs, on 8 GiB and 16 GiB machines. Record peak renderer memory and recovery, not just post-operation heap.
- Evaluate answer correctness, coverage, citation resolution, first useful output and total latency across representative questions and available providers. Include facts near the end of long records, short IDs, multi-project comparisons, exact counts and ambiguous references.
- Keep Collaborator review prompts, review-session persistence, governed mutation/undo behavior, continuous tables and diagram navigation unchanged. Do not restore retired Review Center/tray/badges.
- Release only after these targeted regressions and browser/desktop acceptance checks pass. No performance or zero-regression guarantee is supported by this audit alone.
