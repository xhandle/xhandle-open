import {createHazardReviewRowIndex} from './hazardReviewRowIndex';
import {createHazardRowNormalizer} from '../project-hazard-analysis/classificationResolutionStatus';
import {fillNotApplicableHazardCells} from '../project-hazard-analysis/hazardNotApplicableCells';
import React,{useState,useEffect,useCallback,useRef,useMemo} from 'react';
import {PreparedCodeArchitectureHazardPanel} from './CodeArchitectureHazardPanel';
import {PAGED_HAZARD} from './hazardRowIndex';
import requestHazardRows from './requestHazardRows';
import useContinuousHazardRows from './useContinuousHazardRows';
import {createDiskArchiveSink} from '../code-architecture-transfer/diskArchiveSink';
import {effectiveCodeArchitectureHazardRows,isCodeArchitectureHazardAnalysisStale} from './codeArchitectureHazardUtils';
import {summarizeCodeArchitectureHazardEligibility} from './codeArchitectureHazardEligibility';
import {functionalModelIsReady,buildFunctionalModelRows} from '../code-architecture-context/functionalModel';
const EMPTY=[];
// Reuse only lightweight ordering metadata for this workspace's current run.
// The existing workspace owner retires this one cache on project/input changes.
function cacheableLayout(layout){
 if(Number.isFinite(layout.metadataBytes))return layout.metadataBytes<=8*1024*1024;
 let bytes=(layout.indices?.length || 0)*16+1024;
 for(const header of layout.headers || [])bytes+=String(header).length*2+32;
 for(const group of layout.groups || []){
  bytes+=256+String(group.key).length*2+String(group.label).length*2+group.rowIndices.length*16;
  if(bytes>8*1024*1024)return false;
 }
 return bytes<=8*1024*1024;
}
export default function PagedHazardPanel(props){
 const {latestRun:run,cbaRows=EMPTY,selectedOperationalContextId='all'}=props,descriptor=run[PAGED_HAZARD];
 const [partial,setPartial]=useState(false);
 const [layoutProgress,setLayoutProgress]=useState(null);
 const [layout,setLayout]=useState(null),[requestedRowIndices,setRequestedRowIndices]=useState(EMPTY),[requiredRowIndices,setRequiredRowIndices]=useState(EMPTY),[filters,setFilters]=useState({}),[search,setSearch]=useState(''),[indices,setIndices]=useState(null),[options,setOptions]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const optionsAbort=useRef(),actionsAbort=useRef(),optionsSequence=useRef(0);
 const scope=JSON.stringify([run.projectId,run.repoId,run.id,descriptor.generation,descriptor.revision]);
 useEffect(()=>()=>{optionsAbort.current?.abort();actionsAbort.current?.abort();},[scope]);
 const filtered=Boolean(search.trim()||Object.keys(filters).length||selectedOperationalContextId!=='all');
 const queryKey=JSON.stringify([scope,partial,filters,search,selectedOperationalContextId]);
 const [resolvedQuery,setResolvedQuery]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();setIndices(null);setLayout(null);setLayoutProgress(null);setRequestedRowIndices(EMPTY);setRequiredRowIndices(EMPTY);setResolvedQuery(null);setError('');
  optionsAbort.current?.abort();actionsAbort.current?.abort();
  const savedLayout=props.preparationCache?.current;
  if(!props.preparationCache?.retired && savedLayout?.kind==='continuous-hazard-layout' && savedLayout.queryKey===queryKey){
   setLayout(savedLayout.layout);setIndices(filtered?savedLayout.layout.indices:null);setResolvedQuery(queryKey);setBusy(false);setMessage('');
   return ()=>controller.abort();
  }
  if(props.preparationCache)props.preparationCache.current=null;
  setBusy(true);setMessage('');
  const timer=setTimeout(()=>requestHazardRows(run,{operation:'layout',partial,filters,search,context:selectedOperationalContextId,signal:controller.signal,onProgress:({completed,total})=>{if(!controller.signal.aborted)setLayoutProgress(total>0?Math.floor(completed*100/total):null);}}).then(result=>{
   if(controller.signal.aborted)return;
   setLayout(result);setIndices(filtered?result.indices:null);setResolvedQuery(queryKey);setMessage('');setBusy(false);
  }).catch(err=>{if(!controller.signal.aborted){setError(err.message);setBusy(false);}}),filtered?180:0);
  return ()=>{clearTimeout(timer);controller.abort();};
 // queryKey includes immutable filter and source identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[queryKey,attempt]);
 const activeLayout=resolvedQuery===queryKey?layout:null;
 useEffect(()=>{
  const cache=props.preparationCache;
  if(activeLayout && cache && !cache.retired && cacheableLayout(activeLayout))cache.current={kind:'continuous-hazard-layout',queryKey,layout:activeLayout};
 },[activeLayout,queryKey,props.preparationCache]);
 const rowCache=useContinuousHazardRows({run,partial,queryKey,layout:activeLayout,requestedRowIndices,requiredRowIndices});
 const requestRows=useCallback((indices,required=EMPTY)=>{
  setRequestedRowIndices(previous=>previous.length===indices.length && previous.every((value,index)=>value===indices[index])?previous:indices);
  setRequiredRowIndices(previous=>previous.length===required.length && previous.every((value,index)=>value===required[index])?previous:required);
 },[]);
 const page=useMemo(()=>{
  if(!activeLayout)return null;
  const rowIndices=[...rowCache.rowsByIndex.keys()].sort((a,b)=>a-b);
  return {headers:activeLayout.headers,rows:rowIndices.map(index=>rowCache.rowsByIndex.get(index)),rowIndices,total:activeLayout.total};
 },[activeLayout,rowCache.rowsByIndex]);
 useEffect(()=>{
  if(props.highlightedRowIndex==null)return;
  setPartial(false);setFilters({});setSearch('');
  if(selectedOperationalContextId!=='all')props.onSelectedOperationalContextChange?.('all');
 // Explicit row focus clears restrictions; the virtual viewport reveals the source row.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[props.highlightedRowIndex,props.forceSummaryOpenKey]);
 const requestOptions=useCallback((column,optionSearch)=>{
  optionsAbort.current?.abort();const controller=new AbortController();optionsAbort.current=controller;const sequence=++optionsSequence.current;setOptions([]);
  requestHazardRows(run,{operation:'options',partial,column,optionSearch,signal:controller.signal}).then(result=>{if(sequence!==optionsSequence.current||controller.signal.aborted)return;setOptions(result.options);if(result.truncated)setMessage('Some filter values are too long or numerous to list. Use Search all saved rows to find them.');}).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
 },[run,partial]);
 const setFilter=useCallback((column,values)=>setFilters(old=>{const next={...old};if(values.length)next[column]=values;else delete next[column];return next;}),[]);
 const perform=async work=>{
  if(actionsAbort.current)throw Error('Another table operation is still running.');
  const controller=new AbortController();actionsAbort.current=controller;setMessage('Preparing matching saved rows…');setError('');
  try{return await work(controller.signal);}
  catch(err){if(!controller.signal.aborted)setError(err.message);throw err;}
  finally{if(actionsAbort.current===controller){actionsAbort.current=null;if(!controller.signal.aborted)setMessage('');}}
 };
 const visit=async(callback,signal)=>{
  if(resolvedQuery!==queryKey)throw Error('Wait for the current filter to finish.');
  let position=0;
  do{const result=await requestHazardRows(run,{partial,offset:position,indices,signal});await callback(result);position=result.nextOffset;if(position>=result.total)break;}while(true);
 };
 const exportCsv=()=>perform(async signal=>{
  const sink=await createDiskArchiveSink(`${run.repoName||'analysis'}-${partial?'partial-':''}hazards.csv`,{signal});let first=true;
  const encode=row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')+'\r\n';
  try{
   await visit(async result=>{if(first){await sink.write('\uFEFF'+encode(result.headers));first=false;}for(const row of result.rows)await sink.write(encode(row));},signal);
   const file=await sink.finish();const anchor=document.createElement('a');anchor.href=file.url;anchor.download=file.name;document.body.appendChild(anchor);anchor.click();anchor.remove();
  }catch(err){await sink.abort().catch(()=>{});throw err;}
 }).catch(()=>{});
 const copy=columns=>perform(async signal=>{
  let text='';await visit(async result=>{if(!text)text=columns.map(i=>result.headers[i]).join('\t')+'\n';for(const row of result.rows){text+=columns.map(i=>String(row[i]??'')).join('\t')+'\n';if(text.length*2>8*1024*1024)throw Error('These rows exceed the safe clipboard size. Use Export CSV for all matching rows.');}},signal);await navigator.clipboard.writeText(text);
 }).catch(()=>{});
 const loadSummary=()=>perform(async signal=>{
  // CSV validation requires the complete current Summary, never the filtered page.
  const sheet=[];let position=0,bytes=0;
  do{const result=await requestHazardRows(run,{offset:position,signal});if(!sheet.length)sheet.push(result.headers);for(const row of result.rows){bytes+=JSON.stringify(row).length*2;if(bytes>32*1024*1024)throw Error('This CSV edit exceeds the safe in-memory editing size. Existing results were not changed.');sheet.push(row);}position=result.nextOffset;if(position>=result.total)break;}while(true);
  return sheet;
 });
 const eligibilitySummary=useMemo(()=>summarizeCodeArchitectureHazardEligibility(effectiveCodeArchitectureHazardRows(cbaRows)),[cbaRows]);
 const controls=<div className="shrink-0 space-y-2 border-b p-3 text-sm">
  <div className="flex flex-wrap items-center gap-2">
   <input aria-label="Search all saved hazard rows" placeholder="Search all saved rows" value={search} onChange={event=>setSearch(event.target.value)} className="rounded border px-2 py-1" />
   {activeLayout && <span>{activeLayout.total.toLocaleString()} matching rows</span>}
  </div>
  {message && <div role="status">{message}</div>}
  {(error || rowCache.error) && <div role="alert">{error || rowCache.error?.message || String(rowCache.error)} <button onClick={()=>{if(props.preparationCache)props.preparationCache.current=null;props.restoration?.retry();if(error)setAttempt(n=>n+1);else rowCache.retry();}}>Retry rows</button></div>}
  {descriptor.pending && <div><p>An incomplete attempt is saved ({descriptor.partialCount} rows). Continue analysis retries unresolved work.</p>{descriptor.partialMetadata?.failureMessage && <details><summary>Failure details</summary><p>{descriptor.partialMetadata.failureMessage}</p></details>}<button onClick={()=>{setPartial(value=>!value);setFilters({});setSearch('');}}>{partial?'View published results':'Inspect validated partial results'}</button></div>}
  {partial && <p>Viewing the incomplete attempt. Export CSV includes its matching rows. Published results remain unchanged.</p>}
 </div>;
 const loadState={status:activeLayout?'ready':error?'failed':'preparing',progress:layoutProgress};
 const tablePage={...page,continuous:true,queryKey,layout:activeLayout,loadState,rowError:rowCache.error,rowsByIndex:rowCache.rowsByIndex,requestRows,cacheStats:rowCache.cacheStats,loading:busy||rowCache.loading,partial,hasCsvUndo:!partial && descriptor.details?.includes('csvImportPreviousSummary'),loadUndo:()=>perform(async signal=>(await requestHazardRows(run,{operation:'detail',field:'csvImportPreviousSummary',signal})).value),filters,options,setFilter,requestOptions,clearFilters:()=>{setFilters({});setSearch('');},copy,exportCsv,loadSummary,controls,unfilteredTotal:partial?descriptor.partialCount:descriptor.total};
 // A viewport fill is not a new editable summary revision (e.g. during CSV validation).
 const summarySheet=useMemo(()=>[activeLayout?.headers || descriptor.headers], [activeLayout?.headers,descriptor.headers]);
 const functionalReady=useMemo(()=>functionalModelIsReady(cbaRows),[cbaRows]);
 const functionalTraceIds=useMemo(()=>functionalReady?new Set(buildFunctionalModelRows(cbaRows).map(row=>row.traceId)):new Set(),[cbaRows,functionalReady]);
 const isStale=useMemo(()=>Boolean(descriptor.omittedMetadata?.length)||isCodeArchitectureHazardAnalysisStale({run,cbaRows,operationalContexts:props.operationalContexts,selectedOperationalContextId,organizationContext:props.organizationContext}),[run,cbaRows,props.operationalContexts,selectedOperationalContextId,props.organizationContext,descriptor.omittedMetadata]);

 // Normalize/index review content once per review revision. Scroll/cache fills
 // only compare the bounded loaded rows, not every historical review narrative.
 const reviewLookup=useMemo(()=>{
  if(partial || !props.reviewItems?.length)return null;
  const normalizer=createHazardRowNormalizer(descriptor.headers),entries=[];
  props.reviewItems.forEach((item,position)=>{
   const row=item.currentContent?.row || item.originalContent?.row;
   if(!Array.isArray(row))return;
   entries.push({item,position,time:Date.parse(item.updatedAt||item.createdAt)||0,row:fillNotApplicableHazardCells(normalizer.headers,normalizer.normalizeRow(row,item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? 0))});
  });
  entries.sort((a,b)=>b.time-a.time || b.position-a.position);
  return {entries,index:createHazardReviewRowIndex(entries.map(entry=>entry.row),normalizer.headers)};
 },[partial,descriptor.headers,props.reviewItems]);
 const pageReviews=useMemo(()=>{
  const result=new Map(),used=new Set();if(!page || !reviewLookup)return result;
  page.rows.forEach((row,local)=>{
   const match=reviewLookup.index.find(row);
   if(match<0 || used.has(match))return;
   used.add(match);result.set(page.rowIndices[local],reviewLookup.entries[match].item);
  });
  return result;
 },[page,reviewLookup]);
 const preparedView={summarySheet,eligibilitySummary,functionalReady,functionalTraceIds,isStale};
 return <PreparedCodeArchitectureHazardPanel {...props} tablePage={tablePage} preparedView={preparedView}
  reviewMode={partial || props.reviewMode}
  reviewItems={partial?EMPTY:props.reviewItems} reviewByRow={pageReviews}
  onNarrativeReviewUpdate={partial?undefined:props.onNarrativeReviewUpdate}
  onCollaboratorSelectionChange={partial?undefined:props.onCollaboratorSelectionChange}
  onImportSummary={partial?undefined:props.onImportSummary}
  onDeleteSummaryRow={busy||partial?undefined:async index=>{try{await props.onDeleteSummaryRow?.(index);}catch(err){setError(err.message);}}} />;
}
