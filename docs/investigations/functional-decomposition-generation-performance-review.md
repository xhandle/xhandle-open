# Functional-decomposition generation performance review

Date: 2026-10-09. Scope: read-only audit of both source-to-CSU generation and derived Functional model generation, for GitHub and local inputs. No production behavior was changed and no paid model requests were made.

## Conclusion

The implementation can plausibly take hours without a unusually large source tree. Source extraction serializes model requests, and Functional processing can make one request per caller even when each caller has only one relationship. Serial hierarchy allocation and repeated work after failures add latency. These are strong optimization opportunities without reducing coverage, but the customer's exact time distribution cannot be established without run telemetry.

The first changes should improve scheduling, request packing, and resumability while retaining the existing model, evidence, validation, and source coverage. Moving storage alone will not eliminate serialized network latency.

## Ranked findings

### 1. Source extraction serializes file and chunk requests

`src/components/generateFunctionalDecompositionFromGitHub.js:3197` iterates recovery passes and files, then awaits each chunk request at lines 3293–3348. There is no source-request worker pool. The apparent 80-file batch constant at line 384 is progress grouping, not parallel model processing. Each successful chunk also incurs a 120 ms sleep.

Chunks are 12,000 characters, reduced to 6,000 for files over 24,000 characters, with 400-character overlap (lines 757–795). Each chunk additionally receives repeated file symbols, verified Python call edges, imports, and repository path context (line 3302). Chunk size therefore does not bound the entire prompt.

For illustration, 200 serialized requests averaging 30 seconds consume 100 minutes before later phases. This is arithmetic, not a measured customer run. Both source adapters feed this shared processing path.

Source contents are read during manifest preparation (line 3086) and again during processing. Completed files are reread/reindexed before being skipped on recovery passes (line 3210). Bounded reuse can reduce this secondary cost; caching the entire repository in memory would conflict with earlier memory concerns.

### 2. Functional requests are partitioned by caller rather than filled across callers

`src/features/code-architecture-context/functionalModel.js:113` limits concurrency to four. Tasks are keyed by file and caller symbol (lines 124–136). Each caller's relationships are processed in serial batches of at most 12 (line 239). Thus 1,000 single-relationship callers produce 1,000 responsibility requests. Conversely, one large caller uses only one worker, regardless of available concurrency.

Evidence repeats up to 1,800 characters each of source, target, and action details per relationship (lines 143–153). Responses repeat semantic descriptions and rationales. Request and output budgets should drive packing, rather than caller count alone.

Caller descriptors are accumulated across chunks, so parallelizing all chunks without coordinating descriptor consistency would be unsafe. Multi-caller packing must preserve exact row identities and independently validated caller results.

### 3. Failed Functional processing loses expensive intermediate work

Functional annotations, consolidation replacements, and hierarchy allocations are local maps in `functionalModel.js` and `functionalHierarchy.js`. They have no durable stage checkpoint. Completed source extraction does have checkpoints; this finding specifically concerns derived Functional processing.

Manual generation invokes processing with `force: true` and saves only its completed result (`generateFunctionalDecompositionFromGitHub.js:3809–3828`). A hierarchy failure after successful annotation/consolidation can require those earlier requests again. Ready, unchanged models are reusable, and hierarchy-only processing is possible when supplied a ready intermediate model, but the normal failed full-processing path does not persist that intermediate.

Main generation also awaits Functional processing before publishing detailed architecture rows (lines 3434–3506). This prolongs the apparent wait for source results. Existing catch handling can preserve detailed results after a Functional failure; that does not provide granular Functional resume.

### 4. Recovery amplifies request count and latency

`functionalAnalysisPolicy.js` sets a 120-second request timeout and three source recovery passes. `functionalAnalysisResponse.js:104` supports splitting to depth five and up to 128 requests per original source chunk. Splits are processed sequentially. Source extraction deliberately uses adapter `attempts: 1`; its outer recovery engine owns retries.

Functional responsibility validation retries a batch and then splits it; timeout handling splits multi-row batches immediately. Consolidation and hierarchy have their own recovery paths. Hierarchy retries the original batch before splitting (`functionalHierarchy.js:107–112`). These preserve correctness but can spend substantial time repeatedly requesting already-understood material.

Functional requests use the adapter's default transport retries inside the 120-second wrapper. The backend allows 300 seconds by default (`server.js:43`). Different deadlines are not inherently a defect, but valid slow responses can be discarded by the shorter caller deadline. Simply extending timeouts would not solve throughput.

The server also has a 60-requests-per-minute limiter (`server.js:478`). Raising concurrency without pacing and handling provider limits can increase failures and total time.

### 5. Consolidation and hierarchy add a serial tail

Consolidation processes up to 32 functions per batch with at most four workers. Its adjacency payload includes associated links without a separate token-size budget (`functionalModel.js:264–341`). Highly connected scopes can therefore create large prompts.

Hierarchy allocation processes 24 functions per request sequentially (`functionalHierarchy.js:118`). It extends a shared allocation catalog after each response. This supports naming consistency and cannot safely be replaced by unrestricted parallel allocation. Existing explicit allocations are validated, yet all units enter allocation requests. Reusing verified, current allocations is worth investigating before scheduling new assignments.

Large architecture classification is not the same bottleneck: allocation/description model calls are skipped above 300 rows in `generateNestedArchitectureAllocationPlan` and `generateComponentDescriptions`, using existing deterministic fallback behavior. The optional 30-row narrative report batching is outside the main generation run.

### 6. Checkpoints repeatedly traverse growing state; failed-request timing is incomplete

`persistCheckpoint` at `generateFunctionalDecompositionFromGitHub.js:3185` includes the growing relationship ledger, file progress, and accumulated rows. It is called for completed sections, chunks, and files. `src/features/code-architecture-storage/chunkedRecord.js:57` creates a new staging traversal; serialization and hashes are recalculated across the supplied tree. Content-addressed blocks avoid rewriting identical physical data, so this is not a claim that every checkpoint rewrites every byte. Its actual share of elapsed time needs measurement.

`codeArchitectureMetrics.js` initializes `failedAiCallCount`, but no increment path was found. Adapter metrics primarily capture requests that return parseable transport envelopes. Manual Functional processing does not supply a metrics run, and the shared “Functional responsibility processing” label does not distinguish consolidation and hierarchy. Current metrics cannot reliably attribute the entire reported delay.

## Bounded measurements

Used the real `processFunctionalModel` scheduler with synthetic C++ relationships and a mock provider. Every input row was retained, model/hierarchy readiness was validated, and rerunning each completed model made zero additional requests. These fixtures measure scheduling and recovery, not semantic quality or real provider latency.

| Source relationships | Distinct callers | Responsibility requests | Consolidation requests | Hierarchy requests | Total requests | Peak responsibility concurrency |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1,000 | 1,000 | 32 | 42 | 1,074 | 4 |
| 1,000 | 100 | 100 | 4 | 5 | 109 | 4 |
| 1,000 | 1 | 84 | 0 | 1 | 85 | 1 |

Hierarchy peak concurrency was one throughout. Consolidation peak was four when present. Different caller distributions produce different functional units, so these are scheduler comparisons, not equivalent semantic outputs.

With 12 relationships under one caller and synthetic failures for batches larger than three:

- Timeout recovery made seven responsibility requests, including three failed parents, plus one hierarchy request.
- Invalid-output recovery made ten responsibility requests, including six failures, plus one hierarchy request.
- Both retained all 12 source rows and completed validation.

For the 1,000-caller fixture, idealized equal-duration scheduling requires approximately 250 responsibility waves, eight consolidation waves, and 42 hierarchy waves. At 10–30 seconds per request, that is roughly 50–150 minutes for the Functional stage alone. Real batch durations, provider limits, dependencies, and retries vary; this is an illustration, not a runtime forecast.

The temporary benchmark and existing Functional model, hierarchy, and source-response suites passed: four suites, 64 tests. The temporary benchmark was removed after the review. The test log is `/tmp/functional-performance-review.log`. No production build was needed for this documentation-only change.

## Prioritized implementation plan

1. **Measure stages and introduce bounded source concurrency.** Record queue time, request attempts, latency, input/output tokens, recovery reason, storage time, cache hits, and publication time separately. Start with a small worker pool and a shared request/token-rate budget. Merge results in deterministic source order and serialize checkpoint publication. Keep both source adapters on the same engine.
2. **Pack Functional work by input/output budget across callers.** Preserve caller ownership and exact relationship IDs within each request. Validate each returned member independently. For large callers, establish a consistent descriptor and safely schedule independent relationship partitions. Keep evidence and boundary validation intact; do not merely increase row limits without accounting for output size.
3. **Persist validated Functional stage results.** Checkpoint annotations, consolidation scopes, and hierarchy assignments using project/repository identity, content, model, prompt, schema, and dependency versions. Resume compatible completed work. Never mark incomplete models ready or publish them as authoritative downstream inputs. Preserve atomic publication and project isolation.
4. **Unify recovery budgets and reduce invalid output.** Use provider-supported structured responses where available, compact identity-based output, adaptive payload sizing, and coordinated timeouts. Retain validated members and retry only failed work where validation permits. Do not convert timeouts into fabricated success or silently omit relationships.
5. **Optimize hierarchy with a shared canonical plan.** Reuse verified current allocations, then allocate remaining units against a stable plan in bounded batches. Reconcile deterministically and retain ownership validation. Benchmark this against sequential catalog behavior before replacing it.
6. **Reduce checkpoint and repeated-read overhead.** Persist immutable completed units plus a small manifest, with a serialized writer and bounded source-content reuse. Coalesce cosmetic progress updates without sacrificing durable completed-work checkpoints. Treat publishing CSU earlier as a separate transactional change requiring explicit readiness boundaries.

Do not lower the model quality, omit selected source files, drop uncertain connections, weaken validators, or arbitrarily cap functional relationships to achieve a speed target.

## Acceptance criteria

- Measure before/after wall time, per-stage latency, attempts, token usage, storage time, and peak memory with the same model/provider and source snapshot. A proposed target is at least a threefold improvement on representative slow runs; this is a benchmark target, not an established result.
- Include Python, C++, Java, and JavaScript/TypeScript; many small callers, few large callers, highly connected scopes, and malformed/slow model responses. Include both GitHub and local snapshots.
- Preserve selected-source coverage, source identities, relationship membership, meaningful and uncertain boundaries, explicit hierarchy constraints, and supporting evidence. Have semantic abstraction quality independently reviewed; passing mock tests alone is insufficient.
- Verify abort/resume, reload, stale checkpoint invalidation, concurrent edits, project switching, and isolation between projects. No completed results may disappear or be replaced by another project's state.
- Verify downstream hazard analysis, governed guide-phrase applicability, requirements, and traceability inputs remain compatible. No downstream reasoning changes are required for these performance improvements.
- Compare real successful runs as well as recovery runs. Report improvements only after measurement; provider delays remain an external dependency.
