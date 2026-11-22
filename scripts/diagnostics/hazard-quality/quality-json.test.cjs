const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseQualityJson}=require('./quality-json.cjs');
test('preserves a single exact JSON judgment with prose or fences',()=>{
  const row=[{id:'A',claim:'An escaped " quote and ] brace',score:7}];
  for(const text of [JSON.stringify(row),'```json\n'+JSON.stringify(row)+'\n```','Explanation first.\n'+JSON.stringify(row)+'\nEnd.'])assert.deepEqual(parseQualityJson(text),row);
});
test('rejects multiple conflicting answers, missing data and truncation',()=>{
  for(const text of ['[{"score":4}]\nCorrection follows.\n[{"score":9}]','No answer.','[{"id":"A"','[{"id":"A"}'])assert.throws(()=>parseQualityJson(text),SyntaxError);
});
