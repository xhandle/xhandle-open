import {
  REVIEW_SESSION_SCHEMA_VERSION,
  compactReviewSession,
  createReviewSessionStore,
} from "./reviewSessionStore";

const STATES = Object.freeze({
  PROPOSING: "proposing", AWAITING: "awaiting_decision", APPLYING: "applying",
  COMPLETED: "completed", CANCELLED: "cancelled", PAUSED: "paused",
});

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
};

const makeStore = (overrides = {}) => createReviewSessionStore({
  key: "test.sessions", auditKey: "test.audit", states: STATES, runtimeId: "runtime-1", ...overrides,
});

const session = (id, extra = {}) => ({
  id, projectId: "P1", threadId: "T1", cursor: 0, decisions: [],
  state: STATES.PROPOSING, runtimeId: "runtime-1", updatedAt: new Date().toISOString(), ...extra,
});

describe("session persistence", () => {
  it("stamps the schema version so a later reader can migrate knowingly", () => {
    const store = makeStore(); const storage = memoryStorage();
    store.saveSession(session("a"), storage);
    expect(store.readStack("P1", "T1", storage)[0].schemaVersion).toBe(REVIEW_SESSION_SCHEMA_VERSION);
  });

  it("reads a session written before stacks existed", () => {
    const store = makeStore(); const storage = memoryStorage();
    storage.setItem("test.sessions", JSON.stringify({ "P1:T1": session("legacy") }));
    expect(store.loadSession("P1", "T1", storage).id).toBe("legacy");
  });

  it("marks a session stranded by a restart as paused", () => {
    const store = makeStore(); const storage = memoryStorage();
    store.saveSession(session("a", { runtimeId: "an-older-runtime" }), storage);
    const loaded = store.loadSession("P1", "T1", storage);
    expect(loaded.state).toBe(STATES.PAUSED);
    expect(loaded.recoveredAfterRestart).toBe(true);
  });

  it("applies a domain's own revival rule to the active session", () => {
    const store = makeStore({
      reviveActive: (s) => (s.state === STATES.APPLYING ? { ...s, state: STATES.AWAITING } : s),
    });
    const storage = memoryStorage();
    store.saveSession(session("a", { state: STATES.APPLYING }), storage);
    expect(store.loadSession("P1", "T1", storage).state).toBe(STATES.AWAITING);
  });

  it("keeps the review usable when storage refuses writes", () => {
    const store = makeStore(); const storage = memoryStorage();
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => store.saveSession(session("a"), storage)).not.toThrow();
    expect(store.loadSession("P1", "T1", storage).id).toBe("a");
  });

  it("caps the audit log per project", () => {
    const store = makeStore({ auditLimit: 3 }); const storage = memoryStorage();
    [1, 2, 3, 4, 5].forEach((n) => store.appendAudit({ projectId: "P1", n }, storage));
    expect(store.loadAudit("P1", storage).map((entry) => entry.n)).toEqual([3, 4, 5]);
  });
});

describe("compactReviewSession", () => {
  const withDecisions = (count) => ({
    decisions: Array.from({ length: count }, (_, index) => ({
      sourceRowId: `RAW-${index}`,
      previousGovernedFields: { "Safety Significant": "Yes" },
      previousRow: ["a", "b"], nextRow: ["a", "c"], headers: ["x", "y"],
    })),
  });

  const HAZARD_TRIMMABLE = ["previousRow", "nextRow", "headers"];

  it("leaves a short review untouched", () => {
    const short = withDecisions(3);
    expect(compactReviewSession(short, HAZARD_TRIMMABLE, 25)).toBe(short);
  });

  it("trims nothing when the domain declares no trimmable fields", () => {
    const full = withDecisions(30);
    expect(compactReviewSession(full, [], 25)).toBe(full);
  });

  it("trims declared detail from older decisions but keeps the undo baseline", () => {
    const compacted = compactReviewSession(withDecisions(30), HAZARD_TRIMMABLE, 25);
    const oldest = compacted.decisions[0];
    expect(oldest.previousRow).toBeUndefined();
    expect(oldest.headers).toBeUndefined();
    expect(oldest.detailTrimmed).toBe(true);
    // Hazard undo restores from previousGovernedFields, which survives.
    expect(oldest.previousGovernedFields).toEqual({ "Safety Significant": "Yes" });
    expect(compacted.decisions[29].previousRow).toEqual(["a", "b"]);
  });

  it("never trims a field the domain's undo path reads", () => {
    // Functional undo rebuilds the row itself, so previousRow and affectedRows
    // must survive even on the oldest entries -- repeated undo walks back
    // through the list and would otherwise reach an unrestorable decision.
    const functionalTrimmable = ["nextRow", "proposedRow", "columns"];
    const decisions = Array.from({ length: 30 }, (_, index) => ({
      rowId: `FR-${index}`,
      previousRow: { subsystem: "Control" },
      affectedRows: [{ rowId: "FR-9", propagated: true, previousRow: { subsystem: "Control" } }],
      nextRow: { subsystem: "Powertrain" },
    }));
    const compacted = compactReviewSession({ decisions }, functionalTrimmable, 25);
    expect(compacted.decisions[0].previousRow).toEqual({ subsystem: "Control" });
    expect(compacted.decisions[0].affectedRows).toHaveLength(1);
    expect(compacted.decisions[0].nextRow).toBeUndefined();
  });

  it("keeps the most recent decisions fully intact", () => {
    const compacted = compactReviewSession(withDecisions(30), HAZARD_TRIMMABLE, 25);
    expect(compacted.decisions.slice(5).every((d) => Array.isArray(d.previousRow))).toBe(true);
  });
});

describe("stack depth", () => {
  it("refuses to nest beyond the configured depth", () => {
    const store = makeStore({ maxStackDepth: 3 });
    const storage = memoryStorage();
    store.saveSession(session("a"), storage);
    store.pushSession(session("b"), storage);
    store.pushSession(session("c"), storage);

    // A re-entrant cascade would otherwise grow this forever, and each level
    // persists another full copy of its queue and decisions.
    expect(() => store.pushSession(session("d"), storage)).toThrow(/nested 3 levels deep/);
    expect(store.readStack("P1", "T1", storage)).toHaveLength(3);
  });

  it("allows nesting again once a level is finished", () => {
    const store = makeStore({ maxStackDepth: 2 });
    const storage = memoryStorage();
    store.saveSession(session("a"), storage);
    store.pushSession(session("b"), storage);
    expect(() => store.pushSession(session("c"), storage)).toThrow();

    store.popSession("P1", "T1", storage);
    expect(() => store.pushSession(session("c"), storage)).not.toThrow();
  });
});
