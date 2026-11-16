# Streamlined Design Management actions

Design Management now has one primary upper-right **…** control combining the current folder, project, artifact or matrix actions with workspace creation and tools. Individual sidebar/list-row menus keep their own scopes.

Common commands remain directly available. Secondary commands use collapsed categories such as Generation and sources, Traceability, Export, Objects and history, Create, and Design tools. Only one category opens at a time. Delete stays separate and retains its confirmation dialog. The command popup is narrower, has no large status cards, and preserves keyboard access, dismissal, focus return and viewport bounds.

Artifact coverage warnings, citation counts and before/after comparisons now live in the **Document proposal review** dialog. Its footer remains visible while the content scrolls. **Review proposal** opens the proposed document and review dialog; users can inspect the full document/source register, then reopen review to accept. Project-managed artifacts provide one **Review project and traceability** command and separate **Proposal details**, with acceptance remaining project-wide. Project acceptance appears in the project review surface. Collaborator workflow guidance reflects the relocated controls.

Current editors retain ownership of callbacks, permission/busy checks and dialogs. A toolbar outlet renders the current editor's disclosure; the workspace-only fallback appears when no editable primary item is mounted. Switching surfaces replaces the owner and removes stale actions. No command implementations or source records are duplicated.

## Validation

- Related regression: **614 tests passed in 62 suites**. The final small navigation/lint cleanup was rechecked with **53 passing tests in three suites**.
- Production build passed. Source maps exactly match all nine menu/context/style/workflow source modules. Existing repository-wide lint and Browserslist warnings remain; the unused variable introduced during refactoring was removed.
- Final real-time Electron and Chrome checks each passed **20 scenarios**, with **zero renderer errors** and no AI requests. They also exercise category expansion, Enter/Tab keyboard operation and Escape focus return.
- Native desktop smoke passed: renderer mount/reload, API and SQLite, persistence, preload isolation, backend authentication, workers, updater parity, recovery and diagnostics.
- Whitespace checks passed; the native desktop source repository remains clean.

Final live evidence:

- Electron: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-IUBWK8/result.json`
- Chrome: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-ITBRlp/result.json`
- Build/source verification: `/private/tmp/xhandle-streamlined-actions-build-final.log`, `/private/tmp/xhandle-streamlined-actions-source-verification.json`.

The isolated manual preview is refreshed with the verified production renderer while preserving its profile.

The live harness uses synthetic records in disposable profiles. It verifies single-menu placement, collapsed categories, one open category, proposal warning/comparison preservation, footer visibility in a small window, keyboard dismissal, folder/artifact edits, project exports/source/profile controls, and matrix history/filtering/resizing/deletion using 26,278 original assessments. It makes no paid AI requests.

No commit, push, release, or native desktop source change is included.

## Simplified headings and diagram surface

Removed the idle proposal/draft badge, artifact type/system eyebrow, revision/source/working-document line, and matching project-header metadata. Titles and actionable review commands remain. A single-source architecture no longer repeats its source caption/level above the canvas; multiple-source selection remains available. The static drag/resize instructions and routine arrangement-save/success text are removed. Loading indicators and actionable save/restore errors remain; ordinary saves do not add a temporary row that shifts the canvas.

Existing UI checks use non-visible revision/state attributes instead of waiting for the removed text. Focused validation passed 53 tests across the artifact/project workspace, source/diagram controls and arrangement suites, with arrangement error/retry checks rechecked after the final status cleanup. The production build passed and source maps exactly match all four changed components. Electron and Chrome each passed 21 live checks with zero renderer errors, including a real saved architecture canvas. Evidence: `/private/tmp/xhandle-quiet-design-build.log`, `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-g1k7bk/result.json` (Electron), and `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-iAuPnz/result.json` (Chrome). The isolated preview was refreshed and its mounted renderer, API health and preserved profile verified.
