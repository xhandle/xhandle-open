# Active hazard pipeline runtime audit

**Update:** Current terminal logs have now been analyzed. See [live log follow-up](hazard-live-log-followup.md): oversized input prompts force singleton generation in the observed run. The findings below describe the earlier read-first audit and remain applicable; its statement that logs were unavailable is historical.

Date: 2026-10-13. Executed prompt: [audit-hazard-real-runtime.md](../codex-prompts/audit-hazard-real-runtime.md).

## Conclusion and scope

The current implementation contains confirmed retry amplification and delayed progress/checkpoint behavior that can make the reported slowdown possible. The previous 95/165-second simulations are not a measurement of customer runtime. Exact attribution of this particular ten-minute run remains unavailable: its current API request logs, row validation findings, browser state and active request timings were not provided. Do not claim that every mechanism below occurred in that run.

Only this report, its prompt, a read-only reproduction script and numeric measurements were added for this audit. Application source, browser storage, provider settings and running requests were not modified. No paid model calls were made.

## Findings, ordered by priority

### P1 — Failed review delivery is treated as failed assessment reasoning, multiplying requests

`reviewFastHazards` (`src/features/code-architecture-hazard-analysis/fastHazardSemanticReview.js:103`) recursively splits malformed/truncated verdicts and retries singletons. If it still cannot obtain a verdict, line 111 returns an ordinary issue string. `generateFastHazards` (`fastHazardPipeline.js:174`) treats this operational failure like a semantic contradiction, removes the otherwise structurally valid assessment, and requests a new assessment at lines 207–213. The new content must then traverse the independent review tree again.

The three-attempt cap at lines 192–198 caps parsed assessment attempts per row, not the combined number of generation, review and transport calls. Valid approvals remain protected, but the failure path is not globally inexpensive.

Reproduction using production functions, a valid deterministic assessment and a deliberately malformed review response:

| Input | Generation calls | Review calls | Accepted rows |
| --- | ---: | ---: | ---: |
| 1 row | 3 | 6 | 0 |
| 16 rows | 5 | 136 | 0 |

The additional generation calls for the 16-row case include correction-prompt input splitting. Review split branches are awaited serially. This is a confirmed defect mechanism, not the customer's observed request count. It can consume many minutes despite an eight-slot scheduler, especially as independent workers finish and one remaining worker traverses its own serial retry tree.

Recommended fix: distinguish `approved`, `semantic correction needed`, and `review unavailable/invalid`. Keep the generated assessment when review fails operationally; retry only the missing verdict, with one shared per-row/per-run retry budget. A failed review must never silently approve content. Preserve resumable pending-review content separately from accepted checkpoints.

### P1 — Output sizing is a row heuristic, not a measured output budget

`fastHazardPipeline.js:53` fixes generation output to 14,000 tokens and `:91` caps generation at 16 rows. The 32,000-character check budgets input, not output. The generator does not adapt to observed answer length or ratio of applicable/excluded rows.

The user's previously supplied 147-row CSV contains 73 stored columns, 89 Yes rows and 58 No rows. Reconstructing requested assessment fields from that CSV yields a median applicable assessment size of **4,528 JSON characters** (range 3,860–5,642). The first sixteen applicable assessments total **73,606 JSON characters**. Using the server's coarse chars/4 heuristic suggests roughly 18,400 tokens, above the fixed 14,000-token budget; this is an estimate, not Claude tokenization or proof that the current batch was truncated.

The expanded quality contract is meaningful work: 21 requested STPA fields plus ID, including explicit assumptions, evidence and dependencies, then independent review. The model does not generate every stored column. Eight assessment fields, five decision/rationale fields and eight evidence/dependency fields are requested for applicable rows; source labels, context, IDs and traceability columns are copied or derived locally (`fastHazardSchema.js:8`, `fastHazardRunner.js:31–87`). HARA and FHA use the same orchestration with their own fields.

Recommended fix: measure actual output token usage and generated character sizes, adapt row limits with output headroom, and make answers concise without deleting causal reasoning. Increase output limits only with verified provider support and measured throughput; a larger response alone does not guarantee less elapsed time.

### P1 — Prompt growth splits reviews/corrections even without model failures

The review budget is 24 rows/60,000 characters (`fastHazardSemanticReview.js:60`), but reviews receive the entire assessment plus source/context. With the first sixteen applicable CSV assessments, a review prompt is **79,901 characters**, even with original source-code evidence and shared organization context omitted because they are absent from the export. The actual runtime input cannot be reconstructed from this CSV alone.

Packing all 147 CSV rows in their original order using current generation/review limits produced 10 generation groups but 16 review groups, including a one-row tail. This is why a one-row message can occur with no global batch collapse. Corrections include entire previous answers and can exceed the generation input budget, recursively splitting into serial subgroups (`fastHazardPipeline.js:122`). Each group re-sends the shared project/profile context. The baseline generation prompt is 8,432 characters before real context/evidence, and includes STPA, HARA and FHA instructions regardless of selected method.

Recommended fix: pool pending reviews across generation workers within a bounded queue and preserve independent per-row verdicts; use method-specific prompt sections and lossless shared evidence/context references. Schedule size-driven subgroups as bounded queue jobs rather than serial recursion. Continue checking complete evidence; do not truncate it to force a target batch size.

### P2 — A slow tail delays accepted-row progress and checkpointing

`reviewFastHazards` gathers findings locally and returns only after all internal review groups finish (`fastHazardSemanticReview.js:120–131`). The caller adds results and checkpoints only after that return (`fastHazardPipeline.js:171–189`).

A probe held the second request of a two-request review group. Progress remained **0 accepted**, although the first request had already returned approvals; after releasing the second, it jumped to **16**. If a later request throws, successful verdicts held inside the review function are not returned to the caller for checkpointing. This can both make the run look slower than its completed work and cause replay of approved work after interruption.

Recommended fix: emit/checkpoint each fully validated review subgroup immediately. Show generated, awaiting review, correcting and accepted counts, plus active requests. The final percentage must still reserve completion for successful final save. Do not replace truthful progress with a timer-based percentage.

### P2 — Haiku 5.5 capability handling omits effort and repeats incompatible sampling

Both capability checks omit Haiku: `src/lib/aiProviderConfig.js:22` and `server/aiProviderPayloads.js:89`. The former suppresses its effort header; the latter ignores explicit effort even if the header/body supplies it. A production payload probe for `claude-haiku-5-5` with `effort: medium` produces **no output_config** and **temperature: 0.3**.

The user's earlier October 12 logs explicitly showed `Compatibility retry 1 ... removed: temperature` on repeated Haiku 5.5 requests. `server/aiProviderTokenCompatibility.js:57` corrects a payload only within the current request; the next call recreates the incompatible payload. That historical repetition is evidence; its cost during the present run is unknown. The metrics/header labelled effort used reports requested effort before payload capability filtering (`server.js:2309–2338`), which can be misleading.

Recommended fix: verify the selected model's official capability contract, align client/server checks, construct a compatible initial payload, and record effective effort. Do not infer that the provider default is high or blindly lower effort at the expense of reasoning quality.

### P2 — Request metadata and live stage diagnostics are insufficient for exact attribution

The server preserves `finish_reason` and raw provider response/usage (`server.js:1458`, `:1528`), but `fetchLLMResponse` returns only content (`src/components/aiAnalysisSTPA.js:260`). It currently has no check for `finish_reason: length`. Truncated non-JSON falls into generic parse retries; a syntactically complete partial result is only noticed by missing IDs. Real provider usage and stop reason do not reach pipeline sizing/metrics.

The run-level `[hazard-analysis-performance]` summary is emitted in `finally` when workers finish (`fastHazardPipeline.js:58–63`, `:220`). It contains request totals and duration sums, not an active-run timeline, batch IDs, row identities, queue wait, rejected reasons or rate-limit wait. Eight concurrent calls can accumulate request seconds faster than wall time. The backend's `timeToFirstTokenMs` for non-streamed requests is observed when the full response arrives, not true first-token latency (`server.js:2362`, `server/aiRequestMetrics.js:78`).

Claude requests can wait up to 290 seconds client-side (`aiAnalysisSTPA.js:70–91`), and HTTP 429 may retry up to five times (`:173–247`). The scheduler slot is occupied during these waits. The server also has a 60-request/minute local limiter (`server.js:478`). Provider rate-limit headers are not forwarded in the generic error response (`server.js:2472`), so the client can lose the provider's Retry-After advice. None of this establishes that rate limits occurred in this run. Raising concurrency alone may make provider limits worse.

Recommended fix: surface stop reason and actual usage; log bounded, prompt-free run/batch/stage timing and retry causes during execution; distinguish queue, provider, review, correction and storage time; preserve rate-limit advice. Capture one representative live run before setting another runtime expectation.

### P2 — Previous latency benchmark is materially unrepresentative

`fastHazardLatency.test.js:5` creates sources with only an ID and `Apply torque`. It supplies an empty shared context. Its synthetic STPA answer is 1,748 JSON characters versus the CSV median of 4,528. It fixes every generation response at 40 seconds and review at 15 seconds, has no provider token/rate limits, no malformed verdicts, and deliberately makes corrections succeed on the next attempt. Every eighth row requires a correction in one scenario. That test verifies bounded scheduling under those assumptions, not speed or quality on a real provider.

The benchmark can pass while the amplification and progress defects above remain. Keep it as a scheduling test; remove any interpretation of its threshold as a customer SLA. A regression corpus must include realistic narratives, source evidence, organization/context size, malformed/missing verdicts and rate-limit behavior. Measure live runtime and acceptance/correction rates separately.

## Checked and not identified as the explanation

- Active methods dispatch to `runFastCodeArchitectureHazardAnalysis` (`codeArchitectureHazardRunner.js:24–27`); the legacy STPA repair/catalog stages are not called from that path.
- `fastHazardRunner.js:125` invokes generation once per run. Its shared prompt includes the organization profile and source/context. The core input expands interfaces by guide phrases and selected contexts (`codeArchitectureHazardUtils.js:693–706`); 147 is the assessment count, not 147 separate code functions.
- The scheduler can issue up to eight model requests for this run; this does not parallelize serial subgroups inside one worker. Twelve workers cap in-flight source rows at 192. No evidence from source review that all generation runs strictly one row at a time.
- Source-owned No rows bypass model requests; cached validated assessments can be reused. New AI No decisions still get independent review. Explicit regeneration clears matching checkpoint scope.
- The current summary schema does not request 76 independently generated fields. Reducing visible columns alone would not change the prompts.
- Final normalization, table assembly and final save occur after model work. They cannot explain time reported while only 25 rows are accepted. Per-batch checkpoint latency has not been measured, so it is not ruled out.
- The request body's legacy `gpt-4o` string does not alone mean the selected Claude model is ignored: `buildAIAuthOpts` sends `x-ai-model`, and server provider resolution uses the selected header (`server.js:1387–1394`).

## Reproduction and evidence

Run from the repository root:

```sh
node docs/investigations/scripts/audit-hazard-runtime.cjs /Users/Nick/Downloads/MyAUTComputerArchitectureCourse_SEMI-MIPS_hazard_analysis_2026-10-13.csv
```

The script imports the actual pipeline/reviewer through Babel, stubs provider calls, uses assertions, and prints counts/sizes only. It never changes application files or browser state. [Recorded measurements](hazard-real-runtime-measurements.json). The CSV is a prior run; it cannot supply current API timing or reconstruct original evidence/profile payloads.

For exact live attribution, obtain current `[ai-request]` started/finished lines with workflow, model, finish reason and duration, plus browser retry/rate-limit messages. Correlate generated versus reviewed batches and rejection causes. Current diagnostics do not yet include all of that, particularly row-level rejection causes during a successful eventual run. The previously requested logs remain unavailable; no fresh request to the provider was made during this audit.

## Recommended implementation order

1. Separate review operational failures from content findings; retain candidate content and apply one finite retry budget across stages.
2. Stream accepted verdict groups into checkpoints/progress and place pending review/correction subgroups onto bounded shared queues.
3. Add real request/batch timing, effective provider settings and usage/finish-reason propagation; correct Haiku compatibility handling.
4. Rebalance output/input sizes using representative artifacts and observed token usage, avoiding evidence removal and oversized truncating batches.
5. Run a controlled live 147-row benchmark and compare quality, model-call count, retries and end-to-end latency. Set a measured target range; do not promise 2–3 minutes from simulation.

Validation: the deterministic audit probe completed successfully; 49 focused frontend tests passed across six suites. The provider payload/compatibility/metrics tests passed as well. Existing passing tests do not invalidate the newly reproduced failure paths, which they did not cover. `git diff --check` passed. No application build was needed because production code was unchanged.
