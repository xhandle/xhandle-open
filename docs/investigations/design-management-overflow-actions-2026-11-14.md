# Compact Design Management action controls

The Design Management workspace now groups entity actions in labelled **…** disclosures. The folder tree, folder contents, project, artifact, and matrix each own their controls; opening one does not expand the sidebar or consume document space.

- **Project actions:** Edit details, Source diagrams, Export project and traceability, Download project backup (JSON), Delete project, project traceability settings, matrix creation, and generation/proposal actions.
- **Artifact actions:** Existing artifact controls plus proposal review/acceptance, object creation, baselines, and revision history. A compact header status identifies a proposal ready for review.
- **Matrix actions:** Refresh, details, source selection, assessment save, exports, reviewed baseline, advanced controls, cancellation, and deletion.
- **Folder actions:** Header edit/delete controls and sidebar generation, subfolder, rename, move, and delete controls. Each folder-content row provides its own Open/Edit details/Remove disclosure.
- **Design Management actions:** Workspace generation, traceability profiles, SysML generation, and gap analysis.

View selectors, object editing toolbars, active generation progress, and modal confirmation footers remain visible. Existing permissions, busy states, and destructive confirmations remain in effect. Collaborator workflow guidance names the relocated controls.

The shared disclosure uses a portal to avoid clipping in scrolling panels, constrains its size to the viewport, supports Escape/outside dismissal and focus return, and dismisses on ancestor scrolling. It uses a nonmodal dialog role because artifact disclosures also contain review content and form controls.

Folder rename now uses the in-app dialog instead of Electron's unsupported native prompt. Its dialog key is distinct from the folder-content key, avoiding duplicate rendered folder contents after renaming.

## Validation

- 62 suites, 612 tests passed across artifacts, traceability, Collaborator, workspace/folder integration, and compact controls. Includes named action callbacks, export/download, source/profile dialogs, deletion cancellation/confirmation, permission checks, and folder rename.
- Production build passed with existing lint/Browserslist warnings. Source maps match all nine modified application modules, including the final folder-dialog fix.
- Electron and Chrome each passed 17 live scenarios: compact workspace/tree/folder/project menus, rename and detail editing, source/profile dialogs, real HTML/JSON exports, viewport bounds at 960 × 700, project-only matrix creation, 26,278-assessment matrix persistence/filtering/resizing/history, and confirmed matrix/project deletion preserving original source projects. Neither run reported runtime errors or made AI requests.
- Native desktop smoke passed (renderer, backend, SQLite, persistence, diagnostics, isolated profile). The existing manual preview was idle before refresh and was relaunched with the same profile and the tested renderer.
- `git diff --check` passed. The native desktop repository remains clean.

Local evidence:

- Tests: `/private/tmp/xhandle-overflow-regression-verified.log`
- Build: `/private/tmp/xhandle-overflow-build.log`
- Source-map check: `/private/tmp/xhandle-overflow-build-source-check.json`
- Electron: `/private/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-wBlIq4/result.json`
- Chrome: `/private/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-049H0b/result.json`
- Screenshots: `compact-project-actions.png`, `derivation-matrix.png`, and `delete-matrix-confirmation.png` beside each live result.
- Native smoke: `/private/tmp/xhandle-overflow-native-smoke.log`
- Preview staging: `/private/tmp/xhandle-overflow-preview-z1c2ez15`

The live fixture uses an isolated disposable profile with 26,278 synthetic hazard assessments and real artifact persistence/traceability workers. Only the unrelated upstream source-freshness hash is fixed to the fixture value; no paid AI calls are made. Native desktop source is unchanged. No commit, push, or release is part of this change.
