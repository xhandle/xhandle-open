# Clean reviewed hazard rationale after downstream regeneration

Work in `/Users/Nick/xhandle-open`.

## Problem

The final reviewed classification is now normalized correctly, but regenerated rows can retain stale pre-review language inside `Safety Significance Rationale`.

Concrete example after a governed reviewer decision of `Safety Significant = No`:

- `Safety Classification = Mission/Reliability`
- rule `M1`
- causal path `None`
- the regenerated row consistently describes stale fleet awareness with no documented propagation into vehicle control
- but `Safety Significance Rationale` still says, sometimes twice: `Needs review: Mission/Reliability contradicts an asserted L1-L3 or physical-harm path.`

That old uncertainty was the basis for requesting review. It is no longer the current engineering rationale after the governed decision and coherent regeneration. It may be retained in audit history, but must not remain as the present rationale or be repeated as unresolved validation context when regeneration has removed the asserted physical-harm path.

## Goal

Extend the centralized post-regeneration persistence normalizer so current row rationale is coherent with the governed decision and regenerated row. Preserve historical rationale in review/audit records, not as stale current-state reasoning.

## Required behavior

1. Governed `Safety Significant = No`
   - Produce a current `Safety Significance Rationale` that explains the non-safety disposition from the regenerated evidence.
   - For the supplied pattern, say in substance that the causal chain terminates at stale fleet/operational awareness and no documented propagation into vehicle control or physical harm is established.
   - Do not retain or repeat stale `Needs review`, `Uncertain`, `could not be validated`, or contradiction text from the prior generated classification as current or unresolved rationale when the normalized row no longer contains that contradiction.
   - If the reviewer supplied explicit rationale, preserve it as the authoritative reviewer rationale and append only concise, noncontradictory regenerated context where useful.
   - If the reviewer supplied no rationale, explicitly note that fact once, then provide the evidence-based regenerated disposition rationale. Do not claim the reviewer supplied evidence they did not provide.

2. Governed `Safety Significant = Yes`
   - Produce a current rationale consistent with `Safety — Direct` or `Safety — Related` and the normalized causal path.
   - Remove stale language claiming the decision remains unresolved or needs review.
   - Preserve genuine evidence gaps (for example an unknown safeguard) in the appropriate evidence/protection fields and, if mentioned in the rationale, make clear they do not reverse the governed Yes decision.

3. Audit/provenance
   - Preserve the original pre-review rationale in the review item and before/after audit record.
   - Do not overwrite historical evidence merely to make the current row look clean.
   - Preserve reviewer identity, timestamps, session identity, row identity, and the governed Yes/No decision.

4. Final status
   - `Human Disposition — Evidence Gap` may remain when no reviewer rationale was supplied, if that is existing policy.
   - It must not be caused solely by stale `Needs Review` text left in the current rationale.
   - A current rationale must not contain stale `Needs Review` phrasing after successful reviewed-row regeneration unless the phrase appears inside an explicitly labeled historical/audit field that is not the current engineering rationale.

## Architecture requirements

- Implement this in or immediately behind the existing pure centralized `normalizeReviewedHazardRowForPersistence` boundary.
- Do not add another independent UI-only cleanup path.
- Use canonical column names and tolerate absent optional columns.
- Derive concise rationale from normalized fields without fabricating architecture, safeguards, mishaps, or thresholds.
- Preserve unrelated working-tree changes.
- Do not commit or push.

## Regression tests

Add focused tests proving:

1. The concrete governed-No Mission/Reliability row no longer contains stale `Needs review` or the old physical-harm contradiction in its current `Safety Significance Rationale`.
2. Its rationale explains the actual regenerated termination boundary/no documented control propagation.
3. A supplied human rationale remains present and authoritative.
4. Governed Yes produces rationale consistent with Direct and Related classifications without stale unresolved wording.
5. Unknown safeguard evidence remains in protection/evidence fields and does not cause stale uncertainty language to replace the governed rationale.
6. Original rationale remains available in before/audit content and identity/provenance is unchanged.
7. Existing final-resolution behavior remains correct.

Run the focused hazard-regeneration and classification tests, any affected Collaborator/review tests, `git diff --check`, and the production build. Report exact files changed and results.
