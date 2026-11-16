const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inputsFromPrompt,respond}=require('./hazard-stress-provider.cjs');
test('extracts exact provider ids through nested evidence arrays',()=>{
 const rows=[{id:'FD-1',row:{guidePhrase:'Not providing'},evidence:{sources:['line 1','line 2']}},{id:'FD-3',row:{guidePhrase:'Too late'}}];
 assert.deepEqual(inputsFromPrompt('Example: ["x"]\nRows:\n'+JSON.stringify(rows)),rows);
 assert.deepEqual(respond('Rows:\n'+JSON.stringify(rows)).map(row=>row.id),['FD-1','FD-3']);
});
test('HARA fixture returns the event envelope and supported ratings without supplying ASIL',()=>{
 const result=respond('Perform the ISO 26262-3 HARA\nEvents:\n[{"id":"event-9"}]');
 assert.equal(result.assessments[0].id,'event-9');assert.equal(result.assessments[0].severity,'S3');assert.equal(result.assessments[0].asil,undefined);
});
test('unknown contracts and missing ids fail closed',()=>{
 assert.throws(()=>respond('An unsupported prompt'),/contract/);
 assert.throws(()=>respond('Rows: [{"evidence":"missing id"}]'),/exact source ID/);
});
test('screening and canonical catalogs use their distinct response schemas',()=>{
 assert.deepEqual(respond('First-pass screening\nRows: [{"id":"raw-1"}]').map(row=>({id:row.id,applicable:row.applicable})),[{id:'raw-1',applicable:'Yes'}]);
 const catalog=respond('Return ONLY one JSON object with arrays losses and hazards');assert.equal(catalog.losses[0].id,'L1');assert.equal(catalog.hazards[0].id,'H1');
});
