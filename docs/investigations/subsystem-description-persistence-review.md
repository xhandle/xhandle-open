# Subsystem magic-description persistence investigation

Executed the prompt in `docs/codex-prompts/investigate-subsystem-description-persistence.md` against the current working tree. This review adds only investigation artifacts; existing implementation changes were preserved.

## Findings

### P1: Auto arrange can overwrite an explicitly saved description

Confirmed in native automated Chrome and WebKit with a subsystem created from functional decomposition rows, without a containing system:
1. Open its modal, generate a description, then click Save.
2. Allow the delayed write to complete.
3. Click Auto arrange.
4. Reload and reopen the project. The old category description is restored instead of the saved magic-button text.

`LiteSummaryDiagramReactFlow.js:3995–4006` rebuilds every group from category metadata when all boxes are auto-generated. It replaces and persists the boxes without merging their existing descriptions or `descriptionUserEdited` flags. `applyCategoryLayoutToPositionMap` at lines 2111–2147 creates descriptions from categories or a generic summary. This bypasses the overwrite protection used by the normal description effects at lines 3827 and 4799. Thus a later reload reveals a loss that already occurred during arrangement. This does not mean all Auto arrange paths have the defect: system-aware geometry paths preserve box metadata, and the reproduction targets the category-layout branch.

Recommended repair: arrange geometry while preserving existing per-container metadata by stable identity, including saved descriptions and their user-edit protection. Audit every category rebuild call for the same issue. Avoid treating layout operations as content regeneration.

### P2: Save is not durable immediately

Confirmed in both browsers: generate, click Save, and reload in the next task before the 120 ms timer runs. The prior description returns.

The modal Save handler at lines 6378–6392 sets the new description and `descriptionUserEdited: true`, but calls `persistGroupsSoon`, which delays `saveGroupBoxes` by 120 ms (lines 2946–2949). React component cleanup flushes pending writes on unmount (lines 3430–3436); a browser reload does not guarantee React unmount cleanup. No pagehide/beforeunload flush exists in this diagram component.

Recommended repair: make explicit modal Save perform a confirmed immediate storage write before reporting success/closing. Retain debouncing for high-frequency geometry operations. Lifecycle flushing can provide additional protection but should not substitute for explicit Save durability.

### P2: Save remains available during description generation

Confirmed in both browsers using a deliberately delayed, mocked AI response: clicking Save while generation is pending closes the modal and stores its previous description. The completed response is then discarded because `setEditModal` only updates the matching open modal (lines 2606–2608).

Recommended repair: prevent Save during generation or make its completion wait for the current request. Preserve Cancel behavior and reject stale responses when the modal/project changes.

### P2: A failed storage write does not keep Save open for recovery

Confirmed with a synthetic quota failure on the diagram groups key in Chrome. The Save modal closes, but reload restores the old description. `saveGroupBoxes` at lines 476–480 catches errors and reports no success/failure to its caller. The application-wide storage wrapper may emit a global quota notification; the modal itself still behaves as though its save succeeded.

This was fault injection, not evidence that the customer's browser was out of storage. Recommended repair: propagate write success/failure, retain the unsaved description for retry/export, and provide an actionable Save error.

## Controls and expected behavior

Both Chrome and WebKit preserved descriptions through normal Save, a 400 ms wait, and reload for:
- Manually created subsystems.
- Subsystems contained in a system.
- Automatically created subsystems.

Generating without Save does not persist the draft. This is consistent with the existing Save/Cancel modal design; changing that behavior was not part of this review.

The existing description-generation tests (`LiteSummaryDiagramReactFlow.systems.test.jsx`, test `description generation uses the correct level`) verify prompt context and textarea content, but do not click Save or reload. They therefore do not cover these persistence failures.

## Reproduction artifacts and limits

- `scripts/diagnostics/investigate-subsystem-description-persistence.cjs`
- `docs/investigations/subsystem-description-persistence-results.json`

Run with `XHANDLE_PLAYWRIGHT_PATH` and `XHANDLE_CHROME_PATH`, or `VERIFY_BROWSER=webkit`. `REVIEW_MODES` optionally selects comma-separated scenarios. All runs used isolated synthetic projects and mocked AI responses. No customer data or paid AI calls were used. Automated WebKit is not the user's installed Safari with its extensions. CSV replacement and cross-tab concurrent writes were inspected only as adjacent risks, not reproduced as causes here.

No application fix, commit, or push was performed in this investigation.
