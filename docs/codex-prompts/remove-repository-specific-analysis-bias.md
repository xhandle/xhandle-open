# Make code architecture analysis independent of repository and domain

Implement this prompt in the current checkout. Inspect existing code and tests first.

## Outcome

Local and GitHub analysis must treat equivalent source relationships equally, whether the project is Alpamayo, localization software, a business service, or another application. Repository names, particular filenames, and customer function names must not manufacture, redirect, or prioritize relationships or hazards.

## Required changes

1. Remove named-repository/function exceptions from decomposition grounding, source auditing, prompts, and hazard postprocessing. Use the general source inventory for missing-call coverage. Source enrichment must not inject prewritten hazards, constraints, or synthetic customer-specific rows.
2. Version the new screening behavior. Include source-evidenced production calls for hazard assessment without requiring robotics/ML vocabulary. Inclusion is a screening decision, not a finding of a hazard, severity, control action, or applicable guide phrase. Keep structural/nonproduction exclusions, unresolved-target qualifications, and analyst overrides. Preserve saved legacy assessments and stable relationship/node/edge/trace identities.
3. Preserve extraction for languages without a syntax inventory. Clearly distinguish model extraction from syntax-backed coverage, including empty extraction and parse errors, in persisted run summaries, the UI, and workbook coverage exports. Do not imply complete C++/other-language call coverage or runtime-dispatch proof. Do not silently drop these languages or pretend a regex is a compiler. New model-extracted calls should be screened without a domain keyword gate, while retaining their evidence limitations.
4. Keep call publication scope independent of hazard eligibility. Do not restore structural edges, ordinary excluded builtins, test-only calls, or unsupported Python proposals merely to inflate coverage.
5. Preserve downstream mechanics for Hazard & Remediation, Software Requirements, System Requirements, Subsystem Requirements, System / Subsystem Design, and Traceability Matrix. No migrations that erase existing analysis or analyst edits. New runs must not resume an incompatible checkpoint.

## Verification

- Add regression tests using unrelated Python domains and generic helper names, rename repository/function/path fixtures, and compare relationship semantics and screening decisions.
- Verify mixed-language/C++ fallback is preserved and its limitations are visible, not reported as zero calls or complete syntax coverage.
- Verify source enrichment cannot fabricate named-function hazards; actual calls remain represented by the common inventory.
- Verify analyst overrides, historical rows, stable IDs, source-adapter equivalence, workbook exports, and downstream traceability.
- Run the relevant existing regression suites and lint changed production files. Report actual checks, remaining language limitations, and whether a real customer repository was exercised.

Do not commit or push unless separately requested. Do not run paid live model analysis or change customer projects to validate this task.
