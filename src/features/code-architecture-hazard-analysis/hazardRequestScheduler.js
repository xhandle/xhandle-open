// Shared provider budget, with alternating FIFO generation/review queues.
// Pipeline workers may prepare/wait for review without occupying a request slot.
export function createHazardRequestScheduler({limit=3,signal,check=()=>{}}={}) {
  const queues={generation:[],review:[]};
  let active=0,next='generation',closed=false;
  const abortError=()=>new DOMException('Hazard analysis cancelled.','AbortError');
  const rejectQueued=error=>Object.values(queues).forEach(queue=>{while(queue.length)queue.shift().reject(error);});
  const onAbort=()=>rejectQueued(abortError());
  signal?.addEventListener('abort',onAbort,{once:true});
  const settled=()=>{active--;drain();};
  function drain(){
    while(active<limit){
      const kind=queues[next].length?next:next==='generation'?'review':'generation';
      const job=queues[kind].shift();if(!job)return;
      next=kind==='generation'?'review':'generation';
      try{if(signal?.aborted)throw abortError();check();}catch(error){job.reject(error);rejectQueued(error);return;}
      active++;
      Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(settled);
    }
  }
  return {
    run(kind,work){
      return new Promise((resolve,reject)=>{
        if(closed || signal?.aborted){reject(abortError());return;}
        queues[kind].push({work,resolve,reject});drain();
      });
    },
    close(){closed=true;signal?.removeEventListener('abort',onAbort);rejectQueued(abortError());},
  };
}
