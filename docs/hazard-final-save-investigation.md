# Final hazard-save investigation

The user's 6,384-row STPA result was visible, displayed a save-failure banner, and saved successfully when Retry save was clicked. The exact native browser failure is unavailable.

## Confirmed findings

1. `codeArchitectureHazardStore.js:145` wraps database opening, any legacy migration, record puts, and transaction completion in a five-second deadline. The catch attempts to abort an active transaction and marks the record unsaved. Elapsed time alone can therefore cause a healthy pending write to be treated as failed. The deadline does not measure transaction time separately.
2. This final-save path has no automatic transient-error retry. `fastHazardRunner.js:190` retains the result and returns it with `finalSavePending`; the separate checkpoint retry implementation is not used for final saves.
3. `HazardRunRecoveryNotice.js:23` displays a generic failure banner. The initial stored `saveFailureMessage` is not rendered; only an error from a subsequent user-triggered retry is shown. A temporary pending state also uses the same failure banner.
4. Retry in `App.js` writes the existing result, clears failure flags on successful persistence, and clears retained registry state. No regeneration is necessary. Unsaved records remain accessible in memory and storage failures activate beforeunload protection.

## Verification

22 tests passed in three suites: the existing store and runner suites, and a temporary mocked IndexedDB reproduction. The reproduction kept a transaction pending beyond five seconds, verified the timeout message and abort invocation, then verified successful manual retry. Temporary reproduction removed after execution; production and existing test code unchanged.

This demonstrates the mechanism, not the actual timing, quota, or native transaction error from the customer's browser. The CSV size is not the serialized stored run size. A large run is a plausible contributor, not proof of a size limit.

## Recommended implementation

Replace the destructive five-second final-save deadline with a nonterminal slow-save notification while observing the original transaction. Keep memory recovery/export protection active from the start of saving. Serialize saves per run and use revision/identity guards so older work cannot overwrite newer results or clear newer unsaved state. Retry actual transient transaction/open errors with bounded backoff after prior work settles; do not retry permanent quota/security/clone failures blindly. Expose the stored error plus structured phase/duration diagnostics without logging source evidence. Keep generation completion independent of save status, and retain manual retry/export when recovery is exhausted. Pending transactions must not trigger overlapping writes. Test slow success, transient failure/recovery, permanent failure, newer revisions during retries, scope changes, and reload protection.
