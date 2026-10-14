# Close the reviewed hazard-run completion gaps

Implement the findings in hazard-completion-guarantee-audit-2026-10-14.md for
the normal shared STPA/HARA/FHA pipeline, keeping explicit Stop effective.

Preserve valid reviewed applicability and original imported data. Separate
incompatible imports from active generation constraints, retain originals in the
saved run, and disclose generated replacements through Assessment Basis. Do not
present assumption-based conclusions as verified source facts. Prevent incidental
unresolved wording in a locked rationale from invalidating the reviewed decision.

Keep valid generated results when final imported-field reconciliation fails.
Isolate telemetry/progress observers from pipeline success. Own runs by
project/repository, allow navigation without cancellation, reconnect the visible
view to its live run, and prevent late loads from overwriting in-memory results.
Keep independent projects isolated and prevent duplicate starts for one scope.

Complete hazard activity before registering review items; use a bounded independent
review-registration task. Preserve storage recovery and exportable unsaved results.
Convert counterexample tests to regression tests and cover navigation, concurrent
scopes, Stop, late loads, retained imports, fallback fields and requirements linkage.
Do not promise recovery from process termination, resource exhaustion, or arbitrary
programming defects. Report tested guarantees and remaining limits precisely.
