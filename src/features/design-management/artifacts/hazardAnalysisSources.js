import { loadProjectHazardAnalysisRecordState } from '../../project-hazard-analysis/projectHazardAnalysisStorage';
import { createHazardRowNormalizer } from '../../project-hazard-analysis/classificationResolutionStatus';
import { getLatestCodeArchitectureHazardRun } from '../../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { openHazardSchema } from '../../code-architecture-hazard-analysis/hazardSchema';
import { createHazardRequirementSource } from '../../code-architecture-hazard-analysis/hazardRequirementSummary';
import { PAGED_HAZARD } from '../../code-architecture-hazard-analysis/hazardRowIndex';
import { readHazardTransaction } from '../../code-architecture-hazard-analysis/readHazardTransaction';
import { semanticHash } from './artifactModel';
import { DOCUMENT_EVIDENCE_LIMIT } from './artifactSize';
import { hazardTrackingProjection } from './hazardTrackingFields';

const clean = value => typeof value === 'string' ? value.trim() : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const read = (storage, key, fallback) => JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
const area = owner => owner.workspaceType === 'functional' ? 'Projects' : 'Code-Based Architecture';
const missing = (owner, name) => new Error(`Perform hazard analysis for ${name} in ${area(owner)} before creating a Hazard Tracking List or Safety Requirements document.`);
const ownerKey = owner => `${owner.workspaceType}:${owner.id}`;

// Read only saved hazard summaries. Repository snapshots and historical runs are
// not document inputs. The latest saved result for each repository stays distinct.
async function codeSources(owner, storage, { signal } = {}) {
  const db = await openHazardSchema({ signal });
  let metadata;
  try { metadata = await readHazardTransaction(db, 'runMetadata', store => store.index('projectId').getAll(String(owner.id)), { signal }); }
  finally { db.close(); }
  const legacy = read(storage, 'xhandle:code-architecture-hazard-analysis:v1', {}).hazardAnalysisRuns || [];
  const fallback = legacy.filter(run => String(run.projectId) === String(owner.id));
  const repos = new Set([...metadata, ...fallback].map(run => String(run.repoId || '')));
  const project = read(storage, 'xhandle.codeArchitectureProjects', []).find(project => String(project.id) === String(owner.id));
  const groups = [];
  for (const repo of project?.repos || []) {
    const aliases = [...new Set([repo.id, repo.repoId, repo.repoName].filter(Boolean).map(String))].filter(id => repos.has(id));
    if (!aliases.length) continue;
    groups.push(aliases); aliases.forEach(id => repos.delete(id));
  }
  groups.push(...[...repos].sort().map(id => [id]));
  const latest = runs => runs.sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0))[0];
  const sources = [];
  for (const aliases of groups) {
    const selected = latest(metadata.filter(run => aliases.includes(String(run.repoId || ''))));
    const run = selected ? await getLatestCodeArchitectureHazardRun({ projectId: String(owner.id), id: selected.id }, { signal, paged: true, summaryOnly: true, expectedRevision: selected.storageRevision })
      : latest(fallback.filter(run => aliases.includes(String(run.repoId || ''))));
    if (!run) continue;
    if (run.finalSavePending || (run.runState && !['complete', 'completed', 'ready', 'accepted'].includes(run.runState))) throw new Error(`Finish and save the hazard analysis for ${run.repoId || owner.id} in Code-Based Architecture before creating safety documents.`);
    sources.push({ run: createHazardRequirementSource(run), analysisId: run.id, repoId: run.repoId || null, method: run.hazardMethod || 'Recorded hazard analysis' });
  }
  return sources;
}

// Availability never reads paged row bodies or assembles a document manifest.
// Full evidence capture remains mandatory when creating/generating a document.
export async function readHazardAnalysisAvailability(owners, storage = localStorage, options = {}) {
  let rows = 0, analyses = 0;
  for (const owner of owners) {
    if (options.signal?.aborted) throw new DOMException('Hazard check cancelled.', 'AbortError');
    const catalog = read(storage, owner.workspaceType === 'functional' ? 'xhandle.projects' : 'xhandle.codeArchitectureProjects', []);
    const project = catalog.find(project => String(project.id) === String(owner.id));
    if (!project) throw new Error('An owning project is unavailable or has been deleted.');
    const sources = owner.workspaceType === 'functional' ? await functionalSources(owner, storage) : await codeSources(owner, storage, options);
    let ownerRows = 0;
    for (const { run } of sources) {
      const count = run?.[PAGED_HAZARD]?.total ?? run?.summaryRows?.length ?? Math.max(0, (run?.generatedSheets?.Summary?.length || 0) - 1);
      if (count > 0) { ownerRows += count; analyses++; }
    }
    if (!ownerRows) throw missing(owner, project.name || project.title || String(owner.id));
    rows += ownerRows;
  }
  return { rows, analyses };
}

async function functionalSources(owner, storage) {
  const result = await loadProjectHazardAnalysisRecordState(owner.id);
  if (['error', 'unavailable'].includes(result.status)) throw new Error(`Could not read saved hazard analysis in Projects: ${result.error?.message || 'storage is unavailable'}. Retry after storage is available.`);
  // Older workspaces keep analysis in projectData until the project is opened.
  // A durable empty record is authoritative and must not revive cleared results.
  const record = result.record || read(storage, 'xhandle.projectData', {})[owner.id];
  return record?.analysisResult ? [{ run: { generatedSheets: { Summary: record.analysisResult.Summary } }, risks: record.riskRegister || [], analysisId: `project-hazards:${owner.id}`, revision: record.revision || null, method: record.analysisResult.hazardMethod || 'Project hazard analysis' }] : [];
}

export async function captureHazardAnalysisSources(owners, storage = localStorage, { templateId, signal, onProgress } = {}) {
  const tracking = templateId === 'hazard-tracking-list';
  const entries = [];
  const identities = new Set();
  const totals = { bytes: 0 };
  for (const owner of owners) {
    const catalog = read(storage, owner.workspaceType === 'functional' ? 'xhandle.projects' : 'xhandle.codeArchitectureProjects', []);
    const project = catalog.find(project => String(project.id) === String(owner.id));
    if (!project) throw new Error('An owning project is unavailable or has been deleted.');
    const name = project.name || project.title || String(owner.id);
    const analyses = owner.workspaceType === 'functional' ? await functionalSources(owner, storage) : await codeSources(owner, storage, { signal });
    const ownerTotals = { rows: 0 };
    for (const analysis of analyses) {
      let normalizer, projectTracking;
      const add = (headers, rows, offset, records = false) => {
        if (!records && tracking && !projectTracking) projectTracking = hazardTrackingProjection(headers);
        if (!records && !tracking && !normalizer) normalizer = createHazardRowNormalizer(headers);
        rows.forEach((raw, index) => {
          if (records ? (!raw || typeof raw !== 'object' || Array.isArray(raw)) : !Array.isArray(raw)) throw new Error(`${name}: a saved hazard analysis row is invalid.`);
          const selected = tracking ? (records ? hazardTrackingProjection(Object.keys(raw))(Object.values(raw)) : projectTracking(raw)) : null;
          const row = records || tracking ? null : normalizer.normalizeRow(raw, offset + index);
          const cells = tracking ? selected.attributes : records ? Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, clean(value)])) : Object.fromEntries(normalizer.headers.map((header, column) => [header, clean(row[column])]));
          if (!tracking && !Object.entries(cells).some(([key, value]) => !/^(raw analysis row id|classification resolution status)$/i.test(key) && value)) return;
          const rowId = selected?.sourceRowId || cells['Raw Analysis Row ID'] || cells['Analysis Row ID'] || cells.id || `legacy-${semanticHash(cells)}-${offset + index}`;
          const id = tracking ? `hazard:${semanticHash([ownerKey(owner), analysis.analysisId, String(rowId)])}` : `hazard:${encodeURIComponent(ownerKey(owner))}:${encodeURIComponent(analysis.analysisId)}:${encodeURIComponent(String(rowId))}`;
          if (identities.has(id)) throw new Error(`${name}: duplicate hazard analysis row identity. Repair the analysis before generating.`);
          identities.add(id);
          const hazard = cells.Hazard || cells.Hazards || cells.hazard || cells['Unsafe Control Action'] || cells['Causal Scenario'];
          const entry = { id, sourceType: 'hazard-analysis-row', title: tracking ? `Analysis row ${rowId}` : `${name}${analysis.repoId ? ` / ${analysis.repoId}` : ''} — ${hazard || rowId}`, ownerProjects: [{ id: String(owner.id), workspaceType: owner.workspaceType }], projectName: name, analysisId: analysis.analysisId, analysisRevision: tracking ? null : analysis.revision || null, repoId: analysis.repoId || null, hazardMethod: analysis.method, sourceRowId: String(rowId), attributes: cells, ...(!tracking ? { text: Object.entries(cells).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join('\n') } : {}) };
          const related = tracking ? [] : (analysis.risks || []).filter(risk => risk.sourceRowIds?.map(String).includes(String(rowId)) || (!risk.sourceRowIds?.length && [...(risk.sourceIndexes || []), risk.sourceIndex].map(Number).includes(offset + index + 1)));
          if (related.length) { entry.relatedSafetyIssues = related; entry.text += `\nRecorded safety issues: ${JSON.stringify(related)}`; }
          if (!tracking) totals.bytes += JSON.stringify(entry).length;
          if (!tracking && totals.bytes > DOCUMENT_EVIDENCE_LIMIT) throw new Error('Saved hazard evidence exceeds the document evidence limit. Split the analysis scope before creating this document. No rows were discarded.');
          entries.push(entry); ownerTotals.rows++;
        });
      };
      if (analysis.run?.readSummaryBatches) {
        for await (const page of analysis.run.readSummaryBatches(signal, progress => onProgress?.({ ...progress, stage: 'Reading saved hazard analysis', projectName: name }))) add(page.headers, page.rows, page.offset, page.records);
      } else if (analysis.run?.summaryRows?.length) add([], analysis.run.summaryRows, 0, true);
      else {
        const summary = analysis.run?.generatedSheets?.Summary;
        if (summary != null && (!Array.isArray(summary) || (summary.length && !Array.isArray(summary[0])))) throw new Error(`${name}: the saved hazard analysis table is invalid.`);
        if (summary?.length > 1) add(summary[0], summary.slice(1), 0);
      }
    }
    if (!ownerTotals.rows) throw missing(owner, name);
  }
  return tracking ? entries : entries.sort((a, b) => a.id.localeCompare(b.id));
}
