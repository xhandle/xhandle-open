# Code-Based Architecture capacity review

Date: 2026-10-05. Reviewed HEAD: `581d0792245f24959ec79f6b3f6885f6fa2a1677`, including the existing uncommitted repository-neutral analysis changes. Those changes were preserved.

Executed [the read-only review prompt](../codex-prompts/review-code-architecture-capacity-limits.md). No application code or customer storage was changed. The proposed fix is in [the implementation prompt](../codex-prompts/implement-code-architecture-scalable-capacity.md); it has **not** been executed.

## Conclusion

The reported error is an application-imposed capacity rejection, not evidence that Safari ran out of disk space. Final publication checks the entire serialized architecture against a 32 MiB ceiling after source analysis and classification. Clearing other projects cannot make a single oversized result fit that ceiling. A separate 128 MiB aggregate ceiling can also reject it, even when the browser has ample quota.

Removing or raising the constants alone is insufficient. Whole-result checkpoint rewrites, repeated file evidence, whole-store scans and duplicate history copies amplify storage and memory demand. Large repositories also encounter separate acquisition limits before analysis. Replace repository-wide admission ceilings with incremental processing/storage, while retaining bounded individual operations, actual quota handling, cancellation, source integrity and finite automatic recovery.

## Findings

### P1 — Completed analysis is rejected by artificial storage limits

- `src/features/code-architecture-context/codeAnalysisRun.js:43`: 128 MiB source budget and 32 MiB record budget; `serializedBytes` builds a JSON string and a UTF-8 byte array.
- `src/components/generateFunctionalDecompositionFromGitHub.js:3566`: both the run manifest and final architecture are checked against 32 MiB before publication.
- Generator `publishArchitectureRun` at line 119 scans the entire architecture store and applies a 128 MiB combined architecture/history/checkpoint budget.
- Generator `idbPut` at line 157 applies the 32 MiB record cap and scans the architecture store for a 128 MiB aggregate cap on checkpoint writes too. Source indexing has its own aggregate check at line 86.
- `src/features/code-architecture-assurance/codeArchitectureStorage.js:151` applies these same ceilings to portable architecture imports. Ordinary `writeCbaRowsToIndexedDB` at line 111 does not, so persistence paths enforce inconsistent policies.

Impact: a long, paid analysis can finish its AI work and still fail to publish. Unrelated projects/history can exhaust an application budget. The catch wraps the storage failure in a new generic error, losing structured failure information.

The existing publication transaction protects the prior rows/run pointer and compares against the previous rows before overwriting. Preserve those guarantees; do not turn an unsaved result into a successful run.

### P1 — Fully analyzed but unpublished work is not recoverable through the dedicated UI

- Generator `persistCheckpoint` at line 3305 records accumulated extraction rows, file progress and evidence. Classification occurs later, starting around line 3523.
- Final classified rows/run/metadata are not checkpointed as a completed publication payload before the storage failure.
- `readLatestArchitectureCheckpoint` in `codeArchitectureStorage.js:199` requires `failedFiles.length`. A run whose files all succeeded but whose final save failed is not listed.
- `ArchitectureRunRecovery.js` consequently presents only an incomplete-file recovery flow. `App.js:5232` starts source analysis again and requires a local-folder session before running a local recovery.

A compatible old checkpoint can avoid repeated file-level model extraction on retry, but source acquisition/indexing and classification still execute. Compatibility depends on inputs/settings and checkpoint version; this review did not inspect the user's Safari checkpoint. Do not promise that the exact final output from this already-failed run is recoverable: that classified output was never persisted by this implementation.

### P1 — Separate acquisition restrictions block or omit large sources

- `localCodeSource.js:6–8`: 350,000 bytes per file, 50 MiB eligible source total, 10,000 visited entries. The directory-handle path counts traversed directories as well as files; the directory-upload path counts admitted traversal candidates differently. Excluded dependency directory contents are skipped before that count.
- `localFileExclusion` marks oversized files as excluded before analysis selection. Local acquisition can therefore proceed without those files, with exclusion metadata rather than a full-repository analysis.
- `codeSourceAcquisition.js:4,63,71`: GitHub source reads reject files over 350,000 bytes. The planner also filters oversized files; the main generator rejects selected files omitted by its plan at line 3181.
- `codeSourceAcquisition.js:33`: a truncated recursive GitHub tree is refused, with advice to select a smaller scope; there is no complete subtree traversal fallback.

Impact: chunking later in the pipeline does not overcome these front-door restrictions, and local/GitHub size behavior differs. Size-based admission must be addressed across acquisition, indexing, grounding and planning together. Merely increasing chunk counts will not fix this.

### P2 — Storage and memory grow faster than the logical relationship data

- `buildCodeEvidenceForRows` at generator line 2902 retains an indexed-file cache and attaches file imports/exports/functions/source audit to each relationship. It builds snippets for all source functions in related files before selecting row functions. Selected functions are represented in both `codeEvidence` and `sourceEvidence`.
- `allTableData`, file progress and relationship ledgers accumulate in memory. Checkpoints rewrite accumulated rows/ledgers repeatedly, including section/file completions (lines 3305, 3447, 3467, 3500).
- Checkpoint/publication budget checks scan unrelated architecture records. Source-budget initialization scans all indexed sources. Full JSON comparison during publication also allocates large temporary values.
- Publication retains old row arrays as history while reconciliation can also retain historical rows in the current dataset. Both serve compatibility purposes; do not drop them without reference-aware replacement.
- `App.js:5456` writes the complete current row array from a persistence effect. Workbook export builds the workbook and calls `XLSX.write` in memory (`App.js:5119`). These paths must remain compatible with any new storage representation.

These are code-derived amplification risks, not measured customer heap profiles. No claim is made about the user's actual result size, row count, write duration, or available browser quota.

### P2 — Evidence normalization has downstream consequences

`codeArchitectureHazardUtils.js:235` reads source functions from row-level evidence and nested `codeEvidence.files`. `codeArchitectureHazardSourceAudit.js` loads indexed records, enriches rows and attaches source snippets. Review export also carries source evidence. Replacing inline evidence with references without a resolver would remove inputs from hazard analysis, remediation and portable review/export workflows.

Keep externally consumed row identities and semantics stable, or supply versioned compatibility readers/hydration for every affected consumer. The required regression surface includes all six downstream tabs, diagram links, analyst edits/reviews, local reconnect, project backup/restore, and exported projects reopened without the original source folder.

### P2 — Some limits bound model context or operations, not repository capacity

The 300-row threshold selects deterministic architecture allocation/component descriptions; it is not a 300-row result cap. Prompt summaries/evidence samples are bounded, which can limit descriptive context, but these slices should not automatically be described as discarded published rows. Source inventory itself is explicitly Python syntax based; other languages remain model extraction with unverified call completeness. Removing capacity limits does not make semantic analysis exhaustive.

## Limit inventory

Paths below are relative to `src/` unless specified.

| Limit | Enforcement / behavior | Recommended treatment |
| --- | --- | --- |
| 32 MiB serialized record/result | `codeAnalysisRun.js:44`; generator checkpoint/final save; portable import | Replace monolithic records with scalable persistence; no logical result ceiling at this value. |
| 128 MiB source index | Generator `sourceStorageBudget` | Remove global fixed admission ceiling; incremental accounting and actual quota recovery. |
| 128 MiB architecture/history/checkpoints | Generator publication/checkpoint and storage import | Avoid whole-store scans; account staged/retained data without rejecting arbitrary aggregate size. |
| 350,000 bytes per source file | Local exclusion/read, GitHub reads, planner | Stream/partition eligible sources; never silently omit a size-exceeding source. |
| 350,000 characters of indexed content | Generator `buildSourceFileIndexRecord` around line 408 uses `slice` | Coordinate with the byte-limit removal; retain complete source/evidence ranges, including UTF-8 and end-of-file calls. |
| 50 MiB eligible local source | `localCodeSource.js:108` | Replace repository-total admission cap with bounded acquisition work. |
| 10,000 visited local entries | `localCodeSource.js:103,118` | Incremental, cancellable traversal; no arbitrary file-count cutoff. |
| Truncated GitHub recursive tree | `codeSourceAcquisition.js:33` | Traverse pinned subtrees completely; retain explicit incomplete/error state if access fails. |
| File/run/per-file chunk plan options | Generator `planFunctionalAnalysisFiles`, line 1522 | Defaults are zero (no optional count cap); distinguish user scope from execution batches. Main run forwards optional file/run settings, not a default 80-file limit. |
| 80 files per reported batch | Generator constant line 511 and planner | Batch-count calculation, not a file admission ceiling. Use bounded scheduling without dropping later batches. |
| 12,000 / 6,000 characters per primary chunk | Generator chunking functions around lines 887–925 | Keep per-request bounds and full source coverage/overlap correctness. |
| 4,096 initial / 8,192 recovery output tokens | `functionalAnalysisPolicy.js` | Provider-aware finite bounds and automatic section splitting; never truncate accepted results silently. |
| 120 s request timeout; 3 attempts; max split depth 5; minimum section 256 chars; 128 requests per section state; 3 file passes | `functionalAnalysisPolicy.js`, `functionalAnalysisResponse.js:105` | Keep finite recovery/cost safeguards; persist progress and explain terminal failures. Do not create infinite retries to claim completion. |
| 300 rows for optional AI allocation/descriptions | Generator lines 2609 and 2803 | Keep deterministic full-row fallback unless separately validated batching replaces it. |
| Prompt context/evidence summaries | E.g. README 18,000 chars; sampled file/function/relationship lists | Preserve complete canonical evidence separately; document model context limitations and batch where needed. |
| Recovery preview 50 rows | `codeArchitectureStorage.js:204` | Keep as presentation pagination, independent of saved/exported row count. |
| 100 MB server JSON body | `server.js:150` | Request bound, not repository capacity; send bounded requests, not whole repositories. |
| Actual browser quota, memory and provider/API limits | Environment-dependent | Cannot be abolished. Treat estimates as advisory and handle real failures without data loss or false success. |

## Validation performed

1. Executed the current `serializedBytes` / `assertStorageBudget` declarations in an isolated Node VM with synthetic data. Exactly 33,554,432 bytes was accepted; one byte above was rejected. A synthetic serialized result of 34,603,058 bytes reproduced `SOURCE_STORAGE_FAILED` and the exact reported architecture/history message. No IndexedDB or browser data was accessed by this probe.
2. Ran:

```sh
CI=true npm test -- --watchAll=false --runInBand src/features/code-architecture-context/localCodeSource.test.js src/features/code-architecture-context/codeSourceAcquisition.test.js src/features/code-architecture-context/functionalAnalysisResponse.test.js src/features/code-architecture-assurance/ArchitectureRunRecovery.test.js src/components/generateFunctionalDecompositionFromGitHub.test.js
```

Result: **5 suites, 65 tests passed**. Current tests explicitly expect oversized local sources/projects, oversized planner files and truncated GitHub inventories to be rejected. Those assertions must be replaced with scalable coverage tests where policy changes are intended; retain their integrity and secret-exclusion coverage.
3. Inspected atomic publication, recovery selection, evidence consumers, App persistence and workbook materialization. No live provider calls, large customer-run benchmark, Safari quota test or end-to-end storage migration was performed. No application fix has been made.

## Recommended implementation order

1. Correct artificial save rejection and completed-result recovery, preserving atomic publication and prior results.
2. Introduce incremental persistence/evidence storage with tested legacy compatibility, including every save/import/backup path.
3. Remove acquisition-wide capacity ceilings using bounded processing, complete GitHub traversal and complete large-file evidence.
4. Exercise large synthetic local/GitHub runs, actual storage transaction failures and all affected downstream workflows. Publish measured capacities and remaining environmental limitations; do not market the result as unlimited or exhaustive semantic analysis.

Earlier convergence instructions explicitly retained byte/count caps. The user's current request supersedes those capacity restrictions. It does not supersede source integrity, exclusion policies, project isolation, downstream compatibility or protection of existing data.
