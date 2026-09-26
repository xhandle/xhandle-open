jest.mock("idb", () => ({
  __esModule: true,
  openDB: jest.fn(),
}));

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
} from "./projectHazardAnalysisStorage";

import { planHazardAnalysisCsvImport, applyHazardAnalysisCsvImport, applyHazardCsvImportToDrafts } from "./hazardAnalysisCsv";

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

    getDb()._failures.set("analysisRevisions:getAll", new Error("storage offline"));
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
