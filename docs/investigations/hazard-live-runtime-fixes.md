# Code-architecture hazard live-runtime fixes

Implemented the prompt in `docs/codex-prompts/fix-hazard-live-runtime.md`. This addresses the live-log audit, not a simulated latency target. Existing STPA/HARA/FHA reasoning, independent semantic checks, governed applicability, rating rules, organization context and software-requirement consumers remain in place.

## Causes and changes

1. **The 32K total-prompt cutoff forced singleton requests.** Generation now adds a 32K variable-input allowance to fixed instructions/shared context, subject to a 120K-character batching ceiling. Review likewise budgets its fixed context separately. Individual oversized sources retain the existing singleton exception rather than losing evidence. Diagnostics identify oversized generation singletons. These are character heuristics, not exact tokenizer guarantees.
2. **Input capacity was being mistaken for output capacity.** `fastHazardBudgets.js` separately budgets full assessment output with a 4K-token reasoning reserve and a conservative initial 6K-character answer estimate (3 characters/token). It uses observed full-answer sizes plus 20% headroom, keeps the largest observation, ignores short exclusions for capacity growth, and caps generation at 16 rows. Haiku 5.5 gets a 24K-token ceiling; other models retain the previous 14K ceiling. This starts Haiku at ten rows, with adaptive reduction/recovery and input-size splitting still available. A ceiling is not a target response length or guarantee against truncation.
3. **Haiku's unsupported sampling controls caused compatibility retries.** Client effort support and server payload capability detection now recognize Haiku 5.5, omit sampling controls on the initial request, and forward the user's selected effort. Existing Haiku 4.5 behavior is covered by regression tests. This follows [Anthropic's migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide), which also explains that thinking consumes the output allowance and can leave no visible text at small limits.
4. **Review failure could regenerate valid assessments repeatedly.** Unavailable/malformed verdicts now have a distinct outcome. Reviews have a global three-attempt limit per row across subdivisions; retrying a failed verdict never triggers assessment generation. Actual semantic contradictions still trigger bounded assessment correction. Review starts with an 8K-token allowance and retries with 16K instead of repeating the same 4K limit.
5. **Review approvals waited behind the whole batch.** Valid returned verdicts now publish/checkpoint approvals immediately, even when other verdicts are missing or waiting. Progress counts accepted rows, never advances just because a request is running, and never treats an unavailable review as approval.
6. **Resume discarded unrevised candidate work.** Structurally valid generated candidates are checkpointed as `pending-narrative-review` before review. Continue recognizes and revalidates that envelope under the existing full input/provider/project/method checkpoint key and resumes review. Candidates cannot become final results or software-requirement inputs without approval. Completed checkpoint entries retain their existing format. Storage failures still surface, with independently accepted work retained in memory where possible.
7. **Live diagnostics lacked batch context.** Prompt-free `[hazard-analysis-batch]` events include method/stage, batch ID, rows, fixed/total prompt characters, batching limit, output limit, queue time, request duration and retry reason. The compact fetch path reports provider finish reason/usage and rejects explicit output-limit responses even when their visible text is parseable JSON. Legacy callers retain string return behavior.

## Verification

- 337 application tests passed across 33 suites: all code-architecture hazard tests, software-requirement source/derivation tests, HARA/FHA workflow, CSV import/export, request lifecycle, client provider settings and auth headers.
- 22 server provider payload/token-compatibility/request-metrics tests passed.
- Production build passed with the repository's existing lint/Browserslist warnings; no new hazard-file lint warnings. `git diff --check` passed.
- New regressions cover large shared context with realistic full-answer lengths for all three methods, adaptive output sizing, bounded review retries, review-only continuation, early partial approval, cancellation/resume, output-limit metadata, Haiku effort/sampling compatibility and pending-candidate isolation from completed results.
- Existing scheduling tests now test lifecycle completion and coverage rather than claim a 180-second SLA from short fixtures and mocked delays. Assertions tied to the old fixed 16-row size were updated for output-aware batching; safety/result/traceability assertions remain.

Offline production-code reproduction:

```
node docs/investigations/scripts/verify-hazard-live-runtime.cjs
```

Recorded in `hazard-live-runtime-verification.json`: 16 rows with 27K shared context generate in two batches (10 + 6), not the previous 16 singletons. Persistent malformed verdicts make two generation requests, with each row reviewed at most three times; all sixteen candidates are retained. Continue approves those candidates with **zero additional generation requests**. No provider calls or browser storage writes occur in this reproduction.

The earlier `audit-hazard-runtime.cjs` and audit JSON describe pre-fix reproduction assertions and are historical; use the verification script above against current code.

## Rollout and remaining measurement

Reload the frontend and ensure the backend has restarted with the changed provider payload code before the next live run. Existing in-flight JavaScript does not acquire all fixes as one coherent update. The next live console events can distinguish input/output batch limits, queue waits and provider durations without exposing prompts.

No paid/live Haiku request or full customer-browser smoke test was performed here. The two-to-three-minute goal is not yet proven. Provider latency, tokenization, rate limits, input size and actual reasoning corrections still affect runtime. Approved stored work remains reusable; the new pending-candidate envelope helps only work checkpointed by this implementation.
