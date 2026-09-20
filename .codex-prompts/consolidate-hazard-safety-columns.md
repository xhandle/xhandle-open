# Consolidate hazard safety columns without losing evidence

Implement a backward-compatible cleanup of xHandle's project hazard-analysis safety columns.

## Outcome

Reduce redundancy and prevent contradictory safety values without lowering STPA/hazard-analysis quality or deleting existing evidence.

## Canonical behavior

- Keep `Safety Classification` as the primary categorical decision.
- Treat `Classification Evidence` as the canonical classification rationale; display it as `Classification Rationale` without breaking stored/imported data.
- Preserve `Causal Effect`, `Resulting System State`, `Protection Status`, `Physical-Harm Chain Termination`, and `Classification Resolution Status` in the default hazard table.
- Preserve `Intermediate Safety Function` and `Intermediate Safety Effect`, especially for `Safety — Related`, but place them in row safety details rather than consuming permanent table width.
- Preserve `Protection Assessment`, but show it in row safety details while retaining the compact `Protection Status` in the default table.
- Preserve `Safety Classification Rule`, `Causal Path Type`, `Classification Confidence`, `Safety Significant`, and `Safety Significance Rationale` as audit/detail data instead of primary table columns.
- Continue removing/deprecating `Proposed Safety Assessment` and `Proposed Safety Assessment Rationale` from canonical persistence while retaining read/import compatibility where required.
- Do not destroy legacy values during migration.

## Derivation and consistency rules

When an explicit canonical `Safety Classification` exists, keep redundant summaries coherent:

- `Safety — Direct` -> `Safety Significant = Yes`, `Causal Path Type = Direct`
- `Safety — Related` -> `Safety Significant = Yes`, `Causal Path Type = Contributory`
- `Mission/Reliability` -> `Safety Significant = No`, `Causal Path Type = None`
- `Not Applicable` -> `Safety Significant = No`, `Causal Path Type = None`
- `Needs Review` -> `Causal Path Type = Uncertain`, but do not overwrite an existing governed Yes/No `Safety Significant` decision with `Needs Review`

Keep classification rule normalization and resolution-status validation. Derived fields must not become separately editable sources of truth or contradict the canonical classification.

## UI

- Simplify the project hazard table's default visible columns.
- Add an accessible per-row expandable `Safety details` section containing the hidden audit/detail values, omitting empty values.
- Use friendly display labels while retaining canonical stored headers.
- Do not change CSV/export schemas in a way that loses evidence.

## Compatibility and verification

- Preserve existing projects, imports, exports, vibe reviews, regeneration, consolidated Safety Issues, and code-architecture behavior.
- Add focused tests for column presentation and classification-derived consistency, including the `Needs Review` governed-decision exception.
- Run the relevant Jest suites and a production build.
- Do not commit or push.
