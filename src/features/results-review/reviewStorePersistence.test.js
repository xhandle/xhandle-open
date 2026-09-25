/**
 * Review evidence must never be reported as saved when it is memory-only.
 * It used to catch an IndexedDB failure and return the input list, so the
 * provider resolved normally and the UI said "saved" for evidence that would
 * vanish on reload.
 */

jest.mock("idb", () => ({ __esModule: true, openDB: jest.fn() }));

import { openDB } from "idb";
import { saveReviewItems } from "./reviewStore";

const items = [{ id: "review-1" }, { id: "review-2" }];

const workingDb = () => {
  const store = new Map();
  return {
    transaction: () => ({
      store: {
        getAllKeys: async () => [...store.keys()],
        put: async (item) => store.set(item.id, item),
        delete: async (id) => store.delete(id),
      },
      done: Promise.resolve(),
    }),
    _store: store,
  };
};

beforeEach(() => {
  openDB.mockReset();
  localStorage.clear();
  // openReviewDB short-circuits to localStorage when indexedDB is absent, and
  // jsdom provides none; the mocked openDB stands in for the connection itself.
  global.indexedDB = {};
});

afterEach(() => { delete global.indexedDB; });

describe("review evidence persistence reporting", () => {
  it("reports a durable write", async () => {
    openDB.mockResolvedValue(workingDb());
    await expect(saveReviewItems(items)).resolves.toMatchObject({ ok: true, durability: "indexeddb" });
  });

  it("writes incrementally rather than clearing the collection", async () => {
    const db = workingDb();
    db._store.set("stale", { id: "stale" });
    openDB.mockResolvedValue(db);

    await saveReviewItems(items);

    expect([...db._store.keys()].sort()).toEqual(["review-1", "review-2"]);
  });

  it("reports a failed write instead of returning the list as saved", async () => {
    openDB.mockResolvedValue({
      transaction: () => ({
        store: { getAllKeys: async () => { throw new Error("IndexedDB is gone"); } },
        done: Promise.resolve(),
      }),
    });

    const result = await saveReviewItems(items);

    expect(result).toMatchObject({ ok: false, durability: "memory-only", failure: "write-error" });
    expect(result.items).toEqual(items);
  });

  it("names quota exhaustion distinctly", async () => {
    const quota = new Error("The quota has been exceeded.");
    quota.name = "QuotaExceededError";
    openDB.mockResolvedValue({
      transaction: () => ({
        store: { getAllKeys: async () => { throw quota; } },
        done: Promise.resolve(),
      }),
    });

    await expect(saveReviewItems(items)).resolves.toMatchObject({ ok: false, failure: "quota" });
  });

  it("does not mirror a failed collection into localStorage", async () => {
    openDB.mockResolvedValue({
      transaction: () => ({
        store: { getAllKeys: async () => { throw new Error("nope"); } },
        done: Promise.resolve(),
      }),
    });

    await saveReviewItems(items);

    // Dumping review evidence into localStorage is a reliable way to exhaust the
    // quota that recovery itself depends on.
    const mirrored = Object.keys(localStorage).some((key) => String(localStorage.getItem(key) || "").includes("review-1"));
    expect(mirrored).toBe(false);
  });

  it("falls back to localStorage only when IndexedDB is genuinely absent", async () => {
    delete global.indexedDB;
    openDB.mockResolvedValue(null);
    await expect(saveReviewItems(items)).resolves.toMatchObject({ ok: true, durability: "local-storage" });
  });
});
