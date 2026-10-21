import { createHazardPreprocessingMatcher, prepareCodeHazardPreprocessing, reconcileCodeHazardPreprocessing } from './codeArchitectureHazardPreprocessing';
import { recordUserPreprocessing } from '../project-hazard-analysis/hazardUserPreprocessing';
const headers=['Function (From)','Control Action','Function (To)','Guide Phrase','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Raw Analysis Row ID','Guide Phrase Applicable','Trace ID','Hazard'];
const baseline=['Planner','Plan','Executor','Too late','context-unspecified','Unspecified scenario','Unspecified mode','','RAW-1','','trace1',''];
const source={fromFunction:'Planner',controlAction:'Plan',toFunction:'Executor',guidePhrase:'Too late',operationalContextId:'context-unspecified',operationalScenario:'Unspecified scenario',operationalMode:'Unspecified mode',operatingConditions:'',traceId:'trace1'};
const input=()=>({tableRows:[source],sheets:{'Functional Decomposition':[['Control Action Details'],['']]}});
const previous=()=>{
 const row=[...baseline];row[9]='Yes';
 return {generatedSheets:{Summary:[headers,row]},userPreprocessing:{'RAW-1':recordUserPreprocessing(null,headers,row,['Guide Phrase Applicable'],baseline)}};
};
test('no preprocessing returns identical input and output objects',()=>{
 const original=input(); expect(prepareCodeHazardPreprocessing(original,{generatedSheets:{Summary:[headers,baseline]}})).toBe(original);
 const sheets={Summary:[headers,baseline]};expect(reconcileCodeHazardPreprocessing(sheets,original.tableRows).sheets).toBe(sheets);
});
test('supplies prior decisions to both AI input representations and preserves IDs in generated output',()=>{
 const prepared=prepareCodeHazardPreprocessing(input(),previous());
 expect(prepared.tableRows[0].guidePhraseApplicable).toBe('Yes');
 expect(prepared.sheets['Functional Decomposition'][1][0]).toContain('Guide Phrase Applicable');
 const row=[...baseline];row[8]='AI-ID';row[9]='No';row[11]='Completed hazard';
 const result=reconcileCodeHazardPreprocessing({Summary:[headers,row]},prepared.tableRows);
 expect(result.sheets.Summary[1][8]).toBe('RAW-1');expect(result.sheets.Summary[1][9]).toBe('Yes');
 expect(result.sheets.Summary[1][11]).toBe('Completed hazard');expect(result.conflicts.length).toBeGreaterThan(0);
 expect(result.ownership['RAW-1'].pending).toBe(false);
});
test('matching by trace still flags a changed interface basis',()=>{
 const current=input();current.tableRows=[{...source,controlAction:'New plan'}];
 const prepared=prepareCodeHazardPreprocessing(current,previous());
 expect(prepared.tableRows[0].controlDetails).toContain('basis changed');
});
test('a matching reviewed No reaches the sheet with its authoritative review status',()=>{
 const prior=previous();
 prior.generatedSheets.Summary[1][9]='No';
 prior.userPreprocessing['RAW-1'].values['Guide Phrase Applicable']='No';
 const current=input();
 current.sheets['Functional Decomposition'][0].push('Guide Phrase Applicable','Guide Phrase Applicability Rationale','Guide Phrase Applicability Review Status');
 current.sheets['Functional Decomposition'][1].push('','','');
 const prepared=prepareCodeHazardPreprocessing(current,prior);
 expect(prepared.tableRows[0].guidePhraseApplicabilityReviewStatus).toBe('Reviewed');
 expect(prepared.sheets['Functional Decomposition'][1].slice(1)).toEqual(['No','','Reviewed']);
});
test('a No decision with a changed context basis still reaches the AI skip and remains No in output',()=>{
 const prior=previous();
 prior.generatedSheets.Summary[1][9]='No';
 prior.userPreprocessing['RAW-1'].values['Guide Phrase Applicable']='No';
 const current=input();
 current.tableRows[0]={...source,operationalScenario:'New scenario'};
 current.sheets['Functional Decomposition'][0].push('Guide Phrase Applicable','Guide Phrase Applicability Rationale','Guide Phrase Applicability Review Status');
 current.sheets['Functional Decomposition'][1].push('','','');
 const prepared=prepareCodeHazardPreprocessing(current,prior);
 expect(prepared.tableRows[0].guidePhraseApplicabilityReviewStatus).toBe('Reviewed');
 expect(prepared.tableRows[0].guidePhraseApplicable).toBe('No');
 expect(prepared.sheets['Functional Decomposition'][1][1]).toBe('No');
 const generated=[...baseline];generated[9]='No';
 const result=reconcileCodeHazardPreprocessing({Summary:[headers,generated]},prepared.tableRows);
 expect(result.sheets.Summary[1][9]).toBe('No');
 expect(result.conflicts).toEqual(expect.arrayContaining([expect.stringContaining('context changed')]));
});

test.each(['HARA','FHA'])('%s preserves legacy blank-guide-phrase decisions after method labels are introduced',method=>{
 const row=[...baseline];row[3]='';row[9]='No';
 const basis=[...baseline];basis[3]='';
 const prior={hazardMethod:method,generatedSheets:{Summary:[headers,row]},userPreprocessing:{'RAW-1':recordUserPreprocessing(null,headers,row,['Guide Phrase Applicable'],basis)}};
 const current=input();
 current.tableRows=[{...source,guidePhrase:method==='HARA'?'Functional malfunction':'Functional degradation or loss'}];
 const prepared=prepareCodeHazardPreprocessing(current,prior);
 expect(prepared.tableRows[0].guidePhrase).toBe('');
 expect(prepared.tableRows[0].guidePhraseApplicable).toBe('No');
 expect(prepared.tableRows[0].userPreprocessingId).toBe('RAW-1');
});

test.each(['HARA','FHA'])('%s does not copy a legacy whole-function decision onto a new specific guide phrase',method=>{
 const row=[...baseline];row[3]='';row[9]='No';
 const basis=[...baseline];basis[3]='';
 const prior={hazardMethod:method,generatedSheets:{Summary:[headers,row]},userPreprocessing:{'RAW-1':recordUserPreprocessing(null,headers,row,['Guide Phrase Applicable'],basis)}};
 const current=input();
 current.tableRows=[{...source,guidePhrase:'The control action is provided too late'}];
 const prepared=prepareCodeHazardPreprocessing(current,prior);
 expect(prepared.tableRows[0].guidePhraseApplicable).toBeUndefined();
 expect(prepared.archivedUserPreprocessing['RAW-1'].values['Guide Phrase Applicable']).toBe('No');
 expect(prior.generatedSheets.Summary[1][9]).toBe('No');
});


test('indexed reconciliation retains ambiguous IDs and missing-column fallback semantics',()=>{
 const rows=[{...source,userPreprocessing:{},userPreprocessingId:'same'},{...source,controlAction:'Other',userPreprocessing:{},userPreprocessingId:'same'}];
 const columns=['Raw Analysis Row ID','Control Action'];
 const match=createHazardPreprocessingMatcher(rows,columns);
 expect(match(['same','Plan'])).toEqual([rows[0]]);
 expect(match(['missing','Other'])).toEqual([rows[1]]);
 expect(createHazardPreprocessingMatcher(rows,['Raw Analysis Row ID'])(['same'])).toHaveLength(2);
});
