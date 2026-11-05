# Collaborator correctness implementation — 2026-11-04

Implemented the first phase of the coverage/latency audit. The executed task is recorded in `docs/prompts/collaborator-correctness-2026-11-04.md`. Changes are local and unpublished; unrelated pending Reports work was retained.

## Behavior changed

- One shared capability/type registry covers Project and CBA hazards, requirements, functions, saved reports and System Test data. Both the context builder and final scope filter use it. Scope is applied before candidate limits, including action-planning context.
- Search reuses the already loaded, scoped artifact rows instead of reading the artifact store a second time.
- Source snapshots compare actual localStorage values, so equal-length edits invalidate the cache. Existing committed-save notifications invalidate IndexedDB context, and a lightweight BroadcastChannel propagates invalidation between open windows. Internal graph diagnostics and unrelated UI broadcasts do not invalidate the cache.
- A save during migration causes at most one fresh retry. Failed or continuously changing scans do not become a valid cache entry. Migration diagnostics and prompt coverage mark incomplete evidence.
- After successful source reads, reconciliation removes missing graph mirrors and auxiliary records. Blocked, timed-out, malformed or failed sources preserve their prior mirrors. This operates on the graph only and keeps the existing permanent-cleanup serialization. Workspace project and folder identities remain retained for Storage restore; manual graph records from unmanaged sources are preserved.
- Generated Reports are indexed by immutable library version, with draft status and source identifiers. Report bodies are read individually and diagram images are excluded from graph copies. Deletion/tombstones remove the graph version after the next source refresh.
- System Test documents and their cases are indexed. Legacy project V&V cases are supported when there is no authoritative document reference. Project-cache copies cannot duplicate or resurrect deleted documents. Verification links are created only when a matching requirement artifact exists in the same project.
- Project totals are computed before list truncation. Prompt fitting retains whole evidence records with their citation metadata, valid JSON and an explicit omitted-record count, within the existing 14,000/32,000-character sample budgets.
- Report source links open the requested saved version. System Test source links open the matching document and test with ownership checks, stale-link messages, and a consumed navigation request. Existing table/diagram interaction is not modified by this phase.

## Validation

186 tests passed across 12 targeted suites. Coverage includes:

- Same-length source edits, source deletion and relationship cleanup.
- Failed-source preservation and recovery.
- Retained project identities and unmanaged graph records.
- Report versions, image exclusion, draft status and tombstone deletion.
- Committed IndexedDB updates/deletions.
- Current System Test documents, legacy cases and duplicate prevention.
- Scope-before-limit behavior and uncapped project counts.
- Internal-notification filtering and a save arriving during indexing.
- Natural CBA hazard/requirement/function queries and report/test queries.
- Prompt budgets with complete provenance.
- Specific report/test source navigation and stale links.
- Existing Collaborator review persistence, active selection, mutation/undo and permanent-project cleanup regressions.

Test log: `/private/tmp/xhandle-collaborator-phase1-regressions.log`.

Final optimized production build passed with existing warnings: `/private/tmp/xhandle-collaborator-phase1-final-build.log`.

Focused lint had no errors and two pre-existing Collaborator warnings: `/private/tmp/xhandle-collaborator-phase1-final-lint.log`. `git diff --check` passed.

## Native runtime checks

Actual IndexedDB in Electron 45 and headless Chrome 156, with separate fresh temporary profiles, synthetic data and HTTP/HTTPS blocked. No customer workspace, installed app data, paid provider call or model preference was used.

Nine runtime check groups passed in each runtime: source edits/deletions, failed-source preservation, report versions/deletion without images, System Test indexing, CBA scope, project totals, notified IndexedDB changes and bounded prompt citations at increasing sizes.

Final warm measurements, three samples per size, include context preparation plus scope/prompt formatting:

| Total graph artifacts | Electron median (range), ms | Chrome median (range), ms | Artifact-store reads per question |
| ---: | ---: | ---: | ---: |
| 1,000 | 14.4 (13.6–16.9) | 13.6 (13.5–16.0) | 1 |
| 10,000 | 94.4 (93.2–124.8) | 96.4 (95.6–132.1) | 1 |
| 27,125 | 279.5 (254.6–284.4) | 274.1 (258.0–286.6) | 1 |

The audit baseline medians for the largest fixture were 480.7 ms in Electron and 474.8 ms in Chrome, with two artifact-store reads. These are small synthetic samples, not p95 values or a prediction of complete AI response latency. The baseline omitted final prompt formatting; this comparison establishes reduced local work, not a precise speedup factor.

A separate cold Electron check with one 5,000-row unchunked hazard run completed in 1,142 ms, including 1,026 ms migration/reconciliation, with no indexing errors. The earlier baseline was 1,066 ms total in a single sample. Cold work remains broadly similar in this small fixture and remains a scaling concern. No claim is made about peak memory, leaks, very large chunked histories or customer-sized concurrent analysis.

Runtime harnesses and JSON evidence: `/private/tmp/xhandle-collaborator-phase1-runtime/` and `/private/tmp/xhandle-collaborator-phase1-cold/`. Profiles contain synthetic data only.

## Work still required

Stage 2 has since been implemented locally; see [the Stage 2 report](collaborator-stage2-implementation-2026-11-04.md). The list below records the state at the end of Stage 1.

This phase does not make Collaborator capable of exhaustively querying all xHandle datasets. Ordinary answers still consume a bounded snapshot.

1. Replace periodic full migration and broad graph reads with bounded background indexing, durable source revisions, indexed queries and lazy body loading. Current reconciliation adds a cursor pass on migration; the warm path skips it.
2. Add targeted read/search/aggregation/relationship/version tools so complete-dataset questions do not depend on context samples.
3. Expand retrieval across remaining capability stores, improve short-term/non-ASCII/full-record search, and enforce explicit repository/run/unknown-ownership boundaries.
4. Correlate frontend preparation timings with provider first-token/completion metrics and evaluate actual runtime model/provider behavior. No end-to-end provider latency was measured here.
5. Validate larger histories and active-analysis workloads on 8 GiB/16 GiB machines, including peak renderer memory and cancellation.

Freshness within the cache window uses supported app-save notifications plus exact localStorage snapshots. Raw external IndexedDB writes which bypass those notifications still require a forced refresh or the existing 15-second cache expiry. This phase deliberately does not patch global IndexedDB prototypes or install a new storage schema. Broader durable change tracking belongs in the next phase.

Collaborator review prompts and governed mutations remain supported. Retired Review Center/tray/badges were not restored. Nothing was committed, pushed, or made available as a desktop update.
