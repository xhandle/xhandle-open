# Desktop diagnostic memory follow-up — 2026-11-02

The [focused implementation prompt](../codex-prompts/resolve-desktop-diagnostic-memory.md) investigates the native-memory check left open by the first crash-diagnostics implementation. Deployment remains on hold during validation. No commit, push, source-pin change, signing or update publication is part of this task.

## Measurement correction

The previous harness unmounted the active table/diagram in its `finally` block before measuring retained memory. Its native-footprint result therefore mixed collector cost with diagram teardown and GPU resource retirement. Five independent enabled/disabled pairs produced a 19.45 MiB difference between group medians, but did not establish which allocations caused that difference.

The revised harness keeps the diagram mounted through memory measurement and verifies the mounted node count. It takes five native samples per measurement, labels processes using Electron's actual PID/type mapping, and records a pre-workload baseline. The comparison reports individual paired differences and a deterministic paired-bootstrap interval for the mean; repeated samples within one process are never treated as independent runs. The bootstrap describes variation among tested runs, not uncertainty across all hardware/workloads.

The new workload uses 15,000 source rows and derived software requirements, 3,000 deterministic synthetic AI requests, actual checkpoint/storage/panel modules, 120 table-scroll updates with final-row verification, saved-table reopening, and a mounted Functional-presentation diagram with 1,500 relationships / 1,504 rendered nodes and 360 synthetic wheel inputs. No external provider requests or customer project contents are used. Frozen renderer bundles avoid including webpack compiler memory in the measured Electron main process. The compile/warmup run is excluded from comparisons.

## Collector retention experiment

A separate Node process fills the actual journal/flight recorder eight times with 600 synthetic operation failures per round, each carrying four bounded stacks. It also fills the 120 resource-sample and 100 breadcrumb limits. This is an adversarial collector-retention experiment, not a realistic user error rate or an Electron renderer benchmark.

All 4,800 failures completed with no persistence errors and a maximum of one pending writer. The journal stayed at 2,072,733 bytes, flight file at 134,762 bytes, retained entries at 81 (the byte cap was reached), samples at 120, and breadcrumbs at 100. Retained JavaScript heap measured 7.54 MiB after first fill and 7.94 MiB after eighth fill. Native footprint increased from 61.15 to 86.82 MiB across these rounds despite the bounded live heap; this short flood experiment does not establish an hours-long native plateau or leak absence.

Raw evidence: `/private/tmp/xhandle-diagnostic-retention-soak/` and `/private/tmp/xhandle-diagnostic-mounted-comparison/`. The retention harness is `scripts/diagnostics/soak-desktop-diagnostics.cjs`.

## Implementation change

The recorder previously sanitized an error cause chain twice, independently building the same bounded stack strings for the journal and latest-failure context. It now sanitizes once and reuses that immutable internal result. Report contents, redaction, retention, sampling, persistence and UI behavior are preserved. No crash evidence was removed. Shared application source was not changed during this follow-up.

The sixteen workflow runs below were completed before this error-path optimization; source and renderer-bundle fingerprints stayed unchanged throughout. Successful operation recording follows the same path before/after the optimization. The final collector profiles, retention repeat and desktop regressions exercise the optimized recorder. The flood repeat retained identical journal/flight byte sizes and bounds, with no write failures. Its final live JS heap measured 7.42 MiB, while native footprint reached 88.04 MiB. A single before/after flood run does **not** establish a native-memory improvement, and these results do not promise a 16 MiB ceiling during pathological error bursts.

## Larger mounted-view comparison

Eight alternating run pairs (sixteen fresh profiles) all completed without crashes or lost requirements. Every run reached the final saved row, reopened results without additional AI requests, changed the real diagram viewport, and retained 1,504 mounted diagram nodes during memory measurement.

Corrected November 3: even-sized group medians now average the two middle observations. The table below was regenerated from the original sixteen cases; no new workloads were run. The [corrected summary](desktop-diagnostic-memory-corrected-2026-11-03.json) identifies the original cases/summary by SHA-256. The earlier upper-middle calculation is preserved in the original raw summary for audit. Paired means and bootstrap intervals are unchanged.

| Metric — group medians | Disabled | Enabled | Difference |
| --- | ---: | ---: | ---: |
| Timed workload | 29,341.3 ms | 29,269.6 ms | −0.244% |
| Process CPU | 29.091 s | 29.082 s | −0.032% |
| Retained renderer JS heap | 125.098 MiB | 125.132 MiB | +0.034 MiB |
| Synthetic input-loop p95 | 31.8 ms | 30.85 ms | −0.95 ms |
| Largest event-loop delay | 387.7 ms | 380.35 ms | −7.35 ms |
| Settled aggregate native footprint | 924.327 MiB | 917.687 MiB | **−6.640 MiB** |
| Diagnostic bytes written | 0 | 1,244,672.5 | approximately 1.19 MiB |

Small timing improvements are noise, not a claimed speedup. The previously used median-based checks all pass on this workload. Native memory still varies substantially between independent processes: paired differences range from −95.64 to +76.19 MiB. The paired mean is −15.87 MiB with a 95% paired-bootstrap interval of **−48.64 to +19.56 MiB**. The pre-workload-adjusted mean is −19.19 MiB with an interval of −52.24 to +16.55 MiB. Thus the experiment does not establish a hard 16 MiB upper bound, and negative differences do not mean diagnostics save memory.

The Electron Browser/main-process paired mean increase is 1.86 MiB (bootstrap interval 0.99–2.85 MiB). The local crash handler uses approximately 2.35 MiB. Most aggregate variation is in the renderer's native footprint: its paired differences range from approximately −93 to +93 MiB, while retained JS heap stays similar. GPU variation also remains. The earlier 19.45 MiB aggregate point estimate was not reproduced as a consistent regression; it cannot be attributed entirely to collector allocations.

## Controlled final recorder profiles

Five additional alternating fresh-process pairs use the optimized native recorder and local crash handler without application rendering. Each enabled process records synthetic checkpoint events/errors, a full 120-sample resource history and 100 breadcrumbs, then persists and measures after test-only collection. This isolates direct collector cost; it does not measure diagram/IPC rendering interactions.

Across the five pairs, added main-process plus crash-handler footprint is **4.56–5.30 MiB**, with a median of **5.27 MiB**. The median main-process contribution is 2.91 MiB and crash handler 2.36 MiB. Added live main JS heap is approximately 0.424 MiB. Every enabled process retained its input and wrote successfully, with at most one pending writer. Raw evidence: `/private/tmp/xhandle-recorder-profile-comparison.log`; harness: `scripts/diagnostics/profile-desktop-recorder.cjs`.

## Verification and disposition

All **37 desktop regression tests passed again** after the optimization. Matching unpackaged and packaged smoke checks passed again, including actual sandboxed renderer crashes, valid local minidumps, matched pre-crash operation PID/workload data, copied reports while the renderer was dead, and reload recovery. Restart after forced termination of a separate disposable main process recovered persisted flight evidence again. Both repositories passed whitespace checks; the modified collector and all diagnostic harnesses passed JavaScript syntax checks. The previously passed 52 shared tests/frontend build are documented in [the original report](desktop-crash-evidence-2026-11-02.md); they were not rerun because this follow-up changes no shared runtime/UI code.

Final verification logs: `/private/tmp/xhandle-diagnostic-memory-native-tests.log`, `/private/tmp/xhandle-diagnostic-memory-unpackaged-smoke.log`, `/private/tmp/xhandle-diagnostic-memory-packaged-smoke.log`, and `/private/tmp/xhandle-diagnostic-memory-restart.log`. The final packaged fixture is explicitly unsigned/unreleased with working-tree provenance. It does not replace the installed application or the user's existing preview.

The original aggregate-memory observation has been investigated: the larger workload passes the original point-estimate checks, and controlled recorder cost is small. No reproducible workflow slowdown or sustained live-JS growth was identified. Native allocator behavior under severe direct error floods remains a documented limit, and the workflow confidence interval remains too wide to promise an absolute 16 MiB bound. There is no evidence here supporting removal of useful crash diagnostics to reduce diagram/renderer allocation variance.

These findings support continuing normal release preparation and a representative large-project acceptance run; they do not make an unsigned fixture a production release. Customer M4/16 GiB hardware, the full 634 MB retained workspace, physical trackpad/compositor latency, hours-long native-memory behavior, and Windows/Linux were not tested. No commit, push, source pin or desktop update was published.

Reproduction: compile a warmup with `XHANDLE_STRESS_COUNTS=15000`, `XHANDLE_STRESS_DIAGRAM=1`, `XHANDLE_STRESS_DIAGRAM_ROWS=1500`, `XHANDLE_STRESS_KEEP_MOUNTED=1`, and `XHANDLE_STRESS_NATIVE_SAMPLES=5`. Run `compare-desktop-diagnostics.cjs` with those options, `XHANDLE_COMPARE_PAIRS=8`, `XHANDLE_DESKTOP_ROOT` set to the private shell and `XHANDLE_STRESS_BUNDLE` set to the warmup's `stress.js`. Run `profile-desktop-recorder.cjs` with Electron in fresh processes alternating `XHANDLE_DIAGNOSTICS_ENABLED=0/1`; the retention experiment uses Node `--expose-gc`. Explicit GC and precise-memory switches are benchmark-only settings.
