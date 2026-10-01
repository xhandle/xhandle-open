# Manual functional diagramming fixes

Executed [the implementation prompt](../codex-prompts/fix-manual-functional-diagramming.md) against the findings in [the review](manual-functional-diagramming-review.md).

## Behavior

- Select a subsystem or system, then Add node to create functions inside it. Repeated additions find space without moving existing functions.
- Drag an ungrouped function into a container to establish membership. Hold Option/Alt when starting a drag to transfer an existing child between containers or out. A drop-target message identifies the destination. Ordinary dragging within a container retains the existing container-growth behavior.
- Context-menu grouping and creating a subsystem around selected functions use one membership operation. Multiple selected functions retain their relative spacing; an incoming selection is shifted if necessary to avoid existing children. Required ancestor bounds grow. Existing system collision separation remains in force and can move colliding systems.
- Membership changes update only the selected function's outgoing rows. Incoming interfaces retain their source function's allocation.
- Manual containers are reused by table/category reconciliation. Empty containers touched by a manual membership operation remain available instead of being removed by inferred grouping.
- Creating a connection preserves endpoint placement, explicit ownership, and descriptions. A deliberately ungrouped endpoint remains ungrouped.
- Disconnected functions persist while idle and through reload. Renaming preserves node identity references and saved placement. Subsystem renaming preserves peer allocations.
- Undo/redo restores matching graph, row, and category revisions; top-level subsystem resizing now creates an undo checkpoint.

## Compatibility boundaries

The automatic layout algorithms, initial-arrangement gates, CSV row parsing, hazard analysis, code-based architecture diagram, and general table/import category synchronization were not replaced. The shared reconciliation changes recognize explicit manual placement and existing manual containers. CSV replacement clears the manual-membership preservation flag on automatically generated containers so new import allocations can take effect. Saved containers that already fit their children no longer grow by an extra grid rounding step during restoration.

This implements predictable manual editing within xHandle's current function/subsystem/system model; it does not claim complete draw.io or Lucidchart feature parity.

## Validation

- Full Jest suite: **127 suites passed; 1,162 tests passed**. One suite/two tests remain skipped.
- New regressions cover disconnected persistence, selected-container creation, source-only ownership, explicit root placement, duplicate prevention, history restoration, selection spacing, nested drop targets, and absolute-position preservation on detach.
- Fresh Chrome and WebKit contexts reproduce the original failures using synthetic projects. WebKit assertion runs cover manual-to-connected conversion, top-level and nested grouping, undo/redo, disconnected reload, root drop, Option/Alt transfer/detach, disconnected function rename, and subsystem rename. No page errors occurred in the completed checks.
- Existing CSV replacement diagnostic passed in Chrome and WebKit for diagram, table, and split views: complete hierarchy, repeated replacement, first-render Auto arrange parity, tab switching, and reload.
- Existing WebKit canvas gesture/search diagnostic passed, including modifier release after search and pan/zoom behavior.
- Existing large-view diagnostic passed with 200 interfaces, 247 diagram nodes, and 1,400 draft hazard rows. Deferred rendering, search reveal, filtering, collapsed-group search, cell editing without internal scrolling, saved layout, and edit persistence passed without page errors. This is a regression check, not a guarantee of performance on every customer diagram.
- ESLint: zero errors. Existing App/diagram warnings remain; new helper and test files have no lint warnings. `git diff --check` and diagnostic-script syntax checks passed.

Run the new browser assertions using `scripts/diagnostics/verify-manual-functional-diagramming.cjs`. Set `REVIEW_MODE` to `manual`, `mixed`, `nested`, `disconnected`, `drag`, `rename`, or `group-rename`; set `REVIEW_BROWSER=webkit` for WebKit. See the script header for browser dependency configuration. The original review script and measurements are preserved separately.

Automated WebKit is not the user's installed Safari with its extensions. No native Windows or physical trackpad test was performed. All browser fixtures used isolated storage; customer projects were not modified. No commit or push was performed.

## Follow-up: connected functions followed a manual move

The first fix preserved independent source allocations, but missed connected functions whose subsystem was inferred from the moved source's interface rows. Regressions reproduced both ungrouped peers and receiver-only peers in an existing subsystem moving into the new container. Their row data did not need to change for the renderer to infer a different parent.

Manual membership changes now snapshot connected, unselected endpoints' current placement as explicit before publishing the changed allocation. This also protects subsystem renames. Only the requested functions change membership; edges remain intact. Imported/generated ownership inference is unchanged, and the existing CSV replacement path still resets explicit placement for imported functions.

Two additional integration cases verify peer membership, position, connections, undo/redo, and reload. The `connected-drag` browser mode verifies actual dragging with App category reconciliation in Chrome and WebKit. Both browser runs passed without page errors. The full suite now passes **1,164 tests across 127 suites** (two tests/one suite skipped).
