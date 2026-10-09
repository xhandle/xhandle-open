# Software requirements persistence implementation

Implemented the storage correction described in `docs/codex-prompts/fix-software-requirements-persistence.md`.

## Changes

- `artifactUtils.js`: save complete, revisioned fallback envelopes and a matching revision on the IndexedDB root. Reads select the newest committed backend revision. Legacy local arrays and unchunked database rows remain readable.
- Writes for the same artifact key are serialized. Reads wait for pending writes and retry if a write began during their read. Notifications are emitted after persistence. Even an empty clear must commit to a backend; it can no longer report success when both fail.
- Chunked reads validate manifest keys, parent ownership, row arrays, and total row count. Incomplete records reject rather than becoming empty/partial results. A complete local fallback may recover an incomplete database revision if it is not older.
- Failed replacement writes retain prior durable data. Database connections close after operations. Persistence permission requests no longer block the write.
- `EngineeringArtifactPanel.js`: load failures retain available cached rows, show an error, and do not enable autosaving an empty replacement. Notification reload errors are surfaced.
- `artifactAI.js`: software derivation and code-echo repair requests have a two-minute deadline, including response body reading. Expiry aborts the request and reaches the existing fallback behavior. Other artifact requests retain their previous deadline policy.
- Added `fake-indexeddb` as a development dependency for transaction-based storage and panel integration tests.

## Validation

Five focused suites / 34 tests pass, covering fallback recovery across module reload, repeated fallback writes, clearing, subsequent database recovery, missing chunks, incorrect counts, multi-chunk saves, ordered competing saves, save notifications, legacy records, complete persistence failure, panel reopen, load-error retention, stalled requests, and source-equivalence compatibility. `git diff --check` passes. The final production build passes with lint warnings.

The panel integration test uses the production storage adapter and IndexedDB emulator; AI, review integrations, and table rendering are mocked. No live model requests or customer browser storage were used. These tests do not reproduce the exact alpamayo session or Safari's native implementation.

## Scope and remaining limitations

This correction addresses disappearing committed results and indefinitely stalled software requests. It does not change software generation to use the processed Functional model, introduce draft/resume checkpoints, or parallelize generation. Those are separate generation and traceability changes explicitly identified in the review, and should not be silently included in a persistence fix. Generation still publishes when derivation finishes; reloading during generation can lose in-progress work. A request timeout may yield locally derived fallback requirements, which the existing completion summary identifies for review.

Historical empty or incomplete results are not automatically reconstructed. Existing legacy local arrays have no revision, so the loader cannot reliably determine whether such an array is newer than a legacy IndexedDB result. New saves establish revision authority; ambiguous historical data should be recovered from a known complete backup rather than guessed.
