import { openDB } from 'idb';
export const HAZARD_DB = 'xhandle-code-architecture-hazard-analysis';
export const HAZARD_DB_VERSION = 5;
export const HAZARD_CHUNKS = 'hazardRunChunks';
export const HAZARD_STAGING = 'hazardRunStaging';
const spec = indexes => ({keyPath:'id',autoIncrement:false,indexes:indexes.map(name=>({name,keyPath:name,unique:false,multiEntry:false}))});
export const HAZARD_SCHEMA = {
  hazardAnalysisRuns:spec(['projectId','repoId','architectureSnapshotHash','hazardMethod']),
  runMetadata:spec(['projectId','repoId']),
  generationCheckpoints:{keyPath:'id',autoIncrement:false,indexes:[{name:'scope',keyPath:'scope',unique:false,multiEntry:false}]},
  [HAZARD_CHUNKS]:spec(['runId','projectId']),
  [HAZARD_STAGING]:spec(['runId']),
};
export function newHazardStorageRevision() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
}
export function hazardMetadata(run) {
  const {id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt}=run;
  return {id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt};
}
export function upgradeHazardSchema(db,old,next,tx) {
  for(const [name,schema] of Object.entries(HAZARD_SCHEMA)){
    const store=db.objectStoreNames.contains(name)?tx.objectStore(name):db.createObjectStore(name,{keyPath:schema.keyPath});
    for(const index of schema.indexes)if(!store.indexNames.contains(index.name))store.createIndex(index.name,index.keyPath);
  }
  // Repair missing/stale metadata without hydrating any chunked payload.
  (async()=>{
    let cursor=await tx.objectStore('hazardAnalysisRuns').openCursor();
    while(cursor){await tx.objectStore('runMetadata').put(hazardMetadata(cursor.value));cursor=await cursor.continue();}
  })().catch(()=>tx.abort());
}
export function openHazardSchema({signal, timeoutMs = 10000} = {}) {
  return new Promise((resolve,reject)=>{
    let connection, finished=false;
    const finish=(error,db)=>{
      if(finished){db?.close();return;}
      finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(db);
    };
    const abort=()=>finish(new DOMException('Hazard loading cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Opening saved hazard storage timed out. Close other xHandle windows and retry.')),timeoutMs);
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    openDB(HAZARD_DB,HAZARD_DB_VERSION,{
      upgrade:upgradeHazardSchema,
      blocking(){connection?.close();},
      blocked(){/* The timeout keeps blocked upgrades from hanging restoration. */},
    }).then(db=>{connection=db;finish(null,db);},error=>finish(error));
  });
}
