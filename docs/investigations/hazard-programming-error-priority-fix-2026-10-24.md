# Programming-error priority regression fix

Executed `docs/codex-prompts/fix-hazard-programming-error-priority.md` to address the finding in `hazard-parallel-error-priority-review-2026-10-24.md`.

The shared failure selector now ranks interrupting programming errors above provider errors eligible for assumption completion. Cancellation and missing required evidence retain higher priority. Stable ordering for equal priorities and original error identity/cause remain intact. The final pipeline fallback uses the same eligibility predicate, so a ReferenceError, RangeError, or non-network TypeError carrying provider-status metadata cannot bypass interruption.

The previously failing reproduction is now expanded across STPA/HARA/FHA, screening/generation, ReferenceError/RangeError/TypeError, and both error arrival orders (36 combinations). Each verifies interruption, preservation of an accepted partial result, and no assumption completion. Three further pipeline cases test programming errors with status 403. Helper tests cover all five supported provider-fallback statuses via direct, nested-response, and message encodings, plus cancellation/storage metadata protection. Existing provider fallback behavior and network-TypeError classification are preserved.

No request budgets, checkpoint formats, source data, or renderer lifecycle code changed in this fix. No application restart, customer database access, commit, push, or publication occurred. This resolves the reviewed classification defect; it does not establish that large analyses are crash-proof. All-source/result residency and renderer-owned execution remain limitations.

Validation: all 72 hazard suites passed (676 tests). Production build passed with warnings, including lint, outdated Browserslist data, and bundle size. `git diff --check` passed. No packaged Electron or overnight workload test was performed in this turn.
