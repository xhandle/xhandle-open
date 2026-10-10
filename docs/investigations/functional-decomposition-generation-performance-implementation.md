# Functional-decomposition performance implementation

Date: 2026-10-09

Implemented the [implementation prompt](../codex-prompts/implement-functional-decomposition-generation-performance.md) following the generation-performance audit. Scope is Code-Based Architecture's shared GitHub/local source pipeline and derived Functional model. No customer analysis or paid model calls were run.

## Behavior changes

- Source verification and file analysis use four bounded workers. File results are assembled in selected-file order, rather than completion order. A fatal error or cancellation stops dispatch and drains workers before returning. Per-file section recovery and grounding remain in place.
- Functional processing can queue 32 logical callers while at most four network requests execute. Independent small callers share a prompt containing the same semantic instructions and separate caller identities/evidence. Packing limits are 12 relationships, a 48,000-character allowance, and an estimated 5,600 output tokens (including a descriptor allowance per caller). This typically fits eight one-relationship callers. Existing 7,000-token output capacity and the selected model are unchanged. The estimates are safeguards, not guarantees against truncation.
- Oversized responsibility prompts are split before requesting a response; oversized consolidation groups are likewise subdivided. Evidence is preserved. Oversized single-member cases still use existing validation/recovery rather than discarding evidence.
- Each caller response passes the existing semantic and membership validation. Missing or duplicate caller results retry separately while valid siblings proceed. Invalid whole envelopes use existing recovery; a response with unknown caller identity is not trusted.
- Successfully validated responsibility, consolidation, and hierarchy responses are checkpointed separately. The key includes project/repository scope, input revision, exact prompt, model/settings, and cache version. A cache hit still passes the semantic validator. A later-stage failure can resume without repeating those successful requests.
- Checkpoints are disabled when provider/model identity is unspecified. Changed source inputs, settings, or project scope cannot reuse another revision's cache. Explicit regeneration of an already complete model bypasses reuse. Cache read/write failures are recorded in metrics and do not pretend that work was saved; final architecture publication retains its existing persistence safeguards.
- Explicit, complete, nonconflicting endpoint hierarchy allocations are reused without asking the model to restate them. New/ambiguous allocations retain sequential catalog reconciliation. Heuristic architecture groups are not treated as explicit allocations.
- API request starts, including transport retries, are paced 1.1 seconds apart across this adapter. Retry-After is honored up to the existing bounded recovery window. Parallel requests may overlap; this prevents bursts rather than serializing completion.
- Source checkpoint writes are serialized. Completed file results retain immutable shared references; only changing in-flight progress/statistics are copied for a stable write snapshot. Legacy checkpoints retain their existing rows during subsequent resume cycles.
- Metrics include transport attempts, pacing wait, failed calls, stage-specific Functional labels, cache hits, and checkpoint failures. Manual Functional generation now also saves run metrics. New checkpoints use project-owned storage keys and human-readable Storage category labels.

## Files and responsibilities

- `src/features/code-architecture-context/functionalWorkScheduler.js`: bounded ordered worker pool, cancellation/draining, serialized writer, request-start pacing.
- `src/features/code-architecture-context/functionalRequestRuntime.js`: request packing, independent caller response dispatch, validated durable response cache.
- `src/features/code-architecture-context/functionalModel.js`: batching metadata, validation acceptance hooks, oversized-prompt splitting, logical worker scheduling.
- `src/features/code-architecture-context/functionalHierarchy.js`: validated hierarchy checkpoints and explicit-allocation reuse.
- `src/components/generateFunctionalDecompositionFromGitHub.js`: shared source scheduling, stable checkpoint snapshots, runtime integration for automatic/manual Functional processing, model guard, metrics and pacing.
- `src/components/storageCategoryItems.js`: readable labels for Functional processing checkpoints. Existing project deletion ownership rules already cover their scoped keys; a regression test verifies this.

## Validation and measured improvement

The persistent regression fixture in `functionalPerformance.test.js` uses the real Functional processor with deterministic mock responses and mixed Python/C++/Java/TypeScript caller paths.

For 120 one-relationship callers:

| Measurement | Previous request scheduling | Packed scheduling |
| --- | --- | --- |
| Model requests across all Functional stages | 129 | 24 |
| Peak network concurrency | bounded by existing pool | 4 |
| Validated output | baseline | identical to baseline |

This is **81% fewer requests**, or 5.4 times fewer requests. It is not a claim of a 5.4-times faster live run. Provider latency, prompt sizes, rate limits, and real semantic outputs vary.

Additional regressions cover retained meaningful/uncertain interactions, analyst eligibility, exact source rows, input/output packing limits, partial caller failure, invalid-output rejection, resumption after hierarchy failure, zero new requests on a compatible cached rerun, project/revision/model isolation, storage failure, worker ordering, fatal failure draining, cancellation, serialized writes, and pacing. The broader context suite also covers source inventories, domain neutrality, imports, coverage, source reconciliation, and project isolation.

Validation command:

```sh
CI=true npm test -- --watchAll=false --runInBand src/features/code-architecture-context src/features/code-architecture-assurance/codeArchitectureIsolation src/components/generateFunctionalDecompositionFromGitHub.test.js src/components/permanentlyDeleteStoredProject.test.js src/components/storageCategoryItems.test.js
```

Result: **22 suites / 219 tests passed**. `CI=false npm run build` passed with repository lint/Browserslist warnings. The final component source was also checked against the generated production source map. Logs: `/tmp/functional-performance-final-tests.log` and `/tmp/functional-performance-build.log`.

## Preserved contracts and limits

Selected source coverage, model choice, semantic instructions, grounding, membership checks, meaningful/uncertain boundary protection, trace identities, and atomic publication remain enforced. No hazard reasoning, governed guide-phrase applicability, requirements derivation, or downstream schemas were changed.

This is the initial throughput/resume implementation, not proof that every repository will meet the proposed threefold wall-time target. Real-provider semantic quality and total runtime need a representative before/after comparison. Large single callers still process their dependent chunks sequentially. New hierarchy assignments remain sequential to preserve catalog consistency. Source checkpoints still traverse accumulated state, though they no longer race and the new Functional checkpoints are independent records. Input-size/output allowances are conservative estimates rather than provider-specific tokenization. Failed explicit regeneration of an already complete model continues to request fresh work on the next explicit regeneration.

No source sampling, quality downgrade, permissive validation, or silent partial-publication path was introduced. Browser storage still has finite capacity; new checkpoints are project-owned data and can be removed through existing storage/project deletion flows.
