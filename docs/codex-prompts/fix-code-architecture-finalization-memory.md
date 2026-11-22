# Implement and validate code architecture finalization memory fixes

Work in the current shared xhandle-open working tree. Preserve unrelated edits.
Implement this prompt, then run the validation; do not stop after writing a plan.

## Evidence and objective

Large analysis finalization can amplify shared evidence and approach the ordinary
renderer heap limit even when the host has available RAM. Validate this with
synthetic data and measured memory. Do not infer OOM from an exit code alone.

Reduce finalization's avoidable live data and duplicate source evidence. Preserve
every relationship, source citation, stable identity, analyst decision, project
boundary and cross-file/component link. Do not solve this by dropping rows,
sampling evidence, raising the heap limit or forcing garbage collection.

## Required first-release implementation

1. Publication must validate staged chunk graphs incrementally and commit their
   pointers atomically without rehydrating a second complete result. Keep the
   existing full-row recovery API compatible, but give normal generation an
   explicit summary-only publication path. Validate missing/corrupt chunks,
   cancellation, scope, row counts and run identity before reporting success.
   Retain completed checkpoints and previous publication on any failure.
2. Bound storage reader caches by bytes. Avoid retaining decoded trees and their
   mutable copies simultaneously. Add a batch iterator and a bounded preview
   path so discovering saved work does not load every result. Keep legacy tree
   compatibility and independent mutable values for default public readers.
   If an immutable evidence-sharing read mode is added, opt in explicitly only
   at already-immutable UI boundaries; preserve row edits through replacement.
3. Intern immutable source file catalogs and function snippets per exact source
   snapshot during generation. Bound the raw-source/line cache by bytes as well
   as entries. Keep the full evidence shape for downstream hazard analysis,
   reports, archives and exports. Do not introduce unresolved evidence IDs.
4. Add cooperative, byte/row-bounded batch processing with backpressure where
   enrichment and normalization currently create temporary arrays. Keep compact
   global indexes for cross-batch links. Clear obsolete extraction references
   after their durable checkpoint and final scope reconciliation. Check aborts
   between batches and report explicit finalization/publishing progress.
5. Keep full dataset loading/export compatibility for this release. Document
   remaining consumers that materialize complete arrays. Do not claim constant
   total memory or unlimited repository size. A full paged UI/utility-process
   redesign is follow-up work unless measurements show it is required here.
6. Test an actual full-size UI edit, save and reload. Avoid repeatedly scanning
   shared immutable evidence for snapshot fingerprints on the renderer thread.
   Preserve the exact legacy fingerprint, including Unicode escaping, array
   holes, integer-key ordering and repeated logical values. Cache only proven
   deeply immutable subtrees with weak ownership; shallow freezing or getters
   must not hide mutations. Verify hash compatibility and full-size UI behavior.

## Validation that must actually run

- Add meaningful native IndexedDB tests for legacy roundtrips, duplicate evidence
  isolation, immutable sharing, batch boundaries, missing/corrupt chunks,
  cancellation, failed publication, quota, concurrent edits, history and reload.
- Build a reproducible offline harness in the real preview Electron shell with
  a fresh production renderer and disposable profile. Use production modules,
  controlled synthetic inputs, blocked external requests and no paid AI calls.
- Exercise multiple large sizes with both repeated and varied source evidence.
  Record actual heap/RSS samples and timing, row/evidence checksums, reload and
  recovery results. Compare the saved pre-change reader/publication with the
  new code on identical data in fresh renderer contexts. Sampling must not
  retain full fixture copies or assert safety from final heap alone.
- Also replay the actual pressure range: benchmark **6,000 distinct source files**,
  completed-file progress still running during finalization, and the ordinary
  approximately 4.09 GiB heap limit. Increase real relationship/evidence volume
  and test proportional increases in relationships and evidence. Retain the
  ordinary heap cap; do not raise it to make the baseline pass. Record actual
  heap and resident memory separately. Require measured pressure of at least
  4 billion used-heap bytes, or at least 3 GiB heap plus 4 billion resident bytes.
  Do not claim that macOS resident memory duplicates Linux measurements. A
  controlled baseline stop after sustained target pressure is acceptable, but
  label it explicitly; never describe it as an observed OOM/native crash.
  The same workload must complete with the fixed code and preserve every row
  and evidence field. A baseline that never reaches this range is inconclusive;
  small benchmarks or large logical serialized sizes alone do not satisfy it.
  Keep expected baseline crashes isolated and separate from fixed-code failures.
- Verify the populated code architecture table/diagram navigation, evidence,
  analyst edits and persistence, recovery, and applicable downstream regression
  suites in Electron. Run the relevant unit/integration suites and a broad
  frontend regression check. Fail on unexpected renderer exceptions, missing
  assertions, evidence loss or source drift. Retain reports and screenshots.
- Clearly distinguish macOS preview validation from Linux runtime coverage and
  synthetic provider fixtures from real model semantics. Report existing or
  unrelated failures separately, and fix regressions introduced by this work.

Deliver the implemented changes, exact commands and measured results in a short
investigation report. Do not commit, publish, release or modify personal profiles.
