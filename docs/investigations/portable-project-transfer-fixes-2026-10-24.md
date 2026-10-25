# Complete project transfer fixes — 2026-10-24

Executed `docs/codex-prompts/fix-portable-project-transfer-review.md` against the five findings in the preceding review.

## Changes

- Archive import validates fixed-version database compatibility before writing. Existing databases are opened without a requested version, and key paths, auto-increment settings, and required indexes are checked. Compatible newer repairable databases are reused without downgrades. Archive metadata cannot upgrade an existing database; incompatible schemas produce an actionable error. Fresh repairable databases use the application's supported version rather than the source's repair counter.
- Repository-and-branch diagram positions and their chunks are included. Other repositories and branches remain excluded.
- Export and both import passes check chunk digests and reference completeness, retaining keys rather than hydrating entire analyses. Missing or modified parts fail before publishing an imported project.
- Software derivation checkpoints require complete ordered source coverage and usable requirement text. This validator also applies to cached responses from older archives. Incomplete batches are retried, while complete batches remain reusable. The derivation's existing fallback behavior remains available when provider requests fail.
- Converted the five defect probes to correctness regressions and added coverage for recomputed archive checksums with missing/tampered chunks, schema mismatch, layout isolation, duplicate source coverage, and legacy incomplete checkpoint recovery.

## Validation

- 127 suites / 1,100 tests passed across transfer, assurance, source context, and hazard analysis.
- Final focused transfer rerun: 20 tests passed, including retrying an imported legacy incomplete response, obtaining complete results, and reusing those complete results without another provider call.
- Production build passed with warnings (see build output); no packaged desktop runtime test was performed.
- `git diff --check` passed.

## Remaining limits

A real large-project Safari-to-packaged-Electron round trip remains necessary before release. These fixes do not prove crash-free operation: large individual legacy records still require serialization memory, and abrupt process termination across multiple databases is not transactionally atomic. Incompatible destination schemas are rejected rather than migrated by the archive importer. Source access/revision and analysis settings must still match for applicable continuation checkpoints to be reused.

Changes are local; no commit, push, or desktop release was performed.
