import {PAGED_HAZARD} from './hazardRowIndex';

export function hazardCsvTransferRun(run,forApply=false){
 if(!run || run[PAGED_HAZARD])return run;
 if(forApply){
  const snapshot={};
  for(const key of ['id','projectId','repoId','hazardMethod','architectureSnapshotHash','functionalModelSnapshotHash','analysisAbstraction','organizationProfileProvenance','operationalContexts','selectedOperationalContextId']){
   if(Object.prototype.hasOwnProperty.call(run,key))snapshot[key]=run[key];
  }
  snapshot.generatedSheets={Summary:run.generatedSheets?.Summary};return snapshot;
 }
 if(!Array.isArray(run.generatedSheets?.Summary?.[0]))return run;
 // This cache is always regenerated from Summary during CSV publication. It
 // can be many times larger than an unfinished draft's actual table. Retain
 // original evidence, other sheets, annotations and undo/preprocessing fields.
 const {summaryRows,...source}=run;return source;
}
