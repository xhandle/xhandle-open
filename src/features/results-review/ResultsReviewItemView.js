import React, { useEffect, useState } from "react";
import ReviewDiffViewer from "./ReviewDiffViewer";
import { contentToText, parseEditedContent } from "./reviewUtils";
import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from "./reviewTypes";

function isTableRowContent(content) {
  return content && typeof content === "object" && Array.isArray(content.columns) && content.row !== undefined;
}

function valueForColumn(row, column, index) {
  if (Array.isArray(row)) return row[index] ?? "";
  if (row && typeof row === "object") return row[column] ?? "";
  return "";
}

function buildRowFromValues(originalRow, columns, values) {
  if (Array.isArray(originalRow)) return columns.map((_, index) => values[index] ?? "");
  return columns.reduce((next, column, index) => {
    next[column] = values[index] ?? "";
    return next;
  }, {});
}

function fieldLabel(column) {
  return String(column || "Field")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function StructuredRowReviewEditor({ originalContent, currentContent, values, setValues, readOnly = false }) {
  const columns = currentContent.columns || originalContent.columns || [];
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Review Fields</div>
        <div className="rounded-md border border-gray-200 bg-white">
          {columns.map((column, index) => {
            const originalValue = valueForColumn(originalContent.row, column, index);
            return (
              <div key={`${column}-${index}`} className="border-b border-gray-100 p-3 last:border-b-0">
                <div className="mb-2 text-xs font-semibold text-gray-700">{fieldLabel(column)}</div>
                <div className="mb-2 rounded-md border border-gray-100 bg-gray-50 p-2 text-sm leading-5 text-gray-700">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Original AI output</div>
                  <div className="whitespace-pre-wrap">{String(originalValue ?? "") || "Empty"}</div>
                </div>
                <textarea
                  className="min-h-[76px] w-full resize-y rounded-md border border-gray-200 p-2 text-sm leading-5 text-gray-900 focus:border-[#2D7DFE] focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={values[index] ?? ""}
                  onChange={(event) => {
                    if (readOnly) return;
                    const next = [...values];
                    next[index] = event.target.value;
                    setValues(next);
                  }}
                  disabled={readOnly}
                  aria-label={`Reviewed ${fieldLabel(column)}`}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Original AI output is read-only and preserved for audit history. Edit only the reviewed values.
      </div>
    </div>
  );
}

export default function ResultsReviewItemView({
  item,
  positionLabel,
  feedback,
  setFeedback,
  onApproveAsIs,
  onApproveWithEdits,
  onUpdateCurrentContent,
  onReject,
  onRegenerate,
  onRequestRegeneration,
  onNeedsMoreContext,
  readOnly = false,
}) {
  const [editedText, setEditedText] = useState("");
  const [editedRowValues, setEditedRowValues] = useState([]);

  useEffect(() => {
    setEditedText(contentToText(item?.currentContent));
    if (isTableRowContent(item?.currentContent)) {
      const columns = item.currentContent.columns || [];
      setEditedRowValues(columns.map((column, index) => String(valueForColumn(item.currentContent.row, column, index) ?? "")));
    } else {
      setEditedRowValues([]);
    }
    setFeedback(item?.reviewerFeedback || "");
  }, [item?.id, item?.currentContent, item?.reviewerFeedback, setFeedback]);

  if (!item) {
    return <div className="p-5 text-sm text-gray-500">No review item selected.</div>;
  }

  const hasStructuredRowEditor = isTableRowContent(item.currentContent) && isTableRowContent(item.originalContent);
  const parsedCurrent = () => {
    if (hasStructuredRowEditor) {
      const columns = item.currentContent.columns || item.originalContent.columns || [];
      return {
        ...item.currentContent,
        columns,
        row: buildRowFromValues(item.currentContent.row, columns, editedRowValues),
      };
    }
    return parseEditedContent(editedText, item.currentContent);
  };
  const canRegenerateElement = item.status === REVIEW_STATUSES.NEEDS_REGENERATION;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900">{positionLabel}</div>
          <div className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
            {REVIEW_STATUS_LABELS[item.status] || item.status}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
          <div><span className="font-semibold text-gray-800">Feature:</span> {item.sourceFeature || "Unknown"}</div>
          <div><span className="font-semibold text-gray-800">Method:</span> {item.sourceMethod || "Unknown"}</div>
          <div><span className="font-semibold text-gray-800">Artifact:</span> {item.artifactType}</div>
          <div><span className="font-semibold text-gray-800">Unit:</span> {item.reviewUnitType}</div>
          {item.riskImpact && <div><span className="font-semibold text-gray-800">Risk:</span> {item.riskImpact}</div>}
          {item.confidence !== null && item.confidence !== undefined && (
            <div><span className="font-semibold text-gray-800">AI confidence:</span> {Math.round(Number(item.confidence) * 100)}%</div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {hasStructuredRowEditor ? (
          <StructuredRowReviewEditor
            originalContent={item.originalContent}
            currentContent={item.currentContent}
            values={editedRowValues}
            setValues={setEditedRowValues}
            readOnly={readOnly}
          />
        ) : (
          <>
            <ReviewDiffViewer originalContent={item.originalContent} currentContent={parsedCurrent()} />
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Reviewed / Current Content</div>
              <textarea
                className="h-48 w-full resize-y rounded-md border border-gray-200 p-3 font-mono text-xs leading-5 text-gray-800 focus:border-[#2D7DFE] focus:outline-none focus:ring-2 focus:ring-blue-100"
                value={editedText}
                onChange={(event) => {
                  if (!readOnly) setEditedText(event.target.value);
                }}
                disabled={readOnly}
              />
            </div>
          </>
        )}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Reviewer Feedback</div>
          <textarea
            className="h-24 w-full resize-y rounded-md border border-gray-200 p-3 text-sm text-gray-800 focus:border-[#2D7DFE] focus:outline-none focus:ring-2 focus:ring-blue-100"
            placeholder="Add rationale, concerns, missing context, or regeneration notes..."
            value={feedback}
            onChange={(event) => {
              if (!readOnly) setFeedback(event.target.value);
            }}
            disabled={readOnly}
          />
        </div>
      </div>

      {!readOnly && (
      <div className="border-t border-gray-200 p-4">
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700" onClick={onApproveAsIs}>Approve as-is</button>
          <button className="rounded-md bg-[#2D7DFE] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1f66d1]" onClick={() => onApproveWithEdits(parsedCurrent())}>Approve with edits</button>
          {onUpdateCurrentContent && (
            <button
              className="col-span-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              onClick={() => onUpdateCurrentContent(parsedCurrent())}
            >
              Update table
            </button>
          )}
          <button className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100" onClick={onReject}>Reject</button>
          {canRegenerateElement ? (
            <button
              className="rounded-md bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700"
              onClick={onRequestRegeneration}
            >
              Regenerate element
            </button>
          ) : (
            <button className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 hover:bg-orange-100" onClick={onRegenerate}>Mark for regeneration</button>
          )}
          <button className="col-span-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100" onClick={onNeedsMoreContext}>Needs more context</button>
        </div>
        {canRegenerateElement && (
          <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
            This item is ready for regeneration. The owning workflow can handle the regeneration request event for this artifact.
          </div>
        )}
      </div>
      )}
    </div>
  );
}
