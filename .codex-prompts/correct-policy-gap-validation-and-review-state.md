# Correct policy-gap validation and review state

Fix the policy-gap Vibe Review defects demonstrated by the supplied transcript.

- Treat exact absence markers such as `None`, `None credited`, `None identified`, `None documented`, `None identified in row evidence`, `N/A`, and `Not applicable` as non-substantive—not as named intermediate safety functions or effects.
- Permit deterministic Direct-to-Related repair only when a real named intermediate safety function and substantive effect already exist.
- Never describe a causal path as depending on an absence marker.
- Revalidate every accepted Classification Resolution proposal against the resulting persisted row before advancing.
- Advance only when the recalculated status is policy validated or the reviewer explicitly skips. If findings remain, keep the same queue item active and show them.
- On resume, re-normalize/re-request policy-gap proposals; never restore an invalid proposal as `valid: true`.
- Do not call an automatic zero-impact continuation an explicit skip.
- Report the resulting Classification Resolution Status after a successful decision.
- Preserve governed applicability and safety-significance decisions, stable row IDs, persistence, audit history, and unrelated changes.
- Add regression tests and run focused tests plus the production build.
