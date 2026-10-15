import {useEffect,useRef,useState} from 'react';
import createWorker from './createHazardDraftWorker';

// Retain only the current input revision across tab switches. A stale worker can
// never publish into another project, method, or context.
export default function useHazardDraft(enabled,input){
 const cache=useRef(null);
 const [state,setState]=useState(null),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(cache.current?.input!==input)cache.current=null;
  if(!enabled || cache.current)return undefined;
  let worker,closed=false;
  setState({input,status:'loading',progress:0});
  try{
   worker=createWorker();
   worker.onmessage=({data})=>{
    if(closed)return;
    if(data.type==='progress'){
     if(Number.isFinite(data.progress))setState(previous=>({input,status:'loading',progress:Math.max(previous?.input===input?previous.progress||0:0,Math.min(99,Math.max(0,data.progress)))}));
     return;
    }
    if(data.error)setState({input,status:'error',error:data.error});
    else{cache.current={input,run:data.run};setState({input,status:'ready',run:data.run});}
    worker.terminate();
   };
   worker.onerror=event=>{if(!closed){setState({input,status:'error',error:event.message || 'Unable to prepare hazard table.'});worker.terminate();}};
   worker.postMessage(input);
  }catch(error){worker?.terminate();setState({input,status:'error',error:error.message});}
  return ()=>{closed=true;worker?.terminate();};
 },[enabled,input,attempt]);
 const result=cache.current?.input===input?cache.current:state?.input===input?state:null;
 return {progress:result?.run?100:result?.progress||0,run:enabled?result?.run || null:null,loading:enabled&&!result?.run&&result?.status!=='error',error:enabled?result?.error:null,retry:()=>setAttempt(n=>n+1)};
}
