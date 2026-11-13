# Claude Collaborator reliability review — November 13, 2026

## Outcome

The implementation contained reproducible application-side paths to an empty Collaborator answer, including with a valid Claude model and effort setting. The changes below address those paths without changing the selected provider, model, or effort. They are local changes; this review does not establish which path occurred in Offer’s production session and does not deploy a fix.

The screenshot’s `assistant_empty_response` is an application error, not evidence of a Chrome-specific problem. It meant that the transport extracted no visible text. The previous message did not distinguish exhaustion of the output allowance, an empty completed turn, refusal, or context exhaustion.

## Findings and changes

1. **Small output allowances also paid for thinking.** Collaborator stages use answer limits as small as 1,200–3,200 tokens. Claude’s `max_tokens` includes thinking and visible output, so these limits could be consumed before any answer appeared. The client rejected an empty answer before its normal partial-answer continuation could run. Collaborator now adds thinking headroom (4,096 / 8,192 / 16,384 tokens for Low / Medium / High), with a bounded total ceiling of 64,000. Legacy Opus 4 / 4.1 recovery remains below their 32,000 ceiling. This is application policy, not a guarantee that Claude will reserve a particular number of tokens for visible output.
2. **Completed empty responses had no recovery.** Both JSON and streamed routes now allow one server-owned recovery attempt. Empty output caused by the token limit gets a larger allowance; an empty completed turn receives an explicit instruction using the original task and choices. The model and effort stay unchanged. There is no replay after visible output, refusal, context exhaustion, tool requests, paused turns, unknown completion, HTTP errors, or cancellation. Recovery shares the original request deadline.
3. **Capability checks were duplicated and incomplete.** Browser and server now share Claude effort/thinking capabilities, including supported Opus 4.x and Sonnet 4.6 models. Modern models use adaptive thinking for Collaborator; Opus 4.5 and Mythos Preview use a valid manual thinking budget. Models without effort support keep their normal request format. Sampling controls are omitted where inappropriate; compatibility handling also recognizes `top_k`.
4. **Explicit provider selection could silently fall through.** A request explicitly selecting Claude could use an account’s active OpenAI key if no Claude key existed. Explicit selection now remains binding and returns the normal missing-key error instead of switching providers.
5. **Failure text could contaminate conversation history.** Failed turns are marked and excluded from subsequent model prompts. Previously saved messages beginning with the old application error wording are excluded too. User tasks, choices, and valid assistant evidence are retained.
6. **Stop reasons and diagnostics concealed the distinction.** Claude refusal, context exhaustion, tool use, paused turns, and output limits remain distinguishable. Empty-response messages now include safe provider/model/effort, request ID, effective token allowance, and attempt count. Private thinking blocks are excluded from browser responses; credentials and prompt/response text are not added to diagnostics.

## Validation

All provider responses in the tests are synthetic; external provider requests are blocked in the route fixture. No live customer credentials or paid AI calls were used. Final verification passed 66 server tests, 140 targeted client tests, and the production-route integration fixture below.

- Production-route matrix: ten Claude model cases × Low/Medium/High × JSON/SSE. Includes legacy Haiku 4.5, Haiku 5.5, Sonnet 4.6/5/5.5, Opus 4.5/4.6/4.7/5.5, and Fable 5.1.
- Empty-limit and empty-completion recovery: Haiku 5.5, Sonnet 5.5, and Opus 5.5 at every UI effort, through both route variants. Assertions retain model/effort and emit only one terminal stream event.
- Exhausted recovery, partial output, refusal, HTTP error, truncated upstream stream, private-thinking exclusion, explicit-provider routing, and cancellation without replay.
- Unit coverage for payload construction, legacy limits, multimodal history preservation, output parsing, error-history exclusion, and safe effective-limit diagnostics.
- Targeted lint has no errors; the existing Collaborator file retains two unrelated warnings.

Relevant tests: `server/claudeResponseRecovery.test.js`, `server/aiProviderPayloads.test.js`, `server/anthropicStreaming.test.js`, `server/aiProviderTokenCompatibility.test.js`, `server/aiRequestMetrics.test.js`, `server/collaboratorStreaming.integration.test.js`, `src/features/collaborator-performance/chatTransport.test.js`, `src/components/XHandleCopilotView.test.jsx`, and `src/lib/aiProviderConfig.test.js`.

## Limits and operational impact

These changes support the app’s Low, Medium, and High settings; they cannot guarantee a successful provider response for every request. Provider access, rate limits, outages, context limits, and the existing request deadline still apply. Retired or unavailable models cannot be made available by the client. Models that lack an effort parameter do not receive an invalid one.

Additional thinking allowance and the single empty-answer recovery can increase token usage and latency. Other artifact-generation workflows keep their existing output budgets. A production request ID and completion reason would be needed to attribute Offer’s particular failure.

The no-replay rules above describe empty-answer recovery. Existing, narrowly scoped retries for provider-rejected request parameters remain in place; recognizing `top_k` adds one compatible sampling-control case.

## Primary references checked

- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Thinking steering and cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)
- [Extended thinking and legacy budgets](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Stop reasons and empty completed turns](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- [Haiku 5.5 migration](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
- [Model capabilities and output limits](https://platform.claude.com/docs/en/models/overview)
