/** Keep preprocessing visible without promoting an unfinished row to generated. */
export function selectHazardDisplayRow({ generatedDraft, generatedCompleted, alignedDraft, alignedCompleted, fallbackRow }) {
  if (generatedDraft) return alignedDraft;
  if (generatedCompleted) return alignedCompleted;
  // Pending rows may contain only applicability/significance assessments.
  // A blank draft cell must not mask a value already saved in Summary.
  return fallbackRow.map((fallback, index) => {
    const draft = alignedDraft?.[index];
    const completed = alignedCompleted?.[index];
    return String(draft ?? '').trim() ? draft
      : String(completed ?? '').trim() ? completed : fallback;
  });
}
