# Large-architecture hazard-tab lag investigation

## Findings

1. **Synchronous draft preparation now runs on the tab transition; it repeats on return.** App.js's codeArchitectureCsvDraft useMemo gates construction on the safety/hazard view and no existing run. The memory fix intentionally removed eager work from architecture publication, but moved it onto the user interaction. Leaving the tab sets the memo result to null; returning rebuilds the draft even if the architecture, method, and context are unchanged. useMemo does not retain the earlier result for alternate dependency sets. This affects draft/no-run workspaces, not existing completed hazard runs.

2. **Draft preparation produces several full expanded representations before paint.** buildCodeArchitectureHazardInput expands eligible source relationships by guide phrases and contexts, builds a Functional Decomposition sheet, normalizes traceability and computes fingerprints. buildCodeArchitectureHazardCsvDraft builds a second summary sheet, assigns IDs, and normalizeCodeArchitectureHazardRun constructs summaryRows. For STPA, one relationship and one context yields seven variants. Hiding columns does not prevent these data structures from being built. The App-provided fingerprint avoids duplicate architecture hashing, but draft preparation still performs substantial synchronous transformation.

3. **Deferred rows are not bounded DOM virtualization.** CodeArchitectureHazardSummaryTable initially expands every group and mounts DeferredHazardRow for every item. Each row computes height from visible cell text, runs layout effects, and installs a placeholder DOM row plus observer registration. Offscreen expensive cells are deferred, but components/placeholders and initial layout still scale with the full result. Revealed cells stay mounted; switching tabs unmounts/remounts the table. This also affects workspaces with completed hazard results where no draft is constructed.

4. **Additional full-sheet preparation on panel mount.** Panel assigns IDs/fills not-applicable fields and creates a functional trace set. Table builds row wrappers, contextual grouping, and visible-summary data. These are secondary synchronous costs; the browser contribution has not been measured. Filter option discovery is lazy when a column menu opens, and no-filter evaluation returns the row array directly, so generating every dropdown's options is not the cause of initial tab lag. Quick-search entries are supplied lazily by a provider, not all eagerly generated at mount.

## Bounded measurements
Temporary Jest/Node fixture, one context, short labels, 4 KB evidence per architecture row, 44 draft columns:

| Relationships | Hazard rows | Fingerprint | Draft build using supplied fingerprint | Height scan |
|---|---:|---:|---:|---:|
| 100 | 700 | 6 ms | 118 ms | 4 ms |
| 500 | 3,500 | 25 ms | 481 ms | 18 ms |

These timings exclude browser rendering/layout and use synthetic evidence. They demonstrate synchronous pre-render cost, not an exact diagnosis of the user's Safari timing or a linear projection for larger systems. Multiple contexts and richer real evidence can add work. Thirteen tests passed across the bounded probe, CSV tests, and panel tests. Temporary probe removed. No paid requests, browser data access, or production-code changes.

## Recommended fix order
1. Keep lazy preparation, but move expensive draft assembly off the render path into cancellable/cooperative preparation (worker where practical), allowing a loading state to paint first. Merely wrapping work in a Promise or useMemo will not free the main thread.
2. Retain at most a bounded current draft cache across tab switches, keyed by project/repo, immutable architecture revision, method and context. Preserve row IDs and invalidate on actual inputs changing. Avoid caching every large project or treating mutable object identity as proof of unchanged evidence.
3. Replace all-row placeholders with viewport-bounded row/group rendering or controlled progressive mounting. Preserve editing/focus, cross-links, CSV export of the full filtered model, quick search, counts and group controls.
4. Avoid preparing export-only/duplicate sheet representations until needed, where the table/import contract permits it. Reuse normalized summary and grouping results when inputs are unchanged.
5. Add real browser performance marks separating preparation, React commit and layout; verify first/repeat opens for draft and completed runs, multiple contexts and project switching. Use the affected Safari project for final acceptance without regenerating it.

## Conclusion
The reported lag is consistent with source-confirmed synchronous draft work plus unbounded initial row mounting. The recent memory change explains why draft cost is now paid on tab opening, including repeated openings. It removed the dangerous giant-string allocation but did not make hazard-tab preparation asynchronous or table mounting proportional to the viewport. Actual Safari profiling is still needed to quantify each contributor.
