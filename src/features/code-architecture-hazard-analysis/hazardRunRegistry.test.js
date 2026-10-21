import {createHazardRunRegistry} from './hazardRunRegistry';
test('navigation and independent scopes do not cancel active runs',()=>{
 const registry=createHazardRunRegistry(),a=registry.start('A:repo'),b=registry.start('B:repo');
 a.progress={step:50};a.run={id:'partial'};
 expect(registry.get('A:repo')).toBe(a);
 expect(a.controller.signal.aborted).toBe(false);
 expect(registry.start('A:repo')).toBeNull();
 registry.stop('B:repo');expect(b.controller.signal.aborted).toBe(true);
 expect(a.controller.signal.aborted).toBe(false);
 registry.finish('B:repo',b);expect(registry.get('A:repo').progress.step).toBe(50);
});
test('unsaved results survive navigation; saved runs release memory',()=>{
 const registry=createHazardRunRegistry(),a=registry.start('A');
 a.run={finalSavePending:true};registry.finish('A',a);
 expect(registry.get('A').run).toBe(a.run);
 const next=registry.start('A');expect(next).not.toBe(a);
 registry.finish('A',a);expect(registry.get('A')).toBe(next);
 registry.finish('A',next);expect(registry.get('A')).toBeUndefined();
});
test('teardown explicitly cancels all active work',()=>{
 const registry=createHazardRunRegistry(),a=registry.start('A'),b=registry.start('B');
 registry.close();expect(a.controller.signal.aborted).toBe(true);expect(b.controller.signal.aborted).toBe(true);
});
test('completion invalidates older loads even after the saved run leaves memory',()=>{
 const registry=createHazardRunRegistry(),record=registry.start('A');
 const revision=registry.revision('A');
 registry.finish('A',record);
 expect(registry.get('A')).toBeUndefined();
 expect(registry.revision('A')).not.toBe(revision);
});
test('explicit project deletion cancels that background run without canceling another project',()=>{
 const registry=createHazardRunRegistry(),a=registry.start('A:repo'),b=registry.start('B:repo');
 registry.retainScopes(new Set(['B:repo']));
 expect(a.controller.signal.aborted).toBe(true);
 expect(b.controller.signal.aborted).toBe(false);
 expect(registry.get('A:repo')).toBeUndefined();
});
test('successful retry-save releases only the matching completed unsaved run',()=>{
 const registry=createHazardRunRegistry(),record=registry.start('A');
 record.run={id:'run-A',finalSavePending:true};registry.finish('A',record);
 registry.saved('A','other');expect(registry.get('A')).toBe(record);
 registry.saved('A','run-A');expect(registry.get('A')).toBeUndefined();
 const active=registry.start('A');active.run={id:'new'};
 registry.saved('A','new');expect(registry.get('A')).toBe(active);
 registry.discard('A');expect(active.controller.signal.aborted).toBe(true);
 expect(registry.get('A')).toBeUndefined();
});
test('finishing a run retires its controller while retaining unsaved final results',()=>{
 const registry=createHazardRunRegistry(),first=registry.start('scope');
 first.run={id:'unsaved',finalSavePending:true};registry.finish('scope',first);
 expect(first.controller.signal.aborted).toBe(true);expect(registry.get('scope').run.id).toBe('unsaved');
 const second=registry.start('scope');registry.finish('scope',first);
 expect(second.controller.signal.aborted).toBe(false);
});

test('stopped owner retains recovery until work settles and retains failed save for retry',async()=>{
 const registry=createHazardRunRegistry(),record=registry.start('A');let finish;
 const work=registry.track('A',record,()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();
 registry.stop('A');registry.finish('A',record);
 expect(registry.get('A')).toBe(record);
 const run={id:'partial',runState:'incomplete',finalSavePending:true};
 expect(registry.acceptUpdate('A',record,run)).toBe(true);
 finish();await work;expect(registry.get('A').run).toBe(run);
 registry.saved('A','partial');expect(registry.get('A')).toBeUndefined();
});
test('replaced and deleted attempts cannot publish late recovery or remove newer ownership',async()=>{
 const registry=createHazardRunRegistry(),old=registry.start('A');let finish;
 const work=registry.track('A',old,()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();
 registry.stop('A');registry.finish('A',old);const next=registry.start('A');
 expect(registry.acceptUpdate('A',old,{runState:'incomplete'})).toBe(false);
 finish();await work;expect(registry.get('A')).toBe(next);
 registry.discard('A');expect(registry.acceptUpdate('A',next,{runState:'incomplete'})).toBe(false);
});
test('cancelled completed output is rejected and successful recovery releases ownership',async()=>{
 const registry=createHazardRunRegistry(),record=registry.start('A');let finish;
 const work=registry.track('A',record,()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();
 registry.stop('A');registry.finish('A',record);
 expect(registry.acceptUpdate('A',record,{runState:'complete'})).toBe(false);
 expect(registry.acceptUpdate('A',record,{runState:'incomplete'})).toBe(true);
 finish();await work;expect(registry.get('A')).toBeUndefined();
});

test('save events from an older pending attempt cannot replace or release a newer stopped attempt',()=>{
 const registry=createHazardRunRegistry(),record=registry.start('A');
 const completed={id:'prior',projectId:'p',repoId:'r',runState:'complete'};
 const latest={...completed,pendingAttempt:{id:'new',runState:'incomplete'},finalSavePending:true};
 registry.acceptUpdate('A',record,latest);registry.finish('A',record);
 for(const finalSavePending of [true,false]){
  expect(registry.reconcileSave({...completed,pendingAttempt:{id:'old'},finalSavePending})).toBeNull();
  expect(registry.get('A').run).toBe(latest);
 }
 expect(registry.reconcileSave({...latest,finalSavePending:false})).toBe('A');
 expect(registry.get('A')).toBeUndefined();
});
