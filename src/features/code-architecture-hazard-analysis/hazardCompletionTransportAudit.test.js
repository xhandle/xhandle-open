import {fetchLLMResponse} from '../../components/aiAnalysisSTPA';
import {generateFastHazards} from './resultsFirstHazardPipeline';
import {validateFastAssessment} from './fastHazardSchema';
const source={id:'HA-1',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Reviewed timing condition'};
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;jest.useRealTimers();});
const requestFor=signal=>(prompt,options)=>fetchLLMResponse(prompt,{},[],'',{...options,workflow:'hazard-row-generation',signal});

test.each(['STPA','HARA','FHA'])('malformed successful provider content completes %s through bounded fallback',async method=>{
 global.fetch=jest.fn(async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:[{type:'text',text:'[]'}]}}]})}));
 const controller=new AbortController();
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

test('screening rate limit completes all rows and preserves reviewed No',async()=>{
 global.fetch=jest.fn(async()=>({ok:false,status:429,headers:{get:()=> '86400'}}));
 const no={...source,id:'HA-2',reviewedApplicability:'No'};
 const unreviewed={...source,reviewedApplicability:undefined,reviewedRationale:undefined};
 const result=await generateFastHazards({method:'STPA',sources:[unreviewed,no],context:{},applicabilityRequest:requestFor(),...quiet});
 expect(result).toHaveLength(2);expect(result[0].assessmentBasis).toContain('Assumption-based');
 expect(result[1].applicable).toBe('No');expect(global.fetch).toHaveBeenCalledTimes(1);
});
