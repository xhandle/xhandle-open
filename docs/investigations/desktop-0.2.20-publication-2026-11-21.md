# Desktop 0.2.20 final verification

[Desktop 0.2.20](https://github.com/xhandle/xhandle-desktop-releases/releases/tag/v0.2.20) is published for Apple Silicon macOS arm64 and Linux x64. Windows remains on 0.2.16 through its retained updater manifest and immutable original download URLs.

## Frozen source

- Shared application: `881e401c322f0d38256b66ba4efebbf4f121af6c`.
- Desktop application: `ed4c857bf744feb28d4b8ab969219f74967d6b4b`.
- [Shared CI 44946145178](https://github.com/xhandle/xhandle-open/actions/runs/44946145178): passed.
- [Exact-commit Mac/Linux CI 44946267637](https://github.com/xhandle/xhandle-desktop/actions/runs/44946267637): both destination-OS jobs passed; tag-only private-release job skipped.
- [Desktop PR 17](https://github.com/xhandle/xhandle-desktop/pull/17) and [PR CI 44946267787](https://github.com/xhandle/xhandle-desktop/actions/runs/44946267787): passed; merged by fast-forward so tested, packaged and main application commits remain identical.
- Native host, updater and signing configuration are unchanged from 0.2.19. The private change updates the package/lockfile version, published shared pin, and boundary regression selection.

## Changes

The existing-project file selection workflow offers Replace or Append. Append adds newly selected files, preserves earlier evidence, identities and analyst decisions, and checks source-cited connections in both directions across batches. Integration checkpoints resume completed work without repeating extraction. Complete model JSON wrapped in Markdown/prose is accepted, while incomplete or malformed output remains recoverable. Hazard draft-worker failures stay in the retry UI, with stale messages ignored. The user-requested connection-summary notice is hidden while stored evidence remains available. Scrolling is unchanged.

The user accepted the existing connection-verification level. No stronger conclusion gate or compiler-backed exhaustive analysis was introduced; source-cited model proposals are not proof of runtime dispatch or a complete call graph.

## Verification

- Comprehensive shared Electron review: all 18 categories passed, with 4,476 frontend tests (four existing skips), 140 backend/diagnostic tests, 13 capacity checks, 49 native Node tests and 19 native Python validators. The review source fingerprint before the final display-only notice removal was `37abc71cc4c75297a3f2efb4a99190c3ac5b72dc25021ca618bb8e00a21c4f5c`. An in-memory reconstruction confirmed that deletion was the only subsequent runtime-source difference; ten actual App configuration checks passed after removal.
- Frozen desktop boundary checks: 331 renderer tests in 29 suites, one server-startup test and 17 Node lifecycle/configuration tests passed. Counts overlap the shared comprehensive review.
- The actual signed 0.2.20 application passed nine controlled workflow checks in a disposable profile: first C analysis, Cancel, malformed integration preservation and checkpoint retry, no repeated extraction, JavaScript Append, C→JS and JS→C bindings with stable earlier identities, hidden notice with retained evidence, Functional diagram, persisted reload and explicit Replace. Zero renderer errors; 27 controlled GitHub responses and 14 controlled model responses. Personal workspaces and paid providers were not used.
- Mac app and installer: Developer ID signatures use the existing Team ID; Apple notarization Accepted; stapled tickets, strict code-signature and Gatekeeper checks passed. The packaged app, update ZIP and temporary installed DMG copy passed provenance/updater and isolated persistence smoke checks.
- Linux: the distributed archive and extracted AppImage passed destination-OS smoke, matching-source and anonymous updater verification. Downloaded artifact ZIP SHA256: `137b0b8062007da9de386f84ce3f82f7b568ebbd38a63ef5fc6cd788e45c5fd6`. Local receipt/file/manifest digests were verified after download.
- Publication: exactly nine allowlisted assets match local sizes and GitHub server-side SHA256 digests. Anonymous Mac/Linux/retained-Windows manifests and SHA256SUMS match their verified local inputs. Private desktop source visibility was checked. The signed app's isolated public-feed check passed with downloads/install disabled.

Live-provider quality, customer repository permissions, exhaustive connection correctness and every operating-system distribution are not established by these controlled tests. Native OS replacement from 0.2.19 to 0.2.20 was not exercised; host/update tests and packaged download/checksum checks cover the unchanged updater path. Safari and the deferred scrolling behavior remain outside this release change.

## Published assets

| Asset | Bytes | SHA256 |
| --- | ---: | --- |
| `latest-arm64-mac.yml` | 509 | `d817cc479de860ded7322c480f556df76f8d3da2fd512f497b90fdbbb03d45aa` |
| `xHandle-0.2.20-arm64-mac.zip` | 232571958 | `b2efb9c80d22c11d87a51d2181edff5d57144d30a5981b81d630d5a76cb2ecb1` |
| `xHandle-0.2.20-arm64-mac.zip.blockmap` | 242693 | `71def89d8c583f538178e911089d9fe6f5904ea08d5efa1cff7c01033edcc1fc` |
| `xHandle-0.2.20-arm64.dmg` | 221714344 | `e6da475aeaad4db8798fd7e05872f72f219f01891569df3c112b9b19083eada3` |
| `latest-x64-linux.yml` | 395 | `ef96fadb70268ccf6317b750cc69fb87db1195425555abafad3f98075376529c` |
| `xHandle-0.2.20-x86_64-linux.AppImage` | 222070911 | `5c48ab9f705f4813f80299ebc3d11730ce0dc217923254e34d602d09b51f65eb` |
| `xHandle-0.2.20-x64-linux.tar.gz` | 205333383 | `750fdf6a03dcb8f40fb3a4b3c28cec26f8375f8924bf37cd855d813b3eb7a14e` |
| `latest-x64.yml` | 531 | `afc524fdcf4f3eaee34b2d676c1e7b33499b8134b0dc5e7379b6cffe7f47070f` |
| `SHA256SUMS` | 746 | `a450cabc656e9b468755fd49087caab721e5bbe300f5a1a42eb074a88de51f8c` |

## Local evidence

- `/private/tmp/xhandle-append-release-ready-20261121/report.json`
- `/private/tmp/xhandle-0.2.20-release-preparation/`
- `/private/tmp/xhandle-0.2.20-native-tests.log`
- `/private/tmp/xhandle-0.2.20-shared-boundary.log`
- `/private/tmp/xhandle-0.2.20-mac-build.log`
- `/private/tmp/xhandle-0.2.20-mac-finalize.log`
- `/private/tmp/xhandle-0.2.20-packaged-append-ui-result.json`
- `/private/tmp/xhandle-0.2.20-ci-assets/Linux/dist/release-verification-linux-x64.json`
- `/private/tmp/xhandle-0.2.20-publication.log`
- `/private/tmp/xhandle-0.2.20-public-verification.json`
- `/private/tmp/xhandle-0.2.20-public-feed.log`

Later documentation-only commits do not require rebuilding these frozen application bytes.
