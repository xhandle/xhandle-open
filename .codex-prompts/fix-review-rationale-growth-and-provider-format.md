# Fix governed-rationale growth and provider format failures

## Objective

Two defects found by exercising the hazard Vibe Review against a live model.
Both are confirmed in the working tree; neither is hypothetical.

1. A human decision writes a rationale that can repeat itself and that
   **accumulates without bound** across decisions, because each decision embeds
   the row's previous rationale into the new one.
2. Some rows get no assessment at all because the model answers in prose rather
   than the required JSON. The review now reports *which* failure occurred, but
   does nothing to prevent the most common one.

## Confirmed findings

### R1 — The governed rationale duplicates itself (confirmed)

`buildHumanVibeReviewDecision`
(`src/features/project-hazard-analysis/vibeReviewProposal.js`) builds:

    existingBasis = rowFields["Safety Significance Rationale"] || ...
    remainingGap  = proposal.remainingEvidenceGap
                 || proposal.evidenceGap
                 || (rowFields["Safety Classification"] === "Needs Review" ? existingBasis : "")

When the proposal carries no gap and the classification is `Needs Review`,
`remainingGap` falls back to **`existingBasis` itself**, and both are emitted:

    Existing documented basis: X. Unresolved validation context retained: X.

Observed verbatim in a live review. `buildHumanSafetyClassificationDecision` and
`buildHumanGuidePhraseApplicabilityDecision` should be checked for the same
pattern.

### R2 — The rationale grows without bound (confirmed by construction)

The composed rationale is written into `Safety Significance Rationale`. The next
decision on that row reads that field as `existingBasis` and embeds it again. A
row reviewed three times carries three nested copies of its own history, inside
the artifact that is already the largest thing in browser storage.

Live example after one decision, already carrying a nested prior rationale:

    Human-directed Vibe Review decision: the reviewer marked Safety Significant
    = No. No additional reviewer rationale was supplied with the button action.
    Existing documented basis: Needs review: guide-phrase applicability could
    not be validated... Unresolved validation context retained: Needs review:
    guide-phrase applicability could not be validated...

### R3 — Prose answers produce no assessment (confirmed)

Two of three rows in one run, and one of three in another, failed with
*"the model did not return the required structured fields"*. Truncation is now
detected and retried separately, and these were **not** truncation — the model
answered in prose. Nothing currently pushes the provider toward JSON beyond the
prompt text.

## Required changes

### R1/R2 — one rationale, bounded

- A value must appear **once**. If `remainingGap` is the same text as
  `existingBasis`, emit only the basis.
- The reviewer's decision sentence, their rationale, and any genuinely *new*
  evidence gap are the durable content. The row's **previous** rationale must
  not be nested into the new one; it is already preserved in the revision
  history and the audit trail.
- Cap the composed rationale at a sane length and say so if truncated, so a
  pathological input cannot grow the artifact unboundedly.
- Apply the same treatment to the classification and applicability builders.

### R3 — make JSON the likely outcome

- Request a structured/JSON response mode where the provider supports it,
  falling back cleanly where it does not. Check what `server.js` forwards; the
  backend spreads the whole request body upstream, so only keys the provider
  API understands may be added — see
  `src/features/project-hazard-analysis/hazardProviderRequest.test.js`, which
  guards exactly this and must keep passing.
- When the response is prose, extract an embedded JSON object if one is present
  before declaring a format failure.
- Keep the three distinct failure descriptions (`cut off`, `empty response`,
  `did not return the required structured fields`) — they are what made this
  diagnosable.

## Required tests

- A decision whose gap equals its existing basis emits that text once.
- A row reviewed three times does not accumulate nested copies of its own
  rationale; length stays bounded.
- A reviewer-supplied rationale is preserved verbatim.
- A genuinely new evidence gap is still retained.
- The classification and applicability builders behave the same way.
- A prose response containing an embedded JSON object is parsed.
- A prose response with no JSON still reports the format failure.
- The provider request body still contains only allowed keys.
- Full suite and `npx react-scripts build`.

## Constraints

- Preserve unrelated changes in the dirty working tree. No destructive Git
  operations. Do not commit unless asked.
- `App.js` and `XHandleCopilotView.jsx` have no unit coverage; six defects have
  already been introduced there by edits that the full suite still passed. Run
  the production build, not only Jest, and verify edits by reading the result.
- Do not weaken the governed-decision semantics: the reviewer's disposition,
  their rationale, and any unresolved gap must remain discoverable. This is
  about not repeating and not nesting them, never about dropping them.
