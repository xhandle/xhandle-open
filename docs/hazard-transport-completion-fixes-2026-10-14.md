# Hazard transport completion fixes — 2026-10-14

Executed `codex-prompts/hazard-transport-completion-fix.md` against the three findings from completion audit v3.

## Changes

- `src/components/aiAnalysisSTPA.js`: unsupported non-string message content now raises ProviderResponseError instead of an accidental TypeError. The existing bounded retry/fallback path handles it without suppressing unrelated programming errors.
- HTTP 429 bodies are not required for recovery. The transport releases the unused body, uses status/headers and throws an explicit status-bearing error after exhaustion. No final unbounded error-body read occurs.
- Numeric and HTTP-date Retry-After values are supported. Waiting is limited to 30 seconds per backoff and 60 seconds cumulatively per transport call, with at most five attempts. A provider-requested delay beyond that budget causes an immediate rate-limit error; the code does not retry earlier than the provider permits.
- `hazardDeferredFailures.js` and `resultsFirstHazardPipeline.js`: exhausted rate limiting exits remote retries and completes unresolved rows with the existing local assumption-based assessments. Already completed rows and reviewed No decisions remain preserved. This applies during screening as well as generation for STPA, HARA and FHA.

## Verification

Converted the audit counterexamples into regression tests. Coverage includes malformed successful content followed by completed/validated fallback for all three methods; final 429 with a body that never resolves; numeric/date long Retry-After; successful short backoff; cumulative waiting limit; screening fallback and preserved reviewed No. Existing transport tests cover explicit cancellation, body deadlines and unsolicited aborts. Existing hazard and requirements suites cover persistence, applicability and downstream derivation.

All 462 tests passed across 46 suites (hazard analysis, shared transport and downstream requirements). `git diff --check` passed. No live provider/browser run was performed. These changes close the reproduced transport defects; they do not establish a universal guarantee against arbitrary programming errors, process termination or resource exhaustion. Fallback assessments retain their premises in Assumptions and Assessment Basis. Production cancellation remains intentional.
