import { selectHazardDisplayRow } from './hazardDisplayRow';
import { planHazardAnalysisCsvImport, applyHazardAnalysisCsvImport } from './hazardAnalysisCsv';
import { toCsvText } from '../../lib/csv';

test.each(['Yes', 'No'])('imported %s applicability is visible before generation', value => {
  const headers = ['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Guide Phrase','Guide Phrase Applicable','Guide Phrase Applicability Rationale'];
  const fallbackRow = ['CURRENT','Operator','Drive','Vehicle','Providing','',''];
  const summary = [headers,fallbackRow];
  const csv = toCsvText([headers.slice(1),['Operator','Drive','Vehicle','Providing',value,'Reviewed rationale']]);
  const plan = planHazardAnalysisCsvImport(summary,csv);
  expect(plan.errors).toEqual([]);
  const alignedCompleted = applyHazardAnalysisCsvImport(summary,plan.updates)[1];
  const displayed = selectHazardDisplayRow({generatedDraft:false, generatedCompleted:false,alignedDraft:fallbackRow,alignedCompleted,fallbackRow});
  expect(displayed.slice(-2)).toEqual([value,'Reviewed rationale']);
  expect(fallbackRow.slice(-2)).toEqual(['','']);
});
test('pending draft assessments remain visible without a completed summary',()=>{
 expect(selectHazardDisplayRow({fallbackRow:['',''],alignedDraft:['No','Discrete action']})).toEqual(['No','Discrete action']);
});
test('generated row precedence remains unchanged',()=>{
 const args={fallbackRow:[''],alignedDraft:['draft'],alignedCompleted:['completed']};
 expect(selectHazardDisplayRow({...args,generatedDraft:true,generatedCompleted:true})).toBe(args.alignedDraft);
 expect(selectHazardDisplayRow({...args,generatedCompleted:true})).toBe(args.alignedCompleted);
 expect(selectHazardDisplayRow({fallbackRow:['']})).toEqual(['']);
});
