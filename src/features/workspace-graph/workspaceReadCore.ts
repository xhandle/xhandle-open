import {openWorkspaceGraphDB} from './workspaceGraphDb';
import {boundedValue} from './workspaceGraphProjection';
import {validateWorkspaceReadCall} from './workspaceReadPolicy';
import {codeSourceIndexPrefix} from '../code-architecture-context/codeSourceIdentity';
import {readSourceTextRange} from './workspaceSourcePages';
import {requestValue} from '../code-architecture-storage/chunkedRecord';
const normalized=(value:any)=>String(value??'').normalize('NFKC').toLocaleLowerCase();
const fieldKey=(value:any)=>normalized(value).replace(/[^\p{L}\p{N}]/gu,'');
export function workspaceReadFields(row:any){
 const data=row.structuredData,fields=Object.assign(Object.create(null),{id:row.id,type:row.type,title:row.title,status:row.status,content:row.content,summary:row.summary,createdAt:row.createdAt,updatedAt:row.updatedAt});
 if(data&&typeof data==='object')for(const key of Object.keys(data))if(!['__proto__','constructor','prototype'].includes(key))fields[key]=data[key];
 if(Array.isArray(data?.columns)&&Array.isArray(data?.row))data.columns.forEach((key:any,i:number)=>{if(typeof key==='string'&&!['__proto__','constructor','prototype'].includes(key))fields[key]=data.row[i];});
 return fields;
}
const getField=(row:any,name:string)=>{const fields=workspaceReadFields(row);const key=Object.keys(fields).find(key=>fieldKey(key)===fieldKey(name));return key===undefined?undefined:fields[key];};
const citation=(row:any)=>({artifactId:row.id,projectId:row.projectId,type:row.type,title:row.title,sourceStore:row.sourceStore,sourceKey:row.sourceKey,sourceId:row.sourceId});
const summary=(row:any)=>({id:row.id,title:row.title,type:row.type,projectId:row.projectId,sourceId:row.sourceId,runId:row.runId,repoId:row.repoId,updatedAt:row.updatedAt,fields:boundedValue(workspaceReadFields(row),1600)});
export class WorkspaceReadBudget {
 signal?:AbortSignal;deadline:number;scanned=0;bytes=0;calls=0;
 constructor({signal,timeoutMs=8000}:{signal?:AbortSignal;timeoutMs?:number}={}){this.signal=signal;this.deadline=Date.now()+Math.min(12000,Math.max(1,timeoutMs));}
 check(){if(this.signal?.aborted)throw this.signal.reason||new DOMException('Workspace read cancelled.','AbortError');if(Date.now()>this.deadline||this.scanned>100000||this.bytes>256*1024*1024)throw Object.assign(Error('Workspace read budget reached.'),{code:'READ_BUDGET'});}
}
function versionInfo(meta:any,runs:Map<string,any>){
 const runId=meta.runId||(meta.type==='code_architecture_hazard_row'?String(meta.sourceId||'').split(':summary:')[0]:null);
 const run=runId?runs.get(runId):null;
 return {runId,repoId:String(meta.repoId||meta.structuredData?._repoId||meta.structuredData?.repoId||run?.repoId||'').split(':history:')[0]||null,historical:Boolean(meta.historical||String(meta.sourceKey||'').includes(':history:'))};
}
function metadataInScope(meta:any,policy:any,call:any){
 const ids=call.projectId?[call.projectId]:policy.projectIds;
 return ids.includes(String(meta.projectId))&&(!call.types.length||call.types.includes(meta.type)||policy.derivedArtifactIds?.includes(meta.id));
}
async function* metadataPages(db:any,policy:any,call:any,budget:WorkspaceReadBudget,allowed:(row:any)=>boolean){
 for(const projectId of call.projectId?[call.projectId]:policy.projectIds){
  let after:any;
  do{
   budget.check();const tx=db.transaction('artifactIndex'),rows:any[]=[];
   let cursor=await tx.store.index('by_project').openCursor(projectId);
   if(cursor&&after!==undefined){cursor=await cursor.continuePrimaryKey(projectId,after);if(cursor&&cursor.primaryKey===after)cursor=await cursor.continue();}
   while(cursor&&rows.length<64){rows.push(cursor.value);cursor=await cursor.continue();}
   await tx.done;if(!rows.length)break;
   after=rows[rows.length-1].id;
   const hydrated=new Map<string,any>();
   if(call.query||call.filters?.length||call.groupBy||call.distinctFields?.length){
    let batch:any[]=[],bytes=0;
    const flush=async()=>{if(!batch.length)return;budget.check();const read=db.transaction('artifacts');
     const values=await Promise.all(batch.map(meta=>read.store.get(meta.id)));await read.done;
     values.forEach((row,index)=>{hydrated.set(batch[index].id,row);if(row)budget.bytes+=JSON.stringify(row).length*2;});budget.check();batch=[];bytes=0;};
    for(const meta of rows)if(allowed(meta)&&meta.readableBody===true){const size=meta.bodyReadBytes||1024*1024;if(batch.length&&bytes+size>2*1024*1024)await flush();batch.push(meta);bytes+=size;}
    await flush();
   }
   for(const row of rows){budget.scanned++;if(!call.types.length||call.types.includes(row.type))yield {meta:row,full:hydrated.get(row.id)};}
   if(!cursor)break;
   await new Promise(resolve=>setTimeout(resolve,0));
  }while(true);
 }
}
async function runCatalog(db:any,policy:any,budget:WorkspaceReadBudget){
 const runs=new Map<string,any>(),latest=new Map<string,string>();
 for(const projectId of policy.projectIds){
  const tx=db.transaction('runs');let cursor=await tx.store.index('by_project').openCursor(projectId),count=0;
  while(cursor){budget.check();if(++count>1000)throw Object.assign(Error('Too many saved runs to resolve safely.'),{code:'READ_BUDGET'});const row=cursor.value;
   if(row.type==='code_architecture_hazard_analysis'){
    const info={...row.structuredData,projectId,updatedAt:row.updatedAt};runs.set(String(row.sourceId),info);
    const key=JSON.stringify([projectId,info.repoId||'',info.hazardMethod||'']);const old=latest.get(key);
    if(!old||String(info.updatedAt)>String(runs.get(old)?.updatedAt))latest.set(key,String(row.sourceId));
   }cursor=await cursor.continue();
  }await tx.done;
 }return {runs,latest:new Set(latest.values())};
}
function versionAllowed(meta:any,policy:any,call:any,catalog:any){
 const info=versionInfo(meta,catalog.runs);
 if(policy.repoId&&!(policy.repoIds||[String(policy.repoId)]).includes(String(info.repoId||''))&&['code_architecture_edge','code_architecture_hazard_row','code_architecture_software_requirement','code_architecture_system_requirement','code_architecture_subsystem_requirement','code_architecture_design_element'].includes(meta.type))return false;
 if(call.runId)return info.runId===call.runId;
 if(call.history==='all'||(policy.historyAllowed&&['versions','compare','read','relationships'].includes(call.operation)))return true;
 if(policy.runId&&info.runId)return info.runId===policy.runId;
 return !info.historical&&(!info.runId||catalog.latest.has(info.runId));
}
async function body(db:any,meta:any,budget:WorkspaceReadBudget){
 budget.check();if(meta.readableBody!==true)return null;
 const row=await db.get('artifacts',meta.id);budget.check();if(!row)return null;
 const serialized=JSON.stringify(row);budget.bytes+=serialized.length*2;budget.check();return row;
}
function matchPosition(text:string,query:string){
 const haystack=normalized(text),needle=normalized(query);let at=haystack.indexOf(needle);
 if(!/^[\p{L}]{1,16}[-_][\p{L}\p{N}_.-]*\d[\p{L}\p{N}_.-]*$/u.test(needle))return at;
 while(at>=0){const before=haystack[at-1],after=haystack[at+needle.length];if((!before||!/[\p{L}\p{N}_.-]/u.test(before))&&(!after||!/[\p{L}\p{N}_.-]/u.test(after)))return at;at=haystack.indexOf(needle,at+1);}return -1;
}
function matches(row:any,call:any){
 if(call.query&&matchPosition(JSON.stringify(workspaceReadFields(row)),call.query)<0)return false;
 return (call.filters||[]).every((filter:any)=>{
  const value=getField(row,filter.field);
  if(filter.op==='exists')return filter.value===false?value==null||value==='':value!=null&&value!=='';
  if(filter.op==='eq')return normalized(value).trim()===normalized(filter.value).trim();
  if(filter.op==='contains')return normalized(value).includes(normalized(filter.value));
  if(value==null||value===''||!Number.isFinite(Number(value))||!Number.isFinite(Number(filter.value)))return false;
  return filter.op==='gt'?Number(value)>Number(filter.value):Number(value)<Number(filter.value);
 });
}
export async function executeWorkspaceReadCall(raw:any,policy:any,budget=new WorkspaceReadBudget()){
 const call:any=validateWorkspaceReadCall(raw,policy);budget.check();if(++budget.calls>4)throw Error('Workspace read call limit reached.');
 const coverage:any={state:'complete',complete:true,scanned:0,matched:0,unreadable:0,returned:0,scope:{types:call.types,filters:call.filters||[],query:call.query||'',distinctFields:call.distinctFields||null,groupBy:call.groupBy||null,projectIds:call.projectId?[call.projectId]:policy.projectIds,repoId:policy.repoId,history:call.history,runId:call.runId||policy.runId||null},domain:'indexed workspace records; unknown ownership excluded'};
 const result:any={operation:call.operation,rows:[],citations:[],coverage};
 const db=await openWorkspaceGraphDB(),start=budget.scanned;const limit=call.limit??12,offset=call.offset||0;
 const incomplete=(reason:string,state='partial')=>{coverage.complete=false;coverage.state=state;coverage.reason=reason;};
 const add=(row:any)=>{if(result.rows.length<limit){const item:any=summary(row);
  if(call.query){const text=JSON.stringify(workspaceReadFields(row)),at=matchPosition(text,call.query);if(at>=0)item.matchExcerpt=text.slice(Math.max(0,at-160),at+480);}
  if(call.filters?.length)item.filterValues=Object.fromEntries(call.filters.map((filter:any)=>[filter.field,boundedValue(getField(row,filter.field),300)]));
  result.rows.push(item);result.citations.push(citation(row));}};
 try{
  const catalog=await runCatalog(db,policy,budget);
  const allowed=(meta:any)=>{if(!metadataInScope(meta,policy,call))return false;const info=versionInfo(meta,catalog.runs);if(policy.repoId&&!info.repoId&&meta.type.startsWith('code_architecture_')){incomplete('Repository ownership is unavailable for some indexed records.','unindexed');return false;}if(info.runId&&!catalog.runs.has(info.runId)&&call.history!=='all'&&!call.runId){incomplete('Saved run metadata is unavailable; select a saved run or refresh indexing.','unindexed');return false;}return versionAllowed(meta,policy,call,catalog);};
  const exact=async(id:string)=>{const meta=await db.get('artifactIndex',id);if(!meta||!allowed(meta))return null;const row=await body(db,meta,budget);if(!row){coverage.unreadable++;incomplete('This stored record requires refreshed indexing or exceeds the safe record-read budget.','inaccessible');}return row;};
  if(call.operation==='read'){
   const row=await exact(call.artifactId);if(!row){if(coverage.complete)incomplete('The requested record is absent from the permitted index.','not-found');}
   else{
    const value=call.field?getField(row,call.field):row.content||JSON.stringify(workspaceReadFields(row));
    if(call.field&&value===undefined)incomplete('That field is not present in this saved record.','not-found');
    const text=typeof value==='string'?value:JSON.stringify(value??null);let position=offset;
    if(call.section){position=normalized(text).indexOf(normalized(call.section));if(position<0){incomplete('The requested section was not found in this record.','not-found');position=0;}}
    add(row);if(!result.citations.length)result.citations.push(citation(row));result.offset=position;result.excerpt=text.slice(position,position+6000);result.nextOffset=position+result.excerpt.length<text.length?position+result.excerpt.length:null;coverage.matched=1;coverage.contentTruncated=result.nextOffset!==null;
   }
  }else if(call.operation==='compare'){
   coverage.domain='two individual stored records; a complete-run comparison is not performed by this operation';
   const first=await exact(call.artifactId),second=await exact(call.otherArtifactId);
   if(!first||!second)incomplete('Both versions must be readable in the permitted project scope.','inaccessible');
   else if(first.projectId!==second.projectId||first.type!==second.type)incomplete('Choose two versions of the same artifact type in one project.','inaccessible');
   else{
    add(first);add(second);result.citations=[citation(first),citation(second)];const a=workspaceReadFields(first),b=workspaceReadFields(second);result.changes=[];
    for(const key of new Set([...Object.keys(a),...Object.keys(b)])){budget.check();if(JSON.stringify(a[key])!==JSON.stringify(b[key])){if(result.changes.length>=20){coverage.contentTruncated=true;break;}let before=boundedValue(a[key],600),after=boundedValue(b[key],600),offset=0;
      if(typeof a[key]==='string'&&typeof b[key]==='string'){while(offset<Math.min(a[key].length,b[key].length)&&a[key][offset]===b[key][offset]){if(offset%4096===0)budget.check();offset++;}before=a[key].slice(Math.max(0,offset-160),offset+440);after=b[key].slice(Math.max(0,offset-160),offset+440);}
      result.changes.push({field:key,before,after,offset});}}
    coverage.matched=2;
   }
  }else if(call.operation==='relationships'){
   const root=await db.get('artifactIndex',call.artifactId);if(!root||!allowed(root))incomplete('The requested root is absent from the permitted scope.','not-found');
   else{
    result.relationships=[];const seen=new Set<string>();
    for(const index of ['by_from','by_to']){
     const tx=db.transaction('relationships');let cursor=await tx.store.index(index).openCursor(root.id);
     while(cursor){budget.check();const link=cursor.value;
      // Resolve linked records in a separate transaction below; never expose out-of-scope endpoints.
      if(!seen.has(link.id)&&(!call.relationType||link.type===call.relationType)){seen.add(link.id);result.relationships.push(link);if(result.relationships.length>=100){incomplete('Relationship result limit reached.');break;}}cursor=await cursor.continue();
     }
     await tx.done;
    }
    const links=[];for(const link of result.relationships){const otherId=link.fromArtifactId===root.id?link.toArtifactId:link.fromArtifactId;const other=await db.get('artifactIndex',otherId)||await db.get('runs',otherId);if(other&&metadataInScope(other,policy,{...call,types:[]})&&versionAllowed(other,policy,call,catalog)){links.push({id:link.id,type:link.type,fromArtifactId:link.fromArtifactId,toArtifactId:link.toArtifactId});add(other);}}
    result.relationships=links;result.citations.push(citation(root));coverage.matched=links.length;
   }
  }else if(call.operation==='source'){
   const candidates=policy.projects.flatMap((project:any)=>project.repos.filter((repo:any)=>!policy.repoId||[repo.id,repo.repoId,repo.repoName].map(String).includes(String(policy.repoId))).map((repo:any)=>({project,repo,prefix:codeSourceIndexPrefix(repo)}))).filter((item:any)=>item.prefix);
   if(candidates.length!==1){incomplete('Choose one repository before reading a source file.','inaccessible');}
   else{
    const {prefix,project}=candidates[0];const key=prefix+call.path;
    const opened=await new Promise<IDBDatabase|null>((resolve,reject)=>{const req=indexedDB.open('xhandle');req.onupgradeneeded=()=>{req.transaction?.abort();};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    try{if(!opened?.objectStoreNames.contains('code_index'))incomplete('Source indexing is unavailable.','unindexed');else{
     const record:any=await requestValue(opened.transaction('code_index','readonly').objectStore('code_index').get(key));
     if(!record)incomplete('That source path is not indexed for the selected repository.','not-found');
     else{result.offset=offset;result.excerpt=await readSourceTextRange(opened,'code_index',record.value,{offset,length:6000,signal:budget.signal});result.path=call.path;result.projectId=project.id;result.nextOffset=result.excerpt.hasMore?offset+result.excerpt.text.length:null;coverage.matched=1;coverage.contentTruncated=result.nextOffset!==null;
      const meta:any=(await db.getAllFromIndex('artifactIndex','by_lookup',`*|${key}`,2)).find((row:any)=>row.sourceKey===key||row.sourceId===key);if(meta)result.citations.push(citation(meta));else{coverage.source={projectId:project.id,path:call.path};incomplete('The source excerpt is available; its navigable graph citation has not been indexed.','partial');}
     }
    }}finally{opened?.close();}
   }
  }else{
   const groups=new Map<string,any>(),versions=new Map<string,any>(),distinct=new Set<string>();let distinctBytes=0;
   for await(const {meta,full} of metadataPages(db,policy,call,budget,allowed)){
    budget.check();if(!allowed(meta))continue;
    let row=meta;
    if(call.query||call.filters?.length||call.groupBy||call.distinctFields?.length){if(!full){coverage.unreadable++;continue;}row=full;}
    const fields=Object.keys(workspaceReadFields(row)).map(fieldKey);
    if([...(call.filters||[]).map((filter:any)=>filter.field),...(call.groupBy?[call.groupBy]:[]),...(call.distinctFields||[])].some(name=>!fields.includes(fieldKey(name)))){coverage.unreadable++;continue;}
    if(!matches(row,call))continue;
    if(call.operation==='versions'){
     const info=versionInfo(meta,catalog.runs),key=JSON.stringify([meta.type,info.runId||meta.sourceKey||meta.id]);
     if(versions.has(key))versions.get(key).recordCount++;
     else if(versions.size>=1000)incomplete('Saved version limit reached.');
     else versions.set(key,{...summary(meta),runId:info.runId,repoId:info.repoId,recordCount:1});
     continue;
    }
    if(call.distinctFields)for(const field of call.distinctFields){const value=getField(row,field);if(value==null||value==='')continue;const key=String(value).trim();if(typeof value==='object'||key.length>2000||distinct.size>=50000||distinctBytes>4*1024*1024)incomplete('Distinct-value budget reached or values are not scalar.');else if(!distinct.has(key)){distinct.add(key);distinctBytes+=key.length*2;}}
    const number=coverage.matched++;
    if(call.operation==='aggregate'&&call.groupBy){const value=getField(row,call.groupBy)??null,key=JSON.stringify(value);if((typeof value==='object'&&value!==null)||key.length>2000)incomplete('Grouping requires bounded scalar field values.');else if(groups.size>=100&&!groups.has(key))incomplete('Group limit reached.');else groups.set(key,{value,count:(groups.get(key)?.count||0)+1});}
    if(number>=offset)add(row);
   }
   if(coverage.unreadable)incomplete('Some indexed records lack the requested field or could not be inspected within the safe per-record read budget.','inaccessible');
   if(call.operation==='aggregate'){result.count=coverage.complete?(call.distinctFields?distinct.size:coverage.matched):null;result.observedCount=call.distinctFields?distinct.size:coverage.matched;if(call.distinctFields)result.metric={distinctFields:call.distinctFields};if(call.groupBy)result.groups=[...groups.values()];}
   if(call.operation==='versions'){coverage.matched=versions.size;result.rows=[...versions.values()].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))||a.id.localeCompare(b.id)).slice(offset,offset+limit);result.citations=result.rows.map(citation);}
   result.nextOffset=offset+result.rows.length<coverage.matched?offset+result.rows.length:null;
  }
 }catch(error:any){if(budget.signal?.aborted||error?.name==='AbortError')throw error;if(error?.code==='READ_BUDGET')incomplete(error.message);else incomplete(error?.message||'This source is unavailable.','inaccessible');}
 finally{db.close();}
 coverage.scanned=budget.scanned-start;coverage.returned=result.rows.length;coverage.resultsTruncated=Boolean(result.nextOffset);if(!coverage.complete&&result.count!=null)result.count=null;return result;
}
export async function executeWorkspaceReadPlanCore(calls:any[],policy:any,options:any={}){
 const budget=new WorkspaceReadBudget(options),results=[];
 const beforeDb=await openWorkspaceGraphDB();const before=(await beforeDb.get('workspaces','graph-data-revision'))?.token;beforeDb.close();
 for(const raw of calls){try{budget.check();const call={...raw};for(const key of ['artifactId','otherArtifactId'])if(typeof call[key]==='string'&&call[key].startsWith('$')){const ref=call[key].match(/^\$(\d+)\.rows\.(\d+)\.id$/);if(!ref||!results[Number(ref[1])]?.rows?.[Number(ref[2])]?.id)throw Error('A prior lookup did not resolve the requested record.');call[key]=results[Number(ref[1])].rows[Number(ref[2])].id;}results.push(await executeWorkspaceReadCall(call,{...policy,derivedArtifactIds:results.flatMap((result:any)=>(result.rows||[]).map((row:any)=>row.id))},budget));}catch(error:any){if(options.signal?.aborted||error?.name==='AbortError')throw error;results.push({operation:raw?.operation,coverage:{state:'not-searched',complete:false,reason:error.message},rows:[],citations:[]});break;}}
 const afterDb=await openWorkspaceGraphDB();const after=(await afterDb.get('workspaces','graph-data-revision'))?.token;afterDb.close();
 if(before!==after)for(const result of results){result.coverage={...result.coverage,complete:false,state:'stale',reason:'Indexed workspace data changed during the read.'};if('count' in result)result.count=null;}
 return results;
}
