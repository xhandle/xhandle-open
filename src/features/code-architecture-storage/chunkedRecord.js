// Versioned, content-addressed JSON tree. Public readers still receive the original
// objects. Chunks share the owning key prefix so backup and project deletion retain
// their existing scope rules. No total dataset byte/count admission limit.
const FORMAT = 'xhandle-json-tree-v1';
const PART = ':$part:';
const PAGE = 64;
const STRING_PAGE = 32768;
export const isChunkedRecord = value => value?.format === FORMAT;
export const isRecordPart = key => String(key).includes(PART);
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const aborted = signal => { if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError'); };
export function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new DOMException('Storage transaction aborted.', 'AbortError'));
    tx.onerror = () => {}; // Wait for rollback before returning failure.
  });
}
export async function rawRecord(db, store, key) {
  return (await requestValue(db.transaction(store, 'readonly').objectStore(store).get(key)))?.value;
}
export async function putRawRecord(db, store, key, value) {
  const tx = db.transaction(store, 'readwrite');
  const done = transactionDone(tx);
  try { tx.objectStore(store).put({ key, value }); } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
  await done;
}
async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

// Inline small JSON subtrees into existing value entries. Bound the inspection
// before serializing: a large dataset still uses the existing paged tree format.
function fitsInline(value, budget = 16384, depth = 0) {
  if (depth > 32) return -1;
  if (value === null || value === undefined) return budget - 4;
  if (typeof value === 'string') return budget - value.length * 6 - 2;
  if (typeof value !== 'object') return budget - 24;
  if (value instanceof Date) return budget - 32;
  budget -= 2;
  for (const name of Object.keys(value)) {
    budget -= name.length * 6 + 4;
    if (budget < 0) return -1;
    budget = fitsInline(value[name], budget, depth + 1);
    if (budget < 0) return -1;
  }
  return budget;
}

export async function stageRecord(db, store, key, value, { signal } = {}) {
  const pending = new Map(), seen = new WeakMap();
  let bytesWritten = 0, chunksWritten = 0, visits = 0;
  const flush = async () => {
    if (!pending.size) return;
    for(let attempt=0;;attempt++) {
      aborted(signal);
      const tx=db.transaction(store,'readwrite'), objectStore=tx.objectStore(store), done=transactionDone(tx);
      let failure, writtenBytes=0, writtenChunks=0;
      const stop=()=>{try{tx.abort();}catch{}};
      signal?.addEventListener('abort',stop,{once:true});
      const accept = (partKey,part,get) => {
        try {if(!get.result){objectStore.put({key:partKey,value:part});writtenBytes+=part.length*2;writtenChunks++;}}
        catch(error){failure=error;stop();}
      };
      for(const [partKey,part] of pending) {
        const get=objectStore.get(partKey);
        get.onsuccess=()=>accept(partKey,part,get);
      }
      try {await done;bytesWritten+=writtenBytes;chunksWritten+=writtenChunks;break;}
      catch(error) {
        const cause=failure || error;
        if(signal?.aborted || cause.name!=='AbortError' || attempt>=2)throw cause;
        await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
      } finally {signal?.removeEventListener('abort',stop);}
    }
    pending.clear();
    await pause();
  };
  const save = async node => {
    const text = JSON.stringify(node);
    const partKey = `${key}${PART}${await digest(text)}`;
    pending.set(partKey, text);
    if (pending.size >= PAGE) await flush();
    return partKey;
  };
  const pages = async (type, values) => {
    let level = [];
    for (let i = 0; i < values.length; i += PAGE) level.push(await save([type, values.slice(i, i + PAGE)]));
    if (!level.length) return save([type, []]);
    // Page tree bounds individual records even for millions of children.
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += PAGE) next.push(await save(['pages', level.slice(i, i + PAGE)]));
      level = next;
    }
    return level[0];
  };
  const encode = async input => {
    aborted(signal);
    if (++visits % 256 === 0) await pause();
    if (input === null || typeof input !== 'object') {
      if (typeof input === 'string' && input.length > STRING_PAGE) {
        const refs = [];
        for (let i = 0; i < input.length; i += STRING_PAGE) refs.push(await save(['value', input.slice(i, i + STRING_PAGE)]));
        return save(['string', await pages('array', refs.map(ref => ({ ref })))]);
      }
      return save(['value', input === undefined ? null : input]);
    }
    if (seen.has(input)) return seen.get(input);
    if (input instanceof Date) return encode(input.toJSON());
    const entries = [];
    if (Array.isArray(input)) {
      for (const item of input) entries.push(await child(item));
    } else {
      for (const name of Object.keys(input)) if (input[name] !== undefined && typeof input[name] !== 'function') entries.push([name, await child(input[name])]);
    }
    const ref = await pages(Array.isArray(input) ? 'array' : 'object', entries);
    seen.set(input, ref);
    return ref;
  };
  const child = async input => {
    // Small row/evidence subtrees stay in the page. Larger compounds and strings
    // retain the original tree representation and independent hydration semantics.
    if (input && typeof input === 'object' && fitsInline(input) >= 0) return { value: input };
    // Scalars stay inline; large compound objects are deduplicated.
    if (input == null || (typeof input !== 'object' && (typeof input !== 'string' || input.length <= STRING_PAGE))) return { value: input ?? null };
    return { ref: await encode(input) };
  };
  const root = await encode(value);
  await flush();
  aborted(signal);
  return { format: FORMAT, root, bytesWritten, chunksWritten };
}

// Content-addressing may merge equal objects on disk. Recreate independent mutable
// objects on read so an edit to one row cannot mutate another equal row's fields.
function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
  return value;
}
export async function hydrateRecord(db, store, value, { onProgress } = {}) {
  let completed = 0, reported = -1;
  const report = percent => {
    const next = Math.max(reported, Math.min(100, Math.floor(percent)));
    if (next !== reported) { reported = next; onProgress?.(next); }
  };
  // A subtree owns a fraction of the remaining work. Splitting that fraction
  // between children keeps progress monotonic without a second database scan.
  const advance = weight => { completed += weight; report(Math.min(99, completed * 100)); };
  report(0);
  if (!isChunkedRecord(value)) { report(100); return value; }
  const cache = new Map(), waiting = [];
  let lastYield = Date.now(), paintYield = null;
  const yieldForProgress = async () => {
    if (!onProgress) return;
    if (!paintYield && Date.now() - lastYield >= 16) {
      paintYield = pause().then(() => { lastYield = Date.now(); paintYield = null; });
    }
    if (paintYield) await paintYield;
  };
  let scheduled = false;
  const readPart = key => new Promise((resolve,reject) => {
    waiting.push({key,resolve,reject});
    if (!scheduled) { scheduled=true; Promise.resolve().then(drain); }
  });
  function drain() {
    const batch=waiting.splice(0,PAGE);
    const tx=db.transaction(store,'readonly'), objectStore=tx.objectStore(store);
    for (const entry of batch) {
      const request=objectStore.get(entry.key);
      request.onsuccess=()=>entry.resolve(request.result?.value);
      request.onerror=()=>entry.reject(request.error);
    }
    tx.onabort=()=>batch.forEach(entry=>entry.reject(tx.error || new Error('Storage read aborted.')));
    scheduled=false;
    if (waiting.length) { scheduled=true; Promise.resolve().then(drain); }
  }
  const decode = async (key, weight = 1) => {
    if (cache.has(key)) return cache.get(key).then(result => { advance(weight); return copyValue(result); });
    const task = (async () => {
      const text = await readPart(key);
      await yieldForProgress();
      if (typeof text !== 'string') throw new Error('Saved analysis is missing a data chunk. Restore its complete backup.');
      const [type, data] = JSON.parse(text);
      const partWeight = weight / Math.max(1, data?.length || 0);
      const child = entry => {
        if (Object.prototype.hasOwnProperty.call(entry, 'ref')) return decode(entry.ref, partWeight);
        advance(partWeight); return entry.value;
      };
      if (['array', 'object', 'pages'].includes(type) && data.length === 0) advance(weight);
      if (type === 'value') { advance(weight); return data; }
      if (type === 'string') return (await decode(data, weight)).join('');
      if (type === 'array') return Promise.all(data.map(child));
      if (type === 'object') { const values = await Promise.all(data.map(([, entry]) => child(entry))); const result = {}; data.forEach(([name], i) => Object.defineProperty(result, name, {value:values[i], enumerable:true, writable:true, configurable:true})); return result; }
      if (type === 'pages') {
        let result;
        for (const ref of data) {
          const page = await decode(ref, partWeight);
          if (Array.isArray(page)) { if (!result) result = []; for (const entry of page) result.push(entry); }
          else result = Object.assign(result || {}, page);
        }
        return result;
      }
      throw new Error('Unsupported analysis storage chunk.');
    })();
    cache.set(key, task);
    return task;
  };
  const result = await decode(value.root);
  report(100);
  return result;
}
export async function readRecord(db, store, key, options) { return hydrateRecord(db, store, await rawRecord(db, store, key), options); }
export async function writeRecord(db, store, key, value, options) {
  const before=await rawRecord(db,store,key);
  const baseline=isChunkedRecord(before) ? before.root : JSON.stringify(before);
  if (options && Object.prototype.hasOwnProperty.call(options, 'expectedBaseline') && options.expectedBaseline !== baseline) {
    throw Object.assign(new Error('Saved analysis changed while the functional model was being generated.'), { code: 'SOURCE_PUBLICATION_CONFLICT' });
  }
  const staged = await stageRecord(db, store, key, value, options);
  aborted(options?.signal);
  const tx=db.transaction(store,'readwrite'), objectStore=tx.objectStore(store), done=transactionDone(tx);
  let failure;
  const current=objectStore.get(key);
  current.onsuccess=()=>{
    try {
      const data=current.result?.value;
      if((isChunkedRecord(data)?data.root:JSON.stringify(data))!==baseline) throw Object.assign(new Error('Saved analysis changed during this write. Current results were preserved.'),{code:'SOURCE_PUBLICATION_CONFLICT'});
      if (!isChunkedRecord(data) || data.root !== staged.root) objectStore.put({key,value:staged});
    } catch(error) {failure=error;tx.abort();}
  };
  try {await done;}catch(error){throw failure || error;}
  return staged;
}
