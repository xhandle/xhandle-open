# Saved hazard-result restoration fix — October 18, 2026

Implemented `fix-hazard-result-restoration.md` without modifying database schemas, storage modules, generation logic or real saved analyses.

## Behavior

- `useHazardRunRestoration` tracks loading, loaded, empty and failed states independently of the displayed result.
- The hazard panel shows loading/read-failure status instead of draft/generation controls while the initial saved-result read is unresolved. Retry loading reads storage; it does not start generation.
- Background read failures retain the previously displayed completed result and show the error separately.
- Project/connection/repository scope changes mask previous results immediately. Cleanup, request sequence, registry revision and context version checks reject stale publication.
- A live generation, intervening edit or explicit clear takes precedence over an older read.
- A successfully read run is published before optional imported-context reconciliation is saved. Save failure leaves the original result accessible with a separate warning. Context invalidation schedules a fresh read rather than silently dropping the result.
- Existing context reconciliation still uses the existing save API when needed; no new record format, migration or regeneration was added.

## Validation

49 tests passed across six suites: useHazardRunRestoration, CodeArchitectureHazardPanel, hazardRunRegistry, saveHazardContexts, codeHazardImportContext and codeArchitectureHazardStore. The restoration suite has 14 mounted-hook tests and the panel suite exercises initial loading/failure notices, Retry loading, preservation of displayed results and context-save warnings.

Covered delayed 26,278-row reads, successful empty reads, failed reads and manual retry, failed background refresh, out-of-order responses, immediate scope masking, pending context-save failure, context-version invalidation, context-save success/failure, intervening edits/clears, live-generation precedence and unmount cleanup. Failure-path storage tests intentionally emit errors.

Production build completed with repository warnings. No new restoration-hook or panel warnings appeared. `git diff --check` passed.

## Limits

Tests use React/jsdom and controlled read/save promises, not the user's live Safari database. This fixes misleading restoration state and stale-publication behavior; it does not eliminate large-payload IndexedDB latency, guarantee browser availability, or prove zero regressions. Initial read errors require Retry loading; unrelated tab switching is not presented as a retry mechanism. Pending reads remain loading and can be superseded by Retry loading; no destructive timeout action exists.

No commit or push was performed. The earlier hazard-restoration-audit.cjs is a historical pre-fix investigation harness that extracts the old inline effect; use the new mounted restoration tests for this implementation.
