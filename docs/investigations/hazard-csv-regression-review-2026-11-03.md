# Hazard CSV regression review — November 3, 2026

Verdict: the current changes pass the existing targeted suites, but three additional reproductions confirm regressions. Address these before treating the CSV workflow as ready for release. This review made no production changes and did not interact with the running Electron preview, its pending import, the original CSV, or installed data.

Executed prompt: `docs/codex-prompts/review-hazard-csv-regressions.md`.

## Findings

### P2 — Legacy exports can no longer be reimported

Location: `src/features/code-architecture-hazard-analysis/hazardCsvImport.js:82–83`.

Trigger: an existing saved Summary has no persisted Raw Analysis Row ID column. The interactive paged reader normalizes those rows and supplies stable IDs; `PagedHazardPanel.js:94` exports that normalized table. The streaming importer indexes the original stored header and rejects it before examining the exported file: “This analysis has no stable row IDs. Export a current hazard draft first.” Exporting again cannot resolve this state.

Reproduced with a saved chunked legacy fixture: `queryHazardRows` returned an export with IDs; the previous shared planner accepted an edited export against that visible baseline; `prepareHazardCsvImport` rejected it. Existing tests exercise persisted IDs, so do not cover this round trip. Blank persisted IDs also need consideration when fixing this boundary.

Suggested fix: normalize the streaming baseline using the same row-ID algorithm and global row offsets as the interactive reader, preserving existing IDs. Keep revision checks and atomic publication. Add a legacy export/edit/import/reopen regression test rather than requiring users to regenerate analysis.

### P2 — Streaming imports bypass operational-context assignment and its review warning

Location: `src/App.js:14697–14708` and `src/features/code-architecture-hazard-analysis/hazardCsvImport.js:187–196`.

Trigger: rows exported with unspecified context are imported when the workspace has one unambiguous configured operational context, or an existing context's scenario/mode has been updated. The previous App path calls `assignImportedHazardContext` at `App.js:14740`; the streaming branch publishes the worker result directly. The restoration alignment callback also bypasses paged runs (`App.js:7983`), so reopening does not supply the missing step.

Reproduced with one configured Urban/Autonomous context and an imported hazard value. The saved streaming row retained `context-unspecified`; the prior helper assigned `ctx-1` and recorded “Operational context changed; imported assessments require review.” The streaming result had no corresponding preprocessing conflict. This affects context-filtered visibility and the explicit warning about reusing imported assessments under a changed scenario; the imported hazard text itself was retained.

Suggested fix: carry current configured contexts into the bounded worker workflow and reproduce the existing assignment/basis/conflict semantics before atomic publication. Do not hydrate the entire run or silently certify reassigned assessments. Include context configuration in stale-source checks and test both unambiguous and ambiguous configurations.

### P2 — Undo recalculates classification status rather than restoring the previous table exactly

Location: `src/features/code-architecture-hazard-analysis/hazardCsvImport.js:102–113`, `:139–143`, and `:188–189`.

Trigger: Undo is prepared from `csvImportPreviousSummary`, but each previous row is processed through the normal import planner and `applyHazardAnalysisCsvImport`. That helper deliberately recalculates Classification Resolution Status for a regular import. It is inappropriate for exact snapshot restoration.

Reproduced by importing only a hazard-text edit, then undoing it. The hazard text returned to its original blank value, but the original blank Classification Resolution Status became `Not Evaluated`. The previous snapshot was then cleared, making the apparent restoration irreversible through Undo. The earlier App restore path assigned the previous Summary directly. Existing save/undo tests check selected cells and preprocessing, not equality of the complete original Summary.

Suggested fix: restore validated previous Summary cells verbatim through the bounded token pipeline, with identity/revision checks, and restore previous preprocessing. Compare the entire table before import and after Undo, including derived status, blank cells, and context fields.

## Validation performed in this review

- 212 existing tests passed across 18 suites: CSV parser/planner, transfer projection, core import, worker/client hook, CBA draft/panel/context assignment, restoration, chunk storage, paged rows, working sets, requirements-summary streaming, archive round trips, AI derivation and artifact panel.
- 52 additional tests passed across six suites: diagnostic operations, activity reporting, diagram paint behavior, artifact read recovery, software hazard-source selection, and derivation-job ownership.
- Three independent observational reproductions passed by asserting the incorrect behaviors described above. These are evidence of bugs, not assertions that the desired behavior is correct.
- `git diff --check` passed. Focused ESLint passed for the six new CSV/parser/client implementation modules.

Artifacts: `/private/tmp/hazard-csv-review-regressions.log`, `/private/tmp/hazard-csv-review-adjacent.log`, `/private/tmp/hazard-csv-review-reproductions.log`, `/private/tmp/hazard-csv-review-lint.log`. Synthetic reproduction source: `/private/tmp/xhandle-csv-review/review.test.jsx`.

## Scope and limits

Examined the pending public-source CSV implementation and shared storage/index changes, plus adjacent requirements/diagnostics/diagram diffs. Existing passing checks exercise evidence preservation, damaged evidence-page rejection, cancellation, concurrent-save protection, undo, legacy requirement summaries and archive compatibility. They do not establish absence of regressions, as the additional reproductions demonstrate.

No new packaged Electron stress run, customer-project Apply, paid AI derivation, or full-repository test run was performed. Previous disposable browser/Electron runtime measurements are documented in the earlier follow-up report and were not repeated here. This is not a review of every native desktop-shell change or a release certification. No commit, push, build-pin change or desktop publication occurred.
