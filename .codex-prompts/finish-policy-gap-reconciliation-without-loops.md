# Fully resolve policy-gap reconciliation without invalid saves or review loops

Implement a durable correction for hazard-analysis vibe reviews scoped to
`Classification Resolution Status = Policy Validation Gap`.

The current failure mode is:

- the stored classification is `Safety — Related`;
- `Intermediate Safety Function` and `Intermediate Safety Effect` contain absence
  sentinels such as `None identified`;
- the validator correctly reports that Related requires a real intermediate
  function and effect;
- malformed provider output omits `normalizedDecision` even after repair;
- the UI still offers `Accept proposal`, allows an unsupported Related manual
  disposition, says an update was saved, and automatically requests the same row
  again with a misleading `Next review item` prefix.

Required behavior:

1. Treat all absence sentinels as non-evidence. They must never support a Related
   classification.
2. Make deterministic reconciliation symmetric:
   - Direct with a substantive named intermediate function and effect becomes
     Related.
   - Related whose validator findings say the intermediate function/effect is
     missing, and whose row already documents the causal effect, resulting state,
     hazard/loss path, becomes Direct. Clear the intermediate fields, set a Direct
     causal path/rule, and explain the evidence-preserving reconciliation.
3. Run deterministic reconciliation after provider and repair failures so a
   malformed provider response does not block an evidence-obvious repair.
4. Never present `Accept proposal` as actionable when there is no valid proposal.
5. Disable and server-side reject `Mark Safety — Related` when the row lacks a
   substantive intermediate safety function and effect. Keep valid override
   choices available.
6. Do not persist an unsupported manual classification and then report that an
   update was saved. Revalidate before advancing or claiming success.
7. If a row genuinely remains unresolved, keep it on the same item but do not
   automatically loop through an identical provider request. Explain what evidence
   is missing and wait for a user action (valid override, skip, pause, or stop).
8. Never label the same-row state as `Next review item`. Use explicit same-item
   language when appropriate.
9. On success, report the resulting Classification Resolution Status and advance
   exactly once.
10. Add focused regression tests for deterministic Related→Direct repair, absence
    sentinels, disabled/blocked unsupported Related actions, invalid-proposal action
    rendering, no duplicate same-row request, and successful policy validation.

Preserve all unrelated user changes. Run focused tests, a production build, and
`git diff --check`. Do not commit or push.
