import {createHazardTokenValidator} from './hazardTokenValidator';
import {streamValue} from './archiveValueStream';
const identity={id:'run',projectId:'project',repoId:'repo'};
async function tokens(value){const output=[];for await(const token of streamValue(value))output.push(token);return output;}
async function validate(value){const validator=createHazardTokenValidator(identity);for(const token of await tokens(value))validator.add(token);validator.finish();}
test('validates structured run payloads without losing supported value types',async()=>{
 await validate({...identity,text:'😀'.repeat(20000),array:[null,undefined,NaN,Infinity,-Infinity,BigInt('123')],date:new Date('2026-10-25'),map:new Map([['key',new Set([true,2])]]),bytes:new Uint16Array([1,2,65535])});
});
test.each(['unknown','unbalanced','identity','duplicate identity','incomplete value','typed array length','invalid bytes','extra root'])('rejects malformed grammar: %s',async kind=>{
 let data=await tokens({...identity,payload:'large'});
 if(kind==='unknown')data.splice(2,0,['unknown-token']);
 if(kind==='unbalanced')data.pop();
 if(kind==='identity')data=await tokens({...identity,id:'wrong'});
 if(kind==='duplicate identity')data.splice(-1,0,['string'],['text','id'],['end'],['string'],['text','run'],['end']);
 if(kind==='incomplete value')data.splice(-1,0,['string'],['text','missing-value'],['end']);
 if(kind==='typed array length')data.splice(-1,0,['string'],['text','binary'],['end'],['binary','Uint16Array',''],['bytes',[1]],['end']);
 if(kind==='invalid bytes')data.splice(-1,0,['string'],['text','binary'],['end'],['binary','Uint8Array',''],['bytes',[256]],['end']);
 if(kind==='extra root')data.push(['object'],['end']);
 expect(()=>{const validator=createHazardTokenValidator(identity);data.forEach(t=>validator.add(t));validator.finish();}).toThrow(/Invalid streamed hazard/);
});
test('validates a long streamed string without retaining its contents',async()=>{
 const validator=createHazardTokenValidator(identity),data=await tokens(identity);data.pop();data.forEach(t=>validator.add(t));
 [['string'],['text','payload'],['end'],['string']].forEach(t=>validator.add(t));
 const piece='x'.repeat(8192);for(let i=0;i<16384;i++)validator.add(['text',piece]); // 128 MiB logical payload, one reusable page.
 validator.add(['end']);validator.add(['end']);validator.finish();
});
