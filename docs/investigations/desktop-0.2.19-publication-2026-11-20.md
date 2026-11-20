# Desktop 0.2.19 final verification

[Desktop 0.2.19](https://github.com/xhandle/xhandle-desktop-releases/releases/tag/v0.2.19) is published for Apple Silicon macOS arm64 and Linux x64. Windows remains on 0.2.16 through its retained manifest and immutable original download URLs. No new Windows build was produced.

## Frozen source and checks

- Desktop build: `40874a58a8cf9a1d61b7955578a8bb4169ea2826`.
- Shared application: `34002bb3813219c7b7cca50dbc77c32c1a546d5b`.
- [Shared CI 44798926632](https://github.com/xhandle/xhandle-open/actions/runs/44798926632): passed.
- [Exact-commit Mac/Linux CI 44799361629](https://github.com/xhandle/xhandle-desktop/actions/runs/44799361629): both destination-OS jobs passed. The tag-only private-release job was skipped.
- [Desktop PR 16](https://github.com/xhandle/xhandle-desktop/pull/16) and [PR CI 44799362972](https://github.com/xhandle/xhandle-desktop/actions/runs/44799362972): passed; merged by fast-forward so tested, packaged and main-branch application commits remain identical.
- Native host, updater and signing configuration are unchanged from 0.2.18. The private change updates the version, published shared pin and shared regression checks.

## Changes

GitHub source reads pause at rate limits and resume pinned requests while the app stays open. Source analysis recovers transient storage aborts, retains interruption reasons, propagates cancellation through classification and checks AI settings before queued requests. Hazard analysis preserves other-context edits and row identities, rejects unavailable contexts and freezes provider/model/effort settings for requests and checkpoints. The update also includes bounded Projects HARA reasoning repairs, relationship Layers selection and trackpad panning.

## Verification

- All 18 comprehensive Electron categories passed on macOS arm64 / Electron 45 against unchanged source fingerprint `308ef7787cdfa9ce6e67dc29b053ea2201216a503c10ff380fe9b6826016065e`.
- Frontend: 4,406 passed, four existing skips; backend/diagnostics: 133 passed; capacity: 13 passed; native Node: 49 passed; native Python release validators: 19 passed. Focused counts overlap the full sweep.
- Frozen desktop boundary checks: 261 renderer tests in 23 suites, one server-startup test and ten Node lifecycle/setup tests passed.
- Production build, native startup/persistence, workspace interactions, HARA/STPA, organization profiles, traceability, artifacts, derivation, downstream safety inheritance, collaborator context and worker responsiveness passed. Provider/source responses and workspaces in these workflow checks are synthetic.
- Mac app and DMG: Developer ID signed with the existing Team ID; Apple notarization Accepted; stapled tickets, code signatures and Gatekeeper checks passed. The packaged app, update ZIP and temporary DMG installation passed source-provenance/updater checks and isolated storage-reload smoke.
- Linux: distributed archive and extracted AppImage passed destination-OS smoke, source-provenance and anonymous updater checks. Downloaded CI ZIP SHA256: `e18c86b8cc00b2a5c8716259ca85fd3b27aafdcef01b59c8e3aeb1f9e831f057`.
- Genuine signed 0.2.18 → 0.2.19 Mac replacement passed in a disposable installation using synthetic data, a separate profile/native home and cache. Ordinary project IDs, code-project IDs, localStorage and IndexedDB markers survived. An initial three-minute staging probe timed out; the retry stack showed macOS AuthorizationCreate waiting. After the user approved the system dialog, native staging/replacement and data checks passed. The replaced bundle was manually relaunched with the same isolated profile; automatic normal-profile relaunch is not claimed. Personal installations/workspaces were not used.
- Public publication: exactly nine allowlisted assets match verified local sizes and server-side SHA256 digests. Anonymous Mac/Linux/Windows manifests and SHA256SUMS match. The signed Mac live-feed check returned `PUBLIC_UPDATE_FEED_OK 0.2.19` with downloads/install disabled and a temporary profile. The native source repository remains private.

Controlled tests do not establish every live model response's quality, every customer repository's access configuration, standards conformance, or every Linux distribution's FUSE integration. Native Linux replacement between production versions was not exercised. Safari remains outside the release-blocker scope at the user's direction.

## Published assets

| Asset | Bytes | SHA256 |
| --- | ---: | --- |
| `latest-arm64-mac.yml` | 509 | `4f94c067b4b5ba5fc03d16fe8f3227a9e943847670358a60610437ae36f96e2f` |
| `xHandle-0.2.19-arm64-mac.zip` | 232558029 | `8ee995075965034542af612e1d4b0488c98a311b91553c1c6740ae067c118c27` |
| `xHandle-0.2.19-arm64-mac.zip.blockmap` | 242407 | `bfc5620c76979a30998b2f0bb846a108a41bad086ff3ab771660cc7c867f2ef9` |
| `xHandle-0.2.19-arm64.dmg` | 221701666 | `81cf7e0be782e1d63c19a59529d3c880d6e64b8083769d6af8145a8f3c768c35` |
| `latest-x64-linux.yml` | 395 | `fc00b453e7d335c35d64ffef4d7709259f43bcaa7589bc8f9fb571b16055b030` |
| `xHandle-0.2.19-x86_64-linux.AppImage` | 222058643 | `d501e50c4c66d33fd9ae8007c4ea9cbca2e218208f83793da227b59be15698cf` |
| `xHandle-0.2.19-x64-linux.tar.gz` | 205320251 | `db6fd50ae78ac0d6d1676758f8f9385db76dbc5f0d2328aee7190f92f001ef68` |
| `latest-x64.yml` | 531 | `afc524fdcf4f3eaee34b2d676c1e7b33499b8134b0dc5e7379b6cffe7f47070f` |
| `SHA256SUMS` | 746 | `0a5c75d3234fca79a2b0649b401ceb4f1a72fdc516d4a33e4598375030e3fe28` |

## Local evidence

- `/private/tmp/xhandle-0.2.19-architecture-hazard-comprehensive-20261120/report.json`
- `/private/tmp/xhandle-0.2.19-release-preparation/readiness.json`
- `/private/tmp/xhandle-0.2.19-native-tests.log`
- `/private/tmp/xhandle-0.2.19-shared-boundary.log`
- `/private/tmp/xhandle-0.2.19-mac-build.log`
- `/private/tmp/xhandle-0.2.19-mac-finalize.log`
- `/private/tmp/xhandle-0.2.19-ci-assets/Linux/dist/release-verification-linux-x64.json`
- `/private/tmp/xhandle-0.2.19-native-upgrade-retry.log`
- `/private/tmp/xhandle-0.2.19-native-upgrade-result.json`
- `/private/tmp/xhandle-0.2.19-publication.log`
- `/private/tmp/xhandle-0.2.19-public-verification.json`
- `/private/tmp/xhandle-0.2.19-public-feed.log`

Validation receipts and disposable profiles remain private. Later documentation-only commits do not require rebuilding these frozen binaries.
