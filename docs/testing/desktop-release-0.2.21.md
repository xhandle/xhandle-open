# Desktop 0.2.21 publication

[Desktop 0.2.21](https://github.com/xhandle/xhandle-desktop-releases/releases/tag/v0.2.21) is published for Apple Silicon macOS arm64 and Linux x64. Windows retains 0.2.16 through its existing manifest and immutable download URLs. Use Help → Check for Updates in supported installed packages, or download from the release page.

The cumulative update includes architecture finalization memory/recovery improvements; system/light/dark appearance and native preference persistence; report actions, rename, contents and diagram image appearance; the Collaborator Prompt Cookbook; and source-evidence/operational-context consistency improvements in hazard analysis. Existing saved work remains compatible; no data reset is required.

Application bytes are frozen at shared `b63e84f0fa7ca448412e9d44f05ad4fe100173d4` and desktop `be6d8583d652d77d62274043ad3e5b0e755ca031`. Shared PR 1 and desktop PR 18 were merged through GitHub. Subsequent workflow/documentation commits do not change those application bytes.

## Verification

- All 23 cumulative regression categories passed with stable runtime-source fingerprints: 4,743 active frontend tests, 153 backend/diagnostic tests, 52 native Node tests, 19 native Python validators and 13 archive-capacity checks. Four existing frontend tests remain intentionally skipped. Counts overlap focused diagnostics.
- Both platforms replayed 6,000 synthetic source files and 32,000 relationships at ordinary renderer heap limits. Results retain every row and evidence field, source citations/bodies and checksum `213072134` through complete save/reload and process-restart recovery. Recovery discovery previews only 50 rows. Cancellation, corrupt data, quota failures, transaction rollback and concurrent edits preserve earlier work.

| Platform | Control peak used heap | Fixed peak pipeline heap | Reduction |
| --- | ---: | ---: | ---: |
| macOS arm64 | 4.234 GB | 3.084 GB | 27.16% |
| Linux x64 | 4.174 GB | 3.123 GB | 25.18% |

The control runs were deliberately stopped after sustained measured pressure; they are not observed native crashes. Fixed runs completed. Linux measured over 4 GB resident memory as well as 4 GB heap pressure. Heap limits were unchanged within each comparison.

- The full-size preview opened all 32,000 rows with bounded virtualization; an analyst edit saved and survived reload without changing the neighboring row.
- Real signed 0.2.20 and 0.2.21 bundles preserved a disposable synthetic profile's project identities, legacy evidence and checkpoint. Native appearance settings persisted across 0.2.21 restart. This is profile-continuity validation, not a completed automatic OS replacement.
- Mac app and installer passed Developer ID signature, Apple notarization, stapled-ticket, Gatekeeper, archive and temporary-installation smoke checks. Linux tar/AppImage packages passed destination-OS provenance, storage/backend and updater checks. The separate frozen-package Linux pressure replay passed after correcting its test-runtime launcher.
- All nine public assets match verified local sizes and GitHub SHA256 digests. Anonymous Mac/Linux/retained-Windows manifests and SHA256SUMS match. The actual signed app printed `PUBLIC_UPDATE_FEED_OK 0.2.21` with downloading/installing disabled.

The benchmark starts after extraction and uses synthetic sources and controlled/offline provider behavior. It does not evaluate 6,000 live provider requests or establish a live-model quality score. Full row-array APIs remain compatible; unique evidence, very large files and whole-result exports can still require substantial memory. This is not an unlimited repository-capacity guarantee.
