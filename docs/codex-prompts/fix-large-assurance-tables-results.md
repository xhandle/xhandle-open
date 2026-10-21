# Large assurance table performance implementation

Implemented 2026-10-18. Builds on the uncommitted loading-indicator work from the preceding request; it is preserved. No database schema, stored-result migration, or generation changes. Nothing committed or pushed.

## Changes

- EngineeringArtifactTable now uses the same measured-height VirtualTableBody as the architecture table. This covers Software, System, Subsystem Requirements, Design and Traceability. Dataset-wide filters and copy remain outside the window. Full-data search registers with the shared quick-search provider; distant highlighted rows use virtual reveal. Active editors stay mounted. Unique identities remain stable across row insertion/deletion; duplicate identities are disambiguated by source index. Removed the row-ref registry that could retain detached nodes.
- Added snapshot-local parent/child indexes and memoized inherited architecture-reference resolution. System/subsystem link cells no longer scan whole child collections for each row. Panel architecture-reference checks use a prebuilt lookup preserving exact, legacy, historical and ambiguous-reference rules. Indexes are transient and never saved.
- Traceability uses indexed software candidates, indexed parent/child joins and coverage sets rather than repeated full-list scans. Original candidate matching remains authoritative for legacy and alias behavior; source ordering is preserved. There is no output truncation or chain-count cap.
- Review registration normalizes only the current batch of 50 rows, awaits registration before scheduling the next batch, checks existing IDs, and does not restart because the review context object changed. Existing reviewed rows are skipped. Review-update events are scoped to the artifact project/repository.
- Artifact panels and traceability ignore storage change events from other project/repository scopes. Same-scope collection loading remains unchanged; this is not a rewrite of storage recovery.

## Validation

- Full assurance directory plus VirtualTableBody suite: **24 suites / 132 tests passed**. Subsequently added and passed the existing-reviewed-row preservation case (133 distinct regression tests total).
- Additional before/after parity audit: **2 tests passed**, covering 20 mixed-link fixtures (multi-parent, missing parents, legacy refs, historical rows) and a 1,000-chain complete dataset, with exact output equality.
- Synthetic 1,000-chain construction: previous builder **4,498 ms**, indexed builder **32 ms**, identical 1,000 output chains. Single-run Jest measurement, not a Safari latency promise.
- Added tests verify fewer than 30 mounted rows and fewer than 30 computed-cell evaluations on a single selection at 1,000 rows; full 1,000-row Markdown copy; offscreen quick-search activation; distant target reveal while retaining an editor; index equivalence; review batching and decision preservation; unrelated-project event suppression.
- `CI=false npm run build` completed with existing lint, Browserslist and bundle-size warnings. `git diff --check` passed.

The parity harness and pre-indexing baseline are archived as `traceability-indexing-parity-audit.test.js.txt` and `traceability-before-indexing.js.txt`. Reproduce by temporarily copying them to `src/features/code-architecture-assurance/traceabilityParityAudit.test.js` and `TraceabilityBaselineAudit.js`, respectively, then running that test path and removing those temporary copies.

## Limits / next live check

No live customer/Safari session was available. Open the large localization project and check scrolling, editing, filtering, navigation and trace links in all five tabs. The improvements bound mounted DOM and eliminate the confirmed repeated joins; they do not guarantee constant-time behavior for all datasets. Full export/copy/search still processes all matching data. Traceability chain construction remains synchronous, and genuine many-to-many relationships can still produce large intermediate outputs. Global Review Center loading/persistence and other unrelated platform costs remain outside this change.
