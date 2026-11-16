# Projects HARA output-limit recovery

The reported failure occurred during the HARA assessment phase after the shared
STPA evidence generation had completed. The HARA caller omitted `maxTokens`,
falling back to the proxy's 1,200-token default for up to three events with
multiple assessment fields. Retrying the same batch used the same insufficient
budget. Even a singleton could exhaust that default.

The HARA caller now reserves 12,000 output tokens. An explicit truncated batch
response immediately switches to individual events and keeps that smaller batch
size for subsequent work. A truncated singleton retries once with a 16,000-token
allowance and concise, complete-response guidance. Model/effort preferences are
unchanged. Recovery remains bounded; repeated provider failures retain saved
evidence and do not create missing ratings or accept incomplete JSON. Each
successful event is still published through the existing saved-stage path.

Advancement uses the actual number of events processed, so reducing the next
batch size cannot duplicate or skip entries. Cancellation stops recovery before
the next provider call. Deterministic S/E/C-to-ASIL calculation is unchanged.

## Verification

Five new unit regressions failed against the original implementation and passed
after the fix. They cover explicit budgets, all 137 events after a truncated
batch, singleton recovery, bounded failure with saved partial work and
cancellation during recovery.

- 489 related tests passed across 45 suites (Projects hazard storage/review,
  HARA and downstream safety/derivation sources).
- 65 generation/transport/calibration tests passed across five suites. These
  overlap the related tests; counts are not additive.
- A fresh production build passed with the existing warning backlog.
- Nine real Electron HARA workflow checks passed with controlled provider
  responses, including injected `finish_reason: length` responses for both a
  singleton and a batch. The singleton injection returned parseable JSON with
  deliberately wrong S0 data; it was rejected and never accepted as the result.
- Develop risk profile completed the remaining guide-phrase rows, preserved the
  earlier edited S1 assessment and left non-applicable deviations unassessed.
  Workbook export, method preservation/reload and CBA method options also passed.

The earlier HARA live fixture returned only complete responses, which left this
failure uncovered. Its default regression path now includes both output-limit
recovery scenarios and asserts the actual request output budgets. Its prompt
fixture parser accepts retry guidance following the event array, and the bulk
test waits for persisted completion after asynchronous review loading.

Live evidence:
[result.json](/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-hara-live-ND7eF7/result.json)
and [log](/private/tmp/xhandle-hara-output-recovery-live3.log).
These checks do not use a paid live provider or modify a customer's workspace.
The earlier full-gate result remains the snapshot for the source fingerprint
recorded in that report; this fix was verified by the focused checks above.

## Desktop follow-up and operational context columns

The native shell forwards request bodies to the staged shared backend without
a separate HARA output limit. Backend regressions now check both 12,000- and
16,000-token budgets for configured Claude Haiku, Sonnet and Opus model families
with default, low, medium and high effort. HARA retains its requested budget and
selected model/effort without Collaborator-specific thinking adjustments.

Projects stored Operational Mode and Operating Conditions but hid them with
internal context fields. Both columns now render in draft and completed hazard
tables, including normal filters, copy behavior and row height calculations.
Code-Based Architecture STPA/HARA already includes both in its default layouts.
The HARA Item definition input is removed; existing saved definitions remain
available for analysis and export.

The Electron fixture now polls completed IndexedDB reads from Node. Its former
asynchronous `waitForFunction` predicate returned a truthy Promise before the
condition resolved, producing a premature assertion while generation was still
running. Write tracing confirmed that completed results were not overwritten.
The fixture also waits for desktop navigation before resizing its native window
and retains bounded startup error output for diagnosis.

Final verification on macOS arm64, Electron 45.0.0:

- 114 backend tests, 49 native Node tests and 11 release-validator tests passed.
- A fresh production build and native protocol/backend/persistence smoke passed.
- All 12 Electron HARA checks passed: simulated singleton/batch truncation,
  preserved manual ratings, completed-result reload, both visible context
  columns with saved values, and absence of the Item definition text box.
- 46 focused frontend tests passed across HARA generation, deterministic
  assessment and Code-Based Architecture table components.
- Application source remained unchanged during the final gate:
  `54a7e6ebf8119e306276b1acb6e03c7f59c8d0128da07f1c7a2413277255f0f3`.

[Final desktop report](/private/tmp/xhandle-electron-hara-final-20261115/report.md)
and [HARA result](/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-hara-live-rfcIqb/result.json).
This was a focused selection of the full regression gate with controlled
provider responses. It does not establish paid-provider output quality,
Windows/Linux runtime behavior, signing or publication of an installed update.
