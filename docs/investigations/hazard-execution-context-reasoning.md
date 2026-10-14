# Execution and operator-context reasoning

The previous prompt warned against unsupported concurrency, but validation checked
only that a causal quote occurred in source evidence. It did not check execution
or operator dependencies. A hypothesis could also contradict the operational
scenario without being rejected.

The existing compact generation pass now requests executionDependency and
operatorDependency, with supporting quotes when those dependencies apply. Overlap
requires an actual source quote containing concurrency evidence; missing exit
checks alone are insufficient. Interactive operator dependency requires a context
quote and is rejected for explicitly unattended/no-interaction contexts.

The prompt distinguishes sequential delays, completed failures, and overlap. It
also distinguishes automated artifact production from interactive viewing and
later attended inspection. Hypotheses cannot override explicit operational context.
These rules apply to STPA/HARA/FHA without changing their rating matrices or
governed applicability. No new model pass was added.

The runner retains these fields for post-merge validation and export. Checkpoint
contract v4 prevents reuse of pre-fix generated assessments. Existing saved runs
remain unchanged; rerunning is required to generate corrected assessments.

Regression coverage includes unsupported overlap, real quoted concurrency,
fabricated quotes, unattended and attended operator contexts, valid assessments
without operator dependencies, and correction of only the failing row. The full
hazard/requirements compatibility test selection passed 271 tests in 25 suites.

Limitations: these are bounded structural and textual checks, not a semantic proof.
Concurrency keywords in a real quote do not prove causality, and a model could
misdeclare its dependency. The prompt explicitly requires consistency across all
narrative fields. No live-provider reproduction of the customer's row 144 was run.
