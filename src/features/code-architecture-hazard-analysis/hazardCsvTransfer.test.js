import {hazardCsvTransferRun} from './hazardCsvTransfer';
import {PAGED_HAZARD} from './hazardRowIndex';

test('prepare omits only the derived Summary cache and preserves evidence and other sheets',()=>{
 const run={id:'draft',generatedSheets:{Summary:[['Hazard'],['']],Other:[['evidence']]},summaryRows:[{Hazard:'',row:['']}],architectureRowsSnapshot:[{evidence:'original'}],userPreprocessing:{one:{values:{Hazard:'manual'}}},csvImportPreviousSummary:[['prior']]};
 const transfer=hazardCsvTransferRun(run);expect(transfer.summaryRows).toBeUndefined();
 for(const key of ['generatedSheets','architectureRowsSnapshot','userPreprocessing','csvImportPreviousSummary'])expect(transfer[key]).toBe(run[key]);
 expect(run.summaryRows).toHaveLength(1);
});
test('apply transfers table and source-guard fields without cloning evidence or undo history again',()=>{
 const run={id:'draft',projectId:'project',repoId:'repo',hazardMethod:'STPA',organizationProfileProvenance:{policy:'A'},generatedSheets:{Summary:[['Hazard'],['']],Other:[['history']]},summaryRows:[{}],architectureRowsSnapshot:['large'],csvImportPreviousSummary:[['old']]};
 const transfer=hazardCsvTransferRun(run,true);expect(transfer.generatedSheets).toEqual({Summary:run.generatedSheets.Summary});expect(transfer.organizationProfileProvenance).toBe(run.organizationProfileProvenance);
 expect(transfer.architectureRowsSnapshot).toBeUndefined();expect(transfer.csvImportPreviousSummary).toBeUndefined();
});
test('paged sources stay unchanged and legacy sources retain their only available row representation',()=>{
 const paged={id:'saved',[PAGED_HAZARD]:{revision:'r'}};expect(hazardCsvTransferRun(paged)).toBe(paged);
 const legacy={id:'legacy',summaryRows:[{Hazard:'preserve'}]};expect(hazardCsvTransferRun(legacy)).toBe(legacy);
});
