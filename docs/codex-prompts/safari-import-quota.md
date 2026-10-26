# Safari quota failure after import advanced further

The user confirmed `localization-test-repo 2.xhproject` produced the visible quota error. Read-only streaming inspection of that version-3 gzip file found one exported localStorage architecture metadata record containing approximately 2,920,670 UTF-16 bytes. Its `metrics.calls` diagnostic history accounts for almost all of that value. Removing only those diagnostics reduces the record to approximately 12,712 UTF-16 bytes, retaining totals, model summaries, operational context and source metadata. The file also contains about 141 MB of raw serialized archive records; compressed file size is not a measure of destination storage needs.

A metadata write of this size plausibly exhausts the already populated Safari origin's localStorage capacity. The screenshot alone does not prove which write threw; IndexedDB space remains another possible quota constraint. The importer now reports which storage area/store was being written and whether ordinary-error rollback completed.

Implementation:
- Project exports omit per-call diagnostic history in cbaMeta localStorage values, without mutating the source.
- Import normalizes the same metadata from existing archives after checksum validation and before storage. No re-export is needed for this fix.
- Local conflict comparisons normalize both values so differing diagnostic histories do not masquerade as differing analysis data.
- Analysis rows, hazard tables, requirements/design, continuation checkpoints and summary metrics remain unchanged. This is not automatic browser data cleanup.
- Other storage errors still fail with rollback. A truly full origin is not fixed by this targeted reduction; no automatic deletion or retry was introduced.

Validation: 126 transfer tests passed; the optional supplied-file benchmark was skipped. New coverage imports an older oversized-metadata archive under an artificial localStorage quota and preserves totals/context. Existing quota rollback coverage verifies destination records are removed and unrelated projects remain. The isolated WebKit compressed download/import roundtrip passed. Targeted ESLint and whitespace checks passed. Installed Safari and this actual file still require user verification. User browser storage was not modified during investigation.
