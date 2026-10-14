# Implement focused applicability recovery

Apply the findings in docs/applicability-screening-audit-2026-10-14.md to the
active code-based STPA/HARA/FHA pipeline. Preserve existing working-tree changes.

Separate explicit missing information from invalid output and provider failures.
Retain missing-evidence questions and send them to a single focused follow-up.
Group related guide phrases by original evidence and interface/context identity.
Complete compact screening before starting evidence work. Enforce a 60KB screening
budget for singletons too; summarize oversized evidence with cited coverage and
the actual questions as extraction focus, keeping original evidence untouched.

Checkpoint unresolved information so unchanged end passes and Continue do not
repeat the same requests. Changed context/evidence and explicit human applicability
reviews must allow progress. Retry malformed output with specific validation
feedback, increasing output allowance only for truncation. Preserve transient
recovery, Stop, accepted work, governed Yes/No and unique method rules.

Report specific pending-information/structural reasons and actual request byte
counts. Do not silently convert missing information into No or completed results.
Add regressions for amplification, resumption, input changes, evidence sharing,
oversized singletons, structural correction, cancellation and all three methods.
Run the hazard regression suites; report live-provider limitations honestly.
