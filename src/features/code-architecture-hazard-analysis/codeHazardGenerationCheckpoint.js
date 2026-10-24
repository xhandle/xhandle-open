import { openCodeArchitectureHazardDB } from './codeArchitectureHazardStore';

const STORE = 'generationCheckpoints';
// Bump when prompts, interpretation or audit contracts change.
const VERSION = 'stpa-performance-v1';
// A failed request can abort siblings. Observe them all and retain the initiating
// error (e.g. quota), rather than replacing it with a sibling's generic abort.
async function batchRequests(tx, works) {
  let failure;
  const failed=error=>{
    if(!failure || (failure.name==='AbortError' && error.name!=='AbortError'))failure=error;
    try{tx.abort();}catch{}
  };
  const requests=works.map(work=>{
    try{return Promise.resolve(work()).catch(error=>{failed(error);throw error;});}
    catch(error){failed(error);return Promise.reject(error);}
  });
  const settled=await Promise.allSettled(requests);
  if(failure)throw failure;
  return settled.map(result=>result.value);
}
export async function checkpointDigest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createCodeHazardCheckpoint(scopeParts, { regenerate = false, signal, onProgress = () => {} } = {}) {
  let db = await openCodeArchitectureHazardDB();
  if (!db || (typeof crypto === "undefined" || !crypto.subtle)) return null;
  const scope = JSON.stringify(scopeParts);
  const check = () => { if (signal?.aborted) throw new DOMException('Hazard analysis cancelled.', 'AbortError'); };
  const transaction = async (mode, work) => {
    // Observe transaction completion before issuing requests: a synchronous
    // request failure can otherwise leave tx.done rejected and unhandled.
    for(let attempt=0;attempt<2;attempt++){
      check();
      let tx,done;
      const abortTransaction=()=>{try{tx?.abort();}catch{}};
      try {
        tx=db.transaction(STORE,mode);
        done=tx.done;
        done.catch(()=>{});
        signal?.addEventListener('abort',abortTransaction,{once:true});
        check();
        const value=await work(tx);
        await done;
        check();
        return value;
      } catch(error) {
        try{tx?.abort();}catch{}
        if(done)await done.catch(()=>{});
        check();
        // These operations are atomic and idempotent. Retry a transient abort
        // once in a fresh transaction; never retry cancellation or quota errors.
        const retry=attempt===0 && ['AbortError','TransactionInactiveError','InvalidStateError'].includes(error?.name);
        console.warn('[hazard-checkpoint]',JSON.stringify({event:retry?'retry':'failed',mode,errorType:error?.name,errorCode:error?.code,attempt:attempt+1}));
        if(!retry)throw error;
        if(error?.name==='InvalidStateError')db=await openCodeArchitectureHazardDB();
      }finally{signal?.removeEventListener('abort',abortTransaction);}
    }
  };
  if (regenerate) {
    await transaction('readwrite',async tx=>{
    let cursor = await tx.store.index('scope').openCursor(scope);
    while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
    });
  }
  const used = new Set();
  const digests = new WeakMap();
  const identify = async basis => {
    check();
    if (!digests.has(basis)) digests.set(basis, checkpointDigest([VERSION, scope, basis]));
    const id = await digests.get(basis);
    used.add(id);
    check();
    return id;
  };
  return {
    async readMany(bases) {
      const values=[];
      for(let offset=0;offset<bases.length;offset+=48){
        const ids=[];for(const basis of bases.slice(offset,offset+48))ids.push(await identify(basis));
        check();
        const records=await transaction('readonly',tx=>batchRequests(tx,ids.map(id=>()=>tx.store.get(id))));
        values.push(...records.map(record=>record?.value));
        check();
      }
      return values;
    },
    async writeMany(entries) {
      const ids=[];for(const entry of entries)ids.push(await identify(entry.basis));
      check();
      await transaction('readwrite',tx=>batchRequests(tx,entries.map((entry,index) => ()=>tx.store.put({id:ids[index], scope,
        projectId:scopeParts.projectId, repoId:scopeParts.repoId, value:entry.value,
        savedAt:new Date().toISOString()}))));
      check();
    },
    async prune() {
      check();
      await transaction('readwrite',async tx=>{
      let cursor = await tx.store.index('scope').openKeyCursor(scope);
      while (cursor) {
        if (!used.has(cursor.primaryKey)) await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      });
    },
    async read(basis) {
      check();
      const id = await identify(basis);
      used.add(id);
      const record = await transaction('readonly',tx=>tx.store.get(id));
      check();
      if (record) onProgress({message: 'Reusing saved hazard-analysis work with matching inputs…'});
      return record?.value;
    },
    async write(basis, value) {
      check();
      const id = await identify(basis);
      used.add(id);
      check();
      await transaction('readwrite',tx=>tx.store.put({id, scope, projectId: scopeParts.projectId, repoId: scopeParts.repoId, value, savedAt: new Date().toISOString()}));
    },
  };
}
