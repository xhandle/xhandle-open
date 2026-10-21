# Partial recovery cancellation review

## P1 — The app drops late recovery after Stop

The runner-level correction works, but the user-facing cancellation lifecycle still discards its late recovery notification.

Locations:
- `abortableHazardTask.js:4`: abort rejects the owning promise immediately; subsequent worker rejection cannot deliver its recoveryRun through that already-settled promise.
- `App.js:14542`: onPartialRunUpdate returns immediately when the signal is aborted, before retaining partialRun in record.run.
- `App.js:14614` / `hazardRunRegistry.js:14`: the owner's finally finishes the registry record; if it has no pending-save run, the registry deletes it.
- `App.js:7984` / `hazardRunRegistry.js:23`: save events cannot reconcile a record that was removed or never received the recovery run.

Reproduction: used the real runner, abortableHazardTask and registry, with a callback matching App's aborted-signal guard. Injected a generation failure with 150 accepted rows, then Stop after the first recovery batch, with saves failing. The runner produced an incomplete recoveryRun containing all 150 rows and finalSavePending. The owning promise had already rejected with an AbortError lacking recoveryRun; the visible result and record.run remained empty, the registry entry was gone, and reconcileSave returned null.

Impact: recovered rows may not appear and their Retry save/export UI can remain unavailable after Stop. The actual store also maintains an unsaved-run cache, and persisted checkpoints may remain; the test does not demonstrate permanent deletion or loss of all recoverability. It demonstrates that the current UI/registry handoff is incomplete. The test uses mocked persistence, not a complete mounted App/browser.

Recommended correction: separate generation cancellation from recovery ownership. Retain a scope-and-attempt-qualified recovery record until partial preservation finishes; permit late incomplete recovery to update that retained record even when generation was cancelled. Only publish visibly if both scope and attempt still match, and reject late completed output. Handle storage success/failure through that retained record. A blanket removal of the abort guard is unsafe because newer attempts or other projects must not be overwritten. Keep Stop responsive rather than delaying its completion until recovery finishes.

## Verified

- Stop before or during partial-result construction no longer interrupts the runner's preservation path.
- Original failure and validated partialResults survive; failed saving produces finalSavePending recovery data.
- Prior completed results remain separate from incomplete attempts in runner tests.
- Normal finalization cancellation still prevents a completed publication.
- Existing runner, save-wait, store, abortable-owner and registry tests pass.

## Validation

7 suites passed; see final response for total. Includes an independent audit that deliberately asserts the defect above. Source archived adjacent to this report. No production code, user data, provider configuration or storage schema changed. No live provider calls. Existing browser performance limitations remain unmeasured.
