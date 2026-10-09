import {assignImportedHazardContext} from './codeHazardImportContext';
const headers=['Raw Analysis Row ID','Guide Phrase Applicable','Guide Phrase Applicability Rationale','Operational Context ID','Operational Scenario','Operational Mode'];
const run={id:'cba-hazard-csv-test',csvImportPreviousSummary:[headers],generatedSheets:{Summary:[headers,['RAW-1','No','Reviewed rationale','context-unspecified','Unspecified scenario','Unspecified mode']]},userPreprocessing:{'RAW-1':{values:{'Guide Phrase Applicable':'No'},basis:{'Operational Context ID':'context-unspecified','Operational Scenario':'Unspecified scenario'}}}};
const context={id:'ctx-1',scenario:'Urban operation',mode:'Autonomous'};
test('assigns the single context and retains row identity and imported decisions',()=>{
 const next=assignImportedHazardContext(run,[context]);
 expect(next.generatedSheets.Summary[1].slice(0,6)).toEqual(['RAW-1','No','Reviewed rationale','ctx-1','Urban operation','Autonomous']);
 expect(next.userPreprocessing['RAW-1'].basis['Operational Scenario']).toBe('Unspecified scenario');
 expect(next.userPreprocessingConflicts.length).toBe(1);
 expect(run.generatedSheets.Summary[1][3]).toBe('context-unspecified');
});
test('does not guess among contexts or alter completed runs',()=>{
 expect(assignImportedHazardContext(run,[context,{...context,id:'ctx-2'}])).toBe(run);
 const completed={...run,id:'cba-hazard-run-test',csvImportPreviousSummary:null};
 expect(assignImportedHazardContext(completed,[context])).toBe(completed);
});
test('updates a draft context by id without changing the imported values',()=>{
 const assigned=assignImportedHazardContext(run,[context]);
 expect(assignImportedHazardContext(assigned,[context])).toBe(assigned);
 const updated=assignImportedHazardContext(assigned,[{...context,scenario:'Highway'}]);
 expect(updated.generatedSheets.Summary[1][4]).toBe('Highway');expect(updated.generatedSheets.Summary[1][1]).toBe('No');
});

test('also assigns an import merged into an existing AI run',()=>{
 const existing={...run,id:'cba-hazard-run-test'};
 expect(assignImportedHazardContext(existing,[context]).generatedSheets.Summary[1][4]).toBe('Urban operation');
});
