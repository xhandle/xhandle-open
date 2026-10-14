# Code architecture hazard runtime target

Executed prompt: `docs/codex-prompts/hazard-runtime-target.md`.

## Findings and implementation

The active compact STPA/HARA/FHA pipeline independently reviews every new assessment. Valid JSON with semantic findings previously entered the same recursive halving path used for truncated output. Repeated findings multiplied generation/review requests and reduced corrective work to singletons. Correction prompts contained issue text but not the rejected assessment. These are confirmed code paths; no live customer run trace was available to attribute its full reported 20x slowdown.

`fastHazardPipeline.js` now keeps rejected assessments in batches, passes issues and prior content together, and permits three parsed assessment attempts per row. Only malformed/truncated output triggers capacity splitting; corrective prompts still split if their complete evidence and previous assessments exceed the input budget. Approved rows are checkpointed and excluded from correction. Persistent failures remain recoverable and are never published as successful assessments. Previous answers are released after acceptance.

Generation now uses at most 16 rows per 14,000-output-token request instead of 32, reserving more room for the expanded narratives. This is a conservative row ceiling, not an exact tokenizer prediction: truncation fallback remains necessary. The shared request limit increases from three to eight, with twelve workers and at most 192 source rows in flight. Fair scheduling still shares slots between generation and review; HTTP rate-limit backoff and cancellation remain in the transport. Providers with low rate limits may see less benefit.

`aiAnalysisSTPA.js` now propagates semantic-review provider failures like generation failures, rather than turning them into an `(error)` string that provokes parse retries.

All narrative checks, original evidence, organization profiles, applicability ownership, No exclusions, rating calculations, downstream requirement fields, and checkpoint identities are retained. Existing accepted work is reusable. New execution behavior applies to new runs, not an already running invocation. The Projects pipeline is unchanged.

## Verification and limits

Tests cover batched correction with prior content for all three methods, bounded persistent rejection with partial recovery, original provider-error propagation, concurrency and memory bounds, cancellation, checkpointing, downstream requirements, imports, and existing semantic regression fixtures.

A fake-clock scheduling benchmark uses 147 synthetic rows, 40 seconds per generation request and 15 seconds per independent review. For STPA, HARA and FHA, clean runs take 95 simulated seconds. Runs with every eighth row requiring one correction take 165 simulated seconds. Every row must pass review before acceptance. These are simulated scheduling results, not live LLM performance measurements or a quality evaluation of generated text. Larger evidence, more corrections, provider latency/rate limits and storage costs can exceed the 2–3 minute target. No real provider run was performed.

Validation completed: 315 tests passed across 31 suites; production build passed with lint warnings; `git diff --check` passed.
