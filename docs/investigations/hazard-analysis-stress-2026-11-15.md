# STPA and HARA stress testing — 2026-11-15

All 20 logical completion scenarios passed after fixes. The four largest scenarios failed the separate 2-second GUI responsiveness gate. This is **not** an all-green release result.

The [machine-readable results](hazard-analysis-stress-2026-11-15.json) retain request counts, memory samples, timing, recovery proof and raw report locations. Tested production-source fingerprint: `f6f477161766d629f28df00611ac3a2a97f5d64128f02350320b3cd668660cac`. The source did not change during the final runs.

## Coverage

- Projects and Code-Based Architecture, each with STPA and HARA.
- 32, 256 and 1,500 functional interfaces; three operational contexts and seven guide phrases produce 672, 5,376 and 31,500 assessment rows per run.
- Real production dispatchers, provider fetch/response handling, validation, repair stages, Electron IndexedDB, checkpoints and final persistence. Code completion waits for the committed record and bypasses the unsaved memory result when reloading.
- Exact row counts, unique assessment identities, explained applicability, required hazard/constraint fields, supported HARA fields and deterministic S/E/C-to-ASIL calculation. Explained `Needs Review` results are allowed; silent assumption-based fallback is rejected.
- Four injected fault types in every area/method combination: truncated output, malformed JSON, missing row and temporary HTTP 429. All four fault scenarios recovered and completed without assumption-based substitution.
- Cancellation after a full assessment has actually committed, followed by a page reload and continuation. All four scenarios completed; Projects reused 16 committed assessments per method, Code reused one per method, with zero repeated generation of those committed IDs. An in-flight reply is deliberately not treated as saved work.
- A real button-click probe and 25 ms renderer timer monitor input responsiveness throughout generation and persistence.

The separate live Electron UI harness passed **16 checks**, including method selection, Operational Mode/Operating Conditions, HARA fields/FTTI, editable rating recalculation, searchable multiselect filtering, exports, reload, and HARA truncated-batch/singleton recovery. The focused regression gate passed **1,520 tests across 156 suites**. All four provider-fixture unit tests passed.

## Largest completed runs

| Area | Method | Saved/reloaded assessments | Elapsed | Longest renderer timer gap | Sampled peak JS heap |
| --- | --- | ---: | ---: | ---: | ---: |
| Projects | STPA | 31,500 | 45.3 s | 2.57 s | 1.43 GiB |
| Projects | HARA | 31,500 | 149.6 s | 14.28 s | 1.97 GiB |
| Code-Based Architecture | STPA | 31,500 | 121.5 s | 3.65 s | 1.68 GiB |
| Code-Based Architecture | HARA | 31,500 | 159.8 s | 3.70 s | 2.34 GiB |

Each completed with zero assumption-based fallback rows. All eight 672/5,376-row normal scenarios passed both completion and responsiveness checks; their maximum timer gaps were below 640 ms.

The large Projects HARA rerun recorded a 5-second input timeout but continued to verify final save/reload successfully. The earlier runner incorrectly ended the test at that input timeout; its incomplete completion measurement is superseded by the rerun, not counted as an application completion failure. Small recovery tests overlapped part of that rerun, so its wall time is not an isolated benchmark.

## Confirmed defects fixed

1. **Assessment ID collisions.** A 31,500-row Projects STPA run produced the same legacy 32-bit hash for distinct interfaces and guide phrases. New raw assessment IDs now use a 96-bit SHA-256 prefix. Existing saved IDs and other concept-ID formats remain unchanged. The exact collision pair has a regression test.
2. **Projects lacked request-level durable checkpoints.** The App now supplies a Projects-scoped checkpoint to the existing production generator. Reuse is bound to exact inputs, prompt/policy context, provider, model and effort; explicit regeneration clears only that scope.
3. **Quadratic HARA save/recalculation work.** Individual HARA assessment batches remain durable, while full-workbook publication is bounded by row count/time. Completed ratings are flushed on cancellation/failure. Repeated column scans and duplicate recovery snapshots were removed. Scaling/reuse/cancellation regression tests pass.

## Remaining issue

Large finalization, serialization and readback still cause multi-second renderer stalls and high memory use, especially Projects HARA. Analysis completion is verified, but the GUI responsiveness gate must remain red. Further work should move whole-workbook transformations/serialization off the renderer and reduce duplicate full snapshots/readback allocations, then rerun this harness. This test did not capture a CPU profile sufficient to attribute every pause to a single function.

## Reproduce

Run from the shared source repository with Node 22 and an installed native checkout/Electron and Playwright. Use a fresh output directory. Without `--stage`, the runner builds a production renderer/native stage and checks its source fingerprint.

```sh
node scripts/diagnostics/run-hazard-stress.cjs \
  --desktop ../xhandle-desktop \
  --playwright /path/to/playwright-core \
  --out /tmp/xhandle-hazard-stress-fresh \
  --sizes 32,256,1500 \
  --areas projects,code \
  --methods STPA,HARA \
  --faults true \
  --resume true \
  --continue-on-failure true

node --test scripts/diagnostics/hazard-stress-provider.test.cjs
```

`--stage /path/to/verified/desktop` reuses a stage only when its fingerprint matches current production source. `--sizes none --resume true` runs recovery cases alone. `--case-timeout-ms` defaults to ten minutes; `--max-gui-gap-ms` defaults to 2,000 ms. A nonzero exit preserves the JSON/Markdown report, failure screenshot and native logs.

The runner uses disposable native profiles and destroys only its own windows. It does not modify the user's manual preview or workspace. No commit, push, deployment or signed desktop release was performed.

## Limits and environment

macOS 27.0, arm64, 8 GB RAM, eight CPUs, Node 22.23.4, Electron 45.0.0. Responses come from a controlled loopback HTTP provider with synthetic engineering evidence; no provider credentials or paid AI calls are used. Timings therefore describe local processing, not real-provider throughput. Windows/Linux, live model quality, service outages, sustained quotas and ISO 26262 compliance are not established by this run. Large engine/storage cases do not render a 31,500-row hazard table; the separate UI checks use small fixtures.
