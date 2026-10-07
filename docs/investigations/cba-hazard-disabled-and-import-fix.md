# Code architecture hazard and import fixes

Implemented the prompt in ../codex-prompts/fix-cba-hazard-disabled-and-import.md.

## Changes

- Hazard eligibility counts and Run gating now select the same effective architecture rows as hazard input generation: the ready Functional model when available, otherwise the detailed architecture. Exclusions remain exclusions. The empty state explains excluded and unresolved rows and where to review them.
- Hazard loading no longer falls back to another project's repository analysis. A load sequence guard rejects older asynchronous responses. Changing project/repository cancels the active hazard operation; partial results, progress and completion are scoped to the originating operation. Late AI completion after cancellation is checked before saving.
- Functional CSV imports reconstruct a saved Functional snapshot, retaining source/destination Subsystem, CSCI and CSC allocations, interaction type, internal-operation exclusion and supporting source references. New Functional exports also include interaction/node IDs and eligibility fields. Legacy exports without those fields remain importable. Importing a snapshot does not establish source-code completeness or restore source files.
- Import now shows read/save progress, success, validation/storage failure and cancellation inline. Pending stages time out after two minutes. Storage writes receive an abort signal; obsolete operations cannot activate their results in a different workspace.
- Imported JSON hazard runs use the same repository identity as their restored architecture, allowing the correct project to find its own saved runs.

## Verification

97 targeted tests passed across seven suites: Functional model, CSV import, import lifecycle, Functional diagram, hazard panel, hazard input utilities and hazard runner preprocessing.

Fresh Chromium contexts with API requests blocked verified:
- An underlying helper call with zero included raw rows produces one eligible Functional interaction and seven STPA draft rows; Run is enabled.
- Ordinary CSV import into a new empty project displays its row without an error.
- The supplied 311-row Functional export imports with 252 interactions and 59 internal operations; endpoint hierarchy and supporting references are retained. The imported hierarchy remains after reload and reopening the project.
- A deliberately stalled IndexedDB open shows saving progress and a working Cancel import action, followed by a visible cancellation message.
- Two separately imported projects sharing the same repository identity: the first displays its saved hazard result; the second does not display it and can run a fresh analysis.

Production build passed with lint warnings. git diff --check passed.

## Limits

The customer's exact browser failure was not reproduced from their live workspace. The original normal import path succeeded in Chromium; stalled storage was a separately reproduced failure mode. This verification used synthetic runs and saved CSV data, without paid AI generation or changes to customer browser data.

Cancellation prevents active-workspace publication; already staged records from an interrupted multi-stage import can remain in storage. Importing Functional CSV is a summarized snapshot, not a full project/source backup. Existing unresolved raw rows still require an eligibility decision or a ready Functional model; the fix does not silently mark all raw calls eligible.

No commit or push was performed.
