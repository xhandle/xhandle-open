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
    // Scalars stay inline; compound objects are deduplicated by content and identity.
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
export async function hydrateRecord(db, store, value) {
  if (!isChunkedRecord(value)) return value;
  const cache = new Map(), waiting = [];
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
  const decode = async key => {
    if (cache.has(key)) return cache.get(key).then(copyValue);
    const task = (async () => {
      const text = await readPart(key);
      if (typeof text !== 'string') throw new Error('Saved analysis is missing a data chunk. Restore its complete backup.');
      const [type, data] = JSON.parse(text);
      const child = entry => Object.prototype.hasOwnProperty.call(entry, 'ref') ? decode(entry.ref) : entry.value;
      if (type === 'value') return data;
      if (type === 'string') return (await decode(data)).join('');
      if (type === 'array') return Promise.all(data.map(child));
      if (type === 'object') { const values = await Promise.all(data.map(([, entry]) => child(entry))); const result = {}; data.forEach(([name], i) => Object.defineProperty(result, name, {value:values[i], enumerable:true, writable:true, configurable:true})); return result; }
      if (type === 'pages') {
        let result;
        for (const ref of data) {
          const page = await decode(ref);
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
  return decode(value.root);
}
export async function readRecord(db, store, key) { return hydrateRecord(db, store, await rawRecord(db, store, key)); }
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
      objectStore.put({key,value:staged});
    } catch(error) {failure=error;tx.abort();}
  };
  try {await done;}catch(error){throw failure || error;}
  return staged;
}
