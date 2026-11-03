import {openDB} from 'idb';
import shajs from 'sha.js';
import {streamCsv} from '../../lib/streamCsv';
import {csvCellText,csvHeaderKey} from '../../lib/csv';
import {streamValue,createValueAssembler} from '../code-architecture-transfer/archiveValueStream';
import {planHazardAnalysisCsvRows,applyHazardAnalysisCsvImport} from '../project-hazard-analysis/hazardAnalysisCsv';
import {recordUserPreprocessing} from '../project-hazard-analysis/hazardUserPreprocessing';
import {openHazardSchema,hazardMetadata,HAZARD_STAGING,newHazardStorageRevision} from './hazardSchema';
import {stageHazardRun,publishHazardRun,removeHazardGeneration,isChunkedHazardRun} from './hazardRunChunks';
import {validateHazardRowIndex,PAGED_HAZARD} from './hazardRowIndex';
import {prepareHazardTableIndex} from './prepareHazardTableIndex';
import {summarySheetToHazardSummaryRows} from './codeArchitectureHazardUtils';
import {sourceTokens,replaceRootFields,valueEntries,checkCsvSignal} from './hazardCsvTokens';
import {hazardCsvTransferRun} from './hazardCsvTransfer';
import {createHazardRowNormalizer} from '../project-hazard-analysis/classificationResolutionStatus';
import {normalizeHazardOperationalContexts} from '../project-hazard-analysis/hazardOperationalContexts';
import {createImportedHazardContextAssigner} from './codeHazardImportContext';

const TABLES=['baseline','updates','seen','preprocessing'];
const context=['Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions'];
const groups=[['Function (From)','Control Action','Function (To)','Guide Phrase'],['Item / Function','Failure Mode']];
const normalize=value=>csvCellText(value);
const headerMaps=new WeakMap();
const columns=headers=>{if(!headerMaps.has(headers))headerMaps.set(headers,new Map(headers.map((header,index)=>[csvHeaderKey(header),index])));return headerMaps.get(headers);};
const signature=(headers,row,names)=>JSON.stringify(names.map(name=>normalize(row[columns(headers).get(csvHeaderKey(name))])));
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const sourceBasis=run=>JSON.stringify(stable(Object.fromEntries(['hazardMethod','architectureSnapshotHash','functionalModelSnapshotHash','analysisAbstraction','organizationProfileProvenance','operationalContexts','selectedOperationalContextId'].map(key=>[key,run?.[key]]))));
// These indexes are installed at database creation, independently of the main
// hazard schema, so an unfinished import never appears as a saved analysis.
async function openImportDB(){return openDB('xhandle-hazard-csv-imports-v1',1,{upgrade(db){
 db.createObjectStore('sessions',{keyPath:'id'});
 for(const name of TABLES){const store=db.createObjectStore(name,{keyPath:'id'});store.createIndex('session','session');
  if(name==='baseline')for(const key of ['rowId','identity','interface'])store.createIndex(key,['session',key]);
 }
}});}
async function batchPut(db,table,values){if(!values.length)return;const tx=db.transaction(table,'readwrite');tx.done.catch(()=>{});try{await Promise.all(values.map(value=>tx.store.put(value)));await tx.done;}catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}}
async function* records(db,table,session){
 let last=null;
 while(true){const range=last?IDBKeyRange.bound(last,[session,Number.MAX_SAFE_INTEGER],true):IDBKeyRange.bound([session],[session,Number.MAX_SAFE_INTEGER]);
  const page=await db.getAll(table,range,8);if(!page.length)break;
  for(const row of page)yield row;last=page[page.length-1].id;}
}
async function* sessionRecords(db,table,session){
 // Preprocessing keys are strings, while baseline/update keys are row numbers.
 let last;
 while(true){const range=last?IDBKeyRange.bound(last,[session,'\uffff'],true):IDBKeyRange.bound([session],[session,'\uffff']);
  const page=await db.getAll(table,range,8);if(!page.length)break;for(const row of page)yield row;last=page.at(-1).id;}
}
function descriptor(root,meta){const index=validateHazardRowIndex(root.payload);return {...index.metadata,id:root.id,projectId:root.projectId,repoId:root.repoId,[PAGED_HAZARD]:{revision:meta.storageRevision,generation:root.payload.generation,total:index.spans.length,headers:index.headers,details:Object.keys(index.details||{}),omittedMetadata:index.omittedMetadata||[]}};}
async function assertSource(db,session,signal){
 checkCsvSignal(signal);const meta=await db.get('runMetadata',session.root.id),root=await db.get('hazardAnalysisRuns',session.root.id);
 if(session.revision ? meta?.storageRevision!==session.revision || root?.payload?.generation!==session.sourceGeneration : Boolean(root))throw Error('Saved analysis changed. Reload the results and select the CSV again.');
}
async function touch(db,session){if(session.owned){const lease=await db.get(HAZARD_STAGING,session.root.payload.generation);if(!lease)throw Error('The import preview expired. Select the CSV again.');await db.put(HAZARD_STAGING,{...lease,touched:Date.now()});}}
async function reapSessions(db,edits){
 let last;
 while(true){const page=await edits.getAll('sessions',last?IDBKeyRange.lowerBound(last,true):undefined,8);if(!page.length)break;
  for(const session of page)if(Date.now()-session.createdAt>24*60*60*1000)await discardSession(db,edits,session);
  last=page.at(-1).id;}
}

export async function prepareHazardCsvImport({run,file,undo=false,operationalContexts,signal,onProgress=()=>{}}){
 const db=await openHazardSchema({signal}),edits=await openImportDB();let session;
 const progress=(phase,completed,total)=>onProgress({phase,completed,total});
 try{
  await reapSessions(db,edits);
  if(!run?.id || !run.projectId || !run.repoId)throw Error('Open a project hazard table before importing.');
  if(run.finalSavePending)throw Error('Finish saving the current analysis before importing.');
  const id=newHazardStorageRevision();let meta=await db.get('runMetadata',run.id),root=await db.get('hazardAnalysisRuns',run.id),owned=false;
  if(root && !meta?.storageRevision){const tx=db.transaction('runMetadata','readwrite');const current=await tx.store.get(run.id);meta={...(current||hazardMetadata(root)),storageRevision:current?.storageRevision||newHazardStorageRevision()};await tx.store.put(meta);await tx.done;}
  if(root && isChunkedHazardRun(root)){
   if(run[PAGED_HAZARD] && (meta?.storageRevision!==run[PAGED_HAZARD].revision || root.payload.generation!==run[PAGED_HAZARD].generation))throw Error('Saved results changed. Reload before importing.');
   let index;try{index=validateHazardRowIndex(root.payload);}catch{}
   if(index?.csvEditVersion!==1){progress('Preparing saved results',0,1);await prepareHazardTableIndex(db,run.id,{signal,force:true,onProgress:p=>progress('Preparing saved results',p.completed,p.total)});root=await db.get('hazardAnalysisRuns',run.id);}
  }else{
   progress('Preparing existing project data',0,0);
   const source=hazardCsvTransferRun(root||run);
   root=await stageHazardRun(db,source,()=>checkCsvSignal(signal),{signal,tokenSource:streamValue(source),yieldEveryPages:64,onProgress:p=>progress('Preparing existing project data',p.completed,0)});owned=true;
  }
  const rawIndex=validateHazardRowIndex(root.payload),normalizer=createHazardRowNormalizer(rawIndex.headers);
  const index={...rawIndex,headers:normalizer.headers};
  if(!rawIndex.headers.length)throw Error('This saved analysis has no compatible hazard CSV table.');
  session={id,root,revision:meta?.storageRevision||null,sourceGeneration:owned?undefined:root.payload.generation,basis:sourceBasis(index.metadata),contexts:normalizeHazardOperationalContexts(operationalContexts ?? run.operationalContexts),owned,originalHeaders:rawIndex.headers,headers:index.headers,total:index.spans.length,undo,createdAt:Date.now(),hash:'',plan:{changedRowCount:0,unchangedRowCount:0,changedColumns:[],governedColumns:[],unknownColumns:[],conflicts:[],conflictCount:0,identityMatchedRowCount:0}};
  await edits.put('sessions',session);
  const idColumn=index.headers.findIndex(header=>['raw analysis row id','raw row id','analysis row id'].includes(csvHeaderKey(header)));
  const identityNames=groups.find(names=>names.every(name=>index.headers.map(csvHeaderKey).includes(csvHeaderKey(name))))||[];
  session.identityNames=identityNames;
  const hash=shajs('sha256');hash.update(JSON.stringify(rawIndex.headers)+'\n');
  // Use verified coordinates for both published runs and unpublished drafts.
  // Revalidating/stringifying an entire large index for every UI page would
  // make this bulk operation quadratic. The reader caches only 16 data pages.
  let baselineBatch=[],baselineBytes=0;
  for(let n=0;n<index.spans.length;n++){
   const assembler=createValueAssembler();let bytes=0;
   for await(const token of sourceTokens(db,root,{signal,span:index.spans[n]})){
    bytes+=JSON.stringify(token).length*2;if(bytes>8*1024*1024)throw Error('A saved row exceeds the safe 8 MiB editing limit.');assembler.add(token);
   }
   const originalRow=assembler.finish(),row=normalizer.normalizeRow(originalRow,n);baselineBatch.push({...makeBaseline(row,n),...(JSON.stringify(row)!==JSON.stringify(originalRow)?{originalRow}: {})});hash.update(JSON.stringify(originalRow)+'\n');baselineBytes+=bytes;
   if(baselineBatch.length>=100 || baselineBytes>=1024*1024 || n===index.spans.length-1){await batchPut(edits,'baseline',baselineBatch);baselineBatch=[];baselineBytes=0;progress('Indexing current rows',n+1,index.spans.length);await touch(db,session);await pause();}
  }
  function makeBaseline(row,n){return {id:[id,n],session:id,index:n,row,rowId:normalize(row[idColumn]),identity:signature(index.headers,row,[...identityNames,...context]),interface:signature(index.headers,row,identityNames),unspecified:context.every((name,i)=>{const value=normalize(row[index.headers.indexOf(name)]);return !value || value===['context-unspecified','Unspecified scenario','Unspecified mode',''][i];})};}
  session.hash=hash.digest('hex');
  let csvHeaders,restoreNormalizer,restoreCount=0,line=1,pending=[],pendingBytes=0;const changed=new Set(),governed=new Set(),unknown=new Set();
  const rows=undo ? undoRows() : streamCsv(file,{signal,onProgress:p=>progress('Reading and validating CSV',p.completed,p.total)});
  for await(const cells of rows){
   checkCsvSignal(signal);
   if(!csvHeaders){csvHeaders=cells;if(undo){session.restoreHeaders=cells;restoreNormalizer=createHazardRowNormalizer(cells);}const keys=cells.map(csvHeaderKey);if(keys.some((key,i)=>key && keys.indexOf(key)!==i))throw Error('The CSV contains duplicate column names. Existing results were not changed.');continue;}
   line++;if(!undo && cells.every(value=>!normalize(value)))continue;if(cells.length>csvHeaders.length)throw Error(`CSV line ${line} has more cells than the header.`);
   pending.push({cells,line});pendingBytes+=JSON.stringify(cells).length*2;if(pending.length>=100 || pendingBytes>=1024*1024){await validateBatch();pendingBytes=0;await touch(db,session);await pause();}
  }
  await validateBatch();if(!csvHeaders)throw Error('The CSV is empty.');
  if(undo && restoreCount!==session.total)throw Error('The previous table no longer matches this analysis. Existing results were not changed.');
  session.plan.changedColumns=[...changed];session.plan.governedColumns=[...governed];session.plan.unknownColumns=[...unknown];
  await assertSource(db,session,signal);await edits.put('sessions',session);
  return {sessionId:id,...session.plan};
  async function* undoRows(){const span=index.details?.csvImportPreviousSummary;if(!span)throw Error('There is no previous CSV import to restore.');for await(const [,row]of valueEntries(sourceTokens(db,root,{signal,span,onProgress:p=>progress('Preparing previous results',p.completed,p.total)}),'array'))yield row;}
  async function validateBatch(){
   if(!pending.length)return;
   const tx=edits.transaction(['baseline','updates','seen'],'readwrite');tx.done.catch(()=>{});
   try{
    for(const {cells,line:lineNumber}of pending){
     checkCsvSignal(signal);
     if(undo){
      // Undo is exact snapshot restoration, never a fresh CSV merge. Validate
      // row identity/order but retain every original cell and header verbatim.
      const n=restoreCount++,source=await tx.objectStore('baseline').get([id,n]);
      const restored=restoreNormalizer.normalizeRow(cells,n),restoredId=restored[restoreNormalizer.headers.findIndex(header=>['raw analysis row id','raw row id','analysis row id'].includes(csvHeaderKey(header)))];
      if(!source || normalize(restoredId)!==source.rowId)throw Error('The previous table no longer matches this analysis. Existing results were not changed.');
      await tx.objectStore('updates').put({id:[id,n],session:id,index:n,rowId:source.rowId,row:cells,changedHeaders:[]});
      if(JSON.stringify(cells)!==JSON.stringify(source.row) || JSON.stringify(csvHeaders)!==JSON.stringify(session.headers))session.plan.changedRowCount++;
      continue;
     }
     const keys=csvHeaders.map(csvHeaderKey),csvId=keys.findIndex(key=>['raw analysis row id','raw row id','analysis row id'].includes(key)),rowId=normalize(cells[csvId]);
     if(rowId){const key=[id,'csv-id',rowId];if(await tx.objectStore('seen').get(key))throw Error(`CSV line ${lineNumber} repeats row ID ${rowId}.`);await tx.objectStore('seen').put({id:key,session:id});}
     const baseline=tx.objectStore('baseline');let matches=rowId?await baseline.index('rowId').getAll([id,rowId],2):[];
     if(matches.length>1)throw Error(`CSV line ${lineNumber} matches duplicate saved row IDs.`);
     if(!matches.length){
      if(!identityNames.length || !identityNames.every(name=>keys.includes(csvHeaderKey(name))))throw Error(`CSV line ${lineNumber} has no matching row ID or complete identifying columns.`);
      const commonContext=context.filter(name=>keys.includes(csvHeaderKey(name)) && index.headers.map(csvHeaderKey).includes(csvHeaderKey(name)));
      // Index exact interfaces first; at most two matches are enough to detect
      // ambiguity unless context disambiguates a group. Filter via a cursor.
      const exactContext=commonContext.length===context.length?await baseline.index('identity').getAll([id,signature(csvHeaders,cells,[...identityNames,...context])],2):[];
      let cursor=exactContext.length?null:await baseline.index('interface').openCursor(IDBKeyRange.only([id,signature(csvHeaders,cells,identityNames)]));let count=0,placeholder=null,full=exactContext;
      while(cursor){const candidate=cursor.value;count++;if(candidate.unspecified)placeholder=candidate;
       if(commonContext.every(name=>normalize(candidate.row[index.headers.findIndex(h=>csvHeaderKey(h)===csvHeaderKey(name))])===normalize(cells[keys.indexOf(csvHeaderKey(name))])))full.push(candidate);
       if(full.length>1)break;cursor=await cursor.continue();}
      matches=full.length?full:count===1 && placeholder?[placeholder]:[];
      session.plan.identityMatchedRowCount++;
     }
     if(matches.length!==1)throw Error(`CSV line ${lineNumber} ${matches.length?'matches multiple rows':'has no matching row'}. Preserve row IDs or distinguishing interface/context columns.`);
     const source=matches[0],seenKey=[id,'row',source.index];if(await tx.objectStore('seen').get(seenKey))throw Error(`CSV line ${lineNumber} repeats an existing analysis row.`);
     await tx.objectStore('seen').put({id:seenKey,session:id});
     const plan=planHazardAnalysisCsvRows([index.headers,source.row],[csvHeaders,cells]);if(plan.errors.length)throw Error(`CSV line ${lineNumber}: ${plan.errors[0]}`);
     plan.unknownColumns.forEach(value=>unknown.add(value));
     if(!plan.changedRowCount){session.plan.unchangedRowCount++;continue;}
     const update=plan.updates[0],merged=applyHazardAnalysisCsvImport([index.headers,source.row],[update])[1];
     await tx.objectStore('updates').put({id:[id,source.index],session:id,index:source.index,rowId:source.rowId,row:merged,changedHeaders:update.changes.map(change=>change.header)});
     session.plan.changedRowCount++;plan.changedColumns.forEach(value=>changed.add(value));plan.governedColumns.forEach(value=>governed.add(value));session.plan.conflictCount+=plan.conflicts.length;
     if(session.plan.conflicts.length<3)session.plan.conflicts.push(...plan.conflicts.slice(0,3-session.plan.conflicts.length));
    }
    await tx.done;pending=[];
   }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
  }
 }catch(error){if(session)await discardSession(db,edits,session).catch(()=>{});throw error;}
 finally{db.close();edits.close();}
}

async function discardSession(db,edits,session){
 // Every primary key begins with the session ID. Native range deletion avoids
 // hundreds of thousands of cursor round trips after a large committed import.
 const tx=edits.transaction(TABLES,'readwrite');tx.done.catch(()=>{});
 try{await Promise.all(TABLES.map(table=>tx.objectStore(table).delete(IDBKeyRange.bound([session.id],[session.id,[]]))));await tx.done;}
 catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
 await edits.delete('sessions',session.id);if(session.owned)await removeHazardGeneration(db,session.root.payload.generation).catch(()=>{});
}
export async function discardHazardCsvImport(sessionId){const db=await openHazardSchema(),edits=await openImportDB();try{const session=await edits.get('sessions',sessionId);if(session)await discardSession(db,edits,session);}finally{db.close();edits.close();}}

export async function applyHazardCsvImport(sessionId,{currentRun,operationalContexts,signal,onProgress=()=>{},onCommitted=()=>{}}={}){
 const db=await openHazardSchema({signal}),edits=await openImportDB();let session,staged,published=false;
 const progress=(phase,completed,total)=>onProgress({phase,completed,total});
 try{
  session=await edits.get('sessions',sessionId);if(!session)throw Error('The import preview expired. Select the CSV again.');
  await assertSource(db,session,signal);await touch(db,session);
  if(!currentRun || (session.revision && currentRun.id!==session.root.id) || currentRun.projectId!==session.root.projectId || currentRun.repoId!==session.root.repoId || sourceBasis(currentRun)!==session.basis)throw Error('The active analysis changed. Select the CSV again.');
  if(JSON.stringify(normalizeHazardOperationalContexts(operationalContexts ?? currentRun.operationalContexts))!==JSON.stringify(session.contexts))throw Error('Operational contexts changed. Select the CSV again.');
  if(currentRun[PAGED_HAZARD] ? currentRun[PAGED_HAZARD].revision!==session.revision : !await sameSummary(currentRun))throw Error('The current table changed. Select the CSV again.');
  const index=validateHazardRowIndex(session.root.payload),oldPreprocessing=index.details?.[session.undo?'csvImportPreviousPreprocessing':'userPreprocessing'];
  if(oldPreprocessing){let batch=[];for await(const [rowId,value]of valueEntries(sourceTokens(db,session.root,{signal,span:oldPreprocessing,onProgress:p=>progress('Preparing reviewed assessments',p.completed,p.total)}))){batch.push({id:[session.id,rowId],session:session.id,value});if(batch.length>=100){await batchPut(edits,'preprocessing',batch);batch=[];}}await batchPut(edits,'preprocessing',batch);}
  let outputHeaders=session.undo?session.restoreHeaders:session.headers,contextChanged=false;
  if(!session.undo){
   const assigner=session.contexts.length?createImportedHazardContextAssigner(session.headers,session.contexts):null;
   // With contexts, visit every row just as the previous whole-table policy did.
   // Otherwise visit only edited rows. Combine preprocessing and assignment so
   // a large import does not require a second full pass of IndexedDB requests.
   let completed=0;
   for await(const entry of records(edits,assigner?'baseline':'updates',session.id)){
    checkCsvSignal(signal);
    const source=assigner?entry:await edits.get('baseline',entry.id);
    const update=assigner?await edits.get('updates',entry.id):entry;
    const previous=await edits.get('preprocessing',[session.id,source.rowId]);
    let value=update?recordUserPreprocessing(previous?.value,session.headers,update.row,update.changedHeaders,source.row):previous?.value;
    const assigned=assigner?.assign(update?.row||source.row,value);
    if(assigned?.changed){
     contextChanged=true;outputHeaders=assigner.headers;value=assigned.preprocessing;
     await edits.put('updates',{...update,id:source.id,session:session.id,index:source.index,rowId:source.rowId,row:assigned.row,changedHeaders:update?.changedHeaders||[]});
    }
    if(update || assigned?.changed){
     if(value)await edits.put('preprocessing',{id:[session.id,source.rowId],session:session.id,value});
     else await edits.delete('preprocessing',[session.id,source.rowId]);
    }
    if(++completed%100===0){progress('Saving reviewed assessments',completed,assigner?session.total:session.plan.changedRowCount);await touch(db,session);await pause();}
   }
  }
  async function* summary(previous=false){yield ['array'];yield*streamValue(previous?session.originalHeaders:outputHeaders);
   progress(previous?'Preserving previous results':'Saving hazard results',0,session.total);
   for await(const source of records(edits,'baseline',session.id)){checkCsvSignal(signal);const update=previous?null:await edits.get('updates',source.id);yield*streamValue(previous?(source.originalRow||source.row):(update?.row||source.row));if(source.index%100===0)progress(previous?'Preserving previous results':'Saving hazard results',source.index+1,session.total);}yield ['end'];}
  async function* summaries(){yield ['array'];progress('Saving references',0,session.total);for await(const source of records(edits,'baseline',session.id)){checkCsvSignal(signal);const update=await edits.get('updates',source.id);const row=summarySheetToHazardSummaryRows([outputHeaders,update?.row||source.row],source.index)[0];yield*streamValue(row);if(source.index%100===0)progress('Saving references',source.index+1,session.total);}yield ['end'];}
  async function* preprocessing(){yield ['object'];let completed=0;const total=await edits.countFromIndex('preprocessing','session',session.id);progress('Saving review details',0,total);for await(const entry of sessionRecords(edits,'preprocessing',session.id)){yield*streamValue(entry.id[1]);yield*streamValue(entry.value);if(++completed%100===0)progress('Saving review details',completed,total);}yield ['end'];}
  async function* conflicts(){yield ['array'];for await(const entry of sessionRecords(edits,'preprocessing',session.id))for(const message of entry.value?.conflicts||[])yield*streamValue(`${entry.id[1]}: ${message}`);yield ['end'];}
  const scalar=value=>()=>streamValue(value),updatedAt=new Date().toISOString();
  const fields={...(contextChanged?{operationalContexts:scalar(session.contexts),analysisOperationalContexts:scalar(session.contexts)}:{}),summaryRows:summaries,userPreprocessing:preprocessing,userPreprocessingConflicts:conflicts,
   csvImportPreviousSummary:session.undo?scalar(null):()=>summary(true),
   csvImportPreviousPreprocessing:session.undo?scalar(null):()=>index.details?.userPreprocessing?sourceTokens(db,session.root,{signal,span:index.details.userPreprocessing}):streamValue({}),
   updatedAt:scalar(updatedAt),finalSavePending:scalar(false),finalSaveStatus:scalar('saved'),saveFailureMessage:scalar('')};
  // Replace only the Summary member inside generatedSheets, preserving all
  // other sheets and all evidence outside it as verified source tokens.
  async function* rewrite(){
   yield*replaceRootFields(sourceTokens(db,session.root,{signal,onProgress:p=>progress('Saving imported results',p.completed,p.total)}),{
    ...fields,generatedSheets:original=>replaceRootFields(original||streamValue({}),{Summary:()=>summary()}),
    ...(index.summarySource==='analysisResult'?{analysisResult:original=>replaceRootFields(original,{Summary:()=>summary()})}:{}),
   });
  }
  progress('Saving imported results',0,0);
  staged=await stageHazardRun(db,{...session.root,updatedAt},()=>checkCsvSignal(signal),{signal,tokenSource:rewrite(),yieldEveryPages:64});
  await assertSource(db,session,signal);
  const revision=await publishHazardRun(db,staged,hazardMetadata({...session.root,updatedAt}),()=>checkCsvSignal(signal),undefined,session.revision,signal);
  published=true;
  const result=descriptor(staged,{storageRevision:revision});
  const changedRowCount=session.plan.changedRowCount;
  try{onCommitted({run:result,changedRowCount});}catch{/* An observer cannot undo a durable commit. */}
  await discardSession(db,edits,session).catch(()=>{});session=null;
  return {run:result,changedRowCount};
  async function sameSummary(run){const sheet=run.generatedSheets?.Summary;if(!sheet)return false;const hash=shajs('sha256');for(let i=0;i<sheet.length;i++){checkCsvSignal(signal);hash.update(JSON.stringify(sheet[i])+'\n');if(i%100===0){progress('Checking current table',i,sheet.length);await pause();}}return hash.digest('hex')===session.hash;}
 }catch(error){if(staged&&!published)await removeHazardGeneration(db,staged.payload.generation).catch(()=>{});throw error;}
 finally{db.close();edits.close();}
}
