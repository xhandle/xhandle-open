# Delayed hazard restoration review — October 18, 2026

## Conclusion

The strongest explanation consistent with results reappearing is delayed restoration presented as an absent analysis. This behavior is reproducible in the current loader. The actual incident is not conclusively attributed: the original browser console was cleared, and no live Safari storage/performance trace was available. Reappearance is evidence against assuming deletion; this audit did not inspect the saved record itself or verify its full contents.

No production code or real browser storage was changed. Existing uncommitted performance fixes were preserved.

## Confirmed findings

1. **Pending, absent and failed loads collapse into the same null run state.** `src/App.js:7992–8032` clears the run at effect startup, then awaits database lookup without exposing hazard-specific loading/error state. `CodeArchitectureHazardPanel.js:97–99` falls back to the draft while latestRun is null; line 429 labels this an incomplete draft. A slow successful read therefore displays something that looks like missing results until the read resolves. The architecture loading indicator is separate; architecture completion does not imply hazard restoration is finished.

2. **A failed refresh can remove an already visible completed run from UI state.** `App.js:8028–8032` logs the failure and sets the run to null when there is no retained live registry record. The disk record is not deleted. The load-change listener at 8035–8041 can later trigger another successful read, restoring the results. There is no automatic retry or visible retry/error state in this effect. A normal tab switch alone is not a listed dependency and must not be promised to retry; a project/repository scope change or matching store event does trigger a new load.

3. **Context reconciliation can hide a successfully loaded run.** At `App.js:8024–8025`, an imported run whose context changes must finish a save before it is published. A save rejection falls into the load-error catch and replaces the loaded result with null. This branch requires `csvImportPreviousSummary` and a real context change (`codeHazardImportContext.js:8–15`); it is not established that the customer's run used this branch.

4. **A context-version change can discard a pending read without scheduling its replacement.** Version checks at `App.js:8016,8027` suppress stale results. Context saves increment the version at 14458. In the controlled harness, changing that version during a load left null state even after a successful read. Whether a real context operation also publishes a run or emits a later change event depends on its path; this is a conditional gap, not proof that every context edit strands loading.

5. **Storage reads have sequential waits without UI phase reporting.** `codeArchitectureHazardStore.js:126–135` waits for database open, matching metadata and then the selected full payload. An unresolved request stays pending; there is no timeout that returns null in this function. The metadata filter uses exact project/repository identity. This differs from the five-second Review Center registration timeout and should not be conflated with it.

## Reproduction and checks

Run from repository root: `node docs/codex-prompts/hazard-restoration-audit.cjs`.

The diagnostic extracts the current effect and store implementation into Node VM contexts with controlled promises, mocked storage and React setters. It does not mount React or access Safari. All assertions passed:

- Loader source is identical to HEAD (a8a4301), before the uncommitted performance edits.
- A delayed read of a 26,278-row synthetic run leaves null state until completion and then publishes the full run.
- A transient read failure yields null; no retry is scheduled; a matching store event later restores the run.
- Separate delayed database opening, metadata and payload steps keep the store operation pending until success.
- Out-of-order earlier requests cannot overwrite the newest response.
- Effect cleanup prevents a departed scope's result from being published.
- An alignment-save failure hides an already-read run.
- A changed context version suppresses the pending result.
- A failed background refresh clears an already visible run.

The 26,278-row fixture validates state handling, not real payload size or browser deserialization performance. Tests do not establish elapsed time in Safari. Scope cleanup was exercised; full React startup with changing repository metadata was inspected but not mounted end to end.

## Startup and recent-change attribution

Repository selection comes from the active project/repository (`App.js:4098–4111`). Repository identity for hazard loading is derived from the selected repository configuration at 4141–4158, with a fallback when no repository is selected. Durable architecture metadata arrives separately; it does not directly replace that configured repoId. Delayed metadata alone therefore is not proven to cause an identity mismatch. Hazard effect dependencies include project ID, connection ID and resolved repo identity; changing them resets and restarts loading, and cleanup prevents old-scope publication.

The recent App.js diff only changes hazard-review matching, not run restoration or deletion. The completed-run database/store is unchanged. Review save queue changes apply to a different database. Their direct involvement in this disappearance was not reproduced.

Global review loading still calls getAll and materializes every review record on startup (`reviewStore.js:55–60`, `ResultsReviewProvider.js:44–60`). That work, architecture loading and the large hazard payload can compete for main-thread and memory resources. This remains a plausible delay amplifier, not a measured cause of this incident. No direct transaction lock across these separate databases was established.

## Plausible timeline

1. Reload discards in-memory run state and begins independent architecture, review and hazard reads.
2. Architecture/draft data becomes usable before the large completed-run payload is published.
3. latestRun remains null; the panel presents the draft as incomplete instead of indicating restoration in progress.
4. The original read finishes, or a later matching reload succeeds, and completed results appear.

Step 4's alternatives cannot be distinguished retrospectively from the available evidence. No conclusion that the results were regenerated or recovered from deletion is warranted.

## Recommended fix and regression coverage

- Introduce scope-aware hazard restoration states: loading, loaded, empty and error. Only a successful authoritative null read should show the genuinely empty state. Do not expose regeneration as the response to an unresolved read.
- Preserve the current scope's successfully loaded run during background refresh; report refresh failure beside it. Never show an old scope's run under a new project.
- Provide an explicit Retry load action and bounded transient-read retries. Keep hung reads distinct from absent data, with late-success handling and stale-request protection.
- Publish a valid loaded run independently of optional context-save success. Show reconciliation/save failure separately without losing access to the loaded result.
- Ensure invalidated context loads arrange a fresh current-version read or receive a current authoritative run; avoid silent null state.
- Instrument scope/request ID and timings for open, metadata lookup, payload read, reconciliation and publication, plus outcome and row count. Do not log narrative contents.
- Add mounted component tests for delayed restoration, null versus error, slow/failed refresh, rapid scope changes, overlapping responses, context-version invalidation and late success. Preserve existing cancellation safeguards.
- Profile actual startup and global Review Center loading before adding broader performance changes.

To prove the customer's exact path requires timestamps and stage/outcome logs for a future occurrence, or a browser performance trace. It does not require rerunning the hazard analysis.
