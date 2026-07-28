import { useEffect, useMemo } from "react";
import { REVIEW_STATUSES, REVIEW_STATUS_LABELS, REVIEW_UNIT_TYPES } from "../results-review/reviewTypes";
import { createReviewId, normalizeReviewItem } from "../results-review/reviewUtils";
import { useResultsReview } from "../results-review/ResultsReviewProvider";
import { rowIdentity } from "./artifactUtils";

const REVIEW_REGISTRATION_BATCH_SIZE = 50;

export function useArtifactReview({
  rows = [],
  columns = [],
  definition,
  projectId = "",
  repoId = "",
  setRows,
  enabled = true,
}) {
  const review = useResultsReview();
  const artifactType = definition.artifactType;
  const artifactIdRoot = `code-architecture-${definition.key}:${projectId || "default"}:${repoId || "repo"}`;
  const sourceRunId = `${artifactType}:${projectId || "default"}:${repoId || "repo"}`;
  const reviewColumns = useMemo(
    () => columns.filter((column) => !column.readOnly).map((column) => column.key),
    [columns]
  );

  const reviewItems = useMemo(
    () => enabled ? (review.reviewItems || []).filter((item) =>
      item.artifactType === artifactType &&
      String(item.artifactId || "").startsWith(`${artifactIdRoot}:row:`)
    ) : [],
    [artifactIdRoot, artifactType, enabled, review.reviewItems]
  );

  const reviewByRow = useMemo(() => {
    const map = new Map();
    reviewItems.forEach((item) => {
      const rowId = item.traceLinks?.find((link) => link.type === "artifact_row")?.rowId;
      if (rowId) map.set(String(rowId), item);
      const rowIndex = item.traceLinks?.find((link) => link.type === "table_row")?.rowIndex;
      if (rowIndex !== undefined) map.set(Number(rowIndex), item);
    });
    return map;
  }, [reviewItems]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!rows.length || !reviewColumns.length) return;
    let cancelled = false;
    const existingIds = new Set(reviewItems.map((item) => item.id));
    const missing = rows.flatMap((row, rowIndex) => {
      const rowId = rowIdentity(row, rowIndex);
      const reviewItemId = createReviewId(sourceRunId, artifactType, artifactIdRoot, "row", rowId);
      if (existingIds.has(reviewItemId)) return [];
      const content = { rowIndex, columns: reviewColumns, row };
      return normalizeReviewItem({
        id: reviewItemId,
        artifactType,
        artifactId: `${artifactIdRoot}:row:${rowId}`,
        reviewUnitType: REVIEW_UNIT_TYPES.TABLE_ROW,
        sourceFeature: definition.sourceFeature,
        sourceMethod: definition.sourceMethod,
        sourceRunId,
        projectId,
        originalContent: content,
        currentContent: content,
        traceLinks: [
          { type: "table_row", rowIndex },
          { type: "artifact_row", rowId },
          ...(Array.isArray(row.traceLinks) ? row.traceLinks : []),
        ],
      });
    });
    if (!missing.length) return undefined;

    let index = 0;
    let timeoutId = null;
    const createNextBatch = () => {
      if (cancelled) return;
      const batch = missing.slice(index, index + REVIEW_REGISTRATION_BATCH_SIZE);
      index += REVIEW_REGISTRATION_BATCH_SIZE;
      if (batch.length) review.createReviewItems(batch);
      if (index < missing.length) {
        timeoutId = window.setTimeout(createNextBatch, 50);
      }
    };

    timeoutId = window.setTimeout(createNextBatch, 0);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [
    artifactIdRoot,
    artifactType,
    definition.sourceFeature,
    definition.sourceMethod,
    enabled,
    projectId,
    review,
    reviewColumns,
    reviewItems,
    rows,
    sourceRunId,
  ]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!artifactType || typeof window === "undefined" || typeof setRows !== "function") return undefined;
    const handleUpdated = (event) => {
      const item = event.detail?.reviewItem;
      if (!item || item.artifactType !== artifactType) return;
      const reviewedRow = item.currentContent?.row && typeof item.currentContent.row === "object"
        ? item.currentContent.row
        : null;
      if (!reviewedRow) return;
      const rowId = item.traceLinks?.find((link) => link.type === "artifact_row")?.rowId;
      const reviewedAt = item.reviewedAt || new Date().toISOString();
      setRows((prev) => prev.map((row, rowIndex) => {
        const matches = rowId
          ? rowIdentity(row, rowIndex) === String(rowId)
          : rowIndex === item.currentContent?.rowIndex;
        if (!matches) return row;
        return {
          ...row,
          ...reviewedRow,
          id: reviewedRow.id || row.id,
          internalId: row.internalId,
          sourceArchitectureRefs: Array.isArray(reviewedRow.sourceArchitectureRefs)
            ? reviewedRow.sourceArchitectureRefs
            : row.sourceArchitectureRefs,
          traceLinks: Array.isArray(reviewedRow.traceLinks) ? reviewedRow.traceLinks : row.traceLinks,
          reviewerNotes: item.reviewerFeedback || row.reviewerNotes || "",
          approvedAt: [
            REVIEW_STATUSES.APPROVED_AS_IS,
            REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS,
          ].includes(item.status) ? reviewedAt : null,
          updatedAt: reviewedAt,
        };
      }));
    };
    window.addEventListener("xhandle:results-review:item-updated", handleUpdated);
    return () => window.removeEventListener("xhandle:results-review:item-updated", handleUpdated);
  }, [artifactType, enabled, setRows]);

  const statusCounts = useMemo(() => {
    const counts = {};
    reviewItems.forEach((item) => {
      const label = REVIEW_STATUS_LABELS[item.status] || "Pending Review";
      counts[label] = (counts[label] || 0) + 1;
    });
    return counts;
  }, [reviewItems]);

  const reviewDrawerOptions = useMemo(() => ({
    sourceFeature: definition.sourceFeature,
    sourceMethod: definition.sourceMethod,
    sourceRunId,
    artifactType,
    reviewItemIds: reviewItems.map((item) => item.id),
  }), [artifactType, definition.sourceFeature, definition.sourceMethod, reviewItems, sourceRunId]);

  return {
    reviewItems,
    reviewByRow,
    reviewDrawerOptions,
    statusCounts,
  };
}
