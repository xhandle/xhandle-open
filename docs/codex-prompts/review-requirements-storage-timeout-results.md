# Requirements storage timeout review

2026-10-19. Read-only inspection and injected-failure tests; no production changes, browser-data modifications, commit or push.

## Findings

### P1 — parent-source storage failures escape as unhandled promise rejections

`EngineeringArtifactPanel.js:356–364` calls `loadArtifactRowsAsync(sourceKind, ...)` with a success handler only. The cancellation flag protects successful state updates but does not handle rejection, even after navigation. This affects System Requirements loading software parents, Subsystem Requirements loading system parents, and Design loading subsystem parents. A rejected database open can therefore reach the development runtime overlay instead of a local recovery notice.

Reproduced in all three panels by rejecting the parent-source read while the current-kind read succeeds: the promise returned by the production `.then` rejects, retained result rows remain present, and no local parent-load error is shown. An audit-only rejection observer prevented Jest itself failing on the deliberately exposed promise; production has no equivalent handler on that chain.

The current-kind read and linked-collection reads already have catches, which explains how an inline message and an uncaught overlay can coexist when multiple reads fail. Checked HEAD: this missing catch existed before the current uncommitted performance changes. It was missed in the earlier review.

### P2 — timeout handling offers misleading diagnosis and no direct read recovery

`artifactUtils.js:84` rejects a database-open request after 5,000 ms using the exact screenshot message, including advice to close other tabs. Actual `onblocked` has a separate message at line 91. A silent/delayed open with no blocked event produces the screenshot message in the audit. Thus the screenshot establishes an open deadline being reached, not another-tab contention, corrupt data, quota exhaustion, or an LLM failure.

The loop in `openArtifactDb` repairs missing schema/version races; a normal open timeout exits immediately. The injected timeout test observed one open, not three retries. `EngineeringArtifactPanel.js:529`'s Refresh Sources button only snapshots the in-memory source rows; it does not retry a database read. A dedicated retry/loading state is missing for the parent-source failure.

The timeout policy/message and parent-source path are also present in HEAD, so this review does not attribute them to recent virtualization changes.

## Supporting observations / potential contributors

- Panel mount initiates a current-kind read, four linked-kind reads, and a parent-source read: six calls for downstream panels. Some target the same key. Each ordinary async read opens its own connection; the audit confirmed six simultaneous calls yield six opens. App also prefetches all four kinds when active project/repository objects change (`App.js:8044`). This is avoidable amplification, but it does **not prove** it caused this Safari incident.
- `loadArtifactRows` can provide cached rows immediately, while `loadArtifactRowsAsync` still attempts durable storage. This explains visible rows behind the overlay; visibility alone does not establish durability.
- The async loader can use a valid localStorage record on database failure. Saved payloads over 750,000 characters deliberately do not retain that localStorage copy after successful IndexedDB persistence (`artifactUtils.js:330–333`). Large projects therefore depend more heavily on IndexedDB for rereads. That size policy is not itself evidence of data loss and should not be replaced with unlimited localStorage duplication.
- The current-kind failure path leaves cached rows intact and keeps the loaded flag false, protecting against autosaving an empty failed load. Preserve this protection in any fix.
- Transaction/chunk read failures have separate handlers. This screenshot's exact message is from opening the database, not validation of requirement content.

## Recommended fix

1. Catch every parent-source read rejection. Preserve existing same-scope sources/results, show a distinct nonblocking storage notice and Retry loading, and suppress obsolete state/error updates after cancellation or scope changes.
2. Separate current-result loading errors, parent-source errors and generation/save messages. Retry reads without generation or writes. Make Refresh Sources actually reread its source, or provide an unambiguous dedicated read retry.
3. Distinguish open timeout, blocked upgrade and transaction failures. Recommend closing other tabs only for evidence of blocking. Add bounded recovery for transient open failures and preserve cleanup for late-success handles and version changes; do not merely increase a timeout indefinitely.
4. Coalesce duplicate in-flight reads where revision-safe, and avoid redundant same-key mount/refresh work. Preserve pending-write and newest-revision rules. Never substitute stale cached data as confirmed durable results or overwrite data after a failed read.
5. Test rejected/slow opens, a real blocked upgrade, recovery on retry, late successes, navigation during failure, concurrent reads and writes, large datasets without localStorage copies, and preservation of loaded rows. Ensure all three downstream panels stay usable without uncaught rejection events.

## Validation and limits

Full assurance test directory: **25 suites / 140 tests passed** (135 existing tests plus five audit reproductions). Audit cases intentionally assert current faulty/error behavior; their passing does not mean those faults are fixed. The initial panel audit fixture required correction for Jest mock reset behavior and valid row IDs; final executions passed. `git diff --check` passed. No production build repeated because production code was unchanged.

Audit sources: `review-storageTimeoutReview.test.js.txt` and `review-parentSourceErrorReview.test.jsx.txt`. Copy temporarily to their original names under `src/features/code-architecture-assurance/` to reproduce. Temporary files were removed after testing.

The implementation explains how the timeout becomes an uncaught overlay. It does not establish why the customer's IndexedDB open was delayed; that requires runtime storage/console timing from the affected browser. The screenshot and these tests do not prove stored requirements were lost.
