import {generateFastHazards} from './fastHazardPipeline';
import {resultsFirstPrompt} from './resultsFirstHazardPipeline';
import {answer} from './fastHazardTestFixtures';
import {COMMON_FIELDS,ASSESSMENT_FIELDS,deriveFastAsil,deriveFastSwci} from './fastHazardSchema';
const sources=n=>Array.from({length:n},(_,i)=>({id:`HA-${i+1}`,action:'Apply torque',phrase:'Too late',context:{mode:'Driving'},reviewedApplicability:'Yes',reviewedRationale:'Human decision'}));
const rows=p=>JSON.parse(p.split('\nRows: ')[1]);
const compact=(method,id)=>Object.fromEntries(['id','assessedAction',...COMMON_FIELDS,...ASSESSMENT_FIELDS[method]].map(field=>[field,answer(method,id)[field]]));
const cache=()=>{const data=new Map();return {read:async k=>data.get(JSON.stringify(k)),write:async(k,v)=>data.set(JSON.stringify(k),v)};};
test.each(['STPA','HARA','FHA'])('%s active path accepts actual table fields without narrative review or regeneration',async method=>{
 const request=jest.fn(async p=>rows(p).map(({id})=>compact(method,id))),reviewRequest=jest.fn(),applicabilityRequest=jest.fn();
 const result=await generateFastHazards({method,sources:sources(24),context:{organizationProfile:'Customer profile'},request,reviewRequest,applicabilityRequest});
 expect(result).toHaveLength(24);expect(request).toHaveBeenCalledTimes(3);
 expect(reviewRequest).not.toHaveBeenCalled();expect(applicabilityRequest).not.toHaveBeenCalled();
 expect(request.mock.calls.every(([p])=>p.includes('Customer profile'))).toBe(true);
 expect(result.every(row=>row.applicabilityRationale==='Human decision')).toBe(true);
 if(method==='HARA')expect(deriveFastAsil(result[0].severity,result[0].exposure,result[0].controllability)).toBe('ASIL D');
 if(method==='FHA')expect(deriveFastSwci(result[0].severity,result[0].scc)).toBe('SwCI 1');
});
test('missing cell retries only that row while valid rows are cached',async()=>{
 const checkpoint=cache(),request=jest.fn(async p=>rows(p).map(({id})=>({...compact('STPA',id),...(request.mock.calls.length===1 && id==='HA-2'?{verification:''}:{})})));
 const options={method:'STPA',sources:sources(6),context:{},checkpoint,request};
 expect(await generateFastHazards(options)).toHaveLength(6);
 expect(rows(request.mock.calls[1][0]).map(r=>r.id)).toEqual(['HA-2']);
 request.mockClear();await generateFastHazards(options);expect(request).not.toHaveBeenCalled();
});
test('invalid ratings get targeted structural retries',async()=>{
 const request=jest.fn(async p=>rows(p).map(({id})=>({...compact('HARA',id),severity:id==='HA-2'?'S9':'S3'})));
 await expect(generateFastHazards({method:'HARA',sources:sources(4),context:{},request})).rejects.toMatchObject({partialResults:expect.any(Array),findings:{'HA-2':['Invalid S/E/C rating']}});
 expect(request).toHaveBeenCalledTimes(3);expect(rows(request.mock.calls[2][0]).map(r=>r.id)).toEqual(['HA-2']);
});
test('native checkpoint aborts do not cancel generation and report unsaved work',async()=>{
 const error=new DOMException('Storage aborted','AbortError'),onStorageState=jest.fn();
 const checkpoint={read:async()=>undefined,write:jest.fn(async()=>{throw error;})};
 const result=await generateFastHazards({method:'STPA',sources:sources(12),context:{},checkpoint,onStorageState,request:async p=>rows(p).map(({id})=>compact('STPA',id))});
 expect(result).toHaveLength(12);expect(onStorageState).toHaveBeenCalledWith(expect.objectContaining({unsaved:true}));
 expect(checkpoint.write.mock.calls.length).toBeLessThanOrEqual(2);
});
test('transport failure preserves successful independent batches without fabricated rows',async()=>{
 const request=jest.fn(async p=>{if(rows(p)[0].id==='HA-9')throw new Error('Provider unavailable');return rows(p).map(({id})=>compact('STPA',id));});
 await expect(generateFastHazards({method:'STPA',sources:sources(16),context:{},request})).rejects.toMatchObject({partialResults:expect.arrayContaining([expect.objectContaining({id:'HA-1'})])});
 expect(request).toHaveBeenCalledTimes(2);
});
test('prompt omits mandatory narrative flags and preserves shared method contracts',()=>{
 const prompt=resultsFirstPrompt('STPA',sources(3),{});
 expect(prompt).not.toContain('executionDependency');expect(prompt).not.toContain('operatorContextQuote');
 expect(prompt).toContain('safetyConstraint');expect(prompt).toContain('softwareRequirement');
});
test('selected Haiku uses 16-row table batches and no mandatory review calls',async()=>{
 const {storeAIProviderModelPreference}=require('../../lib/aiProviderConfig');
 localStorage.setItem('xhandle.aiProvider.active','anthropic');storeAIProviderModelPreference('anthropic','claude-haiku-5-5');
 try{
  const request=jest.fn(async p=>rows(p).map(({id})=>compact('STPA',id))),onMetrics=jest.fn();
  await generateFastHazards({method:'STPA',sources:sources(32),context:{},request,onMetrics});
  expect(request).toHaveBeenCalledTimes(2);expect(rows(request.mock.calls[0][0])).toHaveLength(16);
  expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({review:{requests:0}}));
 }finally{localStorage.clear();}
});
