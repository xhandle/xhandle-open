import {hazardValueBytes,hazardTextKey} from './hazardMemory';
export async function boundedHazardStorage(promise,timeoutMs=1500) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Browser storage did not respond in time')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

const permanent=error=>['QuotaExceededError','SecurityError','NotSupportedError','DataCloneError'].includes(error?.name);
// The writer remains attached to a slow operation until it settles. Never race
// a second write against a timed-out first write: it could restore stale data.
export function resilientHazardCheckpoint(backend,{signal,onStorageState=()=>{},slowMs=5000,readTimeoutMs=5000,flushMs=1500,retryDelays=[1000,3000,10000],maxCleanEntries=96,maxCleanBytes=4*1024*1024,maxPendingEntries=192,maxPendingBytes=8*1024*1024,producerSignal=signal}={}) {
  const values=new Map(),dirty=new Map(),valueSizes=new Map();
  let pendingBytes=0;const sizes=new WeakMap(),capacityWaiters=new Set();
  const wake=()=>{for(const resolve of capacityWaiters)resolve();capacityWaiters.clear();};
  const checkProducer=()=>{if(producerSignal?.aborted || signal?.aborted)throw new DOMException('Hazard analysis cancelled.','AbortError');};
  let draining=null,retryTimer=null,retries=0,stopped=false,readUnavailable=false,readEpoch=0,readRetryAt=0,readFailures=0;
  let writeQueue=Promise.resolve();
  const identities=new WeakMap();
  const id=async basis=>{
    if(basis && typeof basis==='object' && identities.has(basis))return identities.get(basis);
    const serialized=JSON.stringify(basis);
    if(basis && typeof basis==='object')sizes.set(basis,serialized.length*2);
    const identity=typeof crypto!=='undefined' && crypto.subtle
      ? crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)).then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''))
      : Promise.resolve(hazardTextKey(serialized));
    if(basis && typeof basis==='object')identities.set(basis,identity);
    return identity;
  };
  const trim=()=>{
    let clean=values.size-dirty.size,bytes=0;
    for(const [key,size] of valueSizes)if(!dirty.has(key))bytes+=size;
    for(const key of values.keys()){
      if(clean<=maxCleanEntries && bytes<=maxCleanBytes)break;
      if(!dirty.has(key)){bytes-=valueSizes.get(key) || 0;values.delete(key);valueSizes.delete(key);clean--;}
    }
  };
  const failRead=(error,pending=false)=>{
    readUnavailable=true;
    readRetryAt=pending || permanent(error) || readFailures>=retryDelays.length?Infinity:Date.now()+retryDelays[readFailures++];
  };
  const pausedMessage='Analysis paused while progress is saved. If storage cannot recover, cancel and continue later.';
  const notify=state=>{if(!signal?.aborted)try{onStorageState({...state,...(capacityWaiters.size?{unsaved:true,status:'pending',message:pausedMessage}:{}),pending:dirty.size});}catch{}};
  const saved=()=>{if(!dirty.size)notify({unsaved:false,status:'saved',message:''});};
  // A failed open can be retried; a pending open is shared, never duplicated.
  let ready=null;
  const target=()=>{
    if(!ready){
      ready=Promise.resolve().then(()=>typeof backend==='function'?backend():backend);
      ready.catch(()=>{if(typeof backend==='function')ready=null;});
    }
    return ready;
  };
  if(typeof backend!=='function')target();
  const cancel=()=>{clearTimeout(retryTimer);retryTimer=null;stopped=true;wake();};
  signal?.addEventListener('abort',cancel,{once:true});
  async function drain(){
    while(dirty.size && !signal?.aborted){
      const batch=[];for(const entry of dirty){batch.push(entry);if(batch.length===48)break;}
      const slow=setTimeout(()=>notify({unsaved:true,status:'pending',message:'Progress is still being saved. Keep this browser tab open.'}),slowMs);
      try{
        const connection=await target();
        if(signal?.aborted)return;
        if(!connection)throw Object.assign(new Error('Checkpoint storage is unavailable. Keep this browser tab open.'),{name:'NotSupportedError'});
        if(connection.writeMany)await connection.writeMany(batch.map(([,entry])=>({basis:entry.basis,value:entry.value})));
        else for(const [,entry] of batch){if(signal?.aborted)return;await connection.write(entry.basis,entry.value);}
        if(signal?.aborted)return;
        for(const [key,entry] of batch)if(dirty.get(key)===entry){pendingBytes-=entry.bytes;dirty.delete(key);}
        trim();wake();
        retries=0;
        // A healthy write permits an early read probe, but does not reset the
        // bounded read retry count or revive a permanent failure.
        if(Number.isFinite(readRetryAt))readRetryAt=0;
        saved();
      }catch(error){
        if(signal?.aborted)return;
        notify({unsaved:true,status:'failed',errorName:error?.name,message:error?.message || 'Checkpoint write failed'});
        if(permanent(error) || retries>=retryDelays.length)stopped=true;
        else retryTimer=setTimeout(()=>{retryTimer=null;start();},retryDelays[retries++]);
        return;
      }finally{clearTimeout(slow);}
    }
  }
  function start(){
    if(!draining && !retryTimer && !stopped && !signal?.aborted && dirty.size){
      draining=drain().finally(()=>{draining=null;if(dirty.size && !stopped && !retryTimer && !signal?.aborted)start();});
    }
    return draining;
  }
  async function capacity(key,bytes){
    let paused=false;
    while(dirty.size && (dirty.size+(dirty.has(key)?0:1)>maxPendingEntries || pendingBytes-(dirty.get(key)?.bytes || 0)+bytes>maxPendingBytes)){
      checkProducer();
      paused=true;
      notify({unsaved:true,status:'pending',message:pausedMessage});
      await new Promise((resolve,reject)=>{
        const finish=()=>{capacityWaiters.delete(finish);producerSignal?.removeEventListener('abort',abort);resolve();};
        const abort=()=>{capacityWaiters.delete(finish);producerSignal?.removeEventListener('abort',abort);reject(new DOMException('Hazard analysis cancelled.','AbortError'));};
        capacityWaiters.add(finish);producerSignal?.addEventListener('abort',abort,{once:true});
        if(producerSignal?.aborted)abort();
      });
    }
    checkProducer();
    if(paused)notify({unsaved:dirty.size>0,status:dirty.size?'pending':'saved',message:dirty.size?'Analysis resumed. Progress is still being saved.':''});
  }
  return {
    memoryStats:()=>({pending:dirty.size,pendingBytes,maxPendingEntries,maxPendingBytes}),
    async readMany(bases){
      const savedValues=new Array(bases.length);
      const keys=[];
      // Hash one basis at a time: a row-count batch does not bound byte buffers.
      for(const basis of bases)keys.push(await id(basis));
      for(let offset=0;offset<bases.length;offset+=48){
        if(signal?.aborted)throw new DOMException('Hazard analysis cancelled.','AbortError');
        if(readUnavailable && Date.now()<readRetryAt)break;
        const group=bases.slice(offset,offset+48);
        if(group.every((b,i)=>values.has(keys[offset+i])))continue;
        readUnavailable=false;
        const epoch=++readEpoch;
        const ownsReadState=()=>epoch===readEpoch && !signal?.aborted;
        let settled=false;
        const operation=(async()=>{const connection=await target();return connection?.readMany?connection.readMany(group):Promise.all(group.map(b=>connection?.read?.(b)));})();
        // A late successful read may restore read availability, but must not
        // overwrite newer in-memory results or clear a pending-write warning.
        operation.then(()=>{settled=true;if(ownsReadState()){readUnavailable=false;readFailures=0;readRetryAt=0;saved();}},error=>{settled=true;if(ownsReadState() && readUnavailable)failRead(error);});
        try{savedValues.splice(offset,group.length,...await boundedHazardStorage(operation,readTimeoutMs));}
        catch(error){
          if(signal?.aborted)throw error;
          // The timeout/rejection path must obey the same ownership check as
          // late settlement: an older request cannot poison a newer read's state.
          if(ownsReadState()){
            failRead(error,!settled);
            notify({unsaved:dirty.size>0,status:'read-failed',errorName:error?.name,message:'Saved checkpoints could not be loaded; new progress will still be saved.'});
          }
          break;
        }
      }
      return bases.map((b,i)=>values.has(keys[i])?values.get(keys[i]):savedValues[i]);
    },
    async read(basis){return (await this.readMany([basis]))[0];},
    writeMany(entries){
      // Digests are asynchronous: preserve call order even if hashing finishes
      // out of order, so an older value cannot replace a newer checkpoint.
      const operation=writeQueue.then(async()=>{
        for(const entry of entries){
          const key=await id(entry.basis);
          if(signal?.aborted)return;
          const valueBytes=hazardValueBytes(entry.value);
          const bytes=(sizes.get(entry.basis) || hazardValueBytes(entry.basis))+valueBytes;
          await capacity(key,bytes);
          pendingBytes-=dirty.get(key)?.bytes || 0;
          pendingBytes+=bytes;
          values.set(key,entry.value);valueSizes.set(key,valueBytes+key.length*2);dirty.set(key,{...entry,bytes});
          trim();
          start();
        }
        start();
      });
      writeQueue=operation.catch(()=>{});
      return operation;
    },
    async write(basis,value){return this.writeMany([{basis,value}]);},
    async flush(){
      const pending=draining || start();
      if(pending)try{await boundedHazardStorage(pending,flushMs);}catch{/* Still pending; the original operation owns recovery. */}
      return {unsaved:dirty.size>0,pending:dirty.size};
    },
  };
}
