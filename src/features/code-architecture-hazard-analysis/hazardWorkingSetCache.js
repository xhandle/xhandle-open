import {openDB} from 'idb';
import {chunkHazardRun, hazardChunkKey, hazardChunkDigest, validateHazardDescriptor} from './hazardRunChunks';
import {createValueAssembler} from '../code-architecture-transfer/archiveValueStream';
import {sha256} from 'hash.js';
import {readHazardTransaction} from './readHazardTransaction';
const NAME='xhandle-hazard-working-set-v1';
const check=signal=>{if(signal?.aborted)throw new DOMException('Hazard loading cancelled.','AbortError');};
async function open(options) {
  check(options.signal);
  let connection;
  return new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(error,db)=>{
      if(finished){db?.close();return;}
      finished=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(db);
    };
    const abort=()=>finish(new DOMException('Hazard loading cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(Error('Saved table cache is unavailable.')),3000);
    options.signal?.addEventListener('abort',abort,{once:true});
    openDB(NAME,1,{upgrade(db){db.createObjectStore('roots',{keyPath:'key'});db.createObjectStore('pages',{keyPath:'id'});},blocking(){connection?.close();}})
      .then(db=>{connection=db;finish(null,db);},error=>finish(error));
  });
}
export const workingSetKey = meta => JSON.stringify([meta.id,meta.projectId,meta.repoId,meta.storageRevision]);
export async function readWorkingSet(key,options={}) {
  const db=await open(options);
  let tx;
  const abort=()=>{try{tx?.abort();}catch{}};
  options.signal?.addEventListener('abort',abort,{once:true});
  try {
    tx=db.transaction(['roots','pages']);tx.done.catch(()=>{});check(options.signal);
    const root=await tx.objectStore('roots').get(key);
    if(!root){await tx.done;return null;}
    if(!Array.isArray(root.paths) || root.paths.some(path=>!Array.isArray(path) || !path.length ||
      !['architectureRowsSnapshot','narrativeReviewInput'].includes(path[path.length-1]) ||
      path.slice(0,-1).some(key=>key!=='pendingAttempt')))throw Error('Invalid saved table manifest.');
    let run=root.run;
    if(run?.payload){
      const p=validateHazardDescriptor(run),assembler=createValueAssembler(),hash=sha256();
      for(let start=0;start<p.count;start+=16){
        check(options.signal);const end=Math.min(start+16,p.count);
        const pages=await tx.objectStore('pages').getAll(IDBKeyRange.bound(hazardChunkKey(p.generation,start),hazardChunkKey(p.generation,end-1)),16);
        if(pages.length!==end-start)throw Error('Incomplete saved table pages.');
        for(let i=0;i<pages.length;i++){
          const page=pages[i];
          if(page.sequence!==start+i || page.generation!==p.generation || page.digest!==hazardChunkDigest(page.tokens))throw Error('Damaged saved table page.');
          hash.update(page.digest+'\n');for(const token of page.tokens)assembler.add(token);
        }
      }
      if(hash.digest('hex')!==p.digest)throw Error('Damaged saved table manifest.');
      run=assembler.finish();
    }
    await tx.done;check(options.signal);return {run,paths:root.paths};
  }finally{abort();await tx?.done.catch(()=>{});options.signal?.removeEventListener('abort',abort);db.close();}
}
export async function writeWorkingSet(key,run,paths,options={}) {
  const db=await open(options);let staged,generation,published=false,bytes=0;
  try {
    for await(const entry of chunkHazardRun(run,options)){
      check(options.signal);
      if(entry.chunk){generation=entry.chunk.generation;bytes+=JSON.stringify(entry.chunk.tokens).length*2;
        if(bytes>64*1024*1024)throw Error('Saved table exceeds the disposable cache budget.');
        await readHazardTransaction(db,'pages',store=>store.put(entry.chunk),{...options,mode:'readwrite'});}
      else staged=entry.run;
    }
    check(options.signal);
    const tx=db.transaction(['roots','pages'],'readwrite');tx.done.catch(()=>{});
    try {
      // Retain at most one working set per run. Readers hold a snapshot while
      // older pages are retired. A concurrent old builder can cause a cache
      // miss, never a stale read: lookup always includes the source revision.
      let cursor=await tx.objectStore('roots').openCursor();
      while(cursor){
        if(cursor.value.run.id===run.id){
          const old=cursor.value.run.payload;
          if(old)await tx.objectStore('pages').delete(IDBKeyRange.bound(old.generation+':',old.generation+':\uffff'));
          await cursor.delete();
        }
        cursor=await cursor.continue();
      }
      check(options.signal);await tx.objectStore('roots').put({key,run:staged,paths});await tx.done;published=true;
    }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
  }finally{
    if(generation&&!published)await db.delete('pages',IDBKeyRange.bound(generation+':',generation+':\uffff')).catch(()=>{});
    db.close();
  }
}

export async function deleteWorkingSets(runIds) {
  if(!runIds.size)return;
  const db=await open({});
  const tx=db.transaction(['roots','pages'],'readwrite');tx.done.catch(()=>{});
  try {
    let cursor=await tx.objectStore('roots').openCursor();
    while(cursor){
      if(runIds.has(cursor.value.run.id)){
        const generation=cursor.value.run.payload?.generation;
        if(generation)await tx.objectStore('pages').delete(IDBKeyRange.bound(generation+':',generation+':\uffff'));
        await cursor.delete();
      }
      cursor=await cursor.continue();
    }
    await tx.done;
  }finally{try{tx.abort();}catch{}await tx.done.catch(()=>{});db.close();}
}
