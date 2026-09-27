import { fillNotApplicableHazardCells, fillNotApplicableHazardSummary } from './hazardNotApplicableCells';
const headers = ['Raw Analysis Row ID', 'Guide Phrase Applicable', 'Guide Phrase Applicability Rationale', 'Hazard', 'Safety Significant', 'Safety Significance Rationale', 'Operational Scenario', 'System Requirement'];
test('fills only blank downstream cells on excluded rows, preserving decisions and context', () => {
 const row=['RAW-1','No','Discrete transaction','','No','No applicable harm path','Pickup','Existing requirement'];
 expect(fillNotApplicableHazardCells(headers,row)).toEqual(['RAW-1','No','Discrete transaction','Not Applicable','No','No applicable harm path','Pickup','Existing requirement']);
 expect(row[3]).toBe('');
});
test.each(['Yes','Needs Review',''])('does not fill cells for applicability %p', applicability => {
 const row=['RAW-1',applicability,'','','','','',''];
 expect(fillNotApplicableHazardCells(headers,row)).toBe(row);
});
test('is idempotent and leaves missing identity and context blank', () => {
 const summary=[headers,['','No','','','','','','']];
 const filled=fillNotApplicableHazardSummary(summary);
 expect(filled[1][0]).toBe('');expect(filled[1][6]).toBe('');expect(filled[1][2]).toBe('');
 expect(fillNotApplicableHazardSummary(filled)).toBe(filled);
});
