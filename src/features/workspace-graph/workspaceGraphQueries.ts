import { openWorkspaceGraphDB } from './workspaceGraphDb';
import { projectArtifact, queryTerms, scopedTerm } from './workspaceGraphProjection';
import type { WorkspaceArtifact } from './workspaceGraphTypes';
import {waitForForegroundStorage} from '../../lib/foregroundStoragePriority';
const check=(signal?: AbortSignal)=>{if(signal?.aborted)throw signal.reason || new DOMException('Workspace query cancelled.','AbortError');};
export const yieldIndexWork=async(signal?:AbortSignal)=>{
 await new Promise<void>(resolve=>setTimeout(resolve,0));
 await waitForForegroundStorage(signal);
};

export async function ensureWorkspaceProjection(signal?: AbortSignal, projectIds?:string[]) {
  const db=await openWorkspaceGraphDB();
  try {
    if(projectIds?.length){
      // Source upserts already maintain their projections. Only repair missing
      // legacy projections in the requested project; never clear the global
      // index as a prerequisite for answering one project's question.
      for(const projectId of projectIds){
        check(signal);
        const complete=await db.get('workspaces','artifact-projection-project:'+projectId);
        if(complete?.complete&&await db.countFromIndex('artifacts','by_project',projectId)===await db.countFromIndex('artifactIndex','by_project',projectId))continue;
        let after:IDBValidKey|undefined;
        while(true){
        // Release storage between small batches. Never await the priority gate
        // inside a transaction, which would keep competing reads blocked.
        await yieldIndexWork(signal);check(signal);
        const tx=db.transaction(['artifacts','artifactIndex'],'readwrite');
        const abort=()=>{try{tx.abort();}catch{}};
        signal?.addEventListener('abort',abort,{once:true});tx.done.catch(()=>{});
        try{
          let cursor=await tx.objectStore('artifacts').index('by_project').openKeyCursor(projectId);
          if(cursor && after!==undefined){
            if(indexedDB.cmp(cursor.primaryKey,after)<0)cursor=await cursor.continuePrimaryKey(projectId,after);
            if(cursor && indexedDB.cmp(cursor.primaryKey,after)===0)cursor=await cursor.continue();
          }
          let visited=0;
          while(cursor && visited<64){
            check(signal);
            const meta=await tx.objectStore('artifactIndex').get(cursor.primaryKey);
            if(!meta||typeof meta.readableBody!=='boolean'){
              const row=await tx.objectStore('artifacts').get(cursor.primaryKey);
              if(row)await tx.objectStore('artifactIndex').put(projectArtifact(row));
            }
            after=cursor.primaryKey;visited++;
            cursor=await cursor.continue();
          }
          await tx.done;
          if(!cursor)break;
        }finally{signal?.removeEventListener('abort',abort);}
        }
        await db.put('workspaces',{id:'artifact-projection-project:'+projectId,complete:true});
      }
      return;
    }
    const state=await db.get('workspaces','artifact-projection-v1');
    if(state?.complete && await db.count('artifacts')===await db.count('artifactIndex')){
      const hints=await db.get('workspaces','artifact-read-hints-v1');
      if(hints?.complete)return;
      let after:IDBValidKey|undefined;
      while(true){
        check(signal);const rows=await db.getAll('artifactIndex',after===undefined?undefined:IDBKeyRange.lowerBound(after,true),64);
        if(!rows.length)break;
        for(const meta of rows)if(typeof meta.readableBody!=='boolean'){
          check(signal);const row=await db.get('artifacts',meta.id);if(row)await db.put('artifactIndex',projectArtifact(row));
        }
        after=rows[rows.length-1].id;await yieldIndexWork(signal);
      }
      await db.put('workspaces',{id:'artifact-read-hints-v1',complete:true});return;
    }
    // Old graph bodies are read a bounded page at a time, never all at once.
    // Restart after interruption is idempotent; queries wait for this repair.
    await db.clear('artifactIndex');
    let after:IDBValidKey|undefined;
    while(true){
      check(signal);
      const rows=await db.getAll('artifacts',after===undefined?undefined:IDBKeyRange.lowerBound(after,true),64);
      if(!rows.length)break;
      const tx=db.transaction('artifactIndex','readwrite');
      await Promise.all(rows.map(row=>tx.store.put(projectArtifact(row))));await tx.done;
      after=rows[rows.length-1].id;
      await yieldIndexWork(signal);
    }
    await db.put('workspaces',{id:'artifact-projection-v1',complete:true});
    await db.put('workspaces',{id:'artifact-read-hints-v1',complete:true});
  }finally{db.close();}
}

async function indexRows(db:any,indexName:string,key:any,limit:number,signal?:AbortSignal,direction:IDBCursorDirection='next') {
  check(signal);const tx=db.transaction('artifactIndex');tx.done.catch(()=>{});
  const abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});
  try{
    const rows:any[]=[];let cursor=await tx.store.index(indexName).openCursor(key,direction);
    while(cursor&&rows.length<limit){check(signal);rows.push(cursor.value);cursor=await cursor.continue();}
    await tx.done;return {rows,truncated:Boolean(cursor)};
  }finally{signal?.removeEventListener('abort',abort);}
}
function recentRange(projectId:string,type?:string){return IDBKeyRange.bound(type?[projectId,type,'']:[projectId,''],type?[projectId,type,'\uffff','\uffff']:[projectId,'\uffff','\uffff']);}
const selectionTypes:Record<string,string[]>={
 'functional-decomposition':['functional_decomposition_row'], 'hazard-analysis':['hazard_analysis_row'],
 'code-architecture-functional-decomposition':['code_architecture_edge'], 'code-architecture-hazard-analysis':['code_architecture_hazard_row'],
};
export async function queryWorkspaceCandidates(query='',{projectId=null,types=null,limit=96,activeView=null,signal}:{projectId?:string|null;types?:Set<string>|null;limit?:number;activeView?:any;signal?:AbortSignal}={}) {
  const db=await openWorkspaceGraphDB();
  try {
    const candidates=new Map<string,any>();let truncated=false;
    const add=(rows:any[])=>rows.forEach(row=>{if((!types||types.has(row.type))&&(!projectId||!row.projectId||row.projectId===projectId))candidates.set(row.id,row);});
    const terms=queryTerms(query).sort((a,b)=>Number(/\d/.test(b))-Number(/\d/.test(a))||b.length-a.length);
    for(const term of terms){
      const prefix=scopedTerm(projectId,term);
      const page=await indexRows(db,'by_terms',IDBKeyRange.bound(prefix,prefix+'\uffff'),Math.max(64,limit*2),signal);
      add(page.rows);truncated ||= page.truncated;
      if(candidates.size>=limit*2){truncated=true;break;}
    }
    // A small recent fallback also supplies context when query wording has no hit.
    for(const type of types?.size?[...types]:[undefined]){
      const page=projectId
        ? await indexRows(db,type?'by_project_type_updated':'by_project_updated',recentRange(projectId,type),Math.min(limit,36),signal,'prev')
        : await indexRows(db,type?'by_type':'by_updated',type,Math.min(limit,96),signal,'prev');
      add(page.rows);truncated ||= page.truncated;
    }
    // Resolve selected rows independently of relevance/recency, including distant rows.
    const selected=new Map<string,any>();
    for(const selection of (activeView?.activeSelections||[]).slice(0,8)){
      const ids=[selection.id,selection.primary?.rowId,...(selection.selectedRows||[]).slice(0,8).map((row:any)=>row.rowId)].filter(Boolean);
      for(const id of ids){const found=await indexRows(db,'by_lookup',scopedTerm(projectId,id),8,signal);found.rows.forEach(row=>selected.set(row.id,row));}
      const indexes=[...(selection.selectedRows||[]),...(selection.selectedCells||[])].map((row:any)=>Number(row.rowIndex)).filter((i:number)=>Number.isInteger(i)&&i>=0).slice(0,16);
      if(projectId)for(const type of selectionTypes[selection.tableId]||[])for(const index of indexes){
        const found=await indexRows(db,'by_row',[projectId,type,index],8,signal);found.rows.forEach(row=>selected.set(row.id,row));
      }
    }
    const score=(row:any)=>{const text=[row.title,row.id,row.sourceId,...(row.lookupKeys||[]),row.summary,row.content,JSON.stringify(row.structuredData),row.type].join(' ').toLowerCase();return terms.reduce((n,term)=>n+Number(text.includes(term)),0);};
    const ranked=[...candidates.values()].sort((a,b)=>score(b)-score(a)||String(b.updatedAt).localeCompare(String(a.updatedAt))||a.id.localeCompare(b.id));
    const output=new Map<string,any>();add([...selected.values()]);
    for(const row of [...selected.values(),...ranked])if(!types||types.has(row.type))output.set(row.id,row);
    const rows=[...output.values()].slice(0,limit);
    // Logical cleanup can remove canonical rows without using repository writers.
    // Verify keys only; a normal question never hydrates their full bodies.
    const existing=await Promise.all(rows.map(row=>db.getKey('artifacts',row.id)));
    check(signal);
    return {rows:rows.filter((_,i)=>existing[i]!==undefined) as WorkspaceArtifact[],truncated:truncated||output.size>limit};
  }finally{db.close();}
}

export async function workspaceGraphCounts(projectId?:string|null) {
  const db=await openWorkspaceGraphDB();
  try{return {
    projectCount:await db.count('projects'),
    artifactCount:projectId?await db.countFromIndex('artifacts','by_project',projectId):await db.count('artifacts'),
    relationshipCount:projectId?await db.countFromIndex('relationships','by_project',projectId):await db.count('relationships'),
  };}finally{db.close();}
}

export async function relationshipsForArtifacts(ids:string[],{limit=100,signal}:{limit?:number;signal?:AbortSignal}={}) {
  const db=await openWorkspaceGraphDB();const found=new Map<string,any>();
  try{
    for(const id of ids){
      check(signal);
      for(const index of ['by_from','by_to']){
        const rows=await db.getAllFromIndex('relationships',index as any,id,Math.max(0,limit-found.size));
        rows.forEach(row=>found.set(row.id,row));
        if(found.size>=limit)return [...found.values()].slice(0,limit);
      }
    }
    return [...found.values()];
  }finally{db.close();}
}
