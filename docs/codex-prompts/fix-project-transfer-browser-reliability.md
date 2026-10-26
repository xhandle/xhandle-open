# Project transfer reliability

Investigate and fix the project export/import implementation shared by Safari,
Chrome, and xHandle Desktop. The reported Safari failure is “Storage connection
timed out (xhandle)” when exporting MANPADS. Desktop previously produced a very
large uncompressed export. Preserve all saved results and continuation checkpoints.

Trace database connection lifecycle, pending upgrades, cancellation, transaction
lifetime, record selection, serialization, compression, disk transport, download,
and import verification. Fix demonstrated defects rather than only raising limits.
Do not clear, migrate, or overwrite the user's live browser/Desktop data. Keep
memory bounded during transport, skip unrelated payloads where ownership can be
determined by key, close connections, and recover from transient storage failures
with bounded retries and visible feedback. Permanent storage failures must stop
with an actionable error; never report an incomplete archive as successful.

Keep existing uncompressed imports compatible. Verify compressed archives,
partial analysis restoration, corruption rejection, cancellation, delayed opens,
late connections after timeout, real blocked upgrades, and repeated operations.
Run automated unit/integration checks and isolated real-runtime round trips in
Chrome, WebKit, and Electron. Distinguish WebKit coverage from installed Safari
and a test Electron runtime from the installed packaged app. Record limitations.
Do not publish a release as part of this task.
