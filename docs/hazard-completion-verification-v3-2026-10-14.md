# Hazard completion audit v3 — 2026-10-14

## Conclusion

The current implementation cannot guarantee completed results for every started row while the browser remains alive. Three transport gaps remain. The first two are concrete failure/stall counterexamples, not browser-reload limitations. This review adds characterization tests and documentation only; production code was not changed.

Prompt executed: `codex-prompts/hazard-completion-verification-v3.md`.

## Findings

### P1 — Unexpected provider content type aborts the entire run

`src/components/aiAnalysisSTPA.js:272` calls `.trim()` on message content without validating its type. A successful HTTP response containing an array/object instead of the expected string throws TypeError. `hazardDeferredFailures.js:9` excludes non-network TypeError from recovery, `resultsFirstHazardPipeline.js:117` propagates it, and the outer catch at lines 157–165 does not complete unresolved rows locally.

Reproduction: real transport and generation functions, mocked HTTP 200 with content blocks, valid reviewed source and non-aborted signal. STPA, HARA and FHA each reject after one request, with zero completed rows out of one. The response shape is deliberately malformed for the app's proxy contract; this demonstrates failure handling, not evidence that the live provider currently returns this shape.

Recommended fix: validate the response envelope at the transport boundary and represent unsupported content as a recoverable provider-response error. Normalize only explicitly supported formats. Preserve programming-error visibility elsewhere. After bounded recovery, use existing assumption-based completion.

### P1 — Final rate-limit response body can hang outside timeout/cancellation

`aiAnalysisSTPA.js:222–224` clears the request timer and removes caller-abort forwarding before 429 handling. After attempt five, `response.text()` at line 256 is awaited without a deadline. If the headers arrive but the error body does not finish, no rejection reaches fallback.

Reproduction: five immediate HTTP 429 responses, final body held pending. Advancing fake time far beyond a 50ms request deadline does not settle the request. Explicitly aborting the caller also does not settle that body read. Releasing the body finally produces the expected 429 error. This shared transport affects all methods.

Recommended fix: bound error-body consumption and retain cancellation through it, or throw the known status without depending on the body. The bounded operation must include every awaited transport phase, not merely the initial fetch.

### P2 — Retry-After has no application-level upper bound

`aiAnalysisSTPA.js:242–247` waits the full numeric Retry-After value after clearing the request timer. A value of 86400 schedules a one-day delay. A finite delay is not permanent noncompletion, but violates the intended bounded recovery and makes the run appear stuck.

Reproduction: HTTP 429 with Retry-After 86400 and a 50ms configured request timeout; after advancing one minute only the first request has occurred. Cancellation works in this wait (unlike the final-body finding).

Recommended fix: cap the application's waiting budget. If the provider asks for a longer delay, do not send another request earlier than permitted; defer remote work and complete through the existing local fallback.

## Verified protections and remaining boundaries

Reviewed applicability preservation, invalid-import retention, fallback premises, checkpoint resume, bounded checkpoint/final-save handling, callback isolation and project-owned run lifetime are covered by existing tests. Explicit Stop, clear/deletion and teardown intentionally cancel. Preflight invalid-input rejection is separate from completion after generation starts.

Fallback validation and final table assembly can still throw on unexpected program/data defects; there is no universal outer completion guarantee. Browser/process termination and resource exhaustion are outside an in-memory pipeline's guarantees. Tests cannot prove their absence. Required outputs and applicability decisions should not be weakened to disguise such failures.

## Validation

Five new characterization tests cover the malformed-response failure for all three methods, stalled final 429 body and excessive Retry-After wait. Their passing status means the defects were reproduced, not fixed. All 456 tests passed across 46 suites, including the hazard-analysis, shared AI transport and software-requirements artifact suites. `git diff --check` passed. No paid provider run or live-browser smoke test was performed.
