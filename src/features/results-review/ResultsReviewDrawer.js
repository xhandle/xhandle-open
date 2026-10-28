import React, { useEffect, useMemo, useRef, useState } from "react";
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
  onRetryPending,
  onReject,
  onNeedsRegeneration,
  onRequestRegeneration,
  onNeedsMoreContext,
  readOnly = false,
}) {
  const [activeItemId, setActiveItemId] = useState(null);
  const wasOpenRef = useRef(false);
  const previousOptionsRef = useRef(null);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const saveReview = async (task) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try { await task(); }
    catch (error) { setSaveError(error.message || 'The review could not be saved. Retry the action.'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const queue = useMemo(() => {
    const filtered = filterReviewItems(items, options || {});
    return filtered.length ? filtered : items;
  }, [items, options]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (!queue.length) return;
    const scopeChanged = !wasOpenRef.current || previousOptionsRef.current !== options;
    wasOpenRef.current = true;
    previousOptionsRef.current = options;
    if (!scopeChanged && queue.some((entry) => entry.id === activeItemId)) return;
    const requestedIndex = options?.initialReviewItemId
      ? queue.findIndex((item) => item.id === options.initialReviewItemId)
      : -1;
    const pendingIndex = options?.startAtFirstPending
      ? queue.findIndex((item) => isPendingReviewStatus(item.status))
      : -1;
    setActiveItemId(queue[Math.max(0, requestedIndex >= 0 ? requestedIndex : pendingIndex >= 0 ? pendingIndex : 0)].id);
  }, [isOpen, options, queue, activeItemId]);

  const activeIndex = Math.max(0, queue.findIndex((entry) => entry.id === activeItemId));
  const item = queue[activeIndex] || null;

  useEffect(() => {
    if (!isOpen || !item) return;
    window.dispatchEvent(new CustomEvent("xhandle:results-review:focus", { detail: { reviewItem: item } }));
  }, [isOpen, item]);

  const goPrevious = () => setActiveItemId(queue[Math.max(0, activeIndex - 1)]?.id || null);
  const goNext = () => setActiveItemId(queue[Math.min(queue.length - 1, activeIndex + 1)]?.id || null);
  const advance = () => setActiveItemId(queue[Math.min(queue.length - 1, activeIndex + 1)]?.id || null);

  const positionLabel = queue.length ? `${activeIndex + 1} of ${queue.length}` : "0 of 0";

  return (
    <div
      className={`fixed bottom-0 left-0 right-[var(--xhandle-collaborator-reserved-width)] top-14 z-[80] flex min-w-0 justify-end pointer-events-none transition-[right,transform] duration-200 ease-out ${isOpen ? "" : "translate-x-full"}`}
      aria-hidden={!isOpen}
    >
      <div
        className={`pointer-events-auto flex h-full min-w-0 max-w-full transform flex-col border-l border-gray-200 bg-white shadow-2xl transition-[width,transform] duration-200 ease-out ${
          isExpanded ? "w-[var(--results-review-drawer-expanded-width)]" : "w-[var(--results-review-drawer-width)]"
        } ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
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

        {saving && <div role="status" className="px-5 py-2 text-sm">Saving review and source table…</div>}
        {saveError && <div role="alert" className="px-5 py-2 text-sm text-red-700">{saveError} Your edits are still available. Resolve the issue and retry.</div>}
        {item?.pendingSourceCommit && <div className="px-5 py-2 text-sm" role="status">
          This review has an unfinished save. Retry to finish saving it before making further edits.
          {!readOnly && <button type="button" disabled={saving} onClick={() => saveReview(() => onRetryPending(item.id))} className="ml-2 rounded border px-2 py-1">Retry review save</button>}
        </div>}
        <ResultsReviewItemView
          item={item}
          positionLabel={positionLabel}
          feedback={feedback}
          setFeedback={setFeedback}
          onApproveAsIs={() => saveReview(async () => {
            if (!item) return;
            await onApproveAsIs(item.id);
            advance();
          })}
          onApproveWithEdits={(updatedContent) => saveReview(async () => {
            if (!item) return;
            await onApproveWithModifications(item.id, updatedContent, feedback);
            advance();
          })}
          onUpdateCurrentContent={(updatedContent) => saveReview(async () => {
            if (!item || !onUpdateCurrentContent) return;
            await onUpdateCurrentContent(item.id, updatedContent, feedback);
          })}
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
          readOnly={readOnly || saving || Boolean(item?.pendingSourceCommit)}
        />

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={saving || activeIndex <= 0}
            onClick={goPrevious}
          >
            <ChevronLeft size={15} /> Previous
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={saving || !queue.length || activeIndex >= queue.length - 1}
            onClick={goNext}
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
