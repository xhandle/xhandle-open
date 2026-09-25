/**
 * A test double modelling the IndexedDB property this design depends on.
 *
 * `fake-indexeddb` cannot be installed here (the npm registry is unreachable),
 * and the alternative -- `jest.mock("idb")` returning a permissive stub --
 * accepts any sequence of operations and so cannot distinguish a correct
 * compare-and-set from a broken one.
 *
 * WHAT THIS MODELS: readwrite transactions whose object-store scopes overlap
 * are serialized. Real IndexedDB does this across connections, and therefore
 * across tabs. It is the reason holding read-compare-write inside one
 * transaction is a genuine CAS, so a conflict test is only meaningful against a
 * double that reproduces it.
 *
 * WHAT THIS DOES NOT MODEL: staged/atomic commit, indexes, cursors, versioning
 * beyond `upgrade`. Writes apply immediately. Tests that depend on partial-write
 * rollback must say so; the interrupted-write test here asserts the
 * revision-before-head ordering instead, which is the property that actually
 * provides recovery.
 */

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

class FakeObjectStore {
  constructor(name, data, keyPath, ready, failures) {
    this.name = name;
    this.data = data;
    this.keyPath = keyPath;
    this.ready = ready;
    this.failures = failures;
  }

  async #enter(op) {
    await this.ready;
    const failure = this.failures?.get(`${this.name}:${op}`);
    if (failure) throw failure;
  }

  async get(key) { await this.#enter("get"); return clone(this.data.get(key)); }
  async getAll() { await this.#enter("getAll"); return [...this.data.values()].map(clone); }
  async getAllKeys() { await this.#enter("getAllKeys"); return [...this.data.keys()]; }

  async put(value) {
    await this.#enter("put");
    const key = value?.[this.keyPath];
    if (key === undefined) throw new Error(`Missing key path "${this.keyPath}"`);
    this.data.set(key, clone(value));
    return key;
  }

  async delete(key) { await this.#enter("delete"); this.data.delete(key); }
  async clear() { await this.#enter("clear"); this.data.clear(); }
}

export function createFakeIndexedDb() {
  const data = new Map();
  const keyPaths = new Map();
  const failures = new Map();
  let scopeChain = Promise.resolve();

  const ensureStore = (name) => {
    if (!data.has(name)) throw new Error(`No object store named "${name}"`);
    return data.get(name);
  };

  function transaction(names, mode = "readonly") {
    const scope = Array.isArray(names) ? names : [names];
    scope.forEach(ensureStore);

    // This transaction waits for the previous overlapping one to finish, and
    // the next one waits for this.
    const ready = scopeChain;
    let release;
    scopeChain = new Promise((resolve) => { release = resolve; });

    const stores = scope.map((name) => new FakeObjectStore(name, ensureStore(name), keyPaths.get(name), ready, failures));
    const byName = new Map(stores.map((store) => [store.name, store]));
    let settled = false;
    const finish = () => { if (!settled) { settled = true; release(); } };

    return {
      mode,
      store: stores[0],
      objectStore: (name) => byName.get(name),
      abort: finish,
      done: ready.then(finish, finish),
    };
  }

  const direct = async (name, run) => {
    const tx = transaction(name, "readwrite");
    try { return await run(tx.store); } finally { await tx.done; }
  };

  return {
    /** Fail a single store operation, e.g. failures.set("analyses:put", err). */
    _failures: failures,
    _dump: (name) => Object.fromEntries([...ensureStore(name).entries()].map(([k, v]) => [k, clone(v)])),
    _rows: (name) => [...ensureStore(name).values()].map(clone),
    objectStoreNames: { contains: (name) => data.has(name) },
    createObjectStore: (name, { keyPath }) => { data.set(name, new Map()); keyPaths.set(name, keyPath); },
    transaction,
    get: (name, key) => direct(name, (store) => store.get(key)),
    getAll: (name) => direct(name, (store) => store.getAll()),
    getAllKeys: (name) => direct(name, (store) => store.getAllKeys()),
    put: (name, value) => direct(name, (store) => store.put(value)),
    delete: (name, key) => direct(name, (store) => store.delete(key)),
  };
}

/** Wire the double into a `jest.mock("idb")` so `openDB` returns it. */
export function installFakeIndexedDb(openDBMock, { stores } = {}) {
  // Created eagerly so a test can arm a failure before the first operation.
  const db = createFakeIndexedDb();
  let upgraded = false;
  openDBMock.mockImplementation(async (name, version, { upgrade } = {}) => {
    if (!upgraded) {
      upgrade?.(db);
      (stores || []).forEach((store) => {
        if (!db.objectStoreNames.contains(store.name)) db.createObjectStore(store.name, { keyPath: store.keyPath });
      });
      upgraded = true;
    }
    return db;
  });
  return () => db;
}
