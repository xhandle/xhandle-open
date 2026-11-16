# Traceability profiles and matrix implementation

Implemented and validated November 14, 2026 in the local working tree. No commit, push, packaged release or updater publication was performed.

The executed prompt is [implement-traceability-profiles-and-matrix.md](../codex-prompts/implement-traceability-profiles-and-matrix.md). The original [design proposal](../design/traceability-profiles-and-matrix.md) remains the broader design reference; the delivered scope and limits are recorded here.

## Delivered workflow

- **Traceability profiles** opens the profile manager in Design Management. The built-in xHandle Systems Engineering v1 profile can be duplicated. Custom profiles support role/object-kind bindings, directed relationship rules, source/target cardinality, alternative target roles, milestone stages, prohibited links and finding severity. Rules and Scheme use the same draft; selecting a scheme edge opens its rule editor. Publishing creates an immutable version. Validated JSON import and export are supported.
- Systems engineering projects select a pinned profile. Their traceability settings offer source bindings and an actual coverage/invalid-link impact preview before application. Existing matrices keep their own pinned selection. A matrix created from the project inherits that selection; an explicit override is labeled.
- **Generate engineering artifact → Traceability Matrix** creates a deterministic library artifact. It evaluates saved sources and typed relationships, rather than invoking document-generation AI. Coverage includes unlinked objects, empty/unavailable populations, drafts, proposed/suspect links and reviewed exclusions. Coverage, Relationships, Pairwise and Scheme presentations share the assessment. Table columns have searchable multiselect filters and resizing; pagination bounds rendering. UI filters do not change assessment totals or exports.
- Relationships are reviewed through one canonical write service, with exact source/target identities, type/direction validation, cardinality, derivation-cycle prevention, rationale and source-content identities. Source, configuration, ledger and concurrent revision changes are checked before writes. Confirming a link requires explicit review and resolved saved endpoints. Existing typed module/SysML links appear as proposals and can be adopted or retired without rewriting the source. Generic source/refines citations remain provenance.
- Assessments can be saved as immutable revisions, inspected historically, exported as coverage CSV or complete JSON and reviewed into baselines. Baseline gates reject error-level uncovered/unavailable obligations and invalid relationships. A baseline does not approve requirements or claim passing verification. Changed endpoints/profile versions make confirmed relationships suspect; historical assessments retain their original evidence and link state.
- Saved matrix objects participate in existing library/search/Collaborator contracts. The Collaborator can read and explain saved assessment content. Original source navigation supports artifact objects, HTR evidence, legacy modules and SysML elements. Historical source inspection shows the saved text before offering navigation to the current source.

## Storage and responsiveness

Profile versions, project assignments, canonical relationship ledgers and link histories use namespaced records in the existing artifact `presentations` store. Matrix configuration uses `metadata`; saved assessments use `revisions`; reviewed baselines use `baselines`. This reuses existing backup/restore storage without a schema migration or a separate editable copy of source documents. Profile queries use primary-key prefix ranges rather than loading all architecture presentations.

Assessment runs through the existing artifact worker pool. Evaluation indexes sparse relationships by role/rule/endpoint and yields for progress and cancellation. It does not materialize a complete object cross-product. Pairwise rendering is bounded to 20 × 15 cells; coverage pages contain at most 100 rows. HTL capture uses finalized consolidated HTRs as obligations and retains navigation to original assessments. Raw assessment rows are processed from the selected saved source in the worker, rather than rendered or transferred as thousands of independent obligations.

## Validation

| Check | Result |
| --- | --- |
| Regression suites | 27 suites, 529 tests passed |
| New traceability coverage | 27 model/repository/evaluator tests and 6 UI tests |
| Optimized production build | Passed; existing lint, chunk-cycle, Browserslist and bundle-size warnings remain |
| Live Electron workflow | 11 scenarios passed; zero page errors or AI chat requests |
| Live Chrome workflow | 11 scenarios passed; zero page errors or AI chat requests |
| Native desktop smoke | Passed parity, worker, updater, recovery and diagnostics checks; `DESKTOP_SMOKE_OK` |
| Complete assessment export | Parsed JSON with pinned custom profile v1, 3-source manifest, 40 HTR nodes, 46 obligation rows and 1 confirmed relationship |
| Isolated manual preview | Refreshed successfully; mounted, backend ping/health and workspace isolation passed |
| Native repository | Working tree unchanged |

The live fixture contains 26,278 original hazard assessments consolidated into 40 finalized HTRs, plus system and software requirement documents. Both runtimes exercised profile creation through synchronized rule/diagram controls, matrix creation, every coverage-column filter, reviewed allowed links, rejection of reverse direction, saved read-only revision, reload persistence, pairwise rendering and a source-change/suspect transition with unchanged historical evidence.

| Local measurement | Electron | Chrome |
| --- | ---: | ---: |
| Create matrix to usable initial assessment | 1,539 ms | 1,604 ms |
| Largest sampled animation-frame gap during reassessment | 18.6 ms | 33.3 ms |
| Frame samples in that reassessment interval | 64 | 63 |

These are single-run local fixture measurements, not a guarantee for every customer project or machine. Chrome was headless; Electron used the actual native backend and production renderer. No customer workspace or paid model request was used.

Evidence files on this machine:

- `/private/tmp/xhandle-traceability-regression.log`
- `/private/tmp/xhandle-traceability-build.log`
- `/private/tmp/xhandle-traceability-electron.log`
- `/private/tmp/xhandle-traceability-browser.log`
- `/private/tmp/xhandle-traceability-native-smoke.log`
- `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-ONggwp/` — Electron result, coverage/pairwise screenshots and JSON export.
- `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-O8G9VW/` — Chrome result and screenshots.
- `/private/tmp/xhandle-manual-preview-current.json` — current isolated preview pointer, retaining the previous preview workspace/profile.

The reusable live runner is `scripts/diagnostics/verify-design-traceability.cjs`. Pass an isolated desktop staging directory using `--stage`, then `--electron <executable>` or `--browser --chrome <executable>`. Supply externally installed Playwright with `XHANDLE_PLAYWRIGHT_MODULE`. Run the native executable with `ELECTRON_RUN_AS_NODE` unset.

## Current scope limits

- Rules support direct relationships, role/object-kind bindings, OR target alternatives, cardinality and stages. Arbitrary attribute predicates and configured multi-hop coverage paths are not implemented. The editor does not offer those unsupported settings.
- Projects and Code-Based Architecture evidence is represented through saved Design Management architecture artifacts and their provenance. A code reference or diagram snapshot alone does not establish satisfaction. Verification supports bound verification objects/SysML cases; it does not infer test execution success or integrate all System Test stores.
- Canonical link edits use the new profile-aware matrix service. Existing native module/SysML editors continue to own their source data; imported violations are findings, not automatically deleted or reinterpreted links.
- The Collaborator can inspect saved matrices, but it cannot directly edit computed coverage rows or automatically confirm engineering relationships. Relationship proposals require explicit review through the matrix editor.
- The matrix is a post-source assessment artifact and is excluded from AI document-generation batches. A project shortcut creates the independently versioned assessment with inherited settings.
