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
