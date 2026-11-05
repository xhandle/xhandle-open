# Downstream derivation memory reliability — November 5, 2026

## Finding and scope

Offer's Desktop 0.2.14 diagnostic report records a renderer crash while System
Requirements was at 495 / 5,392. JavaScript heap was 4,002,718,309 bytes against a
4,395,630,592-byte limit (about 91%), with a 3.1-second event-loop delay and heavy
system-wide swap use. This is strong evidence of memory pressure. The recorded
termination is `crashed`, exit code 5, not an explicit out-of-memory termination;
the report alone does not identify a specific retaining object or native cause.

The affected shared paths are also used by **Subsystem Requirements** and
**System / Subsystem Design**. The fixes apply to all three, and shared storage
and logging improvements also cover Software Requirements. Existing derivation
batching and checkpoint fixes were already in 0.2.14; they are not new fixes here.

## Changes

- Replaced the unbounded saved-artifact memory cache with an LRU cache with an
  8 MiB estimated byte budget and a 16-entry limit. Oversized saved collections
  remain readable from IndexedDB. Unsaved results remain protected separately;
  eviction never deletes workspace data.
- Read and write artifact chunks one at a time. Writes still use one atomic
  transaction, including metadata replacement and old chunk cleanup. This avoids
  queuing structured clones for the entire collection simultaneously.
- Stop building the small localStorage fallback once its 750,000-character
  budget is exceeded, instead of serializing an entire large result first.
- Avoid loading a second active-artifact collection in the panel's linked-data
  effect. Downstream panels no longer construct an unused Software Requirements
  source from the complete functional model.
- Routine AI console logs contain counts and lengths instead of prompts,
  payload objects, and response bodies. Error handling remains in place.

The model inputs, derivation algorithms, evidence, trace links, checkpoint format,
and saved artifact format were not intentionally changed. No engineering content
was truncated to achieve the memory reduction.

## Electron comparison

The reproducible harness is
`scripts/diagnostics/stress-downstream-derivation-desktop.cjs`, with entry point
`scripts/diagnostics/downstream-memory/entry.jsx`. It bundles the production
artifact panel, derivation, storage, and checkpoint modules into a sandboxed
Electron 45 renderer with a fresh disposable profile. AI responses are
deterministic fixtures; no customer data or external AI requests are used.

Each case seeds three related artifact collections with long engineering
evidence, derives through the actual panel, checks parent coverage, reopens saved
results, and reruns from checkpoints. Cases run sequentially in one renderer to
expose retained collections. The larger case has 8,088 source rows, 50% more than
the 5,392 reported in Offer's log.

The comparison source is the current working tree with only `artifactAI.js`,
`artifactUtils.js`, and `EngineeringArtifactPanel.js` restored to HEAD
`8e124122ddd926b9f62429725e516d1ef37a4c55`; unrelated pending changes are held equal.

| Stage | Source rows | Before peak MiB | After peak MiB | Before retained MiB | After retained MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| System Requirements | 5,392 | 344.8 | 255.9 | 30.8 | 15.9 |
| Subsystem Requirements | 5,392 | 329.9 | 286.1 | 76.8 | 6.2 |
| System / Subsystem Design | 5,392 | 327.1 | 254.6 | 142.7 | 6.4 |
| System Requirements | 8,088 | 518.1 | 429.2 | 178.6 | 6.5 |
| Subsystem Requirements | 8,088 | 620.9 | 406.8 | 247.0 | 6.7 |
| System / Subsystem Design | 8,088 | 711.1 | 377.2 | 345.9 | 6.7 |

Peak is sampled JavaScript heap during panel derivation, reopening, and checkpoint
reuse. Retained heap is measured after unmounting and explicit benchmark-only
garbage collection. Initial seed writes precede peak sampling. Figures exclude
native/GPU memory and are not total app memory. The cache budget is an estimate,
not a cap on total renderer memory. Maximum observed peak across the sequence
dropped about 40%; final retained heap dropped about 98%.

All six cases completed without renderer crashes or uncaught errors. Every source
parent remained covered, no fallback drafts were produced, and checkpoint reuse
made zero additional provider requests while preserving engineering output text
and parent links. Before and after produced the same row and request counts.
These fixtures exercise mechanics, not real-provider answer quality or latency.

Raw comparison results are in
`downstream-derivation-memory-2026-11-05.json` alongside this report. Reproduce with:

```sh
env -u ELECTRON_RUN_AS_NODE XHANDLE_STRESS_OUTPUT=/private/tmp/xhandle-downstream-check \
  /Users/Nick/xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  scripts/diagnostics/stress-downstream-derivation-desktop.cjs
```

## Regression checks

- 34 relevant suites, **220 tests passed**: all assurance tests and requirements
  transfer/checkpoint/coverage tests.
- New checks cover bounded cache admission and eviction, durable oversized
  results, single outstanding chunk reads/writes, transaction rollback after a
  later chunk fails, no duplicate active collection reads, and metadata-only
  logging across all four derivation stages.
- A pre-existing retry test timed out because its fake clock advanced before the
  diagnostic wrapper scheduled a retry. It also failed when run alone with the
  storage loader mocked. The test now waits for the timer to exist before moving
  the clock; production retry behavior was not changed.
- Final helper/import cleanup was rechecked with 25 focused tests, all passing.
- Targeted ESLint: zero errors; one existing `sourceRows` dependency warning in
  the panel's source-loading effect. `git diff --check` passed.
- Both Electron test bundles compiled using the production panel. No signed
  installer or full desktop release was built or published.

## Remaining uncertainty

This did not reproduce Offer's exact crash. Both baseline and patched synthetic
runs completed. A real project can retain more data, larger model responses,
other mounted views, and longer histories than these fixtures. Active derivation
still requires complete input/output collections, and linked artifact collections
remain loaded for traceability. A single unusually large row is still serialized
as one row. Unsaved work is intentionally retained on persistence failure.

The changes remove verified accumulation and allocation risks, but cannot promise
that arbitrary project sizes never exhaust memory. Rechecking Offer's actual
workload and its diagnostics is the remaining validation for the customer crash.
