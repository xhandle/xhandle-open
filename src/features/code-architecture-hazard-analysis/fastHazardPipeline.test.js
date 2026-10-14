// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
jest.mock('./fastHazardSemanticReview',()=>({createReviewBatchPolicy:()=>({rows:24,chars:60000,successes:0,epoch:0}),reviewFastHazards:async ({entries})=>Object.fromEntries(entries.map(({source})=>[source.id,[]]))}));
import {generateReviewedFastHazards as generateFastHazards,fastHazardPrompt} from './fastHazardPipeline';
import {deriveFastAsil,deriveFastSwci,validateFastAssessment} from './fastHazardSchema';

import {answer} from './fastHazardTestFixtures';

const sources=count=>Array.from({length:count},(_,i)=>({id:`HA-${i+1}`,from:'Planner',action:'Apply torque',to:'Actuator',phrase:'Too late',context:{mode:'Driving'}}));
const ids=prompt=>JSON.parse(prompt.split('\nRows: ')[1]).map(row=>row.id);
const cache=()=>{const values=new Map();return {read:async k=>values.get(JSON.stringify(k)),write:async(k,v)=>values.set(JSON.stringify(k),v)};};

test.each(['STPA','HARA','FHA'])('%s assesses 96 rows in output-bounded batches, then reuses all scoped results',async method=>{
 const checkpoint=cache(),progress=jest.fn();
 const request=jest.fn(async p=>ids(p).map(id=>answer(method,id)));
 const options={method,sources:sources(96),context:{organizationProfile:'Use profile A'},checkpoint,request,onProgress:progress};
 expect(await generateFastHazards(options)).toHaveLength(96);
 expect(request.mock.calls.length).toBeLessThanOrEqual(20);
 expect(request.mock.calls.every(([p])=>ids(p).length<=16)).toBe(true);
 expect(request.mock.calls.every(([p])=>p.includes('Use profile A'))).toBe(true);
 expect(progress.mock.calls.at(-1)[0]).toMatchObject({step:95,total:100,completed:96});
 request.mockClear();await generateFastHazards(options);expect(request).not.toHaveBeenCalled();
 await generateFastHazards({...options,context:{organizationProfile:'Use profile B'}});expect(request.mock.calls.length).toBeLessThanOrEqual(20);
 expect(request.mock.calls.every(([p])=>ids(p).length<=16)).toBe(true);
});
test('retains valid rows from partial responses and retries only invalid/missing rows',async()=>{
 const calls=[];const request=async p=>{const current=ids(p);calls.push(current);return calls.length===1?[answer('STPA',current[0])]:current.map(id=>answer('STPA',id));};
 expect(await generateFastHazards({method:'STPA',sources:sources(4),context:{},request})).toHaveLength(4);
 expect(calls.slice(1).flat()).not.toContain('HA-1');
});
test('reviewed No bypasses model; reviewed Yes survives hostile response through correction',async()=>{
 const rows=sources(2);rows[0].reviewedApplicability='No';rows[1].reviewedApplicability='Yes';
 const request=jest.fn(async p=>ids(p).map(id=>({...answer('STPA',id),applicable:request.mock.calls.length===1?'No':'Yes'})));
 const result=await generateFastHazards({method:'STPA',sources:rows,context:{},request});
 expect(result.map(r=>r.applicable)).toEqual(['No','Yes']);
 expect(request.mock.calls.every(([p])=>!ids(p).includes('HA-1'))).toBe(true);
});
test('cancelled requests do not save results or start more requests',async()=>{
 const controller=new AbortController(),checkpoint={read:jest.fn(),write:jest.fn()};
 await expect(generateFastHazards({method:'STPA',sources:sources(1),context:{},checkpoint,signal:controller.signal,
   request:async()=>{controller.abort();return [answer('STPA','HA-1')];}})).rejects.toHaveProperty('name','AbortError');
 expect(checkpoint.write).not.toHaveBeenCalled();
});
test('persistent malformed output stops after bounded correction, never claims completion',async()=>{
 const request=jest.fn().mockResolvedValue('{}'),progress=jest.fn();
 await expect(generateFastHazards({method:'STPA',sources:sources(1),context:{},request,onProgress:progress})).rejects.toHaveProperty('code','COMPACT_HAZARD_INCOMPLETE');
 expect(request).toHaveBeenCalledTimes(3);expect(progress.mock.calls.every(([p])=>p.step<100)).toBe(true);
});
test('truncation reduces batch size to a successful singleton without losing coverage',async()=>{
 const request=jest.fn(async p=>{const current=ids(p);return current.length>1?'[{':current.map(id=>answer('STPA',id));});
 expect(await generateFastHazards({method:'STPA',sources:sources(8),context:{},request})).toHaveLength(8);
 expect(request.mock.calls.length).toBeLessThanOrEqual(15);
});
test('provider outages stop without splitting into more requests',async()=>{
 const request=jest.fn().mockRejectedValue(new Error('LLM proxy error (503)'));
 await expect(generateFastHazards({method:'STPA',sources:sources(8),context:{},request})).rejects.toThrow('503');
 expect(request.mock.calls.length).toBeLessThanOrEqual(2); // initial batches only; no retry/split
});
test('standard ratings are derived deterministically and invalid ratings rejected',()=>{
 expect(deriveFastAsil('S3','E4','C3')).toBe('ASIL D');
 expect(deriveFastAsil('S3','E3','C3')).toBe('ASIL C');
 expect(deriveFastAsil('S1','E1','C1')).toBe('QM');
 expect(deriveFastAsil('S0','E4','C3')).toBe('QM');
 expect(deriveFastAsil('S9','E4','C3')).toBeNull();
 expect(deriveFastSwci('I','1')).toBe('SwCI 1');expect(deriveFastSwci('IV','5')).toBe('SwCI 5');
 expect(validateFastAssessment('HARA',{...answer('HARA','a'),severity:'Unknown'},{id:'a'}).length).toBeGreaterThan(0);
});
test('all positive HARA combinations and FHA matrix entries agree with the reference tables',()=>{
 // TI SPRADF6A Table 3-2 (C1,C2,C3 columns); local legacy MIL-STD-882E matrix.
 const asil=[
   [['QM','QM','QM'],['QM','QM','QM'],['QM','QM','ASIL A'],['QM','ASIL A','ASIL B']],
   [['QM','QM','QM'],['QM','QM','ASIL A'],['QM','ASIL A','ASIL B'],['ASIL A','ASIL B','ASIL C']],
   [['QM','QM','ASIL A'],['QM','ASIL A','ASIL B'],['ASIL A','ASIL B','ASIL C'],['ASIL B','ASIL C','ASIL D']],
 ];
 asil.forEach((exposures,s)=>exposures.forEach((controls,e)=>controls.forEach((expected,c)=>expect(deriveFastAsil(`S${s+1}`,`E${e+1}`,`C${c+1}`)).toBe(expected))));
 [[1,1,3,4],[1,2,3,4],[2,3,4,4],[3,4,4,4],[5,5,5,5]].forEach((severities,scc)=>severities.forEach((expected,severity)=>expect(deriveFastSwci(['I','II','III','IV'][severity],String(scc+1))).toBe(`SwCI ${expected}`)));
});
test('prompt deduplicates interface facts without omitting phrase coverage',()=>{
 const prompt=fastHazardPrompt('STPA',sources(7),{organizationProfile:'Calibration'});
 expect(ids(prompt)).toHaveLength(7);
 expect(prompt.match(/"action":"Apply torque"/g)).toHaveLength(1);
});
