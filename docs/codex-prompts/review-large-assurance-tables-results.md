# Review results: large requirements, design, and traceability tables

Reviewed 2026-10-18 against the current working tree (baseline 3afdafa). No production changes. These five tables are **not aligned** with the architecture/hazard viewport rendering improvements. The software lag has a confirmed implementation explanation; other downstream tables share that exposure and have additional costs.

## Ranked findings

1. **High — unbounded mounted rows across all five tables.** `EngineeringArtifactTable.js:335` maps every filtered row into the DOM, including every visible cell, link, and edit button. It has no row window or pagination. Selection/edit/column-width state lives in this component and rerenders this entire map. `EngineeringArtifactPanel.js:575` uses it for all four artifact kinds; `TraceabilityMatrixPanel.js:463` uses it for the matrix. In contrast, architecture uses `VirtualTableBody` (`generateFunctionalDecompositionFromGitHub.js:4528`), with measured heights and bounded mounted rows above 100 items (`VirtualTableBody.jsx:16`). Hazard uses `useHazardRowWindow` and only renders its visible entries. This is the clearest shared cause of interaction lag.

2. **High — synchronous traceability construction has repeated full-list joins.** `TraceabilityMatrixPanel.js:216–278` scans software for each architecture row, then system/subsystem/design collections for matched parents. Subsequent orphan checks also scan generated rows. `rowForChain` resolves inherited architecture references repeatedly (`:82`); `artifactUtils.js:522` rebuilds parent maps in resolution calls when direct references are absent. Construction runs in render-time `useMemo` (`TraceabilityMatrixPanel.js:429`), so memoization avoids some repeat work but cannot make initial construction nonblocking. Multiple children can expand intermediate chains before consolidation. A row window alone will not fix this computation.

3. **High — repeated downstream link and architecture-reference scans.** System table computed columns call `downstreamSubsystemRequirementIds` and `downstreamDesignElementIds`; subsystem calls the latter (`EngineeringArtifactPanel.js:25–52`). These helpers filter entire related collections (`artifactUtils.js:553–583`) per cell evaluation. Rendering, copy, and filter-option construction can repeat these scans. All four panels also compute `affectedReferenceCount` across all rows (`EngineeringArtifactPanel.js:500`), calling `functionalRowIndexForTraceValue` for references; that helper maps/filters the architecture collection on each lookup (`artifactUtils.js:610`). Memoized aggregate calculations still repeat when rows/context change. Software and design therefore have preprocessing costs in addition to the shared DOM problem. Impact depends on reference population and dataset sizes.

4. **Medium — review registration can repeatedly reconstruct remaining work.** `useArtifactReview.js:46–104` synchronously normalizes all missing rows before scheduling batches of 50. The effect depends on both the review context object and reviewItems. Creating a batch updates review state and can cancel/restart registration, rescan rows, and reconstruct the remaining missing records. Normal panel use enables this (`EngineeringArtifactPanel.js:388`). This is an additional potential source of post-generation work; its exact contribution was not profiled in a live run. Existing saved review records reduce this cost. Do not equate hidden review columns with disabled registration.

5. **Medium — broad artifact change notifications reload unrelated collections.** `EngineeringArtifactPanel.js:281–329` loads all four artifact collections on mount and on every assurance change event; the project/repo/kind check happens only for the additional current-kind read. Traceability also refreshes for any assurance event (`TraceabilityMatrixPanel.js:423`). Reloaded collection references invalidate computations. Scope notifications and coalesce loads, preserving existing protections against stale reads and edits. Autosave already has a loaded-snapshot guard (`EngineeringArtifactPanel.js:362`); this review does not claim an unconditional autosave loop.

6. **Medium — row refs retain detached nodes.** The row ref callback (`EngineeringArtifactTable.js:373–380`) records each alias only when node is non-null, without deleting aliases on detach. Filtering/deleting can retain detached row nodes until replacement or table unmount. This is a code-supported retention risk, not a measured heap leak in the customer's session; handle cleanup when introducing windowing.

## Alignment

| Table | Bounded mounted rows | Additional reviewed costs |
| --- | --- | --- |
| Architecture | Yes, VirtualTableBody | Full-data operations still exist; not claimed cost-free |
| Hazard analysis | Yes, hazard row window | Full-data operations still exist; not claimed cost-free |
| Software requirements | No | Reference checks, review registration, broad reloads |
| System requirements | No | Above plus downstream link scans |
| Subsystem requirements | No | Above plus design link scans |
| System/subsystem design | No | Inherited reference resolution, review registration, reloads |
| Traceability matrix | No | Synchronous joins, repeated reference resolution, broad refreshes |

Inactive workspace panels are conditionally unmounted in App; this is not five hidden tables rendering simultaneously. Inline downstream `loadArtifactRows` calls in App were checked: the loader has a memory cache (`artifactUtils.js:274`), so they are not proven full storage reparses on every render. Filter option construction scans/sorts the full dataset (`FilterableTableHeader.js:48`) and caps only the returned options, but architecture shares that filter helper: it is not the primary difference. Textareas are mounted only for the active editor, not every cell.

## Executed evidence

Temporary audit used actual exported components/functions in Jest/jsdom, synthetic data only:

- 1,000 engineering rows: **1,000 mounted data rows**.
- Single cell selection with unchanged rows: **1,000 computed-column evaluations**.
- Same 1,000 items through VirtualTableBody: **13 mounted data rows**, plus spacers.
- Traceability, one-to-one complete chain, same N records in each of five collections, no direct inherited reference shortcuts:

| N per collection | Output chains | Construction time |
| ---: | ---: | ---: |
| 100 | 100 | 61 ms |
| 500 | 500 | 1,098 ms |
| 1,000 | 1,000 | 4,322 ms |

Single-run timings include test instrumentation/runtime overhead and are not a browser benchmark. They demonstrate poor scaling in the real builder, not exact customer latency. No large customer data was loaded, no providers called, and no saved results changed. Live Safari profiling was unavailable; no claim of a complete runtime diagnosis.

Command: `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-assurance/largeTableAudit.test.jsx src/features/code-architecture-assurance/EngineeringArtifactTable.test.jsx src/components/VirtualTableBody.test.jsx`

**3 suites / 11 tests passed**, including the two audit cases. Audit source archived as `review-large-assurance-tables-audit.test.jsx.txt`; to reproduce, temporarily copy to the original test path above and remove afterward. Existing tests cover table copying, filtering, selection, and the virtual body; passing them does not establish scalability of the current assurance table.

## Recommended implementation sequence

1. Integrate the existing measured-height VirtualTableBody into EngineeringArtifactTable. Preserve stable row IDs, source row indices, editing focus, collaborator selection, review links, highlight/reveal and filter clearing. Clean detached row refs. Keep copy/export working from the complete filtered model, and register full-data quick search so offscreen rows remain discoverable.
2. Build shared immutable indexes once per relevant dataset revision for parent/child IDs, architecture aliases, and inherited references. Preserve ambiguity rules and historical references. Use these for link columns, affected counts, and traceability; do not truncate chains to hide slowness. If indexed construction still blocks, chunk or move computation off the main thread with cancellation and scope checks.
3. Make review registration incremental and stable across context updates; normalize only each new batch and preserve review decisions. Scope/coalesce artifact reloads to relevant project/repo and artifact kinds. Do not change database schema or generation logic for this performance fix.
4. Validate small/large datasets, variable row heights, scrolling while editing, distant trace/review jumps, quick search, full filtered copy/export, filters, column resize, and deletion. Compare indexed trace output against existing multi-parent, orphan, alias, duplicate-ID and historical-reference fixtures. Test rapid project switches, failed/out-of-order reads and review preservation. Add scale checks for mounted DOM and lookup work, then measure actual Safari interactions with the user's large project.

No performance fixes have been applied by this review.
