# Completed hazard CSV import showing a blank draft

Date: November 3, 2026. Investigation only; no production implementation changes.
Prompt: [investigate-hazard-csv-roundtrip.md](../codex-prompts/investigate-hazard-csv-roundtrip.md).

## Conclusion

The supplied file contains completed values and is structurally valid. The large-file import implementation has confirmed memory, size-limit and processing-cost defects that can prevent a completed import. The visible draft does not establish that an import committed and then lost its values.

A small subset of the actual file successfully passed the real import planner, merge code, App import handler, IndexedDB persistence and publication checks. Selecting a file alone deliberately does not save it: a separate **Apply CSV import** step is required. The historical sequence of file selection, confirmation, refresh and any failure in the user's session cannot be reconstructed from the available logs. Do not assert that the user omitted confirmation, or that the particular desktop attempt definitely ran out of memory.

## File and live-view evidence

- Supplied CSV: 160,913,412 bytes (approximately 153.5 MiB), 27,125 data rows, 76 columns on every row, no duplicate Raw Analysis Row IDs. Python's streaming CSV reader parsed the entire file successfully.
- The file supplies applicability, hazard, causal scenario, safety constraint and system requirement values for RAW-08ZC3BD. The open preview showed that same row with those analysis cells blank and the draft banner visible.
- A read-only inspection found no newly committed hazard-run metadata for the displayed import; the metadata present belonged to earlier saved runs. This supports **not committed/attached**, rather than demonstrating a completed durable import followed by data loss.
- Preliminary safety decisions such as Needs Review and Not established are separate from whether imported text is present. They are not a reason to discard the imported text.
- The local preview diagnostic journal did not provide an import-correlated fatal event. A different software-derivation fallback error was present; it is not evidence of a CSV import crash.

## Confirmed findings

### 1. Full-file parsing can exhaust memory before matching or saving

`CodeArchitectureHazardPanel.js:136` reads the entire file with `file.text()`, then `hazardAnalysisCsv.js` passes it to `parseCsv`. `src/lib/csv.js:12` parses synchronously and constructs strings character by character while retaining the complete grid. The planner then allocates cell changes, and applying the plan adds another table representation.

An isolated Node process ran the **actual parser against the complete supplied file**, with a 1,536 MiB V8 heap limit. It exhausted that heap during parsing, before reaching row matching or saving. The process terminated with `FATAL ERROR: ... JavaScript heap out of memory`. The last completed phase was reading the file (approximately 332 MiB heap, including harness/module overhead and the decoded input string).

This reproduces a real memory failure in the parser under a defined limit. It is **not** a measurement of Electron's default heap limit, an Electron-native crash reproduction, or proof that this was the user's exact failure. A fatal renderer OOM cannot reliably be caught by the component's ordinary import-error handler.

Evidence: `/private/tmp/investigate-hazard-csv.cjs`, `/private/tmp/hazard-csv-investigation.log`. The process ran outside the live preview and changed no workspace data.

### 2. Large saved analyses can be exported but cannot be reimported through the paged path

`PagedHazardPanel.js:105` materializes the **entire current Summary** before parsing the selected CSV. It rejects the operation once estimated in-memory row data exceeds 32 MiB, with:

> This CSV edit exceeds the safe in-memory editing size. Existing results were not changed.

Export uses a streaming disk sink and has no equivalent 32 MiB table limit. Consequently, exporting successfully does not guarantee that the same analysis can be reimported. Even editing a small subset of a large saved analysis still requires loading its complete baseline before planning.

The supplied raw rows represent approximately 306.9 MiB under the same JSON-string/UTF-16 byte-estimation convention, crossing 32 MiB around row 2,887. That estimate uses the CSV's raw rows; actual normalized saved-row accounting can differ. The scale mismatch is clear.

This limit applies to **existing paged saved runs**. The user's observed `latestRun === null` draft branch bypasses this specific limit, so it should not be presented as the direct cause of that observed state.

### 3. Applying an import rebuilds preprocessing with quadratic row scans

`App.js:14705` loops through imported rows. For each row, `App.js:14707` creates `oldSummary.slice(1)` and searches it with `.find`, repeatedly locating the ID column inside that search. This is synchronous main-thread work before saving begins.

A test executed the exact handler extracted from App.js, instrumenting only the source-ID accesses and substituting the persistence call for the scaling case:

| Imported rows | Source-ID reads |
| ---: | ---: |
| 1,000 | 502,500 |
| 1,500 | 1,128,750 |

Increasing input by 50% increased identity reads approximately 125%. At 27,125 rows, the same search shape implies roughly 368 million ID reads, plus repeated temporary arrays, per-cell comparisons and preprocessing allocations. That extrapolation is not a measured full-file apply time. It explains why an otherwise valid import can stall substantially after confirmation.

### 4. Pending imports are invalidated by object identity rather than an authoritative content revision

`CodeArchitectureHazardPanel.js:153` rejects a pending plan when `pendingImport.view !== summarySheet` or the run object changes. A reproduction replaced a draft with a freshly allocated but semantically identical Summary after file validation. Clicking Apply then rejected the import before saving, displaying “The analysis changed.”

Rejecting genuinely changed data is correct. Rejecting an identical replacement is unnecessary and makes refresh/repreparation fragile. This test confirms the behavior, but does not establish that such a replacement occurred during the user's attempt.

### 5. Draft wording and two-step confirmation obscure import state

The banner at `CodeArchitectureHazardPanel.js:445` checks only that there are rows and no attached saved run. It does not inspect CSV completeness, indicate whether an import was applied, or name the last import failure.

The panel has a distinct validation/preview stage and an Apply stage. A test confirmed that selection alone leaves cells blank and calls no save callback; applying and publishing the updated run displays the completed cells and removes the draft banner. The historical session had no preserved per-import status sufficient to determine which stage completed.

## Reproductions and checks

Five observational tests passed in `/private/tmp/xhandle-csv-investigation/roundtrip.test.jsx`:

1. The real App import handler preserves and persists completed values from a three-row subset of the supplied CSV when importing into a draft.
2. The same handler preserves and persists them when importing into an existing saved run.
3. The actual panel requires Apply; after application/publication, its displayed Summary contains the imported hazard text.
4. An identical but newly allocated draft invalidates a pending import before saving.
5. Actual preprocessing code exhibits quadratic source-ID access growth.

The test extracts the handler unchanged from App.js and injects its lexical dependencies. Storage checks use the actual hazard store with fake IndexedDB. Panel checks mock the complex table to inspect the Summary provided to it; they are not a full-app Electron UI replay. The scaling check mocks storage to isolate preprocessing cost. These limitations matter when interpreting the results.

Another **78 existing tests passed across four suites**: hazardAnalysisCsv, codeArchitectureHazardCsv, CodeArchitectureHazardPanel and useHazardRunRestoration. Total: **83 passing tests**, plus the deliberately failing memory-limited full-file parser reproduction. Logs: `/private/tmp/hazard-csv-roundtrip-tests.log` and `/private/tmp/hazard-csv-existing-tests.log`.

An initial temporary test setup failed because lucide-react's ESM entry needed the same icon mock used by existing panel tests; the corrected fixture passed. No application defect is inferred from that harness failure.

## Recommended implementation

1. Stream CSV parsing in bounded batches off the UI thread, with byte/row progress and cancellation. Do not retain the entire input text, parsed grid, changes and merged baseline together.
2. Match against indexed stable row IDs and stage changes durably; preserve partial-file semantics, contextual disambiguation, governed-decision conflict reporting and undo. Validate the complete import before atomically publishing it. Do not simply remove the 32 MiB guard or raise heap limits while retaining the current full-table algorithm.
3. Replace the App handler's repeated slice/find with one reusable baseline ID index and process preprocessing updates in bounded batches.
4. Use scope/content/storage revisions to guard application, allowing harmless refreshes while still rejecting actual edits or project changes.
5. Present explicit states for reading, validating, awaiting confirmation, saving, completed and failed; distinguish “draft not yet imported” from unresolved engineering classifications. Report success only after durable save and attachment to the active view, and verify committed values after reopening.
6. Add a full export → external completion → import → Apply → save → reopen regression for both draft and paged saved runs, including a representative 27,125-row/153 MiB workload in an isolated desktop profile.

Production code, the CSV, installed data and the running preview were not changed by this investigation. No paid AI requests, commits, pushes or desktop updates occurred. Customer CSV contents remain outside repository artifacts.
