import {fetchLLMResponse} from '../../components/aiAnalysisSTPA';
import {generateFastHazards} from './resultsFirstHazardPipeline';
import {validateFastAssessment} from './fastHazardSchema';
const source={id:'HA-1',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Reviewed timing condition'};
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;jest.useRealTimers();});
const requestFor=signal=>(prompt,options)=>fetchLLMResponse(prompt,{},[],'',{...options,workflow:'hazard-row-generation',signal});

test('opt-in quality callers reject truncated JSON even when the partial text parses',async()=>{
 global.fetch=jest.fn(async()=>({ok:true,status:200,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"rows":[]}'}}]})}));
 await expect(fetchLLMResponse('audit',{},[],'',{workflow:'quality-row-review',requireCompleteOutput:true,throwOnError:true})).rejects.toMatchObject({name:'TruncatedResponseError'});
 expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('settings are rechecked before a physical request after a 429 wait',async()=>{
 jest.useFakeTimers();
 global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=> '1'}}));
 let changed=false;
 const beforeRequest=jest.fn(()=>{if(changed)throw Object.assign(new Error('Settings changed'),{code:'HAZARD_SETTINGS_CHANGED'});});
 const outcome=fetchLLMResponse('assess',{},[],'',{workflow:'hazard-row-generation',beforeRequest}).catch(error=>error);
 for(let i=0;i<8;i++)await Promise.resolve();
 expect(global.fetch).toHaveBeenCalledTimes(1);
 changed=true;jest.advanceTimersByTime(1000);
 expect(await outcome).toMatchObject({code:'HAZARD_SETTINGS_CHANGED'});
 expect(beforeRequest).toHaveBeenCalledTimes(2);expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each(['STPA','HARA','FHA'])('malformed successful provider content follows %s recovery policy',async method=>{
 global.fetch=jest.fn(async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:[{type:'text',text:'[]'}]}}]})}));
 const controller=new AbortController();
 if(method==='STPA'){
  await expect(generateFastHazards({method,sources:[source],context:{},signal:controller.signal,request:requestFor(controller.signal),...quiet})).rejects.toMatchObject({code:'COMPACT_HAZARD_INCOMPLETE',partialResults:[]});
  expect(controller.signal.aborted).toBe(false);expect(global.fetch).toHaveBeenCalledTimes(3);return;
 }
 const results=await generateFastHazards({method,sources:[source],context:{},signal:controller.signal,request:requestFor(controller.signal),...quiet});
 expect(results).toHaveLength(1);
 expect(validateFastAssessment(method,results[0],source)).toEqual([]);
 expect(results[0].assessmentBasis).toContain('Assumption-based');
 expect(controller.signal.aborted).toBe(false);
 expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('final 429 does not wait for an error body',async()=>{
 jest.useFakeTimers();
 const text=jest.fn(()=>new Promise(()=>{}));
 global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=> '0'},text}));
 const result=fetchLLMResponse('assess',{},[],'',{workflow:'hazard-row-generation',timeoutMs:50});
 const outcome=result.catch(error=>error);
 for(let i=0;i<30;i++){await Promise.resolve();jest.advanceTimersByTime(1);}
 expect(await outcome).toMatchObject({status:429,code:'HAZARD_RATE_LIMIT_EXHAUSTED'});
 expect(global.fetch).toHaveBeenCalledTimes(5);
 expect(text).not.toHaveBeenCalled();
});

test.each(['STPA','HARA','FHA'])('long Retry-After completes %s without early remote retry',async method=>{
 global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=> '86400'}}));
 if(method==='STPA'){
  await expect(generateFastHazards({method,sources:[source],context:{},request:requestFor(),...quiet})).rejects.toMatchObject({partialResults:[]});
  expect(global.fetch).toHaveBeenCalledTimes(1);return;
 }
 const results=await generateFastHazards({method,sources:[source],context:{},request:requestFor(),...quiet});
 expect(results).toHaveLength(1);
 expect(validateFastAssessment(method,results[0],source)).toEqual([]);
 expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('HTTP-date Retry-After also respects the waiting budget',async()=>{
 global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=>new Date(Date.now()+86400000).toUTCString()}}));
 await expect(fetchLLMResponse('assess',{},[],'',{workflow:'hazard-row-generation'})).rejects.toHaveProperty('status',429);
 expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('short Retry-After can recover normally',async()=>{
 jest.useFakeTimers();
 global.fetch=jest.fn().mockResolvedValueOnce({ok:false,status:429,headers:{get:()=> '1'}})
  .mockResolvedValueOnce({ok:true,status:200,json:async()=>({choices:[{message:{content:'[]'}}]})});
 const result=fetchLLMResponse('assess',{},[],'',{workflow:'hazard-row-generation'});
 for(let i=0;i<6;i++)await Promise.resolve();
 expect(global.fetch).toHaveBeenCalledTimes(1);
 jest.advanceTimersByTime(1000);
 expect(await result).toBe('[]');expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('cumulative Retry-After waits are bounded',async()=>{
 jest.useFakeTimers();
 global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=> '30'}}));
 const outcome=fetchLLMResponse('assess',{},[],'',{workflow:'hazard-row-generation'}).catch(error=>error);
 for(let round=0;round<3;round++){
  for(let i=0;i<6;i++)await Promise.resolve();
  if(round<2)jest.advanceTimersByTime(30000);
 }
 expect(await outcome).toHaveProperty('status',429);
 expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('STPA screening rate limit preserves reviewed No without inventing remaining rows',async()=>{
 global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=> '86400'}}));
 const no={...source,id:'HA-2',reviewedApplicability:'No'};
 const unreviewed={...source,reviewedApplicability:undefined,reviewedRationale:undefined};
 await expect(generateFastHazards({method:'STPA',sources:[unreviewed,no],context:{},applicabilityRequest:requestFor(),...quiet})).rejects.toMatchObject({partialResults:[expect.objectContaining({id:'HA-2',applicable:'No'})]});
 expect(global.fetch).toHaveBeenCalledTimes(1);
});
