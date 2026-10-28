# Workspace memory fixes — October 27, 2026

Implemented `docs/codex-prompts/fix-workspace-memory-instability.md`, preserving the earlier pending Storage inventory fix and all saved user data.

## Implemented

- Hidden-window backup events now use the same enabled/folder/permission gate as scheduled backups. Destination permission is checked before building a snapshot. An unavailable destination no longer causes an expensive workspace read first.
- Backup requests share a single in-flight operation. A request for a different output mode reports that a backup is already running instead of silently producing the wrong output. Dirty revisions arriving during a successful backup remain dirty and schedule one later automatic backup when permitted. Failures and unavailable destinations do not create an automatic retry loop.
- Startup/folder permission checks no longer read and parse the entire previous backup merely to display its summary. Explicit restore still reads that file; the Restore action remains available when a folder is configured.
- Hazard restoration receives an AbortSignal, cancels superseded reads, and waits for the previous read to retire before beginning a replacement. Blocked database opens have a timeout; late connections close. Chunk hydration aborts its readonly transaction, preserving the existing snapshot-consistency and integrity checks.
- Read/save paths now close their owned database connections. Hydration reports progress; UI progress updates are limited to percentage changes.
- Architecture-only navigation no longer automatically restores a large hazard run. Safety, requirements, design, and traceability views request it when needed. Opening diagram node/edge details requests hazard loading through both architecture diagram paths so hazard links still populate on demand. An already-loaded run is not discarded merely because the user changes tabs, protecting edits and active analysis.
- Removed the module-global prepared-view snapshot. The mounted view retains its existing editing state, but unmount no longer leaves that extra prepared sheet and its input references in a global cache. Re-entry may require preparation again; this is an intentional memory-versus-reentry-latency tradeoff.
- The prior count/key-only, cancellable Storage inventory changes remain in the working tree.

## Verification

151 focused tests passed across 18 suites after correcting the new diagram fixture to use an explicit architecture abstraction. Coverage includes backup trigger/destination gating and single-flight behavior; startup without backup-file reads; blocked-open timeout and late connection closure; restoration cancellation, stale publication and progress; saved partial-result preservation; chunk integrity and replacement; run registry ownership; table preparation; diagram callbacks and traceability; selected import regressions; inventory and selective cleanup.

The prior prepared-snapshot test expected a global cache to survive unmount. It now verifies the intended release/reprepare behavior instead; within-view update tests still pass. Investigation characterization tests were converted to prevention checks.

The isolated Electron diagnostic (`scripts/diagnostics/audit-hazard-restoration-memory.cjs`) successfully cancelled a real chunked read and subsequently restored all 2,000 synthetic rows unchanged. It used a fresh temporary profile and never opened the user's workspace. The diagnostic deliberately also calls the getter concurrently to characterize direct callers; those independent calls still return independent objects. The UI restoration hook, rather than a global shared-result cache, enforces retirement before Retry.

Production build validation is recorded in the completion message. No desktop package was installed, no release was published, and no user profile was modified.

## Remaining limits

These changes address the confirmed accidental background work, overlapping restoration retries, and unnecessary retention. They are not proof that arbitrarily large projects cannot exhaust memory. An explicitly requested backup or a legitimately enabled/configured automatic backup still builds a legacy whole-workspace snapshot. A single opened hazard view still hydrates a whole run; very large legacy records cannot be interrupted during native structured cloning. Streaming legacy backups and page-backed hazard viewing remain the structural next steps for bounding memory independent of total data size.

The user's previously crashing workspace, long-running AI generation, actual laptop sleep/wake, and Safari-specific runtime behavior have not been retested. Validate an updated packaged Desktop against that workspace before claiming the production crashes are resolved. Preserve the same app identity/profile and do not clear saved projects as part of rollout.
