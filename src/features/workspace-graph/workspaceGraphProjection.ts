import type { WorkspaceArtifact } from './workspaceGraphTypes';
const stop = new Set(['the','and','for','with','this','that','what','which','are','does','from','have','has','how','can','you','all','about','please','show','explain','summarize']);
export function queryTerms(value = '', limit = 24) {
  return [...new Set((String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length > 1 && word.length <= 128 && !stop.has(word)).map(word => word.length > 3 && word.endsWith('s') ? word.slice(0,-1) : word))].slice(0,limit);
}
export const scopedTerm = (projectId: string | null | undefined, term: string) => `${projectId == null ? '*' : encodeURIComponent(projectId)}|${term}`;
export function boundedValue(value: any, max = 900): any {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > max ? `${value.slice(0,max)}...` : value;
  // Bound traversal before serialization; source bodies can be hundreds of MB.
  let remaining=max, exceeded=false;
  const visit=(item: any,depth=0): any=>{
    if(remaining<=0||depth>12){exceeded=true;return '...';}
    if(item==null||typeof item!=='object'){const text=String(item??'');remaining-=text.length+4;if(remaining<0){exceeded=true;return text.slice(0,Math.max(0,text.length+remaining));}return item;}
    const out:any=Array.isArray(item)?[]:{};
    for(const key of Object.keys(item)){remaining-=key.length+4;if(remaining<0){exceeded=true;break;}Object.defineProperty(out,key,{value:visit(item[key],depth+1),enumerable:true});}
    return out;
  };
  const compact=visit(value);
  return exceeded ? JSON.stringify(compact).slice(0,max)+'...' : compact;
}
// Reject large legacy bodies before a read tool asks IndexedDB to clone them.
function readableBody(value:any){
 let bytes=0,visits=0;const seen=new WeakSet();
 const visit=(item:any,depth=0):boolean=>{
  if(++visits>16000||depth>32||bytes>1024*1024)return false;
  if(typeof item==='string'){bytes+=item.length*2+4;return bytes<=1024*1024;}
  if(item==null||typeof item!=='object'){bytes+=24;return true;}
  if(seen.has(item))return false;seen.add(item);
  for(const key in item)if(Object.prototype.hasOwnProperty.call(item,key)){bytes+=key.length*2+4;if(!visit(item[key],depth+1))return false;}
  return true;
 };
 const safe=visit(value);return {readableBody:safe,bodyReadBytes:safe?bytes:null};
}
export function projectArtifact(row: WorkspaceArtifact) {
  const structured=row.structuredData;
  const rawIndex=structured?._rowIndex ?? structured?.rowIndex ?? String(row.sourceId || '').match(/(?:responseRows|summary|Summary):(\d+)$/)?.[1];
  const rowIndex=rawIndex == null ? -1 : Number(rawIndex);
  const lookup=[row.id,row.sourceId,structured?.id,structured?.internalId,structured?.traceId].filter(Boolean).map(String);
  const text=[row.type,...(row.tags||[]),row.title,row.id,row.sourceId,structured?.id,structured?.internalId,row.status,boundedValue(row.summary,1200),boundedValue(row.content,1200),JSON.stringify(boundedValue(structured,1200))].filter(Boolean).join(' ');
  const terms=queryTerms(text,96);
  return {...row,...readableBody(row),fieldNames:(Array.isArray(structured?.columns)?structured.columns:structured&&typeof structured==='object'?Object.keys(structured):[]).filter((field:any)=>typeof field==='string').slice(0,32).map((field:string)=>field.slice(0,128)),repoId:structured?._repoId||structured?.repoId||null,runId:row.type==='code_architecture_hazard_row'?String(row.sourceId||'').split(':summary:')[0]:null,historical:String(row.sourceKey||'').includes(':history:'),title:String(row.title||'').slice(0,500),summary:boundedValue(row.summary,900),content:boundedValue(row.content,900),structuredData:boundedValue(structured,900),
    lookupKeys:lookup.flatMap(key=>[scopedTerm(null,key),scopedTerm(row.projectId||'',key)]),
    searchTerms:terms.flatMap(term=>[scopedTerm(null,term),scopedTerm(row.projectId||'',term)]),
    rowIndex:Number.isFinite(rowIndex)?rowIndex:-1,
  };
}
