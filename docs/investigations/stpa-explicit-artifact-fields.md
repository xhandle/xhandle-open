# Explicit STPA artifact fields

The compact STPA result now generates distinct Unsafe Control Action, Loss, Hazard,
Causal Scenario, Safety Constraint and Verification fields. These appear by default
alongside Function, operational scenario/mode/conditions, guide phrase/applicability
and Safety Classification. Causal Factor remains available separately; it is not
relabeled as a full scenario. Software Safety Requirement remains a separate
software-allocated requirement.

`fastHazardSchema.js` requires the additional STPA response fields and uses contract
`compact-hazard-v3`, preventing reuse of pre-change checkpoints that lack them.
`fastHazardPipeline.js` explains artifact distinctions and their causal relationship
in the existing compact prompt. No extra catalog/model-request stage was introduced.

`fastHazardRunner.js` saves/exports row-scoped Loss ID, Hazard ID and UCA ID, plus
Hazard-to-Loss, UCA-to-Hazard, Scenario-to-UCA and Constraint-to-UCA references. These
are explicit per-assessment relationships, not a deduplicated system-wide catalog.
Excluded rows have no asserted hazard links. Validation after preprocessing includes
the new fields. Partial recovery remains supported.

`CodeArchitectureHazardSummaryTable.js` updates STPA defaults and preference version.
Historical Malfunctioning Behavior can display as Unsafe Control Action, while
missing Loss/Scenario/Constraint content is not invented for historical records.
A new run is needed to produce missing artifacts.

`artifactAI.js` recognizes Safety Constraint as a mitigation source when deriving
software requirements; existing hazard-row navigation and source traceability remain.
HARA/FHA columns and rating calculations are unchanged.

Verification: 264 tests passed across 25 suites. Added checks require each STPA
artifact, verify row-level ID relationships, preserve distinct factors/scenarios,
and retain CSV/software-requirement compatibility. Final build outcome is reported
in the completion message. No live model run, commit or push was performed.
