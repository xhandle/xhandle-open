import {resilientHazardCheckpoint} from './resilientHazardCheckpoint';
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});
test('slow successful writes remain pending, then clear the warning without overlapping writes',async()=>{
 let resolve;const write=jest.fn(()=>new Promise(r=>{resolve=r;})),state=jest.fn();
 const cache=resilientHazardCheckpoint({write},{onStorageState:state});
 await cache.write({id:1},'first');await tick();
 jest.advanceTimersByTime(1600);await tick();expect(state).not.toHaveBeenCalled();
 jest.advanceTimersByTime(3400);await tick();expect(state).toHaveBeenLastCalledWith(expect.objectContaining({unsaved:true,status:'pending'}));
 expect(write).toHaveBeenCalledTimes(1);resolve();await tick();
 expect(state).toHaveBeenLastCalledWith(expect.objectContaining({unsaved:false,status:'saved'}));
 expect(await cache.flush()).toEqual({unsaved:false,pending:0});
});
test('read failure does not disable a healthy writer',async()=>{
 const write=jest.fn(async()=>{}),state=jest.fn();
 const cache=resilientHazardCheckpoint({read:async()=>{throw new Error('Transient read failure');},write},{onStorageState:state});
 expect(await cache.read({id:1})).toBeUndefined();
 await cache.write({id:1},'ready');await tick();expect(write).toHaveBeenCalledTimes(1);
 expect(await cache.read({id:1})).toBe('ready');
 expect(state).toHaveBeenLastCalledWith(expect.objectContaining({unsaved:false,status:'saved'}));
});
test('background retry recovers automatically and preserves the newest buffered value',async()=>{
 const write=jest.fn().mockRejectedValueOnce(new DOMException('aborted','AbortError')).mockResolvedValue();
 const state=jest.fn(),cache=resilientHazardCheckpoint({write},{onStorageState:state});
 await cache.write({id:1},'first');await tick();await cache.write({id:1},'second');
 expect(write).toHaveBeenCalledTimes(1);
 jest.advanceTimersByTime(1000);await tick();
 expect(write.mock.calls[1][1]).toBe('second');
 expect(state).toHaveBeenLastCalledWith(expect.objectContaining({unsaved:false,status:'saved',pending:0}));
});
test('late write completion cannot erase a newer pending value or announce it saved',async()=>{
 const resolve=[];const write=jest.fn(()=>new Promise(r=>resolve.push(r))),state=jest.fn();
 const cache=resilientHazardCheckpoint({write},{onStorageState:state});
 await cache.write({id:1},'old');await tick();jest.advanceTimersByTime(5000);await tick();
 await cache.write({id:1},'new');expect(write).toHaveBeenCalledTimes(1);
 resolve[0]();await tick();expect(write).toHaveBeenCalledTimes(2);
 expect(state.mock.calls.some(([s])=>s.status==='saved')).toBe(false);
 resolve[1]();await tick();expect(state).toHaveBeenLastCalledWith(expect.objectContaining({status:'saved'}));
});
test('hung writer never blocks generation or bounded flush, and does not start overlapping retries',async()=>{
 const write=jest.fn(()=>new Promise(()=>{})),cache=resilientHazardCheckpoint({write});
 await cache.write({id:1},'ready');await tick();const flush=cache.flush();
 jest.advanceTimersByTime(1500);await tick();expect(await flush).toEqual({unsaved:true,pending:1});
 jest.advanceTimersByTime(60000);await tick();expect(write).toHaveBeenCalledTimes(1);
 expect(await cache.read({id:1})).toBe('ready');
});
test.each(['QuotaExceededError','SecurityError','NotSupportedError'])('%s does not retry indefinitely',async name=>{
 const write=jest.fn(async()=>{throw new DOMException('unavailable',name);});
 const cache=resilientHazardCheckpoint({write});await cache.write({id:1},'result');await tick();
 jest.advanceTimersByTime(60000);await tick();await cache.flush();
 expect(write).toHaveBeenCalledTimes(1);expect(await cache.read({id:1})).toBe('result');
});
test('transient retries are bounded even when more rows are buffered',async()=>{
 const write=jest.fn(async()=>{throw new Error('temporarily unavailable');});
 const cache=resilientHazardCheckpoint({write});await cache.write({id:1},'result');await tick();
 for(const ms of [1000,3000,10000]){jest.advanceTimersByTime(ms);await tick();}
 await cache.write({id:2},'second');await cache.flush();expect(write).toHaveBeenCalledTimes(4);
});
test('cancellation cancels background retry and suppresses late callbacks',async()=>{
 const controller=new AbortController(),write=jest.fn(async()=>{throw new Error('failure');}),state=jest.fn();
 const cache=resilientHazardCheckpoint({write},{signal:controller.signal,onStorageState:state});
 await cache.write({id:1},'result');await tick();controller.abort();state.mockClear();
 jest.advanceTimersByTime(60000);await tick();expect(write).toHaveBeenCalledTimes(1);expect(state).not.toHaveBeenCalled();
});
test('large reads are bounded to 48 entries and preserve order',async()=>{
 const readMany=jest.fn(async rows=>rows.map(r=>r.id)),cache=resilientHazardCheckpoint({readMany});
 expect(await cache.readMany(Array.from({length:130},(_,id)=>({id})))).toEqual(Array.from({length:130},(_,i)=>i));
 expect(readMany.mock.calls.map(([r])=>r.length)).toEqual([48,48,34]);
});
test('late initialization restores saving after a read timeout without losing new work',async()=>{
 let resolve;const write=jest.fn(async()=>{}),cache=resilientHazardCheckpoint(new Promise(r=>{resolve=r;}));
 const read=cache.read({id:1});await tick();jest.advanceTimersByTime(5000);await tick();expect(await read).toBeUndefined();
 await cache.write({id:1},'new');await tick();resolve({read:async()=> 'old',write});await tick();
 expect(write).toHaveBeenCalledWith({id:1},'new');expect(await cache.read({id:1})).toBe('new');
});
test('a failed database open can recover on a later write',async()=>{
 const write=jest.fn(async()=>{}),open=jest.fn().mockRejectedValueOnce(new Error('Open failed')).mockResolvedValue({write});
 const cache=resilientHazardCheckpoint(open);expect(await cache.read({id:1})).toBeUndefined();
 await cache.write({id:1},'ready');await tick();expect(open).toHaveBeenCalledTimes(2);expect(write).toHaveBeenCalledTimes(1);
});
test('recovery and cancellation are isolated to their own run',async()=>{
 const controller=new AbortController(),a=jest.fn(async()=>{throw new Error('retry');}),b=jest.fn().mockRejectedValueOnce(new Error('retry')).mockResolvedValue();
 const first=resilientHazardCheckpoint({write:a},{signal:controller.signal}),second=resilientHazardCheckpoint({write:b});
 await first.write({id:1},'project A');await second.write({id:1},'project B');await tick();controller.abort();
 jest.advanceTimersByTime(1000);await tick();expect(a).toHaveBeenCalledTimes(1);expect(b.mock.calls[1][1]).toBe('project B');
 expect(await second.flush()).toEqual({unsaved:false,pending:0});
});
test('reads resume after a transient rejection and healthy write',async()=>{
 const read=jest.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('saved row');
 const cache=resilientHazardCheckpoint({read,write:async()=>{}});
 expect(await cache.read({id:1})).toBeUndefined();
 await cache.write({id:1},'new');await tick();
 expect(await cache.read({id:2})).toBe('saved row');expect(read).toHaveBeenCalledTimes(2);
});
test('read probes recover after backoff without requiring writes and stop after bounded failures',async()=>{
 const read=jest.fn(async()=>{throw new Error('transient');}),cache=resilientHazardCheckpoint({read});
 await cache.read({id:1});await cache.read({id:2});expect(read).toHaveBeenCalledTimes(1);
 for(const ms of [1000,3000,10000]){jest.advanceTimersByTime(ms);await cache.read({id:2});}
 jest.advanceTimersByTime(60000);await cache.read({id:2});expect(read).toHaveBeenCalledTimes(4);
});
test('late read rejection permits a later bounded probe instead of staying disabled',async()=>{
 let reject;const read=jest.fn().mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;})).mockResolvedValue('saved');
 const cache=resilientHazardCheckpoint({read});const first=cache.read({id:1});await tick();
 jest.advanceTimersByTime(5000);await tick();expect(await first).toBeUndefined();
 await cache.read({id:2});expect(read).toHaveBeenCalledTimes(1);
 reject(new Error('late failure'));await tick();jest.advanceTimersByTime(1000);
 expect(await cache.read({id:2})).toBe('saved');
});
test('permanent read failure is not revived by successful writes',async()=>{
 const read=jest.fn(async()=>{throw new DOMException('denied','SecurityError');});
 const cache=resilientHazardCheckpoint({read,write:async()=>{}});
 await cache.read({id:1});await cache.write({id:1},'new');await tick();jest.advanceTimersByTime(60000);
 expect(await cache.read({id:2})).toBeUndefined();expect(read).toHaveBeenCalledTimes(1);
});

describe('overlapping checkpoint reads',()=>{
 const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
 test.each(['resolve','reject'])('older timeout followed by late %s cannot disable reads after newer success',async outcome=>{
  const old=deferred(),state=jest.fn();
  const read=jest.fn(basis=>basis.id==='old'?old.promise:Promise.resolve(`saved-${basis.id}`));
  const cache=resilientHazardCheckpoint({read},{onStorageState:state});
  const first=cache.read({id:'old'});await tick();
  expect(await cache.read({id:'newer'})).toBe('saved-newer');
  state.mockClear();jest.advanceTimersByTime(5000);await tick();
  expect(await first).toBeUndefined();
  expect(await cache.read({id:'after-timeout'})).toBe('saved-after-timeout');
  old[outcome](outcome==='resolve'?'saved-old':new Error('late failure'));await tick();
  expect(await cache.read({id:'after-settlement'})).toBe('saved-after-settlement');
  expect(state.mock.calls.some(([event])=>event.status==='read-failed')).toBe(false);
 });
 test.each(['Error','SecurityError'])('older %s rejection cannot change newer successful read state',async name=>{
  const old=deferred(),state=jest.fn(),read=jest.fn(b=>b.id===1?old.promise:Promise.resolve('saved'));
  const cache=resilientHazardCheckpoint({read},{onStorageState:state});
  const first=cache.read({id:1});await tick();await cache.read({id:2});state.mockClear();
  old.reject(name==='Error'?new Error('transient'):new DOMException('denied',name));
  expect(await first).toBeUndefined();expect(await cache.read({id:3})).toBe('saved');
  expect(state.mock.calls.some(([s])=>s.status==='read-failed')).toBe(false);
 });
 test('older success cannot clear a newer permanent read failure',async()=>{
  const old=deferred(),read=jest.fn(b=>b.id===1?old.promise:Promise.reject(new DOMException('denied','SecurityError')));
  const cache=resilientHazardCheckpoint({read});
  const first=cache.read({id:1});await tick();await cache.read({id:2});
  old.resolve('old saved');expect(await first).toBe('old saved');
  jest.advanceTimersByTime(60000);expect(await cache.read({id:3})).toBeUndefined();expect(read).toHaveBeenCalledTimes(2);
 });
 test('older failure cannot consume the newer read retry budget',async()=>{
  const old=deferred();let attempts=0;
  const read=jest.fn(b=>b.id==='old'?old.promise:++attempts<=3?Promise.reject(new Error('transient')):Promise.resolve('recovered'));
  const cache=resilientHazardCheckpoint({read});const first=cache.read({id:'old'});await tick();
  await cache.read({id:'new'});old.reject(new Error('stale failure'));await first;
  for(const delay of [1000,3000]){jest.advanceTimersByTime(delay);await cache.read({id:'new'});}
  jest.advanceTimersByTime(10000);expect(await cache.read({id:'new'})).toBe('recovered');
 });
});

test('saved cache entries are bounded while pending writes remain readable',async()=>{
 const saved=new Map();let release;
 const backend={read:jest.fn(async b=>saved.get(b.id)),writeMany:jest.fn(async entries=>{
   if(entries.some(e=>e.basis.id==='pending'))await new Promise(r=>{release=r;});
   entries.forEach(e=>saved.set(e.basis.id,e.value));
 })};
 const cache=resilientHazardCheckpoint(backend,{maxCleanEntries:2});
 for(let id=0;id<8;id++){await cache.write({id,evidence:'x'.repeat(10000)},id);await tick();}
 await cache.flush();
 expect(await cache.read({id:0,evidence:'x'.repeat(10000)})).toBe(0);
 expect(backend.read).toHaveBeenCalled();
 await cache.write({id:'pending'},'protected');await tick();
 expect(await cache.read({id:'pending'})).toBe('protected');
 release();await tick();await cache.flush();
});
