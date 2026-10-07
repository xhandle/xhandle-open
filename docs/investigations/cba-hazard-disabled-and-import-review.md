# Code architecture: disabled hazard analysis and import review

2026-10-07. Read-only review; no production changes, paid calls or customer storage access. Prompt: `docs/codex-prompts/review-cba-hazard-disabled-and-import.md`.

## Executive finding

The current implementation has a reproduced mismatch between the Run button and the actual hazard inputs. It also permits zero-row drafts after eligibility screening without explaining how to recover in the empty table. These can explain the disabled/empty experience, but the customer's saved rows and application revision are needed to identify which path occurred on their machine.

The customer clarified that the import file picker opened and a file was selected, but no result appeared. Normal CSV import worked in isolated Chromium both from the dashboard and into a newly created empty project. The precise customer import failure is therefore not established. There is a confirmed loss of information when round-tripping a Functional CSV, and an uninstrumented storage-wait path can reproduce the apparent no-op after selection.

## Prioritized findings

### P1 — Run button checks a different model from the draft and runner

`CodeArchitectureHazardPanel.js:125` summarizes eligibility directly from `cbaRows`; `:242` disables Run when that count has no included rows. `codeArchitectureHazardUtils.js:674` instead selects processed Functional rows when available. Draft construction (`codeArchitectureHazardCsv.js:11`) and the runner (`codeArchitectureHazardRunner.js:39`) use this latter path.

Isolated browser reproduction with one raw helper relationship and a valid processed Functional interaction:
- Detailed-row eligibility: 0 included, 1 needs review.
- Actual Functional input: 1 included, 7 STPA guide-phrase rows.
- Rendered Run button: disabled.

This is a confirmed defect, not a scenario configuration problem. The converse is possible as well: included detailed calls can enable the button while the Functional model contains only excluded internal implementation rows.

### P1 — Functional CSV import loses the model and ownership information

`parseCodeArchitectureCsv` preserves headers, but `App.js:4514` normalizes into a fixed object. That normalizer accepts unqualified Subsystem/CSCI/CSC fields, not the Functional export's source/destination hierarchy fields. It also drops Supporting Source Trace IDs, Supporting Source Rows and Interaction Type. A Functional CSV does not contain the full saved `functionalAbstraction` object, so import treats it as detailed rows and re-screens eligibility.

Reproduction using the user's available SasanLabs export (not the customer's unknown file): all 311 rows parsed, but the first imported row became Application Subsystem with blank CSCI/CSC; supporting trace references and functional abstraction were absent. Re-screening produced 143 included, 1 excluded and 167 needing review. Thus this workaround does not preserve the original Functional model or its hazard input semantics, even when the import visibly succeeds.

### P2 — Zero eligible rows give a disabled action and an unhelpful empty state

`codeArchitectureRowsToHazardTableRows` filters to included interfaces; the draft expands only those into guide-phrase rows. A reproduced legacy helper row remained Needs Review and generated zero draft rows even with a valid configured scenario. `CodeArchitectureHazardPanel.js:380` then tells the user to run analysis, despite Run being disabled.

Eligibility screening does not consume the operational scenario. Adding a scenario cannot change zero included rows into included rows. Stored legacy eligibility is preserved (`codeArchitectureHazardEligibility.js:98`), and older policies retain vocabulary-dependent screening. Current policy v3 treats supported production calls more generally, but existing stored analyses do not automatically acquire that interpretation.

The UI shows aggregate counts but needs a clear, actionable explanation and access to excluded/review-needed rows. Do not fix this by automatically including every excluded row.

### P2 — Import has no visible in-progress state and waits for storage before showing anything

`App.js:5225` reads/parses the selected file, normalizes rows and awaits `saveImportedCodeArchitectureRows` before selecting the imported repository or updating displayed rows. It has no import progress/status or operation-scoped cancellation UI. File reading and IndexedDB open/transaction completion have no import-level deadline (`codeArchitectureStorage.js:8`, `:73`; `chunkedRecord.js:18`). Rejected promises do reach the outer error alert; a promise that remains pending never reaches it.

A synthetic pending IndexedDB-open response reproduces selection followed by no visible imported result or inline error. This establishes a failure mode, not proof that the customer's storage was stalled. Normal imports into new empty projects worked in this review.

Persistence is also sequenced across IndexedDB rows, localStorage metadata and project-state registration, rather than published as one recoverable operation. Review failure handling across these steps before adding timeouts: timing out must not allow late completion to activate an abandoned import. The existing zero-row error mentions JSON even for CSV.

### P1 — Related project isolation risk: hazard loading falls back to another project's run

`App.js:7858–7862` first loads by project and repository, then retries with repository alone if no run exists. `codeArchitectureHazardStore.js:95` returns matching runs without a project constraint when none is supplied. Two projects sharing a repo ID can consequently show another project's STPA. This is a confirmed code path and relevant to the user's two-project workflow, but would normally show the wrong existing results rather than explain a blank view.

Also, the running flag is application-wide (`App.js:4019`), not project-scoped. A genuinely active run elsewhere disables Run in another project; a merely completed historical STPA does not set this flag. Partial/final callbacks update shared visible run state without a current-project guard (`App.js:14372`, `:14402`). This deserves explicit cross-project regression coverage.

## Validation

- 50 tests passed across existing hazard panel, eligibility, input utility, CSV draft and architecture CSV parser suites. They do not cover the raw-versus-Functional gate discrepancy or the complete Functional export/import round trip.
- Fresh Chromium context, current application modules, stubbed provider: reproduced the disabled button despite 7 eligible Functional guide-phrase rows.
- Fresh Chromium contexts: opened the actual Import picker and imported a synthetic CSV successfully from the dashboard and into a newly created empty code architecture project.
- Inspected the supplied SasanLabs CSV through the actual parser and extracted current App normalizer: reproduced hierarchy/provenance loss and changed eligibility counts.
- Synthetic pending storage open: reproduced no visible imported result after selection. No customer records were touched.

## Recommended implementation scope

1. Select the effective analysis model once and use it consistently for Run gating, counts, draft, runner and empty-state explanations. Cover both mismatch directions.
2. Show why zero rows qualify and provide a review path; preserve explicit exclusions and analyst decisions. Handle legacy policy explicitly, without silent reinterpretation.
3. Add a versioned Functional CSV import mapping for both endpoint hierarchies, interaction/internal disposition and supporting references. Do not invent missing source identities. Distinguish an imported Functional snapshot from a complete source analysis backup.
4. Give imports immediate progress, parse/validation feedback, storage-stage feedback and an explicit completion result. Stage publication and guard cancellation/project changes/late responses; expose recoverable failures instead of leaving unreachable imported records.
5. Scope run loading, progress, cancellation and result callbacks by project and repository. Restrict legacy repo-only migration to records with verifiable ownership, not arbitrary other-project matches.
6. Validate the complete workflow with two projects, one existing STPA, the other with only architecture; add a scenario, generate/inspect draft, run with a stubbed provider, export/import into a new project, and reload. Test large files, rejected and pending storage, unsupported file formats and the customer's browser when identified.

Still needed to attribute the exact customer incident: the exported file they selected, their xHandle revision/browser, the included/excluded/review counts, and any console/storage errors after selection. Do not treat the reproduced defects as proof of that run's precise cause.
