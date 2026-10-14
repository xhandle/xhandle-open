import {createHazardAutomaticRecovery,isTransientHazardFailure} from './hazardAutomaticRecovery';
import {generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';
const temporary=()=>Object.assign(new Error('temporary timeout'),{name:'TimeoutError'});

test('retries transient failures with bounded increasing delays',async()=>{
 const wait=jest.fn(async()=>{}),onRetry=jest.fn(),operation=jest.fn().mockRejectedValueOnce(temporary()).mockRejectedValueOnce(temporary()).mockResolvedValue('done');
 expect(await createHazardAutomaticRecovery({wait,onRetry})(operation,{stage:'generation',rows:4})).toBe('done');
 expect(wait.mock.calls.map(x=>x[0])).toEqual([2000,5000]);expect(onRetry).toHaveBeenCalledTimes(2);
});
test('persistent failure ends after three retries',async()=>{
 const operation=jest.fn(async()=>{throw temporary();});
 await expect(createHazardAutomaticRecovery({wait:async()=>{}})(operation,{})).rejects.toMatchObject({code:'HAZARD_RECOVERY_EXHAUSTED'});
 expect(operation).toHaveBeenCalledTimes(4);
});
test('aggregate budget prevents many batches from multiplying recovery indefinitely',async()=>{
 const recover=createHazardAutomaticRecovery({wait:async()=>{}});
 for(let i=0;i<6;i++)await recover(jest.fn().mockRejectedValueOnce(temporary()).mockResolvedValue('ok'),{});
 const operation=jest.fn(async()=>{throw temporary();});await expect(recover(operation,{})).rejects.toHaveProperty('code','HAZARD_RECOVERY_EXHAUSTED');expect(operation).toHaveBeenCalledTimes(1);
});
test.each([400,401,403,404,429])('does not retry permanent HTTP %s or multiply transport rate-limit retries',async status=>{
 const wait=jest.fn(),operation=jest.fn(async()=>{throw new Error(`LLM proxy error (${status}): rejected`);});
 await expect(createHazardAutomaticRecovery({wait})(operation,{})).rejects.toThrow('rejected');expect(wait).not.toHaveBeenCalled();
});
test.each([408,500,502,503,504,529])('recognizes transient HTTP %s',status=>expect(isTransientHazardFailure(new Error(`LLM proxy error (${status}): unavailable`))).toBe(true));
test('Stop cancels pending backoff immediately and never restarts the request',async()=>{
 jest.useFakeTimers();
 try{
  const controller=new AbortController(),operation=jest.fn(async()=>{throw temporary();});
  const pending=createHazardAutomaticRecovery({signal:controller.signal})(operation,{});
  const assertion=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await Promise.resolve();controller.abort();await assertion;
  jest.runOnlyPendingTimers();expect(operation).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 }finally{jest.useRealTimers();}
});
test('a native AbortError is not treated as an automatic retry',async()=>{
 const operation=jest.fn(async()=>{throw new DOMException('Stopped','AbortError');});
 await expect(createHazardAutomaticRecovery({})(operation,{})).rejects.toMatchObject({name:'AbortError'});expect(operation).toHaveBeenCalledTimes(1);
});
test.each(['STPA','HARA','FHA'])('%s active generation recovers only the failed batch without persistent storage',async method=>{
 const counts={},progress=jest.fn();
 const sources=Array.from({length:9},(_,i)=>({id:`HA-${i+1}`,action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Human decision'}));
 const request=jest.fn(async prompt=>{
  const rows=JSON.parse(prompt.split('\nRows: ')[1]);const id=rows[0].id;counts[id]=(counts[id]||0)+1;
  if(id==='HA-9' && counts[id]===1)throw temporary();
  return rows.map(({id})=>answer(method,id));
 });
 const results=await generateFastHazards({method,sources,context:{},request,onProgress:progress,onDiagnostic:()=>{},onMetrics:()=>{}});
 expect(results).toHaveLength(9);expect(counts).toEqual({'HA-1':1,'HA-9':2});
 expect(progress).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('Completed work retained')}));
});
test('applicability also recovers automatically; excluded rows never enter generation',async()=>{
 const applicabilityRequest=jest.fn().mockRejectedValueOnce(temporary()).mockResolvedValue([{id:'HA-1',applicable:'No',rationale:'Not meaningful for this action.'}]);
 const request=jest.fn(),onMetrics=jest.fn();
 const results=await generateFastHazards({method:'STPA',sources:[{id:'HA-1',action:'Read status',phrase:'Too late'}],context:{},applicabilityRequest,request,onMetrics,onDiagnostic:()=>{}});
 expect(results[0].applicable).toBe('No');expect(applicabilityRequest).toHaveBeenCalledTimes(2);expect(request).not.toHaveBeenCalled();
 expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({applicability:{requests:2}}));
});
