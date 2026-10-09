# Architecture publication conflict after storage optimization

The reported screenshot shows completed extraction with a publication conflict, rather than failed file analysis.

The publication preparation check re-encoded the previous rows and compared the resulting chunk root to the saved root. The new inline-small-object optimization produces different roots for the same hydrated data stored by the earlier encoder. This makes unchanged older records fail the edit guard.

Preparation now normalizes the saved record through the current encoder when the first comparison differs. If both snapshots match, it uses the original saved root for the atomic commit check. Real data changes still fail; the commit transaction still checks for edits made during staging.

Completed rows and run records are staged into a durable ready checkpoint before reporting a genuine conflict. If staging fails, the existing memory fallback and checkpoint export remain available. The memory warning now states that results have not been saved, rather than asserting that every such case is a browser capacity failure.

Validation: native Chromium IndexedDB diagnostic covers old encoder representation, a genuine pre-staging edit with a durable checkpoint, concurrent edits before commit, transaction abort, quota recovery, and save recovery after reload. Four recovery UI tests pass.

This reproduces a code-level cause consistent with the screenshot. The affected live browser data was not read or changed, so it does not establish that no actual edit occurred in that run.
