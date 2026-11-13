# Removed-project cleanup timeout — November 6, 2026

## Confirmed cause

The permanent-deletion scan exceeded its 30-second transaction deadline in `xhandle-code-architecture-hazard-analysis`. The scan visited every primary key in every store, fetching each unrecognized record to inspect project ownership. Consequently, removing one small project required reading chunks belonging to other projects.

A second bug hid that initiating timeout. The timeout callback saved `Storage cleanup timed out. Close other tabs and retry.` and called `tx.abort()`. A pending cursor/get request then failed with `AbortError` and called the abort helper again. That helper's second `tx.abort()` threw because the transaction was already aborting. Its catch called `finish(error)` with the secondary request error, replacing the saved timeout cause. The visible error therefore said only `The transaction was aborted, so the request cannot be fulfilled.`

## Evidence

Read the installed application's diagnostics without changing them. Its flight record identifies Desktop 0.2.15, Electron 45.0.0 and upstream commit `13333664ca6a50ae6a7f49122345db40cd0dd50f`. The installed commit's cleanup implementation matches this failure path. The application logs do not preserve the initiating cleanup exception.

Reproduced using APFS copies of the installed application's approximately 2.2 GiB IndexedDB directory in temporary profiles. The original profile was never opened by the diagnostic runtime. A local `xhandle://app` fixture supplies only a blank page; the actual application, background writers and network services are not started. Database copies contain personal data, were kept outside the repository and any distributable artifacts, and were deleted after the investigation. Copies made while the application is open are not treated as backups.

The original cleanup reproduced the screenshot's exact final message twice. In the explicitly instrumented reproduction:

- Elapsed time: **30,028.5 ms**.
- First abort cause: **Storage cleanup timed out. Close other tabs and retry.**
- Subsequent request failure: **AbortError**, code 20, in `hazardRunChunks`.
- Subsequent abort helper call recorded the timeout as its prior failure, but returned the secondary AbortError message.
- Requests issued before timeout included **131,313 chunk gets**, **54,146 generation-checkpoint gets**, and 12 gets each for hazard runs and run metadata. The target was the retained `alpamayo` project shown in the screenshot. These counts include other projects because the original scan traverses the entire database.

The first revised native reproduction completed in **10,448.5 ms**, deleting the target's two hazard records. It issued no `get` requests to the indexed hazard runs, chunks or run metadata. Generation checkpoints still require an ownership scan because their index is on scope rather than project ID.

Final verification on a fresh copy, using the final helper, completed in **8,728.2 ms**. Before/after counts were: hazard runs **13 → 12**, run metadata **13 → 12**, hazard chunks **173,266 → 173,266**, generation checkpoints **54,146 → 54,146**, and staging records **1 → 1**. Only the target's two hazard records were removed. This target had no owned chunks; the original code nevertheless fetched over 131,000 unrelated chunks before timing out.

The separately pasted macOS report (14:48:17 EST, Electron PID 29000, parent Codex) belongs to the first sandboxed diagnostic launch. Its main-thread stack terminates in HIServices application registration/AppKit startup. The corrected diagnostic launch runs successfully with the required runtime access. That launch failure is distinct from the earlier cleanup timeout and is not evidence that the user's database caused a native crash.

## Fix

- Use bulk primary-key and project-index key queries for stores indexed by project ID. Delete matching project keys without reading their payloads or issuing one cursor round trip per chunk across the entire database.
- Continue checking exact scoped keys and inspecting unindexed records, so incomplete indexes cannot conceal project-owned data. Preserve numeric/string project ID compatibility and distinguish IndexedDB key types when comparing key sets.
- Preserve the first abort cause when secondary requests fail during transaction abortion. Include the failing store in request-error details.
- Keep the existing deadline, ownership checks, retained-project-last deletion, and active-project protection.
- The preceding UI change adds one confirmed bulk action for all removed projects, runs projects sequentially, and reports individual failures while continuing the remaining projects.

## Validation

Three focused Jest suites pass: **33 tests**, including indexed payload avoidance, missing index entries, scoped-key precedence, other-project preservation, timeout-cause retention, bulk deletion continuation, numeric IDs, and retryable retained records. Focused ESLint passes; its only output is the repository's existing Browserslist data notice. `git diff --check` passes.

No live project was deleted or restored. Changes are in the shared source repository; the installed application has not been rebuilt or updated by this investigation.
