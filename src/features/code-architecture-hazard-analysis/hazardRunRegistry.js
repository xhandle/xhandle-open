// Run lifetime belongs to the project/repository, not to the visible tab.
export function createHazardRunRegistry() {
 const runs=new Map(),versions=new Map();
 const bump=scope=>versions.set(scope,(versions.get(scope) || 0)+1);
 return {
  get:scope=>runs.get(scope),
  revision:scope=>versions.get(scope) || 0,
  start(scope){
   const existing=runs.get(scope);
   if(existing?.running)return null;
   const record={controller:new AbortController(),running:true,progress:{step:0,total:100,message:'Starting hazard analysis...'},run:null};
   bump(scope);runs.set(scope,record);return record;
  },
  finish(scope,record){
   if(runs.get(scope)!==record)return;
   bump(scope);record.running=false;
   record.controller.abort(); // Retire background storage work before another run starts.
   if(!record.run?.finalSavePending)runs.delete(scope);
  },
  retainScopes(scopes){
   for(const [scope,record] of runs)if(!scopes.has(scope)){record.controller.abort();runs.delete(scope);bump(scope);}
  },
  reconcileSave(run){
   for(const [scope,record] of runs){
    if(record.run?.id!==run?.id || record.run?.projectId!==run?.projectId || record.run?.repoId!==run?.repoId)continue;
    record.run=run;
    if(!record.running && !run.finalSavePending){runs.delete(scope);bump(scope);}
    return scope;
   }
   return null;
  },
  saved(scope,id){
   const record=runs.get(scope);
   if(record && !record.running && record.run?.id===id){runs.delete(scope);bump(scope);}
  },
  discard(scope){runs.get(scope)?.controller.abort();runs.delete(scope);bump(scope);},
  stop(scope){runs.get(scope)?.controller.abort();},
  close(){for(const record of runs.values())record.controller.abort();runs.clear();},
 };
}
