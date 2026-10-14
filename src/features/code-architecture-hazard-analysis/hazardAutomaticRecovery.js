// Recovery stays inside the current run: completed rows and unsaved work remain
// in memory. Never re-click the UI or restart the whole analysis.
export function isTransientHazardFailure(error) {
  const status=Number(error?.status || error?.response?.status || error?.message?.match(/LLM proxy error \((\d+)\)/)?.[1]);
  // The transport already honors Retry-After and retries 429 five times.
  if(status)return [408,500,502,503,504,529].includes(status);
  return ['TimeoutError','NetworkError'].includes(error?.name) ||
    (error?.name==='TypeError' && /failed to fetch|fetch failed|load failed|network/i.test(error.message));
}
function waitForRecovery(ms,signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Hazard analysis cancelled.','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}
export function createHazardAutomaticRecovery({signal,onRetry=()=>{},wait=waitForRecovery}={}) {
  let used=0;
  const delays=[2000,5000,10000],runLimit=6;
  return async(operation,details)=>{
    for(let attempt=0;;attempt++){
      if(signal?.aborted)throw new DOMException('Hazard analysis cancelled.','AbortError');
      try{return await operation();}
      catch(error){
        if(signal?.aborted || !isTransientHazardFailure(error))throw error;
        if(attempt>=delays.length || used>=runLimit){
          const exhausted=new Error(`Automatic recovery limit reached. Completed work is retained; use Continue/Retry to resume. ${error.message}`);
          exhausted.name=error.name;exhausted.cause=error;exhausted.code='HAZARD_RECOVERY_EXHAUSTED';throw exhausted;
        }
        used++;
        onRetry({...details,attempt:attempt+1,maxAttempts:delays.length,delayMs:delays[attempt],runRetries:used});
        await wait(delays[attempt],signal);
      }
    }
  };
}
