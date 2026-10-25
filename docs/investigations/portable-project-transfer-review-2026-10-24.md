# Complete project transfer review — 2026-10-24

## Verdict

Not ready for release. The implementation supports substantial project transfer and checkpoint reuse, but five adversarial tests reproduce correctness defects. Passing existing regression tests does not establish complete, resumable transfer for every project.

Review prompt: `docs/codex-prompts/review-portable-code-architecture-project.md`.

## Findings

### P1 — An incoming database version can make unrelated destination projects unreadable

`src/features/code-architecture-transfer/projectArchive.js:187` accepts any positive database version, and line 219 opens the destination with that version. A source archive containing xhandle database version 5 upgrades a destination database from version 4 to 5. The application's normal opener in `codeArchitectureStorage.js` still requests version 4, so subsequent reads of an unrelated existing project fail with `VersionError`. The records remain stored but become inaccessible through that opener.

Reproduced with a version-5 archive and an existing, unrelated destination project. Import reports success, then reading the unrelated project's saved analysis fails. Validate supported schema compatibility before mutation; use application-owned migrations rather than letting archive metadata upgrade shared databases.

### P1 — Incomplete requirement responses are reused as completed derivation batches

`src/features/code-architecture-assurance/artifactAI.js:62` accepts a nonempty response with some text without verifying coverage of the batch's source rows. A two-source batch returning only one requirement is cached; the other source receives fallback output. After export/import, continuation reuses that short response instead of retrying the original derivation batch.

Reproduced with two functional sources, one returned requirement, and unsuccessful rewrite requests. Rewrite attempts can still occur; it is the original derivation batch that is incorrectly skipped. Persist and validate source coverage, retain unresolved source work, and ensure continuation retries it rather than treating a partial response as complete.

### P2 — Repository-keyed diagram layouts are omitted

`src/features/code-architecture-transfer/projectArchive.js:88` relies on ownership matching that does not include the actual repository-and-branch layout keys. Production layout storage uses `diagram:github:${repoId}:${branch}`. A `diagram_positions` record under that key is absent from the exported archive and missing after successful import.

Include layouts for the project's repository identities and branches, while preserving isolation from unrelated projects. Add a round-trip test using production layout keys.

### P2 — Compatible newer destination databases reject imports

`src/features/code-architecture-transfer/projectArchive.js:219` opens databases at the incoming archive's exact version. An assurance archive from database version 1 cannot import into a compatible destination version 2: IndexedDB rejects the lower-version open with `VersionError`.

Reproduced with identical artifactRows store schemas at different database versions. Inspect and validate the existing schema without attempting to downgrade it; reject incompatible schemas explicitly before writing data.

### P2 — Missing analysis chunks are accepted as a complete import

Archive preflight at `src/features/code-architecture-transfer/projectArchive.js:184` validates transport checksum and record ownership but not referenced chunk completeness. A saved analysis root referencing a missing chunk can be exported and imported successfully. Reading the imported analysis then fails with “Saved analysis is missing a data chunk. Restore its complete backup.”

This does not show the exporter deleting an existing chunk: the fixture starts with an incomplete source. It demonstrates that the implementation falsely reports successful complete transfer of unusable analysis. Validate chunk references and integrity before publishing an imported project, and report incomplete source data during export.

## Validation

- Relevant regression tests: 126 suites, 1,090 tests passed.
- Added `src/features/code-architecture-transfer/projectArchive.review.test.js`: five passing probes reproduce the five defects above. These deliberately assert observed failures; they must be converted into expected-correctness regression tests when fixes land.
- `git diff --check` passed.
- This review changed only documentation and test probes. It did not fix production code, publish a release, or modify real workspace data.

## Remaining validation limits

Large-project Safari-to-packaged-Electron round trips remain untested. Record-at-a-time transfer still serializes individual large records in memory, so these tests do not establish a strict memory bound or absence of renderer crashes. Resume also depends on source access, revision, and compatible analysis settings. Process termination during multi-database import needs separate recovery testing; caught-error rollback is not proof of crash atomicity.

Fix schema compatibility and requirement coverage first, then layout ownership and chunk validation. Repeat the regression suite and perform a real large-project transfer with partial architecture, functional, hazard, and requirement results before release.
