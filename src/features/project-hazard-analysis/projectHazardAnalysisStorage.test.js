import { openDB } from "idb";
import { installFakeIndexedDb } from "./testSupport/fakeIndexedDb";
import {
  HAZARD_WRITE_OUTCOME,
  checkpointHazardAnalysis,
  deleteProjectHazardAnalysisRecord,
  listHazardAnalysisRevisions,
  loadProjectHazardAnalysisRecord,
  loadProjectHazardAnalysisRecordState,
  readHazardAnalysisRevision,
  resetLocalRevisionTracking,
  releaseHazardCheckpoint,
  restoreHazardAnalysisRevision,
  saveHazardAnalysis,
  saveProjectHazardAnalysisRecord,
  switchProjectHazardMethod,
  loadProjectHazardReuseState, saveProjectStpaFoundation, clearProjectHazardMethodResults, restoreProjectHazardMethodState,
} from "./projectHazardAnalysisStorage";

import { planHazardAnalysisCsvImport, applyHazardAnalysisCsvImport, applyHazardCsvImportToDrafts } from "./hazardAnalysisCsv";

jest.mock("idb", () => ({
  __esModule: true,
  openDB: jest.fn(),
}));

const analysis = (label, rows = 1) => ({
  Summary: [["Hazard"], ...Array.from({ length: rows }, (_, index) => [`${label}-${index}`])],
});

let getDb;

beforeEach(() => {
  openDB.mockReset();
  resetLocalRevisionTracking();
  getDb = installFakeIndexedDb(openDB, {
    stores: [{ name: "analyses", keyPath: "projectId" }, { name: "analysisRevisions", keyPath: "key" }],
  });
  getDb().createObjectStore("analyses", { keyPath: "projectId" });
  getDb().createObjectStore("analysisRevisions", { keyPath: "key" });
});

const headOf = (projectId = "project-1") => getDb()._dump("analyses")[projectId];
const revisionsOf = (projectId = "project-1") =>
  getDb()._rows("analysisRevisions").filter((entry) => entry.projectId === projectId);

test('legacy JSON signatures migrate without duplicating an identical revision or losing a pin', async () => {
  const content = { analysisResult: analysis('legacy'), draftHazardRowsByIndex: {}, riskRegister: [] };
  await getDb().put('analyses', { projectId: 'project-1', ...content, revision: 7, contentSignature: JSON.stringify(content) });
  await getDb().put('analysisRevisions', { projectId: 'project-1', ...content, revision: 7, key: 'project-1::0000000007', pinned: true });
  const saved = await saveHazardAnalysis('project-1', content);
  expect(saved.outcome).toBe(HAZARD_WRITE_OUTCOME.UNCHANGED);
  expect(headOf().revision).toBe(7);
  expect(headOf().contentSignature).toMatch(/^sha256-tree-v1:[a-f0-9]{64}$/);
  expect(revisionsOf()).toHaveLength(1);
  expect(revisionsOf()[0].pinned).toBe(true);
});

describe('independent method analyses', () => {
  it('does not replace an edit that committed while a method-change snapshot was waiting', async () => {
    await saveHazardAnalysis('project-1',{method:'STPA-Textbook',analysisResult:analysis('before edit')});
    await saveHazardAnalysis('project-1',{method:'STPA-Textbook',analysisResult:analysis('edited')},{reason:'manual-cell-edit'});
    await switchProjectHazardMethod('project-1','STPA-Textbook','HARA',{analysisResult:analysis('before edit')},1);
    await switchProjectHazardMethod('project-1','HARA','STPA-Textbook',{},headOf().revision);
    expect(headOf().analysisResult).toEqual(analysis('edited'));
  });
  it('keeps the active method and analysis if a method switch head write fails', async () => {
    await saveHazardAnalysis('project-1',{method:'STPA-Textbook',analysisResult:analysis('STPA')});
    getDb()._failures.set('analyses:put',Object.assign(new Error('Storage quota reached'),{name:'QuotaExceededError'}));
    const result=await switchProjectHazardMethod('project-1','STPA-Textbook','HARA');
    expect(result.status).toBe('quota'); expect(headOf().method).toBe('STPA-Textbook');
    expect(headOf().analysisResult).toEqual(analysis('STPA'));
  });
  it('round trips STPA and HARA, including pending draft edits and risk registers', async () => {
    await saveHazardAnalysis('project-1', {method:'STPA-Textbook',analysisResult:analysis('STPA'),riskRegister:[{id:'stpa-risk'}]});
    const switched = await switchProjectHazardMethod('project-1','STPA-Textbook','HARA', {analysisResult:analysis('STPA edited'),draftHazardRowsByIndex:{pending:{row:['edit']}}},1);
    expect(switched.status).toBe('ok'); expect(headOf().analysisResult).toBeNull();
    await saveHazardAnalysis('project-1', {method:'HARA',analysisResult:analysis('HARA'),draftHazardRowsByIndex:{hara:{row:['HARA']}}});
    await switchProjectHazardMethod('project-1','HARA','STPA-Textbook',{},headOf().revision);
    expect(headOf()).toMatchObject({method:'STPA-Textbook',analysisResult:analysis('STPA edited'),draftHazardRowsByIndex:{pending:{row:['edit']}},riskRegister:[{id:'stpa-risk'}]});
    await switchProjectHazardMethod('project-1','STPA-Textbook','HARA',{},headOf().revision);
    expect(headOf()).toMatchObject({method:'HARA',analysisResult:analysis('HARA'),draftHazardRowsByIndex:{hara:{row:['HARA']}}});
    const history = await listHazardAnalysisRevisions('project-1');
    expect(history.revisions.every(entry => entry.recordType !== 'method-snapshot')).toBe(true);
  });
  it('rejects an old method autosave after switching and removes method snapshots when deleting', async () => {
    await saveHazardAnalysis('project-1',{method:'STPA-Textbook',analysisResult:analysis('STPA')});
    await switchProjectHazardMethod('project-1','STPA-Textbook','HARA');
    const stale = await saveHazardAnalysis('project-1',{method:'STPA-Textbook',analysisResult:analysis('stale')});
    expect(stale.outcome).toBe('stale'); expect(headOf().method).toBe('HARA');
    await deleteProjectHazardAnalysisRecord('project-1');
    expect(revisionsOf()).toHaveLength(0);
  });
});

describe("persisting the analysis", () => {
  it("stores the analysis, draft rows, and risks together", async () => {
    const result = await saveHazardAnalysis("project-1", {
      analysisResult: analysis("hazard"),
      draftHazardRowsByIndex: { "0:a": { generated: true } },
      riskRegister: [{ id: "risk-1" }],
    });

    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.OK);
    expect(headOf()).toMatchObject({
      projectId: "project-1",
      draftHazardRowsByIndex: { "0:a": { generated: true } },
      riskRegister: [{ id: "risk-1" }],
      revision: 1,
    });
  });

  it("keeps the boolean contract for existing callers", async () => {
    await expect(saveProjectHazardAnalysisRecord("project-1", { analysisResult: analysis("a") }))
      .resolves.toBe(true);
    await expect(saveProjectHazardAnalysisRecord("project-1", { analysisResult: null }))
      .resolves.toBe(false);
  });

  it("preserves fields omitted by a partial save", async () => {
    await saveHazardAnalysis("project-1", {
      analysisResult: analysis("hazard"),
      draftHazardRowsByIndex: { existing: true },
      riskRegister: [{ id: "risk-1" }],
    });

    await saveHazardAnalysis("project-1", { riskRegister: [{ id: "risk-2" }] });

    expect(headOf()).toMatchObject({
      analysisResult: analysis("hazard"),
      draftHazardRowsByIndex: { existing: true },
      riskRegister: [{ id: "risk-2" }],
    });
  });

  it("refuses to replace a populated analysis with empty state", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("hazard") });

    const result = await saveHazardAnalysis("project-1", { analysisResult: null });

    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.BLOCKED_CLEAR);
    expect(headOf().analysisResult).toEqual(analysis("hazard"));
  });

  it("allows an empty write only through the explicit clear workflow", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("hazard") });

    const result = await saveHazardAnalysis("project-1", { analysisResult: null },
      { allowAnalysisClear: true, reason: "explicit-user-clear" });

    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.OK);
    expect(headOf()).toMatchObject({ analysisResult: null, lastWriteReason: "explicit-user-clear" });
  });

  it("distinguishes a read failure from a genuinely missing record", async () => {
    getDb()._failures.set("analyses:get", new Error("IndexedDB transaction failed"));
    await expect(loadProjectHazardAnalysisRecordState("project-1")).resolves.toMatchObject({ status: "error" });
    getDb()._failures.clear();
    await expect(loadProjectHazardAnalysisRecordState("project-1")).resolves.toMatchObject({ status: "missing" });
  });

  it("reports quota exhaustion distinctly from an ordinary write error", async () => {
    const quota = new Error("The quota has been exceeded.");
    quota.name = "QuotaExceededError";
    getDb()._failures.set("analysisRevisions:put", quota);

    const result = await saveHazardAnalysis("project-1", { analysisResult: analysis("hazard") });
    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.QUOTA);
  });
});

describe("compare-and-set", () => {
  it("refuses a writer holding a revision another context has moved past", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("first") });
    await saveHazardAnalysis("project-1", { analysisResult: analysis("second") });
    expect(headOf().revision).toBe(2);
    // Revision tracking is per browsing context; clearing it is how a test marks
    // "everything after this point belongs to a different tab".
    resetLocalRevisionTracking();

    const result = await saveHazardAnalysis("project-1", { analysisResult: analysis("from a stale reader") },
      { expectedRevision: 1 });

    expect(result).toMatchObject({ outcome: HAZARD_WRITE_OUTCOME.STALE, expectedRevision: 1, actualRevision: 2 });
    expect(headOf().analysisResult).toEqual(analysis("second"));
  });

  it("accepts a writer holding the current revision", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("first") });

    const result = await saveHazardAnalysis("project-1", { analysisResult: analysis("second") },
      { expectedRevision: 1 });

    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.OK);
    expect(headOf().revision).toBe(2);
  });

  it("lets the first of two contexts at the same base revision win", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("base") });

    // Tab A commits from base revision 1.
    const tabA = await saveHazardAnalysis("project-1", { analysisResult: analysis("tab-a") }, { expectedRevision: 1 });
    expect(tabA.outcome).toBe(HAZARD_WRITE_OUTCOME.OK);

    // Tab B still holds base revision 1 and has no knowledge of tab A's write.
    resetLocalRevisionTracking();
    const tabB = await saveHazardAnalysis("project-1", { analysisResult: analysis("tab-b") }, { expectedRevision: 1 });

    expect(tabB.outcome).toBe(HAZARD_WRITE_OUTCOME.STALE);
    expect(headOf().analysisResult).toEqual(analysis("tab-a"));
  });

  it("serializes writes so an older save cannot land last", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("base") });
    await Promise.all([
      saveHazardAnalysis("project-1", { analysisResult: analysis("older") }),
      saveHazardAnalysis("project-1", { analysisResult: analysis("newer") }),
    ]);
    expect(headOf().analysisResult).toEqual(analysis("newer"));
  });
});

describe("revision history", () => {
  it("writes the revision before the head so an interrupted write leaves a recoverable copy", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("good") });
    getDb()._failures.set("analyses:put", new Error("disk gave out"));

    const result = await saveHazardAnalysis("project-1", { analysisResult: analysis("interrupted") });

    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.WRITE_ERROR);
    // The head still holds the last good analysis...
    expect(headOf().analysisResult).toEqual(analysis("good"));
    // ...and the interrupted content survives as an orphan revision.
    expect(revisionsOf().some((entry) => entry.analysisResult.Summary[1][0] === "interrupted-0")).toBe(true);
  });

  it("creates no new revision for byte-identical content", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("same") });
    const first = revisionsOf().length;

    const result = await saveHazardAnalysis("project-1", { analysisResult: analysis("same") });

    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.UNCHANGED);
    expect(revisionsOf()).toHaveLength(first);
    expect(headOf().revision).toBe(1);
  });

  it("lists retained revisions oldest first without loading their content", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("one") });
    await saveHazardAnalysis("project-1", { analysisResult: analysis("two", 3) });

    const listing = await listHazardAnalysisRevisions("project-1");

    expect(listing.status).toBe(HAZARD_WRITE_OUTCOME.OK);
    expect(listing.revisions.map((entry) => entry.revision)).toEqual([1, 2]);
    expect(listing.revisions[1].rowCount).toBe(3);
    expect(listing.revisions[1].analysisResult).toBeUndefined();
  });

  it("distinguishes no revisions from unavailable storage", async () => {
    await expect(listHazardAnalysisRevisions("project-1")).resolves.toMatchObject({
      status: HAZARD_WRITE_OUTCOME.OK, revisions: [],
    });

    getDb()._failures.set("analysisRevisions:getAllKeys", new Error("storage offline"));
    await expect(listHazardAnalysisRevisions("project-1")).resolves.toMatchObject({
      status: HAZARD_WRITE_OUTCOME.WRITE_ERROR,
    });
  });

  it("previews a revision without restoring it", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("one") });
    await saveHazardAnalysis("project-1", { analysisResult: analysis("two") });

    const preview = await readHazardAnalysisRevision("project-1", 1);

    expect(preview.status).toBe(HAZARD_WRITE_OUTCOME.OK);
    expect(preview.revision.analysisResult).toEqual(analysis("one"));
    expect(headOf().analysisResult).toEqual(analysis("two"));
  });

  it("restores a revision as a new head without discarding what it replaced", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("wanted") });
    await saveHazardAnalysis("project-1", { analysisResult: analysis("unwanted") });

    const restored = await restoreHazardAnalysisRevision("project-1", 1);

    expect(restored.status).toBe(HAZARD_WRITE_OUTCOME.OK);
    expect(restored.record).toMatchObject({ revision: 3, restoredFromRevision: 1 });
    expect(headOf().analysisResult).toEqual(analysis("wanted"));
    // The replaced state is still available to undo the restore.
    expect(revisionsOf().some((entry) => entry.revision === 2)).toBe(true);
  });

  it("reports a missing revision rather than clearing the head", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("current") });

    const restored = await restoreHazardAnalysisRevision("project-1", 42);

    expect(restored.status).toBe(HAZARD_WRITE_OUTCOME.MISSING);
    expect(headOf().analysisResult).toEqual(analysis("current"));
  });
});

describe("pinned checkpoints", () => {
  it("pins the pre-review state and survives more writes than the retention limit", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("pre-review") });
    const checkpoint = await checkpointHazardAnalysis("project-1", "before-vibe-review");
    expect(checkpoint.status).toBe(HAZARD_WRITE_OUTCOME.UNCHANGED);

    // A review far longer than RETAINED_REVISIONS.
    for (let decision = 0; decision < 20; decision += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveHazardAnalysis("project-1", { analysisResult: analysis(`decision-${decision}`) });
    }

    const pinned = revisionsOf().filter((entry) => entry.pinned);
    expect(pinned).toHaveLength(1);
    expect(pinned[0].analysisResult).toEqual(analysis("pre-review"));
  });

  it("keeps ordinary revisions bounded while a checkpoint is pinned", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("pre-review") });
    await checkpointHazardAnalysis("project-1", "before-vibe-review");
    for (let decision = 0; decision < 40; decision += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveHazardAnalysis("project-1", { analysisResult: analysis(`decision-${decision}`) });
    }
    expect(revisionsOf().length).toBeLessThanOrEqual(8);
  });

  it("releases the pin when the review ends so the checkpoint can be pruned", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("pre-review") });
    const checkpoint = await checkpointHazardAnalysis("project-1", "before-vibe-review");

    await expect(releaseHazardCheckpoint("project-1", checkpoint.revision)).resolves.toBe(true);
    expect(revisionsOf().some((entry) => entry.pinned)).toBe(false);
  });

  it("reports when there is nothing to checkpoint", async () => {
    await expect(checkpointHazardAnalysis("project-1")).resolves.toMatchObject({
      status: HAZARD_WRITE_OUTCOME.MISSING,
    });
  });
});

describe("deleting a project", () => {
  it("removes the head and every revision", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("one") });
    await saveHazardAnalysis("project-1", { analysisResult: analysis("two") });
    await saveHazardAnalysis("project-2", { analysisResult: analysis("other") });
    expect(revisionsOf("project-1").length).toBeGreaterThan(0);

    await expect(deleteProjectHazardAnalysisRecord("project-1")).resolves.toBe(true);

    expect(headOf("project-1")).toBeUndefined();
    expect(revisionsOf("project-1")).toHaveLength(0);
    // Another project's history is untouched.
    expect(revisionsOf("project-2").length).toBeGreaterThan(0);
  });

  it("loads a stored record back through the public reader", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("stored") });
    const record = await loadProjectHazardAnalysisRecord("project-1");
    expect(record.analysisResult).toEqual(analysis("stored"));
  });
});

describe("compare-and-set versus this tab's own background writes", () => {
  it("does not treat a local background write as a conflict", async () => {
    // A review reads revision 1...
    await saveHazardAnalysis("project-1", { analysisResult: analysis("base") });
    const reviewBase = headOf().revision;

    // ...then this tab's debounced autosave lands before the review commits.
    await saveHazardAnalysis("project-1", { analysisResult: analysis("autosave") });

    const result = await saveHazardAnalysis("project-1", { analysisResult: analysis("review-decision") },
      { expectedRevision: reviewBase });

    // Rejecting this is what made every decision fail with "changed in another
    // tab" during a single-tab session.
    expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.OK);
    expect(headOf().analysisResult).toEqual(analysis("review-decision"));
  });

  it("still rejects a revision this context never produced", async () => {
    await saveHazardAnalysis("project-1", { analysisResult: analysis("base") });
    resetLocalRevisionTracking();

    // Another tab advanced the head; we have no record of writing it.
    const other = getDb()._dump("analyses")["project-1"];
    getDb()._dump("analyses");
    await getDb().put("analyses", { ...other, revision: 9, analysisResult: analysis("from another tab") });

    const result = await saveHazardAnalysis("project-1", { analysisResult: analysis("stale writer") },
      { expectedRevision: 1 });

    expect(result).toMatchObject({ outcome: HAZARD_WRITE_OUTCOME.STALE, actualRevision: 9 });
    expect(headOf().analysisResult).toEqual(analysis("from another tab"));
  });
});


it("persists imported Summary and displayed rows together and restores both", async () => {
  const headers = ["Raw Analysis Row ID", "Hazard"];
  const original = { Summary: [headers, ["RAW-1", "old hazard"]] };
  const draftRows = { "context:guide": { generated: true, row: ["RAW-1", "old hazard"] } };
  await saveHazardAnalysis("csv-project", { analysisResult: original, draftHazardRowsByIndex: draftRows });
  const plan = planHazardAnalysisCsvImport(original.Summary, "Raw Analysis Row ID,Hazard\nRAW-1,updated hazard", {
    draftHeaders: headers, draftRows,
  });
  const result = await saveHazardAnalysis("csv-project", {
    analysisResult: { Summary: applyHazardAnalysisCsvImport(original.Summary, plan.updates) },
    draftHazardRowsByIndex: applyHazardCsvImportToDrafts(draftRows, headers, plan.updates),
  }, { reason: "csv-import", expectedRevision: 1 });
  expect(result.outcome).toBe(HAZARD_WRITE_OUTCOME.OK);
  const loaded = await loadProjectHazardAnalysisRecord("csv-project");
  expect(loaded.analysisResult.Summary[1][1]).toBe("updated hazard");
  expect(loaded.draftHazardRowsByIndex["context:guide"].row[1]).toBe("updated hazard");
  await restoreHazardAnalysisRevision("csv-project", 1);
  const restored = await loadProjectHazardAnalysisRecord("csv-project");
  expect(restored.analysisResult.Summary[1][1]).toBe("old hazard");
  expect(restored.draftHazardRowsByIndex["context:guide"].row[1]).toBe("old hazard");
});

test('user preprocessing survives durable save, reload, and revision restoration', async () => {
  const userPreprocessing = { values: { 'Guide Phrase Applicable': 'No' }, basis: { 'Control Action': 'Plan' }, pending: true };
  const first = await saveHazardAnalysis('preprocessing-project', {
    analysisResult: analysis('original'),
    draftHazardRowsByIndex: { row1: { row: ['RAW-1', 'No'], generated: false, userPreprocessing } },
  });
  const saved = await loadProjectHazardAnalysisRecord('preprocessing-project');
  expect(saved.draftHazardRowsByIndex.row1.userPreprocessing).toEqual(userPreprocessing);
  await saveHazardAnalysis('preprocessing-project', {
    analysisResult: analysis('updated'), draftHazardRowsByIndex: {},
  }, { expectedRevision: first.revision });
  const revisions = await listHazardAnalysisRevisions('preprocessing-project');
  expect(revisions.status).toBe(HAZARD_WRITE_OUTCOME.OK);
  // The original revision retains ownership along with the original row values.
  const original = revisionsOf('preprocessing-project').find(entry => entry.draftHazardRowsByIndex?.row1);
  expect(original.draftHazardRowsByIndex.row1.userPreprocessing).toEqual(userPreprocessing);
  await restoreHazardAnalysisRevision('preprocessing-project', first.revision);
  const restored = await loadProjectHazardAnalysisRecord('preprocessing-project');
  expect(restored.draftHazardRowsByIndex.row1.userPreprocessing).toEqual(userPreprocessing);
});

describe('shared STPA foundation and HARA clear scopes',()=>{
 const openHara=async()=>{
  await saveHazardAnalysis('project-1',{method:'STPA-Textbook',analysisResult:analysis('STPA'),draftHazardRowsByIndex:{one:{row:['analyst edit']}},riskRegister:[{id:'stpa-risk'}]});
  await switchProjectHazardMethod('project-1','STPA-Textbook','HARA',{riskAssessmentReportMarkdown:'STPA report',agentReportResult:{report:'STPA narrative'}});
  await saveHazardAnalysis('project-1',{method:'HARA',analysisResult:analysis('HARA'),riskRegister:[{id:'hara-risk'}]});
  return loadProjectHazardReuseState('project-1');
 };
 test('HARA-only clear preserves the saved STPA, user edits, issues and reports',async()=>{
  const before=await openHara();
  const cleared=await clearProjectHazardMethodResults('project-1',{expectedRevision:before.headRevision});
  expect(cleared.analysisResult).toBeNull();expect(cleared.generationEpochs.HARA).toBe(1);
  expect((await loadProjectHazardReuseState('project-1')).stpa).toEqual(before.stpa);
  const switched=await switchProjectHazardMethod('project-1','HARA','STPA-Textbook');
  expect(switched.record.analysisResult).toEqual(analysis('STPA'));
  expect(switched.record.draftHazardRowsByIndex.one.row).toEqual(['analyst edit']);
  expect(switched.record.riskRegister).toEqual([{id:'stpa-risk'}]);
  expect(switched.record.riskAssessmentReportMarkdown).toBe('STPA report');
  expect(switched.record.agentReportResult).toEqual({report:'STPA narrative'});
  expect(switched.record.generationEpochs.HARA).toBe(1);
 });
 test('clear both removes both current method results and invalidates their provider checkpoints',async()=>{
  const before=await openHara();
  const cleared=await clearProjectHazardMethodResults('project-1',{clearStpa:true,expectedRevision:before.headRevision});
  expect(cleared.generationEpochs).toEqual({'HARA':1,'STPA-Textbook':1});
  expect((await loadProjectHazardReuseState('project-1')).stpa).toBeNull();
  const switched=await switchProjectHazardMethod('project-1','HARA','STPA-Textbook');
  expect(switched.record.analysisResult).toBeNull();
  expect(switched.record.generationEpochs['STPA-Textbook']).toBe(1);
 });
 test('undo restores both method snapshots while keeping pre-clear provider checkpoints invalid',async()=>{
  const before=await openHara();
  await clearProjectHazardMethodResults('project-1',{clearStpa:true});
  await restoreProjectHazardMethodState('project-1',before);
  await saveHazardAnalysis('project-1',{analysisResult:before.hara.analysisResult,draftHazardRowsByIndex:before.hara.draftHazardRowsByIndex,riskRegister:before.hara.riskRegister});
  const after=await loadProjectHazardReuseState('project-1');
  expect(after.stpa.analysisResult).toEqual(before.stpa.analysisResult);
  expect(after.hara.analysisResult).toEqual(before.hara.analysisResult);
  expect(after.generationEpochs.HARA).toBe(1);
 });
 test('foundation publication keeps existing reviewed rows and does not change the active method',async()=>{
  await openHara();
  await saveProjectStpaFoundation('project-1',{Summary:[['Hazard'],['New STPA result']]});
  const state=await loadProjectHazardReuseState('project-1');
  expect(state.method).toBe('HARA');expect(state.hara.analysisResult).toEqual(analysis('HARA'));
  expect(state.stpa.draftHazardRowsByIndex.one.row).toEqual(['analyst edit']);
  expect(state.stpa.riskAssessmentReportMarkdown).toBe('STPA report');
 });
 test('a stale clear request cannot delete another tab’s saved work',async()=>{
  const before=await openHara();
  await getDb().put('analyses',{...headOf(),revision:99});resetLocalRevisionTracking();
  await expect(clearProjectHazardMethodResults('project-1',{clearStpa:true,expectedRevision:before.headRevision})).rejects.toThrow('active analysis changed');
  expect(headOf().analysisResult).toEqual(analysis('HARA'));
  expect((await loadProjectHazardReuseState('project-1')).stpa.analysisResult).toEqual(analysis('STPA'));
 });
});
