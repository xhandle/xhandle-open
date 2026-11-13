import {startSafetyCaseEvidenceRuntime,EVIDENCE_SYNC_EVENT} from './safetyCaseEvidenceRuntime';
jest.mock('./safetyCaseStore',()=>({loadSafetyCases:jest.fn(),updateSafetyCaseAutomation:jest.fn()}));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
let stop;
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>{stop?.();jest.useRealTimers();jest.clearAllMocks();});
const makeCase=(id='c')=>({id,projectId:'p',updatedAt:'one',nodes:[]});
const snapshot={projectId:'p',complete:true,errors:[],artifacts:[]};
async function advance(ms=10){jest.advanceTimersByTime(ms);await flush();}

test('collects on startup and source changes without mounting the Safety Case view; groups reads by project',async()=>{
 const cases=[makeCase(),makeCase('c2')];
 const collect=jest.fn(async()=>snapshot);
 const update=jest.fn(async(id,fn)=>{const value=cases.find(c=>c.id===id);value.evidenceAutomation=fn(value);});
 stop=startSafetyCaseEvidenceRuntime({list:async()=>cases,collect,update,debounceMs:10});
 await advance();expect(collect).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledTimes(2);
 window.dispatchEvent(new CustomEvent('xhandle:vnv-documents-updated'));
 await advance();expect(collect).toHaveBeenCalledTimes(2);
});
test('catch-up interval, pause/resume, own-write suppression, and cleanup',async()=>{
 const value=makeCase();const collect=jest.fn(async()=>snapshot);
 const update=jest.fn(async(id,fn)=>{value.evidenceAutomation=fn(value);window.dispatchEvent(new CustomEvent('xhandle:safety-case-updated',{detail:value}));});
 stop=startSafetyCaseEvidenceRuntime({list:async()=>[value],collect,update,intervalMs:100,debounceMs:10});
 await advance();await advance();expect(collect).toHaveBeenCalledTimes(2);
 await advance(30);expect(collect).toHaveBeenCalledTimes(2);
 window.dispatchEvent(new CustomEvent('xhandle:backup-data-changed',{detail:{db:'TraceabilityDB',stores:['SafetyCases']}}));
 await advance();expect(collect).toHaveBeenCalledTimes(2);
 value.evidenceAutomation.paused=true;await advance(100);await advance();expect(collect).toHaveBeenCalledTimes(2);
 value.evidenceAutomation.paused=false;await advance(100);await advance();expect(collect).toHaveBeenCalledTimes(3);
 stop();await advance(1000);expect(collect).toHaveBeenCalledTimes(3);
});
test('coalesces events while a scan is pending and does not commit after unmount',async()=>{
 let release;const collect=jest.fn(()=>new Promise(resolve=>{release=resolve;}));const update=jest.fn();
 stop=startSafetyCaseEvidenceRuntime({list:async()=>[makeCase()],collect,update,debounceMs:10});
 await advance();window.dispatchEvent(new Event('focus'));await advance();
 expect(collect).toHaveBeenCalledTimes(1);
 stop();release(snapshot);await flush();expect(update).not.toHaveBeenCalled();
});
test('persistence failure reports an error and retries on the next source notification',async()=>{
 const update=jest.fn().mockRejectedValueOnce(Error('quota')).mockResolvedValue(null);
 const error=jest.fn();window.addEventListener(EVIDENCE_SYNC_EVENT,error);
 try{
 stop=startSafetyCaseEvidenceRuntime({list:async()=>[makeCase()],collect:async()=>snapshot,update,debounceMs:10});
 await advance();expect(error.mock.calls[0][0].detail.error).toBe('quota');
 window.dispatchEvent(new Event('focus'));await advance();expect(update).toHaveBeenCalledTimes(2);
 }finally{window.removeEventListener(EVIDENCE_SYNC_EVENT,error);}
});
