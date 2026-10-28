# Investigate severe Desktop lag and repeated renderer crashes

The user's current xHandle Desktop instance is nearly unusable after running many large hazard analyses and importing large projects. It is very laggy and repeatedly crashes. Determine the causes with evidence and propose a prioritized remediation plan. Investigate the whole workspace lifecycle, not just Settings → Storage.

## Protect the existing workspace

- Begin with read-only source, version, process, log, and crash-report inspection. Do not clear storage, delete projects/checkpoints, reset the profile, reinstall, kill the application, or restart analysis.
- Do not trigger full exports, whole-database scans, heap snapshots, or large record deserialization in the struggling live renderer merely to diagnose it. These operations can worsen memory pressure.
- Do not access API credentials or include project contents in reports. Report sizes, counts, timings, identifiers where needed, and sanitized stack information.
- Reproduce with bounded synthetic fixtures in disposable profiles. Any investigation requiring a copy of real user databases must first establish a consistent, safe copying procedure; never treat an arbitrary copy of an active database as a reliable backup.
- Preserve existing uncommitted changes. This task is investigation and diagnostic tooling only: no production behavior changes, migrations, commits, pushes, or releases.

## Establish exactly what is running

1. Read applicable repository instructions. Inspect both the shared xhandle-open repository and the private xhandle-desktop shell as appropriate.
2. Record the installed application version, Electron/Chromium versions, architecture, process IDs, source/build provenance where verifiable, and whether duplicate instances exist. Distinguish installed code from working-tree changes.
3. Review the recent Storage crash investigation and pending Storage inventory fix. Determine whether that fix is actually present in the installed application. Do not assume unreleased changes protect the current instance.
4. Correlate renderer recovery records, macOS crash reports, application logs, CPU activity, process memory, and system memory pressure by timestamp and PID. Distinguish JS heap, process working set, physical footprint, and disk storage. Distinguish high CPU/event-loop blockage from memory exhaustion, GPU failure, or storage waits. Exit code 5 alone is not proof of out-of-memory termination.

## Trace memory and workload across the application

Map triggers, data sizes, ownership, duplication, lifetime, and cancellation for:

- Startup and reopening the workspace: active-project restoration, eager hydration of inactive projects, background migrations, backup initialization, workspace-graph synchronization, and diagnostics.
- Opening or switching projects/tabs: architecture/functional graph creation, table preparation, hazard restoration, requirement/design data, search/traceability indexes, derived structures, React state, memoization, module-level caches, and workers.
- Saved hazard runs: loading thousands of results, reconstructing chunked/legacy records, parsing and normalizing sheets, rebuilding evidence and indexes, planning continuation, checkpoint histories, and retaining previous snapshots.
- Running/continuing large analyses: request concurrency, retry queues, evidence preparation, deferred rows, intermediate model responses, logs/metrics, checkpoint writes, serialization, structured cloning, IPC, and worker transfers.
- Sleep/wake and interruption: expired requests, stalled transactions, duplicate schedulers, abandoned work, overlapping restoration retries, and cancellation after navigation or unmount.
- Project import: streaming versus full buffering, decompression, rehydration of compact references, expansion of shared/sparse data, cross-project duplication, staging/rollback records, incomplete imports, and caches that survive completion or cancellation.
- Storage management and backups: inventory scans, record labeling, scheduled backup/export work, repeated whole-record reads or writes, and background work that remains active when Settings closes.

Identify whether current memory grows with the active project, all projects, historical runs/checkpoints, number of imports, or repeated navigation. Separate necessary resident data from avoidable copies and retained data. Do not call high memory alone a leak: demonstrate retained growth across repeated comparable operations or identify a retention path.

## Use safe, discriminating experiments

Create a staged reproduction matrix in isolated profiles:

1. Empty workspace at idle.
2. One large synthetic architecture project.
3. The same project with a large partially completed hazard run.
4. Multiple large projects, with only one active.
5. Import, navigate away, return, and repeat.
6. Continue/cancel/restore a hazard run; test navigation and simulated interruption.
7. Settings/Storage and background backup work separately.

Use conservative fixture sizes initially, bounded run durations, and explicit stop conditions. Do not intentionally exhaust the machine's memory. Record startup and restoration latency, event-loop responsiveness, peak and settled memory, outstanding tasks, and memory after navigation/cleanup. Avoid measurement methods that themselves retain large objects. Do not force GC and then present its results as normal user behavior.

For each suspected cause, seek a minimal discriminating test: for example, hold the active project constant while increasing inactive-project count, or repeat restoration without importing anything. Where feasible, use the installed-version code and the local source separately to establish whether pending fixes address the observed behavior.

If live telemetry is unavailable, state that limitation and proceed with source tracing and synthetic reproduction. Ask the user only for missing details that materially distinguish causes and cannot be obtained safely from available evidence.

## Deliverables

Write a report under docs/reviews containing:

1. A concise explanation of the most likely causes of the currently installed app's lag/crashes, with confidence levels and competing explanations.
2. Confirmed defects ranked by severity, exact source locations, triggering conditions, and reproducible evidence. Clearly separate confirmed behavior from hypotheses.
3. A memory/data-flow map showing where large objects are loaded, duplicated, persisted, and released.
4. A test matrix with actual measurements and explicit coverage gaps; do not claim a production-scale crash is fixed merely because small tests pass.
5. A prioritized correction plan: immediate narrowly scoped fixes, then structural work needed for reliably large analyses. Prefer bounded reads, lazy loading, incremental processing/checkpoints, and deterministic cleanup over simply increasing heap limits.
6. A data-preserving recovery path for the existing affected workspace, including whether an updated build could open it without eagerly loading the problematic records. Specify any action requiring separate user authorization.
7. Regression criteria covering partial-result preservation, continuation without duplicated work, import/export fidelity, project isolation, and cleanup/cancellation in Desktop, Chrome, and Safari where relevant.

Report what was and was not run. Do not promise that all crashes are eliminated or recommend deleting the user's work as a diagnostic shortcut.
