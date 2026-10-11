# CBA HARA/FHA workflow implementation

Implemented 2026-10-11 using `docs/codex-prompts/implement-cba-hara-fha-workflow.md` and the prior workflow audit.

## Changes

- `aiAnalysisLite.js` forwards an explicit Code-Based Architecture workflow flag, cancellation signal and generation checkpoint to HARA/FHA.
- `aiAnalysisHaraFha.js` carries per-row operational context and functional descriptions into prompts. Context columns are retained in both method sheets and Summary. The CBA standard path validates required model fields and rating syntax, retries missing/incomplete rows in smaller batches, and fails explicitly rather than manufacturing completed rows after provider failure.
- CBA generation runs at most two chunks concurrently. Successfully validated chunks are checkpointed using method, exact input rows, per-row/global context and a workflow version. Existing checkpoint scope also includes project/repository and model configuration. Continuation reuses matching generation chunks; repair and classification still run. Regeneration retains the existing outer checkpoint reset behavior.
- Cancellation reaches model requests and is rethrown through retry, repair and classification catches; cancelled runs cannot publish results. Outstanding parallel requests are awaited before a chunk failure returns. Successful sibling work remains checkpointed.
- HARA retains its system safety goal and adds an explicit software safety allocation and verification approach in CBA output. Unsupported allocation remains unresolved. FHA retains its severity/control-category/SwCI logic; unresolved ratings no longer become default assessed criticality in CBA.
- `codeArchitectureHazardRunner.js` does not reinterpret STPA preprocessing when switching to HARA/FHA, or vice versa. Existing saved decisions are not mutated.
- `artifactAI.js` excludes unresolved placeholder requirements and unresolved HARA/FHA hazard/rating/verification results. Software requirements retain method/run/architecture provenance and operational context. Legacy goal-only HARA exports retain their existing compatibility behavior; newly generated HARA has a distinct software allocation column.
- `softwareHazardSource.js` rejects a latest HARA/FHA run whose recorded architecture/Functional snapshot is stale before deriving requirements. `EngineeringArtifactPanel.js` supplies the architecture and reports the method used during derivation. Selection remains the latest saved run across repository aliases, not a combined set of methods.
- Checkpoint reuse progress text is method-neutral.

Projects invocations keep the original sheet shape and standard sequential generation behavior. CBA does not apply STPA command/control or guide-phrase screening to HARA/FHA. No changes to the method-specific hazard reasoning or risk matrices were intended.

## Validation

70 tests passed across six suites: real HARA/FHA generation with mocked model responses; CBA runner preprocessing; requirements importer; hazard-source selection; Functional-source selection; and requirements panel.

New coverage includes two-context generation and requirements handoff, incomplete/provider-failed responses, invalid and unresolved ratings, cancellation, checkpoint reuse, recovery after a failed chunk, bounded concurrency, repeated HARA generation without shared-header mutation, Projects schema compatibility, method switching without changing prior decisions, placeholder rejection and stale HARA/FHA sources.

Production build: `CI=false npm run build` passed with lint warnings and an outdated Browserslist-data notice. The affected importer/generator suites were rerun after the final HARA-only guard adjustment (36 tests passed). `git diff --check` passed.

## Limits

No live model calls, browser smoke tests, customer-data writes or standards-compliance validation were performed. Existing saved results are not rewritten or repaired. Existing unresolved rows need a new analysis with adequate evidence. Provider outages can still exhaust bounded retries; the run then reports failure and retains successful generation chunks rather than claiming completion. Repair/classification work is not checkpointed by this change. The latest-run selection policy does not merge different hazard methods. Freshness checking here covers recorded architecture/Functional snapshots, not independently edited operational contexts in the requirements panel.
