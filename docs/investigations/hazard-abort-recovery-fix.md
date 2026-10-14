# Hazard abort and read-only error recovery

The supplied Safari log ends with `TypeError: Attempted to assign to readonly property` at `fastHazardPipeline.js:275`, after two unhandled `AbortError` rejections. The failing line tried to assign an application code directly to the caught error. Native DOMExceptions have a read-only `code`; exceptions such as `TransactionInactiveError` have a falsy numeric code, so the assignment throws. This secondary failure prevents attaching partial results and obscures the initiating failure.

The pasted batch records contain only `Object`, so the original abort cause, affected request/checkpoint and accepted row count cannot be established from this excerpt. The fixes below address reproduced defects; they do not establish whether Safari, storage capacity, a connection interruption or another event initiated this customer's failure.

## Changes

- `hazardRunError.js`: wrap native/frozen errors in a writable application error while preserving name, message and original cause. Pipeline recovery and final-save recovery attach metadata to the wrapper, never to the native exception.
- `fastHazardPipeline.js`: preserve partial accepted results even when the original failure is a read-only native error. Serialize batch/performance diagnostics as JSON so copied Safari logs contain actual values.
- `codeHazardGenerationCheckpoint.js`: observe transaction completion before issuing requests; observe all sibling requests when one fails synchronously; abort atomically on failure; prefer the initiating non-abort error over consequential sibling aborts. Retry `AbortError`/`TransactionInactiveError` once using a fresh transaction. Do not retry user cancellation, quota errors or persistent failures. Retry storage only, not AI generation. Apply the transaction lifecycle handling to read, write, bulk operations, regeneration cleanup and pruning.
- `fastHazardRunner.js`: final-save failure also retains its in-memory result without mutating a native error.
- `App.js`: distinguish explicit run cancellation (the controller signal) from an independent storage abort. Include original error name/code in copyable failure diagnostics.

## Verification

345 tests across 33 suites passed. Eight added regressions cover frozen native exceptions, retained accepted results, native final-save recovery, synchronous batch-request failure with transaction/sibling aborts, bounded transaction retry, quota handling and cancellation. The transaction tests fail if promises are left unhandled. Existing persistence, applicability, semantic review, CSV and downstream software-requirement tests remain passing.

Production build passed with existing repository warnings; git diff --check passed. No customer-browser run or live provider request was performed.

Reload the frontend before retrying. Continue hazard analysis reuses matching persisted approvals and pending candidates. Work from the prior failed run that was never successfully checkpointed cannot be assumed recoverable.
