import { wrap } from 'idb';

const cancelled = () => new DOMException('Project transfer cancelled.', 'AbortError');
const retryable = error => error?.code==='STORAGE_OPEN_TIMEOUT' || ['UnknownError', 'AbortError'].includes(error?.name);

// An IndexedDB open request cannot be cancelled. Retired requests must close
// late connections and abort late upgrades, never perform work after rejection.
function attemptOpen(name, {version, upgrade, existingOnly, signal, timeoutMs}) {
  return new Promise((resolve, reject) => {
    let settled=false, absent=false, timer, request;
    const finish=(error, db)=>{
      if(settled){db?.close();return;}
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);
      if(error){try{request?.transaction?.abort();}catch{}}
      if(error)reject(error);else resolve(db);
    };
    const stop=()=>finish(cancelled());
    if(signal?.aborted){stop();return;}
    signal?.addEventListener('abort',stop,{once:true});
    timer=setTimeout(()=>finish(Object.assign(new Error(`Storage did not respond (${name}). Restart xHandle or this browser and retry. Your saved data has not been cleared.`),{code:'STORAGE_OPEN_TIMEOUT'})),timeoutMs);
    try {
      request=version===undefined?indexedDB.open(name):indexedDB.open(name,version);
      request.onupgradeneeded=event=>{
        if(settled || existingOnly){absent=existingOnly;request.transaction.abort();return;}
        try{
          const tx=wrap(request.transaction);tx.done.catch(()=>{});
          upgrade?.(wrap(request.result),event.oldVersion,event.newVersion,tx);
        }catch(error){request.transaction.abort();finish(error);}
      };
      request.onblocked=()=>finish(Object.assign(new Error(`Storage upgrade is blocked (${name}). Close other xHandle tabs and retry.`),{code:'STORAGE_UPGRADE_BLOCKED'}));
      request.onerror=()=>finish(absent?null:request.error);
      request.onsuccess=()=>{
        const db=wrap(request.result);
        request.result.onversionchange=()=>db.close();
        finish(null,db);
      };
    }catch(error){finish(error);}
  });
}

export async function readTransferTransaction(db, store, operation, {signal, timeoutMs=15000}={}) {
  if(signal?.aborted)throw cancelled();
  const tx=db.transaction(store),done=tx.done;
  done.catch(()=>{});
  let timer,stop;
  try {
    const interrupted=new Promise((resolve,reject)=>{
      const fail=error=>{try{tx.abort();}catch{}reject(error);};
      stop=()=>fail(cancelled());
      signal?.addEventListener('abort',stop,{once:true});
      timer=setTimeout(()=>fail(new Error(`Reading saved project storage timed out (${db.name}/${store}). Restart xHandle or this browser and retry.`)),timeoutMs);
    });
    return await Promise.race([(async()=>{const result=await operation(tx.store);await done;return result;})(),interrupted]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}

export async function openTransferDatabase(name, {version, upgrade, existingOnly=false, signal, onProgress=()=>{}, timeoutMs=15000, attempts=3}={}) {
  for(let attempt=1;attempt<=attempts;attempt++){
    if(signal?.aborted)throw cancelled();
    onProgress(`Opening saved project storage (${name})${attempt>1?` — retry ${attempt} of ${attempts}`:''}…`);
    try{return await attemptOpen(name,{version,upgrade,existingOnly,signal,timeoutMs});}
    catch(error){
      // Retry only read-only connection establishment. Schema changes and
      // explicitly blocked upgrades require resolution, not repeated requests.
      if(signal?.aborted)throw cancelled();
      if(!existingOnly || !retryable(error) || attempt===attempts)throw error;
    }
  }
}
