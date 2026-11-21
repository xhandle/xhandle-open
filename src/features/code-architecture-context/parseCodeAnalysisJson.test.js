import parse from './parseCodeAnalysisJson';
const value = {relationships:[],unresolved:[]}, json = JSON.stringify(value);
test.each([
  json, '\ufeff '+json+' \n', '```json\n'+json+'\n```', '```json '+json+'```',
  '```JSON\r\n'+json+'\r\n```', '~~~json\n'+json+'\n~~~',
  'Connections:\n```json\n'+json+'\n```\nReview required.',
  '```json\n'+json+'\n```\nReview required.', '````json\n'+json+'\n````',
])('parses a complete response wrapped as %s', response=>expect(parse(response)).toEqual(value));
test('preserves already decoded values and literal fences inside JSON strings',()=>{
 expect(parse(value)).toBe(value);
 const quoted={message:'literal ```json and braces { }'};
 expect(parse(JSON.stringify(quoted))).toEqual(quoted);
 expect(parse('```json\n'+JSON.stringify(quoted)+'\n```')).toEqual(quoted);
});
test.each([
 '', '```json\n{"relationships":[', '```json\n'+json, '```json\n{"a":1,}\n```',
 '```json\n'+json+'\n```\n```json\n'+json+'\n```', json+'\n'+json,
 'Some prose '+json+' trailing prose', '```javascript\n'+json+'\n```',
 '```json\n'+json+'\n```\n```json\n{"truncated":',
])('rejects ambiguous or incomplete response without exposing source text: %s', response=>{
 expect(()=>parse(response)).toThrow('one complete valid JSON value');
});
