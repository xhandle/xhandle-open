import {PAGED_HAZARD} from './hazardRowIndex';
import PagedHazardPanel from './PagedHazardPanel';
import HazardRestorationNotice from './HazardRestorationNotice';
import React, { useEffect, useMemo, useRef } from 'react';
import { PreparedCodeArchitectureHazardPanel } from './CodeArchitectureHazardPanel';
import TablePreparationProgress from '../code-architecture-assurance/TablePreparationProgress';
import { createHazardRowNormalizer } from '../project-hazard-analysis/classificationResolutionStatus';
import { fillNotApplicableHazardCells } from '../project-hazard-analysis/hazardNotApplicableCells';
import { buildFunctionalModelRows, functionalModelIsReady } from '../code-architecture-context/functionalModel';
import { effectiveCodeArchitectureHazardRows, isCodeArchitectureHazardAnalysisStale } from './codeArchitectureHazardUtils';
import { summarizeCodeArchitectureHazardEligibility } from './codeArchitectureHazardEligibility';
import useHazardPreparation from './useHazardPreparation';
import { cacheableHazardPreparation, hazardPreparationInputs, samePreparationInputs } from './hazardPreparationCache';

const EMPTY = [];
const same = samePreparationInputs;

export default function SavedHazardPanelLoader(props) {
  return props.latestRun?.[PAGED_HAZARD] ? <PagedHazardPanel key={`${props.latestRun.id}:${props.latestRun[PAGED_HAZARD].revision}`} {...props} /> : <CompleteSavedHazardPanel {...props} />;
}
function CompleteSavedHazardPanel(props) {
  const { latestRun: run, cbaRows = EMPTY, operationalContexts = EMPTY, selectedOperationalContextId = 'all', organizationContext } = props;
  const sheet = run?.generatedSheets?.Summary;
  const mounted = useRef(null);
  // Displayed small runs have no prepared snapshot, but still own live table state.
  const displayedScope = useRef(null);
  const scope = JSON.stringify([run?.projectId, run?.repoId, run?.id]);
  const inputs = hazardPreparationInputs(props);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const keys = useMemo(() => inputs, inputs);
  const external = props.preparationCache?.current;
  const previous = mounted.current || (same(external?.keys, keys) ? external : null);
  // Once displayed, preserve the panel lifecycle for every same-run update:
  // edits, context selection, metadata refresh and partial generation results.
  const updatingMountedRun = displayedScope.current === scope && !same(previous?.keys, keys);
  const large = (sheet?.length || 0) > 501 && !updatingMountedRun;
  const retainedSummary = useMemo(() => previous?.scope === scope && previous.sheet === sheet
    ? { summarySheet: previous.result.summarySheet } : undefined, [previous, scope, sheet]);
  const job = useMemo(() => function* prepare() {
    const normalizer = createHazardRowNormalizer(sheet[0]);
    const summarySheet = [normalizer.headers];
    const total = sheet.length - 1 + 3;
    for (let i = 1; i < sheet.length; i++) {
      summarySheet.push(fillNotApplicableHazardCells(normalizer.headers, normalizer.normalizeRow(sheet[i], i - 1)));
      if (i % 100 === 0) yield Math.floor(i * 100 / total);
    }
    yield Math.floor((sheet.length - 1) * 100 / total);
    const functionalReady = functionalModelIsReady(cbaRows);
    const functionalTraceIds = functionalReady
      ? new Set(buildFunctionalModelRows(cbaRows).map(row => row.traceId)) : new Set();
    yield Math.floor(sheet.length * 100 / total);
    const eligibilitySummary = summarizeCodeArchitectureHazardEligibility(effectiveCodeArchitectureHazardRows(cbaRows));
    yield Math.floor((sheet.length + 1) * 100 / total);
    const isStale = isCodeArchitectureHazardAnalysisStale({run, cbaRows, operationalContexts, selectedOperationalContextId, organizationContext});
    const result = {summarySheet, functionalReady, functionalTraceIds, eligibilitySummary, isStale};
    if (props.preparationCache && !props.preparationCache.retired) {
      props.preparationCache.current = cacheableHazardPreparation(result)
        ? {scope, sheet, keys, result} : null;
    }
    return result;
  // Cache invalidation follows actual saved content/freshness inputs, not unrelated run metadata.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...keys, props.preparationCache]);
  if (props.preparationCache?.current && !same(props.preparationCache.current.keys, keys)) props.preparationCache.current = null;
  const cached = large && same(previous?.keys, keys) ? previous.result : null;
  const preparation = useHazardPreparation(job, large ? cached : EMPTY);
  useEffect(() => {
    displayedScope.current = !large || preparation.result ? scope : null;
    if (preparation.result && large) mounted.current = { scope, sheet, keys, result: preparation.result };
  }, [preparation.result, large, scope, sheet, keys]);
  if (!large) return <PreparedCodeArchitectureHazardPanel {...props} preparedView={retainedSummary} />;
  if (preparation.error || !preparation.result) return <div className="flex h-full min-h-0 flex-col">
    <HazardRestorationNotice restoration={props.restoration} latestRun={run} isRunning={props.isRunning} showLoading={false} />
    {props.isRunning && <div className="flex items-center gap-3 p-3">
      <TablePreparationProgress label={props.progress?.message || 'Running hazard analysis'} className="!p-0" />
      {!props.reviewMode && <button type="button" className="rounded border border-rose-200 px-3 py-2 text-rose-700" onClick={props.onCancelAnalysis}>Stop analysis</button>}
    </div>}
    {preparation.error
      ? <div role="alert">Unable to prepare saved hazard results: {preparation.error.message}</div>
      : !props.isRunning && props.restoration?.status !== 'upgrading' && <TablePreparationProgress label="Preparing saved hazard results" progress={preparation.progress} />}
  </div>;
  return <PreparedCodeArchitectureHazardPanel {...props} preparedView={preparation.result} />;
}
