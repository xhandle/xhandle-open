# Live log follow-up: singleton generation caused by input budget

The customer supplied the current run's terminal excerpt in attachment `c5e652e5-c7df-4a09-b510-8146bfb53c22/Pasted text.txt`. This supersedes the earlier audit's lack of live request evidence. Application code and the running analysis remain unchanged.

## Confirmed from the excerpt

- 74 request starts, 80 unique completions (some requests began before the excerpt), and 74 compatibility-retry messages removing `temperature`.
- 40 generation completions: median 14.426 seconds; input length **35,631–42,449 characters**, output median 4,259 characters. All finish with `stop`.
- 40 semantic-review completions: median 13.110 seconds. Three finish with `length`; two return zero text and the third returns 639 characters despite a 4,000-token output allowance. The log reports visible text, not actual provider token usage or hidden reasoning, so it does not explain where that budget went.
- No HTTP 429, timeout or provider-failure messages appear in this excerpt. This does not exclude events elsewhere in the run.
- The maximum observed overlap is six requests, reconstructed from the timestamp embedded in each request ID and its elapsed time. The excerpt does not establish why the effective overlap is six, despite the code's eight-slot ceiling. Browser/network limits are a possibility, not a confirmed cause.

## Main cause now identified: the input limit defeats batching

`fastHazardPipeline.js:98` refuses to add a second row when the complete prompt exceeds **32,000 characters**. `:122` also splits multirow correction prompts above that limit. A single oversized row is allowed through so evidence is not discarded.

Every observed generation request is above that threshold. In this pipeline the transport adds no extra content: `generateFastHazards` calls `fetchLLMResponse(prompt, {}, [], '', ...)`, whose fullContext is empty. The backend measures the normalized message text. These oversized requests therefore correspond to the singleton exception, not functioning 16-row batches. This directly explains repeated one-row review messages.

A deterministic production-code probe with 27,000 characters of shared analysis context reproduced this: **16 source rows produced 16 generation requests**, all with one row and prompts above 32,000 characters. It is an isolation test, not a reconstruction of which exact portion of the customer's context is large. The live logs reveal total prompt lengths but not the distribution across shared context, evidence, instructions and corrections.

The generation and review median durations total about 27.5 seconds for a singleton pair. At six effective concurrent requests, 147 such pairs would require approximately **675 seconds (11.2 minutes)** of throughput before any additional correction/retry work. This is a rough estimate from this excerpt, not an ETA: applicable/excluded responses vary, queues have dependencies, and some rows may be cached or revisited. It explains why the earlier 2–3 minute simulation is not representative without requiring unusually slow Haiku calls.

## Additional confirmed overhead

The repeated `temperature` compatibility retry is real in this run, not merely historical. Its individual duration is not logged, so its contribution cannot be separated from total request time.

The three review output-limit events can trigger the earlier audited review retry path. Logs do not contain assessment IDs, response bodies or validation findings, so they cannot establish the number of content corrections or whether every review response with `stop` was accepted. The previously reproduced 136-review amplification is a defect scenario, not the observed count for this excerpt.

## Revised implementation priorities

1. Fix input budgeting so shared context/evidence cannot silently force the whole run into singleton requests. Measure fixed overhead separately, use a provider-supported total context budget with output reserve, and pool/deduplicate repeated source/context data losslessly. Do not simply truncate evidence or raise the row ceiling.
2. Keep output budgeting separate and based on actual answer sizes. A wider input window must not create oversized output batches.
3. Correct Haiku payload compatibility and effective effort handling. Preserve quality validation; do not blindly choose low effort without evaluating review reliability.
4. Separate malformed/unavailable reviews from semantic findings; retry a verdict without regenerating valid candidate content. Preserve partial approvals immediately.
5. Add batch row count, fixed/variable prompt sizes, actual usage and per-stage validation/retry causes to live metrics. Re-run on representative source/context with actual provider timing before claiming a runtime target.

The raw log statistics are in [hazard-live-log-measurements.json](hazard-live-log-measurements.json). The read-only reproduction command from the initial audit now includes the oversized shared-context case. No paid provider calls were made by the audit.
