import {createHazardRequestScheduler} from './hazardRequestScheduler';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test('generation and review share three slots and waiting stages alternate',async()=>{
 const scheduler=createHazardRequestScheduler();
 const gates=Array.from({length:7},deferred),started=[];let active=0,max=0;
 const add=(kind,i)=>scheduler.run(kind,async()=>{started.push(i);active++;max=Math.max(max,active);await gates[i].promise;active--;});
 const jobs=[add('generation',0),add('generation',1),add('generation',2),add('generation',3),add('generation',4),add('review',5),add('review',6)];
 await flush();expect(started).toEqual([0,1,2]);
 gates[0].resolve();await flush();expect(started).toEqual([0,1,2,5]);
 gates[1].resolve();await flush();expect(started).toEqual([0,1,2,5,3]);
 gates.forEach(g=>g.resolve());await Promise.all(jobs);expect(max).toBe(3);scheduler.close();
});

test('abort settles active requests and rejects queued requests without starting them',async()=>{
 const controller=new AbortController(),scheduler=createHazardRequestScheduler({limit:1,signal:controller.signal});
 const gate=deferred(),queued=jest.fn();
 const active=jest.fn(()=>gate.promise);
 const first=scheduler.run('generation',active);const firstObserved=first.catch(e=>e);
 const second=scheduler.run('review',queued);const observed=second.catch(e=>e);
 await flush();expect(active).toHaveBeenCalledTimes(1);
 controller.abort();expect((await observed).name).toBe('AbortError');expect(queued).not.toHaveBeenCalled();
 expect((await firstObserved).name).toBe('AbortError');gate.resolve();scheduler.close();
});
