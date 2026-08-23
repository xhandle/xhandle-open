import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from "lucide-react";
import ResultsReviewItemView from "./ResultsReviewItemView";
import { filterReviewItems, isPendingReviewStatus } from "./reviewUtils";

export default function ResultsReviewDrawer({
  isOpen,
  isExpanded = false,
  options,
  items,
  onClose,
  onToggleExpanded,
  onApproveAsIs,
  onApproveWithModifications,
  onUpdateCurrentContent,
  onReject,
  onNeedsRegeneration,
  onRequestRegeneration,
  onNeedsMoreContext,
  readOnly = false,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [feedback, setFeedback] = useState("");

  const queue = useMemo(() => {
    const filtered = filterReviewItems(items, options || {});
    return filtered.length ? filtered : items;
  }, [items, options]);

  useEffect(() => {
    if (!isOpen || !queue.length) return;
    const requestedIndex = options?.initialReviewItemId
      ? queue.findIndex((item) => item.id === options.initialReviewItemId)
      : -1;
    const pendingIndex = options?.startAtFirstPending
      ? queue.findIndex((item) => isPendingReviewStatus(item.status))
      : -1;
    setActiveIndex(Math.max(0, requestedIndex >= 0 ? requestedIndex : pendingIndex >= 0 ? pendingIndex : 0));
  }, [isOpen, options?.initialReviewItemId, options?.startAtFirstPending, queue]);

  const item = queue[activeIndex] || null;

  useEffect(() => {
    if (!isOpen || !item) return;
    window.dispatchEvent(new CustomEvent("xhandle:results-review:focus", { detail: { reviewItem: item } }));
  }, [isOpen, item]);

  const goPrevious = () => setActiveIndex((index) => Math.max(0, index - 1));
  const goNext = () => setActiveIndex((index) => Math.min(queue.length - 1, index + 1));
  const advance = () => setActiveIndex((index) => Math.min(queue.length - 1, index + 1));

  const positionLabel = queue.length ? `${activeIndex + 1} of ${queue.length}` : "0 of 0";

  return (
    <div className={`fixed bottom-0 right-0 top-14 z-[80] flex pointer-events-none ${isOpen ? "" : "translate-x-full"}`} aria-hidden={!isOpen}>
      <div
        className={`pointer-events-auto flex h-full transform flex-col border-l border-gray-200 bg-white shadow-2xl transition-[width,transform] duration-200 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ width: isExpanded ? "var(--results-review-drawer-expanded-width)" : "var(--results-review-drawer-width)" }}
        aria-label="Review AI-Generated Results"
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-950">Review AI-Generated Results</h2>
            <p className="text-xs text-gray-500">Queue-based contextual review</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
              title={isExpanded ? "Collapse review mode" : "Expand review mode"}
              aria-pressed={isExpanded}
              onClick={onToggleExpanded}
            >
              {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" className="rounded-md p-2 text-gray-500 hover:bg-gray-100" title="Close" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        </div>

        <ResultsReviewItemView
          item={item}
          positionLabel={positionLabel}
          feedback={feedback}
          setFeedback={setFeedback}
          onApproveAsIs={async () => {
            if (!item) return;
            await onApproveAsIs(item.id);
            advance();
          }}
          onApproveWithEdits={async (updatedContent) => {
            if (!item) return;
            await onApproveWithModifications(item.id, updatedContent, feedback);
            advance();
          }}
          onUpdateCurrentContent={async (updatedContent) => {
            if (!item || !onUpdateCurrentContent) return;
            await onUpdateCurrentContent(item.id, updatedContent, feedback);
          }}
          onReject={async () => {
            if (!item) return;
            await onReject(item.id, feedback);
            advance();
          }}
          onRegenerate={async () => {
            if (!item) return;
            await onNeedsRegeneration(item.id, feedback);
          }}
          onRequestRegeneration={async () => {
            if (!item) return;
            await onRequestRegeneration(item.id);
          }}
          onNeedsMoreContext={async () => {
            if (!item) return;
            await onNeedsMoreContext(item.id, feedback);
            advance();
          }}
          readOnly={readOnly}
        />

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={activeIndex <= 0}
            onClick={goPrevious}
          >
            <ChevronLeft size={15} /> Previous
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={!queue.length || activeIndex >= queue.length - 1}
            onClick={goNext}
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
