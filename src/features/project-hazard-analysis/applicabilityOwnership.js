export const SCREENING_ORIGIN = 'Automatic screening';
export function applicabilityIsReadOnly(item) {
  return (item?.guidePhraseApplicabilityOrigin === SCREENING_ORIGIN &&
    ['Yes', 'No', 'Needs Review'].includes(item?.guidePhraseApplicable)) ||
    (/^reviewed$/i.test(String(item?.guidePhraseApplicabilityReviewStatus || '').trim()) &&
    /^(yes|no)$/i.test(String(item?.guidePhraseApplicable || '').trim()));
}
export const APPLICABILITY_OWNERSHIP_PROMPT = `
Applicability ownership overrides any applicability reassessment instructions below:
If guidePhraseApplicabilityOrigin is Automatic screening, or applicability review status is Reviewed,
keep the supplied guidePhraseApplicable and its rationale unchanged. These are inputs, not safety conclusions.
For these rows, assess safety significance/classification independently; missing hazard evidence, no adverse
consequence or Mission/Reliability does not change applicability. Do not replace a Yes with No or Needs Review.
Only unassessed rows may have applicability decided here. Do not generate Not applicable hazards for a supplied Yes;
use an honest downstream Needs review conclusion when the evidence cannot establish a hazard.
`;
