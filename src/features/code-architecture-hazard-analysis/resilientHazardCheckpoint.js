export async function boundedHazardStorage(promise,timeoutMs=1500) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Browser storage did not respond in time')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

// Writes are serialized outside generation. A failed backend never owns the
// only copy of new work, and cannot stop other assessments from completing.
export function resilientHazardCheckpoint(backend,{signal,onStorageState=()=>{}}={}) {
  const values=new Map(),dirty=new Map();let draining=null,failed=false;
  const id=basis=>JSON.stringify(basis);
  const bounded=boundedHazardStorage;
  const notify=error=>{failed=true;onStorageState({unsaved:true,message:error?.message || 'Checkpoint storage unavailable'});};
  async function drain(){
    while(dirty.size && !signal?.aborted){
      const batch=[...dirty.entries()].slice(0,48);
      try{
        if(!backend)throw new Error('Checkpoint storage unavailable');
        if(backend.writeMany)await bounded(backend.writeMany(batch.map(([,entry])=>entry)));
        else for(const [,entry] of batch)await bounded(backend.write(entry.basis,entry.value));
        batch.forEach(([key,entry])=>{if(dirty.get(key)===entry)dirty.delete(key);});
      }catch(error){if(!signal?.aborted)notify(error);return;}
    }
  }
  function start(){if(!draining && !failed && dirty.size){draining=drain().finally(()=>{draining=null;if(dirty.size && !failed && !signal?.aborted)start();});}return draining;}
  return {
    async readMany(bases){
      let saved=[];
      try{saved=backend?.readMany?await bounded(backend.readMany(bases)):await bounded(Promise.all(bases.map(b=>backend?.read(b))));}
      catch(error){if(signal?.aborted)throw error;notify(error);}
      return bases.map((b,i)=>values.has(id(b))?values.get(id(b)):saved[i]);
    },
    async read(basis){return (await this.readMany([basis]))[0];},
    async writeMany(entries){for(const entry of entries){const key=id(entry.basis);values.set(key,entry.value);dirty.set(key,entry);}start();},
    async write(basis,value){return this.writeMany([{basis,value}]);},
    async flush(){
      failed=false;const pending=draining || start();
      if(pending){let timer;await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);clearTimeout(timer);}
      return {unsaved:dirty.size>0,pending:dirty.size};
    },
  };
}
