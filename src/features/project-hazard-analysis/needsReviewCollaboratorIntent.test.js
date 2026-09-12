import { isBatchNeedsReviewResolverIntent } from "./needsReviewCollaboratorIntent";

test.each([
  "Help me resolve the remaining Needs Review hazard rows in batch.",
  "Open Resolve Needs Review for this project.",
  "Use the grouped architecture questions to resolve Needs Review evidence gaps.",
])("recognizes grouped Needs Review resolver intent: %s", (prompt) => {
  expect(isBatchNeedsReviewResolverIntent(prompt)).toBe(true);
});

test.each([
  "Vibe review the Needs Review hazard rows one at a time.",
  "Explain why this row needs review.",
  "Resolve the current functional decomposition issue.",
])("does not steal non-batch review requests: %s", (prompt) => {
  expect(isBatchNeedsReviewResolverIntent(prompt)).toBe(false);
});

