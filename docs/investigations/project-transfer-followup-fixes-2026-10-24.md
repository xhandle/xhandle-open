# Project transfer follow-up fixes — 2026-10-24

Executed `docs/codex-prompts/fix-project-transfer-followup.md`.

## Changes

- Chunk references may resolve to another validated, project-owned chunk in the same database/store. This preserves the production run/history aliases. Every referenced chunk must still be present in the archive and pass its content digest; existing destination data cannot satisfy a missing archive reference.
- Integrity checks now inspect the nested rowRecord and runRecord descriptors in ready-to-publish recovery envelopes. Missing recovery chunks fail export or preflight import, before the imported project is published.
- Requirement checkpoint acceptance now validates task-specific coverage for functional software requirements, rewrites, hazard-derived system requirements, category derivation/review, system/subsystem requirements, design elements, and consolidation. Positional callers require ordered coverage; consolidation may reduce row count while retaining all parent references. Unknown contracts are not cached as completed. Existing saved responses are revalidated on reuse.
- Reproduction tests are now correctness regressions. Tests exercise actual prepare/recover publication APIs, a second publication with history, recovery after import, checksum-valid archives missing nested chunks, and an imported legacy partial hazard-system response that is retried and subsequently reused once complete.

## Validation

Focused transfer tests: 35 passed. Includes task-specific coverage tests for all parent fields and consolidation behavior.

Broader regression suite: 129 suites / 1,115 tests passed across transfer, assurance, source context, and hazard analysis. `git diff --check` passed. Production build passed with warnings; no packaged desktop runtime validation was performed.

## Limits

A real large-project Safari-to-packaged-Electron transfer remains necessary before release. These changes do not establish crash-free operation or crash-atomic multi-database writes. Legacy large records still require serialization memory. Incomplete provider responses can still be displayed under the existing derivation behavior, but they no longer qualify for completed checkpoint reuse under the covered contracts.

Changes remain local. No commit, push, or desktop release was performed.
