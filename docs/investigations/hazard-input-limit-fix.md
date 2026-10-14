# Hazard input size fix

Executed `docs/codex-prompts/bound-hazard-inputs.md`.

Root cause: applicability batching always admitted its first row, irrespective of size. Generation split multi-row prompts but also admitted oversized singletons. The 120,000-character scheduling limit was therefore not an enforced ceiling. Functional model construction copies the sourceFunctions evidence into both codeEvidence and sourceEvidence, potentially with repeated source functions, which the prompt previously serialized verbatim at each location. The actual customer's failing payload was not available; the observed provider error proves oversized input, not its exact composition.

Both active stages now serialize repeated substantial evidence values through a shared dictionary with explicit references. Expansion reconstructs the original context/interfaces, including multiplicity and source locations. Unique evidence, operating context, organization profile and governed decisions are not truncated or dropped. Inputs are hard-checked immediately before every screening/generation request, including singleton and structural retry paths. Provider context-limit rejection splits multi-row requests; singletons fail explicitly instead of repeating an unchanged rejected payload. Other HTTP 400 failures are not retried as context limits.

Irreducibly oversized unique input produces HAZARD_INPUT_TOO_LARGE with stage, row IDs and measured character size, instructions to reduce context or split functional relationships, and partial-result retention. This does not promise to process arbitrarily large unique evidence. Character ceilings are conservative bounds, not exact provider token estimates. Existing cache keys are retained because input semantics and reasoning rules have not changed. Storage warning recovery is separate and unchanged.

Validation: hazard directory 308 tests/34 suites passed; then two additional input regressions passed in the focused 11-test suite. Tests cover lossless expansion of multi-megabyte repeated evidence, successful compacted screening, singleton/shared-context limits, all three methods, provider-triggered splits, and retained resolved rows. No live provider run or customer analysis was restarted.

## Follow-up: HA-120 rejected by the local guard

The 120,000-character ceiling conflated a normal batch scheduling target with
single-request admission. A unique 156,337-character input could not become
smaller by splitting batches.

The scheduling target remains unchanged. Recognized Claude 4/5-family model
names now use an application admission envelope of 200,000, minus the actual
output allowance and 8,192 overhead reserve. Prompt admission counts UTF-8
bytes conservatively; it does not estimate tokens by dividing characters by
four or assert that 200,000 is the provider's advertised context capacity.
Unknown/custom models retain a conservative envelope. Both active stages check
admission, including larger retry output reservations. Multirow batches split;
large individual sources can proceed within the separate allowance.

No evidence truncation, checkpoint version change, narrative review stage,
classification change, or normal batch/concurrency increase was introduced.
Truly oversized unique inputs still produce a recoverable explicit error;
this change does not implement evidence summarization/chunk synthesis.

Validation includes mocked complete STPA/HARA/FHA runs with 156,337-character
source evidence, shared context, UTF-8/output budgets, retries and partial-work
retention. These are code regression tests, not a live rerun of HA-120.

## Automatic oversized-evidence fallback

The active results-first STPA/HARA/FHA paths now automatically prepare oversized
single-source evidence, including provider context-limit rejections. Ordinary
requests retain their existing prompt and call count. Batch splitting remains
in place before single-source evidence preparation.

`hazardEvidenceChunking.js` partitions structured evidence at object boundaries
and long strings at newline/UTF-16 offsets without modifying the original
payload. Up to three extraction calls run concurrently. Each response must
account for every piece and cite only supplied references, including an explicit
unknown/irrelevance statement where appropriate. Facts, constraints, safeguards,
conflicts and unknowns remain separate. Truncated or size-rejected extraction
requests split again, with bounded depth. Invalid summaries receive one retry.

Large collections of summaries are reduced in groups, with checkpointed lineage
back to source JSON pointers/offsets. Preparation is reused across screening and
generation, and completed chunks can be reused after interruption. Persistence
uses the existing resilient checkpoint layer, so a storage failure does not own
the only copy of work. The final request retains exact row IDs, phrases, governed
applicability/rationale, and correction fields. Recognized short identity/context
fields are also copied verbatim. Results carry evidence-preparation metadata and
an Assessment Basis note identifying the use of derived summaries.

Limitations: summary coverage checks establish reference/fragment coverage, not
semantic completeness or correctness. Original evidence remains in the source
payload and chunk checkpoints; extraction is not described as lossless. Provider
outages, repeatedly invalid extraction, irreducibly large protected review fields,
or nonconvergent summaries can still stop a run with completed work retained.
No paid provider analysis or customer browser run was performed.

Validation: 332 hazard-analysis tests passed across 35 suites, including oversized
end-to-end mocked runs for all three methods, unchanged normal requests, provider
size rejection, recursive splitting, UTF-8 preservation, reference/coverage
validation, concurrency, cancellation, checkpoint resume, and reduction lineage.
Production build also passed, with existing lint/dependency/bundle-size warnings.
