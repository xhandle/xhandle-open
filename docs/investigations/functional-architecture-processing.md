# Functional architecture processing

Implemented the [processing prompt](../codex-prompts/process-functional-architecture-model.md). This supersedes the presentation-only Functional projection described in `functional-code-architecture-view.md`.

## Historical comparison

The CSU renderer before `561c77df01a3fa65f7a06b568b5a710287138b9b` used nested Subsystem/CSCI/CSC/CSU containers and compact function spacing. Its inputs were AI-selected functional relationships. Recent source-call inventory expansion supplies much more implementation detail; changing spacing or grouping library names alone cannot restore the earlier abstraction.

## Result

- Both GitHub and local generation invoke the same source-grounded functional postprocessor after detailed extraction and classification. Existing and imported results can use Functional → Generate functional model without fetching or extracting source again.
- Bounded requests assign every source relationship to an internal operation or meaningful interaction and infer purpose-oriented responsibility names. A second stage can consolidate cohesive functions within the same file/component. Control, feedback, uncertain and cross-file boundaries are protected. Invalid/incomplete responses retry and subdivide; incomplete mappings cannot publish.
- Detailed CSU rows remain intact, with additive versioned annotations. Functional interactions and internal evidence retain their supporting source indices, IDs, symbols and files. The functional table can be copied as Markdown. Source evidence can be inspected and opened in the detailed table or CSU view.
- Functional uses the existing nested architecture renderer with historical compact function spacing, routed edges and a separate persisted layout. Editing the inferred presentation does not edit source relationships.
- New hazard runs use processed interactions when a complete current model exists. Internal implementation operations are excluded from hazard expansion. Interaction types and supporting source IDs are carried in traceability. Existing runs retain their original raw snapshot semantics; functional runs additionally track semantic descriptions. Failed/stale processing cannot silently substitute detailed calls.
- Model persistence uses the captured storage revision to reject conflicting publication. Input changes invalidate annotations. Workspace changes cancel processing. Failed processing preserves detailed analysis and shows an explicit error.
- Derived functional trace IDs resolve to supporting raw calls for navigation and requirements/system/subsystem/design traceability chains.

## Verification

- 19 relevant Jest suites, 146 tests passed: functional processing, shared source generation, hazard analysis, navigation, assurance artifacts and remediation. The final strengthened requirements-chain assertion also passed (9 processing tests).
- Production build passed; existing lint warnings remain. `git diff --check` passed.
- Isolated Chromium diagnostic with actual IndexedDB: 22 source rows became three responsibility nodes and two visible interactions. Checked nonoverlapping nested containers, reload, conflicting-save rejection, GitHub/local parity, full source coverage, exact source links, CSU drill-through and functional hazard inputs.
- Browser screenshot: `/tmp/xhandle-functional-view-v2.png`. Diagnostic: `scripts/diagnostics/verify-functional-architecture-view.cjs`.

## Limits

Tests use deterministic model fixtures; no paid model calls or customer records were used. Real-repository semantic quality, Safari behavior and large-model performance still require evaluation. AI-derived responsibilities need engineering review, and may differ across model responses; this is not a promise of an identical historical diagram. Conservative boundary protection may retain more responsibilities than the historical extraction. This change does not remove browser memory limits. No commit or push was performed.
