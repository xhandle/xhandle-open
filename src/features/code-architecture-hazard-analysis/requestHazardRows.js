import createHazardRowsWorker from './createHazardRowsWorker';
export default function requestHazardRows(run,options={}){
 return new Promise((resolve,reject)=>{
  const {signal,onProgress,...request}=options;
  if(signal?.aborted){reject(new DOMException('Table read cancelled.','AbortError'));return;}
  const worker=createHazardRowsWorker();
  let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;worker.terminate();signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(result);};
  const abort=()=>finish(new DOMException('Table read cancelled.','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=event=>finish(new Error(event.message||'Unable to read saved rows.'));
  worker.onmessage=({data})=>{if(data.type==='progress')onProgress?.(data.progress);else finish(data.type==='error'?new Error(data.message):null,data.result);};
  try{worker.postMessage({run,options:request});}catch(error){finish(error);}
 });
}
