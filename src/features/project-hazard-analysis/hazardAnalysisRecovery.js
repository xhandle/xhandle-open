const itemTimestamp = (item = {}) => (
  Date.parse(item.updatedAt || item.createdAt || 0) || 0
);

export function getProjectHazardSummaryReviewItems(items = [], projectId = "", sourceRunId = "") {
  if (!projectId) return [];
  const artifactPrefix = `hazard-summary:${projectId}:row:`;
  return (Array.isArray(items) ? items : []).filter((item) => (
    item?.sourceFeature === "AI Hazard Analysis"
    && item?.artifactType === "hazard_summary_table"
    && (item?.projectId === projectId || String(item?.artifactId || "").startsWith(artifactPrefix))
    && (!sourceRunId || item?.sourceRunId === sourceRunId)
  ));
}

export function buildHazardAnalysisRecovery(reviewItems = []) {
  const usableItems = (Array.isArray(reviewItems) ? reviewItems : [])
    .filter((item) => (
      Array.isArray(item?.currentContent?.row)
      && Array.isArray(item?.currentContent?.columns)
    ));
  if (!usableItems.length) return null;

  const latestItem = [...usableItems].sort((left, right) => itemTimestamp(right) - itemTimestamp(left))[0];
  const sourceRunId = latestItem?.sourceRunId || "";
  const runItems = usableItems
    .filter((item) => !sourceRunId || item.sourceRunId === sourceRunId)
    .sort((left, right) => (
      Number(left.currentContent?.rowIndex ?? left.originalContent?.rowIndex ?? 0)
      - Number(right.currentContent?.rowIndex ?? right.originalContent?.rowIndex ?? 0)
    ));
  if (!runItems.length) return null;

  const columns = runItems[0].currentContent.columns;
  return {
    analysisResult: { Summary: [columns, ...runItems.map((item) => item.currentContent.row)] },
    columns,
    sourceMethod: latestItem?.sourceMethod || "",
    sourceRunId,
  };
}
