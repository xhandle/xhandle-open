// One contract for generated narrative and imported narrative constraints.
// Applicability is a separate, governed decision: incidental uncertainty about
// another field in its rationale must not turn an accepted Yes/No into a new vote.
const text=value=>typeof value==='string'?value.trim():'';
export const hasUnresolvedHazardText=value=>!text(value) ||
 /\b(?:TBD|TBC|TODO|to be determined|to be confirmed|needs? review)\b/i.test(text(value)) ||
 /^(?:needs? review|unknown|unresolved|tbd|pending|not generated|n\/a)(?:$|\s*[:—-])/i.test(text(value));

export const isApplicableHazardNarrative=value=>!hasUnresolvedHazardText(value) && !/^not applicable\b/i.test(text(value));

// Keep the screening contract stable; carry accepted decisions through all later
// stages instead of applying the downstream narrative contract to them.
export const isAcceptedApplicabilityDecision=row=>Boolean(row && row.needsEvidence!==true &&
 ['Yes','No'].includes(row.applicable) && text(row.rationale) &&
 !/needs review|to be determined|^tbd$/i.test(row.rationale));

export function hasLockedApplicabilityRationale(row,source) {
 if(!text(row.applicabilityRationale))return false;
 return (row.applicable===source.reviewedApplicability && row.applicabilityRationale===source.reviewedRationale) ||
 (row.applicable===source.screenedApplicability && row.applicabilityRationale===source.screenedRationale);
}
