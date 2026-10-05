# Local project folder analysis review

Reviewed 2026-10-04 against `e386cde`. Executed the review in `docs/codex-prompts/review-local-codebase-analysis.md`. This is a review and implementation plan; application behavior has not been changed.

## Conclusion

Local folders can feed the existing analysis pipeline without duplicating the architecture, hazard, requirements, or diagramming engines. The feature needs a source-provider boundary, durable source identity, and source-aware evidence lookup—not just an additional picker in the modal.

Recommended first release: add **GitHub / Local project folder** choices in the existing configuration modal. Use a read-only browser directory handle where available and a directory-file-input fallback for Safari. Both select a folder on the user's computer. Clearly distinguish a connected folder from a selected snapshot that must be reselected after reload. Keep all existing GitHub controls and default legacy projects to GitHub.

If “like an IDE” means a continuously connected folder with automatic change watching in Safari, that requires a local companion/extension or desktop integration. The browser fallback alone must not promise that behavior.

## Current execution path

| Stage | Evidence in current code | Consequence for local sources |
| --- | --- | --- |
| Configuration | `src/App.js:21358`, `:4246`, `:4265` | Modal and verification require GitHub URL/owner/repo; verification uses both backend and direct GitHub calls. |
| Context | `src/App.js:4312`; `src/features/code-architecture-context/repositoryAnalysisContextAi.js:31` | README loading is GitHub-specific; editable AI context also requires a repository URL. |
| Save / Analyze | `src/App.js:4367`, `:5140` | Both modal save modes verify GitHub. Main Analyze requires owner/repo and falls back to legacy GitHub settings. |
| Ingestion | `src/components/generateFunctionalDecompositionFromGitHub.js:3317` | Resolves branch/commit, clears old source index, lists GitHub tree, loads README, selects extensions and builds an analysis plan. |
| Per-file analysis | same file `:3550` | Sequential read, source indexing, bounded chunks, AI request, deterministic grounding, per-file checkpoint. |
| Classification/results | same file `:3264`, `:3742`; `src/App.js:5217` | Allocation/descriptions and stable trace IDs are reusable; final rows go to IndexedDB with metadata and review items. |
| Evidence consumers | source audit `:65`; remediation source context `:145` | Lookup assumes owner/repo index keys and GitHub source URLs. |

Paths abbreviated in the last row are `src/features/code-architecture-hazard-analysis/codeArchitectureHazardSourceAudit.js` and `src/features/safety-remediation/safetyRemediationSourceContext.js`. Line references describe this reviewed revision.

## Findings and required changes

### 1. Source selection is coupled to GitHub at several entry points — implementation blocker

`makeRepoConfig` and `normalizeCodeArchitectureProjects` (`src/App.js:1666`, `:1699`) construct an explicit set of GitHub fields. Simply adding `sourceType` to the modal would not survive normalization. `handleBaselineRepo` and the generator each independently require owner/repo and can read legacy credentials. Context generation, metadata, review source-method labels, import, and export also synthesize GitHub identities/URLs (`src/App.js:4451`, `:4690`, `:5230`, `:5281`).

Introduce a discriminated source configuration. Persist `sourceType`, a stable source ID, display name, access mode, snapshot identity, and selected extensions. Keep handles/File objects outside JSON configuration. Branch explicitly before GitHub verification or legacy fallback. No GitHub calls or token requirements should occur for local mode. Existing configurations without a source type remain GitHub.

The existing result-row shape and downstream analysis behavior should remain compatible. Do not invent `local/FolderName` as a GitHub owner/repo or fabricate a branch/commit.

### 2. Safari requires a different access path — implementation blocker

The existing backup service detects `showDirectoryPicker` and stores a handle separately (`src/lib/localBackupService.js:198`, `:229`, `:582`). Its read/write permissions and backup destination state are inappropriate for code analysis, but its capability and permission patterns are reusable with **read-only** access and separate storage.

The isolated browser probe found:

| Engine tested | Secure localhost page | `showDirectoryPicker` | Directory input + nested text read |
| --- | --- | --- | --- |
| Installed Chromium | Yes | Available | Passed |
| Installed Playwright WebKit | Yes | Unavailable | Passed |

This corroborates a progressive browser approach: Chromium directory handle plus `<input type="file" webkitdirectory multiple>` fallback. The directory input supplies relative paths including the selected root directory; strip that root exactly once. It provides selected files, not a persistent workspace watcher. [Entries API specification](https://wicg.github.io/entries-api/#html-forms).

Directory handles require a user gesture and permission checks; persisted handles do not guarantee continuing permission. Feature-detect and handle cancellation/revocation. [Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Safari's origin-private filesystem is browser-managed storage, not an alternative for selecting an arbitrary project folder. [WebKit filesystem explanation](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/).

`server.js:187` already has macOS/Windows/Linux native folder-selection code, used only for review-package destinations (`:450`). It runs on the server's computer and uses blocking `spawnSync`. Do not reuse that endpoint as a general local-source browser API. A future local companion would need asynchronous selection, explicit client-to-local-host binding, read-only root-scoped access, cancellation and path/symlink containment. A remote backend path must never be presented as the browser user's project.

### 3. Source identity and evidence must change together — high priority

Final result rows are scoped by project/repo entry, but the source index uses `code:file:${owner}/${repo}:${path}` (`generateFunctionalDecompositionFromGitHub.js:387`, `:399`, `:3140`). Hazard source audit independently reconstructs that key. Same-named local folders and different revisions must not share evidence.

Use source ID + snapshot ID + normalized relative path for local index records. Centralize key construction and source lookup; preserve fallback reads for existing GitHub records. Preserve path case. Store a content hash for analyzed files; file size and modification time are useful metadata, not reliable content identity.

`makeSourceFunction` currently generates GitHub URLs (`:215`). Local references need source ID, snapshot ID, path, symbol and line range. Present indexed local evidence in-app; offer IDE navigation only when a matching workspace is explicitly connected. No fake GitHub URLs or raw `file://` links.

Remediation currently tries the active VS Code workspace first, then the index, then GitHub (`safetyRemediationSourceContext.js:244`). Its loopback endpoint accepts paths/symbols but this caller does not bind them to the selected source identity (`:160`). Local support must not silently pull `src/control.js` from an unrelated active workspace. Bind to the selected root/revision or label a separately requested current-workspace comparison. The extension server implementation was not found in this repository, so its available capabilities remain unverified.

### 4. Mutable local files require snapshot-aware checkpoints — high priority

The generator keys checkpoints by output scope and commit/ref, and compares `path:sha:size` plus grounding version (`:1684`, `:3496`). That is not sufficient for an unhashed local folder. Include content-manifest identity and relevant analysis inputs (selection, context/policy, model/prompt/grounding version) in local resume compatibility.

Static inspection also exposes an existing resume concern: ingestion clears indexed files before loading the checkpoint (`:3359`), skips completed files (`:3542`), then classification reloads their evidence from the index (`:3140`). A local implementation must preserve or rebuild completed-file evidence; resuming rows alone is insufficient. This execution path was reviewed in source, not reproduced with a paid analysis.

Freeze a bounded source snapshot for a run, or verify the original file hashes before reuse and detect changes during reads. Never label a mixed-revision run complete. Keep old successful results available when selection is cancelled, access fails, or a new run fails. The current outer catch clears the in-memory table (`:3848`); that should not become the local-folder error path. Do not delete old durable results/index records before a replacement is ready.

### 5. Preserve streaming limits and make local coverage explicit — high priority

Current safeguards include vendor/generated-directory exclusions, a 350,000-byte planning limit, eight estimated chunks per file, sequential processing and a 45-second per-file timeout (`:456`, `:490`, `:1654`, `:2292`). Source index content is clipped to 80,000 **characters**, despite the constant's byte-oriented name (`:331`). `fullCoverage: true` currently coexists with skipped and failed-file metadata (`:3814`).

Reuse existing GitHub planning behavior; do not load a whole local folder into `Promise.all(file.text())`, JSON/localStorage, or one prompt. Enumerate metadata first, exclude dependency/build/VCS folders early where traversal allows it, honor documented ignore rules, and add explicit binary/oversize/unsupported-file reporting. Directory-input fallback enumerates before application filtering, so large dependency trees remain a performance limitation to test. Local-only secrets such as `.env` and private keys need exclusion from the selectable source set by default.

Read/hash/process with bounded concurrency and total-byte/file limits. Surface included, skipped, failed and truncated evidence counts. Persist manifests/checkpoints and only the bounded evidence needed downstream, with quota failures visible. There is a per-file abort controller, but no run-wide cancellation signal in the analyzed entry point; local traversal/reading and AI phases need consistent cancellation. Do not execute imported project code or build scripts.

### 6. Local source does not mean local AI inference

Source chunks and symbol/path context go through `${backendURL}/api/chat` (`:2227`, `:3620`). Bulk analysis currently uses the locked `gpt-4o-mini` model; the editable context generator separately reads the configured provider/model. Preserve existing AI routing in this feature. Explain in local-source mode that selected source/context is sent through the configured xHandle AI backend; choosing a folder alone should only inspect local metadata/content and must not start AI analysis. A completely offline inference mode is a separate capability.

## Proposed design and user flow

1. Keep the existing configuration entry point. Add a GitHub / Local project folder source selector. GitHub retains URL, owner, repo and token. Local shows Choose folder, selected name, eligible file count, and access status. Context text/files and file-type selection stay shared.
2. Save source descriptors separately from transient browser access. For a directory-input snapshot, save the source entry and results but show **Reselect folder to analyze** after reload. For handles, recheck read permission on Analyze and offer Reconnect. Cancel preserves the existing source and results. Rebinding another folder is explicit; equal folder names do not establish identity.
3. Extract a small shared contract such as `listFiles`, `readText`, `getRevision`, and `describeSource`. Move only source acquisition and provenance behind it. Retain `generateFunctionalDecompositionFromGitHub` as a compatibility wrapper while the same analysis core handles both providers. Route README context through the provider too.
4. Normalize local paths to root-relative `/` paths; reject traversal/absolute paths. Use fresh source IDs for new entries and portable revision metadata for results. Export/import descriptors, results and bounded evidence—not live filesystem permissions, opaque access tokens or machine-specific absolute roots. Imported local projects require reconnecting before reanalysis. Keep exported review apps read-only.
5. Carry source identity into hazard audits, remediation evidence, requirements/design traceability, cross-repo references, reports, backup and storage cleanup. Retain existing trace/node/edge IDs and output schemas, adding provenance compatibly.

Recommended scope: explicit user-triggered analysis, including unsaved-to-Git working-tree files but not unsaved editor buffers. No requirement for `.git`, a GitHub remote, write access, code execution, or continuous watching. Persistent Safari live-workspace access remains a later companion integration if desired; this does not block browser folder snapshot analysis.

## Implementation sequence and regression checks

1. Add source descriptor normalization/migration and provider contract. Test legacy GitHub configs, local save/reload, same-named roots, editing/rebinding, project package import/export and credential separation.
2. Implement browser folder adapters and modal source choice. Test Cancel, empty/unsupported folder, denied/revoked handles, fallback reselection, nested Unicode/space-containing paths, Windows path normalization, exclusions and file-type selector. Assert local mode makes zero GitHub requests.
3. Route ingestion/context through providers with a mocked AI backend. Feed identical synthetic GitHub and local content and compare grounding, allocations, stable traceability and downstream row structures. Preserve the old GitHub model/selection behavior.
4. Add snapshot/index/checkpoint persistence. Test file edits, same-size edits, deletion mid-run, interrupted/reloaded runs, changed context/selection, missing completed-file indexes, quota/write failures, and failed reruns retaining prior results.
5. Update evidence consumers together. Test local hazard source audit, source preview, missing/reconnected sources, unrelated VS Code workspace rejection, remediation, requirement/design links, exports and review mode.
6. Exercise the full UI in Chromium and WebKit, then native Safari/macOS and a Windows browser. Measure a representative large workspace for bounded reads, memory, cancellation and progress responsiveness before release.

## Validation performed and limits

- 28 existing tests passed across `generateFunctionalDecompositionFromGitHub.test.js` and `repositoryAnalysisContextAi.test.js`. They validate current grounding/table/context behavior, not a local-source implementation.
- Added and ran `scripts/diagnostics/review-local-codebase-browser.cjs`. It creates two tiny synthetic files in a temporary directory, uses isolated Chromium/WebKit pages, checks nested directory selection and reads the fixture, then removes it. Both passed. It does not load or modify xHandle user data.
- Browser automation sets a directory input programmatically. It does not validate native chooser UI, persisted handle permissions, live editing, Windows-native dialogs, or production Safari. No real user folders were inspected and no AI calls were made.
- No application feature changes, commit or push were performed during this review.

Re-run the browser probe with `XHANDLE_PLAYWRIGHT_PATH` pointing to `playwright-core` and `XHANDLE_CHROME_PATH` pointing to the installed Chrome executable. The review intentionally leaves implementation for the next task.
