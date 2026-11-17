# Desktop 0.2.18 publication

[xHandle Desktop 0.2.18](https://github.com/xhandle/xhandle-desktop-releases/releases/tag/v0.2.18) is the latest update for Apple Silicon macOS arm64 and Linux x64. Windows remains on 0.2.16 through the retained channel manifest and its original immutable download URLs. No new Windows binary was built.

The shared application is frozen at `6ffc880fe09564e9c8e2e20b919288b6f292262c`. It corrects evidence-review item type instructions and recovery, and lets finite project/document generation finish beyond the former total 15-minute/120-request cutoff. Individual request timeouts, cancellation, bounded retries, saved checkpoints, source validation, and requirement-writing checks remain in effect. No saved-data reset is required; unchanged projects can resume their saved work.

## Verification

- Full frontend sweep: 4,359 tests passed in 483 suites; four intentional test skips. [Shared CI](https://github.com/xhandle/xhandle-open/actions/runs/43995766959) passed for the frozen source commit.
- Focused Design Management verification: 508 tests in 54 suites, production build, focused lint, and syntax/whitespace checks passed. Counts overlap the full sweep.
- The exact staged production renderer passed five isolated Electron checks: bounded type correction, saved evidence reuse after reload/resume, original citation retention, five-document completion across 36 simulated minutes, and persisted acceptance. Responses and elapsed time are controlled fixtures, not paid live-model quality tests.
- Desktop checks passed: 49 native Node tests, 19 Python tests, shared host-boundary checks, and both destination-OS build jobs. The Mac app and installer are Developer ID signed, Apple notarized, and passed Gatekeeper, archive, temporary installation, and packaged smoke checks. Linux archive/AppImage checks passed on Linux.
- A genuine signed 0.2.17 → 0.2.18 Mac replacement completed in a disposable installation. Synthetic Projects and Code-Based Architecture identities, local storage, and IndexedDB survived. Earlier attempts waited in macOS authorization; the approved retry completed. The replaced bundle was manually relaunched with the same isolated profile; automatic normal-profile relaunch is not claimed. Personal installations and workspaces were not used.
- All nine published assets matched their verified sizes and SHA256 digests. Anonymous Mac/Linux/retained-Windows manifests and SHA256SUMS matched. The signed Mac app's isolated, download-disabled public-feed check reported `PUBLIC_UPDATE_FEED_OK 0.2.18`.

The desktop build is frozen at `434dc6c3e20ebbf77c2c6c45f3fef17cf24b54bc`. Later documentation commits do not alter those packages. Full native receipts and installer verification records remain in the private desktop repository.
