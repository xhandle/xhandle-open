# Local project folder analysis implementation

Implemented the prompt in `docs/codex-prompts/implement-local-codebase-analysis.md`.

## Use

1. Select a Code-Based Architecture project and open **… → GitHub config**.
2. Change **Source** to **Local project folder**, then choose the project folder.
3. Optionally enter analysis context or generate it from the local README and structure.
4. Use **Verify & save**, or **Analyze** and select the file extensions to include.
5. After reload, use **Reconnect folder** if prompted. Saved analysis remains available without folder access. Choose the same folder to reconnect; **Choose different folder** creates a separate source identity.

Source selection reads files only. It does not execute project code, require Git, upload to GitHub, or modify the folder. Generating context and analyzing send source excerpts to the existing configured AI backend.

## Implementation

- Browser directory handles where supported; directory-file-input fallback elsewhere. Handles are kept in a separate, non-exported IndexedDB database. Portable project descriptors contain source type, opaque folder identity, display name, and content snapshot hash.
- One file at a time is read and hashed. The shared functional-decomposition pipeline continues to provide extension selection, context, chunking, deterministic grounding, allocation, trace IDs, review items, and IndexedDB results.
- Local index keys include folder and snapshot identity. Checkpoints additionally include the analysis context/prompt/model signature and file plan. Completed checkpoint files are reindexed on resume. Changing source content creates a different checkpoint namespace.
- Local analysis failures do not publish partial rows or clear the previous results. Successful local runs publish only after results are persisted. Source storage connections close after each transaction. Concurrent analysis starts are ignored while a run is active.
- Hazard source audit and remediation use captured local evidence. Local references do not fall back to GitHub or an unrelated active VS Code workspace. Source-function entries offer expandable, read-only saved excerpts.
- Project JSON export/import retains local identity and evidence, without credentials or folder handles. Workspace source artifacts distinguish both folders and snapshots; Collaborator file grounding checks the active local snapshot.

## Limits

- The directory-input fallback is a selected snapshot, not a continuously watched IDE workspace; reselect after reload or disk edits. Native handles can be reused only while browser permission remains granted. No automatic file watcher or filesystem write/apply-patch access is added.
- Common dependency/generated directories, credential filenames, unsupported/binary files, and files over 350,000 bytes are excluded. This is a built-in exclusion policy, not a complete `.gitignore` interpreter or secret scanner.
- Eligible file bytes are limited to 50 MiB and traversal to 10,000 non-excluded entries. Browser folder enumeration itself is browser-managed. Existing pipeline chunking/planning and evidence-excerpt limits still apply.
- Existing snapshots are retained so previous analysis evidence remains referencable. Browser storage availability still determines whether a run can be saved.

## Verification

- 49 focused tests pass: local paths/exclusions/size bounds/cancellation, native-handle reading, folder and snapshot isolation, changed content detection, failed reconnect preservation, local context generation, source audit/remediation isolation, workspace source migration, and existing GitHub/table behavior.
- Isolated Chromium and WebKit app tests use synthetic source files and mocked AI. Verified folder selection, analysis, persisted rows/source references, reload/reconnect, failed-rerun preservation, JSON export/import, zero GitHub requests, and exclusion of a synthetic `.env` secret. No application runtime errors occurred.
- ESLint on changed application modules: zero errors; existing warnings remain. `git diff --check` passes.
- Native operating-system chooser/permission dialogs were not automated; directory-handle ingestion is unit-tested, and the directory-input workflow is tested in both browser engines. No real AI requests or user project-folder writes were performed.
