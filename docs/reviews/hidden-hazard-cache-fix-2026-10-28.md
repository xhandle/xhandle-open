# Hidden hazard cache retention fix

Implemented the prompt in `docs/codex-prompts/fix-hidden-hazard-cache-retention.md`.

The workspace now owns a preparation cache whose lifetime follows the same input identities used by the hazard loader. Replacing saved results, architecture rows, context/freshness inputs, or project/repository scope clears and retires the old cache even while the hazard tab is unmounted. Unchanged inputs reuse the existing cache. Source keys are defined in one helper to prevent the owner and loader from drifting apart. A preparation job cannot publish into a retired cache, and its dependencies include the cache handle.

No saved-data format, analysis concurrency, memory limit or generation behavior changed. Earlier pending changes were preserved.

Validation:
- 190 tests passed in 23 suites (`/tmp/cache-fix-full.log`).
- Hidden-tab regression coverage includes results replacement, architecture/context changes, selection, organization context, deletion, scope changes, unchanged reuse and rejected retired-cache publication.
- Real hazard panel/table component test renders 26,278 rows and performs five hide/reentry cycles; the table remains windowed below 100 DOM rows. This runs in jsdom, not a full browser workspace.
- Updated isolated Electron/Chromium diagnostic uses the new workspace cache hook: 100 reentries, 101 metadata checks, no extra root payload reads after initial load (`/tmp/cache-fix-stress.log`). Its final table renderer is stubbed, so its memory numbers isolate storage and preparation. Renderer peak working set was 157,536 KiB.
- Production build passed with warnings (`/tmp/cache-fix-build.log`); no warning references the new cache helper or loader.
- `git diff --check` passed.

The obsolete cache reference regression is fixed by these checks. The original user's Chrome error-code-5 crash has not been reproduced end-to-end. Actual large-workspace Chrome/Electron stress testing and Safari validation remain necessary before claiming that all crashes are resolved. Changes are local, not committed or released.
