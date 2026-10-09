# Code-Based Architecture project isolation implementation

Implemented the prompt in `docs/codex-prompts/fix-cba-project-result-isolation.md` on 2026-10-09.

## Root cause and correction

App held architecture rows independently of their project/repository owner. Selection changed the persistence key before asynchronous hydration replaced the rows. The autosave effect could therefore save A's rows into B, including B projects with existing results.

`useScopedArchitectureRows` now stores scope, selection session, rows, and dirty status together. Consumers receive an empty array until the selected scope owns the loaded snapshot. This also gates Functional diagrams, table exports, hazard input, and requirements input because they consume `cbaTableData`.

Saved-data hydration and already-published generation results are clean snapshots. Only explicit row changes trigger App autosave. Project selection and metadata changes do not trigger an architecture write. Delayed callbacks from a previous selection session are rejected, including A/B/A navigation. Load tokens prevent earlier hydration from overwriting a newer edit or published analysis.

## Files and behavior

- `src/App.js`: integrates scoped rows; removes unowned import adoption; limits hydration to scope changes; catches load failures; scopes generation loading/completion and final navigation; only saves owned dirty snapshots. Arbitrary metadata-key recovery and global repository-key recovery are removed. Known foreign row lineage is rejected without rewriting stored data.
- `src/features/code-architecture-assurance/useScopedArchitectureRows.js`: scope/session ownership, clean adoption, edit tracking, load invalidation, and explicit owner-aware publication callbacks.
- `src/features/code-architecture-assurance/codeArchitectureStorage.js`: saved empty arrays are authoritative results, with `found` distinguishing them from missing data. This prevents fallback recovery from resurrecting cleared rows.
- `useScopedArchitectureRows.test.js`: React tests execute App's actual autosave and loader callbacks with isolated dependencies; cover project switching, delayed callbacks, hydration errors, explicit empty data, retained Functional payloads, and clean publication.
- `codeArchitectureIsolation.test.js`: production IndexedDB adapter tests using fake-indexeddb; cover empty records, prohibited recovery aliases, historical foreign-lineage detection, scope-isolated publication, and conflict preservation.
- Historical audit diagnostic is pinned to the reviewed pre-fix commit so it remains a reproducible record of the defect rather than an assertion that current code is broken.

Atomic publication, checkpoint scope checks, and revision-conflict safeguards remain intact. No analysis reasoning or classification logic was changed. Compatibility reads for repository aliases within the same project remain available; ambiguous global records are not automatically adopted.

## Verification

Targeted test command:

```
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-assurance/useScopedArchitectureRows.test.js src/features/code-architecture-assurance/codeArchitectureIsolation.test.js src/components/generateFunctionalDecompositionFromGitHub.test.js src/features/code-architecture-assurance/ArchitectureRunRecovery.test.js
```

55 tests across four suites passed. Production build passed with repository lint warnings. `git diff --check` passed. Tests used isolated storage; no paid repository analysis or customer browser data was accessed. A live reproduction using the customer's exact saved dataset was not performed.

## Historical data and recovery limits

This prevents the confirmed cross-project overwrite path going forward. It does not reconstruct records already overwritten by earlier versions. Rows with explicit foreign lineage now produce a visible error rather than becoming valid inputs for another project. Older rows without ownership evidence cannot be reliably identified from names or row counts alone.

No saved results, checkpoints, histories, or customer records were deleted or silently relabeled. A pending checkpoint remains recoverable through the existing recovery UI when its baseline still matches. If a previous overwrite changed that baseline, conflict protection still requires a deliberate recovery decision; the fix does not force the checkpoint over potentially newer work.

No commit or push was performed.
