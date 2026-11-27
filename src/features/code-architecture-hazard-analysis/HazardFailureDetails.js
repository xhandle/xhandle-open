import React,{useEffect,useState} from 'react';
import {PAGED_HAZARD} from './hazardRowIndex';
import requestHazardRows from './requestHazardRows';

// Failure narratives stay out of the lightweight descriptor. Read them only
// when requested, with the same revision checks as saved table rows.
export default function HazardFailureDetails({run,attempt=run,partial=false}) {
 const [opened,setOpened]=useState(false),[retry,setRetry]=useState(0),[loaded,setLoaded]=useState(null);
 const remote=Boolean(run?.[PAGED_HAZARD]) && !Array.isArray(attempt?.failedAssessments);
 const current=loaded?.run===run && loaded.partial===partial?loaded:null;
 useEffect(()=>{
  if(!opened || !remote)return;
  const controller=new AbortController();setLoaded(null);
  requestHazardRows(run,{operation:'detail',field:'failedAssessments',partial,signal:controller.signal}).then(({value})=>{
   if(!controller.signal.aborted)setLoaded({run,partial,rows:Array.isArray(value)?value:[]});
  }).catch(error=>{if(!controller.signal.aborted)setLoaded({run,partial,error:error.message});});
  return ()=>controller.abort();
 },[run,partial,opened,remote,retry]);
 const rows=remote?current?.rows:attempt?.failedAssessments;
 return <details onToggle={event=>setOpened(event.currentTarget.open)}><summary>Failure details</summary>
  <p>{attempt?.failureMessage}</p>
  {opened && <>
   {remote && !current && <p role="status">Loading unfinished assessment details…</p>}
   {current?.error && <p role="alert">Unable to load failure details: {current.error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry failure details</button></p>}
   {rows?.length>0 && <ul>{rows.map((item,index)=><li key={`${item.id}:${index}`}>{item.id} — {item.action} — {item.phrase}: {(item.reasons || []).join('; ') || 'No row-specific reason was recorded.'}</li>)}</ul>}
   {(!remote || current?.rows) && !rows?.length && <p>No row-specific failure reasons were saved. Continue hazard analysis to retry unfinished assessments.</p>}
  </>}
 </details>;
}
