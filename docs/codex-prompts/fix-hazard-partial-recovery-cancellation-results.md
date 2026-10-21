# Partial-recovery cancellation fix

Partial recovery now enters preservation mode unconditionally once generation has returned validated partialResults. Stop arriving during a later task yield no longer interrupts construction of the incomplete recovery artifact or replaces the original failure. Normal completed-result finalization still checks cancellation. Recovery continues yielding and stops issuing progress updates after cancellation.

The original error receives recoveryRun after the save attempt, including finalSavePending when persistence fails. A prior completed run remains authoritative with the incomplete attempt attached separately. Database schema, write ordering and App project/attempt guards are unchanged.

Validation: 4 suites, 40 tests passed (finalization, runner, hazard store and save wait). New cases exercise Stop during recovery, failed persistence with retained in-memory data, and a prior completed result with a simulated project-scope guard. Existing tests cover cancellation during generation and normal completed-result finalization. The project-switch test uses a guarded test callback; it is not an end-to-end App/browser test. Diff whitespace checks passed. No live AI calls or customer-storage changes.

Changes are not committed or pushed. Live Safari timing remains unmeasured.
