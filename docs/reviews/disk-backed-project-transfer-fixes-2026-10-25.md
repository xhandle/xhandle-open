# Follow-up fixes for disk-backed project transfer

Implemented `docs/codex-prompts/fix-disk-transfer-review-findings.md`. This addresses the three findings in the earlier review. No commit, push or desktop release was performed.

## Changes

- **Legacy schema compatibility:** `hazardSchema.js` supplies the canonical version-5 stores, indexes and metadata migration for both application opens and archive imports. Existing versions 1–4 are upgraded, including the incomplete version-4 schema identified in review. Export emits canonical metadata from run roots; import reconstructs missing metadata rows before publishing the project, with rollback tracking. Unrelated destination runs remain intact.
- **Repeated-save storage:** each replacement stages immutable pages under a renewable durable lease. Publishing commits the new root and metadata, deletes the previous generation and retires its lease in one transaction. Readers obtain the root and all pages in one readonly transaction, which prevents reclamation while that snapshot is active. Subsequent large saves reclaim obsolete/unleased or expired staged generations for the same run. Failed or cancelled staging removes its own pages; active writers remain protected. Healthy repeated saves retain one committed generation rather than one full copy per save.
- **Payload validation:** the import/export integrity checker now validates token grammar, complete values, binary alignment and run identity as pages arrive, in addition to checksums. It retains container state and identity offsets rather than reconstructing evidence strings or binary payloads. Malformed data is rejected before project publication. Generated archives emit pages in sequence order; the validator enforces that ordering.

## Verification

- Full Jest suite: **2,515 passed, 8 failed, 2 skipped**. The eight failures remain the previously baseline-confirmed `hazardEvalRunner.test.js` fixtures reporting missing FD-1/FD-2 assessments. No additional suite failures occurred.
- Transfer-focused suite: **93 passed**, including legacy schema versions 1–4, missing metadata rows, existing destination upgrades and preservation of partial results.
- Concurrency/storage tests cover active and expired leases, reader/replacement ordering, cancellation, failed publication retaining the prior generation, large-to-small replacement and clear revoking staged data.
- Token validation tests include unknown tokens, unbalanced containers, incomplete values, duplicate/mismatched identity, malformed binary data and extra roots. A 128 MiB logical evidence string is validated with one reusable page, without constructing that string in the validator.
- Real isolated WebKit and Chrome checks each downloaded an exact 6.25 MiB file and passed repeated 2 MiB run replacement, concurrent reader snapshot and cancelled-stage cleanup checks. Each committed generation used 129 pages, and obsolete committed pages were reclaimed.
- Server tests: **3 passed** for sequence/integrity/download, request and origin bounds, expiry and concurrent-session limits.
- Production build passed with existing repository warnings; `git diff --check` passed.

The earlier defect-reproduction tests now assert desired behavior. Save-state mocks were updated to provide the root lookup required by atomic replacement; pending-save, ordering, retry and reload-protection assertions remain intact.

## Remaining limits

Temporary staging needs space for the old and new generation at once. Abandoned staging is reclaimed on a subsequent large save for the same run once its lease expires; this is not a background global garbage collector. Active saves and exports still require the existing application coordination rules.

Legacy oversized IndexedDB values still require an initial whole read, older whole-record archives still assemble their values on import, and normal analysis consumers still hydrate their selected run. The changes eliminate the complete export Blob allocation and unbounded healthy-save revision retention, not all possible memory pressure. The actual largest customer project and a newly packaged desktop app have not been acceptance-tested in this turn.
