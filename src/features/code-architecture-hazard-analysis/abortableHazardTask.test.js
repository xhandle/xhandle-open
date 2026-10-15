import {abortableHazardTask} from './abortableHazardTask';
import {createHazardRunRegistry} from './hazardRunRegistry';
test('Stop settles a hung run and permits a fresh run without waiting for provider or storage',async()=>{
 const registry=createHazardRunRegistry(),record=registry.start('A');
 const work=jest.fn(()=>new Promise(()=>{}));
 const running=abortableHazardTask(work,record.controller.signal).finally(()=>registry.finish('A',record));
 const observed=running.catch(e=>e);await Promise.resolve();registry.stop('A');
 expect((await observed).name).toBe('AbortError');expect(registry.get('A')).toBeUndefined();
 expect(registry.start('A')).not.toBeNull();registry.close();
});
test('late rejection after Stop is observed and does not change the canceled result',async()=>{
 let reject;const controller=new AbortController();
 const task=abortableHazardTask(()=>new Promise((_,r)=>{reject=r;}),controller.signal);
 const observed=task.catch(e=>e);await Promise.resolve();controller.abort();
 expect((await observed).name).toBe('AbortError');reject(new Error('late provider failure'));await Promise.resolve();
});
test('pre-aborted tasks never start and normal results/errors are preserved',async()=>{
 const controller=new AbortController();controller.abort();const work=jest.fn();
 await expect(abortableHazardTask(work,controller.signal)).rejects.toHaveProperty('name','AbortError');expect(work).not.toHaveBeenCalled();
 await expect(abortableHazardTask(async()=>42)).resolves.toBe(42);
 const error=new Error('provider failure');await expect(abortableHazardTask(()=>{throw error;})).rejects.toBe(error);
});
test('canceling one run does not cancel another project',async()=>{
 const a=new AbortController(),b=new AbortController();let finish;
 const one=abortableHazardTask(()=>new Promise(()=>{}),a.signal).catch(e=>e);
 const two=abortableHazardTask(()=>new Promise(r=>{finish=r;}),b.signal);await Promise.resolve();a.abort();
 expect((await one).name).toBe('AbortError');expect(b.signal.aborted).toBe(false);finish('done');await expect(two).resolves.toBe('done');
});
