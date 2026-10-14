# Compact code-based architecture hazard pipeline

## Routing and scope

Implemented `../codex-prompts/replace-cba-hazard-pipeline.md`.

The public `runCodeArchitectureHazardAnalysis` entry point now dispatches STPA, HARA and FHA to `runFastCodeArchitectureHazardAnalysis`. The original runner body remains intact as `runLegacyCodeArchitectureHazardAnalysis`; its components remain in place and its tests still exercise that explicit legacy entry point. Other methods retain their existing routing. The Projects-area pipeline was not changed.

Existing saved analyses are not rewritten. New generation/continuation uses the new pipeline. To roll back execution, route the public entry point back to the retained legacy runner.

## Execution

1. Reuse existing Functional-preferred input construction, architecture eligibility, selected operational contexts, and imported preprocessing.
2. Build compact interface/context/guide-phrase records. Deduplicate repeated interface evidence within each request. Include the enabled organization profile, repository context, analysis context, and supplied evidence. No separate repository-wide source fetch or LLM screening/audit/catalog cycle is performed.
3. Resolve reviewed No rows locally. Reuse validated checkpoints for matching pipeline version, project, repository, method, provider/model/effort, context/profile, source evidence and governed inputs.
4. Assess up to 32 rows per request, with a 32,000-character source batch budget and at most three concurrent requests. Shared profile/context is additional to that budget; no supplied context is silently truncated. Each request generates applicability and the method-specific assessment together, with an instruction to check consistency before returning.
5. Validate identity, coverage, required fields, governed decisions, classifications and rating codes locally. Retain valid rows even if other rows are missing. Split malformed or incomplete responses down to smaller batches, including single rows; stop after three failed singleton attempts. Provider/transport failures stop without multiplying requests. Successful rows are checkpointed independently.
6. Restore governed imported fields, validate the merged artifact, derive ASIL/SWCI locally, and save through the existing run store. Previous completed runs remain untouched on failure. A save failure retains an in-memory recovery run and checkpointed assessments.

This removes the old sequence of global language repairs, repeated safety audits, applicability-pattern repairs, canonical vocabulary generation/mapping, and assumption-completion passes from new CBA runs. It does not claim that deterministic validation can prove the semantic correctness of an AI assessment. Missing-evidence assumptions remain recorded separately from source facts.

## Tables and software requirements

The new sheets begin with the exact requested default columns: 9 STPA, 14 HARA, and 15 FHA columns. CBA table defaults and their persisted preference versions were updated; users can still show additional columns. Legacy STPA headers receive display aliases where applicable. Function links retain the existing diagram trace targets.

Additional stored/exportable columns retain function/interface identities, operational context, trace IDs, source references, applicability rationale, classification rationale, assumptions, verification, and software-allocated requirements. Existing `importHazardSoftwareRequirements` consumes those fields unchanged. No rows and mission/reliability-only rows remain excluded from safety-requirement import.

HARA rating derivation is covered against all 36 positive S/E/C combinations in [TI's ASIL table (SPRADF6A, Table 3-2)](https://edgeworker.ti.com/lit/wp/spradf6a/spradf6a.pdf). Zero classes yield QM; invalid rating codes are rejected. FHA uses the same software-criticality matrix as the retained implementation, with tests covering all 20 entries. The organization profile calibrates assessments and terminology; it does not silently replace these matrices.

## Progress and validation

Progress reports validated or reused assessments out of the complete input population (5–95%), then artifact validation (96%), saving (98%), and successful persistence (100%). It may pause during an in-flight model request; it is completed-work progress, not a predicted elapsed-time percentage.

- 240 tests passed across 20 suites: new default dispatch, all three method outputs, profile propagation/cache invalidation, governed No/Yes decisions, all guide phrases, malformed/partial response retries, cancellation, provider failures, storage reload, CSV round-trip, table presentation, existing preprocessing/context handling, and hazard-derived software requirements.
- Deterministic request-count fixture: 96 assessments take three requests for each method; identical checkpointed inputs take zero new requests. This is not a live latency benchmark.
- Production build passed with existing lint, bundle-size and Browserslist warnings; none named the new pipeline modules.
- `git diff --check` passed.

No live provider run or customer-data migration was performed. Provider latency, output length, throttling, and context size still determine elapsed time. A few-minute result for every repository size cannot be guaranteed. Smoke-test a representative small and large repository after deploying this build, checking the resulting assessments and software-requirement links as well as elapsed time.
