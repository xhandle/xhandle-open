import { openDB } from "idb";
import { ensureTraceabilitySchema, openTraceabilityDB } from "../components/utils/traceabilityDb";
import {
  WORKSPACE_GRAPH_DB_NAME,
  WORKSPACE_GRAPH_DB_VERSION,
  WORKSPACE_GRAPH_STORES,
  openWorkspaceGraphDB,
} from "../features/workspace-graph";
import { BACKUP_DATA_CHANGED_EVENT } from "./localBackupEvents";

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_SETTINGS_KEY = "xhandle.backup.settings.v1";
const BACKUP_STATUS_KEY = "xhandle.backup.status.v1";
const HANDLE_DB_NAME = "xHandleBackupConfig";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "backup-directory";
const LATEST_BACKUP_FILE = "xhandle-backup-latest.json";
const TIMESTAMP_PREFIX = "xhandle-backup-";
const PRESERVED_LOCAL_STORAGE_PREFIXES = [];
const EXCLUDED_BACKUP_KEYS = new Set([
  BACKUP_SETTINGS_KEY,
  BACKUP_STATUS_KEY,
]);

const KNOWN_DB_CONFIGS = [
  {
    name: WORKSPACE_GRAPH_DB_NAME,
    version: WORKSPACE_GRAPH_DB_VERSION,
    stores: Object.fromEntries(
      Object.values(WORKSPACE_GRAPH_STORES).map((storeName) => [storeName, { keyPath: "id" }])
    ),
    open: () => openWorkspaceGraphDB(),
  },
  {
    name: "xhandle",
    version: 4,
    stores: {
      code_index: { keyPath: "key" },
      copilot_baseline: { keyPath: "key" },
      diagram_positions: { keyPath: "key" },
    },
    open: () =>
      openDB("xhandle", 4, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("code_index")) db.createObjectStore("code_index", { keyPath: "key" });
          if (!db.objectStoreNames.contains("copilot_baseline")) db.createObjectStore("copilot_baseline", { keyPath: "key" });
          if (!db.objectStoreNames.contains("diagram_positions")) db.createObjectStore("diagram_positions", { keyPath: "key" });
        },
      }),
  },
  {
    name: "TraceabilityDB",
    version: 6,
    open: async () => {
      await ensureTraceabilitySchema();
      return openTraceabilityDB();
    },
  },
  {
    name: "TraceabilityMeta",
    version: 1,
    stores: {
      shaStore: { keyPath: null },
    },
    open: () =>
      openDB("TraceabilityMeta", 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("shaStore")) db.createObjectStore("shaStore");
        },
      }),
  },
  {
    name: "BaselinesDB",
    version: 1,
    stores: {
      Baselines: { keyPath: null },
    },
    open: () =>
      openDB("BaselinesDB", 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("Baselines")) db.createObjectStore("Baselines");
        },
      }),
  },
];

const listeners = new Set();
let initialized = false;
let dirtySinceLastBackup = false;
let autoBackupTimer = null;
let ignoreAutoBackupEventsUntil = 0;
let state = {
  supported: false,
  autoBackupEnabled: true,
  folderName: "",
  folderConfigured: false,
  permission: "unsupported",
  lastBackupAt: null,
  lastBackupStatus: "idle",
  lastError: "",
  lastBackupSummary: null,
  latestBackupSummary: null,
  statusMessage: "",
  busy: false,
  pendingChanges: false,
};

function emit() {
  const snapshot = getLocalBackupState();
  listeners.forEach((listener) => listener(snapshot));
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadPersistedState() {
  if (typeof window === "undefined") return;
  const settings = safeParse(localStorage.getItem(BACKUP_SETTINGS_KEY), {});
  const status = safeParse(localStorage.getItem(BACKUP_STATUS_KEY), {});
  state = {
    ...state,
    autoBackupEnabled: settings.autoBackupEnabled ?? true,
    folderName: settings.folderName || "",
    folderConfigured: !!settings.folderConfigured,
    lastBackupAt: status.lastBackupAt || null,
    lastBackupStatus: status.lastBackupStatus || "idle",
    lastError: status.lastError || "",
    lastBackupSummary: status.lastBackupSummary || null,
    latestBackupSummary: status.latestBackupSummary || null,
    statusMessage: status.statusMessage || "",
  };
}

function persistState() {
  if (typeof window === "undefined") return;
  ignoreAutoBackupEventsUntil = Date.now() + 250;
  localStorage.setItem(
    BACKUP_SETTINGS_KEY,
    JSON.stringify({
      autoBackupEnabled: state.autoBackupEnabled,
      folderName: state.folderName,
      folderConfigured: state.folderConfigured,
    })
  );
  localStorage.setItem(
    BACKUP_STATUS_KEY,
    JSON.stringify({
      lastBackupAt: state.lastBackupAt,
      lastBackupStatus: state.lastBackupStatus,
      lastError: state.lastError,
      lastBackupSummary: state.lastBackupSummary,
      latestBackupSummary: state.latestBackupSummary,
      statusMessage: state.statusMessage,
    })
  );
}

function updateState(patch) {
  state = { ...state, ...patch };
  persistState();
  emit();
}

function isFileSystemAccessSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function makeTimestampTag(iso = new Date().toISOString()) {
  return iso.replace(/[:.]/g, "-");
}

function summarizeSnapshot(snapshot) {
  const projectEntry = snapshot.data.localStorage.entries.find((entry) => entry.key === "xhandle.projects");
  const projects = safeParse(projectEntry?.value, []);
  const projectCount = Array.isArray(projects) ? projects.length : 0;
  const localStorageKeys = snapshot.data.localStorage.entries.length;
  const indexedDbStores = Object.values(snapshot.data.indexedDB || {}).reduce((count, db) => {
    return count + Object.keys(db.stores || {}).length;
  }, 0);

  return {
    createdAt: snapshot.manifest.createdAt,
    projectCount,
    localStorageKeys,
    indexedDbStores,
    indexedDbRecordCount: snapshot.manifest.indexedDbRecordCount || 0,
  };
}

function shouldIncludeLocalStorageKey(key) {
  if (!key || EXCLUDED_BACKUP_KEYS.has(key)) return false;
  return !PRESERVED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function openHandleDB() {
  return openDB(HANDLE_DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    },
  });
}

async function getStoredDirectoryHandle() {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const db = await openHandleDB();
    return (await db.get(HANDLE_STORE, HANDLE_KEY)) || null;
  } catch {
    return null;
  }
}

async function saveDirectoryHandle(handle) {
  if (!isFileSystemAccessSupported()) return;
  const db = await openHandleDB();
  if (handle) await db.put(HANDLE_STORE, handle, HANDLE_KEY);
  else await db.delete(HANDLE_STORE, HANDLE_KEY);
}

async function ensureDirectoryPermission(handle, requestWrite = false) {
  if (!handle) return "denied";
  if (typeof handle.queryPermission !== "function") return "granted";
  const options = { mode: "readwrite" };
  let permission = await handle.queryPermission(options);
  if (permission !== "granted" && requestWrite && typeof handle.requestPermission === "function") {
    permission = await handle.requestPermission(options);
  }
  return permission;
}

async function exportKnownDb(config) {
  const db = await config.open();
  const storeNames = config.stores ? Object.keys(config.stores) : Array.from(db.objectStoreNames);
  const stores = {};
  let totalRecords = 0;

  for (const storeName of storeNames) {
    if (!db.objectStoreNames.contains(storeName)) continue;
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const records = await store.getAll();
    const keys = await store.getAllKeys();
    const indexes = Array.from(store.indexNames).map((indexName) => {
      const index = store.index(indexName);
      return {
        name: indexName,
        keyPath: index.keyPath,
        unique: index.unique,
        multiEntry: index.multiEntry,
      };
    });

    stores[storeName] = {
      keyPath: store.keyPath ?? null,
      autoIncrement: !!store.autoIncrement,
      indexes,
      records: records.map((value, index) => ({ key: keys[index], value })),
    };
    totalRecords += records.length;
    await tx.done;
  }

  return {
    version: db.version,
    stores,
    totalRecords,
  };
}

async function buildBackupSnapshot() {
  if (typeof window === "undefined") {
    throw new Error("Backups are only available in the browser.");
  }

  const localEntries = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!shouldIncludeLocalStorageKey(key)) continue;
    localEntries.push({ key, value: localStorage.getItem(key) });
  }

  const indexedDBData = {};
  let indexedDbRecordCount = 0;
  for (const config of KNOWN_DB_CONFIGS) {
    const exported = await exportKnownDb(config);
    indexedDBData[config.name] = {
      version: exported.version,
      stores: exported.stores,
    };
    indexedDbRecordCount += exported.totalRecords;
  }

  return {
    manifest: {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      app: "xHandle Lite",
      localStorageKeyCount: localEntries.length,
      indexedDbDatabases: Object.keys(indexedDBData),
      indexedDbRecordCount,
    },
    data: {
      localStorage: { entries: localEntries },
      indexedDB: indexedDBData,
    },
  };
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Backup file is empty or unreadable.");
  }
  if (snapshot?.manifest?.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup version: ${snapshot?.manifest?.schemaVersion ?? "unknown"}.`);
  }
  if (!Array.isArray(snapshot?.data?.localStorage?.entries)) {
    throw new Error("Backup is missing local storage data.");
  }
  if (!snapshot?.data?.indexedDB || typeof snapshot.data.indexedDB !== "object") {
    throw new Error("Backup is missing IndexedDB data.");
  }
  return snapshot;
}

async function readJsonFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }
  return validateSnapshot(parsed);
}

async function writeBackupToDirectory(handle, snapshot) {
  const permission = await ensureDirectoryPermission(handle, true);
  if (permission !== "granted") {
    throw new Error("xHandle no longer has permission to write to the selected backup folder.");
  }

  const payload = JSON.stringify(snapshot, null, 2);
  const latest = await handle.getFileHandle(LATEST_BACKUP_FILE, { create: true });
  const latestWriter = await latest.createWritable();
  await latestWriter.write(payload);
  await latestWriter.close();

  const stampedName = `${TIMESTAMP_PREFIX}${makeTimestampTag(snapshot.manifest.createdAt)}.json`;
  const stamped = await handle.getFileHandle(stampedName, { create: true });
  const stampedWriter = await stamped.createWritable();
  await stampedWriter.write(payload);
  await stampedWriter.close();

  return { fileName: stampedName };
}

async function readBackupFromDirectory(handle) {
  const permission = await ensureDirectoryPermission(handle, false);
  if (permission !== "granted") {
    throw new Error("xHandle no longer has permission to read from the selected backup folder.");
  }
  let fileHandle;
  try {
    fileHandle = await handle.getFileHandle(LATEST_BACKUP_FILE);
  } catch {
    throw new Error("No backup file was found in the selected folder yet.");
  }
  return readJsonFile(await fileHandle.getFile());
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function clearAndRestoreLocalStorage(entries) {
  const preserveKeys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (PRESERVED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      preserveKeys.push({ key, value: localStorage.getItem(key) });
    }
  }

  ignoreAutoBackupEventsUntil = Date.now() + 2000;
  localStorage.clear();

  preserveKeys.forEach(({ key, value }) => {
    if (value != null) localStorage.setItem(key, value);
  });

  entries.forEach(({ key, value }) => {
    if (key && value != null) localStorage.setItem(key, value);
  });
}

async function restoreKnownDb(config, snapshotDb) {
  const db = await config.open();
  const storeNames = snapshotDb?.stores ? Object.keys(snapshotDb.stores) : [];
  if (!storeNames.length) return;

  const tx = db.transaction(storeNames, "readwrite");
  for (const storeName of storeNames) {
    if (!db.objectStoreNames.contains(storeName)) continue;
    const store = tx.objectStore(storeName);
    await store.clear();
    const storeSnapshot = snapshotDb.stores[storeName];
    for (const record of storeSnapshot.records || []) {
      if (store.keyPath != null) {
        await store.put(record.value);
      } else {
        await store.put(record.value, record.key);
      }
    }
  }
  await tx.done;
}

async function restoreSnapshot(snapshot) {
  const safeSnapshot = validateSnapshot(snapshot);
  await clearAndRestoreLocalStorage(safeSnapshot.data.localStorage.entries);

  for (const config of KNOWN_DB_CONFIGS) {
    await restoreKnownDb(config, safeSnapshot.data.indexedDB[config.name]);
  }

  return summarizeSnapshot(safeSnapshot);
}

async function getCurrentDirectoryHandle() {
  const handle = await getStoredDirectoryHandle();
  if (!handle) return null;
  const permission = await ensureDirectoryPermission(handle, false);
  updateState({
    supported: isFileSystemAccessSupported(),
    permission,
    folderConfigured: !!handle,
  });
  return handle;
}

function markDirty() {
  dirtySinceLastBackup = true;
  if (!state.pendingChanges) {
    updateState({ pendingChanges: true });
  } else {
    emit();
  }
}

function scheduleAutoBackup(reason = "change") {
  if (Date.now() < ignoreAutoBackupEventsUntil) return;
  if (!state.autoBackupEnabled || !state.folderConfigured || state.permission !== "granted") {
    markDirty();
    return;
  }
  markDirty();
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(() => {
    backupNow({ source: `auto:${reason}`, silentIfUnavailable: true }).catch(() => {});
  }, 1500);
}

async function refreshDirectoryStatus() {
  const supported = isFileSystemAccessSupported();
  if (!supported) {
    updateState({
      supported: false,
      permission: "unsupported",
      folderConfigured: false,
      folderName: "",
    });
    return null;
  }

  const handle = await getStoredDirectoryHandle();
  if (!handle) {
    updateState({
      supported: true,
      permission: "prompt",
      folderConfigured: false,
      folderName: "",
    });
    return null;
  }

  const permission = await ensureDirectoryPermission(handle, false);
  updateState({
    supported: true,
    permission,
    folderConfigured: true,
    folderName: handle.name || state.folderName || "",
  });

  try {
    const latestSnapshot = await readBackupFromDirectory(handle);
    updateState({ latestBackupSummary: summarizeSnapshot(latestSnapshot) });
  } catch {
    updateState({ latestBackupSummary: null });
  }

  return handle;
}

async function setBusy(busy, statusMessage = state.statusMessage) {
  updateState({ busy, statusMessage });
}

export function subscribeToLocalBackup(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocalBackupState() {
  return { ...state };
}

export async function initializeLocalBackupRuntime() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  loadPersistedState();
  state.supported = isFileSystemAccessSupported();
  emit();
  await refreshDirectoryStatus();

  window.addEventListener("xhandle:data-changed", () => scheduleAutoBackup("localStorage"));
  window.addEventListener(BACKUP_DATA_CHANGED_EVENT, () => scheduleAutoBackup("indexeddb"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirtySinceLastBackup) {
      backupNow({ source: "visibility", silentIfUnavailable: true }).catch(() => {});
    }
  });

  if (state.autoBackupEnabled && state.folderConfigured && state.permission === "granted") {
    scheduleAutoBackup("startup");
  }
}

export async function chooseBackupFolder() {
  if (!isFileSystemAccessSupported()) {
    throw new Error("This browser does not support choosing a persistent backup folder.");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const permission = await ensureDirectoryPermission(handle, true);
  if (permission !== "granted") {
    throw new Error("Folder access was not granted.");
  }
  await saveDirectoryHandle(handle);
  updateState({
    supported: true,
    folderConfigured: true,
    folderName: handle.name || "",
    permission,
    lastError: "",
  });
  setTimeout(() => {
    if (state.autoBackupEnabled || state.pendingChanges) {
      backupNow({ source: "auto:folder-selected", silentIfUnavailable: true }).catch(() => {});
    }
  }, 0);
  return handle.name || "Selected folder";
}

export async function setAutoBackupEnabled(enabled) {
  updateState({ autoBackupEnabled: !!enabled });
  if (enabled) scheduleAutoBackup("toggle");
}

export async function recheckBackupFolder() {
  await refreshDirectoryStatus();
}

export async function backupNow(options = {}) {
  const { source = "manual", silentIfUnavailable = false, mode = "folder" } = options;
  try {
    await setBusy(true, source.startsWith("auto:") ? "Saving backup…" : "Creating backup…");
    const snapshot = await buildBackupSnapshot();
    const summary = summarizeSnapshot(snapshot);

    if (mode === "download") {
      const fileName = `${TIMESTAMP_PREFIX}${makeTimestampTag(snapshot.manifest.createdAt)}.json`;
      downloadTextFile(fileName, JSON.stringify(snapshot, null, 2));
      dirtySinceLastBackup = false;
      updateState({
        busy: false,
        lastBackupAt: snapshot.manifest.createdAt,
        lastBackupStatus: "success",
        lastError: "",
        lastBackupSummary: summary,
        statusMessage: "Backup file downloaded.",
        pendingChanges: false,
      });
      return summary;
    }

    const handle = await getStoredDirectoryHandle();
    if (!handle) {
      if (silentIfUnavailable) {
        updateState({ busy: false, statusMessage: "Waiting for a backup folder." });
        return null;
      }
      throw new Error("Choose a backup folder before running a folder backup.");
    }

    const permission = await ensureDirectoryPermission(handle, source === "manual");
    if (permission !== "granted") {
      updateState({ permission });
      if (silentIfUnavailable) {
        updateState({ busy: false, statusMessage: "Backup folder access needs to be re-approved." });
        return null;
      }
      throw new Error("Backup folder access needs to be re-approved.");
    }

    await writeBackupToDirectory(handle, snapshot);
    dirtySinceLastBackup = false;
    updateState({
      busy: false,
      permission,
      folderConfigured: true,
      folderName: handle.name || state.folderName,
      lastBackupAt: snapshot.manifest.createdAt,
      lastBackupStatus: "success",
      lastError: "",
      lastBackupSummary: summary,
      latestBackupSummary: summary,
      statusMessage: "Backup saved to your computer.",
      pendingChanges: false,
    });
    return summary;
  } catch (error) {
    updateState({
      busy: false,
      lastBackupStatus: "error",
      lastError: error?.message || String(error),
      statusMessage: "Backup failed.",
    });
    if (!silentIfUnavailable) throw error;
    return null;
  }
}

export async function downloadBackupNow() {
  return backupNow({ mode: "download", source: "manual-download" });
}

export async function restoreFromConfiguredBackup() {
  const handle = await getCurrentDirectoryHandle();
  if (!handle) {
    throw new Error("Choose a backup folder first, or restore from a backup file instead.");
  }
  await setBusy(true, "Restoring from backup…");
  try {
    const snapshot = await readBackupFromDirectory(handle);
    const summary = await restoreSnapshot(snapshot);
    updateState({
      busy: false,
      lastBackupStatus: "success",
      lastError: "",
      latestBackupSummary: summary,
      statusMessage: "Backup restored. Reloading xHandle…",
      pendingChanges: false,
    });
    setTimeout(() => window.location.reload(), 150);
    return summary;
  } catch (error) {
    updateState({
      busy: false,
      lastBackupStatus: "error",
      lastError: error?.message || String(error),
      statusMessage: "Restore failed.",
    });
    throw error;
  }
}

export async function restoreFromBackupFile(file) {
  await setBusy(true, "Restoring from backup file…");
  try {
    const snapshot = await readJsonFile(file);
    const summary = await restoreSnapshot(snapshot);
    updateState({
      busy: false,
      lastBackupStatus: "success",
      lastError: "",
      latestBackupSummary: summary,
      statusMessage: "Backup restored. Reloading xHandle…",
      pendingChanges: false,
    });
    setTimeout(() => window.location.reload(), 150);
    return summary;
  } catch (error) {
    updateState({
      busy: false,
      lastBackupStatus: "error",
      lastError: error?.message || String(error),
      statusMessage: "Restore failed.",
    });
    throw error;
  }
}
