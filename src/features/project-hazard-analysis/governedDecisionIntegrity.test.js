/**
 * Stage 0 characterization suite for the Vibe Review governed-decision path.
 *
 * These tests pin the CURRENT behaviour of the boundary where a reviewer's
 * adjudicated decision becomes a persisted engineering artifact. Several of
 * them assert defects on purpose: they exist so that the Stage 1 ownership
 * refactor produces a visible, reviewable diff rather than a silent change.
 *
 * Each defect test names the invariant it will become. When Stage 1 lands,
 * the `DEFECT:` expectations flip to `INVARIANT:` expectations in place.
 *
 * Ownership decision recorded for Stage 1 (product owner, 2026-09-20):
 *   Safety Significant is GOVERNED BY THE REVIEWER.
 *   Safety Classification must be consistent with it.
 *   A conflict is surfaced to the reviewer; neither field is silently rewritten.
 */

import {
  CLASSIFICATION_RESOLUTION_STATUS,
  inspectClassificationResolution,
  normalizeHazardAnalysisResolutionStatus,
} from "./classificationResolutionStatus";
import {
  describeSignificanceConflict,
  derivedSignificanceConflict,
  reconcileDerivedSafetyColumns,
} from "./safetyColumnSchema";
import { findRowIndexById, verifyGovernedDecision } from "./governedDecisionCommit";
import { normalizeVibeReviewProposal } from "./vibeReviewProposal";
import {
  createVibeReviewSession,
  findVibeReviewSessionById,
  loadVibeReviewSession,
  popVibeReviewSession,
  pushVibeReviewSession,
  readVibeReviewStack,
  saveVibeReviewSession,
} from "./vibeReviewSession";

const HEADERS = [
  "Raw Analysis Row ID", "Function (From)", "Control Action", "Function (To)",
  "Guide Phrase", "Guide Phrase Applicable",
  "Safety Significant", "Safety Significance Rationale",
  "Safety Classification", "Safety Classification Rule", "Causal Path Type",
  "Classification Evidence", "Classification Confidence",
  "Causal Effect", "Resulting System State",
  "Intermediate Safety Function", "Intermediate Safety Effect",
  "Protection Assessment", "Protection Status", "Physical-Harm Chain Termination",
  "Hazard", "Loss",
  "Classification Resolution Status",
];

const at = (header) => HEADERS.indexOf(header);

function buildRow(overrides = {}) {
  const base = {
    "Raw Analysis Row ID": "RAW-1",
    "Function (From)": "Speed sensor",
    "Control Action": "Reports vehicle speed",
    "Function (To)": "Traction controller",
    "Guide Phrase": "More",
    "Guide Phrase Applicable": "Yes",
    "Safety Significant": "Needs Review",
    "Safety Significance Rationale": "",
    "Safety Classification": "Needs Review",
    "Safety Classification Rule": "U4",
    "Causal Path Type": "Uncertain",
    "Classification Evidence": "",
    "Classification Confidence": "Low",
    "Causal Effect": "Traction control commands excessive torque",
    "Resulting System State": "Vehicle exceeds safe speed for conditions",
    "Intermediate Safety Function": "",
    "Intermediate Safety Effect": "",
    "Protection Assessment": "No independent overspeed protection",
    "Protection Status": "Unprotected",
    "Physical-Harm Chain Termination": "Harm chain completes at occupant injury",
    Hazard: "H-1 Vehicle exceeds safe speed",
    Loss: "L-1 Occupant injury",
    "Classification Resolution Status": "",
  };
  const fields = { ...base, ...overrides };
  return HEADERS.map((header) => fields[header] ?? "");
}

/**
 * Faithful reproduction of applySafetySignificanceOnly (src/App.js:11019-11032):
 * it writes only Safety Significant and Safety Significance Rationale, and
 * deliberately does NOT recompute derived safety columns.
 */
function applySafetySignificanceOnly(summary, rowIndex, update) {
  const decision = String(update["Safety Significant"] || "").trim();
  if (!/^(?:Yes|No)$/i.test(decision)) {
    throw new Error("Safety Significant must be an explicit Yes or No decision.");
  }
  const next = summary.map((row) => (Array.isArray(row) ? [...row] : row));
  next[rowIndex][at("Safety Significant")] = /^yes$/i.test(decision) ? "Yes" : "No";
  next[rowIndex][at("Safety Significance Rationale")] = String(
    update["Safety Significance Rationale"] ?? next[rowIndex][at("Safety Significance Rationale")],
  ).trim();
  return { summary: next, changedRowIndexes: [rowIndex], rejectedUpdates: [] };
}

/**
 * Faithful reproduction of applySafetyClassificationOnly (src/App.js:10992-11002).
 */
function applySafetyClassificationOnly(summary, rowIndex, update) {
  const allowed = [
    "Safety Classification", "Safety Classification Rule", "Causal Path Type",
    "Classification Evidence", "Classification Confidence",
  ];
  const next = summary.map((row) => (Array.isArray(row) ? [...row] : row));
  allowed.forEach((header) => {
    if (Object.prototype.hasOwnProperty.call(update, header)) {
      next[rowIndex][at(header)] = String(update[header] ?? "").trim();
    }
  });
  return { summary: next, changedRowIndexes: [rowIndex], rejectedUpdates: [] };
}

/** What saveProjectHazardAnalysisRecord writes (projectHazardAnalysisStorage.js:41). */
const persistThroughStorage = (summary) =>
  normalizeHazardAnalysisResolutionStatus({ Summary: summary }).Summary;

describe("INVARIANT: reviewer decision vs persisted artifact", () => {
  it.each([
    ["Safety — Direct", "No"],
    ["Mission/Reliability", "Yes"],
    ["Not Applicable", "Yes"],
  ])(
    "persists a reviewer's decision when classification %s implies the opposite of %s",
    (classification, reviewerDecision) => {
      const summary = [HEADERS, buildRow({
        "Safety Classification": classification,
        "Causal Path Type": classification === "Safety — Direct" ? "Direct" : "None",
        "Safety Significant": classification === "Safety — Direct" ? "Yes" : "No",
      })];

      const applied = applySafetySignificanceOnly(summary, 1, {
        "Safety Significant": reviewerDecision,
        "Safety Significance Rationale":
          `Human-directed Vibe Review decision: Safety Significant = ${reviewerDecision}.`,
      });

      // The value the review loop reports, audits, and shows in its summary...
      expect(applied.summary[1][at("Safety Significant")]).toBe(reviewerDecision);

      // ...is the value that reaches storage.
      const persisted = persistThroughStorage(applied.summary);
      expect(persisted[1][at("Safety Significant")]).toBe(reviewerDecision);
      expect(persisted[1][at("Safety Significance Rationale")])
        .toContain(`Human-directed Vibe Review decision: Safety Significant = ${reviewerDecision}`);

      // The disagreement is surfaced rather than silently resolved.
      const conflict = derivedSignificanceConflict(HEADERS, persisted[1]);
      expect(conflict).toMatchObject({ governed: reviewerDecision, classification });
      expect(describeSignificanceConflict(conflict)).toContain("governed review decision");

      const inspected = inspectClassificationResolution(HEADERS, persisted[1]);
      expect(inspected.status).not.toBe(CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED);
      expect(inspected.status).not.toBe(CLASSIFICATION_RESOLUTION_STATUS.HUMAN_POLICY_VALIDATED);
      expect(inspected.findings.join(" ")).toContain("governed review decision");
    },
  );

  it("still seeds Safety Significant from the classification when it has never been adjudicated", () => {
    const summary = [HEADERS, buildRow({
      "Safety Classification": "Safety — Direct",
      "Causal Path Type": "Direct",
      "Safety Significant": "Needs Review",
    })];
    const persisted = persistThroughStorage(summary);
    expect(persisted[1][at("Safety Significant")]).toBe("Yes");
    expect(derivedSignificanceConflict(HEADERS, persisted[1])).toBeNull();
  });

  it("reports no conflict when the governed decision and the classification agree", () => {
    const row = buildRow({
      "Safety Classification": "Safety — Related",
      "Causal Path Type": "Contributory",
      "Safety Significant": "Yes",
    });
    expect(derivedSignificanceConflict(HEADERS, row)).toBeNull();
  });

  it("does not revert the decision when the row carries no settled classification", () => {
    const summary = [HEADERS, buildRow({ "Safety Classification": "Needs Review" })];
    const applied = applySafetySignificanceOnly(summary, 1, {
      "Safety Significant": "Yes",
      "Safety Significance Rationale": "Human-directed Vibe Review decision: Safety Significant = Yes.",
    });
    expect(persistThroughStorage(applied.summary)[1][at("Safety Significant")]).toBe("Yes");
  });

  it("reports the committed row as review evidence, not the pre-normalization row", () => {
    const summary = [HEADERS, buildRow({
      "Safety Significant": "Yes",
      "Safety Classification": "Safety — Related",
      "Causal Path Type": "Contributory",
    })];

    const applied = applySafetyClassificationOnly(summary, 1, {
      "Safety Classification": "Not Applicable",
      "Safety Classification Rule": "N1",
      "Causal Path Type": "None",
      "Classification Evidence": "Reviewer determined no credible harm path.",
      "Classification Confidence": "High",
    });

    // The commit boundary normalizes first, then reads the row back by stable
    // id, and returns THAT row as both the stored value and the review evidence
    // (App.js applyHazardVibeReviewDecision).
    const committedSummary = persistThroughStorage(applied.summary);
    const committedIndex = findRowIndexById(committedSummary, "RAW-1");
    expect(committedIndex).toBe(1);
    const committedRow = committedSummary[committedIndex];

    // Storing that row again is a no-op, so what the reviewer is told, what is
    // held in memory, and what reaches IndexedDB are the same row.
    const storedAgain = persistThroughStorage(committedSummary)[committedIndex];
    expect(storedAgain).toEqual(committedRow);

    // And the reviewer's untouched significance decision survives it.
    expect(committedRow[at("Safety Significant")]).toBe("Yes");
  });

  it("confirms the adjudicated value landed before anything is written", () => {
    const committedRow = persistThroughStorage([HEADERS, buildRow({
      "Safety Classification": "Not Applicable",
      "Safety Significant": "Yes",
    })])[1];

    expect(verifyGovernedDecision({
      reviewTarget: "safetySignificant",
      update: { "Safety Significant": "Yes" },
      headers: HEADERS,
      committedRow,
    })).toMatchObject({ ok: true });

    // A write that was silently dropped is caught instead of reported as applied.
    expect(verifyGovernedDecision({
      reviewTarget: "safetyClassification",
      update: { "Safety Classification": "Safety — Direct" },
      headers: HEADERS,
      committedRow,
    })).toMatchObject({ ok: false });
  });

  it("does not rewrite a governed column outside the reviewed write set", () => {
    const reviewed = [HEADERS, buildRow({
      "Safety Significant": "Yes",
      "Safety Classification": "Safety — Related",
      "Causal Path Type": "Contributory",
    })];
    expect(persistThroughStorage(reviewed)[1][at("Causal Path Type")]).toBe("Contributory");

    // Changing only the classification derives Causal Path Type, which is genuinely
    // a function of the classification, but leaves the governed decision alone.
    const changed = reviewed.map((row) => [...row]);
    changed[1][at("Safety Classification")] = "Not Applicable";
    const afterSave = persistThroughStorage(changed)[1];
    expect(afterSave[at("Safety Significant")]).toBe("Yes");
    expect(afterSave[at("Causal Path Type")]).toBe("None");
  });
});

describe("INVARIANT: derived-column reconciliation defers to an adjudicated decision", () => {
  it("does not overwrite an adjudicated Safety Significant value", () => {
    const row = buildRow({
      "Safety Classification": "Safety — Direct",
      "Causal Path Type": "Direct",
      "Safety Significant": "No",
      "Safety Significance Rationale": "Human-directed Vibe Review decision: Safety Significant = No.",
    });
    expect(reconcileDerivedSafetyColumns(HEADERS, row)[at("Safety Significant")]).toBe("No");
  });

  it.each(["", "Needs Review"])("seeds an un-adjudicated value (%s) from the classification", (initial) => {
    const row = buildRow({
      "Safety Classification": "Safety — Direct",
      "Causal Path Type": "Direct",
      "Safety Significant": initial,
    });
    expect(reconcileDerivedSafetyColumns(HEADERS, row)[at("Safety Significant")]).toBe("Yes");
  });

  it("leaves the row alone when Safety Classification is blank", () => {
    const row = buildRow({ "Safety Classification": "", "Safety Significant": "Yes" });
    expect(reconcileDerivedSafetyColumns(HEADERS, row)[at("Safety Significant")]).toBe("Yes");
  });
});

describe("INVARIANT: proposal validation sees one complete candidate row", () => {
  const relatedRowFields = (overrides = {}) => Object.fromEntries(HEADERS.map((header, index) => [
    header,
    buildRow({
      "Safety Classification": "Safety — Related",
      "Causal Path Type": "Contributory",
      "Intermediate Safety Function": "Traction control arbitration",
      "Intermediate Safety Effect": "Arbitration grants excessive torque",
      ...overrides,
    })[index],
  ]));

  const directProposal = {
    normalizedDecision: "Safety — Direct",
    "Safety Classification": "Safety — Direct",
    "Causal Path Type": "Direct",
    "Intermediate Safety Function": "",
    "Intermediate Safety Effect": "",
    "Causal Effect": "Overstated speed directly commands excessive drive torque.",
    "Resulting System State": "Vehicle exceeds safe speed for conditions.",
    "Classification Evidence": "The speed error acts directly on the torque command with no intervening safety function.",
    "Classification Confidence": "High",
  };

  it("repairs a Related row to Direct without the cleared intermediate evidence blocking it", () => {
    const rowFields = relatedRowFields();
    // The pre-update row still holds the Related intermediate evidence...
    expect(rowFields["Intermediate Safety Effect"]).toBeTruthy();

    const result = normalizeVibeReviewProposal(directProposal, rowFields, "Yes");

    // ...but the candidate clears it, and validation sees only the candidate.
    expect(result.proposal.governedDecision["Intermediate Safety Function"]).toBe("");
    expect(result.proposal.governedDecision["Intermediate Safety Effect"]).toBe("");
    expect(result.proposal.governedDecision["Safety Classification"]).toBe("Safety — Direct");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    // The repair settles instead of falling back to Needs Review and looping.
    expect(result.proposal.normalizedDecision).not.toBe("Needs Review");
  });

  it("reaches the same verdict whether or not the row carried stale intermediate evidence", () => {
    const fromRelated = normalizeVibeReviewProposal(directProposal, relatedRowFields(), "Yes");
    const fromClean = normalizeVibeReviewProposal(directProposal, relatedRowFields({
      "Intermediate Safety Function": "",
      "Intermediate Safety Effect": "",
    }), "Yes");

    expect(fromRelated.valid).toBe(fromClean.valid);
    expect(fromRelated.errors).toEqual(fromClean.errors);
    expect(fromRelated.proposal.governedDecision).toEqual(fromClean.proposal.governedDecision);
  });

  it("still rejects a Direct proposal that genuinely lacks its causal evidence", () => {
    const result = normalizeVibeReviewProposal({
      ...directProposal,
      "Causal Effect": "",
      "Resulting System State": "",
    }, relatedRowFields({ "Causal Effect": "", "Resulting System State": "" }), "Yes");

    expect(result.valid).toBe(false);
    expect(result.proposal.governedDecision["Safety Classification"]).toBe("Needs Review");
  });
});

describe("CHARACTERIZATION: session storage overlay", () => {
  function memoryStorage() {
    const store = new Map();
    return {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
      raw: store,
    };
  }

  const SESSION_KEY = "xhandle.hazardVibeReview.sessions.v1";

  // A thread stores a stack of sessions; the active review is the last entry.
  const activeOf = (storage) => {
    const stack = JSON.parse(storage.getItem(SESSION_KEY))["P1:T1"];
    return stack[stack.length - 1];
  };

  function externalAdvance(storage, cursor, msAhead) {
    const shared = JSON.parse(storage.getItem(SESSION_KEY));
    const stack = shared["P1:T1"];
    stack[stack.length - 1] = {
      ...stack[stack.length - 1],
      cursor,
      updatedAt: new Date(Date.now() + msAhead).toISOString(),
    };
    storage.setItem(SESSION_KEY, JSON.stringify(shared));
  }

  const startSession = (storage) => {
    const session = createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1", "RAW-2", "RAW-3"],
    });
    saveVibeReviewSession(session, storage);
    return session;
  };

  it("observes a newer write made by another context", () => {
    const storage = memoryStorage();
    startSession(storage);
    expect(loadVibeReviewSession("P1", "T1", storage).cursor).toBe(0);

    externalAdvance(storage, 2, 60_000);

    // The in-memory overlay no longer shadows the newer persisted record.
    expect(loadVibeReviewSession("P1", "T1", storage).cursor).toBe(2);
  });

  it("does not overwrite newer progress when this context saves next", () => {
    const storage = memoryStorage();
    startSession(storage);
    externalAdvance(storage, 2, 60_000);

    const reread = loadVibeReviewSession("P1", "T1", storage);
    saveVibeReviewSession(reread, storage);
    expect(activeOf(storage).cursor).toBe(2);
  });

  it("still prefers its own in-memory copy when that copy is the newer one", () => {
    const storage = memoryStorage();
    startSession(storage);

    // A stale write from elsewhere must not roll this review backwards.
    externalAdvance(storage, 9, -60_000);
    expect(loadVibeReviewSession("P1", "T1", storage).cursor).toBe(0);
  });

  it("keeps the review usable when persistent storage refuses writes", () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    const session = createVibeReviewSession({ projectId: "P1", threadId: "T1", queue: ["RAW-1"] });
    expect(() => saveVibeReviewSession(session, storage)).not.toThrow();
    expect(loadVibeReviewSession("P1", "T1", storage)?.id).toBe(session.id);
  });
});

describe("INVARIANT: a thread holds a stack of reviews", () => {
  function memoryStorage() {
    const store = new Map();
    return {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    };
  }

  const start = (storage, queue = ["RAW-1", "RAW-2"]) => saveVibeReviewSession(
    createVibeReviewSession({ projectId: "P1", threadId: "T1", queue }), storage,
  );

  it("keeps the parent alive while a follow-up review runs in front of it", () => {
    const storage = memoryStorage();
    const parent = start(storage);

    const child = pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetyClassification",
    }), storage);

    expect(child.parentSessionId).toBe(parent.id);
    expect(loadVibeReviewSession("P1", "T1", storage).id).toBe(child.id);
    // The parent is still stored, not copied into the child.
    expect(findVibeReviewSessionById(parent.id, storage)).not.toBeNull();
    expect(readVibeReviewStack("P1", "T1", storage).map((entry) => entry.id)).toEqual([parent.id, child.id]);
  });

  it("returns to the suspended parent when the follow-up finishes", () => {
    const storage = memoryStorage();
    const parent = start(storage);
    const child = pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetyClassification",
    }), storage);

    const resumed = popVibeReviewSession("P1", "T1", storage);

    expect(resumed.id).toBe(parent.id);
    expect(loadVibeReviewSession("P1", "T1", storage).id).toBe(parent.id);
    expect(findVibeReviewSessionById(child.id, storage)).toBeNull();
  });

  it("nests more than one level and unwinds in order", () => {
    const storage = memoryStorage();
    const parent = start(storage);
    const child = pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetyClassification",
    }), storage);
    const grandchild = pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetySignificant",
    }), storage);

    expect(grandchild.parentSessionId).toBe(child.id);
    expect(popVibeReviewSession("P1", "T1", storage).id).toBe(child.id);
    expect(popVibeReviewSession("P1", "T1", storage).id).toBe(parent.id);
    expect(popVibeReviewSession("P1", "T1", storage)).toBeNull();
  });

  it("updates a suspended parent in place rather than replacing the stack", () => {
    const storage = memoryStorage();
    const parent = start(storage);
    pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetyClassification",
    }), storage);

    saveVibeReviewSession({ ...parent, scopeLabel: "revised scope" }, storage);

    const stack = readVibeReviewStack("P1", "T1", storage);
    expect(stack).toHaveLength(2);
    expect(stack[0].scopeLabel).toBe("revised scope");
  });

  it("supersedes the whole stack when a brand-new review begins", () => {
    const storage = memoryStorage();
    start(storage);
    pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetyClassification",
    }), storage);

    const fresh = saveVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-2"],
    }), storage);

    expect(readVibeReviewStack("P1", "T1", storage).map((entry) => entry.id)).toEqual([fresh.id]);
  });

  it("reads a session stored before stacks existed", () => {
    const storage = memoryStorage();
    const legacy = createVibeReviewSession({ projectId: "P1", threadId: "T1", queue: ["RAW-1"] });
    storage.setItem("xhandle.hazardVibeReview.sessions.v1", JSON.stringify({ "P1:T1": legacy }));

    expect(loadVibeReviewSession("P1", "T1", storage).id).toBe(legacy.id);
    expect(readVibeReviewStack("P1", "T1", storage)).toHaveLength(1);
  });
});

describe("INVARIANT: a nested review returns to its parent's remaining queue", () => {
  function memoryStorage() {
    const store = new Map();
    return {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    };
  }

  const parentFor = (storage, queue) => saveVibeReviewSession(
    createVibeReviewSession({ projectId: "P1", threadId: "T1", queue, reviewTarget: "guidePhraseApplicable" }),
    storage,
  );

  it("links a pushed child to the session it suspended", () => {
    const storage = memoryStorage();
    const parent = parentFor(storage, ["RAW-1", "RAW-2"]);

    const child = pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetySignificant",
    }), storage);

    // The push RETURNS the linked session. Continuing with the object that was
    // passed in leaves parentSessionId unset, the stack never unwinds, and the
    // parent's remaining rows are silently abandoned.
    expect(child.parentSessionId).toBe(parent.id);
  });

  it("unwinds two levels back to the parent, which still has its second row", () => {
    const storage = memoryStorage();
    const parent = parentFor(storage, ["RAW-1", "RAW-2"]);
    const significance = pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetySignificant",
    }), storage);
    const classification = pushVibeReviewSession(createVibeReviewSession({
      projectId: "P1", threadId: "T1", queue: ["RAW-1"], reviewTarget: "safetyClassification",
    }), storage);

    expect(classification.parentSessionId).toBe(significance.id);
    expect(popVibeReviewSession("P1", "T1", storage).id).toBe(significance.id);
    const resumed = popVibeReviewSession("P1", "T1", storage);

    expect(resumed.id).toBe(parent.id);
    expect(resumed.queue).toEqual(["RAW-1", "RAW-2"]);
    expect(resumed.cursor).toBe(0);
  });

  it("has nothing to pop when a review was never nested", () => {
    const storage = memoryStorage();
    const solo = parentFor(storage, ["RAW-1"]);

    expect(solo.parentSessionId).toBeUndefined();
    expect(popVibeReviewSession("P1", "T1", storage)).toBeNull();
  });
});
