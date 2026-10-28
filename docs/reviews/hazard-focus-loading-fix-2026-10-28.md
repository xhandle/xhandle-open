# Preserve loading progress when returning to Chrome

Found that focus and visible-again events both invoked a loader which aborted the previous read and reset its progress. This can restart a large saved-result hydration when switching applications.

Focus/visibility checks now wait for active restoration to settle and coalesce into one pending follow-up revision check. Already loaded results stay visible during passive revalidation. Explicit storage-change events and manual retry still supersede obsolete work; scope changes and disabling/unmounting still cancel it. The follow-up check preserves detection of updates made elsewhere while a read was in flight.

Validation: 44 tests passed across five suites covering restoration races, progress preservation, queued focus checks, cancellation, durable revision reuse, and the large real table component. Diff whitespace checks passed. The isolated 100-reentry Chromium diagnostic also completed successfully without additional payload reads after initial loading. Its final table renderer is stubbed; it is not a reproduction in the user's Chrome profile.

Files: useHazardRunRestoration.js and its regression tests. Earlier preview/scheduling changes remain undone. No saved-data modifications, commit, push or desktop release.
