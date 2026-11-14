# Pre-release regression review — November 13, 2026

## Disposition

**Final outcome:** the reviewed shared changes were committed and pushed as `4ab7bc9`, followed by whitespace cleanup `93b793d3d20dcca46fa95c4ae16e259ec8737092`. [xHandle Desktop 0.2.16](https://github.com/xhandle/xhandle-desktop-releases/releases/tag/v0.2.16), built with that exact shared pin, was published as the latest stable release on November 13 at 7:09 p.m. Eastern (November 14, 00:09 UTC). Apple Silicon macOS, Windows x64, and Linux x64 distributions and all three update channels are present. Final release evidence follows below; the initial review and blockers are retained as history.

The initial review covered the complete pending shared working tree against `13333664ca6a50ae6a7f49122345db40cd0dd50f`, including newly added files, and the desktop packaging boundary against private desktop checkout `60c9d7d`. At that initial stage, only source and local runtime review had been completed; no commit, push, submodule-pin update, tag, or publication had been performed.

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

## Desktop release blockers at the initial review

- The checked-out desktop source still pins the older published shared commit. Commit/publish the reviewed shared source, then update and review the private desktop pin and include its staging fix. Release builds intentionally reject dirty/unpublished source. Select a version higher than the then-current stable release; do not republish the downloaded 0.2.15 assets as this change set.
- `scripts/publish-release.py` in the private desktop repository currently validates only Apple Silicon macOS artifacts, allowlists `latest-arm64-mac.yml`, and promotes only that allowlisted set. The CI matrix can build macOS/Windows/Linux, but private CI artifacts/tag releases do not automatically become a complete public update. The public publication path must support validated Windows x64 and Linux x64 assets/manifests before promoting the requested combined release. Publishing only the macOS set would leave other platform channels absent.
- Run destination-platform builds and packaged smoke checks on Windows x64 and Linux x64 against the final pinned commits. Repeat final packaged checks on macOS, including actual signatures, notarization and Gatekeeper verification. Native tests on this Mac do not substitute for these checks.
- Validate the updater manifests, checksums, complete asset set and source provenance for one version. Exercise upgrade and saved-project persistence with disposable installations/profiles, then verify the public feed after publication. No customer profile or existing installed application was modified in this review.

## Reproduction and evidence

The source-file SHA-256/size manifest for the pending working tree is `/private/tmp/xhandle-pre-release-source-manifest.json`. Principal logs use `/tmp/xhandle-pre-release-*`. Fresh renderer outputs are temporary and are not source/release assets. The source snapshot must be refreshed if further runtime changes are made before release.

The earlier Claude-specific findings and synthetic model/effort matrix are documented in [claude-collaborator-reliability-review-2026-11-13.md](claude-collaborator-reliability-review-2026-11-13.md).

## November 13 release follow-up

Prepared private desktop version 0.2.16 with destination-OS Windows x64 and Linux x64 installer/archive verification receipts. The public publisher now requires both verified platform directories alongside the signed/notarized macOS set, matches exact source provenance, validates all asset digests and prevents incomplete-channel or downgrade publication. Ten regression tests cover allowlisting, tampering, receipt/source mismatch, path traversal, legacy manifest targets, symlinks and combined checksums. The existing 45 native host tests also pass. These pipeline changes still require real target-OS CI execution.

The local Developer ID signing identity was available. Apple initially returned HTTP 403 because a required developer agreement was missing or expired. The account holder subsequently accepted it, allowing final app and installer notarization to pass. No signing credential was printed or stored in source.

## Final release validation and publication

All initial release gates have been completed. The native publisher requires matching provenance and verified distributions from all three operating systems, verifies the exact allowlisted public asset set, and promotes the draft only after server-side checksums match. All 12 published asset sizes and SHA256 digests match the frozen local inputs. Anonymous downloads of the three update manifests and combined SHA256SUMS are byte-identical. The private native repository remains private; only allowlisted distribution files were uploaded.

The complete client suite remains green at 3,964 passed, with four existing optional skips; the backend suite passes all 85 tests. Final native host tests pass 49 checks and release-integrity tests pass 11. Shared desktop boundary tests, production builds and whitespace checks pass. Lint has zero errors and the 71 previously recorded warnings.

- macOS: Developer ID signing, Apple Accepted notarization, stapled app/installer tickets, Gatekeeper, archive and temporary installed-copy smoke checks pass. The signed final app reports `PUBLIC_UPDATE_FEED_OK 0.2.16` against the public latest channel.
- Windows x64: archive smoke, signature inspection, actual temporary NSIS installation, installed-app smoke and uninstallation pass. A runtime diagnostics path defect under Windows short temporary paths was fixed while retaining exact window/frame/page authorization checks. The original CI matrix failed in its external PowerShell signature inspector; corrected verification tooling successfully revalidated the same frozen binaries in a separate destination-OS job. This is not a claim that the original entire matrix was green. The installer is explicitly **unsigned** in the release notes.
- Linux x64: tar archive and native extracted AppImage payload smoke checks pass. This does not establish FUSE/desktop integration on every distribution.
- Native upgrade: an unmodified published 0.2.15 Mac app upgraded a disposable bundle to final 0.2.16. Ordinary and code-project catalogs, localStorage and IndexedDB markers survived; final signatures, ticket and embedded source provenance passed. Windows/Linux native replacement between production versions was not exercised.

**Diagnostic incident:** an early Mac upgrade probe allowed automatic relaunch, opening its temporary app against the default desktop profile. The temporary app and stale probe processes were stopped after verifying their exact identities; only checksum-matched unpublished probe cache files were removed. The installed app bundle was not a replacement target. The default profile cannot be claimed byte-for-byte unchanged, and no user-data rollback was attempted. The corrected successful final probe uses an isolated profile/cache, verifies its child process identity, disables automatic relaunch, and explicitly reopens the upgraded app with the test profile.

Full native receipts, CI job references, public asset digests and verification limits are recorded in the private desktop repository at `docs/releases/0.2.16-verification.md`. Synthetic provider checks establish transport and validation behavior; they do not guarantee live model availability or output quality for every customer.
