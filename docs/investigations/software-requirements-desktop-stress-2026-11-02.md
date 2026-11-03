# Software requirements: Electron stress test, 2026-11-02

All five synthetic workloads completed without a renderer crash, uncaught renderer exception, missing requirement, or fallback requirement. This did **not** reproduce or resolve the customer's crash. It did expose substantial CPU scaling costs and brief UI stalls at large sizes.

## Environment and scope

- Host: the local Apple M2 Mac with 8 GB RAM; the customer's M4/16 GB machine was not tested.
- Runtime: Electron 45.0.0 / Chromium 156.0.8078.48, using the desktop repository's Electron binary.
- Shared application source: `bfa833cc1e6750f6e82a1e3b187941fa1ebe53c0`. The assurance modules and requirement checkpoint module are unchanged from the `32d966f` source pinned for Desktop 0.2.13.
- A production-mode diagnostic bundle mounted the real `EngineeringArtifactPanel` with the activity provider and Collaborator review provider. It exercised the real derivation button, derivation/normalization, IndexedDB checkpoints, artifact persistence, preparation, and virtualized table.
- This was an isolated Electron harness, **not** an end-to-end run of the signed, installed application. It does not include the whole workspace's other retained views or desktop main-process services.
- All project data was synthetic. AI requests received deterministic successful responses with a 1 ms simulated delay. No external AI requests were made.
- Each source row included architecture allocation, source file paths, trace identity, and approximately 1.8 KB of source descriptions. Each generated requirement included rationale and traceability.
- A previously copied local database contained approximately 5,000 architecture rows. That is not a confirmed count of the customer's Functional decomposition. The 50,000/75,000 pair additionally tested a 50% increase at a much larger synthetic size.

## Results

| Functional rows | Derive and save | Primary test duration | Fresh-process saved-table verification | Sampled JS heap maximum | Largest event-loop delay |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5,000 | 3.46 s | 7.03 s | 0.59 s | 87.9 MiB | 40 ms |
| 7,500 | 5.68 s | 12.15 s | 0.90 s | 140.8 MiB | 34 ms |
| 15,000 | 14.07 s | 20.06 s | 1.86 s | 200.8 MiB | 115 ms |
| 50,000 | 106.74 s | 121.26 s | 6.15 s | 531.7 MiB | 600 ms |
| 75,000 | 218.49 s | 238.98 s | 9.29 s | 817.0 MiB | 1,028 ms |

Primary duration includes derivation, checkpointing, saving, preparing the table, 120 scroll updates, reaching the final row, and unmounting/reopening the panel. The 7,500-row case also repeats derivation using its persisted checkpoints. Fresh-process verification additionally reads saved rows and mounts the real panel in a new Electron process; it does not load a complete architecture workspace. These timings exclude real provider latency and are not customer runtime estimates.

Every case verified:

- Exactly the expected number of generated requirements, with unique source trace coverage and no fallback rows.
- Exactly one simulated model request per five source rows: 1,000 / 1,500 / 3,000 / 10,000 / 15,000 requests respectively.
- Continuous scrolling reached the final saved requirement. At most 19 table body rows were mounted during the sampled scrolls.
- Saved rows survived a fresh page load and a separate Electron process. Fresh-process verification made zero model requests.
- The 7,500-row checkpoint-reuse pass made zero additional model requests and returned all 7,500 requirements.

The 75,000-row fixture contained approximately 163.3 MiB of serialized source rows and 137.6 MiB of serialized requirements. Its renderer's macOS-reported physical footprint peaked at approximately **1.70 GiB** (native lifetime maximum 1,742 MiB; sampled maximum 1,736 MiB). This differs from JS heap and resident working set and is not a machine RAM requirement.

The largest case recorded 12 main-thread long tasks, with a maximum of 936 ms during derivation. It remained functional and completed, but those stalls are visible responsiveness issues.

## Identified scaling concern

[`normalizeSoftwareRow`](../../src/features/code-architecture-assurance/artifactAI.js) calls `findFunctionalRowIndexByTrace` for each generated requirement. [`functionalRowIndexForTraceValue`](../../src/features/code-architecture-assurance/artifactUtils.js) maps and filters the complete source collection to resolve each trace, allocating temporary objects as it scans.

For N generated requirements against N source rows, this path performs approximately O(N²) source lookup work. A 50% increase in rows can therefore imply approximately 2.25 times the lookup work, before checkpointing and other processing. The measured derive/save time increased from 106.74 s at 50,000 rows to 218.49 s at 75,000 rows. The complexity finding comes from code inspection; the test did not collect a CPU profile that attributes the entire measured increase to this function.

The next optimization target is to build/reuse an indexed trace lookup once per derivation, preserving duplicate-reference, historical-reference, and Functional relationship resolution semantics. The existing `createFunctionalRowLookup` is relevant. Application behavior can remain the same while reducing these scans and allocations. No production optimization was implemented as part of this test.

## Limits and follow-up

- No historical hazard runs, hazard-summary import, failed/partial AI responses, rewrite requests, or the customer's actual archive were included. Those may change memory use substantially.
- This does not establish a maximum supported project size, absence of leaks during hours of analysis, or the cause of either previously reported native crash.
- The Functional diagram rendering path was not exercised by this software-requirements test.
- The useful follow-up is to optimize and retest trace lookup, then reproduce derivation with the customer's actual decomposition and retained hazard data in an isolated profile while collecting renderer crash details and native memory measurements.

## Reproduction and evidence

Harness: [`scripts/diagnostics/stress-software-requirements-desktop.cjs`](../../scripts/diagnostics/stress-software-requirements-desktop.cjs).

```sh
env -u ELECTRON_RUN_AS_NODE \
  XHANDLE_STRESS_COUNTS=5000,7500,15000,50000,75000 \
  /Users/Nick/xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  scripts/diagnostics/stress-software-requirements-desktop.cjs
```

For a fresh-process verification of an existing synthetic profile, set `XHANDLE_STRESS_OUTPUT` to its artifact directory and `XHANDLE_STRESS_COLD_ONLY=1`. The harness preserves the original localhost port/origin, which IndexedDB requires. Primary derivation runs should use a fresh output directory; they assert the expected model request count to detect accidental reuse.

Local evidence from this run:

- `/private/tmp/xhandle-sw-stress-verified/results.json`: primary results, phase samples and long tasks.
- `/private/tmp/xhandle-sw-stress-verified/cold-results.json`: final fresh-process verification results; use these for cold-open timings. Earlier cold timings in `results.json` were superseded after correcting source-array identity in the cold-open fixture. Primary derivation and scrolling were unaffected.
- `/private/tmp/xhandle-sw-stress-verified/metrics.jsonl`: Electron process samples.
- `/private/tmp/xhandle-sw-stress-verified/footprint.jsonl`: native process footprint samples from the primary stress run.
- `/private/tmp/xhandle-sw-stress-verified.log` and `/private/tmp/xhandle-sw-stress-cold-verified.log`: completed run logs. Earlier harness-only failures were retained separately as `fixture-*-error.txt` and are not application failures.

The primary five-case run, final five-case fresh-process verification, and 500-row harness smoke run exited successfully. `node --check` also passed for the harness. Only the diagnostic script and this report were added; application code, installed workspace data, and release state were not changed.
