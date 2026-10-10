# Remove redundant applicability audit — implementation

## Finding

The Code-Based Architecture STPA screen already supplied applicability decisions, and `mergeAuditTag` protected those decisions. However, downstream audit prompts still requested semantic applicability tests and evidence fields whose answers were ignored. Distribution and calibration checks could also request independent applicability reconsideration for those protected inputs. Initial generation and generic-language repair instructions still included an unconditional instruction to decide applicability first.

## Changes

`src/components/aiAnalysisCodeHazardStandard.js` now:

- Uses existing applicability ownership to treat automatically screened decisions and reviewed Yes/No values as input in generation and language repairs.
- Partitions safety-audit requests into protected and legacy batches, preserving original row identity and order. Protected batches omit applicability response fields and reassessment rules; the existing downstream safety-classification and evidence criteria remain.
- Runs applicability distribution/calibration checks on unprotected rows only. Protected rows still receive checks for safety-classification inconsistencies, contradictions between harm claims and mission classification, and causal-category mismatches.
- Repairs protected downstream inconsistencies without requiring applicability proof fields or showing applicability distributions. Empty repair responses preserve prior rows; unexpected provider applicability changes remain ignored by the existing ownership merge.
- Reports safety/evidence auditing and safety/causal repair progress accurately.
- Versions downstream stage checkpoints for protected inputs. Source extraction, applicability screening, and generation checkpoints are not invalidated by this policy marker.

The existing explicit-No and screened-unresolved generation gates remain. No new screen was added to Projects. Its shared-engine human-reviewed inputs receive the same read-only treatment; legacy unprotected auditing remains available.

## Verification

Regression coverage includes safety-only response schemas, generation prompts without repeated screening, hostile provider applicability output, mixed-batch identity/order, uniform protected decisions causing no applicability-pattern requests, retained downstream causal/safety checks, and empty repair responses. Existing full-pipeline Yes/No ownership, CSV preservation, completion/retry, and CBA GitHub/local screening tests were also run.

Results: **75 tests passed across six suites**. The final production build passed with existing lint, Browserslist, and bundle-size warnings. `git diff --check` passed.

No customer data or saved decisions were modified. This removes redundant prompt work and applicability-only repair requests; it does not remove the safety audit. No live-provider end-to-end timing improvement was measured.
