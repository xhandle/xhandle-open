# Pre-release regression review — November 13, 2026

## Disposition

Reviewed the complete pending shared working tree against `13333664ca6a50ae6a7f49122345db40cd0dd50f`, including newly added files, and the desktop packaging boundary against private desktop checkout `60c9d7d`. This is a source and local runtime review, not approval of a signed cross-platform release. No commit, push, submodule-pin update, tag, or publication was performed.

The source checks have no remaining test failures. The eight baseline hazard-evaluation failures were traced to stale synthetic generation responses missing the now-required applicability rationale. The fixtures now supply that field, and the obsolete test expecting blank applicability to default to Yes now verifies that incomplete assessments are rejected before later stages can be scored. No production acceptance rule was loosened.

## Fixes made during this review

1. **Desktop API startup blocker:** `server/aiProviderPayloads.js` and `server/claudeResponseRecovery.js` now import `src/lib/claudeModelCapabilities.js`. The native build staged only `server.js`, package files and `server/`, which omitted that dependency. Updated the private desktop staging helper to include the explicit shared runtime file from its pinned upstream checkout, with a regression test. No shared application fork or blanket `src` copy was added. A disposable staging of the real pending source successfully loads the Claude payload builder and boots the desktop API.
2. **Backup restore connection lifetime:** `restoreKnownDb` left database connections open, including when an older backup had no entry for a database. It now avoids unnecessary opens and closes connections after both successful and failed restoration. A real fake-IndexedDB round-trip test verifies all five artifact stores and verifies that a subsequent schema upgrade is not blocked.
3. **Backup test isolation:** the existing memory audit mocked `idb.openDB`, while the new artifact repository opens native IndexedDB directly. Updated that test's adapter mock; its overlap, destination-before-read and connection-cleanup assertions remain intact.
4. **Commit hygiene:** ignored `/linux-build-*/`, preserving the downloaded 0.2.15 installers locally while excluding 420 MB of generated release assets from a source commit. No pending source file exceeds 5 MiB.
5. **Executable diagnostics:** the natural-language artifact journey had stale assumptions about the old module action, visible requirement titles and synchronous view rendering; its legacy-job fixture also changed the job without clearing a newer checkpoint marker. Updated those fixtures and their readiness checks. Added a build-directory override to four Electron diagnostics so they can exercise a fresh temporary build without replacing a developer's `build/` directory. These are fixture corrections, not relaxed product requirements.

## Scope

The review covered the pending requirements/design-library refactor, generated artifacts and systems engineering projects, artifact storage and maintenance, HTL consolidation and table controls, safety requirement generation and writing, architecture projections and presentation editing, quick search and selection context, Claude transport and capability handling, project-deletion queue and storage visibility, backups, automatic safety-case evidence and persistence, activity integration, and desktop staging/updater boundaries.

All new source modules were included by the full test/build/lint runs. Provider-facing route tests and native diagnostics use synthetic responses and disposable storage. They do not measure live model answer quality or customer-specific provider access.

## Executed checks

| Check | Result |
| --- | --- |
| Full final shared client suite | 448 suites / 3,964 tests passed; zero failures; 2 suites / 4 tests skipped by existing optional gates |
| Baseline comparison in an isolated `git archive HEAD` | Same eight `hazardEvalRunner.test.js` failures; companion hazard-publication audit passes |
| Complete backend suite | 85 passed, including actual HTTP routes with mocked provider streams and development API startup |
| Desktop host suite | 45 passed, including the new backend-staging regression |
| Changed-source lint | 0 errors; 71 warnings retained and reported in the log |
| Whitespace validation | Shared and desktop diffs pass `git diff --check` |
| Optimized production renderer | Passed; final rebuild after the backup fix is recorded in `/tmp/xhandle-pre-release-final-build.log` |
| Design-artifact backup/restore | All five stores retained, concurrent backup behavior retained, and restored database releases its upgrade lock |
| Native shell with current working source in temporary staging | Full smoke passes: stable native protocol, React mount, authenticated API/SQLite CRUD, IndexedDB/localStorage reload, isolation, settings, bodies/status/headers, SSE, cancellation, binary/download exports, updater parsing/checksums/no downgrade, worker execution, diagnostics and renderer recovery |
| Production artifact worker | 2,000 relationships, 80 nodes and 32,000,100 evidence characters retained; measured foreground timer gaps 22–32 ms |
| Production engineering-project worker | 20-document legacy migration and warm load with monotonic 0–100 progress; 88.4 million evidence characters remain out of the compact overview; foreground gaps 21–22 ms |
| Production permanent-deletion UI | Immediate removal while storage is delayed, reload recovery, bulk deletion, failed cleanup/retry, numeric IDs, and preservation of active projects/credentials pass |
| Full production artifact/project UI journey in Electron | Passed: generation/retries after navigation, legacy draft above 1,000 objects, editing, baselines, exports, all four views, seven-document project generation/joint acceptance, source-layout preservation, architecture exports, traceability, folder moves and reload, project/artifact detail edits, deletion, condensed evidence review and canonical citations; 68 synthetic AI fixture calls |
| Large saved architecture navigation | All 320 CSU implementation relationships retained without AI; bounded navigation across 3,001 elements / 4,500 relationships and viewport focus passed, with a measured foreground timer gap below 68 ms in the final run |

The local native smoke is an **unpackaged review staging**, explicitly labeled as a working tree. It is not an installer, notarization result, Windows/Linux execution, or an upgrade of a customer's installation. The final smoke used the final rebuilt renderer and current source, and records the actual desktop base commit plus `reviewWorkingTree: true`. A prior local `build-metadata.json` was not treated as evidence of the current desktop commit. Final logs are `/tmp/xhandle-pre-release-native-final-smoke.log` and `/tmp/xhandle-pre-release-artifact-ui.log`.

## Existing failing test evidence

The original eight `src/features/hazard-eval/hazardEvalRunner.test.js` failures reproduced on the committed baseline. Correcting the generation fixture to include its applicability rationale and verifying rejection of unstated applicability resolves them. The targeted hazard runner/publication audit passes all 22 checks. The final complete client suite passes all 3,964 enabled tests. These synthetic checks do not establish live model answer quality.

Baseline log: `/tmp/xhandle-pre-release-baseline-tests.log`. Initial suite log: `/tmp/xhandle-pre-release-client-final.log`. Final green suite log: `/tmp/xhandle-release-client-green.log`.

## Desktop release blockers and remaining gates

- The checked-out desktop source still pins the older published shared commit. Commit/publish the reviewed shared source, then update and review the private desktop pin and include its staging fix. Release builds intentionally reject dirty/unpublished source. Select a version higher than the then-current stable release; do not republish the downloaded 0.2.15 assets as this change set.
- `scripts/publish-release.py` in the private desktop repository currently validates only Apple Silicon macOS artifacts, allowlists `latest-arm64-mac.yml`, and promotes only that allowlisted set. The CI matrix can build macOS/Windows/Linux, but private CI artifacts/tag releases do not automatically become a complete public update. The public publication path must support validated Windows x64 and Linux x64 assets/manifests before promoting the requested combined release. Publishing only the macOS set would leave other platform channels absent.
- Run destination-platform builds and packaged smoke checks on Windows x64 and Linux x64 against the final pinned commits. Repeat final packaged checks on macOS, including actual signatures, notarization and Gatekeeper verification. Native tests on this Mac do not substitute for these checks.
- Validate the updater manifests, checksums, complete asset set and source provenance for one version. Exercise upgrade and saved-project persistence with disposable installations/profiles, then verify the public feed after publication. No customer profile or existing installed application was modified in this review.

## Reproduction and evidence

The source-file SHA-256/size manifest for the pending working tree is `/private/tmp/xhandle-pre-release-source-manifest.json`. Principal logs use `/tmp/xhandle-pre-release-*`. Fresh renderer outputs are temporary and are not source/release assets. The source snapshot must be refreshed if further runtime changes are made before release.

The earlier Claude-specific findings and synthetic model/effort matrix are documented in [claude-collaborator-reliability-review-2026-11-13.md](claude-collaborator-reliability-review-2026-11-13.md).

## November 13 release follow-up

Prepared private desktop version 0.2.16 with destination-OS Windows x64 and Linux x64 installer/archive verification receipts. The public publisher now requires both verified platform directories alongside the signed/notarized macOS set, matches exact source provenance, validates all asset digests and prevents incomplete-channel or downgrade publication. Ten regression tests cover allowlisting, tampering, receipt/source mismatch, path traversal, legacy manifest targets, symlinks and combined checksums. The existing 45 native host tests also pass. These pipeline changes still require real target-OS CI execution.

The local Developer ID signing identity is available. Apple notarization currently returns HTTP 403 because a required developer agreement is missing or expired. The account holder must accept the pending agreement before notarization and publication can finish. No signing credential was printed or stored in source.
