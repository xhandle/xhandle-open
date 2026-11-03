import {prepareHazardCsvImport,applyHazardCsvImport,discardHazardCsvImport} from './hazardCsvImport';

export function createHazardCsvWorkerEndpoint(post){
 let controller,tail=Promise.resolve(),sessionId;
 return ({data})=>{
  if(data.operation==='cancel'){controller?.abort();return;}
  tail=tail.catch(()=>{}).then(async()=>{
   controller=new AbortController();let last=0,lastPhase='',committed;
   const onProgress=progress=>{const now=Date.now();if(progress.phase!==lastPhase || now-last>=100){last=now;lastPhase=progress.phase;post({id:data.id,type:'progress',progress});}};
   try{
    let result;
    if(data.operation==='prepare'){result=await prepareHazardCsvImport({...data.args,signal:controller.signal,onProgress});sessionId=result.sessionId;}
    else if(data.operation==='apply'){
     // Record durability immediately for cancellation, but do not trigger table
     // reloads while large temporary-store deletions still hold database locks.
     result=await applyHazardCsvImport(sessionId,{...data.args,signal:controller.signal,onProgress,onCommitted:result=>{committed=result;post({id:data.id,type:'committed',result});onProgress({phase:'Finishing saved import',completed:0,total:0});}});sessionId=null;
    }else if(data.operation==='discard'){if(sessionId)await discardHazardCsvImport(sessionId);sessionId=null;result={};}
    else throw Error('Unknown CSV import operation.');
    post({id:data.id,type:'result',result});
   }catch(error){if(committed)post({id:data.id,type:'result',result:committed});else post({id:data.id,type:'error',message:error.message||'CSV import failed.',name:error.name});}
   finally{controller=null;}
  });
 };
}
