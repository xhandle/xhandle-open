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
export function openHazardSchema() {
  let connection;
  return openDB(HAZARD_DB,HAZARD_DB_VERSION,{
    upgrade:upgradeHazardSchema,
    blocking(){connection?.close();},
    blocked(){/* The transfer opener supplies a bounded blocked-upgrade error. */},
  }).then(db=>{connection=db;return db;});
}
