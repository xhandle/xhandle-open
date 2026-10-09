# Repeated empty software requirements: missing-store review

Executed 2026-10-09 using the current working tree. Production code and customer storage were not modified. Prompt: `docs/codex-prompts/review-software-requirements-missing-store.md`.

## Evidence and principal finding

The screenshot shows `Functional table: 463`, `0 of 0 rows match filters`, and a failed IndexedDB transaction because an object store is missing. This confirms Functional source selection is active and the table has no rows, rather than simply filtering out existing rows. The screenshot does not identify the database name or establish successful generation/persistence.

**High — existing empty database never gets its feature schema.** `artifactUtils.js:72`, `openArtifactDb`, opens `xhandle-code-architecture-assurance` at version 1 and creates `artifactRows` only inside `onupgradeneeded`. If version 1 already exists without that store, opening succeeds without an upgrade. The following `transaction('artifactRows', ...)` throws `NotFoundError` for reads and writes. There is no store validation or repair on successful open. Retrying generation cannot repair this state.

Reproduced with production loader/saver and fake-indexeddb: a generic `indexedDB.open(name)` creates an empty version-1 database; closing it and loading requirements throws `NotFoundError`. Reopening confirms the store is still absent.

## How the state can arise

Two current generic reader paths can create a database while intending to inspect it:

- `codeArchitectureReviewExport.js:490`, `openDb`: opens by name without an `onupgradeneeded` abort. An absent database becomes an empty version-1 database.
- `legacyWorkspaceGraphMigrator.ts:201`, `openExistingDB`: performs an existence check, but `databaseExists` returns true if database listing is unavailable or fails. It then opens without an upgrade abort. There is also a check/open race if another actor deletes a database between the operations.

Both have paths that read the assurance database. The settings storage inspector now aborts creation (`SettingsModal.jsx:218`, `openRawIndexedDb`), as does permanent project deletion. Those safeguards do not repair malformed databases created earlier. The particular reader that affected the user's browser is not established by the screenshot or these tests.

## Related findings

**High — large results lack a durable fallback when schema is missing.** The local fallback accepts only serialized records at or below 750,000 characters (`artifactUtils.js:282`). With a missing store, small results persist locally and may conceal the schema defect. A synthetic 463-row result with 2,000 characters per requirement exceeds the threshold and fails saving. This is a reproducible scale-dependent failure, not a measurement of the user's actual generated payload.

**Medium — generation begins without storage/schema preflight.** The panel permits derivation based on source count and `isDeriving`, regardless of a prior load failure. The first publication attempt occurs after all derivation work. Consequently the user can spend the full generation time before encountering a predictable storage failure.

**Medium — schema upgrade lifecycle is incomplete.** The assurance opener has no blocked handler or version-change connection handling. Any repair must account for concurrent tabs/connections, report a blocked upgrade clearly, and close late connections. Merely increasing a constant without verifying the resulting store is insufficient for future malformed/newer schemas.

## Why the previous fixes did not solve this

Earlier tests started with the feature creating its own valid schema, then injected write failures or removed data chunks. They did not seed a preexisting database missing its object store. Revision authority, chunk validation, and Functional input selection cannot fix an absent schema. The previous fixes addressed other reproduced defects but did not establish the root cause of this user's run.

## Limit of the empty-table diagnosis

Current `EngineeringArtifactPanel.js:434–449` places successfully derived rows in component memory before awaiting persistence and reports activity success only after persistence and downstream clearing. Therefore a failed save alone should not erase rows from an uninterrupted, mounted panel. The exact screenshot's raw `NotFoundError` also fits a load/reload failure; the saver normally wraps persistence failure in its own message.

This review proves the schema failure and inability to durably publish larger results, but does not prove whether this particular run completed derivation, remounted the panel, or encountered an additional failure. Do not describe the exact user's end-to-end sequence as reproduced. Follow-up diagnostics should record scoped stage transitions and counts (generation returned, UI published, save committed, panel mounted/reloaded), not requirement contents.

## Recommended implementation

1. Add a shared assurance schema initializer that verifies the store after opening and repairs a missing store with a controlled version upgrade. Preserve all existing stores/records; never delete the database as a repair.
2. Abort accidental creation in generic readers, including the two paths above. Treat absent databases as absent, not empty initialized databases.
3. Ensure schema readiness before long derivation. Surface storage failures before spending model time; preflight cannot guarantee future quota availability.
4. Retain completed unsaved results independently of the transient panel and offer retry-save/copy or export. Avoid requiring another full generation run after a save failure.
5. Add blocked-upgrade/version-change handling and scoped stage diagnostics. Distinguish generation completion from committed publication and downstream cleanup.
6. Test preexisting empty version 1, healthy legacy schema, additional unrelated stores, concurrent/blocked opens, missing-store recovery, generic reader non-creation, and large generation → save → notification → panel remount/reload. Include a native-browser validation in addition to the emulator.

## Tests run

`artifactSchemaAudit.test.js`, `artifactStorageAudit.test.js`, and `EngineeringArtifactPanel.test.jsx`: **3 suites / 17 tests passed**. Three new audit tests document current defective behavior: missing-store loading, small fallback masking the defect, and larger results failing persistence. Convert these to desired-behavior regression tests when implementing the repair. IndexedDB is emulated; no live AI or customer browser access was used. `git diff --check` passed. No production build was required for this read-only code review.
