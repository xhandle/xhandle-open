import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { webcrypto } from 'crypto';
import { serialize, deserialize } from 'v8';
import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun, openCodeArchitectureHazardDB } from './codeArchitectureHazardStore';
import { resolveSoftwareHazardSource } from '../code-architecture-assurance/softwareHazardSource';
import { createHazardRequirementSource } from './hazardRequirementSummary';
import { PAGED_HAZARD } from './hazardRowIndex';

beforeEach(() => {
  global.indexedDB = new IDBFactory(); global.IDBKeyRange = IDBKeyRange;
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true}); localStorage.clear();
});
const fixture = (id, repoId, updatedAt) => ({id,projectId:'summary-project',repoId,updatedAt,runState:'complete',hazardMethod:'STPA',
  architectureRowsSnapshot:['evidence '.repeat(100000)], narrativeReview:{text:'narrative '.repeat(100000)},
  generatedSheets:{Summary:[['Hazard','Software Safety Requirement'],...Array.from({length:301},(_,i)=>['Hazard '+i,'Prevent unsafe command '+i])]}});

test('alias selection reads metadata only, then streams the chosen Summary without full evidence', async () => {
  await saveCodeArchitectureHazardRun(fixture('old','alias','2026-10-01'));
  await saveCodeArchitectureHazardRun(fixture('latest','owner/repo','2026-11-01'));
  const get = jest.spyOn(IDBObjectStore.prototype,'get');
  try {
    const source = await resolveSoftwareHazardSource({projectId:'summary-project',repo:{id:'alias',repoId:'owner/repo'}});
    expect(source.id).toBe('latest');
    expect(source.architectureRowsSnapshot).toBeUndefined();
    expect(source.narrativeReview).toBeUndefined();
    expect(source.generatedSheets).toBeUndefined();
    expect(get.mock.instances.filter(store=>store.name==='hazardRunChunks')).toHaveLength(0);
    const seen = [];
    for await (const page of source.readSummaryBatches()) {
      expect(page.rows.length).toBeLessThanOrEqual(100);
      seen.push(...page.rows.map(row=>row[0]));
    }
    expect(seen).toHaveLength(301); expect(seen[300]).toBe('Hazard 300');
  } finally { get.mockRestore(); }
});

test('a changed saved run cannot mix Summary revisions', async () => {
  const run = fixture('changing','repo','2026-11-01'); await saveCodeArchitectureHazardRun(run);
  const source = await resolveSoftwareHazardSource({projectId:run.projectId,repo:{id:run.repoId}});
  const pages = source.readSummaryBatches(); await pages.next();
  await saveCodeArchitectureHazardRun({...run,updatedAt:'2026-11-02'});
  await expect(pages.next()).rejects.toThrow('changed');
});

test('legacy chunked indexes are prepared without hydrating evidence; atomic legacy records project Summary only', async () => {
  const run = fixture('legacy','repo','2026-11-01'); await saveCodeArchitectureHazardRun(run);
  const db = await openCodeArchitectureHazardDB();
  const root = await db.get('hazardAnalysisRuns',run.id); delete root.payload.rowIndex;
  await db.put('hazardAnalysisRuns',root); db.close();
  const source = await resolveSoftwareHazardSource({projectId:run.projectId,repo:{id:run.repoId}});
  expect(source[PAGED_HAZARD].total).toBe(301);
  const legacyDB = await openCodeArchitectureHazardDB();
  await legacyDB.put('hazardAnalysisRuns',{...run,id:'atomic',repoId:'atomic'});
  await legacyDB.put('runMetadata',{id:'atomic',projectId:run.projectId,repoId:'atomic',updatedAt:run.updatedAt}); legacyDB.close();
  const atomic = await getLatestCodeArchitectureHazardRun({projectId:run.projectId,repoId:'atomic'},{summaryOnly:true,paged:true,workingSet:true});
  expect(atomic.generatedSheets.Summary).toEqual(run.generatedSheets.Summary);
  expect(atomic.architectureRowsSnapshot).toBeUndefined();
});

test('inline projection preserves staleness metadata without retaining unrelated payloads', () => {
  const run = {...fixture('inline','repo','2026-11-01'),analysisAbstraction:'functional',functionalModelSnapshotHash:'old',finalSavePending:true};
  const source = createHazardRequirementSource(run);
  expect(source).toMatchObject({analysisAbstraction:'functional',functionalModelSnapshotHash:'old',finalSavePending:true});
  expect(source.generatedSheets.Summary).toBe(run.generatedSheets.Summary);
  expect(source.narrativeReview).toBeUndefined();
});

test.each(['analysisResult','summaryRows'])('streams legacy %s safety inputs without silently omitting them', async format => {
  const run = fixture('old-format', 'repo', '2026-11-01');
  const summary = run.generatedSheets.Summary; delete run.generatedSheets;
  if (format === 'analysisResult') run.analysisResult = {Summary:summary};
  else run.summaryRows = summary.slice(1).map(row=>({Hazard:row[0],'Software Safety Requirement':row[1]}));
  await saveCodeArchitectureHazardRun(run);
  const source = await resolveSoftwareHazardSource({projectId:run.projectId,repo:{id:run.repoId}});
  const rows = [];
  for await (const page of source.readSummaryBatches()) rows.push(...page.rows);
  expect(rows).toHaveLength(301);
  if (format === 'analysisResult') expect(rows[300][0]).toBe('Hazard 300');
  else expect(rows[300].Hazard).toBe('Hazard 300');
});

test.each([true,false])('generated Summary takes precedence regardless of property order (%s)', async generatedFirst => {
 const run = fixture('precedence', 'repo', '2026-11-01');
 const generatedSheets = run.generatedSheets; delete run.generatedSheets;
 const old = {Summary:[['Hazard','Software Safety Requirement'],['WRONG','Wrong requirement']]};
 Object.assign(run,generatedFirst ? {generatedSheets,analysisResult:old} : {analysisResult:old,generatedSheets});
 await saveCodeArchitectureHazardRun(run);
 const source = await resolveSoftwareHazardSource({projectId:run.projectId,repo:{id:run.repoId}});
 const first = (await source.readSummaryBatches().next()).value;
 expect(first.rows[0][0]).toBe('Hazard 0'); expect(source[PAGED_HAZARD].total).toBe(301);
});
