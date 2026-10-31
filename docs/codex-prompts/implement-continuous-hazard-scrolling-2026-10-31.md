# Continuous hazard table scrolling in Chrome and Electron

Implement this task in the shared xHandle application. The code-based architecture table is the interaction reference: users can scroll through the entire table without clicking Next/Previous rows or loading chunks manually. Give the saved hazard analysis table the same continuous scrolling behavior in Chrome and the Electron desktop app.

Inspect the current saved-row worker, paged panel, row virtualization, grouping, filtering and focus paths before editing. Preserve existing uncommitted work. Keep the authoritative saved run and export/import formats unchanged.

Requirements:

- Expose the full result set as a continuous scroll range, including distant scrollbar jumps and scrolling backwards. Remove user-facing page/chunk navigation.
- Virtualize mounted rows, prefetch adjacent data automatically and bound retained row data. Do not fix paging by loading every historical run, evidence snapshot, or result cell into renderer memory.
- Keep variable-height rows, column visibility/resizing, group collapse/expand, whole-result search/filtering, operational contexts, absolute row identity, trace navigation, review annotations, selection, deletion, partial-result isolation, CSV import/undo/export and copy semantics correct.
- Cancel stale work on filter, source revision, project/run changes and unmount. Surface real read failures with retry; do not silently drop rows or mix results from different scopes.
- Keep scrolling responsive while background storage work runs. Avoid full-dataset recomputation on each scroll event. Preserve prior diagram, table, storage and transfer fixes.
- Exercise the real saved-row/IndexedDB path with large synthetic data in both Chrome and Electron. Record continuous and reverse scrolling, large jumps, mounted-row/data bounds, timings and any remaining limitations. Do not promise zero latency without evidence.
- Add meaningful regression tests for range changes, shortened storage reads, stale completion, errors/retry, filtering/focus, groups, source indices and editing/export behavior. Run relevant existing tests, lint and a production build.

Produce the implementation and a concise review report with results and limits. Do not publish updates, commit/push, run paid analysis or modify customer storage. Any desktop preview must use isolated test data and remain separate from the installed app.
