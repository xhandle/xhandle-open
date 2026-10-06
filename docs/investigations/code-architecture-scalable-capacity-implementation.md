# Code-Based Architecture capacity implementation

Date: 2026-10-05

Implemented from `docs/codex-prompts/implement-code-architecture-scalable-capacity.md`. Existing uncommitted repository-neutral analysis changes were preserved. No commit, push, customer-data cleanup, live repository analysis, or paid provider request was performed.

## Root cause and changes

The final save rejected logical results above 32 MiB and combined architecture/history above 128 MiB. Repeated inline source evidence increased the logical size of rows. This could fail after extraction and classification had already completed. Completed-extraction checkpoints with no failed files were also omitted from recovery discovery.

The application-level result/storage admission caps are removed. New writes use content-addressed JSON tree pages rather than a single serialized result. The local adapters no longer refuse inventories above 10,000 entries or 50 MiB, and local/GitHub acquisition and the planner no longer exclude eligible files over 350,000 bytes. Source indexing retains the full text. Truncated GitHub recursive trees fall back to traversal of subtrees pinned to the selected revision. Secret, binary, vendor, path, source-integrity, selection, cancellation and finite provider/request protections remain in place.

## Storage contract and consumers

`chunkedRecord.js` implements `xhandle-json-tree-v1`. The existing root key stores a small format/root reference. Immutable parts live in the same object store under `<owning-key>:$part:<sha256>`. Tree pages contain at most 64 children; long strings use 32,768-code-unit segments. Writes flush in batches of at most 64 parts. Existing parts are reused; only new content is written. The database remains `xhandle`, version 4, without a destructive schema migration.

| Producer/consumer | Integration |
| --- | --- |
| Generator, source index, extraction checkpoints | Shared chunk writer/reader; full evidence remains available |
| App row autosave, edits, reviews | Existing public storage API now writes manifests with a concurrent revision check |
| Completed run publication | Stages rows/run, then atomically publishes rows, run pointers, completion metadata, history reference and checkpoint deletion |
| Architecture diagrams, tables, navigation, search | Receive the same hydrated row arrays and IDs; storage parts are not exposed as rows |
| Hazard & Remediation source auditing | Indexed source hydrates through the shared reader; source scans skip internal part records |
| Requirements, design and traceability | Existing row/evidence contract retained; no regeneration or migration of downstream results |
| Workspace graph migration | Cursor reads skip internal parts and hydrate architecture/source roots |
| Project JSON import/export and portable review | Public arrays, evidence and run records remain portable; imports stage new parts; export reads durable completion metadata |
| Workbook export | Existing columns retained; oversized sheets split before the XLSX row ceiling |
| Raw backup/restore | Existing same-store backup includes manifests and parts together |
| Permanent project deletion | Existing owning-key prefix rules include parts; shared source-index retention follows existing policy |

Readers still accept legacy monolithic arrays, source objects and checkpoints. New-format reads recreate independent mutable objects so deduplicated equal evidence cannot cause an edit to one row to mutate another. No public evidence field is replaced by an unresolved storage ID. Parts are scoped to the owning record, not shared across project boundaries.

## Publication and recovery

Acquisition progress is reported during scanning/fetching. Durable checkpoints record extraction and classification-entry progress. A completed classified result gets a `ready-to-publish` record referencing its exact rows, run, metadata and expected prior revision. Successful publication removes that checkpoint and commits the run and completion metadata together. A failure retains the old active result and checkpoint.

Chunk transactions and publication retry transient aborts within finite bounds. Quota errors and concurrent edits do not cause an infinite retry or overwrite. A ready result has a save-only recovery path: it does not reconnect a local folder, require source credentials, call a provider, or rerun classification. If quota prevented staging, completed rows remain available in session for export/retry and are explicitly labeled nondurable. Refreshing in that case can lose the unsaved portion.

Older completed-extraction checkpoints are now discoverable even when `failedFiles` is empty. Their existing compatibility/fingerprint validation still applies. Classification must run again if the old implementation never saved its output. The customer's previously failed run was not inspected or recovered as part of testing.

To recover: reload the updated app, open the affected Code-Based Architecture project and use its recovery panel. **Retry save** means classified output is available and no new AI work is needed. **Retry incomplete analysis** reuses compatible extraction and runs remaining phases; reconnect the original local folder if that earlier phase requires it. Export any checkpoint labeled available only in memory before refreshing.

## Validation

Focused regression command:

```sh
CI=true npm test -- --watchAll=false --runInBand src/components/generateFunctionalDecompositionFromGitHub.test.js src/features/code-architecture-context src/features/code-architecture-assurance src/features/code-architecture-hazard-analysis src/features/code-architecture-review src/features/safety-remediation src/features/workspace-graph src/components/codeArchitectureNavigation.test.js src/components/permanentlyDeleteStoredProject.test.js
```

Result: **34 suites, 247 tests passed**. Includes acquisition/planner, large eligible files, both local inventory adapters, Unicode boundaries, recovery UI, hazard evidence, remediation, review, workspace graph, navigation and deletion regressions. These are not a full manual browser walkthrough of generation/edit/reopen in every downstream tab.

`node scripts/diagnostics/verify-cba-capacity.cjs` passed in a fresh isolated Chromium context using actual IndexedDB. It verifies large logical results, portable hydration/import, legacy reads, independent mutable row evidence, completed-extraction discovery, actual publication-transaction rollback after partial puts, concurrent-edit protection, injected quota failure with memory recovery, and durable save-only recovery after page reload. The fixture has no provider functions or network access, so save-only recovery cannot invoke AI. Quota was injected using a real `QuotaExceededError` DOMException; the test did not fill the machine's physical disk.

Recorded synthetic measurements (staging, publication, recovery discovery and reload reads included):

| Rows | Logical JSON bytes | Elapsed ms | New row chunks | Approx. new row-part bytes |
| --- | ---: | ---: | ---: | ---: |
| 50 | 8,713,181 | 75 | 63 | 271,040 |
| 150 | 26,139,681 | 186 | 104 | 102,028 |
| 300 | 52,279,581 | 389 | 154 | 143,000 |

The same run succeeded with 136,314,880 bytes of unrelated raw record payload present, as well as separately scoped architecture copies. Byte counters above count newly written UTF-16 JSON part text, not filesystem allocation or total run writes. This fixture deliberately repeats source evidence; the compression ratio and timings are not predictions for unique customer data. Peak heap and Safari performance were not measured. Traversal/staging yield cooperatively; no claim of constant total memory is made.

`CI=false npm run build` passed with existing warnings. Targeted ESLint completed with **0 errors and 15 warnings** in existing App/generator code. `git diff --check` passed.

## Practical limits and remaining engineering work

- Browser quota, available memory, filesystem permissions and provider limits still apply. No total repository size is guaranteed.
- Storage writes are bounded and unchanged parts are reused, but public reads, recovery previews, JSON/workbook exports and several downstream consumers still materialize the full logical row array. Acquisition reads one complete file at a time. Very large individual files or logical results can therefore exceed browser memory. Streaming file parsing/export and paginated consumer hydration are additional work; this change is not an end-to-end constant-memory implementation.
- Checkpoint serialization still traverses the supplied object tree to compute content hashes, even when few chunks change. Incremental disk writes do not imply constant CPU cost.
- Staged/orphan parts are retained until scoped cleanup. They are not automatically garbage-collected because history and concurrent stages may reference them. Total retained storage can grow over time; no user history is deleted automatically.
- Acquisition itself is rescanned on restart; the durable phase recovery starts with saved source/extraction checkpoints. A crash before the first checkpoint does not resume an exact traversal position.
- Legacy comparison paths can serialize the prior monolithic value. New-format publication uses root revisions. An older application build that does not understand manifests should not be used to edit this database.
- Raw backups must include all records in the affected stores, not just root keys. Workbook export still depends on XLSX/browser memory limits even though its row ceiling is handled.
- Real Safari/WebKit interaction, full downstream UI workflows and the customer's actual failed browser run remain unverified. Existing automated downstream contract tests passed; this is not a claim that every workflow was exercised live.

The reported artificial storage failure and acquisition-wide count/byte ceilings are addressed. The broader prompt's end-to-end bounded-memory and exhaustive cross-browser/downstream validation goals are only partially satisfied by this implementation; the limitations above remain explicit.
