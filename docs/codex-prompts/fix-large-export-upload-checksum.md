Integrate and verify the customer's narrow large-export checksum fix in /Users/Nick/xhandle-open. Implement it and run appropriate verification; do not stop at a plan.

Confirmed defect:
- src/features/code-architecture-transfer/diskArchiveSink.js uses hash.js SHA-256 for the streamed upload digest.
- Installed hash.js/lib/hash/common.js encodes the final message bit length with `len <<= 3` and zero high length words. It produces a nonstandard SHA-256 digest from 512 MiB (536870912 bytes) onward.
- server/projectTransferFiles.cjs correctly verifies with Node crypto. A customer export of about 634 MB failed with “Export file integrity check failed.” Their two-file patch replaced the sink hash with sha.js and their large export succeeded.
- The primary agent independently streamed 520 MiB through hash.js, sha.js and Node crypto: hash.js did not match Node; sha.js matched.
- The current diskArchiveSink.test.js fake server incorrectly uses hash.js too, masking the bug.

Requested fix scope ONLY:
1. Change diskArchiveSink.js import from `{ sha256 } from 'hash.js'` to `shajs from 'sha.js'`, and instantiate with `shajs('sha256')`. Preserve streaming, bounded 256 KiB uploads, byte/sequence acknowledgments, abort/disposal, compression and backend-origin restrictions. Add a concise comment explaining the real server compatibility and old 512 MiB defect.
2. Add sha.js as an explicit production dependency in package.json and package-lock.json. The installed transitive package is currently 2.4.12; inspect exact availability/lock state and use a compatible explicit declaration without unrelated dependency/lockfile churn. Do not merely rely on polyfills to install it.
3. Make the test fake server verify incrementally with Node's `crypto.createHash('sha256')`, independently of the client implementation. Do not retain the full large upload in an array or in jest.fn call histories. Keep small existing tests able to inspect bounded uploads, but the large boundary tests must retain only bounded buffers, counters and incremental hash state. Reuse fixed-size input buffers; do not allocate a full >512 MiB file or join it into a Blob/string in tests.
4. Add meaningful below/at/above-boundary coverage (e.g. 504 MiB, exactly 512 MiB and 520 MiB) against Node crypto. Demonstrate at least the above-boundary test fails with the original sink and passes after the fix using an isolated temporary test fixture/alternate import, without resetting this worktree. Do not repeat expensive large tests unnecessarily. Give tests appropriate timeouts; don't silently skip them. Inspect for memory retention from upload mocks, assertions and call tracking.
5. Verify compressed and uncompressed paths, byte boundaries and non-ASCII encoding through existing tests; ensure cancellation, cleanup and integrity rejection still work. At least one bounded streaming browser verification against Web Crypto or an independent Node-backed fixture is desirable if tooling is available, but keep this task focused. Do not rely exclusively on comparing the replacement library with itself.
6. Run diskArchiveSink and relevant project export/compression/transfer tests, Node server/projectTransferFiles.test.cjs, lint on changed files, final production build, and git diff --check. Existing archive/export tests are relevant regressions, but do not change their internal checksum implementation here. Avoid repeatedly running the repository's known failing hazard-eval fixtures.
7. Write docs/investigations/large-export-upload-checksum-fix.md with the cause, exact narrow changes, fail-before/pass-after evidence, boundary checks, commands/results and limitations. Distinguish Node verification from browser verification and a synthetic stream from the customer's real archive.

Customer patch being integrated:
- diskArchiveSink.js: `import shajs from 'sha.js';` and `hash=shajs('sha256')`.
- diskArchiveSink.test.js: use Node crypto for the test server; stream 130 repeats of a 4 MiB Uint8Array (520 MiB total) and finish the sink, asserting the full byte count. Improve their fake server's memory behavior as described above rather than retaining every upload in `writes`.

Out of scope:
- Do not replace hash.js across projectArchive.js, hazardRunChunks.js or hazardChunkIntegrity.js. Existing archive and stored-data checksum compatibility needs a separate coordinated migration.
- Do not change archive format/version, export history selection, automatic retention, storage cleanup UX or server integrity requirements.
- Do not disable checksum verification or any security/ownership checks.
- Do not publish, commit, push, merge, deploy, package desktop releases, touch installed apps, or read customer/personal browser data/backups. Do not change global configuration.

Worktree discipline:
Inspect git status/diff and applicable AGENTS.md first. There are substantial authorized uncommitted storage/lifecycle/UI/transfer changes from earlier work, including projectArchive.js and projectExportScope.js, plus prompts, reports, tests and diagnostics. Preserve all of them. This task should primarily touch diskArchiveSink.js, its tests, package.json/lockfile and the new report/prompt. Do not spawn subagents or recursively invoke Codex. Use isolated synthetic fixtures and clean up only resources/processes you create; leave the user's dev server alone.

Finish with a concise implemented-fix and validation summary, clearly stating that internal checksum migration/history-export performance remain separate and that no installed desktop app was updated.
