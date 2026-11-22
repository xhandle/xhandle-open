// These checks constrain the benchmark inputs; they never alter the source model.
export function assertSingleQualityContext(contexts,tableRows) {
  if(!Array.isArray(contexts) || contexts.length!==1 || !contexts[0]?.id ||
    !['scenario','mode','conditions'].every(field=>String(contexts[0][field] || '').trim())) {
    throw Error('Live STPA quality validation requires exactly one explicit operational context with scenario, mode and conditions.');
  }
  if(tableRows && (!tableRows.length || tableRows.some(row=>row.operationalContextId!==contexts[0].id ||
    row.operationalScenario!==contexts[0].scenario || row.operationalMode!==contexts[0].mode || row.operatingConditions!==contexts[0].conditions))) {
    throw Error('STPA input differs from the single explicit operational context.');
  }
}

export function unchangedQualityInput(value) {
  const before=JSON.stringify(value);
  return ()=>{if(JSON.stringify(value)!==before)throw Error('Frozen functional/source input changed during quality validation.');};
}

export function qualitySourceCorpus(rawRows) {
  const files=new Map();
  for(const row of rawRows)for(const file of row.codeEvidence?.files || []) {
    if(!file?.filePath || typeof file.content!=='string')continue;
    if(files.has(file.filePath) && files.get(file.filePath)!==file.content)throw Error('Conflicting source contents for '+file.filePath);
    files.set(file.filePath,file.content);
  }
  return [...files].sort(([a],[b])=>a.localeCompare(b)).map(([filePath,content])=>({filePath,content}));
}
