// Stop waiting, not writing. The store's per-record queue remains the only
// writer, so a late initial manifest cannot overtake final results.
export function waitForHazardSave(operation, {signal, timeoutMs=1500}={}) {
  return new Promise((resolve,reject)=>{
    let timer;
    const finish=(callback,value)=>{
      clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      callback(value);
    };
    const abort=()=>finish(reject,new DOMException('Hazard analysis cancelled.','AbortError'));
    Promise.resolve(operation).then(value=>finish(resolve,value),error=>finish(reject,error));
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(reject,new Error('Saving is still pending. Keep this browser tab open or export the results.')),timeoutMs);
  });
}
