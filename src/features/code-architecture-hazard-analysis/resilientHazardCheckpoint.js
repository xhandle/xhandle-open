export async function boundedHazardStorage(promise,timeoutMs=1500) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Browser storage did not respond in time')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

const permanent=error=>['QuotaExceededError','SecurityError','NotSupportedError','DataCloneError'].includes(error?.name);
// The writer remains attached to a slow operation until it settles. Never race
// a second write against a timed-out first write: it could restore stale data.
export function resilientHazardCheckpoint(backend,{signal,onStorageState=()=>{},slowMs=5000,readTimeoutMs=5000,flushMs=1500,retryDelays=[1000,3000,10000]}={}) {
  const values=new Map(),dirty=new Map();
  let draining=null,retryTimer=null,retries=0,stopped=false,readUnavailable=false,readEpoch=0,readRetryAt=0,readFailures=0;
  const id=basis=>JSON.stringify(basis);
  const failRead=(error,pending=false)=>{
    readUnavailable=true;
    readRetryAt=pending || permanent(error) || readFailures>=retryDelays.length?Infinity:Date.now()+retryDelays[readFailures++];
  };
  const notify=state=>{if(!signal?.aborted)try{onStorageState({...state,pending:dirty.size});}catch{}};
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
  const cancel=()=>{clearTimeout(retryTimer);retryTimer=null;stopped=true;};
  signal?.addEventListener('abort',cancel,{once:true});
  async function drain(){
    while(dirty.size && !signal?.aborted){
      const batch=[...dirty.entries()].slice(0,48);
      const slow=setTimeout(()=>notify({unsaved:true,status:'pending',message:'Progress is still being saved. Keep this browser tab open.'}),slowMs);
      try{
        const connection=await target();
        if(signal?.aborted)return;
        if(!connection)throw Object.assign(new Error('Checkpoint storage is unavailable. Keep this browser tab open.'),{name:'NotSupportedError'});
        if(connection.writeMany)await connection.writeMany(batch.map(([,entry])=>entry));
        else for(const [,entry] of batch){if(signal?.aborted)return;await connection.write(entry.basis,entry.value);}
        if(signal?.aborted)return;
        batch.forEach(([key,entry])=>{if(dirty.get(key)===entry)dirty.delete(key);});
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
  return {
    async readMany(bases){
      const savedValues=new Array(bases.length);
      for(let offset=0;offset<bases.length;offset+=48){
        if(signal?.aborted)throw new DOMException('Hazard analysis cancelled.','AbortError');
        if(readUnavailable && Date.now()<readRetryAt)break;
        const group=bases.slice(offset,offset+48);
        if(group.every(b=>values.has(id(b))))continue;
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
      return bases.map((b,i)=>values.has(id(b))?values.get(id(b)):savedValues[i]);
    },
    async read(basis){return (await this.readMany([basis]))[0];},
    async writeMany(entries){for(const entry of entries){const key=id(entry.basis);values.set(key,entry.value);dirty.set(key,entry);}start();},
    async write(basis,value){return this.writeMany([{basis,value}]);},
    async flush(){
      const pending=draining || start();
      if(pending)try{await boundedHazardStorage(pending,flushMs);}catch{/* Still pending; the original operation owns recovery. */}
      return {unsaved:dirty.size>0,pending:dirty.size};
    },
  };
}
