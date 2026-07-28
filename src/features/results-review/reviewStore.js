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

export async function saveReviewItems(items) {
  const list = Array.isArray(items) ? items : [];
  try {
    const db = await openReviewDB();
    if (!db) {
      saveLocalStorageItems(list);
      return list;
    }
    const tx = db.transaction(STORE_NAME, "readwrite");
    await tx.store.clear();
    await Promise.all(list.map((item) => tx.store.put(item)));
    await tx.done;
    clearLocalStorageItems();
  } catch (error) {
    saveLocalStorageItems(list);
    console.warn("[results-review] IndexedDB save failed; localStorage fallback retained", error);
  }
  return list;
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
