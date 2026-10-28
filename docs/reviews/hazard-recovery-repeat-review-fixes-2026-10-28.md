# Hazard recovery and repeated review edits — 2026-10-28

Executed `docs/codex-prompts/fix-hazard-recovery-and-repeat-review.md`.

## Implementation

- Added `saveHazardRecovery`: final partial-result publication waits for the specific initial manifest write to settle, then takes that manifest object's committed revision. It does not refresh from storage or adopt an independent writer's revision. The runner's existing bounded wait still reports pending saves; a late manifest can finish before its dependent recovery save. Failed manifests can still be followed by recovery when the original revision remains valid.
- Review Center events now include `previousContent` captured inside the persistence update, for both ordinary edits and approval with modifications. `originalContent` stays unchanged for audit. The drawer emits one actionable update event rather than a generic event followed by a second actionable event.
- The App matches the immediate pre-edit row against the current saved Summary, then uses the matched position. This supports repeated edits and reordered rows while rejecting deleted or independently changed rows. Store-level revision protection remains in force during publication.

## Coverage

Regression coverage uses the actual runner and real fake-indexeddb-backed store, with generation mocked (no AI calls). It verifies persisted partial assessments after interruption and explicit Stop. Additional tests cover delayed manifest completion, failed manifests, external-edit conflicts, repeated Review Center edits, moved/deleted rows, independent row changes, and actual provider callback events for edit/edit/approval while preserving original audit contents.

The new recovery tests use distinct attempt IDs and a chunked fixture above the inline-storage threshold. An initial test reused an attempt ID, correctly triggering superseded-attempt protection; another concurrent build/test run exhausted test deadlines. The fixtures and scheduling were corrected without changing application safeguards.

Final validation:

- 116 suites / 1,116 tests passed; one suite/test skipped. Includes hazard analysis, project transfer, Results Review, collaborator, functional decomposition, and diagram coverage. `/tmp/recovery-fix-tests-final.log`.
- Server transfer tests: four passed. `/tmp/recovery-fix-server.log`.
- Production build: passed with warnings. `/tmp/recovery-fix-build.log`.
- `git diff --check`: passed.

The two former defect reproductions now assert successful durable recovery and successful repeated edits. Explicit Stop, delayed and failed manifest writes, independent-edit rejection, row reordering/deletion, and edit/edit/approval event history pass as part of the final suite.

## Scope and limitations

No customer storage was changed, no paid analysis was run, and nothing was committed, pushed, or released. Existing unrelated working changes were preserved. These changes do not alter first-page table loading or its memory bounds. Explicit continuation and edit actions still have the full-record hydration limitations documented in the earlier reports. Actual large-project desktop and Safari validation remains necessary; automated tests do not establish that every possible freeze or crash has been eliminated.
