import { createProjectRunGuard } from './projectRunGuard';
test('late results cannot publish after navigation, even on returning to the same project',async()=>{
 const active={current:'A'},epoch={current:1};const allowed=createProjectRunGuard('A',active,epoch);
 expect(allowed()).toBe(true);
 let finish;const result=new Promise(resolve=>{finish=resolve;});let published=false;
 const completion=result.then(()=>{if(allowed())published=true;});
 active.current='B';epoch.current++;finish();await completion;
 expect(published).toBe(false);
 active.current='A';epoch.current++;expect(allowed()).toBe(false);
});
