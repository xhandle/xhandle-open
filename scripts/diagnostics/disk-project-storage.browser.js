// Runs only in a fresh Playwright context on an isolated origin.
import {openHazardSchema,hazardMetadata,HAZARD_CHUNKS,HAZARD_STAGING} from '../../src/features/code-architecture-hazard-analysis/hazardSchema';
import {stageHazardRun,publishHazardRun,hydrateHazardRun} from '../../src/features/code-architecture-hazard-analysis/hazardRunChunks';
export async function checkStorage(){
 const db=await openHazardSchema(),run={id:'isolated',projectId:'p',repoId:'r',status:'partial',evidence:'x'.repeat(2*1024*1024)};
 const assert=(test,message)=>{if(!test)throw Error(message);};let pages;
 for(let revision=0;revision<3;revision++){
  const staged=await stageHazardRun(db,{...run,revision});await publishHazardRun(db,staged,hazardMetadata(staged));
  const count=await db.count(HAZARD_CHUNKS);if(pages===undefined)pages=count;assert(count===pages,'Obsolete generations retained');
 }
 const old=await db.get('hazardAnalysisRuns',run.id),next=await stageHazardRun(db,{...run,revision:3});let writer;
 const reader={transaction:(...args)=>{
  const tx=db.transaction(...args);
  return {done:tx.done,abort:()=>tx.abort(),objectStore:name=>{
   const store=tx.objectStore(name);return {get:async key=>{const value=await store.get(key);if(name===HAZARD_CHUNKS&&!writer)writer=publishHazardRun(db,next,hazardMetadata(next));return value;}};
  }};
 }};
 const before=await hydrateHazardRun(reader,old);assert(before.revision===2 && before.evidence===run.evidence,'Reader snapshot changed');await writer;
 const after=await hydrateHazardRun(db,next);assert(after.revision===3 && after.evidence===run.evidence,'Replacement was not readable');
 assert(await db.count(HAZARD_CHUNKS)===pages,'Replacement leaked pages');assert(await db.count(HAZARD_STAGING)===0,'Staging lease leaked');
 let checks=0,cancelled=false;
 try{await stageHazardRun(db,{...run,revision:4},()=>{if(++checks===4)throw Error('cancelled');});}catch(error){cancelled=error.message==='cancelled';}
 assert(cancelled,'Cancellation did not stop staging');assert(await db.count(HAZARD_CHUNKS)===pages,'Cancelled pages leaked');assert(await db.count(HAZARD_STAGING)===0,'Cancelled lease leaked');
 db.close();return {pages,snapshot:true,replacements:3,cancellation:true};
}
