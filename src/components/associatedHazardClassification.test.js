import { classifyAssociatedHazard as classify } from './associatedHazardClassification';
const headers=['Safety Classification','Safety Significant','Guide Phrase Applicable','Proposed Safety Assessment'];
test.each([
 ['Safety — Direct','Yes','Yes','', 'Safety'],
 ['Safety — Related','Yes','Yes','', 'Safety'],
 ['Mission/Reliability','No','Yes','Safety','Mission/Reliability'],
 ['Not Applicable','No','No','Safety','Not Applicable'],
 ['Needs Review','Yes','Yes','Safety','Needs Review'],
 ['','','','','Needs Review'],
 ['','No','Yes','','Mission/Reliability'],
 ['','','Yes','Safety','Safety'],
])('groups governed or legacy row %s', (classification,significant,applicable,legacy,expected)=>{
 expect(classify(headers,[classification,significant,applicable,legacy])).toBe(expected);
});
test('missing obsolete column does not classify excluded and mission rows as safety',()=>{
 const h=['Guide Phrase Applicable','Safety Classification'];
 const rows=[['No','Not Applicable'],['Yes','Mission/Reliability'],['Yes','Safety — Related']];
 expect(rows.map(row=>classify(h,row))).toEqual(['Not Applicable','Mission/Reliability','Safety']);
});
