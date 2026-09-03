export function buildProjectHazardDiagramSummary(headers = [], displayRows = []) {
  const uniqueGeneratedRows = new Map();

  (Array.isArray(displayRows) ? displayRows : []).forEach((item, displayIndex) => {
    if (!item?.generated || !Array.isArray(item.row)) return;
    const sourceIndex = Number.isFinite(Number(item.originalIndex))
      ? Number(item.originalIndex)
      : displayIndex;
    const identity = String(item.rowKey || sourceIndex);
    uniqueGeneratedRows.set(identity, {
      row: item.row,
      sourceIndex,
      displayIndex,
    });
  });

  const generatedRows = Array.from(uniqueGeneratedRows.values())
    .sort((left, right) => left.sourceIndex - right.sourceIndex || left.displayIndex - right.displayIndex);

  return {
    summary: generatedRows.length
      ? [Array.isArray(headers) ? headers : [], ...generatedRows.map((item) => item.row)]
      : null,
    sourceIndexes: generatedRows.map((item) => item.sourceIndex),
  };
}

export function resolveProjectHazardArtifactNavigation(artifact = {}, riskMethod = "") {
  if (!/^hazard_(analysis|summary)_row$/i.test(String(artifact?.type || ""))) return null;

  const sourceId = String(artifact?.sourceId || "");
  const structuredIndex = Number(artifact?.structuredData?.rowIndex);
  const completedMatch = sourceId.match(/analysisResult:Summary:(?<index>\d+)$/i);
  const draftMatch = sourceId.match(/draftHazardRowsByIndex:(?<functionalRowIndex>\d+):guide:(?<guidePhraseIndex>\d+)$/i);
  let rowIndex = Number.isFinite(structuredIndex) ? structuredIndex : null;

  if (rowIndex == null && completedMatch?.groups?.index != null) {
    rowIndex = Number(completedMatch.groups.index);
  }
  if (rowIndex == null && draftMatch?.groups) {
    const guidePhraseCount = riskMethod === "STPA-Textbook" || riskMethod === "STPA" ? 7 : 1;
    rowIndex = (Number(draftMatch.groups.functionalRowIndex) * guidePhraseCount)
      + Number(draftMatch.groups.guidePhraseIndex);
  }
  if (!Number.isFinite(rowIndex)) return null;

  const draft = Boolean(artifact?.structuredData?.draft) || /draftHazardRowsByIndex:/i.test(sourceId);
  return {
    rowIndex,
    artifactType: draft ? "hazard_summary_draft_table" : "hazard_summary_table",
  };
}
