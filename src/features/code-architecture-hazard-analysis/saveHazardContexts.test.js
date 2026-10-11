import { assertHazardContextRunScope, persistHazardContexts } from './saveHazardContexts';
import { saveCodeArchitectureHazardRun } from './codeArchitectureHazardStore';
import { saveCodeArchitectureHazardContexts } from './codeArchitectureHazardContextStore';
jest.mock('./codeArchitectureHazardStore', () => ({saveCodeArchitectureHazardRun: jest.fn()}));
jest.mock('./codeArchitectureHazardContextStore', () => ({saveCodeArchitectureHazardContexts: jest.fn()}));
const headers = ['Raw Analysis Row ID','Guide Phrase Applicable','Operational Context ID','Operational Scenario','Operational Mode'];
const run = {id:'run',csvImportPreviousSummary:[headers],generatedSheets:{Summary:[headers,['1','Yes','ctx','Old','Normal'],['2','No','ctx','Old','Normal']]}};
const contexts = [{id:'ctx',scenario:'New',mode:'Normal'}];
beforeEach(()=>jest.resetAllMocks());
test('persists before returning, preserves Yes/No and does not trigger a self reload', async()=>{
 let finish; saveCodeArchitectureHazardRun.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const saving=persistHazardContexts({run,projectId:'p',repoId:'r',contexts});
 expect(saveCodeArchitectureHazardContexts).not.toHaveBeenCalled();
 finish(); const result=await saving;
 expect(result.generatedSheets.Summary.slice(1).map(row=>row[1])).toEqual(['Yes','No']);
 expect(saveCodeArchitectureHazardRun.mock.calls[0][1]).toEqual({notify:false});
 expect(saveCodeArchitectureHazardContexts).toHaveBeenCalledWith({projectId:'p',repoId:'r',contexts});
});
test('unchanged context skips full run persistence',async()=>{
 const result=await persistHazardContexts({run,contexts:[{id:'ctx',scenario:'Old',mode:'Normal'}]});
 expect(result).toBe(run);expect(saveCodeArchitectureHazardRun).not.toHaveBeenCalled();
});
test('run failure leaves contexts untouched',async()=>{
 saveCodeArchitectureHazardRun.mockRejectedValueOnce(new Error('write failed'));
 await expect(persistHazardContexts({run,contexts})).rejects.toThrow('write failed');
 expect(saveCodeArchitectureHazardContexts).not.toHaveBeenCalled();
});
test('context failure restores previous run without a reload',async()=>{
 saveCodeArchitectureHazardContexts.mockImplementationOnce(()=>{throw new Error('quota');});
 await expect(persistHazardContexts({run,contexts})).rejects.toThrow('quota');
 expect(saveCodeArchitectureHazardRun).toHaveBeenLastCalledWith(run,{notify:false});
});


test.each(['NVlabs/alpamayo', 'local:folder-123'])('loaded source %s can save under a distinct workspace repository ID', async (analysisRepoId) => {
 const loaded = {...run, projectId:'project-alpamayo', repoId:analysisRepoId};
 expect(() => assertHazardContextRunScope(loaded, {projectId:'project-alpamayo', analysisRepoId})).not.toThrow();
 const updated = await persistHazardContexts({run:loaded, projectId:'project-alpamayo', repoId:'workspace-repo-uuid', contexts});
 expect(updated.repoId).toBe(analysisRepoId);
 expect(saveCodeArchitectureHazardContexts).toHaveBeenCalledWith({projectId:'project-alpamayo', repoId:'workspace-repo-uuid', contexts});
});

test('scope guard still rejects another project using the same repository', () => {
 expect(() => assertHazardContextRunScope({projectId:'other',repoId:'NVlabs/alpamayo'}, {projectId:'current',analysisRepoId:'NVlabs/alpamayo'})).toThrow('different project or repository');
});

test('scope guard still rejects another repository within the same project', () => {
 expect(() => assertHazardContextRunScope({projectId:'current',repoId:'NVlabs/alpamayo2'}, {projectId:'current',analysisRepoId:'NVlabs/alpamayo'})).toThrow('different project or repository');
});

test('contexts can be configured before an analysis exists', () => {
 expect(() => assertHazardContextRunScope(null, {projectId:'current',analysisRepoId:'NVlabs/alpamayo'})).not.toThrow();
});
