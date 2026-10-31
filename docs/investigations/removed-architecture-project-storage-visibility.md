# Removed architecture project visibility

Scope: browser app at localhost:3000. Personal browser profiles, databases, backups and customer data were not accessed. The supplied screenshot was located and viewed read-only. All runtime fixtures use Playwright's isolated nonpersistent context. No desktop application, deployment or global configuration was changed.

## Demonstrated causes

The screenshot shows three sidebar projects, zero active/removed Storage rows, unrelated feature database warnings, and 1.65 GB estimated origin usage. Usage does not establish that recoverable project metadata exists.

`App.js` previously removed Code-Based Architecture projects only from React state; the `CBA_PROJECTS_KEY` persistence effect then rewrote `xhandle.codeArchitectureProjects`. There was no retained snapshot. Fresh projects created/imported through the App and subsequently edited in state persist through this registry effect, independently of graph indexing. Creation, import, repository configuration, rename and folder changes all update this active list. Functional Projects use `xhandle.projects` with the same state/registry pattern.

`classifyStoredWorkspaceProjects` previously iterated only graph rows. Active registries supplied membership tests, never inventory entries. With a fresh graph this yields zero rows despite active sidebar projects. Legacy migration populates graph project `sourceData` from these lists, but migration is optional/lazy and can therefore never be a prerequisite for removal retention. Previously indexed records could also contain older repository settings.

Storage previously performed its visibility lookup after sequential unrelated database scans. Their timeouts delayed all project rows. Lookup failure was converted into an empty list, indistinguishable from successful absence.

## Repair

Normal sidebar removal now awaits a committed IndexedDB snapshot in the existing workspace graph projects store before changing active state. The snapshot is the current complete project object, not a name/repository match or an older indexed copy. It includes repository connections, branch, extensions, contexts and other stored configuration. Failure alerts the user and leaves the active project intact. The shared helper also protects functional Projects removal; its existing analysis/recovery/review cleanup semantics remain intact. Restoring functional metadata does not promise restoration of analyses intentionally cleaned by normal functional removal.

Retention uses the existing migration mutation gate, with a bounded queue wait, and no separate retention database. A conflicting graph record from another workspace with the same ID causes safe refusal rather than overwriting it. Active inventory distinguishes workspace type and exact string-normalized IDs; it never merges by project name or repository. Active registry data wins over stale indexed data. React removal uses functional setters so unrelated concurrent additions survive the await.

Storage publishes authoritative active rows before graph lookup, quota estimation or feature database scans. It merges retained graph records without duplicate type/ID rows. Recoverability requires a snapshot with a matching project ID. A failed retained lookup preserves active counts/rows and displays an explicit retry diagnostic. Malformed active registries are reported as unavailable rather than silently interpreted as empty. Existing partial scan warnings remain visible. Inventory reads only project metadata and existing count/key-based category inspection; it does not hydrate giant analysis values.

Restore preserves the snapshot's original ID type and repository configuration. Permanent deletion continues through the existing write-quiescence/migration gate, ownership checks, progress stages, retained-row-last cleanup and verification. Its previously authorized changes and hazard restoration idle-state fix were preserved.

## Validation

Focused Jest command:

```
CI=true npm test -- --watchAll=false --runInBand --testPathPattern='retainWorkspaceProject|permanentlyDeleteStoredProject|useHazardRunRestoration'
```

50 tests passed across four suites. New regressions cover empty-graph active inventory, no-indexing retention with exact repository settings, type/ID deduplication, actual durable-put failure, and cross-workspace ID collision refusal. Existing deletion integration tests cover permanent deletion, reopened databases, unrelated records, pending writes and ownership. Existing hazard restoration tests pass.

Lint command:

```
npx eslint src/App.js src/components/SettingsModal.jsx src/components/storageWorkspaceVisibility.js src/components/retainWorkspaceProject.js src/components/retainWorkspaceProject.test.js src/features/workspace-graph/workspaceGraphRepository.ts
```

Browser regression: `node scripts/diagnostics/verify-removed-project-visibility.cjs`. The script seeds only synthetic active registries, never an already-retained graph project; exercises actual App sidebar menu deletion, Settings Storage, restore, second removal, permanent deletion, refresh and reload; and checks an unrelated survivor. It also injects durable-write failure and retained-lookup failure and checks unrelated feature scan warnings. Repository fixture comparison uses the valid normalized App registry before deletion. An initial invalid repository fixture was discarded by App normalization and was corrected before claiming restore coverage.

Final validation results:

- Browser lifecycle completed successfully: verified empty graph with two active projects; unrelated scan warnings with correct active rows; unavailable retained lookup and retry; actual sidebar write failure with visible alert and active project preserved; actual sidebar removal and exact repository restore; second removal; permanent deletion; refresh/reload with only the unrelated survivor. No graph project was seeded. The synthetic sidebar is locked open to make navigation independent of hover collapse.
- Production compilation: `NODE_OPTIONS=--max-old-space-size=8192 GENERATE_SOURCEMAP=false npm run build` passed (compiled with existing lint/Browserslist warnings). This creates a local build only; nothing was served, published or deployed from it.
- Final lint: zero errors, 16 existing warnings in App.js.
- Final focused Jest: 50/50 tests passed, four suites (rerun after the numeric-key compatibility adjustment in retention).
- Existing deletion browser regression also passed: `PLAYWRIGHT_MODULE=/tmp/xhandle-delete-browser/node_modules/playwright-core node scripts/diagnostics/verify-workspace-project-permanent-delete.cjs`. It verified cancellation, visible stage/refresh progress, retry after failure, numeric/string IDs, chunk ownership, unrelated records, shared caches, credential preservation, refresh and reload.
- Final lint of changed helpers, Settings and graph repository passed without code warnings/errors; including App reports the 16 existing warnings described above.
- `git diff --check` passed. Reviewed App lifecycle, inventory/restore changes and retained snapshot helper; preserved all pre-existing authorized edits and untracked artifacts.

Browser script debugging uncovered fixture navigation issues (a hidden duplicate heading and automatic sidebar hover collapse); these were corrected before the successful complete run. Earlier incomplete runs were not counted as lifecycle verification.

## Recovery limits

This fixes future removal and current authoritative inventory. It cannot reconstruct the user's previously removed project if its exact metadata was never retained. We did not inspect personal browser stores or backups and cannot establish whether that particular historical project is recoverable. Graph rows lacking matching snapshot metadata remain explicitly nonrecoverable; names, shared repository caches and origin usage are not proof of recoverability. Same-ID records from different workspaces cannot both occupy the legacy graph's single-ID primary key; removal safely refuses an ownership collision instead of losing either active project. Existing permanent deletion also refuses IDs still active in either registry.
