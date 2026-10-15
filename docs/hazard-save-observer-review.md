# Save observer-order review

## Result
No new actionable defects identified in the reviewed save paths. The synchronous callback/event ordering issue is fixed: saveQueues is populated before state('saving') dispatches notifications, and work yields before accessing storage. Nested saves therefore wait for the original transaction. Newest-owner guards preserve newer pending memory and prevent old completion notifications.

## Verified behavior
- Slow writes remain pending rather than being aborted at five seconds.
- Transient errors retry with bounded backoff; permanent errors retain results and error details.
- Each queued revision resolves after its own commit; deletion invalidation rejects instead of pretending persistence succeeded.
- Stop does not prevent final storage success/failure from reconciling the matching retained registry record.
- Callback and DOM-event reentrant saves maintain [1,2] write order and newer memory protection.
- Additional temporary probes passed: an older failed write does not poison a queued newer save, and throwing observer callbacks do not prevent persistence or reload-protection cleanup.

## Validation
550 existing tests plus two temporary audit probes passed: 552 tests across 54 suites. App.js parsed successfully. git diff --check passed. Temporary probes removed after execution. Application code unchanged during this review; only review prompt/report added.

## Limits
This is a source review and automated regression check, not a proof of no defects. No live Safari smoke test or real 6,384-row browser-storage run was performed. A permanently stalled storage operation remains pending; quota, permission, and device failures can still prevent persistence, with memory/export recovery retained. Changes remain uncommitted.
