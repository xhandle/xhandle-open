# Compact hazard wiring and latency audit

Date: 2026-10-13. Scope: read-first audit requested while STPA was running.
No production source changes, server restarts, paid model requests, or cancellation.

## Wiring verdict

The current source correctly routes STPA, HARA and FHA through the new pipeline:

1. `CodeArchitectureHazardPanel.js` Run/Continue call `onRunAnalysis(method)`;
   Regenerate calls the same handler with `regenerate: true`.
2. `App.js:handleRunCodeArchitectureHazardAnalysis` calls the public runner
   exported by the feature index, supplying current project/repository, Functional
   source rows, operational contexts, organization calibration and cancellation.
3. `codeArchitectureHazardRunner.js:runCodeArchitectureHazardAnalysis` selects
   `runFastCodeArchitectureHazardAnalysis` for supported method aliases.
4. `fastHazardRunner.js` prepares inputs, invokes `generateFastHazards`, reconciles
   governed preprocessing, validates, normalizes and saves the result.
5. `fastHazardPipeline.js` uses `fetchLLMResponse` as request transport only. This
   import from `aiAnalysisSTPA.js` does not invoke the legacy STPA stage runner.

No compact-path call to `runLiteAIAnalysis`, old screening, catalog generation or
the old staged repair pipeline was found. Unsupported methods still use the
retained legacy runner. Tests confirm the three supported methods bypass Lite.

Read-only retrieval of `http://localhost:3000/static/js/bundle.js` found
`compact-hazard-v1`, the compact runner and its `Assessed ...` progress text.
The legacy runner is also bundled because it is deliberately retained. This proves
what the server currently serves, not which bundle an already-open browser tab
loaded or which requests its active run has made. No active browser logs were available.

## Findings

### High: batch budgeting defeats evidence deduplication

`generateFastHazards` sums `JSON.stringify(source).length` per assessment before
`fastHazardPrompt` deduplicates identical interface definitions. The 32,000-character
limit can therefore reduce nominal 32-row batches to one or two rows even though
the final prompt could fit many more. Shared profile/context and instruction sizes
are meanwhile excluded from that limit, and oversized singleton inputs are allowed.

Reproduction: 32 rows sharing the same 12,000-character evidence definition make
16 successful requests, with no failures or retries. This is a synthetic regression
probe, not a measurement of the user's current data.

Recommended fix: budget the actual deduplicated prompt, including shared context;
retain every required evidence item and account for expected response size.

### Medium: silent retry amplification and late adaptive sizing

Only accepted rows advance progress. Request starts, elapsed time, retry causes and
split-batch counts are not reported. Malformed/invalid results are recursively split;
each singleton may fail three times. There is no learned batch limit applied to
subsequent initial batches. A consistently oversized response can repeatedly incur
the same failed large requests. Existing truncation coverage reproduces eight rows
requiring 15 requests before success. The audit test also verifies that a failed
first request produces no intermediate retry progress event.

Recommended fix: explicit request/retry diagnostics and adaptive sizing within the
existing three-worker concurrency bound, with truthful accepted-row progress.

### Medium: per-row serial checkpoint overhead

All non-excluded rows are checked sequentially before the first request. Each lookup
hashes a key containing shared context and evidence and performs an IndexedDB read.
Every accepted row hashes again and performs an individually awaited write. This
can add overhead with large evidence and many expanded rows. It is a code-level
risk; no customer-browser storage timing was measured.

Recommended fix: precompute shared fingerprints and batch storage reads/writes while
preserving project/repository/provider/profile isolation and durable checkpoints.

### Medium: App discards final-save recovery state

The compact runner emits `error.recoveryRun` and calls `onPartialRunUpdate` when the
final save fails. App's catch then unconditionally restores `priorRunForPreprocessing`
for the current scope. That can hide completed in-memory results despite successful
generation. This does not explain a currently pending model request, but is an
integration gap in the new path. Preserve the recovery run instead of replacing it
on this particular error, with an explicit unsaved state and recovery actions.

## Why the old columns remain

`CodeArchitectureHazardSummaryTable.js:columnOptions` enumerates every header in the
displayed Summary. Requested column lists control default visibility, not the menu's
available columns. The compact runner intentionally retains software requirements,
verification, rationale and traceability fields beyond the default nine STPA columns.
Old completed results keep their original schema and remain displayed during a new
run; the compact runner publishes the replacement table only after completion/save.
`CodeArchitectureHazardPanel` selects `latestRun.generatedSheets.Summary` first.
Therefore the menu does not establish which pipeline is currently executing.

If the product should expose only the requested method columns in the picker, use a
presentation-only allowlist. Preserve stored/exportable fields needed downstream.
Do not delete saved historical columns to infer or signal pipeline selection.

## Work volume and transport

Inputs expand to eligible interfaces × seven guide phrases × selected contexts.
For example, 100 interfaces in one context yield 700 assessments, at least 22
initial batches at the 32-row ceiling, before evidence-size splitting or retries.
Only three batches run concurrently. Reviewed No rows bypass the model; valid compact
checkpoints are reused. Legacy results are not automatically compact checkpoints.
The shared transport also permits up to five attempts for rate limiting (429).
Those mechanics can be slow without executing any legacy pipeline stage.

App also registers review items after the runner finishes saving; activity completion
waits for that operation, although the completed result is set beforehand.

## Verification and limits

- Four targeted suites passed: 28 tests covering dispatch, pipeline, table defaults,
  traceable software requirements, CSV, governed decisions, retry behavior and the
  two new latency/progress reproductions.
- `git diff --check` passed.
- Added `fastHazardWiringAudit.test.js` as characterization tests documenting current
  defects; revise expectations when those defects are fixed.
- No production change or new build was necessary for this audit-only task.
- Active-run duration and provider response quality were not measured. The current
  delay cannot be assigned to a specific cause without that run's request evidence.
