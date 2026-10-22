import { wrap } from 'idb';
export const TRANSFER_RECOVERY_DB = 'xhandle-workspace-transfer-recovery';
export const APP_DATABASES = [
  'xhandle', 'xhandle-workspace-graph', 'xhandle-project-hazard-analysis', 'xhandle-recovery',
  'xhandle-collaborator-attachments', 'xhandle-hazard-analysis-reset', 'xhandle-project-reports',
  'xhandle-results-review', 'xhandle-safety-remediation', 'xhandle-code-architecture-hazard-analysis',
  'xhandle-code-architecture-assurance', 'TraceabilityDB', 'TraceabilityMeta', 'BaselinesDB', 'SafetyCaseEvidenceDB',
];
const excluded = new Set([TRANSFER_RECOVERY_DB, 'xhandle_local_source_handles', 'xHandleBackupConfig']);
export const ownedDatabase = name => typeof name === 'string' && !excluded.has(name) && (APP_DATABASES.includes(name) || /^xhandle[-_:]/i.test(name));
const fixedVersions = { xhandle: 4, 'xhandle-workspace-graph': 2, 'xhandle-project-hazard-analysis': 2, 'xhandle-code-architecture-hazard-analysis': 3, 'xhandle-safety-remediation': 2, TraceabilityDB: 6, TraceabilityMeta: 1, BaselinesDB: 1, SafetyCaseEvidenceDB: 1 };
export function openTransferDatabase(name, version, schema) {
  return new Promise((resolve, reject) => {
    let settled = false, absent = false, upgradeError;
    const request = version ? indexedDB.open(name, version) : indexedDB.open(name);
    const finish = (error, db) => { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); error ? reject(error) : resolve(db ? wrap(db) : null); };
    const timer = setTimeout(() => finish(new Error(`Storage ${name} timed out. Close other xHandle tabs and retry.`)), 10000);
    request.onblocked = () => finish(new Error(`Storage ${name} is blocked. Close other xHandle tabs and retry.`));
    request.onupgradeneeded = event => {
      if (settled) { request.transaction.abort(); return; }
      if (!schema && event.oldVersion === 0) { absent = true; request.transaction.abort(); return; }
      try {
        for (const [storeName, spec] of Object.entries(schema || {})) {
          const store = request.result.objectStoreNames.contains(storeName) ? request.transaction.objectStore(storeName) : request.result.createObjectStore(storeName, { keyPath: spec.keyPath, autoIncrement: spec.autoIncrement });
          for (const index of spec.indexes) if (!store.indexNames.contains(index.name)) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
        }
      } catch (error) { upgradeError = error; request.transaction.abort(); }
    };
    request.onerror = () => finish(absent ? null : upgradeError || request.error);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); finish(null, request.result); };
  });
}
export async function listTransferDatabases() {
  const names = new Set(APP_DATABASES);
  if (indexedDB.databases) for (const database of await indexedDB.databases()) if (ownedDatabase(database.name)) names.add(database.name);
  return [...names];
}
export async function readTransferDatabases(onProgress = () => {}) {
  const result = Object.create(null);
  const databaseNames = await listTransferDatabases();
  let completed = 0;
  for (const name of databaseNames) {
    const db = await openTransferDatabase(name);
    if (!db) { onProgress('Checking workspace databases…', ++completed / databaseNames.length); continue; }
    try {
      const stores = Object.create(null), names = [...db.objectStoreNames];
      if (names.length) {
        const tx = db.transaction(names, 'readonly');
        const reads = names.map(async storeName => {
          const store = tx.objectStore(storeName);
          const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()]);
          const indexes = [...store.indexNames].map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; });
          stores[storeName] = { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, records: keys.map((key, i) => ({ key, value: values[i] })) };
        });
        await Promise.all([...reads, tx.done]);
      }
      result[name] = { version: db.version, stores };
      onProgress(`Read ${name}`, ++completed / databaseNames.length);
    } finally { db.close(); }
  }
  return result;
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function inlineKey(value, keyPath) {
  if (Array.isArray(keyPath)) return keyPath.map(path => inlineKey(value, path));
  if (keyPath === '') return value;
  return keyPath.split('.').reduce((value, part) => value && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined, value);
}
export function validateTransferDatabases(databases) {
  if (!databases || Array.isArray(databases) || typeof databases !== 'object') throw new Error('Workspace databases are missing.');
  for (const [name, database] of Object.entries(databases)) {
    if (!ownedDatabase(name) || !Number.isSafeInteger(database.version) || database.version < 1 || (fixedVersions[name] && database.version > fixedVersions[name])) throw new Error(`Unsupported workspace database: ${name}. Use a compatible xHandle version.`);
    if (!database.stores || typeof database.stores !== 'object' || Array.isArray(database.stores)) throw new Error('Invalid workspace stores.');
    for (const store of Object.values(database.stores)) {
      const path = store?.keyPath;
      if (!(path === null || typeof path === 'string' || (Array.isArray(path) && path.every(x => typeof x === 'string'))) || typeof store.autoIncrement !== 'boolean' || !Array.isArray(store.indexes) || !Array.isArray(store.records)) throw new Error('Invalid workspace store schema.');
      const keys = new Set();
      for (const index of store.indexes) {
        if (typeof index.name !== 'string' || keys.has(index.name) || !(typeof index.keyPath === 'string' || (Array.isArray(index.keyPath) && index.keyPath.every(x => typeof x === 'string'))) || typeof index.unique !== 'boolean' || typeof index.multiEntry !== 'boolean') throw new Error('Invalid workspace index.');
        keys.add(index.name);
      }
      const sortedKeys = store.records.map(record => record.key).sort((a,b) => indexedDB.cmp(a,b));
      for (let i = 1; i < sortedKeys.length; i++) if (indexedDB.cmp(sortedKeys[i-1], sortedKeys[i]) === 0) throw new Error('Duplicate workspace record key.');
      for (const record of store.records) {
        indexedDB.cmp(record.key, record.key);
        if (path !== null && indexedDB.cmp(inlineKey(record.value, path), record.key) !== 0) throw new Error('Workspace record key does not match its value.');
      }
    }
  }
}
export async function preflightTransferDatabases(databases) {
  validateTransferDatabases(databases);
  for (const [name, data] of Object.entries(databases)) {
    const db = await openTransferDatabase(name);
    if (!db) continue;
    try {
      for (const [storeName, spec] of Object.entries(data.stores)) {
        if (!db.objectStoreNames.contains(storeName)) { if (data.version > db.version) continue; throw new Error(`Storage schema differs for ${name}. Use matching xHandle versions.`); }
        const store = db.transaction(storeName).store;
        if (!same(store.keyPath, spec.keyPath) || store.autoIncrement !== spec.autoIncrement) throw new Error(`Storage schema differs for ${name}/${storeName}.`);
        for (const index of spec.indexes) {
          if (!store.indexNames.contains(index.name)) { if (data.version > db.version) continue; throw new Error(`Storage index is missing in ${name}. Use matching xHandle versions.`); }
          const current = store.index(index.name);
          if (!same(current.keyPath, index.keyPath) || current.unique !== index.unique || current.multiEntry !== index.multiEntry) throw new Error(`Storage index differs for ${name}.`);
        }
      }
    } finally { db.close(); }
  }
}
export async function writeTransferDatabases(databases, affectedNames, onProgress = () => {}) {
  for (const name of affectedNames) {
    const data = databases[name];
    let db = await openTransferDatabase(name);
    if (data && (!db || db.version < data.version)) { db?.close(); db = await openTransferDatabase(name, data.version, data.stores); }
    if (!db) continue;
    try {
      const names = [...db.objectStoreNames];
      if (!names.length) continue;
      const tx = db.transaction(names, 'readwrite'), pending = [];
      try {
        for (const name of names) pending.push(tx.objectStore(name).clear());
        for (const [storeName, spec] of Object.entries(data?.stores || {})) for (const record of spec.records) {
          const store = tx.objectStore(storeName);
          pending.push(store.keyPath === null ? store.put(record.value, record.key) : store.put(record.value));
        }
        await Promise.all([...pending, tx.done]);
      } catch (error) { try { tx.abort(); } catch {} await Promise.allSettled([...pending, tx.done]); throw error; }
      onProgress(`Restored ${name}`);
    } finally { db.close(); }
  }
}
