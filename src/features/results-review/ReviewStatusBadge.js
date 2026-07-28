import React from "react";
import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from "./reviewTypes";
import { useResultsReview } from "./ResultsReviewProvider";

const STATUS_STYLES = {
  [REVIEW_STATUSES.DRAFT_AI_GENERATED]: "border-amber-200 bg-amber-50 text-amber-800",
  [REVIEW_STATUSES.APPROVED_AS_IS]: "border-emerald-200 bg-emerald-50 text-emerald-800",
  [REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS]: "border-sky-200 bg-sky-50 text-sky-800",
  [REVIEW_STATUSES.REJECTED]: "border-rose-200 bg-rose-50 text-rose-800",
  [REVIEW_STATUSES.NEEDS_REGENERATION]: "border-orange-200 bg-orange-50 text-orange-800",
  [REVIEW_STATUSES.NEEDS_MORE_CONTEXT]: "border-violet-200 bg-violet-50 text-violet-800",
  [REVIEW_STATUSES.SUPERSEDED]: "border-gray-200 bg-gray-50 text-gray-600",
};

export default function ReviewStatusBadge({
  reviewItem,
  reviewItemId,
  className = "",
  openOptions = {},
}) {
  const review = useResultsReview();
  const item = reviewItem || (reviewItemId ? review.getReviewItemById(reviewItemId) : null);
  if (!item) return null;

  const label = REVIEW_STATUS_LABELS[item.status] || "Pending Review";
  const style = STATUS_STYLES[item.status] || STATUS_STYLES[REVIEW_STATUSES.DRAFT_AI_GENERATED];

  return (
    <button
      type="button"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5 transition hover:shadow-sm ${style} ${className}`}
      title="Open review drawer"
      onClick={(event) => {
        event.stopPropagation();
        review.openResultsReviewDrawer({
          ...openOptions,
          initialReviewItemId: item.id,
          sourceRunId: item.sourceRunId,
          sourceFeature: item.sourceFeature,
          sourceMethod: item.sourceMethod,
          artifactType: item.artifactType,
        });
      }}
    >
      {label}
    </button>
  );
}
