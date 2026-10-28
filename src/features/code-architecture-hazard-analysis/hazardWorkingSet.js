import { createValueAssembler } from '../code-architecture-transfer/archiveValueStream';
// Only these fields have no table/freshness/traceability consumers. All sheets,
// row IDs, preprocessing, context and partial-result metadata stay available.
export const WORKING_SET = '__xhandleHazardWorkingSet';
const deferred = new Set(['architectureRowsSnapshot', 'narrativeReviewInput']);
export const omitHazardField = (path, key, token) => deferred.has(key) && path.every(part => part === 'pendingAttempt') && !['value','undefined','number','bigint','date'].includes(token?.[0]);
export function workingSetAssembler(paths) {
  return createValueAssembler({omitField:omitHazardField,onOmit:path=>paths.push(path)});
}
export function compactHazardRun(run, paths = [], path = []) {
  if (!run || typeof run !== 'object') return run;
  const result = {...run};
  for (const key of deferred) if (Object.prototype.hasOwnProperty.call(result,key) && result[key] != null && ['object','string'].includes(typeof result[key])) {
    paths.push([...path,key]); delete result[key];
  }
  if (result.pendingAttempt) result.pendingAttempt=compactHazardRun(result.pendingAttempt,paths,[...path,'pendingAttempt']);
  return result;
}
export function hasDeferredHazardField(run, field) {
  return Boolean(field==='narrativeReviewInput' && run?.__xhandlePagedHazard?.narrative) || Boolean(run?.[field]) || Boolean(run?.[WORKING_SET]?.paths.some(path=>path.length===1 && path[0]===field));
}
// Merge ONLY the explicitly deferred fields; never replace edits with old data.
export function restoreDeferredHazardFields(working, complete) {
  const result={...working}; delete result[WORKING_SET];
  for (const path of working[WORKING_SET]?.paths || []) {
    let source=complete, target=result;
    for (let i=0;i<path.length-1;i++) {
      source=source?.[path[i]];
      if (!target?.[path[i]]) {target=null;break;}
      target[path[i]]={...target[path[i]]}; target=target[path[i]];
    }
    if(target && source && !Object.prototype.hasOwnProperty.call(target,path[path.length-1]))
      target[path[path.length-1]]=source[path[path.length-1]];
  }
  return result;
}
