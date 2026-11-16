# Linear derivation matrix

The Design Management matrix now opens as the same simple, computed table style used by Code-Based Architecture. Its default sequence follows the requested workflow:

Functional decomposition → hazard analysis / consolidated HTR → software safety requirements → software requirements → system requirements → subsystem requirements → design details.

The implementation reuses `EngineeringArtifactTable`, including its searchable multiselect filters, column resizing, column visibility, copying and virtual rendering. Source cells retain exact object identity and open the owning object or the source text saved with a historical assessment. Concise FD/SSR/SWR/SYS/SUB/DES labels are display labels; the underlying object IDs remain unchanged.

## Computation and data preservation

- Project sources are discovered automatically from the containing Design Management project's artifact membership. Users can select a subset of those artifacts without assigning roles. The old rule/profile, relationship-review, coverage and pairwise tools remain under Advanced controls. Existing profiles, links and historical assessments are retained. The later [project-only scope refinement](project-traceability-scope-2026-11-14.md) restricts creation and inputs to this project boundary.
- The matrix follows actual saved object citations and supported explicit engineering links. It does not manufacture links from matching titles, folder membership or the fact that two documents are in the same project. Generic source citations establish derivation provenance; they are not converted into confirmed satisfaction, mitigation or verification claims.
- Each terminal object has a row containing its actual ancestors. Shared or consolidated ancestors remain visible without multiplying independent branches into a Cartesian product. Missing steps, missing adjacent source links, draft/unresolved evidence, changed source content and out-of-order references are reported as open issues.
- Software safety origins are carried through the downstream ancestry. A software requirement that does not directly retain its safety source produces a carry-forward gap, even if a later system requirement cites that safety object separately. The original safety text remains available for inspection.
- Saved assessments pin the computed chain and its source manifest. A later refresh does not rewrite an earlier snapshot. An unchanged cited object can remain current when another object changes the containing document's revision, provided the exact object content hash still matches.
- Consolidated HTRs are the hazard obligations. Original assessment rows stay in the HTL; their functional references are deduplicated before the matrix result crosses the worker boundary. Functional trace IDs from hazard tables are retained as metadata, without adding extra HTL document columns.
- Older HTLs that did not retain functional trace IDs show the missing functional link explicitly. Refreshing their source capture/HTL can retain those IDs from the saved hazard-analysis table. The matrix does not infer a historical function identity from its name.

## Generation order

New systems engineering projects generate software safety requirements before software requirements, then system requirements, subsystem requirements and design details. Software guidance explicitly preserves the originating safety behavior, conditions, criteria and citations. System guidance consolidates the supplied software requirements and retains their source links. Full HTL assessment inventories are excluded from ordinary downstream document dependencies; Safety Requirements receives the consolidated HTL input.

This changes planning for new projects. Existing project membership, source documents, accepted revisions, saved proposals and their original dependencies are not rewritten by opening or refreshing a matrix.

## Validation

Regression coverage includes the original Code-Based Architecture matrix, artifact generation and acceptance, exact scope selection, full saved derivation without role bindings, independent branches, missing links, historical sources, carry-forward gaps, original source identity, cancellation and large scopes. The reusable live scenario is `scripts/diagnostics/verify-design-derivation-matrix.cjs`; it uses synthetic evidence and no paid AI requests.

Validation completed:

- The relevant regression run passed 60 suites and 534 tests, covering Design Management artifacts and traceability, existing Code-Based Architecture matrix behavior, and requirements table filters. After the final internal capture-role namespace change, the three traceability suites passed all 53 tests, including the 12 UI tests and comma-containing source-title navigation.
- The production build passed. Existing repository lint, Browserslist and bundle warnings remain; no new warning identified a changed traceability or shared-table file. Source-map contents were compared with the final source files to verify the preview includes the final changes.
- Both Electron and Chrome passed all nine live matrix scenarios with zero page errors or AI requests. The fixture contains 26,278 original hazard assessments, 40 consolidated HTRs, and 40 objects at each derivation stage. It produces 40 complete chains. Removing one software requirement's safety citation exposes open chains and missing carry-forward, while the earlier saved revision remains complete.
- These live scenarios use a controlled upstream-freshness fixture: only the worker's unrelated `source-hash` operation returns the synthetic fixture hash. The actual traceability capture, matrix workers, source graph, saved revisions, transport and GUI remain active. This is not a validation of the user's original project data or AI requirement generation.
- The native desktop smoke passed, including API parity, SQLite, persistence, worker loading, export, cancellation, updater checks, renderer recovery and diagnostics. The isolated desktop preview was refreshed using its existing profile. Native repository source files were not modified, and no commit, push or release was performed.

Evidence:

- `/private/tmp/xhandle-derivation-regression.log`
- `/private/tmp/xhandle-derivation-core-final.log`
- `/private/tmp/xhandle-derivation-ui-final.log`
- `/private/tmp/xhandle-derivation-build.log`
- `/private/tmp/xhandle-derivation-electron.log`
- `/private/tmp/xhandle-derivation-browser.log`
- `/private/tmp/xhandle-derivation-native-smoke.log`
- Electron result and screenshots: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-WVdUen/`
- Chrome result and screenshots: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-6mCaQP/`

The Electron fixture's first assessment took 1,361 ms in this local run. This is a single synthetic-scope measurement, not a general performance guarantee.
