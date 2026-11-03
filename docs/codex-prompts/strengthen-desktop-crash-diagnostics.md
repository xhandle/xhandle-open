# Strengthen desktop crash diagnostics without changing workspace behavior

Implement and run this task in xhandle-open and its private desktop shell. Preserve all current working changes, the user's installed data, and the current tab/table/diagram experience. Do not commit, publish, or release an update as part of this task.

## Outcome

Help → Debug log and Copy crash details must preserve substantially better evidence of what preceded a crash, while clearly separating recorded facts from unconfirmed causes. No logger can guarantee every crash's root cause.

## Implementation

1. Enable Electron native crash capture locally, before child processes are created. Disable uploads explicitly. Retain bounded native dump files separately from redacted text; never automatically copy or upload their binary contents. Correlate by session, timestamps and process identity without claiming an approximate timestamp match is certain. Expose availability or collection failure honestly.
2. Maintain a bounded flight recorder outside the renderer. Include CPU/memory samples, OS memory/swap/pressure information where supported, renderer heap and event-loop responsiveness, recent operations, workload counts, checkpoint boundaries, error codes/stacks and bounded cause chains. Use explicit units. Do not infer an OOM solely from an exit code or low free memory.
3. Instrument important code-architecture operations, software-requirements derivation, checkpoint/save/read boundaries and diagram preparation/layout. Collect numeric sizes and fixed operation labels, not prompts, rows, source contents, credentials or request bodies. Preserve thrown errors and existing application control flow.
4. Persist recent pre-crash evidence in bounded, batched asynchronous writes; retain an emergency path for fatal events and recovery after an unclean main-process shutdown. Diagnostic failures, unavailable platform metrics, slow disk and corrupt history must not interrupt analysis. Avoid unbounded queues, per-row/per-frame IPC, synchronous whole-journal serialization on every event, continuous CPU profiling, or automatic heap snapshots.
5. Keep the existing Help log, readable build dialog, clipboard controls, and reload/close behavior. Reports must identify missing evidence and unknown causes rather than guessing. Native dumps may contain memory fragments and require explicit handling before sharing.

## Acceptance checks

- Test structured event validation/redaction, bounded retention/queues, rate limits, concurrent/slow/failed writes, error propagation, optional browser behavior, and unsupported platform metrics.
- In disposable Electron profiles, trigger a genuine native renderer crash and confirm a valid local minidump, pre-crash operation/resource evidence, copied report, and recovery. Verify collection is local-only. Test restart reconstruction of previously persisted evidence. Never crash the user's running workspace.
- Compare diagnostics enabled/disabled using the same deterministic synthetic workload with paired repeat runs. Cover derivation/checkpointing, saving, table scrolling and diagram-like navigation; use actual application modules where feasible and state synthetic harness limits. Measure elapsed time, UI/event-loop delays, JS/native memory, CPU and diagnostic disk writes.
- Investigate median elapsed-time regression above 5%, added steady diagnostic memory above 16 MiB, or repeatable responsiveness degradation. Do not call noisy or incomplete measurements proof of zero overhead. State untested workloads/platforms explicitly.
- Run relevant shared tests, desktop tests, production frontend build, and full/packaged desktop smoke checks. Use isolated unreleased validation packages when source changes have not been committed/pinned for production.
- Report actual measurements, completed capabilities, remaining evidence limits, and release status. Do not claim every cause can now be established.
