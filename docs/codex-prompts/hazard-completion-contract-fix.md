Fix the two defects in hazard-completion-verification-v2-2026-10-14.md on the
normal STPA/HARA/FHA pipeline. Preserve existing work and reviewed applicability.

Centralize generated/imported narrative acceptance so cleanup cannot pass a value
that fallback rejects. Retain incompatible originals separately and generate
conditional replacements with explicit Assumptions and Assessment Basis.

Keep accepted applicability decisions distinct from unresolved downstream narrative.
Carry their value and rationale through fallback, final assembly and stored/CSV
artifacts. Do not change No into Yes because supporting text contains uncertainty.
Do not weaken required generated fields, rating calculations, IDs or traceability.

Convert the six counterexamples into completion tests. Exercise all three methods,
Yes and No, provider failure, cached decisions, unresolved-text families, real final
publication/save, reload, CSV round-trip and software requirement derivation.
Run the hazard/transport and relevant downstream suites. Report actual scope and
limits; do not promise recovery from browser termination or arbitrary code defects.
