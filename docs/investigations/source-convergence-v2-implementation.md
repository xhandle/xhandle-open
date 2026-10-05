# Source convergence gaps: implementation and validation

Implemented the prompt in docs/codex-prompts/fix-source-convergence-gaps.md, following the two Alpamayo workbook comparison.

## Changes

- Added a browser-compatible Python syntax parser (@lezer/python) in pythonSourceInventory.js. It inventories multiline/async definitions, class membership, explicit inheritance, module calls, imported-alias calls, and receiver/dynamic call expressions. Receiver expressions remain scoped to their caller and explicitly unresolved; import-reference evidence is not a proof of runtime dispatch. Constants, comments, strings, and annotation expressions are not treated as calls. Binding checks cover parameters, assignments, aliases, conditional imports, lambdas and comprehensions. Two verified Lezer recovery edge cases (comment-only modules and bare yield) are handled narrowly, with regressions for real malformed syntax.
- Source evidence now owns canonical endpoints/actions. Model responses enrich descriptions or remain unverified proposals. Model call paraphrases no longer create separate identities solely because prose differs; alternative proposal descriptions are retained.
- Newly source-backed relationships receive deterministic path-based architecture allocations. Checkout/repository display names no longer influence fallback allocation or analysis-context naming. Model allocation remains available for unsupported proposals, and description enrichment remains available.
- Kept old canonical IDs for unchanged lexical calls/membership. A narrowly checked v1-to-v2 migration preserves scoped trace IDs, node/edge IDs, edits and analyst overrides only with unchanged digest, relationship facts and locations. Changed or ambiguous rows remain historical; downstream records are not deleted or silently reassigned.
- Advanced run/checkpoint policy to source-equivalence-v2-syntax, preventing reuse of old partial inventories under the new parser.
- Architecture workbook exports retain existing columns and add canonical IDs, trace IDs, lineage, source digests, relationship kinds and target-resolution status. New Runs and Coverage sheets expose requested/effective settings, content hashes, selected/excluded paths, syntax errors, inventory scope, unresolved targets and model-only counts. Legacy exports explicitly report unavailable manifests.

## Validation

- 185 tests passed in 24 relevant suites, covering the new parser, canonicalization, migration, coverage export, source acquisition/recovery, storage, navigation, hazard preprocessing, remediation and the software/system/subsystem requirements, design and traceability chain.
- An isolated browser ran the actual shared generator over all 22 Python files from the supplied local Alpamayo checkout. GitHub responses served those exact same bytes; AI responses were intercepted, returning omissions for one adapter and different wording for the other. No live/paid AI calls or customer source uploads were performed.
- Both adapters produced 909 identical source-backed relationship identities, endpoint/action labels, hierarchy allocations and eligibility classifications. Comparison fingerprints matched. The GitHub rerun retained same-scope trace IDs. All 22 selected files appeared in exported coverage with hashes, and no parse errors remained.
- Source-backed includes observed call syntax with unresolved runtime targets. This fixture recorded 459 such call targets; they are not falsely represented as resolved dispatch or automatically declared hazard-relevant.
- Browser probe: docs/investigations/code-source-convergence-v2-check.cjs. Run with a local source-root argument and --all, XHANDLE_PLAYWRIGHT_PATH and XHANDLE_CHROME_PATH. It uses fresh browser storage and intercepts remote requests.

- Production build passed with existing repository warnings; no new parser or coverage-export lint warnings. `git diff --check` passed.

## Limits and interpretation

The source-backed subset now converges for identical source and selection in the tested cases. This is not a claim of whole-program semantic equivalence or identical model prose/proposals. Operators, implicit calls, arbitrary data flows, runtime dispatch, and non-Python semantic extraction remain outside this parser's verified inventory. Coverage exports state these limits. Model-only proposals remain available for review and can vary between runs; they are not deleted to force equal totals. New totals can exceed the old 230/247 rows because previously omitted syntactic calls and definitions are now represented.

Existing workbooks were not modified. Existing saved edits/allocations are intentionally retained when their evidence matches, so an established project may preserve earlier display choices that differ from a fresh project. New runs must load the updated client. No commit or push was performed.

## Source-backed relationship counts in the controlled full-source check

| File | Both adapters |
| --- | ---: |
| src/alpamayo_r1/action_space/__init__.py | 0 |
| src/alpamayo_r1/action_space/action_space.py | 9 |
| src/alpamayo_r1/action_space/discrete_action_space.py | 18 |
| src/alpamayo_r1/action_space/unicycle_accel_curvature.py | 61 |
| src/alpamayo_r1/action_space/utils.py | 97 |
| src/alpamayo_r1/common/logging.py | 20 |
| src/alpamayo_r1/config.py | 4 |
| src/alpamayo_r1/diffusion/__init__.py | 0 |
| src/alpamayo_r1/diffusion/base.py | 12 |
| src/alpamayo_r1/diffusion/flow_matching.py | 33 |
| src/alpamayo_r1/geometry/coordinates.py | 6 |
| src/alpamayo_r1/geometry/rotation.py | 39 |
| src/alpamayo_r1/helper.py | 5 |
| src/alpamayo_r1/load_physical_aiavdataset.py | 48 |
| src/alpamayo_r1/models/action_in_proj.py | 61 |
| src/alpamayo_r1/models/alpamayo_r1.py | 69 |
| src/alpamayo_r1/models/base_model.py | 83 |
| src/alpamayo_r1/models/delta_tokenizer.py | 48 |
| src/alpamayo_r1/models/diffusion_expert_cuda_graph.py | 89 |
| src/alpamayo_r1/models/token_utils.py | 51 |
| src/alpamayo_r1/test_inference.py | 20 |
| tests/test_diffusion_expert_cuda_graph.py | 136 |
