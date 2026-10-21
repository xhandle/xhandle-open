# Traceability matrix 99% investigation

No production code changed.

## Findings

1. The screenshot is in display-row preparation, after source loading and chain construction. `TraceabilityMatrixPanel.js:528` selects separate loading/building indicators; `:533` supplies the exact Preparing traceability matrix table label shown in the screenshot.
2. The percentage covers only row enrichment, not all work required to display the table. `usePreparedArtifactRows.js:30` processes batches of 100; `:33` builds a full cache Map on the last batch; `:34` publishes prepared rows. For 11,859 rows, 11,800 completed rows produces 99%, leaving 59 rows plus finalization. No independent 100% paint is required before the loader is replaced.
3. After enrichment, synchronous full-table work remains: `EngineeringArtifactTable.js:260` searches every row for focus even when the highlight set is empty; `:261` performs two passes to construct duplicate-aware virtual keys. `VirtualTableBody.jsx:17` then maps keys, builds positions and calculates offsets. These stages do not yield or contribute to the displayed percentage. Until React renders/commits the table, the previous 99% display can remain visible. Active filters can add another scan.
4. Row windowing is working. The synthetic 11,859-row fixture with the actual traceability column definitions mounted only 14 tbody rows. It performed 35,629 rowIdentity calls after the 99% state before the table appeared. This confirms post-99% full-dataset work, not thousands of mounted DOM rows.
5. No indefinite hang was reproduced. The final synthetic test completed in 141 ms under Jest with fake timers; this is not a Safari benchmark and does not represent the real project's cell contents, memory pressure, layout cost, or other background work. The code path plausibly contributes to the reported delay, but the exact live duration/cause is not established.

## Recommended fix

- Extend incremental preparation to include duplicate-aware row identities and reusable virtual layout/index data; avoid reconstructing equivalent indexes during the final render.
- Skip focus lookup entirely when there is no focus target.
- Account for finalization in progress or display a truthful finalizing stage; do not imply that enrichment percentage measures time remaining.
- Preserve same-scope editor/filter/selection state and existing virtualization, search, copy and navigation semantics.
- Add phase timings around enrichment, key/index preparation and first table commit; use a live Safari trace on this project to determine remaining bottlenecks before claiming the stall eliminated.

## Validation

Four focused suites / 20 tests passed (preparation audit, traceability loading, engineering table and virtual table). Repeated the audit with actual matrix columns: passed, 11,859 rows, 118 callbacks to 99%, 35,629 subsequent identity calls, 14 mounted rows. Audit archived in `investigate-traceability-99-percent-audit.test.jsx.txt`; temporary source test removed. No production build needed for a read-only investigation. No commit or push performed.
