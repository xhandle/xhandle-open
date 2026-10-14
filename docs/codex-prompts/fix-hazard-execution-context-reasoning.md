# Correct execution and operator-context reasoning

Read the compact code architecture hazard pipeline before editing. Fix two
specific errors: missing exit-status checks do not establish concurrent execution,
and an unattended scenario must not assume an engineer requires an interactive
waveform display. Apply the rules to STPA, HARA and FHA without changing their
rating mechanics or governed applicability.

Strengthen the existing generation contract and bounded row validation; avoid a
new whole-table model pass. Require explicit execution/operator dependencies and
supporting evidence where needed. Sequential lateness may delay subsequent work;
a failed completed command may allow later work if failure handling permits it.
Neither proves overlap. Distinguish unattended artifact production from interactive
inspection and later attended review. Hypotheses must respect explicit context.

Preserve the reasoning metadata through table assembly and validation. Version
checkpoints so old assessments are not silently reused. Add regression tests for
invalid overlap, supported concurrency, unattended interaction conflicts, valid
artifact-based viewer consequences, and targeted retries. Run tests and build;
report limitations without claiming semantic validation guarantees correctness.
