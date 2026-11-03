# Unexpected hazard CSV cancellation — November 3, 2026

The user reported “CSV import canceled. Existing results were not replaced” after selecting `VulnerableApp_hazard_analysis_40pct_safety_yes_SYNTHETIC.csv` (164.3 MB) and confirmed that they did not click Cancel.

## Reproduction and cause

The import hook automatically stopped a worker when its last table subscriber disappeared for a single timer tick. A draft refresh, preparation placeholder, or same-workspace table remount could therefore stop a valid import even though the user had not canceled it. The cancellation path displayed the same text as an explicit Cancel click.

A regression reproduction prepared an import, briefly removed its presentation for 30 ms, and remounted it without clicking Cancel. Before the fix it failed with expected `ready`, actual `canceled`. The previous same-tick remount test did not cover this asynchronous gap. Evidence: `/private/tmp/hazard-csv-unexpected-cancel-repro.log`.

## Changes

- The active hazard workspace now owns its import through a stable App-level effect, independently of table/preparation presentation lifetimes. That effect does not subscribe the App to progress or retain row arrays. Leaving the hazard workspace still releases ownership and stops work; temporary child-view changes do not.
- The panel receives stable project/repository IDs so temporarily missing draft data cannot move its subscription into an undefined scope. Apply waits until its current draft/source is available. Existing revision, fingerprint, context, integrity and atomic-publication checks remain unchanged.
- Cancellation/disposal is serialized, and replacement selections are versioned so only the latest requested replacement starts a worker. An older cancellation cannot overwrite a newer import state. Job eviction excludes owned/in-flight entries. Automatic workspace closure is described separately from an explicit user cancellation.

The change adds no table cache, extra import worker, or new full-table read algorithm. It addresses ownership/lifecycle behavior. The existing large-file processing still has its normal resource cost; this is not a guarantee against every possible memory failure.

## Validation

**173 tests across 13 suites passed.** New cases cover a presentation gap while awaiting Apply, a hidden table while file I/O is still pending, worker cleanup on workspace exit, rapid replacement selections, and stable progress/disabled Apply during a temporary draft reload. Adjacent tests cover draft preparation, saved-panel remounts, storage, CSV merging, archive round trips and cancellation after durable publication.

Focused ESLint and `git diff --check` passed. The production build succeeded with existing repository warnings.

In local Electron diagnostics.9, the exact synthetic file was selected through the actual App import control. Focus and visibility-change events were dispatched during validation to exercise the file-picker/refresh path. The CSV controls briefly disappeared during a refresh, then returned with the import still running. The file reached **CSV validated / Apply CSV import**, with no unexpected-cancellation message.

After that validation, the preview entered Saving without any Apply invocation by the agent. Read-only monitoring followed it through saving, final cleanup and the transition to the saved/paged table. It completed with **“Saved CSV updates to 27,125 rows”**, no active-import indicator, and no reported error. This confirms that the lifecycle fix also survives the save-to-paged-view transition. The synthetic results are now saved in the preview workspace. This follow-up checked successful validation/publication and lifecycle behavior; it did not repeat the earlier exhaustive all-cell comparison for this separate synthetic file.

## Preview and artifacts

Diagnostics.9 is open with the completed synthetic import in the same preview profile, `/private/tmp/xhandle-csv-confirmed-preview-o6t0i940`. Project: `/private/tmp/xhandle-hazard-csv-owner-preview/project`; renderer: `/private/tmp/xhandle-hazard-csv-owner-build`; PID at launch: 69934. The prior idle preview was closed normally after a busy-work guard. This remains unpackaged with desktop updates disabled. The original preserved workspace/profile and installed Desktop data were not changed. No commit, push or desktop release was performed.

Logs: `/private/tmp/hazard-csv-owner-final-tests.log`, `/private/tmp/hazard-csv-owner-build.log`, `/private/tmp/hazard-csv-owner-lint.log`, `/private/tmp/hazard-csv-owner-preview-open.log`, `/private/tmp/hazard-csv-owner-preview-validate.log`, `/private/tmp/hazard-csv-owner-final-ui.log`, `/private/tmp/hazard-csv-owner-preview-monitor.log`. The final-UI check caught saving already in progress; the monitor log records durable completion.
