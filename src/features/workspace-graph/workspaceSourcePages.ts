import { requestValue, isChunkedRecord, hydrateRecord } from '../code-architecture-storage/chunkedRecord';
import { iterateRawHazardSummary } from '../code-architecture-hazard-analysis/iterateRawHazardSummary';
import { isChunkedHazardRun } from '../code-architecture-hazard-analysis/hazardRunChunks';
const check=(signal?:AbortSignal)=>{if(signal?.aborted)throw signal.reason||new DOMException('Workspace indexing cancelled.','AbortError');};
async function part(db:IDBDatabase,store:string,key:string,signal?:AbortSignal){
 check(signal);const record:any=await requestValue(db.transaction(store,'readonly').objectStore(store).get(key));
 if(typeof record?.value!=='string')throw new Error('Saved source record has a missing data chunk.');
 return JSON.parse(record.value);
}
export async function* iterateRecordRows(db:IDBDatabase,store:string,value:any,signal?:AbortSignal):AsyncGenerator<any>{
 check(signal);if(!isChunkedRecord(value)){if(Array.isArray(value))yield* value;return;}
 async function* visit(key:string,depth=0):AsyncGenerator<any>{
  if(depth>64)throw new Error('Saved source record exceeds the supported tree depth.');
  const [type,data]=await part(db,store,key,signal);
  if(type==='pages'){for(const ref of data)yield* visit(ref,depth+1);}
  else if(type==='array'){for(const entry of data){check(signal);yield Object.prototype.hasOwnProperty.call(entry,'ref')?await hydrateRecord(db,store,{format:'xhandle-json-tree-v1',root:entry.ref},{signal}):entry.value;}}
  // Metadata and checkpoints share this store with row arrays.
  else if(!['object','value','string'].includes(type))throw new Error('Saved architecture rows have an invalid tree node.');
 }
 yield* visit(value.root);
}
export async function readSourceFileProjection(db:IDBDatabase,store:string,value:any,signal?:AbortSignal){
 const wanted=new Set(['path','lang','language','functions','exports','sourceType','sourceId','snapshotId','projectId','repoId','createdAt','updatedAt','content']);
 const inline=(name:string,item:any)=>name==='content'?String(item||'').slice(0,4000):['functions','exports'].includes(name)&&Array.isArray(item)?item.slice(0,100):item;
 if(!isChunkedRecord(value))return Object.fromEntries([...wanted].filter(name=>value?.[name]!==undefined).map(name=>[name,inline(name,value[name])]));
 const output:any={};
 async function* entries(key:string,depth=0):AsyncGenerator<any>{
  if(depth>64)throw new Error('Saved source record exceeds the supported tree depth.');
  const [type,data]=await part(db,store,key,signal);
  if(type==='pages'){for(const ref of data)yield* entries(ref,depth+1);}
  else if(type==='object')yield* data;
  else throw new Error('Saved source file is not an object.');
 }
 for await(const [name,entry] of entries(value.root)){
  if(!wanted.has(name))continue;
  if('value' in entry){output[name]=inline(name,entry.value);continue;}
  if(name==='content'){
   const [type,data]=await part(db,store,entry.ref,signal);
   if(type==='value')output.content=String(data||'').slice(0,4000);
   else if(type==='string'){
    let text='';for await(const block of iterateRecordRows(db,store,{format:'xhandle-json-tree-v1',root:data},signal)){text+=String(block);if(text.length>=4000)break;}output.content=text.slice(0,4000);
   }else throw new Error('Saved source text is invalid.');
  }else if(['functions','exports'].includes(name)){
   output[name]=[];for await(const item of iterateRecordRows(db,store,{format:'xhandle-json-tree-v1',root:entry.ref},signal)){output[name].push(item);if(output[name].length>=100)break;}
  }else output[name]=await hydrateRecord(db,store,{format:'xhandle-json-tree-v1',root:entry.ref},{signal});
 }
 return output;
}
export async function* iterateHazardSummary(run:any,signal?:AbortSignal):AsyncGenerator<{headers:any[];row:any[];index:number}>{
 if(!isChunkedHazardRun(run)){
  const summary=run?.generatedSheets?.Summary;if(!Array.isArray(summary))return;
  for(let index=1;index<summary.length;index++){check(signal);yield {headers:summary[0]||[],row:summary[index],index:index-1};}return;
 }
 yield* iterateRawHazardSummary(run,{signal});
}

export async function readSourceTextRange(db:IDBDatabase,store:string,value:any,{offset=0,length=6000,signal}:{offset?:number;length?:number;signal?:AbortSignal}={}){
 check(signal);const end=offset+Math.min(length,6000);
 if(!isChunkedRecord(value)){const text=String(value?.content||'');return {text:text.slice(offset,end),hasMore:text.length>end};}
 async function* fields(key:string,depth=0):AsyncGenerator<any>{
  if(depth>64)throw Error('Saved source tree exceeds the supported depth.');const [type,data]=await part(db,store,key,signal);
  if(type==='pages'){for(const ref of data)yield* fields(ref,depth+1);}else if(type==='object')yield* data;else throw Error('Saved source is not an object.');
 }
 for await(const [name,entry] of fields(value.root))if(name==='content'){
  if('value' in entry){const text=String(entry.value||'');return {text:text.slice(offset,end),hasMore:text.length>end};}
  const [type,data]=await part(db,store,entry.ref,signal);
  if(type==='value'){const text=String(data||'');return {text:text.slice(offset,end),hasMore:text.length>end};}
  if(type!=='string')throw Error('Saved source text is invalid.');
  let consumed=0,text='';
  for await(const block of iterateRecordRows(db,store,{format:'xhandle-json-tree-v1',root:data},signal)){
   const chunk=String(block);if(consumed+chunk.length>offset)text+=chunk.slice(Math.max(0,offset-consumed),Math.max(0,end+1-consumed));consumed+=chunk.length;
   if(consumed>end)return {text:text.slice(0,length),hasMore:true};
  }return {text,hasMore:false};
 }
 return {text:'',hasMore:false};
}
