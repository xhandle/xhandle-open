import {assertSingleQualityContext,unchangedQualityInput,qualitySourceCorpus} from './functionalQualityContract';
const context={id:'yard',scenario:'Shared lane',mode:'Teleoperated',conditions:'People can enter'};
test('requires one explicit context and preserves it in every STPA row',()=>{
  expect(()=>assertSingleQualityContext([])).toThrow('exactly one');
  expect(()=>assertSingleQualityContext([context,context])).toThrow('exactly one');
  expect(()=>assertSingleQualityContext([{id:'default'}])).toThrow('explicit');
  const row={operationalContextId:'yard',operationalScenario:context.scenario,operationalMode:context.mode,operatingConditions:context.conditions};
  expect(()=>assertSingleQualityContext([context],[row,row])).not.toThrow();
  expect(()=>assertSingleQualityContext([context],[row,{...row,operationalMode:'Autonomous'}])).toThrow('differs');
});
test('detects changes to source facts, labels, eligibility and traces without repairing them',()=>{
  for(const change of [row=>row.from='Renamed',row=>row.source.limit=30,row=>row.eligibility='Exclude',row=>row.traces.push('Added')]) {
    const rows=[{from:'Accept command',source:{limit:3},eligibility:'Include',traces:['original']}];
    const check=unchangedQualityInput(rows);check();change(rows[0]);expect(check).toThrow('changed');
  }
});
test('full source corpus deduplicates identical evidence and rejects conflicting revisions',()=>{
  const file={filePath:'guard.py',content:'LIMIT = 7\ndef guard(x): return x < LIMIT'};
  expect(qualitySourceCorpus([{codeEvidence:{files:[file,file]}}])).toEqual([file]);
  expect(()=>qualitySourceCorpus([{codeEvidence:{files:[file,{...file,content:'LIMIT = 9'}]}}])).toThrow('Conflicting');
});
