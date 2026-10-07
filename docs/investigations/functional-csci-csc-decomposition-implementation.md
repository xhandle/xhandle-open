# Functional CSCI/CSC decomposition implementation

Date: 2026-10-07

Implemented the prompt in `docs/codex-prompts/implement-functional-csci-csc-decomposition.md`.

## Result

Functional generation now includes a dedicated allocation stage that groups its responsibilities into Subsystem → CSCI → CSC → Function. The diagram's existing CSCI/CSC containers receive these allocations. Source and destination Subsystem/CSCI/CSC fields are available in the Functional table, CSV, clipboard and search/filter values.

Existing saved Functional models remain readable. The **Update CSCI/CSC hierarchy** action upgrades allocation only: function names, descriptions, identities, interactions and supporting source references remain intact. The existing revision-checked storage transaction publishes the completed result; cancellation, validation or storage failure leaves the saved model in place. Layout storage is keyed by hierarchy revision, retaining old layouts while allowing newly grouped containers to be arranged correctly.

## Implementation choices

- `functionalHierarchy.js` allocates every Functional endpoint, including responsibilities derived from canonical and model-extracted calls. Requests contain at most 24 responsibilities and a bounded catalog of up to 48 relevant established groups. There is no 300-row bypass in this Functional stage and no repository/language-specific allocation rule. Names are based on evidenced responsibilities rather than fixed directory levels or forced group counts.
- Allocation responses must cover exact membership and have complete hierarchy fields and rationale. Invalid JSON/membership is retried and subdivided; timeouts can also subdivide. Nonrecoverable transport errors stop rather than multiplying requests. No partial allocation is published as complete.
- Endpoint ownership is indexed by exact normalized file/symbol. Explicit endpoint allocations take precedence over generic row allocation; conflicting values are passed as evidence requiring reconciliation. A destination without ownership is not assigned its caller's ownership. Complete explicit allocations cannot be silently overwritten.
- `functionalModel.js` resolves endpoint evidence before generating responsibility descriptors and applies hierarchy after existing consolidation. Ready legacy models take the hierarchy-only path rather than repeating responsibility generation. The responsibility model version remains compatible; hierarchy has its own version marker.
- `FunctionalArchitectureDiagram.jsx` adds six allocation columns without shifting existing table column positions, adjusts virtual-table column spans, exports/copies hierarchy, exposes the legacy upgrade action, and uses a hierarchy-specific layout revision. Split view and function/action navigation retain the shared implementation.
- Functional hazard snapshot hashing now includes destination allocation, so a destination-only ownership change is also detected. Existing runs retain their original input snapshots and can become stale after regrouping; they are not automatically regenerated. Detailed source architecture and its snapshot hash remain unchanged by a hierarchy-only upgrade.

The upstream detailed classifier's fallback remains a fast source-inventory allocation. The new Functional stage corrects the consequence identified in the review without rewriting detailed CSU rows, repeating extraction, or changing the source schema consumed by downstream activities. It runs on the shared Functional processing path used by both GitHub and local analysis.

## Validation

- **152 tests passed across 9 suites** covering Functional hierarchy/model/table, generation, navigation, hazard input/staleness, assurance artifact generation, Functional layout and CSU ordering.
- New cases cover 337 canonical inputs under shared path prefixes, multiple CSCs within a CSCI, bounded requests/catalogs, exact endpoint ownership, conflicts, explicit destination ownership, malformed/unknown membership, timeout subdivision, transport failures, cancellation, hierarchy-only upgrades, stable function/relationship trace IDs, reload readiness and GitHub/local equivalence.
- Isolated Chromium diagnostic `scripts/diagnostics/verify-functional-hierarchy.cjs` uses synthetic code evidence and a stubbed provider. It writes through real IndexedDB, reloads the page, and verifies two CSCIs containing four CSCs, four function nodes, no redundant CSU wrappers, split-table hierarchy headers, unchanged relationship IDs and no runtime errors.
- Production build completed with lint warnings; no compilation errors. `git diff --check` passed.

## Limits

No paid provider calls were made and the customer's saved project was not altered. The supplied CSV omits the original hierarchy, so the exact resulting component assignments for that project must be generated from its saved source/model evidence. Tests establish allocation mechanics and persistence, not the semantic correctness of live model-generated groupings. Group boundaries remain evidence-grounded inferences requiring engineering review. Catalog context is bounded for scalability; equivalent-group recognition across very large models depends on the provider's use of that context.

No commit or push was performed. Existing unrelated workspace changes were preserved.
