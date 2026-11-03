# Review pending desktop release changes and run regressions

Review all pending tracked and untracked changes in `/Users/Nick/xhandle-open` and the private `/Users/Nick/xhandle-desktop` checkout. Establish the actual diff against each current HEAD, include new files, and read applicable repository instructions. Preserve unrelated work, the installed application, the running preview and user project data.

This is a review and verification task. Do not fix application code, commit, push, update the shared-source pin, sign, publish or change the update feed. Save the review findings and evidence. Temporary isolated reproductions/test artifacts are allowed. Do not spawn additional agents unless separately authorized.

The user explicitly excluded Chrome-versus-Electron responsiveness differences as a blocker for this release. Record that as separate follow-up work; do not silently reinstate it as a gate. The approved debug-log default is **Crashes and fatal errors**, with broader error/activity filters and full supporting context retained in actual crash reports.

## Review priorities

- Crash/fatal classification: real renderer/process crashes, terminal main/startup failures and root React rendering failures remain visible; routine activity and warnings do not become misleading error reports. Filtering and clipboard export must agree, including existing journal data and rapid filter changes.
- Evidence integrity: original exception identity/control flow, stacks and bounded causes, operation sizes, renderer identity, recent activity, native dump availability, resource history and restart recovery. Do not infer specific causes from exit codes, unclean shutdowns or system swap alone.
- Persistence/concurrency: bounded retained state and queues, asynchronous batching, failure/backoff behavior, emergency writes versus slow older writes, cleanup, corrupt files, and recovery when the renderer or main process dies. Diagnostic errors must not interrupt analysis or recovery.
- Performance/regressions: no per-row/per-frame telemetry, no retained project/request objects, sensible event limits and optional/no-op browser behavior. Shared instrumentation must preserve reads, saves, checkpoints, cancellations, requirements derivation and diagram/table interactions. Inspect diagnostic harness validity separately from product correctness.
- Security/privacy/packaging: narrow trusted IPC, frame and navigation checks, redaction, local-only native dumps, no secrets/data in source/artifacts, private/native versus public/shared ownership, readable build information and accurate provenance. Distinguish local unsigned validation fixtures from production packages and published updates.

## Checks

1. Run both repositories' whitespace checks, the full desktop Node test suite, and targeted shared suites covering changed helpers/components and their storage/derivation/checkpoint/diagram boundaries. Use deterministic local mocks and disposable test data, not paid provider calls or customer databases.
2. Run or verify matching full and packaged smoke coverage for fatal-default filtering, filtered/redacted clipboard exports, real native-crash evidence, root-render failure visibility and recovery. Do not rebuild a fixture currently used by the user's running preview. If using prior evidence, verify code/build correspondence and clearly label it as prior rather than newly run.
3. Decide whether a frontend rebuild or additional cases are necessary based on the actual diff and existing verified build. Avoid repeating expensive benchmark matrices unless a new failure or unresolved code concern justifies them. State platform, workload, signing and update-install limitations accurately.
4. For each material issue, provide severity, a concrete trigger, impact and a precise file/line reference. Confirm suspected issues with a focused isolated reproduction when feasible. Passing tests do not override a demonstrated bug. Do not manufacture findings or claim a proof of no regressions.

Report review findings first, then new checks and their outcomes, relevant previously verified checks, waived/out-of-scope concerns and the remaining release steps. Say whether the changes are ready to commit/build, with any blockers clearly separated from normal release preparation. Do not claim deployment occurred.
