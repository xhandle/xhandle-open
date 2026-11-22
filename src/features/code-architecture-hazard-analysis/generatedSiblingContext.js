// Generated cases are comparison material, never additions to source truth.
const familyKey=source=>JSON.stringify([source.from,source.action,source.to,source.details,source.context,source.lifecycle,source.interfaceType,source.allocation]);
export function withGeneratedCaseFamilies(context,sources,results) {
  const families={};
  for(const source of sources) {
    const row=results.get(source.id);if(!row)continue;
    (families[familyKey(source)] ||= []).push({id:source.id,phrase:source.phrase,applicable:row.applicable,uca:row.uca,causalScenario:row.causalScenario});
  }
  return {...context,generatedCaseFamilies:families};
}
export function relatedGeneratedContext(context,sources) {
  if(!context?.generatedCaseFamilies)return context;
  const {generatedCaseFamilies,...original}=context;
  const cases=new Map();
  for(const source of sources)for(const row of generatedCaseFamilies[familyKey(source)] || [])cases.set(row.id,row);
  return {...original,relatedGuidePhraseCases:[...cases.values()],relatedCaseFieldCoverage:['id','phrase','applicable','uca','causalScenario']};
}
export function groupRelatedCorrections(entries,maxRows=8) {
  const groups=new Map();
  for(const entry of entries){const key=familyKey(entry.source);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
  return [...groups.values()].flatMap(group=>{
    const batches=[];for(let offset=0;offset<group.length;offset+=maxRows)batches.push(group.slice(offset,offset+maxRows));return batches;
  });
}
