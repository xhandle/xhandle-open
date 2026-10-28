import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {serialize,deserialize} from 'v8';
import {saveHazardRecovery} from './saveHazardRecovery';
import {saveCodeArchitectureHazardRun,getCodeArchitectureHazardRunById} from './codeArchitectureHazardStore';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
async function setup(){
 await saveCodeArchitectureHazardRun({id:'recovery-sequence',projectId:'p',generatedSheets:{Summary:[['Hazard'],['published']]}});
 const previous=await getCodeArchitectureHazardRunById('recovery-sequence');
 return {manifest:{...previous,pendingAttempt:{id:'attempt',validatedAssessments:0}},recovery:{...previous,pendingAttempt:{id:'attempt',validatedAssessments:1}}};
}
test('late manifest commit finishes before recovery takes its source revision',async()=>{
 const {manifest,recovery}=await setup();let release;
 const initial=new Promise(resolve=>{release=resolve;}).then(()=>saveCodeArchitectureHazardRun(manifest));
 const final=saveHazardRecovery(initial,manifest,recovery);
 await Promise.resolve();expect((await getCodeArchitectureHazardRunById(manifest.id)).pendingAttempt).toBeUndefined();
 release();await final;
 expect((await getCodeArchitectureHazardRunById(manifest.id)).pendingAttempt.validatedAssessments).toBe(1);
});
test('does not rebase over an independent edit after the manifest committed',async()=>{
 const {manifest,recovery}=await setup();const initial=saveCodeArchitectureHazardRun(manifest);await initial;
 const concurrent=await getCodeArchitectureHazardRunById(manifest.id);await saveCodeArchitectureHazardRun({...concurrent,repoName:'external edit'});
 await expect(saveHazardRecovery(initial,manifest,recovery)).rejects.toMatchObject({code:'HAZARD_REVISION_CONFLICT'});
 const stored=await getCodeArchitectureHazardRunById(manifest.id);
 expect(stored.repoName).toBe('external edit');expect(stored.pendingAttempt.validatedAssessments).toBe(0);
});
test('a failed manifest does not prevent a recovery write if its revision is still valid',async()=>{
 const {manifest,recovery}=await setup();
 await saveHazardRecovery(Promise.reject(Error('temporary storage failure')),manifest,recovery);
 expect((await getCodeArchitectureHazardRunById(manifest.id)).pendingAttempt.validatedAssessments).toBe(1);
});
