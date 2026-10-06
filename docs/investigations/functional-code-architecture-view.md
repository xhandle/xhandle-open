# Functional architecture view

Implemented 2026-10-05 from `docs/codex-prompts/add-functional-code-architecture-view.md`.

Functional appears immediately after CSU. Both GitHub and local results enter the same `FunctionalDecompositionTable` and use the same pure projection. There are no source-adapter, filename-extension, language or repository-name branches in that projection and no additional AI request.

## Presentation policy

- Keep callers and source-defined target functions, using file path plus qualified name as identity.
- Keep cross-file boundaries and relationships whose legacy evidence is insufficient to classify conservatively as local implementation calls.
- Collect unresolved same-file leaf call expressions beneath their caller. Display their relationship count and expose the complete original rows in an inspector. This grouping does not prove that their runtime target is local or safe.
- Bundle imported callable references by their supplied leading namespace within the originating file. These are interface groups, not newly inferred functions.
- Bundle parallel visible relationships into one connection with an interaction count. Keep recursion available in the owning function's inspector.
- Group the visible nodes by their existing subsystem allocation. Use a left-to-right layout, with independent manual positions scoped to project/source/branch. Existing CSU layout keys are not changed.

Every current input row remains reachable through at least its source node; interface groups and edges also carry their exact contributing indices. The inspector pages through original relationships and offers Open in table and Show in CSU. Parent navigation resolves the original trace ID/row reference and switches to the existing detailed canvas for CSU drill-through. Historical rows stay outside this view.

This is a new deterministic abstraction, not a replay of the old AI-generated result. Python's more complete syntax evidence can support more grouping than weak legacy C++ evidence; the common presentation rules do not create missing language-parser coverage. Ambiguous legacy relationships stay visible rather than being silently discarded.

## Isolation and behavior

The new component does not call `onDataChange`, replace decomposition rows, rewrite IDs/descriptions/evidence, or change hazard, requirements, design, traceability, table or workbook content. While Functional is selected the full CSU canvas is unmounted. The new canvas has pan, pinch zoom, fit, arrange, persisted manual positioning, subsystem containers, image capture support, and registration with the existing Cmd/Ctrl+F search. Editing source rows remains in the existing table/CSU workflows.

The full underlying row dataset is still loaded by the application. This reduces rendered elements; it is not an end-to-end bounded-memory solution.

## Validation

- 31 Jest suites / 233 tests passed across projection/inspector, generator, source context, assurance, hazard, review, remediation and diagram navigation. Existing downstream generation tests use mocked providers.
- New tests cover GitHub/local provenance parity, Python/C++ shaped source evidence under the same rules, source-defined leaf targets, duplicate names across files, cross-file and ambiguous legacy boundaries, library aggregation, recursion, empty/historical rows, every-row accounting, input immutability and inspector pagination/exact links.
- `scripts/diagnostics/verify-functional-architecture-view.cjs` mounts the real shared table/view component in a fresh Chromium context with synthetic source rows. It verifies tab switching, 22 source relationships displayed as three function elements, no mounted CSU nodes in Functional, exact table trace links, CSU drill-through, GitHub/local parity, unchanged input data, quick-search registration and independent layout persistence across view changes. Source analysis and paid AI are not invoked.
- Visual inspection caught and corrected edges being obscured by container backgrounds; group labels and edge layering are now visible.
- The mounted browser check also covers a cyclic connection across two subsystem containers.
- Targeted ESLint reports no errors, with the generator's two existing unused-variable warnings. Production build passes with existing repository warnings. `git diff --check` passes.

Safari interaction and real customer datasets have not been exercised. No customer storage was edited, and no commit or push was performed.
