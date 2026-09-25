import { openDB } from "idb";

const DB_NAME = "xhandle-results-review";
const STORE_NAME = "reviewItems";
const DB_VERSION = 1;
const LS_KEY = "xhandle:results-review:items";

const hasWindowStorage = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const safeParse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

async function openReviewDB() {
  if (typeof indexedDB === "undefined") return null;
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("sourceRunId", "sourceRunId", { unique: false });
        store.createIndex("artifactId", "artifactId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    },
  });
}

function loadLocalStorageItems() {
  if (!hasWindowStorage()) return [];
  return safeParse(window.localStorage.getItem(LS_KEY), []);
}

function saveLocalStorageItems(items) {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(items || []));
  } catch (error) {
    console.warn("[results-review] localStorage persistence failed", error);
  }
}

function clearLocalStorageItems() {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {}
}

export async function loadReviewItems() {
  try {
    const db = await openReviewDB();
    if (!db) return loadLocalStorageItems();
    return await db.getAll(STORE_NAME);
  } catch (error) {
    console.warn("[results-review] IndexedDB load failed; using localStorage fallback", error);
    return loadLocalStorageItems();
  }
}

/**
 * Persist the review collection, reporting whether it durably landed.
 *
 * This used to catch an IndexedDB failure and return the input list, so the
 * provider resolved normally and the UI could report evidence as saved when it
 * existed only in memory and would vanish on reload.
 */
export async function saveReviewItems(items) {
  const list = Array.isArray(items) ? items : [];
  try {
    const db = await openReviewDB();
    if (!db) {
      saveLocalStorageItems(list);
      return { ok: true, items: list, durability: "local-storage" };
    }
    // Write the difference rather than clearing the collection and rewriting it.
    // A clear-then-rewrite means every update momentarily holds no evidence at
    // all, and a failure part way through leaves the store short of records that
    // nobody actually deleted.
    const nextIds = new Set(list.map((item) => item.id));
    const tx = db.transaction(STORE_NAME, "readwrite");
    const existingIds = await tx.store.getAllKeys();
    await Promise.all([
      ...list.map((item) => tx.store.put(item)),
      ...existingIds.filter((id) => !nextIds.has(id)).map((id) => tx.store.delete(id)),
    ]);
    await tx.done;
    clearLocalStorageItems();
    return { ok: true, items: list, durability: "indexeddb" };
  } catch (error) {
    // Never mirror a whole failed collection into localStorage: review evidence
    // grows without bound and doing so is a reliable way to exhaust the quota
    // that everything else -- including recovery -- depends on.
    console.error("[results-review] IndexedDB save failed; review evidence was not persisted.", error);
    try {
      window.dispatchEvent(new CustomEvent("xhandle:results-review:persistence-failed", {
        detail: { itemCount: list.length, message: error?.message || "" },
      }));
    } catch {}
    return {
      ok: false,
      items: list,
      durability: "memory-only",
      failure: /quota/i.test(String(error?.message || "")) || error?.name === "QuotaExceededError" ? "quota" : "write-error",
      message: error?.message || "",
    };
  }
}

export async function upsertReviewItems(items) {
  const incoming = Array.isArray(items) ? items : [];
  const existing = await loadReviewItems();
  const byId = new Map(existing.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  const next = Array.from(byId.values());
  await saveReviewItems(next);
  return incoming;
}
