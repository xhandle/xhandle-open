# Fix Storage inventory allocations

Implement the findings of desktop-storage-crash-investigation-2026-10-27.md.

Remove analysis-payload reads and JSON serialization from IndexedDB inventory and category listings. Use counts and key cursors, with labels from already loaded project metadata and generic labels otherwise. Use the browser's origin storage estimate and explicitly mark per-database sizes as unknown. Preserve record keys, pagination, chunk hiding, selective deletion, and paired-store cleanup.

Cancel pending inventory and page transactions on tab exit/unmount, prevent overlapping scans and stale state updates, and handle timeout and failed counts honestly. Scan databases sequentially. Do not migrate, delete, or rewrite user records. Do not increase heap limits.

Run focused regression tests and an isolated Electron fixture with large legacy records, binary and sparse values, pagination, cancellation, and selective deletion. Build the application. Document actual results and untested limitations. Do not commit, push, or release without a separate request.
