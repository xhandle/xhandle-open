import {createHazardReviewRowIndex} from './hazardReviewRowIndex';
import {createHazardRowNormalizer} from '../project-hazard-analysis/classificationResolutionStatus';
import {fillNotApplicableHazardCells} from '../project-hazard-analysis/hazardNotApplicableCells';
import React,{useState,useEffect,useCallback,useRef,useMemo} from 'react';
import {PreparedCodeArchitectureHazardPanel} from './CodeArchitectureHazardPanel';
import {PAGED_HAZARD} from './hazardRowIndex';
import requestHazardRows from './requestHazardRows';
import {createDiskArchiveSink} from '../code-architecture-transfer/diskArchiveSink';
import {effectiveCodeArchitectureHazardRows,isCodeArchitectureHazardAnalysisStale} from './codeArchitectureHazardUtils';
import {summarizeCodeArchitectureHazardEligibility} from './codeArchitectureHazardEligibility';
import {functionalModelIsReady,buildFunctionalModelRows} from '../code-architecture-context/functionalModel';
const EMPTY=[];
export default function PagedHazardPanel(props){
 const {latestRun:run,cbaRows=EMPTY,selectedOperationalContextId='all'}=props,descriptor=run[PAGED_HAZARD];
 const [partial,setPartial]=useState(false);
 const [page,setPage]=useState(null),[offset,setOffset]=useState(0),[back,setBack]=useState([]),[filters,setFilters]=useState({}),[search,setSearch]=useState(''),[indices,setIndices]=useState(null),[options,setOptions]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const pendingFocus=useRef(null);
 const optionsAbort=useRef(),actionsAbort=useRef(),optionsSequence=useRef(0);
 const scope=`${run.id}:${descriptor.revision}`;
 useEffect(()=>()=>{optionsAbort.current?.abort();actionsAbort.current?.abort();},[scope]);
 const filtered=Boolean(search.trim()||Object.keys(filters).length||selectedOperationalContextId!=='all');
 const queryKey=JSON.stringify([scope,partial,filters,search,selectedOperationalContextId]);
 const [resolvedQuery,setResolvedQuery]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();setOffset(pendingFocus.current ?? 0);pendingFocus.current=null;setBack([]);setIndices(null);setPage(null);setResolvedQuery(null);setError('');
  if(!filtered){setResolvedQuery(queryKey);return ()=>controller.abort();}
  setBusy(true);setMessage('Searching all saved rows…');
  const timer=setTimeout(()=>requestHazardRows(run,{operation:'query',partial,filters,search,context:selectedOperationalContextId,signal:controller.signal,onProgress:({completed,total})=>setMessage(`Searching all saved rows… ${Math.floor(completed*100/total)}%`)}).then(result=>{
   if(controller.signal.aborted)return;setIndices(result.indices);setResolvedQuery(queryKey);
  }).catch(err=>{if(!controller.signal.aborted){setError(err.message);setBusy(false);}}),180);
  return ()=>{clearTimeout(timer);controller.abort();};
 // queryKey includes immutable filter and source identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[queryKey,attempt]);
 useEffect(()=>{
  if(resolvedQuery!==queryKey)return;
  const controller=new AbortController();setBusy(true);setError('');setMessage('Loading saved rows…');
  requestHazardRows(run,{partial,offset,indices,signal:controller.signal}).then(result=>{
   if(controller.signal.aborted)return;setPage(result);setMessage('');setBusy(false);
  }).catch(err=>{if(!controller.signal.aborted){setError(err.message);setBusy(false);}});
  return ()=>controller.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[resolvedQuery,queryKey,offset,indices,attempt]);
 useEffect(()=>{
  if(props.highlightedRowIndex==null)return;
  pendingFocus.current=(filtered || partial)?props.highlightedRowIndex:null;
  setPartial(false);setFilters({});setSearch('');setBack([]);setOffset(props.highlightedRowIndex);
  if(selectedOperationalContextId!=='all')props.onSelectedOperationalContextChange?.('all');
 // Only explicit row-focus requests move the page.
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
   <button disabled={busy||!back.length} onClick={()=>{setOffset(back[back.length-1]);setBack(old=>old.slice(0,-1));}}>Previous rows</button>
   <span>{page ? `${page.total?offset+1:0}–${page.nextOffset} of ${page.total} matching rows`:'Loading saved rows…'}</span>
   <button disabled={busy||!page||page.nextOffset>=page.total} onClick={()=>{setBack(old=>[...old,offset]);setOffset(page.nextOffset);}}>Next rows</button>
  </div>
  {message && <div role="status">{message}</div>}
  {error && <div role="alert">{error} <button onClick={()=>{props.restoration?.retry();setAttempt(n=>n+1);}}>Retry rows</button></div>}
  {descriptor.pending && <div><p>An incomplete attempt is saved ({descriptor.partialCount} rows). Continue analysis retries unresolved work.</p>{descriptor.partialMetadata?.failureMessage && <details><summary>Failure details</summary><p>{descriptor.partialMetadata.failureMessage}</p></details>}<button onClick={()=>{setPartial(value=>!value);setFilters({});setSearch('');}}>{partial?'View published results':'Inspect validated partial results'}</button></div>}
  {partial && <p>Viewing the incomplete attempt. Export CSV includes its matching rows. Published results remain unchanged.</p>}
 </div>;
 const tablePage={...page,partial,hasCsvUndo:!partial && descriptor.details?.includes('csvImportPreviousSummary'),loadUndo:()=>perform(async signal=>(await requestHazardRows(run,{operation:'detail',field:'csvImportPreviousSummary',signal})).value),filters,options,setFilter,requestOptions,clearFilters:()=>{setFilters({});setSearch('');},copy,exportCsv,loadSummary,controls,unfilteredTotal:partial?descriptor.partialCount:descriptor.total};
 const summarySheet=useMemo(()=>page?[page.headers,...page.rows]:[descriptor.headers], [page,descriptor.headers]);
 const functionalReady=useMemo(()=>functionalModelIsReady(cbaRows),[cbaRows]);
 const functionalTraceIds=useMemo(()=>functionalReady?new Set(buildFunctionalModelRows(cbaRows).map(row=>row.traceId)):new Set(),[cbaRows,functionalReady]);
 const isStale=useMemo(()=>Boolean(descriptor.omittedMetadata?.length)||isCodeArchitectureHazardAnalysisStale({run,cbaRows,operationalContexts:props.operationalContexts,selectedOperationalContextId,organizationContext:props.organizationContext}),[run,cbaRows,props.operationalContexts,selectedOperationalContextId,props.organizationContext,descriptor.omittedMetadata]);

 const pageReviews=useMemo(()=>{
  const result=new Map();if(partial||!page)return result;
  const index=createHazardReviewRowIndex(page.rows,page.headers);
  const normalizer=createHazardRowNormalizer(descriptor.headers);
  for(const item of props.reviewItems || []){
   const row=item.currentContent?.row || item.originalContent?.row;
   if(!Array.isArray(row))continue;
   const local=index.find(fillNotApplicableHazardCells(normalizer.headers,normalizer.normalizeRow(row,item.currentContent?.rowIndex ?? item.originalContent?.rowIndex ?? 0)));
   if(local<0)continue;
   const absolute=page.rowIndices[local],previous=result.get(absolute);
   if(!previous || (Date.parse(item.updatedAt||item.createdAt)||0)>=(Date.parse(previous.updatedAt||previous.createdAt)||0))result.set(absolute,item);
  }
  return result;
 },[partial,page,descriptor.headers,props.reviewItems]);
 const preparedView={summarySheet,eligibilitySummary,functionalReady,functionalTraceIds,isStale};
 return <PreparedCodeArchitectureHazardPanel {...props} tablePage={tablePage} preparedView={preparedView}
  reviewMode={partial || props.reviewMode}
  reviewItems={partial?EMPTY:props.reviewItems} reviewByRow={pageReviews}
  onNarrativeReviewUpdate={partial?undefined:props.onNarrativeReviewUpdate}
  onCollaboratorSelectionChange={partial?undefined:props.onCollaboratorSelectionChange}
  onImportSummary={partial?undefined:props.onImportSummary}
  onDeleteSummaryRow={busy||partial?undefined:async index=>{try{await props.onDeleteSummaryRow?.(index);}catch(err){setError(err.message);}}} />;
}
