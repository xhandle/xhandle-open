# Investigate the desktop Storage-tab crash

Investigate xHandle Desktop 0.2.11 stopping unexpectedly while Settings → Storage is opened. Run this investigation, not just a review plan.

1. Read repository instructions and inspect the storage inventory, record listing, database access, timeout, cancellation, and Electron renderer-recovery paths.
2. Correlate local renderer crash reports and recovery diagnostics by timestamp/PID. Distinguish confirmed process failure from inferred memory exhaustion. Do not infer causes from poorly symbolicated native frames.
3. Identify whether displaying storage totals reads large analysis records, serializes them, duplicates memory, runs parallel scans, or leaves work running after leaving the tab.
4. Exercise the actual scanner in a disposable Electron profile with bounded synthetic IndexedDB records. Check timeout behavior, sizing failures, and representation expansion. Never intentionally exhaust memory.
5. Run existing relevant tests. Record reproducible findings, limitations, source locations, and prioritized corrections in docs/reviews.

Do not read or change user database contents, clear storage, interrupt the user's app, or change application behavior. Create only the investigation prompt, isolated diagnostic, and report. Do not commit, push, or release. Preserve saved analyses and checkpoints. Do not claim a production crash has been reproduced unless it has.
