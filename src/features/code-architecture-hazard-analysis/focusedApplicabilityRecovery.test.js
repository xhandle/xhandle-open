import {screenFastApplicability} from './fastHazardApplicability';
import {generateFastHazards} from './resultsFirstHazardPipeline';
import {hazardPromptBytes} from './fastHazardBudgets';
const rows=p=>JSON.parse(p.split('\nRows: ')[1]);
const source={id:'HA-1',from:'Planner',action:'Set speed',to:'Controller',details:'Commands operating state',context:{scenario:'Unattended'},phrase:'Too late'};
const missing=p=>rows(p).map(({id})=>({id,needsEvidence:true,rationale:'Need the deadline specification'}));
const no=p=>rows(p).map(({id})=>({id,applicable:'No',rationale:'No meaningful deviation in this scenario'}));
const cache=()=>{const data=new Map();return {read:async k=>data.get(JSON.stringify(k)),write:async(k,v)=>data.set(JSON.stringify(k),v)};};
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
test.each(['STPA','HARA','FHA'])('%s unresolved evidence takes two calls, survives Continue, and invalidates on context changes',async method=>{
 const checkpoint=cache(),request=jest.fn(),applicabilityRequest=jest.fn(async p=>missing(p));
 const options={method,sources:[source],context:{organizationProfile:'A'},checkpoint,request,applicabilityRequest,...quiet};
 await expect(generateFastHazards(options)).rejects.toMatchObject({findings:{'HA-1':[expect.stringContaining('deadline specification')]}});
 expect(applicabilityRequest).toHaveBeenCalledTimes(2);expect(request).not.toHaveBeenCalled();
 expect(applicabilityRequest.mock.calls[1][0]).toContain('Need the deadline specification');
 await expect(generateFastHazards(options)).rejects.toThrow('need additional applicability information');
 expect(applicabilityRequest).toHaveBeenCalledTimes(2);
 await expect(generateFastHazards({...options,context:{organizationProfile:'B'}})).rejects.toThrow();
 expect(applicabilityRequest).toHaveBeenCalledTimes(4);
 applicabilityRequest.mockImplementation(async p=>no(p));
 expect(await generateFastHazards({...options,sources:[{...source,evidence:'New specification'}]})).toHaveLength(1);
 expect(applicabilityRequest).toHaveBeenCalledTimes(5);
 const reviewed=await generateFastHazards({...options,sources:[{...source,reviewedApplicability:'No'}]});
 expect(reviewed[0].applicable).toBe('No');expect(applicabilityRequest).toHaveBeenCalledTimes(5);
});
test('evidence follows all compact batches and phrases share one evidence decision without merging different evidence',async()=>{
 const sources=[{...source,evidence:'A'},{...source,id:'HA-2',phrase:'Too early',evidence:'A'},{...source,id:'HA-3',evidence:'B'}];
 const request=jest.fn(async(p,o)=>o.screeningMode==='compact'?missing(p):no(p));
 await screenFastApplicability({method:'STPA',sources,context:{},request,maxBatchRows:1});
 expect(request.mock.calls.map(([,o])=>o.screeningMode)).toEqual(['compact','compact','compact','evidence','evidence']);
 expect(request.mock.calls.slice(3).map(([p])=>rows(p).length)).toEqual([2,1]);
});
test('153KB singleton evidence is focused and summarized before the decision, with all requests below 60KB',async()=>{
 const request=jest.fn(async(p,o)=>{
  expect(hazardPromptBytes(p)).toBeLessThanOrEqual(60000);
  if(p.includes('Evidence pieces: ')){
   expect(p).toContain('Need the deadline specification');
   const refs=JSON.parse(p.split('Evidence pieces: ')[1]).map(x=>x.ref);
   return {coveredRefs:refs,facts:[],constraints:[],safeguards:[],conflicts:[],unknowns:[{text:'Deadline not supplied in these pieces',refs}]};
  }
  if(o.screeningMode==='compact')return missing(p);
  expect(p).toContain('Evidence summaries:');return no(p);
 });
 const result=await screenFastApplicability({method:'STPA',sources:[{...source,evidence:'x'.repeat(153000)}],context:{},request});
 expect(result.get('HA-1').applicable).toBe('No');
 expect(request.mock.calls.filter(([p])=>p.includes('Rows: '))).toHaveLength(2);
});
test('structural retry reports duplicate IDs without increasing the output budget',async()=>{
 const request=jest.fn(async(p,o)=>{
  expect(o.maxTokens).toBe(8000);
  if(request.mock.calls.length===1)return [...no(p),...no(p)];
  expect(p).toContain('duplicate-id');return no(p);
 });
 expect((await screenFastApplicability({method:'STPA',sources:[source],context:{},request})).size).toBe(1);
 expect(request).toHaveBeenCalledTimes(2);
});
test('pending information does not prevent independent excluded rows from being retained',async()=>{
 const request=jest.fn(async p=>rows(p).map(({id})=>id==='HA-1'?{id,needsEvidence:true,rationale:'Missing deadline'}:{id,applicable:'No',rationale:'No meaningful deviation'}));
 await expect(generateFastHazards({method:'STPA',sources:[source,{...source,id:'HA-2'}],context:{},applicabilityRequest:request,...quiet})).rejects.toMatchObject({partialResults:[{id:'HA-2',applicable:'No'}]});
 expect(request).toHaveBeenCalledTimes(2);
});
test('oversized compact inputs and extraction share the three-request ceiling',async()=>{
 let active=0,peak=0;
 const request=jest.fn(async p=>{
  peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;
  if(p.includes('Evidence pieces: ')){
   const refs=JSON.parse(p.split('Evidence pieces: ')[1]).map(x=>x.ref);
   return {coveredRefs:refs,facts:[{text:'An operating command',refs}],constraints:[],safeguards:[],conflicts:[],unknowns:[]};
  }
  return no(p);
 });
 const sources=Array.from({length:4},(_,i)=>({...source,id:`HA-${i}`,details:`${i}:`+'x'.repeat(65000)}));
 const result=await generateFastHazards({method:'STPA',sources,context:{},request,applicabilityRequest:request,...quiet});
 expect(result).toHaveLength(4);expect(peak).toBeLessThanOrEqual(3);
});
test('Stop during evidence extraction does not create a persistent information-needed decision',async()=>{
 const controller=new AbortController(),checkpoint=cache(),onDeferred=jest.fn();
 const request=jest.fn(async(p,o)=>{
  if(o.screeningMode==='compact')return missing(p);
  controller.abort();throw new DOMException('Stopped','AbortError');
 });
 const options={method:'STPA',sources:[{...source,evidence:'x'.repeat(153000)}],context:{},request,checkpoint,onDeferred};
 await expect(screenFastApplicability({...options,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
 expect(onDeferred).not.toHaveBeenCalled();
 request.mockImplementation(async p=>no(p));
 expect((await screenFastApplicability(options)).size).toBe(1);
});
