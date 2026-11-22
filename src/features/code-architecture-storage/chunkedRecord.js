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
export async function rawRecord(db, store, key, { signal } = {}) {
  aborted(signal);
  const tx = db.transaction(store, 'readonly');
  return new Promise((resolve, reject) => {
    const stop = () => { try { tx.abort(); } catch {} finish(signal.reason || new DOMException('Read cancelled.', 'AbortError')); };
    const finish = (error, value) => { signal?.removeEventListener('abort', stop); error ? reject(error) : resolve(value); };
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => finish(null, request.result?.value);
    request.onerror = () => finish(request.error);
    tx.onabort = () => finish(tx.error || new DOMException('Read aborted.', 'AbortError'));
    signal?.addEventListener('abort', stop, { once: true });
  });
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

// Cache serialized chunks only. Caching decoded subtrees retained a second tree
// while mutable readers received copies of it. Ordinary reads still own every
// mutable value; immutable evidence sharing is an explicit UI-boundary option.
export function freezeEvidence(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeEvidence(child);
  return Object.freeze(value);
}
const evidencePath = path => (path.length >= 2 && (
  (path[path.length - 2] === 'codeEvidence' && ['files', 'sourceFunctions'].includes(path[path.length - 1])) ||
  (path[path.length - 2] === 'sourceEvidence' && path[path.length - 1] === 'functions'))) || (path.length >= 3 && (
  (path[path.length - 3] === 'codeEvidence' && ['files', 'sourceFunctions'].includes(path[path.length - 2])) ||
  (path[path.length - 3] === 'sourceEvidence' && path[path.length - 2] === 'functions')));

function recordReader(db, store, { signal, cacheBytes = 4 * 1024 * 1024, immutableEvidence = false, onMetrics } = {}) {
  const cache = new Map(), evidence = new Map();
  let bytes = 0, peakCacheBytes = 0, chunksRead = 0, lastYield = Date.now();
  const tick = async () => {
    aborted(signal);
    if (Date.now() - lastYield >= 8) { await pause(); lastYield = Date.now(); aborted(signal); }
  };
  const part = async key => {
    await tick();
    let text = cache.get(key);
    if (text !== undefined) { cache.delete(key); cache.set(key, text); }
    else {
      text = await rawRecord(db, store, key, { signal }); chunksRead++;
      if (typeof text !== 'string') throw new Error('Saved analysis is missing a data chunk. Restore its complete backup.');
      const size = text.length * 2;
      while (bytes + size > cacheBytes && cache.size) { const oldest = cache.keys().next().value; bytes -= cache.get(oldest).length * 2; cache.delete(oldest); }
      if (size <= cacheBytes) { cache.set(key, text); bytes += size; peakCacheBytes = Math.max(peakCacheBytes, bytes); }
      onMetrics?.({ cacheBytes: bytes, peakCacheBytes, chunksRead });
    }
    const node = JSON.parse(text);
    if (!Array.isArray(node) || node.length !== 2 || !['value', 'array', 'object', 'pages', 'string'].includes(node[0])) throw new Error('Unsupported analysis storage chunk.');
    if (['array', 'object', 'pages'].includes(node[0]) && !Array.isArray(node[1])) throw new Error('Invalid analysis storage page.');
    return node;
  };
  const decode = async (key, advance = () => {}, weight = 1, path = [], parents = new Set()) => {
    if (parents.has(key)) throw new Error('Cyclic analysis storage chunk.');
    const shared = immutableEvidence && evidencePath(path);
    if (shared && evidence.has(key)) { advance(weight); return evidence.get(key); }
    const next = new Set(parents); next.add(key);
    const [type, data] = await part(key);
    const partWeight = weight / Math.max(1, data?.length || 0);
    const child = async (entry, name) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid analysis storage entry.');
      const childPath = [...path, name];
      if (Object.prototype.hasOwnProperty.call(entry, 'ref')) {
        if (typeof entry.ref !== 'string') throw new Error('Invalid analysis storage reference.');
        return decode(entry.ref, advance, partWeight, childPath, next);
      }
      if (!Object.prototype.hasOwnProperty.call(entry, 'value')) throw new Error('Invalid analysis storage entry.');
      advance(partWeight); return immutableEvidence && evidencePath(childPath) ? freezeEvidence(entry.value) : entry.value;
    };
    let result;
    if (type === 'value') { advance(weight); result = data; }
    else if (type === 'string') result = (await decode(data, advance, weight, path, next)).join('');
    else {
      if (!data.length) advance(weight);
      result = type === 'object' ? {} : [];
      // Sequential decoding bounds pending work as well as cached bytes.
      for (let i = 0; i < data.length; i++) {
        if (type === 'array') result.push(await child(data[i], i));
        else if (type === 'object') {
          if (!Array.isArray(data[i]) || data[i].length !== 2 || typeof data[i][0] !== 'string') throw new Error('Invalid analysis storage property.');
          const [name, entry] = data[i];
          Object.defineProperty(result, name, {value: await child(entry, name), enumerable: true, writable: true, configurable: true});
        } else {
          if (typeof data[i] !== 'string') throw new Error('Invalid analysis storage page reference.');
          const page = await decode(data[i], advance, partWeight, path, next);
          if (Array.isArray(page)) { for (const entry of page) result.push(entry); }
          else { if (Array.isArray(result)) result = {}; for (const name of Object.keys(page)) Object.defineProperty(result, name, {value:page[name], enumerable:true, writable:true, configurable:true}); }
        }
      }
    }
    if (shared) { freezeEvidence(result); evidence.set(key, result); }
    return result;
  };
  return { part, decode, tick };
}

export async function hydrateRecord(db, store, value, options = {}) {
  aborted(options.signal);
  let completed = 0, reported = -1;
  const report = percent => { const next = Math.max(reported, Math.min(100, Math.floor(percent))); if (next !== reported) { reported = next; options.onProgress?.(next); } };
  report(0);
  if (!isChunkedRecord(value)) { report(100); return value; }
  const reader = recordReader(db, store, options);
  const result = await reader.decode(value.root, weight => { completed += weight; report(Math.min(99, completed * 100)); });
  aborted(options.signal); report(100); return result;
}

// Visit the stored array a page at a time. Consumers can stop after a preview;
// no complete result or decoded-tree cache is constructed along the way.
export async function* iterateRecordArray(db, store, value, options = {}) {
  const { signal, batchRows = 128, batchBytes = 2 * 1024 * 1024, offset = 0, limit = Infinity } = options;
  if (!(batchRows > 0) || !(batchBytes > 0)) throw new Error('Batch limits must be positive.');
  const reader = recordReader(db, store, options);
  let index = 0, emitted = 0, batch = [], bytes = 0;
  async function* entries(ref, parents = new Set()) {
    aborted(signal);
    if (parents.has(ref)) throw new Error('Cyclic analysis storage chunk.');
    const next = new Set(parents); next.add(ref);
    const [type, data] = await reader.part(ref);
    if (type === 'pages') { for (const child of data) yield* entries(child, next); }
    else if (type === 'array') { for (const entry of data) yield entry; }
    else throw new Error('Saved analysis record is not an array.');
  }
  const source = isChunkedRecord(value) ? entries(value.root) : (async function* () { if (!Array.isArray(value)) throw new Error('Saved analysis record is not an array.'); for (const row of value) yield {value:row}; })();
  for await (const entry of source) {
    if (emitted >= limit) break;
    if (index++ < offset) continue;
    const row = Object.prototype.hasOwnProperty.call(entry, 'ref') ? await reader.decode(entry.ref) : entry.value;
    const size = JSON.stringify(row)?.length * 2 || 4;
    if (batch.length && (bytes + size > batchBytes || batch.length >= batchRows)) { yield batch; batch = []; bytes = 0; }
    batch.push(row); bytes += size; emitted++;
    await reader.tick();
  }
  if (batch.length) yield batch;
}

export async function countRecordArray(db, store, value, options = {}) {
  if (!isChunkedRecord(value)) return Array.isArray(value) ? value.length : 0;
  const reader = recordReader(db, store, options);
  const count = async (ref, parents = new Set()) => {
    if (parents.has(ref)) throw new Error('Cyclic analysis storage chunk.');
    const next = new Set(parents); next.add(ref);
    const [type, data] = await reader.part(ref);
    if (type === 'array') return data.length;
    if (type !== 'pages') throw new Error('Saved analysis record is not an array.');
    let total = 0;
    for (const child of data) total += await count(child, next);
    return total;
  };
  return count(value.root);
}

// Validate the graph without hydrating its repeated evidence. Only compact
// visited keys survive a chunk visit. Hash verification is optional for legacy
// encodings; publication enables it for the content-addressed current format.
export async function inspectRecord(db, store, value, { prefix, verifyHashes = false, ...options } = {}) {
  const reader = recordReader(db, store, options), visited = new Map(), active = new Set();
  const validate = async ref => {
    if (typeof ref !== 'string' || (prefix && !ref.startsWith(prefix + PART))) throw new Error('Analysis chunk belongs to another record.');
    if (active.has(ref)) throw new Error('Cyclic analysis storage chunk.');
    if (visited.has(ref)) return visited.get(ref);
    active.add(ref);
    const [type, data] = await reader.part(ref);
    if (verifyHashes && ref !== `${prefix}${PART}${await digest(JSON.stringify([type, data]))}`) throw new Error('Analysis chunk checksum does not match.');
    let count = 0, kind = type;
    const child = async entry => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid analysis storage entry.');
      if (Object.prototype.hasOwnProperty.call(entry, 'ref')) return validate(entry.ref);
      if (!Object.prototype.hasOwnProperty.call(entry, 'value')) throw new Error('Invalid analysis storage entry.');
      return {kind:typeof entry.value};
    };
    if (type === 'array') { for (const entry of data) await child(entry); count = data.length; }
    else if (type === 'object') {
      for (const property of data) { if (!Array.isArray(property) || property.length !== 2 || typeof property[0] !== 'string') throw new Error('Invalid analysis storage property.'); await child(property[1]); }
    } else if (type === 'pages') {
      for (const ref of data) { const page = await validate(ref); if (!['array', 'object'].includes(page.kind) || (kind !== 'pages' && kind !== page.kind)) throw new Error('Inconsistent analysis storage pages.'); kind = page.kind; count += page.count; }
      if (!data.length) kind = 'array';
    } else if (type === 'string') { const chars = await validate(data); if (chars.kind !== 'array') throw new Error('Invalid analysis storage string.'); }
    const result = {kind, count}; active.delete(ref); visited.set(ref, result); return result;
  };
  if (!isChunkedRecord(value)) return {kind:Array.isArray(value) ? 'array' : typeof value, count:Array.isArray(value) ? value.length : 0};
  const result = await validate(value.root);
  return {...result, chunks:visited.size};
}

// Read a single manifest property without expanding its other fields.
export async function readRecordProperty(db, store, value, name, options = {}) {
  if (!isChunkedRecord(value)) return value?.[name];
  const reader = recordReader(db, store, options);
  const find = async (ref, parents = new Set()) => {
    if (parents.has(ref)) throw new Error('Cyclic analysis storage chunk.');
    const next = new Set(parents); next.add(ref);
    const [type, data] = await reader.part(ref);
    if (type === 'pages') { for (const child of data) { const found = await find(child, next); if (found.found) return found; } return {found:false}; }
    if (type !== 'object') throw new Error('Saved analysis manifest is not an object.');
    const entry = data.find(([key]) => key === name)?.[1];
    return entry ? {found:true, value:Object.prototype.hasOwnProperty.call(entry, 'ref')
      ? options.descriptorOnly ? {format:FORMAT, root:entry.ref} : await reader.decode(entry.ref)
      : entry.value} : {found:false};
  };
  return (await find(value.root)).value;
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
      for (const removeKey of options?.removeKeys || []) objectStore.delete(removeKey);
    } catch(error) {failure=error;tx.abort();}
  };
  try {await done;}catch(error){throw failure || error;}
  return staged;
}
