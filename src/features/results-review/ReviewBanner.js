import React from "react";
import { REVIEW_STATUSES } from "./reviewTypes";
import { useResultsReview } from "./ResultsReviewProvider";

export default function ReviewBanner({ items = [], openOptions = {}, className = "" }) {
  const review = useResultsReview();
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;

  const approved = list.filter((item) =>
    [REVIEW_STATUSES.APPROVED_AS_IS, REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS].includes(item.status)
  ).length;
  const pending = list.filter((item) => item.status === REVIEW_STATUSES.DRAFT_AI_GENERATED).length;

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm ${className}`}>
      <div className="text-blue-950">
        AI generated {list.length} reviewable items. {approved} approved · {pending} pending.
      </div>
      <button
        type="button"
        className="rounded-md bg-[#2D7DFE] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1f66d1]"
        onClick={() =>
          review.openResultsReviewDrawer({
            ...openOptions,
            reviewItemIds: list.map((item) => item.id),
            startAtFirstPending: true,
          })
        }
      >
        Open Review Drawer
      </button>
    </div>
  );
}
