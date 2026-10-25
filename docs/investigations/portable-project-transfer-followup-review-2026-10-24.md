# Follow-up review of project transfer fixes — 2026-10-24

## Verdict

Not ready for release. The original five focused regression cases pass, but testing actual architecture publication and another requirement derivation path revealed three reproducible issues. No production code was changed during this review.

Prompt executed: `docs/codex-prompts/review-portable-project-transfer-fixes.md`.

## Findings

### P1 — Chunk validation rejects normal completed architecture projects

Location: `src/features/code-architecture-transfer/projectChunkIntegrity.js:16`.

The validator requires a root pointer to begin with the containing record's exact key plus `:$part:`. The production publication path intentionally creates aliases: `codeArchitectureStorage.js:180` publishes `${scope}:run` pointing to chunks under `${scope}:run:${fingerprint}`. Line 176 also creates history aliases pointing to earlier scope chunks. These are legitimate, readable records.

Reproduction uses `prepareArchitecturePublication` followed by `recoverArchitecturePublication`. Reading the resulting architecture succeeds; exporting it throws “Invalid analysis data chunk.” This is a new regression introduced by the integrity fix and blocks normal completed-project exports.

Fix direction: validate references against permitted project-owned records within the same database/store, including intentional aliases, rather than requiring the root pointer's owner key to equal the containing key. Keep isolation and content digest checks.

### P1 — Nested publication recovery references escape integrity validation

Location: `src/features/code-architecture-transfer/projectChunkIntegrity.js:19`.

Only a top-level `entry.value.value.format` is checked. Production ready-to-publish checkpoints contain nested `rowRecord` and `runRecord` chunk pointers (`codeArchitectureStorage.js:136`). Their roots are not registered as required references.

Reproduction prepares a real publication, deletes the rowRecord root chunk, exports, and imports into fresh storage. Both transfer operations report success. `recoverArchitecturePublication` then fails because the saved analysis chunk is missing. This is an incomplete fix of the original missing-chunk finding, directly affecting transferable partial work.

Fix direction: validate the application's nested checkpoint pointer fields as well as top-level pointers, without hydrating the entire dataset. Add a recovery round trip through the production publication API.

### P1 — Partial system requirement batches are still treated as completed work

Location: `src/features/code-architecture-assurance/artifactAI.js:74` (special-case coverage check), lines 82–83 (remaining generic acceptance).

The complete-source-coverage check applies only to functional software requirement generation. Hazard-derived system requirements still cache any nonempty response containing text. Their production batch contract requires one output per source row, but missing outputs are dropped by normalization.

Reproduction provides two hazard-derived software requirements and a model response covering only the first. The first derivation returns one system requirement. After export/import, continuation makes no provider call and returns the same single requirement, without coverage for the second source. This is an incomplete fix of the original continuation finding, not a newly introduced failure of the underlying derivation.

Fix direction: apply task-specific completeness and traceability checks to every checkpointed derivation that has a coverage contract. Preserve incomplete work as pending and retry it. Do not assume consolidation tasks require one output per source; validate parent coverage where consolidation is allowed.

## Verification

- Existing relevant regression suite: 127 suites, 1,100 tests passed.
- New `projectArchive.followup-review.test.js`: three passing reproduction probes confirm the defects above. These tests explicitly assert current broken behavior and must be converted to correctness regressions when fixed.
- `git diff --check` passed.
- No new production build was needed for this review's documentation/test-only changes; the preceding implementation build passed with warnings.

## Original finding status

- Unsafe fixed-version shared database upgrade: original reproduction now rejected, preserving unrelated data.
- Compatible newer assurance destination: original reproduction passes.
- Repository-and-branch layout omission: original reproduction passes, with isolation coverage.
- Incomplete functional software response: original reproduction passes, including legacy checkpoint revalidation; broader requirement continuation remains incomplete as above.
- Missing top-level chunks: original reproduction rejected; nested recovery pointers remain unchecked, and valid aliases now fail.

Large Safari-to-packaged-Electron project transfer remains unvalidated. Passing tests are not proof of zero regressions, bounded memory for large legacy records, or crash-atomic multi-database import. No release, commit, or push was performed.
