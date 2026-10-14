# Fix code-architecture hazard runtime from live request evidence

Read `docs/investigations/hazard-live-log-followup.md` and the active compact hazard pipeline before editing. Implement the confirmed fixes for STPA, HARA and FHA without removing independent semantic review, altering applicability governance, rating calculations or downstream software-requirement wiring.

1. Separate shared-context input overhead from variable batch capacity, with a bounded total request size. Preserve all evidence. Budget output separately using realistic assessment lengths, reasoning reserve and measured responses; never rely on the old short-fixture timing benchmark as an SLA.
2. Correct Claude Haiku 5.5 request compatibility against official provider documentation. Preserve the user's selected effort. Handle explicit output-limit finish reasons, and reserve enough output for review thinking plus verdicts.
3. Distinguish unavailable/malformed review from actual semantic findings. Bound review attempts per assessment across subdivisions. Retry reviews without regenerating structurally valid assessments. Checkpoint pending candidates separately from approved results, reuse candidates on Continue, and publish approvals/progress as each review subgroup completes.
4. Emit prompt-free live diagnostics for batch size, input budget, queue time, output limit/usage, stage duration and retry reason. Keep progress tied to independently accepted results.
5. Add regressions with large shared context and realistic answer lengths, truncated/malformed/missing verdicts, partial approval, cancellation/resume, provider compatibility and all three methods. Run relevant integration tests and a production build. Report actual tests and limitations; do not promise a live runtime not measured against the provider.

Preserve existing work. Do not commit, push, restart running analyses, make paid provider calls or change Projects-area hazard semantics.
