# Design Management toolbar review — November 14, 2026

The toolbar was exercised in the actual Electron shell against the production renderer built from the local working tree. All test workspaces were disposable and contained synthetic data. The installed desktop profile was not used.

## Findings and changes

- **History:** draft objects opened a panel containing only “Object history” and its close button because there were no accepted revisions. The panel now shows the current draft and explains that draft edits do not create accepted revision history. Accepted object revisions remain available, newest first. Shared dialogs now have accessible names, Escape dismissal, focus containment, and focus restoration.
- **Traceability selection:** local items were not connected to the toolbar. Local trace items now support mouse, keyboard, and modifier selection. Supporting evidence and objects from other documents remain outside the current document's editable selection.
- **Hierarchy controls:** toolbar arrows ignored the availability rules already used by the Arrange menu. Invalid boundary actions are now disabled and guarded. Artifact commands normalize absent/root parent IDs, and commands that cannot change the structure do not save a new revision.
- **Older modules:** swapping equal or absent order values could leave rows in the same position. Moves now assign explicit sibling positions and support rows stored with `projectId` instead of `folderId`.
- Controls without a handler, editing controls on read-only objects, and selection controls without a selection are disabled as appropriate. View navigation and read-only History remain available.

## Verification

| Check | Result |
| --- | --- |
| Focused regression tests | 67 tests across 7 suites passed |
| Production renderer build | Passed with existing lint/Browserslist warnings |
| Live Electron toolbar tests | 18 scenarios passed, no page errors |
| Full native desktop smoke | Passed, including API/SQLite, persistence, sandbox isolation, workers, export, recovery and diagnostics |
| Whitespace check | `git diff --check` passed |

The live scenarios covered accepted artifacts and saved drafts in Outline, Table and Traceability, using Architecture, Concept of Operations and Safety Requirements fixtures, plus older requirement modules. Each scenario exercised History, Edit, New child, Move up/down, Promote/Demote, Insert table, the actual image file chooser and save, Delete, Clear selection and boundary disablement. Artifact scenarios also checked saved results after reloading. Unit tests additionally cover read-only navigation and preventing selection of source evidence for editing.

Hazard Tracking List intentionally remains table-only and does not expose this object toolbar. This check does not certify every project dataset or AI generation output; it verifies the toolbar operations and storage paths with controlled fixtures. No release was published.

## Local evidence

- Reproduction: `/private/tmp/xhandle-toolbar-live-FNB6NM/result.json` (History text was just its heading and close button; trace selection did not enable History).
- Architecture/Concept of Operations and module matrix: `/private/tmp/xhandle-toolbar-live-JfatZu/result.json`.
- Safety Requirements and module matrix: `/private/tmp/xhandle-toolbar-live-lq6rzl/result.json`.
- Live test harness: `/private/tmp/xhandle-toolbar-live.cjs`.
- Regression log: `/private/tmp/xhandle-toolbar-tests.log`.
- Native smoke log: `/private/tmp/xhandle-toolbar-native-smoke.log`.
- Production build log: `/private/tmp/xhandle-toolbar-build.log`.
- Staging app: `/private/tmp/xhandle-toolbar-preview-m5cBd5` (explicitly marked as an uncommitted review build).
