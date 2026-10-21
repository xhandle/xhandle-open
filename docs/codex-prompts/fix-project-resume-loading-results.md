# Saved-project resume/loading recovery

Implemented the prompt in `fix-project-resume-loading.md`.

## Changes

- Project hydration has a 60-second inactivity deadline, reset by progress. Recoverable read failures retry with exponential backoff capped at 30 seconds. Permanent errors such as missing chunks still surface rather than being converted to empty content.
- `visibilitychange` and `pageshow` check for overdue reads and immediately restart overdue/retry-waiting work on foreground return. Healthy current reads are not duplicated.
- Each attempt owns an AbortController. Superseded or cancelled attempts cannot publish results/progress. Late database opens close, raw read transactions abort, and chunk hydration honors cancellation.
- Same-scope refreshes keep existing architecture content visible. The existing scoped-row owner and load-epoch guards continue protecting project switching and generation publication.
- Recovery displays a reconnecting label. No database schema or saved-content migration was introduced.

## Validation

- Assurance/storage suite: 28 suites / 156 tests passed.
- Hazard suite: 61 suites / 582 tests passed. The previously documented publication audit's three unrelated save-count failures remain excluded.
- New tests cover stalled attempts, late callbacks, progress extending deadlines, pageshow recovery, cancellation, permanent errors, late database open closure, raw/chunk transaction cancellation and connection closure.
- App integration tests retain same-scope visible content and continue verifying project isolation and publication races. Their dependency injection was updated to include the real recovery helper.
- Production build passed with existing warnings. `git diff --check` passed.

## Limits

The initial all-white Safari screen has not been reproduced or attributed to a specific cause. This fixes an identified stalled-read recovery gap; it does not guarantee browser-process survival, responsiveness while JavaScript is blocked, or recovery from deleted/corrupt data. Foreground recovery operates once JavaScript resumes. Browser timing on the user's live dataset remains unmeasured. No commit or push performed.
