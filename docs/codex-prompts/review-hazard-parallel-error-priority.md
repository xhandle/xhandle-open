# Review hazard concurrent-error implementation

Review the current uncommitted hazard memory, checkpoint recovery, and concurrent-error changes, focusing on the latest preferredHazardFailure integration. Verify that required saved evidence cannot be replaced by assumptions, cancellation wins, accepted results survive interruption, and request budgets remain intact. Challenge both error arrival orders, including provider/configuration failures versus programming failures, through the actual pipeline rather than only helper tests.

Run the full hazard test suite and relevant new regression probes. Report reproducible findings with file/line references and distinguish newly introduced behavior from pre-existing limitations. Do not claim the native renderer crash or unbounded total workload memory is solved without runtime evidence. Do not modify production code, publish, restart the live app, or access customer databases. Save review findings and validation results.
