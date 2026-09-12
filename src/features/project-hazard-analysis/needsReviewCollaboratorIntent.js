const normalize = (value) => String(value ?? "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/**
 * Recognize requests for the grouped architecture-evidence resolver. This is
 * intentionally distinct from row-by-row hazard Vibe Review.
 */
export function isBatchNeedsReviewResolverIntent(value = "") {
  const text = normalize(value);
  if (!text || /\bvibe review\b|\bone (?:row|item) at a time\b/.test(text)) return false;
  const mentionsNeedsReview = /\bneeds? review\b/.test(text);
  if (!mentionsNeedsReview) return false;
  const explicitCapability = /\b(?:open|launch|start|use|run) (?:the )?resolve needs? review\b/.test(text)
    || /\bresolve needs? review\b/.test(text);
  const groupedEvidenceWorkflow = /\b(?:batch|grouped|shared|common)\b/.test(text)
    && /\b(?:resolve|resolution|evidence|question|gap|rows?)\b/.test(text);
  const naturalBatchRequest = /\b(?:help me )?resolve\b/.test(text)
    && /\b(?:remaining|unresolved|hazard|analysis)\b/.test(text);
  return explicitCapability || groupedEvidenceWorkflow || naturalBatchRequest;
}

