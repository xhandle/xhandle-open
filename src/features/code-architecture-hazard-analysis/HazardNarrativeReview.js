import React,{useState,useEffect,useRef} from 'react';
import {reviewFastHazards} from './fastHazardSemanticReview';
import {fastMethod} from './fastHazardSchema';

export function unpackHazardReview(packed){
  return packed.assessments.filter(entry=>entry.assessment.applicable==='Yes').map(({source,assessment})=>{
    const definition=packed.interfaces[source.interfaceRef];
    return {source:{...definition,...source,context:packed.contexts[definition.contextRef],evidence:packed.evidence[definition.evidenceRef]},assessment};
  });
}
// Explicit, read-only review of the published snapshot. Never regenerates rows.
export default function HazardNarrativeReview({run,onUpdate,disabled=false}){
 const [review,setReview]=useState(run?.narrativeReview),[running,setRunning]=useState(false),[message,setMessage]=useState('');
 const controller=useRef();
 useEffect(()=>()=>controller.current?.abort(),[]);
 if(!run?.narrativeReviewInput || run.runState!=='complete')return null;
 const start=async()=>{
   const abort=new AbortController();controller.current=abort;setRunning(true);setMessage('Reviewing published results…');
   try{
    const findings=await reviewFastHazards({method:fastMethod(run.hazardMethod),entries:unpackHazardReview(run.narrativeReviewInput),context:run.narrativeReviewContext,signal:abort.signal,onProgress:setMessage});
    if(abort.signal.aborted)return;
    const result={completedAt:new Date().toISOString(),findings};setReview(result);setMessage('Narrative review finished. Results were not changed.');
    await onUpdate?.(run,result);
   }catch(error){if(!abort.signal.aborted)setMessage(`Review could not finish: ${error.message}. Generated results are unchanged.`);}
   finally{if(controller.current===abort){setRunning(false);controller.current=null;}}
 };
 return <details className="m-3 text-sm"><summary>Deeper narrative review</summary>
   <p>Review the generated draft for reasoning inconsistencies. This does not change the table or its applicability decisions.</p>
   <button type="button" disabled={disabled || running} onClick={start}>{review?'Review narratives again':'Review narratives'}</button>
   {running && <button type="button" onClick={()=>{controller.current?.abort();setMessage('Review stopped. Generated results are unchanged.');}}>Stop review</button>}
   {message && <p role="status">{message}</p>}
   {review && <ul>{Object.entries(review.findings).map(([id,issues])=><li key={id}>{id}: {Array.isArray(issues)?issues.length?issues.join(' '):'No specific contradiction found.':issues.reason || 'Review unavailable.'}</li>)}</ul>}
 </details>;
}
