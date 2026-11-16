# Project-only traceability matrix artifacts

Traceability matrices are created from **Create traceability matrix** in a Design Management systems engineering project. They are absent from standalone engineering artifact generation. The creation dialog fixes the containing project and placement rather than asking for a separate source-project owner or library destination.

Creation registers the matrix as a project member atomically with its metadata. Its inputs must be other live artifact members of that exact project. Matching folders, names, or underlying Projects / Code-Based Architecture ownership do not qualify a document as a member. Other matrices, standalone modules and standalone SysML models cannot be matrix inputs. The linear derivation view and existing source citations remain unchanged.

Both the default source picker and advanced role bindings read the project's artifact catalog. Creation, configuration and every assessment revalidate this boundary independently of the UI. Project membership is pinned in the assessment's source manifest, so a changed input population requires reassessment before saving. Automatic selection includes newly added matching project artifacts after refresh.

Computed matrix assessments are excluded from the project's AI document generation, dependency inputs and joint document acceptance. Their saved revisions remain intact through fresh generation and acceptance. They remain project members for navigation, project backup, movement and deletion. Moving one outside its containing project is rejected.

Earlier standalone matrices retain their saved history. Refresh explains that they need to join a Design Management project. Adding an existing matrix through the existing library move/adoption flow resets its working source scope to the destination project's artifacts without rewriting historical assessment revisions.

**Delete matrix** is visible in the primary action row. A confirmation dialog with a fixed action footer supports cancellation and explicitly removes the matrix and its saved assessments. Source documents remain in the project. This replaces the action previously hidden in Advanced controls and its native browser confirmation.

Deleting the computed matrix also preserves the state and run token of any active source-document generation, provided no document incorrectly depends on the matrix. Ordinary source-document deletion retains its existing dependency invalidation behavior.

## Validation

- Design Management regression: **56 suites, 535 tests passed**. Coverage includes project scope enforcement, automatic membership updates, both source pickers, generation and acceptance with matrix members, legacy matrix adoption, history preservation, and existing artifact workflows.
- After adding the visible delete action: **three traceability suites, 58 tests passed**, including cancellation, source-document preservation and removal of the matrix's project membership.
- With the generation-preservation safeguard: **four focused suites, 98 tests passed**, including engineering-project generation and acceptance.
- The project-only workflow passed all **11 live checks in Electron and Chrome**, including project creation, source isolation, filters, resizing, persistence, immutable saved assessments and safety carry-forward gaps. These checks used synthetic evidence with the controlled upstream-freshness fixture described in the linear derivation report. No paid AI requests were made.
- The initial local preview build used relative asset paths, which broke worker chunk loading. The supported root-relative production build passed. Source-map contents for all ten changed implementation modules match the final working files. Existing repository build warnings remain.
- The final build passed **12 live scenarios each in Electron and Chrome**, including the visible delete button, confirmation cancellation, confirmed deletion, and preservation of all seven project source artifacts.
- Native desktop smoke passed: worker loading, API parity, SQLite, persistence, updater checks, renderer recovery and diagnostics. The idle isolated preview was refreshed with its existing profile; native repository source files were not modified. No commit, push or release was performed.

Evidence logs:

- `/private/tmp/xhandle-project-matrix-regression-final.log`
- `/private/tmp/xhandle-project-matrix-delete-tests.log`
- `/private/tmp/xhandle-project-matrix-delete-final-tests.log`
- `/private/tmp/xhandle-project-matrix-build-final.log`
- `/private/tmp/xhandle-project-matrix-electron-final.log`
- `/private/tmp/xhandle-project-matrix-chrome-final.log`
- `/private/tmp/xhandle-project-matrix-delete-build-final.log`
- `/private/tmp/xhandle-project-matrix-delete-electron.log`
- `/private/tmp/xhandle-project-matrix-delete-chrome.log`
- `/private/tmp/xhandle-project-matrix-delete-native-smoke.log`

Final runtime evidence and screenshots:

- Electron: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-fbm5J7/`
- Chrome: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-wKPnRB/`
