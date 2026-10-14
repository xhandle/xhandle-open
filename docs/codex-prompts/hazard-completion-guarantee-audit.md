# Audit completion of every started code-architecture hazard run

Review the current working tree, including the approved assumption-based fallback,
for STPA, HARA and FHA. Do not implement fixes during this review.

Determine whether every started run returns a completed result for every input row
without a reload, restart or browser termination. Treat deliberate Stop separately.
Trace dispatch, preparation, applicability, generation, bounded retries, fallback,
checkpoint reads/writes, imported human decisions, final assembly, publication,
saving, activity registration and cancellation ownership.

Identify every remaining throw, rejected promise, unbounded await, callback failure
or swallowed result that can prevent completion. Distinguish actual production
paths from synthetic injected-dependency failures. Check actual storage and
transport deadlines rather than assuming raw awaits are unbounded.

Add fault-injection characterization tests for counterexamples, preserving current
production behavior. Verify row count, identity, reviewed Yes/No, fallback provenance,
final publication and downstream requirements. Never silently overwrite governed
values or describe assumption-based results as verified findings.

Report severity, precise files/lines, reproduction evidence, covered failure modes,
remaining limits and the smallest follow-up changes. Do not claim an absolute
guarantee from passing tests.
