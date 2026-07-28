import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb';
import { notifyBackupDataChanged } from '../../lib/localBackupEvents';

export const TRACEABILITY_DB_NAME = 'TraceabilityDB';
export const TRACEABILITY_DB_VERSION = 7;

export const TRACEABILITY_STORES = {
  folders: 'Folders',
  projects: 'Projects',
  notes: 'Notes',
  requirementFolders: 'RequirementFolders',
  requirements: 'Requirements',
  safetyCases: 'SafetyCases',
} as const;

type TraceabilityStoreName =
  typeof TRACEABILITY_STORES[keyof typeof TRACEABILITY_STORES];

export const TRACEABILITY_REQUIRED_STORES = Object.values(TRACEABILITY_STORES) as TraceabilityStoreName[];

interface TraceabilitySchema extends DBSchema {
  Folders: {
    key: string;
    value: unknown;
  };
  Projects: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      by_name: string;
      by_updated: string;
    };
  };
  Notes: {
    key: number | string;
    value: Record<string, unknown>;
    indexes: {
      by_projectId: string;
      by_createdAt: string | number;
    };
  };
  RequirementFolders: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      by_project: string;
      by_parent: string | null;
      by_project_parent_order: [string, string | null, number];
    };
  };
  Requirements: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      by_project: string;
      by_folder: string | null;
    };
  };
  SafetyCases: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      by_project: string;
      by_updated: string;
    };
  };
}

type TraceabilityUpgradeTx = IDBPTransaction<TraceabilitySchema, any, 'versionchange'>;

type StoreIndexDefinition = {
  name: string;
  keyPath: string | string[];
  options?: IDBIndexParameters;
};

type StoreDefinition = {
  options?: IDBObjectStoreParameters;
  indexes?: StoreIndexDefinition[];
};

const TRACEABILITY_SCHEMA_DEFINITION: Record<TraceabilityStoreName, StoreDefinition> = {
  [TRACEABILITY_STORES.folders]: {},
  [TRACEABILITY_STORES.projects]: {
    options: { keyPath: 'id', autoIncrement: true },
    indexes: [
      { name: 'by_name', keyPath: 'name', options: { unique: false } },
      { name: 'by_updated', keyPath: 'updatedAt', options: { unique: false } },
    ],
  },
  [TRACEABILITY_STORES.notes]: {
    options: { keyPath: 'id', autoIncrement: true },
    indexes: [
      { name: 'by_projectId', keyPath: 'projectId', options: { unique: false } },
      { name: 'by_createdAt', keyPath: 'createdAt', options: { unique: false } },
    ],
  },
  [TRACEABILITY_STORES.requirementFolders]: {
    options: { keyPath: 'id' },
    indexes: [
      { name: 'by_project', keyPath: 'projectId', options: { unique: false } },
      { name: 'by_parent', keyPath: 'parentId', options: { unique: false } },
      { name: 'by_project_parent_order', keyPath: ['projectId', 'parentId', 'order'], options: { unique: false } },
    ],
  },
  [TRACEABILITY_STORES.requirements]: {
    options: { keyPath: 'id' },
    indexes: [
      { name: 'by_project', keyPath: 'projectId', options: { unique: false } },
      { name: 'by_folder', keyPath: 'folderId', options: { unique: false } },
    ],
  },
  [TRACEABILITY_STORES.safetyCases]: {
    options: { keyPath: 'id' },
    indexes: [
      { name: 'by_project', keyPath: 'projectId', options: { unique: false } },
      { name: 'by_updated', keyPath: 'updatedAt', options: { unique: false } },
    ],
  },
};

function getStoreNames(db: Pick<IDBDatabase, 'objectStoreNames'> | Pick<IDBPDatabase<TraceabilitySchema>, 'objectStoreNames'>) {
  return Array.from(db.objectStoreNames || []);
}

function logContext(prefix: string, db: Pick<IDBDatabase, 'name' | 'version' | 'objectStoreNames'> | IDBPDatabase<TraceabilitySchema>, requestedStores: string[] = []) {
  console.log(`[IDB] ${prefix}`, {
    dbName: db.name,
    dbVersion: db.version,
    availableObjectStores: getStoreNames(db),
    requestedTransactionStores: requestedStores,
  });
}

function createStoreIfMissing(
  db: IDBPDatabase<TraceabilitySchema>,
  storeName: TraceabilityStoreName,
) {
  if (db.objectStoreNames.contains(storeName)) return;

  const definition = TRACEABILITY_SCHEMA_DEFINITION[storeName];
  db.createObjectStore(storeName, definition.options);
}

function ensureStoreIndexes(
  tx: TraceabilityUpgradeTx,
  storeName: TraceabilityStoreName,
) {
  const definition = TRACEABILITY_SCHEMA_DEFINITION[storeName];
  const store = tx.objectStore(storeName);
  for (const index of definition.indexes || []) {
    if (!store.indexNames.contains(index.name)) {
      store.createIndex(index.name, index.keyPath, index.options);
    }
  }
}

function getMissingStores(
  db: Pick<IDBDatabase, 'objectStoreNames'> | Pick<IDBPDatabase<TraceabilitySchema>, 'objectStoreNames'>,
) {
  return TRACEABILITY_REQUIRED_STORES.filter((storeName) => !db.objectStoreNames.contains(storeName));
}

function applySchema(
  db: IDBPDatabase<TraceabilitySchema>,
  tx: TraceabilityUpgradeTx,
  oldVersion: number,
) {
  const previousStores = getStoreNames(db);
  logContext(`Upgrading ${TRACEABILITY_DB_NAME} from v${oldVersion}`, db);

  for (const storeName of TRACEABILITY_REQUIRED_STORES) {
    createStoreIfMissing(db, storeName);
  }
  for (const storeName of TRACEABILITY_REQUIRED_STORES) {
    ensureStoreIndexes(tx, storeName);
  }

  console.log('[IDB] Traceability schema ensured', {
    dbName: db.name,
    dbVersion: db.version,
    oldVersion,
    previousObjectStores: previousStores,
    availableObjectStores: getStoreNames(db),
  });
}

async function openTraceabilitySchemaAtVersion(version: number) {
  return openDB<TraceabilitySchema>(TRACEABILITY_DB_NAME, version, {
    upgrade(db, oldVersion, _newVersion, tx) {
      applySchema(db, tx, oldVersion);
    },
  });
}

async function repairTraceabilitySchema(existingVersion: number) {
  const repairVersion = Math.max(TRACEABILITY_DB_VERSION, existingVersion + 1);
  console.warn('[IDB] Repairing TraceabilityDB schema.', {
    dbName: TRACEABILITY_DB_NAME,
    requestedVersion: TRACEABILITY_DB_VERSION,
    repairVersion,
    existingVersion,
    requiredStores: TRACEABILITY_REQUIRED_STORES,
  });
  return openTraceabilitySchemaAtVersion(repairVersion);
}

export async function ensureTraceabilitySchema() {
  const db = await openTraceabilitySchemaAtVersion(TRACEABILITY_DB_VERSION).catch(async (err) => {
    const name = (err as Error & { name?: string })?.name || '';
    const msg = String((err as Error)?.message || err);
    const isVersionError =
      name === 'VersionError' || msg.includes('less than the existing version');

    if (!isVersionError) throw err;

    console.warn('[IDB] Version mismatch while opening TraceabilityDB; inspecting the existing version.', {
      dbName: TRACEABILITY_DB_NAME,
      requestedVersion: TRACEABILITY_DB_VERSION,
      error: msg,
    });

    return openDB<TraceabilitySchema>(TRACEABILITY_DB_NAME);
  });

  const missingStores = getMissingStores(db);
  if (missingStores.length > 0) {
    console.warn('[IDB] TraceabilityDB is open but missing required stores; schema repair will run.', {
      dbName: db.name,
      dbVersion: db.version,
      availableObjectStores: getStoreNames(db),
      missingStores,
      requiredStores: TRACEABILITY_REQUIRED_STORES,
    });
    const existingVersion = db.version;
    db.close();
    return repairTraceabilitySchema(existingVersion);
  }

  logContext('Schema ready', db);
  return db;
}

export async function openTraceabilityDB() {
  const db = await ensureTraceabilitySchema();
  logContext('Opened database', db);
  return db;
}

export function createTraceabilityTransaction(
  db: IDBPDatabase<TraceabilitySchema>,
  requestedStores: string | string[],
  mode: IDBTransactionMode = 'readonly',
) {
  const storeNames = Array.isArray(requestedStores) ? requestedStores : [requestedStores];
  logContext(`Opening ${mode} transaction`, db, storeNames);

  const missingStores = storeNames.filter((storeName) => !db.objectStoreNames.contains(storeName));
  if (missingStores.length > 0) {
    console.error('[IDB] Refusing to open transaction because one or more stores are missing.', {
      dbName: db.name,
      dbVersion: db.version,
      availableObjectStores: getStoreNames(db),
      requestedTransactionStores: storeNames,
      missingStores,
    });
    return null;
  }

  const tx = db.transaction(requestedStores, mode);
  if (mode === 'readwrite') {
    tx.done
      .then(() => notifyBackupDataChanged({ db: TRACEABILITY_DB_NAME, stores: storeNames }))
      .catch(() => {});
  }
  return tx;
}

export function getTraceabilityStoreNames(
  db: Pick<IDBDatabase, 'objectStoreNames'> | IDBPDatabase<TraceabilitySchema>,
) {
  return getStoreNames(db);
}
