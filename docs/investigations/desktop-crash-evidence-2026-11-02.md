# Desktop crash evidence and overhead — 2026-11-02

The [implementation prompt](../codex-prompts/strengthen-desktop-crash-diagnostics.md) was executed locally. Crash reports now retain more causal evidence, including native dump availability, operation boundaries, workload sizes, preceding error stacks/cause chains, renderer heartbeat data, and system/process resource history. This improves investigation; it cannot guarantee the root cause of every crash.

No commit, source-pin update, signing, notarization, or desktop release was performed.

The [memory follow-up](desktop-diagnostic-memory-followup-2026-11-02.md) supersedes the initial memory disposition below. A corrected mounted-view benchmark, sixteen larger workflow runs, controlled collector profiles, and an error-allocation optimization are documented there, including remaining uncertainty and final recovery verification. The original measurements remain here as historical evidence.

## Implemented

- Electron native crash capture starts before child processes are created, with uploads explicitly disabled. A session identifier is attached to native reports. The native collector retains at most eight dump files / 100 MiB / 14 days, pruning on startup and evidence inspection.
- Native reports preserve the renderer PID when it was observed alive, session identity, and timestamp-based candidate dump identifiers. Timestamp candidates are explicitly **not** presented as confirmed process matches. Dump inspection/symbolication may still be necessary. Binary dump contents are never included in copied text; Help provides an explicit local-folder action and explains that dumps can contain memory fragments.
- A separate bounded flight file persists recent context, up to 120 resource samples and 100 operation breadcrumbs. An unclean subsequent launch recovers the previously persisted evidence, including prior build identity. Recent unsaved data can still be lost if the main process is abruptly killed.
- Resource sampling runs every five seconds: Electron process CPU/working sets, OS memory information, and system CPU utilization. On macOS, a bounded asynchronous OS query additionally samples swap and raw memory-pressure state at most every 15 seconds. Unsupported measurements remain unavailable rather than being invented. Working sets are not labeled physical footprint. Renderer heap/timer-delay heartbeats run every five seconds; timer delays can also reflect sleep/background suspension.
- Shared instrumentation records requirements derivation, merge, read/save, hazard-source loading, checkpoint storage, an architecture read path, ELK layout, and diagram preparation/scene sizes. It uses fixed labels and numeric sizes; it does not serialize project rows or prompts. Frequent checkpoints are sampled. Cancellation and thrown values preserve existing application control flow.
- Main-world exception/rejection hooks retain actual JavaScript stacks and bounded cause chains. Caught React rendering errors are reported explicitly. Console capture forwards original arguments/results and collects bounded **errors only**. It ignores arbitrary object payloads, coalesces bursts, and snapshots a bounded string packet rather than retaining mutable Error/request objects while throttled.
- Normal persistence is batched and asynchronous. Journal size accounting avoids repeatedly serializing the entire log per event. Only one normal writer is active; stale asynchronous writes cannot overwrite newer emergency evidence. Failures back off, remain visible, and do not stop analysis. Fatal/recovery flushes retain an emergency synchronous path.
- Existing Help, copy, reload, close, and natural-language build information behavior is retained. The compatibility `last-renderer-crash.json` remains, but the Help journal/copied report may contain later native-file discovery that the initial compatibility file does not.

The native console observer used by the first debug-log implementation was removed: it received every AI informational message even though it only saved errors. Error-only capture avoids that per-batch cross-process traffic.

The native implementation uses Electron's [documented local-only crash capture](https://www.electronjs.org/docs/latest/api/crash-reporter), with `uploadToServer: false`. It does not continuously CPU-profile execution or automatically take full heap snapshots.

## Verification

- **37 desktop tests passed**, covering existing desktop behavior plus bounded records, credential redaction, flood handling, slow/failed disk writes, emergency-write ordering, restart reconstruction, platform fallbacks, and crash retention.
- **52 shared tests passed** across diagnostic helpers, Activity reporting, requirements-panel/read recovery, and architecture diagram rendering/interaction regressions.
- Production frontend build passed, with existing repository warnings.
- Full unpackaged and packaged smoke checks passed using matching, isolated, explicitly unreleased validation fixtures. They exercise the existing API/SQLite/storage/workers/update UI checks, debug-log UI, real clipboard, reload/close behavior, and a **genuine native renderer crash**.
- The genuine-crash check crashed the actual disposable sandboxed workspace through the DevTools protocol. It required a newly observed dump with a valid `MDMP` header, matching renderer PID on the preceding 75,000-row operation metadata, resource/heartbeat evidence, and (in the packaged current frontend) full main-world error stacks. Dump collection remained local-only.
- A separate Electron main process was forcibly terminated after flight data was persisted, then restarted. It recovered the recorded operation size, renderer heartbeat and resource history into a report.

The normal clean/published/pinned production build pipeline was not bypassed to produce a release. Temporary unsigned validation apps included explicit working-tree provenance and current compiled frontend assets. macOS arm64 was exercised; Windows/Linux production behavior remains unverified here.

## Performance comparison

Final measurements used five alternating enabled/disabled pairs, each in a fresh profile, on the local M2 / 8 GiB Mac. Source fingerprints were unchanged throughout the final comparison.

Each run derived and saved 5,000 requirements using deterministic local AI responses, scrolled to the final table row through 120 updates, reopened saved results, and exercised the actual shared Functional-presentation diagram with 500 relationships / 504 rendered nodes and 360 synthetic wheel inputs. No provider requests or customer data were used.

| Metric — median of five runs per state | Disabled | Enabled | Difference |
| --- | ---: | ---: | ---: |
| Timed workload | 15,323.8 ms | 15,315.6 ms | −0.054% |
| Electron process CPU time | 11.042 s | 10.921 s | −1.09% |
| Diagram input-loop p95 interval | 19.7 ms | 19.7 ms | 0 ms |
| Largest event-loop delay per run | 96.1 ms | 90.3 ms | −5.8 ms |
| Retained renderer JS heap | 24.198 MiB | 24.260 MiB | +0.062 MiB |
| Aggregate native process footprint | 536.30 MiB | 555.76 MiB | **+19.45 MiB** |
| Diagnostic bytes written per case | 0 | 217,320 | approximately 212 KiB |

Small negative time/CPU differences are measurement noise, **not evidence of a speedup**. No slowdown or input-loop regression was observed in this workload. Every case retained its expected rows, reached the final row, changed the real diagram viewport, and reopened its saved data. Enabled cases verified that native IPC actually recorded operations; disabled cases made no diagnostic writes.

The native-memory point estimate remains above the initial 16 MiB target, so that gate is **not cleared**. Investigation found a median Browser-process increase of approximately 0.72 MiB and a separate crash handler using approximately 2.34 MiB. GPU and renderer native allocations varied substantially: disabled GPU samples ranged approximately 179–253 MiB, while enabled samples ranged 200–226 MiB. These results do not isolate the entire aggregate difference as either instrumentation cost or allocator/GPU variation. Do not describe the implementation as zero-overhead or fully signed off for production.

The heap/steady native measurements were taken after an idle period and explicit **test-only** garbage collection; production does not force GC. The diagram timing is a synthetic input-dispatch interval, not compositor frame time or a physical-trackpad latency measurement. The tested diagram/project sizes are smaller than the customer's full retained workspace. No hours-long leak test or customer-sized production-memory sign-off was completed.

The next release validation should repeat native memory and real navigation measurements on the customer's M4 / 16 GiB class of machine with representative retained project/hazard data, or establish that the observed native cost is acceptable. Preserve the current release hold until that decision and the normal source publication/pin/release checks are complete.

## Evidence and reproduction

- [Exported final comparison summary](desktop-crash-diagnostics-overhead-2026-11-02.json).
- Public harness: `scripts/diagnostics/stress-software-requirements-desktop.cjs`.
- Public paired runner: `scripts/diagnostics/compare-desktop-diagnostics.cjs`; set `XHANDLE_DESKTOP_ROOT` and `XHANDLE_STRESS_BUNDLE` from a successful diagram-enabled warmup. Each mode uses a separate process because native crash capture cannot be disabled after initialization.
- Final raw cases, fingerprints and process samples: `/private/tmp/xhandle-evidence-error-only-comparison/`.
- Test/build logs: `/private/tmp/xhandle-evidence-native-tests.log`, `/private/tmp/xhandle-evidence-shared-tests.log`, `/private/tmp/xhandle-evidence-frontend-build.log`.
- Recovery logs: `/private/tmp/xhandle-evidence-unpackaged-final-smoke.log`, `/private/tmp/xhandle-evidence-packaged-final-smoke.log`, `/private/tmp/xhandle-evidence-restart.log`.
- Earlier pilot/native-memory investigations remain in `/private/tmp/xhandle-evidence-comparison/` and `/private/tmp/xhandle-evidence-comparison-final/`; their measurements were superseded by the final error-only implementation above.
