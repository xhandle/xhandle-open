import { applyHazardAnalysisCsvImport, applyHazardCsvImportToDrafts } from './hazardAnalysisCsv';
const headers=['Raw Analysis Row ID','Guide Phrase Applicable','Safety Classification','Safety Significant','Hazard','Loss','Causal Effect','Resulting System State','Protection Assessment','Physical-Harm Chain Termination','Classification Resolution Status'];
test('import derives resolution rather than trusting CSV status, including draft mirror',()=>{
 const row=['RAW-1','No','Not Applicable','No','Not Applicable','Not Applicable','','','','','Policy Validation Gap'];
 const updates=[{rowIndex:1,rowId:'RAW-1',changes:[{summaryIndex:10,header:headers[10],value:'Policy Validation Gap'}]}];
 expect(applyHazardAnalysisCsvImport([headers,row],updates)[1][10]).toBe('Policy Validated');
 expect(applyHazardCsvImportToDrafts({one:{row}},headers,updates).one.row[10]).toBe('Policy Validated');
 expect(row[10]).toBe('Policy Validation Gap');
});
test('CSV cannot claim validation for an unresolved decision',()=>{
 const row=['RAW-1','Yes','Needs Review','Needs Review','','','','','','','Policy Validated'];
 const updates=[{rowIndex:1,changes:[{summaryIndex:10,value:'Policy Validated'}]}];
 expect(applyHazardAnalysisCsvImport([headers,row],updates)[1][10]).toBe('Needs Review');
});
