import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from './codeArchitectureHazardStore';

beforeEach(() => localStorage.clear());
test('silent context-run writes remain durable without reloading the originating view', async () => {
 const changed=jest.fn();
 window.addEventListener('xhandle:code-architecture-hazard-analysis:changed',changed);
 try {
  const run={id:'test-run',projectId:'p',repoId:'r',generatedSheets:{Summary:[['Guide Phrase Applicable'],['No']]}};
  await saveCodeArchitectureHazardRun(run,{notify:false});
  expect(changed).not.toHaveBeenCalled();
  expect(await getLatestCodeArchitectureHazardRun({projectId:'p',repoId:'r'})).toEqual({...run,finalSavePending:false,finalSaveStatus:'saved',saveFailureMessage:''});
  await saveCodeArchitectureHazardRun(run);
  expect(changed).toHaveBeenCalledTimes(1);
 } finally {window.removeEventListener('xhandle:code-architecture-hazard-analysis:changed',changed);}
});
test('failed save remains accessible only within its project and reload protection clears on retry',async()=>{
 const run={id:'unsaved-one',projectId:'unsaved-project',repoId:'repo',hazardMethod:'HARA',updatedAt:new Date().toISOString(),generatedSheets:{Summary:[['Function'],['One']]}};
 const spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Full');});
 try{
  await expect(saveCodeArchitectureHazardRun(run)).rejects.toThrow('Full');
  expect(await getLatestCodeArchitectureHazardRun({projectId:'unsaved-project',repoId:'repo'})).toMatchObject({id:run.id,finalSavePending:true});
  expect(await getLatestCodeArchitectureHazardRun({projectId:'another-project'})).toBeNull();
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
 }finally{spy.mockRestore();}
 await saveCodeArchitectureHazardRun({...run,finalSavePending:false});
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});
