import { deleteCodeArchitectureHazardRuns, saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from './codeArchitectureHazardStore';

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

test('superseded recovery writes cannot replace newer persisted metadata; same-attempt retry succeeds',async()=>{
 const {claimHazardSaveAttempt}=require('./hazardSaveAttempt');
 const base={id:'shared-completed',projectId:'attempt-project',repoId:'r',runState:'complete',generatedSheets:{Summary:[['Existing'],['preserved']]}};
 const old={...base,pendingAttempt:{id:'attempt-old',runState:'incomplete'}};
 const next={...base,pendingAttempt:{id:'attempt-new',runState:'incomplete'}};
 claimHazardSaveAttempt(old);
 // Queue old work, then supersede it before storage opens.
 const queued=saveCodeArchitectureHazardRun(old);
 claimHazardSaveAttempt(next);
 const saved=saveCodeArchitectureHazardRun(next);
 await expect(queued).rejects.toMatchObject({code:'HAZARD_SAVE_SUPERSEDED'});await saved;
 const event=jest.fn();window.addEventListener('xhandle:hazard-save-state',event);
 try{await expect(saveCodeArchitectureHazardRun(old)).rejects.toMatchObject({code:'HAZARD_SAVE_SUPERSEDED'});expect(event).not.toHaveBeenCalled();}
 finally{window.removeEventListener('xhandle:hazard-save-state',event);}
 await saveCodeArchitectureHazardRun(next);
 const stored=await getLatestCodeArchitectureHazardRun({projectId:base.projectId,repoId:'r'});
 expect(stored.pendingAttempt.id).toBe('attempt-new');expect(stored.generatedSheets).toEqual(base.generatedSheets);
});

test('Clear revokes late and queued recovery saves but allows a fresh attempt and unrelated scopes',async()=>{
 const {claimHazardSaveAttempt}=require('./hazardSaveAttempt');
 const filters={projectId:'clear-recovery-project',repoId:'r'};
 const manifest={...filters,id:'clear-old',hazardMethod:'STPA-Textbook',runState:'incomplete',validatedAssessments:0};
 const other={...manifest,id:'clear-unrelated',projectId:'unrelated-project'};
 claimHazardSaveAttempt(manifest);claimHazardSaveAttempt(other);
 await saveCodeArchitectureHazardRun(manifest);
 const queued=saveCodeArchitectureHazardRun({...manifest,validatedAssessments:10});
 const rejected=expect(queued).rejects.toMatchObject({code:'HAZARD_SAVE_SUPERSEDED'});
 await deleteCodeArchitectureHazardRuns(filters);await rejected;
 const event=jest.fn();window.addEventListener('xhandle:hazard-save-state',event);
 try{
  await expect(saveCodeArchitectureHazardRun({...manifest,validatedAssessments:150})).rejects.toMatchObject({code:'HAZARD_SAVE_SUPERSEDED'});
  expect(event).not.toHaveBeenCalled();
 }finally{window.removeEventListener('xhandle:hazard-save-state',event);}
 expect(await getLatestCodeArchitectureHazardRun(filters)).toBeNull();
 await saveCodeArchitectureHazardRun(other);
 const fresh={...manifest,id:'clear-fresh'};claimHazardSaveAttempt(fresh);await saveCodeArchitectureHazardRun(fresh);
 expect(await getLatestCodeArchitectureHazardRun(filters)).toMatchObject({id:'clear-fresh'});
 await expect(saveCodeArchitectureHazardRun(manifest)).rejects.toMatchObject({code:'HAZARD_SAVE_SUPERSEDED'});
});
