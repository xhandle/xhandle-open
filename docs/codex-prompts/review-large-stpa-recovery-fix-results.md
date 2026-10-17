# Review outcome: two confirmed regressions

## High — initial manifest persistence can block generation indefinitely

`fastHazardRunner.js:156` directly awaits `saveCodeArchitectureHazardRun` before reaching generation or the next cancellation check. The store awaits database opening, transaction completion and preceding writes without an overall deadline (`codeArchitectureHazardStore.js:175-192`). Its five-second timer reports slowness; it does not settle the operation. This makes storage a new prerequisite for provider work, unlike the bounded checkpoint adapter.

Diagnostic reproduction: hold the first save promise unresolved, start the real runner, and then abort its signal. Provider calls stay at zero and the runner remains unsettled until the save promise is released. This confirms the unbounded wait; the test does not claim the customer experienced a hung database. An outer UI cancellation race may stop the visible activity but does not release this underlying runner.

Recommendation: make initial recovery persistence bounded and cancellation-aware while retaining a single ordered writer. On a slow or failed save, continue generation with an accurate persistence warning; ensure a late manifest save cannot overwrite a newer complete run. Test both delayed success and a never-settling operation.

## High — manifest-only reload can silently drop user preprocessing

The new record copies `userPreprocessing` but omits the Summary/identity mapping (`fastHazardRunner.js:143-153`). For an incomplete or draft previous run, this manifest becomes the latest saved record. On continuation, `prepareCodeHazardPreprocessing` returns the original input immediately when `previousRun.generatedSheets.Summary` is missing (`codeArchitectureHazardPreprocessing.js:8-10`). Copied user edits therefore are not actually applied. The prior-complete wrapper avoids this particular problem by retaining the prior result, but incomplete/draft recovery does not.

Diagnostic reproduction using the real runner: create a seven-phrase assessment, mark it incomplete, and record a human applicability exclusion on one row. Continuation sends six rows, correctly honoring the exclusion. Serialize/reload that continuation's initial manifest and resume from it: seven rows are sent. The manifest still contains the preprocessing entry, but its mapping is missing, so the governed exclusion is ignored. This also changes checkpoint bases and can prevent reuse of otherwise compatible work.

Recommendation: persist a compact stable row-identity mapping sufficient to restore preprocessing independently of a full Summary, or retain a reference to the prior durable record and load it during recovery. Preserve exclusions, edited values and archived ownership; detect incompatible identities explicitly rather than silently dropping edits.

## What is improved

The full serialized keys in the clean cache are replaced with SHA-256 identities when Web Crypto is available; clean retention is capped at 96 entries. Dirty entries remain protected. The backend checkpoint format/version remains unchanged. Normal initial-manifest startup discovery and final replacement are covered by tests. Source reuse in final assembly is keyed by assessment ID, including partial-result IDs.

## Validation and limits

61 existing focused tests passed across five suites. Two additional temporary diagnostic tests passed by asserting the defects above; the temporary test file was removed after execution. No production code was changed during this review. No live Safari heap profile or full provider run was performed, so a universal no-reload claim is not supported. Earlier uncommitted changes remain intact. This is not a clean regression sign-off.
