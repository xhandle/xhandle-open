# Make applicability screening a compact first pass

Audit the active code-based STPA/HARA/FHA applicability pass. Send an explicit
allowlist of from/action/to, interface descriptions/type, lifecycle, row scenario,
mode, conditions and assumptions, plus repository identity, operational context
and the enabled organization profile. Do not routinely send raw code evidence,
attachments, architecture bookkeeping or downstream review values.

Group guide phrases by the compact interface/context definition, preserving IDs
and independent decisions. Keep ordinary interface groups together within bounded
batches and use at most three concurrent screening requests. Preserve output
budgets, cancellation, deferred recovery, partial checkpointing and method rules.

STPA screens command/control status and whether the particular phrase is meaningful
for that action in the scenario. HARA/FHA retain functional-deviation criteria;
do not apply STPA's command gate to them. Remove downstream hazard/requirements
reasoning instructions from screening. Return short Yes/No rationales.

Allow an explicit internal needsEvidence response when compact descriptions are
ambiguous. Escalate only those rows to their original full evidence/context, using
the existing chunking fallback where necessary. Do not turn uncertainty into No.
Preserve governed decisions and version the changed AI screening cache contract.

Add tests for payload exclusion, context/profile preservation, whole-interface
batching, concurrency, selective evidence escalation, uncertainty handling,
unchanged reviewed decisions, cancellation and all three methods. Run relevant
regression suites and report mocked-test limitations.
