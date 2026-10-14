# Compact hazard output quality corrections

## Evidence and root causes

The supplied 2026-10-13 STPA paste contained 100 rows, all applicable Yes and
Mission/Reliability. It does not establish full-run exclusion coverage because it
may be a filtered export. Six requirements contained embedded TBD values; the
validator primarily rejected whole-cell or leading unresolved statuses. Some
assessments described downstream simulation/viewer behavior instead of the current
elaboration/analysis action. The generation contract did not require verifiable
causal provenance. Lifecycle Phase and Interface Type were inherited architecture
statuses, rather than generated hazard conclusions.

## Implemented changes

- `fastHazardSchema.js`: reject embedded TBD/TBC/TODO, unresolved review wording and
  equivalent placeholder phrases in required generated fields. Require exact source
  action identification and explicit causal basis. Source-supported claims must
  include a quote present in supplied evidence; hypotheses must be labeled, including
  the STPA causal-factor cell. Existing reviewed applicability/rating checks remain.
- `fastHazardPipeline.js`: strengthen the single-pass prompt to distinguish the
  assessed action from downstream consequences, apply temporal phrases to that action,
  avoid equating data dependencies with commands, and distinguish hypothesized faults
  from proven defects. Instruct required validated configuration/boundary tests when
  numerical thresholds are unavailable, without inventing numerical values.
- `fastHazardRunner.js`: preserve assessed action, causal basis, supporting quote and
  evidence/assumption explanation in supporting columns, including merged-result
  validation and CSV. Missing lifecycle/interface classifications are described as
  `Not specified in source architecture`; original snapshots are not edited.
- Checkpoint contract is `compact-hazard-v2`. Old AI checkpoints cannot silently
  bypass the new checks. Saved historical results are preserved, as are accepted
  human applicability decisions supplied as preprocessing input.

All three methods use these checks. HARA S/E/C/ASIL, FHA severity/SCC/SWCI, organization
calibration, default visible columns, software requirements and bounded concurrency
remain intact. No extra full-table AI audit pass was introduced. Only invalid/missing
responses use the existing bounded corrective retries.

## Verification

The 23-suite run passed 253 tests; the subsequent quality suite includes an additional
inherited-metadata regression. Coverage includes all three methods, embedded
placeholders, exact action binding, copied-evidence checks, hypothetical causal
wording, invalid-row-only correction, metadata preservation, CSV and downstream
requirements. Build status is recorded in the final completion message.

## Limits and next run

Structural validation can prove quote presence and action identity, not that the
quote logically establishes a claim or that every sentence stays semantically within
scope. Prompt improvements need a live smoke test; no paid model call was made here.
An unspecified source classification is honestly unavailable metadata, not a guessed
definitive classification. Required configured bounds are proposed requirements, not
claims that a validated bound already exists. Historical exports are not rewritten.

After any active run ends, reload and run STPA again. Continue uses the v2 contract
while preserving reviewed applicability; Regenerate explicitly starts fresh within
the current contract. Inspect results and timing before relying on the change across
larger repositories. No commit/push was performed for this task.
