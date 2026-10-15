// Cancellation settles the owner immediately even if a browser/provider/storage
// promise does not honor AbortSignal. Observe late outcomes to avoid unhandled
// rejections; the underlying work must still use the same signal for cleanup.
export function abortableHazardTask(work,signal) {
 return new Promise((resolve,reject)=>{
  const abort=()=>{cleanup();reject(new DOMException('Hazard analysis cancelled.','AbortError'));};
  const cleanup=()=>signal?.removeEventListener('abort',abort);
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{
   if(signal?.aborted)throw new DOMException('Hazard analysis cancelled.','AbortError');
   return work();
  }).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
 });
}
