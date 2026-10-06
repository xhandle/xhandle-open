# Implement scalable Code-Based Architecture capacity and durable completion

## Objective

Read [the capacity review](../investigations/code-architecture-capacity-limits-review.md), then revalidate it against the current working tree. Fix the reported end-of-run error:

> Architecture and history storage budget exceeded. Export/clean up storage before retrying; previous results were preserved.

Users must be able to analyze large eligible codebases through both local-folder and GitHub acquisition without arbitrary whole-repository file-count, byte, result-row or chunk ceilings. Large logical datasets must be processed in bounded units. Complete successful analysis must be published durably and appear in the UI; recoverable transient failures should be handled automatically during the run. Work already generated must not require new AI calls solely because saving failed.

This prompt authorizes implementation **when invoked**. Its creation is not execution. Do not stop after raising constants or proposing a future storage redesign. Complete the storage, acquisition, recovery and compatibility work below and report empirical results honestly. Real disk/quota, browser-memory, access and provider limits remain finite; do not promise that every possible repository or provider failure can complete automatically.

## Baseline and constraints

- Inspect repository instructions and git status first. Preserve the current uncommitted repository-neutral analysis work and all unrelated changes. Do not commit/push unless requested.
- This task supersedes previous instructions to keep the 32/128 MiB storage caps, 50 MiB local aggregate cap, 10,000-entry cap and 350,000-byte file admission cap. It does not remove secret/binary/generated/vendor protections, source selection, readonly local access, path validation, symlink boundaries, immutable GitHub commits, snapshot verification, cancellation, finite retry limits, or request token/time bounds.
- Do not change functional-decomposition call eligibility, introduce repository/domain-specific rules, add speculative calls, prune legitimate relationships to fit a budget, or claim new language/parser completeness. Preserve current coverage limitations and disposition accounting.
- Preserve saved IDs, row references, hierarchy membership, layouts, descriptions, analyst edits/overrides, review status, hazard results, requirements/design artifacts and traceability. Do not regenerate downstream content automatically as a migration side effect.
- Use synthetic sources, mocked provider/GitHub responses and isolated browser storage for validation. Do not upload customer source, make paid AI requests, clear customer databases, or access credentials to test this work. Do not add a mandatory external service, change deployment requirements, or perform blanket dependency upgrades.

## 1. Design the storage contract before editing consumers

Trace every architecture read/write path, not just the generator: `codeArchitectureStorage.js`, App autosave/manual edits/reviews, run manifests, checkpoints, source index, import/export, portable review, backups, restore and permanent deletion. Document a short producer/consumer map and the chosen versioned storage contract in the implementation report.

Use an incremental representation for large runs: immutable source/evidence records, bounded row/ledger/checkpoint batches and a small manifest/publication pointer, or an equivalently demonstrated design. Keep public row semantics compatible through a shared reader/resolver. Do not replace inline evidence with unresolved IDs. Reuse immutable evidence within the appropriate project/source/snapshot boundary; never share mutable decisions or leak data across projects.

Provide backward readers for existing monolithic rows and checkpoints. Avoid an eager destructive migration. New format writes must not be overwritten by legacy autosaves. Update every actual writer/reader/backup/export path in the same change. Retain original usable records until migration/publication is durable. Define ownership/reference accounting so cleanup cannot remove evidence needed by any active/history/review/export artifact.

## 2. Fix persistence and atomic publication

- Eliminate the fixed logical 32 MiB record/result and 128 MiB aggregate admission checks across publication, source indexing, checkpoints and imports. Do not substitute another arbitrary total ceiling or set every limit to infinity.
- Bound individual storage writes and memory allocations. Avoid serializing or scanning all projects to save one project's checkpoint. Persist only new/changed batches; keep logical byte/accounting metadata incrementally. Avoid duplicating complete file metadata/source snippets in every relationship and rewriting all accumulated history on each section completion.
- Preserve complete evidence and downstream access while normalizing storage. Bound file/evidence caches, unnecessary array/string clones and UI-triggered full rewrites. Account for active, staged, history and export peak storage; avoid requiring several full copies of a run to exist only to commit it.
- Publish rows, run/evidence references and completion metadata coherently. If batches are staged in multiple transactions, validate completeness first and atomically switch the active manifest/pointer. Incomplete staged data must never be presented to downstream consumers as a completed run. Old readers must not mistake a manifest for rows or display an empty result.
- Preserve concurrent-edit detection and previous results on abort, quota, database errors or a racing tab/autosave. Prefer revision/generation checks over repeated whole-result JSON comparisons. Verify both rows and active run pointer remain consistent on failures.
- Treat `navigator.storage.estimate()` as advisory; estimates are not an admission guarantee. Handle real `QuotaExceededError`, database-unavailable, transaction-abort and blocked-upgrade states distinctly. Optional persistent-storage support must not be required for correctness or hang Safari. Never delete user projects/history automatically to make a save succeed.

## 3. Persist completed work and recover the publication phase

Represent and persist run phases explicitly: acquisition, extraction, classification, ready-to-publish, published, and actionable paused/failed states. A ready-to-publish run needs the exact classified rows, evidence/run references, non-secret completion metadata and concurrency baseline needed to save it again without extraction/classification.

- Persist completed batches as they are produced so a final save failure is not the first opportunity to retain them. Keep staged progress on failure; do not clear the last valid checkpoint before publication commits.
- Automatically retry genuinely transient persistence failures within finite bounds using staged results. Do not loop forever on quota, permissions, conflicting edits or corrupt data.
- Surface unpublished progress even when `failedFiles` is empty. For ready-to-publish runs, expose retry-save/export/recovery without requiring GitHub credentials, a connected local folder, or a new provider request. Do not run the entire generator from a save-retry button.
- Report whether completed data is durable, available only in memory, or incomplete. If real quota prevents durable staging, preserve whatever was saved and provide an in-session export path for unsaved completed work where possible. Never label a nondurable result saved or claim it will survive refresh.
- Retain structured error codes, run/scope/checkpoint references and phase through the generator and App. Storage errors must not reopen repository configuration as though source credentials failed. Clear loading and update the correct project even if the user changes views during completion.
- Recognize older completed-extraction checkpoints with no failed files, including the reported case. Reuse compatible saved extraction with integrity/settings checks; run only missing phases. Explain when final classification was never saved and must be regenerated. Do not invalidate every old checkpoint merely because storage representation changed, and do not accept semantically incompatible checkpoints to avoid work.
- A completed-result retry saves the already-recorded run/settings; it must not relabel results with current provider settings or overwrite newer analyst edits.

## 4. Remove repository-size exclusions through bounded acquisition and analysis

- Replace local 10,000-entry and 50 MiB aggregate refusal with incremental traversal/ingestion. Support both directory handles and directory-upload fallback, cancellation and reconnect. Retain only necessary file metadata, bounded source buffers and caches; avoid retaining repository-wide source text.
- Handle eligible files larger than 350,000 bytes for both adapters. Coordinate changes across local exclusion/read logic, GitHub reads, planner, `buildSourceFileIndexRecord` clipping, syntax inventories, hashing, grounding, snippets and model chunking. Preserve complete byte/text integrity, Unicode boundaries, line ranges and relationships at the end of large files. Do not solve admission by silently analyzing only the prefix or suffix.
- Enumerate truncated GitHub recursive trees by traversing subtrees pinned to the same immutable revision, with bounded concurrency, retries and cancellation. Preserve paths, modes, symlinks/submodule policy and explicit inaccessible entries. Never follow a moving branch to complete missing inventory.
- Keep explicit user scope/extension selection separate from execution budgets. Batches must continue until all eligible selected work is processed. Do not call an execution cap a user selection, omit later batches, or claim complete analysis of excluded/unreadable sources.
- Retain per-request model context/output bounds, finite retries, backoff and automatic subdivision. Persist section progress so recoverable truncation does not require manual resubmission. If a section cannot be processed under real resource/provider constraints, expose exact remaining work and preserve completed data; do not invent empty success or bypass validation.
- Preserve deterministic hierarchy/descriptions fallback for large row counts unless an alternative is tested. UI preview limits may remain if full data is still persisted, analyzed and exportable. Audit sampled prompt evidence separately from canonical evidence completeness.
- Update coverage and progress to distinguish total inventory, selected scope, policy exclusions, completed source sections, reviewed/published calls, failed work and save status. Larger capacity must not imply exhaustive runtime/semantic call analysis.

## 5. Complete downstream compatibility in this implementation

For each consumer, record whether the public contract stays unchanged or requires an adapter. Inspect actual reads of `codeEvidence`, `sourceEvidence`, `sourceAudit`, indexed source, trace IDs, row arrays and run manifests. Test evidence hydration as well as row counts. Cover:

1. Architecture diagram/table, CSU views, table-to-diagram navigation, quick search, saved layouts, analyst edits and review/undo.
2. Hazard & Remediation: correct current rows, complete required evidence access, eligibility, generation, edits, reopen and remediation references.
3. Software Requirements, System Requirements, Subsystem Requirements: generation, edits, save/reopen and source/hazard links.
4. System / Subsystem Design and Traceability Matrix: generation, reference resolution, navigation and persistence.
5. Project/workspace JSON and workbook export/import, portable review, backup/restore, storage reporting and permanent deletion. Reopening a portable artifact must not require the original local folder or silently lose evidence. Preserve existing workbook schemas; if a format's genuine capacity is exceeded, offer a complete supported export instead of silent truncation.

Bound large read/export/UI work with pagination, lazy evidence loading or equivalent where it matters. Necessary consumer adaptations belong in this task; do not leave a schema change for downstream users to discover. Do not redesign unrelated workflows or change analysis mechanics merely to simplify storage.

## 6. Required verification

Add meaningful regression tests and record commands/results. Include:

- A logical result over 32 MiB and multiple projects/history totaling over 128 MiB. Save, reload, edit and portable round-trip successfully in isolated real IndexedDB with sufficient quota. Demonstrate that another project's data cannot exhaust an arbitrary app budget.
- Both local adapters over 10,000 eligible entries and 50 MiB eligible source; local/GitHub files over 350,000 bytes, including Unicode and calls near EOF and section boundaries. All selected content is accounted for without duplicate/lost relationships.
- Truncated recursive GitHub response followed by complete pinned subtree acquisition; retries, denied subtree access, cancellation and source mismatch.
- Synthetic transient model truncation/network and storage failures that recover automatically without repeating successful sections or classification. Assert provider-call counts during save-only recovery are zero, including reload when a complete durable stage exists.
- Failure injection between batch writes and pointer switch, real transaction abort behavior, quota, interrupted/reopened tabs, concurrent analyst edits and project switching. Prior rows and run references remain intact; stage/recovery remains usable; success is emitted only after durable commit.
- Legacy row arrays/checkpoints and newer manifests coexist. Old unsaved completed-extraction checkpoints are discoverable. Settings/source mismatches cannot be resumed as verified compatible runs.
- All six downstream areas above work against new, reopened, legacy and imported data, including absence of the original folder. No loss of existing IDs, overrides, traceability or navigation targets.
- Secret/binary/generated/path protections still hold. Scope expansion is only the requested removal of capacity exclusions, not permission to ingest previously protected content.
- Scale the same synthetic workload across several sizes and record wall time, persistence time, peak memory where measurable, bytes written and responsiveness/cancellation observations. Show incremental checkpoint/write behavior; avoid small tests with merely larger constants. Keep expensive benchmark fixtures generated and out of version control.
- Run focused existing acquisition/planner/recovery/source/hazard/assurance/review/navigation tests, appropriate new tests, lint and build checks. Existing assertions that require the old capacity refusals must change; integrity/rollback/exclusion assertions must remain.

Use actual browser transaction tests for atomicity; a mock that writes immediately without rollback cannot substantiate it. Exercise Safari-compatible behavior where available and Chromium; state any browser not tested. No live customer analysis or paid API calls are necessary for these checks.

## Completion report

Document root causes, changed contracts, migration/recovery behavior, test evidence, measured capacity and remaining environmental/format/provider limits in `docs/investigations/code-architecture-scalable-capacity-implementation.md`. Give the user precise steps to recover the already-failed run, distinguishing saved extraction from any unavailable final classification. Do not claim the customer's actual browser results were recovered without verifying that separately.

The task is complete only when the reported artificial save limit and the identified acquisition-wide capacity ceilings are resolved with durable recovery and downstream compatibility. If a required part remains blocked, state it explicitly; do not present a constants-only patch as the completed solution.
