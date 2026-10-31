# Large export upload checksum fix

## Cause and scope

The upload sink used hash.js 1.1.7 SHA-256. Its installed
`lib/hash/common.js` finalizer shifts the byte count with `len <<= 3` and
writes zero high length words. At 536870912 bytes (512 MiB), the encoded
message bit length wraps. The real `server/projectTransferFiles.cjs` verifier
uses Node crypto and correctly rejects that digest. The old fake server used
the same broken library, hiding the defect.

Only the disk upload checksum changes: `diskArchiveSink.js` now imports
`shajs` from `sha.js` and constructs `shajs('sha256')`, with a comment explaining
the compatibility requirement. Upload size (256 KiB), streaming, acknowledgment
checks, compression, cancellation/disposal and backend origin checks are unchanged.

`sha.js: ^2.4.12` is now an explicit production dependency. The installed and
locked version was already 2.4.12; npm retained its version, resolved URL and
integrity. Lock changes promote sha.js and its previously dev-only dependencies
(to-buffer and typed-array-buffer) to production and add sha.js license metadata.
No other package versions changed. An offline lock-only install first failed
because registry metadata was not cached; the normal lock-only install succeeded.

## Independent regression evidence

The fake server now incrementally hashes each PUT with Node
`crypto.createHash('sha256')` and rejects mismatched bytes, chunks or digest.
Small tests retain upload bodies and Jest call history for inspection. Large
tests explicitly disable both: a plain async handler retains counters, incremental
hash state and method/signal metadata only. The upload body is never saved in
metadata. Assertions inspect scalar counters and an empty capture array.

Each boundary case reuses one patterned 4 MiB Uint8Array, awaiting every write;
the sink splits it into 256 KiB requests. No full large file, Blob, concatenation
or string exists. Each case has a 180-second timeout and always disposes the sink.

To demonstrate failure without resetting the dirty worktree, the HEAD sink was
copied with `git show HEAD:src/features/code-architecture-transfer/diskArchiveSink.js`
to `diskArchiveSink.before-fixture.js`. A temporary copy of the new test imported
that alternate module. The command below ran only its 520 MiB case, which failed
in 17.4 seconds with **Export file integrity check failed.** Both temporary source
files were then removed. The unrelated cases shown as filtered/skipped in this
single-case reproduction were all exercised in the fixed-sink run.

```
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-transfer/diskArchiveSink.before-fixture.test.js --testNamePattern='streams 520 MiB'
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-transfer/diskArchiveSink.test.js
```

Fixed sink: **12/12 passed**, including 504 MiB (528482304 bytes), exactly
512 MiB (536870912 bytes), and 520 MiB (545259520 bytes), approximately
10.4, 11.2 and 12.6 seconds respectively. Each verifies the complete byte count,
chunk count, maximum upload size and Node-verified finish. No large case was
silently skipped or rerun unnecessarily. Other sink cases cover non-ASCII UTF-8,
gzip roundtrip, byte lengths 262143/262144/262145, remote-origin rejection,
incorrect acknowledgments, independent cancellation cleanup, closed writes,
and explicit server integrity rejection followed by disposal.

## Other verification

- `CI=true npm test -- --watchAll=false --runInBand --testPathPattern=src/features/code-architecture-transfer --testPathIgnorePatterns=diskArchiveSink`: **14 suites, 140 tests passed**. One existing opt-in legacy-file benchmark skipped because no input archive was supplied. Includes archive, export scope, compression codec, streaming and transfer regression tests. No hazard-eval fixture runs.
- `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/utils/exportUtils.test.js src/features/code-architecture-review/codeArchitectureReviewExport.test.js`: **2 suites, 3 tests passed**.
- `node --test server/projectTransferFiles.test.cjs`: **4/4 passed**, including corruption, sequence, ownership/origin and expiration checks.
- `npx --no-install eslint src/features/code-architecture-transfer/diskArchiveSink.js src/features/code-architecture-transfer/diskArchiveSink.test.js`: passed; only existing stale Browserslist data notice.
- Browser: a temporary webpack bundle imported the actual sink and ran in installed headless Chrome with a fresh temporary profile and a random loopback Express fixture. The fixture independently incrementally verified every finish using Node crypto, validated sequence, and limited PUTs to 256 KiB. An **8388608-byte** synthetic stream (32 writes of a reused 256 KiB buffer) and a compressed non-ASCII stream (**1851 compressed bytes**) both passed; maximum PUT was **262144 bytes**. No Web Crypto comparison or large-boundary browser test was performed. The browser reported success; runner cleanup initially returned ENOTEMPTY due to a profile-removal race. Retrying removal of that exact created directory succeeded. The browser process/server were closed. No user profile or running dev server was accessed.
- `npm run build`: **passed (exit 0)**, compiled with repository-wide ESLint warnings in other files, stale Browserslist data notices and a bundle-size advisory. Changed sink files passed their separate lint check. Build output was not published.
- `git diff --check`: **passed**, including the preserved pre-existing changes.

## Limitations and worktree discipline

These are synthetic streams, not the customer's approximately 634 MB archive.
Large-boundary verification ran under Jest/Node against independent Node crypto;
the browser run establishes bundling, browser buffer handling and compressed and
uncompressed upload compatibility on smaller bounded streams. It does not claim
an end-to-end replay of the customer archive or desktop download UI validation.

No applicable AGENTS.md was found in the workspace or ancestor directories.
Existing storage/lifecycle/UI/transfer edits and the pre-existing customer prompt
were preserved. No server integrity/security checks, archive formats, history
selection, retention policy or storage UI changed. Internal checksums in
projectArchive.js, hazardRunChunks.js and hazardChunkIntegrity.js remain unchanged
by this task; their compatibility migration requires separate coordinated work.
History-export performance also remains separate. No installed desktop app was
updated; nothing was committed, pushed, published, deployed or packaged.
