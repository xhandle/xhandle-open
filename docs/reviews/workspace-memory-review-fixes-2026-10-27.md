# Fixes for the workspace memory review

Implemented `docs/codex-prompts/fix-memory-review-findings.md`.

## Changes

- Added an owned readonly transaction helper for hazard metadata and initial root reads. Abort and the default ten-second read timeout abort the actual transaction; errors are returned only after transaction retirement. Listener/timer cleanup runs on success and failure. Retry serialization and chunk snapshot integrity remain in place. Latest-run restoration, by-ID reads, and the initial fallback-migration metadata lookup use the helper.
- Restored hazard Storage labels using only the small `runMetadata` store, in the same readonly transaction as the key listing. Project/repository names and saved dates are available again without cloning analysis records. Missing or unresolvable ownership is explicitly labeled before the user selects records for deletion. Original record keys are retained.
- Storage listings jump over complete internal chunk-key prefixes using an exclusive prefix bound. A page also stops after 500 cursor visits and returns a continuation key, so many sparse chunk ranges cannot produce unbounded work. Display ordinals advance by the actual number of displayed items.

## Validation

- 156 focused tests passed across 21 suites. The former review characterizations now assert correct cancellation behavior. New coverage verifies metadata/root cancellation, timeout retirement, recovery on a subsequent read, cross-project hazard labels, missing metadata, preserved deletion keys, absence of payload reads, and sparse chunk pagination including U+FFFF suffixes and adjacent keys.
- The isolated Electron diagnostic cancelled real reads blocked behind writes to both `runMetadata` and `hazardAnalysisRuns`, then reloaded all 2,000 synthetic rows unchanged. Chunk hydration cancellation also passed. The diagnostic used a disposable profile; the user's profile was never opened.
- Strict `CI=true` build failed because existing repository lint warnings are treated as errors. The normal production build (`CI=false npm run build`) succeeded with warnings. `git diff --check` passed.

## Scope and remaining limits

This patch resolves the two actionable review findings and the sparse-listing concern. It does not convert legacy whole-workspace backups to streaming output or hazard views to paged data. Those operations can still consume memory proportional to total data size. Cancellation cannot preempt synchronous native cloning already executing. Physical sleep/wake, actual Safari execution, and the user's large installed Desktop workspace still require validation after packaging.

No saved user data was changed, no app was installed, and no commit, push, or release was performed.
