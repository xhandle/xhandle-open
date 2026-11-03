const active=new Set();
export const hazardCsvScope=(projectId,repoId)=>JSON.stringify([String(projectId),String(repoId)]);
export const isHazardCsvImportBusy=(projectId,repoId)=>active.has(hazardCsvScope(projectId,repoId));
export const setHazardCsvImportBusy=(scope,busy)=>{if(busy)active.add(scope);else active.delete(scope);};
