import {findPreparedHazardOptions,filterPreparedHazardLayout} from './hazardFilterOptions';
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
 const [layout,setLayout]=useState(null),[requestedRowIndices,setRequestedRowIndices]=useState(EMPTY),[requiredRowIndices,setRequiredRowIndices]=useState(EMPTY),[filters,setFilters]=useState({}),[search,setSearch]=useState(''),[options,setOptions]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const optionsAbort=useRef(),actionsAbort=useRef(),optionsSequence=useRef(0);
 const [optionsLoading,setOptionsLoading]=useState(false),[optionsError,setOptionsError]=useState(''),[optionsTruncated,setOptionsTruncated]=useState(false);
 const [optionsRequest,setOptionsRequest]=useState(null);
 const scope=JSON.stringify([run.projectId,run.repoId,run.id,descriptor.generation,descriptor.revision]);
 const optionsSourceKey=JSON.stringify([scope,partial]);
 useEffect(()=>()=>{optionsAbort.current?.abort();actionsAbort.current?.abort();},[scope]);
 const queryKey=JSON.stringify([scope,partial,filters,search,selectedOperationalContextId]);
 const baseKey=JSON.stringify([scope,partial,search,selectedOperationalContextId,attempt]);
 const [base,setBase]=useState(null);
 const baseLayout=base?.key===baseKey?base.layout:null;
 const localLayout=useMemo(()=>filterPreparedHazardLayout(baseLayout,filters),[baseLayout,filters]);
 const [resolvedQuery,setResolvedQuery]=useState(null),[resolvedBase,setResolvedBase]=useState(null);
 useEffect(()=>{
  actionsAbort.current?.abort();
  if(localLayout){setBusy(false);setError('');return;}
  const controller=new AbortController();setLayoutProgress(null);setError('');setBusy(true);setMessage('');
  // Keep the mounted table during a fallback query. A new source/search/context
  // is isolated by baseKey, so stale rows never appear in another source.
  const accept=(result,isBase)=>{
   if(controller.signal.aborted)return;
   if(isBase)setBase({key:baseKey,layout:result});
   if(!isBase || !Object.keys(filters).length){setLayout(result);setResolvedQuery(queryKey);setResolvedBase(baseKey);}
   setBusy(false);
  };
  const fail=err=>{if(!controller.signal.aborted){setError(err.message);setBusy(false);}};
  const savedLayout=props.preparationCache?.current;
  if(!baseLayout && !props.preparationCache?.retired && savedLayout?.kind==='continuous-hazard-layout' && savedLayout.queryKey===baseKey){
   requestHazardRows(run,{operation:'validate',signal:controller.signal}).then(()=>accept(savedLayout.layout,true)).catch(err=>{if(!controller.signal.aborted)props.preparationCache.current=null;fail(err);});
   return ()=>controller.abort();
  }
  const timer=setTimeout(()=>requestHazardRows(run,{operation:'layout',partial,filters:baseLayout?filters:{},search,context:selectedOperationalContextId,signal:controller.signal,onProgress:({completed,total})=>{if(!controller.signal.aborted)setLayoutProgress(total>0?Math.floor(completed*100/total):null);}}).then(result=>accept(result,!baseLayout)).catch(fail),baseLayout || search.trim()?180:0);
  return ()=>{clearTimeout(timer);controller.abort();};
 // Keys include immutable source, context and search identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[queryKey,baseKey,baseLayout,localLayout]);
 const activeLayout=localLayout || (resolvedBase===baseKey?layout:null);
 const filterPending=!localLayout && resolvedQuery!==queryKey;
 const displayQueryKey=localLayout?queryKey:resolvedQuery;
 const indices=activeLayout?.indices;
 useEffect(()=>{
  const cache=props.preparationCache;
  if(baseLayout && cache && !cache.retired && cacheableLayout(baseLayout))cache.current={kind:'continuous-hazard-layout',queryKey:baseKey,layout:baseLayout};
 },[baseLayout,baseKey,props.preparationCache]);
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
 const getPreparedOptions=useCallback((column,search)=>findPreparedHazardOptions(baseLayout?.optionIndex,column,search),[baseLayout]);
 const requestOptions=useCallback((column,optionSearch)=>{
  optionsAbort.current?.abort();const controller=new AbortController();optionsAbort.current=controller;const sequence=++optionsSequence.current;
  setOptionsRequest({column,search:optionSearch,sourceKey:optionsSourceKey});
  setOptionsError('');
  const prepared=getPreparedOptions(column,optionSearch);
  if(prepared){setOptions(prepared.options);setOptionsTruncated(prepared.truncated);setOptionsLoading(false);return;}
  setOptionsTruncated(false);setOptions([]);setOptionsLoading(true);
  const current=()=>sequence===optionsSequence.current&&!controller.signal.aborted;
  requestHazardRows(run,{operation:'options',partial,column,optionSearch,signal:controller.signal}).then(result=>{
   if(!current())return;setOptions(result.options);setOptionsTruncated(Boolean(result.truncated));
  }).catch(err=>{if(current())setOptionsError(err.message||'Unable to load filter values.');})
   .finally(()=>{if(sequence===optionsSequence.current)setOptionsLoading(false);});
 },[run,partial,optionsSourceKey,getPreparedOptions]);
 const cancelOptions=useCallback(()=>{++optionsSequence.current;optionsAbort.current?.abort();setOptionsLoading(false);},[]);
 const setFilter=useCallback((column,values)=>setFilters(old=>{const next={...old};if(values.length)next[column]=values;else delete next[column];return next;}),[]);
 const perform=async work=>{
  if(actionsAbort.current)throw Error('Another table operation is still running.');
  const controller=new AbortController();actionsAbort.current=controller;setMessage('Preparing matching saved rows…');setError('');
  try{return await work(controller.signal);}
  catch(err){if(!controller.signal.aborted)setError(err.message);throw err;}
  finally{if(actionsAbort.current===controller){actionsAbort.current=null;if(!controller.signal.aborted)setMessage('');}}
 };
 const visit=async(callback,signal)=>{
  if(filterPending || !activeLayout)throw Error('Wait for the current filter to finish.');
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
   {activeLayout && <span>{activeLayout.total.toLocaleString()} of {(partial?descriptor.partialCount:descriptor.total).toLocaleString()} rows match filters</span>}
  </div>
  {activeLayout && filterPending && busy && <div role="status">Updating filters…</div>}
  {message && <div role="status">{message}</div>}
  {(error || rowCache.error) && <div role="alert">{error || rowCache.error?.message || String(rowCache.error)} <button onClick={()=>{if(props.preparationCache)props.preparationCache.current=null;props.restoration?.retry();if(error)setAttempt(n=>n+1);else rowCache.retry();}}>Retry rows</button></div>}
  {descriptor.pending && <div><p>An incomplete attempt is saved ({descriptor.partialCount} rows). Continue analysis retries unresolved work.</p>{descriptor.partialMetadata?.failureMessage && <details><summary>Failure details</summary><p>{descriptor.partialMetadata.failureMessage}</p></details>}<button onClick={()=>{setPartial(value=>!value);setFilters({});setSearch('');}}>{partial?'View published results':'Inspect validated partial results'}</button></div>}
  {partial && <p>Viewing the incomplete attempt. Export CSV includes its matching rows. Published results remain unchanged.</p>}
 </div>;
 const loadState={status:activeLayout?'ready':error?'failed':'preparing',progress:layoutProgress};
 const tablePage={...page,continuous:true,queryKey:displayQueryKey,layout:activeLayout,loadState,rowError:rowCache.error,rowsByIndex:rowCache.rowsByIndex,requestRows,cacheStats:rowCache.cacheStats,loading:busy||rowCache.loading,partial,hasCsvUndo:!partial && descriptor.details?.includes('csvImportPreviousSummary'),loadUndo:()=>perform(async signal=>(await requestHazardRows(run,{operation:'detail',field:'csvImportPreviousSummary',signal})).value),filters,options,optionsLoading,optionsError,optionsTruncated,optionsRequest,optionsSourceKey,getPreparedOptions,setFilter,requestOptions,cancelOptions,clearFilters:()=>{setFilters({});setSearch('');},copy,exportCsv,loadSummary,controls,unfilteredTotal:partial?descriptor.partialCount:descriptor.total};
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
  onDeleteSummaryRow={filterPending||busy||partial?undefined:async index=>{try{await props.onDeleteSummaryRow?.(index);}catch(err){setError(err.message);}}} />;
}
