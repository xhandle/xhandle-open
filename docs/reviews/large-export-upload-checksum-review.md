# Large-export upload checksum review

No remaining demonstrated in-scope findings. The reported uploaded-byte SHA-256 defect is fixed in the reviewed source. Synthetic boundary streams agree with independent Node crypto, including an actual 520 MiB Chrome upload. This is not a certification that the application is regression-free.

Reviewed on 2026-10-29 in `/Users/Nick/xhandle-open`, Node v20.20.2, npm 10.9.4, Google Chrome 156.0.8078.73. No applicable AGENTS.md was found in the repository, relevant subdirectories or filesystem ancestors. The investigation and customer-fix prompt were read as context; their prior results were not substituted for fresh verification.

## Findings repaired during review

None. No demonstrated defect introduced by the checksum implementation required a source repair. Added four safeguard cases in `src/features/code-architecture-transfer/diskArchiveSink.test.js:88`: mixed Uint8Array offsets/UTF-8, cancellation during an outstanding PUT, compression failure during write, and compression failure during finish.

One initial review-test assertion failed: calling `finish()` after an already rejected compression `write()` returned `Invalid state: WritableStream is closed` rather than repeating the first error (`diskArchiveSink.js:77`). The identical failure reproduced against an isolated, unchanged HEAD sink. It is pre-existing terminal-stream behavior, not a checksum regression: the original compression error had already reached the caller, whose export failure path aborts instead of finishing. The final tests inject errors separately at write and at flush/finish, assert the original error at the failing operation, and verify DELETE cleanup. No production behavior was changed to satisfy the overstrict assertion. Temporary baseline modules/tests were removed.

## Acceptance matrix

| Requirement | Fresh evidence | Result |
| --- | --- | --- |
| Original defect reproduced | Exact HEAD sink, 520 MiB actual bytes, Node-crypto fixture | Expected integrity rejection |
| Below threshold | 504 MiB / 528482304 bytes / 2016 PUTs | Passed |
| Exact threshold | 512 MiB / 536870912 bytes / 2048 PUTs | Passed |
| Above threshold | 520 MiB / 545259520 bytes / 2080 PUTs | Passed |
| Browser length handling and bundling | Actual sink, Chrome, 520 MiB / 2080 PUTs, Node verifier | Passed |
| Bounded transport/backpressure | Awaited writes and PUTs; maximum 262144 bytes | Passed |
| Independent verification | Node `crypto.createHash('sha256')` in fixtures and actual server | Confirmed |
| Uint8Array and UTF-8 | Nonzero-offset view including 0/128/255, mixed é/emoji/NUL; Node Buffer expected bytes | Passed |
| Transport byte boundaries | 262143, 262144, 262145 bytes | Passed |
| Sequence and byte acknowledgments | Sink rejects incorrect acknowledgment; actual server rejects out-of-order chunks; conditions inspected | Passed |
| Integrity failure and cleanup | Fixture corruption rejection; actual server discards mismatched finish | Passed |
| Remote backend restriction | Sink remote-origin test and real server foreign-origin rejection | Passed |
| Cancellation/disposal | In-flight PUT rejects on abort; DELETE uses a separate, non-aborted signal | Passed |
| Closed writes | Existing test rejects writing after successful finish/dispose; both sink guards inspected | Passed |
| Compression | Node gzip roundtrip, independent uploaded-byte hash; Chrome gzip upload | Passed |
| Compression failure | Separate write/finish injected stream failures; abort completes with DELETE | Passed |
| Production dependency/build | Direct sha.js dependency, lock graph inspection, production build | Passed |
| Transfer/export regressions | 14 transfer suites + 2 export suites + 4 real-server cases | Passed |

The threshold is **uploaded bytes**: 512 MiB = 536870912 bytes, not 512 decimal MB. For the normal gzip project-export path, it is the compressed gzip byte count reaching the upload sink. The uncompressed archive footer and internal stored-data checksums consume different inputs and are not fixed by this change. A raw archive larger than this threshold may compress below it.

## Source and dependency analysis

`diskArchiveSink.js:1,25–26` replaces only the upload hash import/construction with `shajs('sha256')`. At lines 30–33 the exact PUT body is still hashed after its byte/sequence acknowledgment. The footer still contains byte count, chunk count and lowercase hexadecimal digest. URL restrictions, 60-second request timeout, per-request abort forwarding/listener removal, bounded transport, closed-state guards and independent disposal signal remain unchanged.

Installed `hash.js/lib/hash/common.js:64–77` shifts the accumulated byte length into 32 bits (`len <<= 3`) and writes zero high length words. Installed `sha.js/hash.js:80–94` instead computes numeric bit length and writes both high and low 32-bit words. Its update routine consumes Uint8Array bytes synchronously via `to-buffer`, which respects byteOffset/byteLength. Its digest API produces the expected hex string. The sink's TextEncoder continues defining UTF-8 input; sha.js is not asked to reinterpret the archive's strings.

The actual verifier (`server/projectTransferFiles.cjs:54–65`) incrementally hashes accepted disk writes with Node crypto and compares a copied hash at finish along with counts. It deletes mismatched sessions; nothing weakens that comparison or its security/ownership/origin checks. The server permits 1 MiB requests; this client remains at 256 KiB. Existing server tests cover actual disk spool/download bytes and cleanup rather than only an in-memory verifier.

`package.json:89` and root lock dependencies declare `sha.js: ^2.4.12` in production. The resolved package remains 2.4.12 with registry URL and SHA-512 integrity unchanged. The lock diff promotes sha.js, to-buffer and typed-array-buffer out of dev-only status and adds sha.js's license metadata; it does not upgrade dependencies. All 1951 lock package entries retain their versions, resolutions and integrity, with no package entries added or removed. Root production/dev manifests match the lock. `npm ls sha.js --omit=dev` resolves the direct dependency.

A recursive installed-manifest/lock traversal checked all 30 packages reachable from sha.js: each resolves at its locked version and none has a dev-only flag. Its immediate dependencies are inherits 2.0.4, safe-buffer 5.2.1 and to-buffer 1.2.1; the latter's isarray/typed-array-buffer/type-detection dependencies and their helper chains are production-resolvable too. No reinstall, prune, lock regeneration or unrelated dependency update was performed. This verifies the current lock graph and installed resolution, not a fresh offline/clean installation or an independent audit of registry tarballs.

`App.js` uses the compressed sink for project export; `projectArchive.js` awaits serialized writes and aborts the sink on error. The hazard CSV caller awaits its writes and aborts on failure. The compression pump awaits upload writes and forwards failure to the writer; finish waits for close and the pump before upload finalization. Success transfers disposal responsibility through the returned download object. No whole-file conversion was added.

## Memory, timeouts and cleanup

The three large Jest cases reuse one patterned 4 MiB Uint8Array and await each `writeBytes`. The sink serializes 256 KiB PUTs; only the current body and bounded pending views are live. The large fixture uses a plain function, not jest.fn, and `capture:false`: no body array, call history, assertion closure, full-file string, Buffer concatenation or Blob retains the stream. `lastOptions` stores only method/signal. Counters and Node hash state remain bounded. Small roundtrip tests deliberately capture only small payloads.

sha.js retains its block and accumulated length, not the message; to-buffer wraps/copies only the current bounded chunk. The review browser fixture similarly keeps per-session counters/hash and only the current Express raw body (limit 262144). Chrome reuses the same 4 MiB source block. Gzip feeds 100 awaited repetitions of one small text string. No real archive was loaded. These are structural memory checks, not heap/RSS profiling; GC, browser networking and compression have their own bounded buffers and no fixed peak-memory number is claimed.

Each large test has a 180000 ms timeout and a `finally` abort. Production requests use a 60000 ms AbortController timer with finally cleanup. Jest timeouts are watchdogs, not forcible cancellation of arbitrary code; the in-process fixture has no external blocking I/O and no forced-timeout test was run. Cancellation and compression-failure cases verify their real cleanup paths.

The review browser runner used a fresh mkdtemp profile, random loopback HTTP port and a separately spawned Chrome. The earlier `/tmp/xhandle-checksum-browser.cjs` was absent. The new runner explicitly awaited the owned Chrome process's exit before deleting its profile, with removal retries, avoiding the reported shutdown/removal race. It closed its WebSocket and HTTP listener and reported zero pending fixture sessions. Only review-owned processes/directories were removed; the user's dev server was untouched.

## Commands and results

All commands ran from the repository root. Logs below are local `/tmp` evidence from this review, not the earlier implementation logs.

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-transfer/diskArchiveSink.test.js
```

Passed 12/12 initial cases in 33.747 seconds, including all three real boundary tests (504: 9.656 s; 512: 10.725 s; 520: 12.700 s). Log: `/tmp/xhandle-review-sink.log`.

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-transfer/diskArchiveSink.test.js --testNamePattern='^(?!streams (504|512|520) MiB)'
```

After adding the four small safeguard cases: 13 passed in 0.516 seconds; the three already-passed boundary cases were explicitly filtered to avoid another unnecessary large run. The unchanged boundary cases remain enabled in the file. Across these runs all 16 final cases were exercised. Log: `/tmp/xhandle-review-safeguards-final.log`.

```sh
CI=true npm test -- --watchAll=false --runInBand --testPathPattern=src/features/code-architecture-transfer --testPathIgnorePatterns=diskArchiveSink
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/utils/exportUtils.test.js src/features/code-architecture-review/codeArchitectureReviewExport.test.js
node --test server/projectTransferFiles.test.cjs
npx --no-install eslint src/features/code-architecture-transfer/diskArchiveSink.js src/features/code-architecture-transfer/diskArchiveSink.test.js
npm ls sha.js --omit=dev
npm run build
git diff --check
```

Results: 14 transfer suites / 140 tests passed; one pre-existing opt-in archive benchmark skipped without an input file (22.417 s). Two export suites / 3 tests passed (0.648 s). Real server 4/4 passed. Changed-file lint passed both before and after the review test additions. Production build exited 0 with repository-wide existing ESLint warnings, stale Browserslist data notice and bundle-size advisory. No dependency updates were made to silence notices. Final diff whitespace check passed. Logs: `/tmp/xhandle-review-transfer.log`, `/tmp/xhandle-review-export.log`, `/tmp/xhandle-review-lint-final.log`, `/tmp/xhandle-review-build.log`.

The original-sink reproduction ran a `node` stdin fixture, reading `git show HEAD:src/features/code-architecture-transfer/diskArchiveSink.js` with execFileSync. Only ESM syntax/backend default were adapted to evaluate the unchanged sink in Node; upload/hash/control logic was preserved. Its independent handler incrementally hashed every PUT with Node crypto, acknowledged sequence/bytes, and rejected the finish digest. It fed 130 awaited repetitions of the same patterned 4 MiB buffer and aborted in finally. Exit 0 meant the expected failure was observed, not a successful original upload. No worktree file was reset or replaced.

At 545259520 bytes / 2080 chunks:

- Original client: `baf8410e8f30184dcbc263a33f889c4d85ac20a1c6e227e1e64d46453ef1a74f`
- Independent Node: `731703913cdf1fa5e08c30c214cad9eeba39ae469de25156c663389f7b4ba0a6`
- Result: `Export file integrity check failed.`

Log: `/tmp/xhandle-review-original.log`. The separate unchanged-HEAD compression assertion reproduction command was:

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-transfer/diskArchiveSink.review-baseline.test.js --testNamePattern='propagates compression errors'
```

It reproduced the same closed-stream error (one expected failing assertion), log `/tmp/xhandle-review-baseline.log`; both temporary source and test were removed after diagnosis.

```sh
node /tmp/xhandle-review-browser.cjs
```

The temporary runner webpack-bundled the actual sink and its backend-config imports, served the bundle and incremental Node verifier on a fresh loopback listener, and drove the fresh Chrome profile through CDP. Browser result: 545259520 raw bytes, 2080 PUTs, digest `731703913cdf1fa5e08c30c214cad9eeba39ae469de25156c663389f7b4ba0a6`; gzip result 6613 uploaded bytes, one PUT, digest `c53cc2650acb4c1b13eb4a2c3a1c46ea4883a2474fb0c3ebf3c6712388f8446e`. Maximum PUT 262144; two independently accepted finishes; zero remaining sessions. Exit 0 and owned-resource cleanup confirmed. Log: `/tmp/xhandle-review-browser.log`. Temporary runner/bundle/profile were removed after use. This was a Node-backed browser fixture, not the production disk router; the latter was separately exercised by its own tests. The browser gzip sample was small; a >512 MiB compressed stream was not run. Node and browser raw boundary tests validate the common byte hasher; smaller gzip tests validate its placement after compression.

Additional Node assertion scripts compared root manifests, every lock version/resolution/integrity against HEAD, and recursively checked installed sha.js production resolution as described above. These were read-only stdin commands, not installs.

## Scope and verification limits

The customer archive (reported about 634 MB) was not inspected or replayed. Evidence uses synthetic byte streams and text. Production browser compilation and an isolated browser upload passed; desktop UI/download integration and packaged application behavior were not exercised. The installed desktop application has not been updated.

Internal checksum implementations in `projectArchive.js`, `hazardRunChunks.js` and `hazardChunkIntegrity.js` intentionally remain hash.js based. Their compatibility with old archives/stored data requires a separate migration; this review does not resolve their large-input checksum concerns. Historical-run export selection, size and performance remain separate concerns.

Existing authorized storage/UI/lifecycle/export edits and untracked files, including `projectArchive.js`/`projectExportScope.js`, were preserved and were not attributed to this fix. Review writes were limited to this report and additional sink tests. No reset, commit, push, merge, deployment, publication, desktop packaging, installed-app change, global setting change, personal profile/database access, subagent or recursive Codex run occurred. The full repository suite and known baseline hazard-eval failures were not rerun. The passing checks support this narrow fix; they cannot establish absolute absence of bugs.
