import {PROJECT_HARA_HEADERS,refreshProjectHaraSheets} from './projectHara';
import {haraReviewRecords,validateHaraReviewPatch,applyHaraReviewPatches,haraFinalReviewFindings,
  haraReviewProtectedCells,synchronizeHaraReviewDrafts,undoHaraFinalReview,haraReviewHistorySheet,
  harmonizeHaraReviewGoals,unsafeLateStopRule,invalidHaraTiming} from './haraFinalReview';

export const fixture=(overrides={})=>{
  const headers=[...new Set(['Raw Analysis Row ID','STPA Source Row ID','System Requirement','Functional Safety Requirements',...PROJECT_HARA_HEADERS])];
  const base={'Raw Analysis Row ID':'row-a','STPA Source Row ID':'stpa-a','Hazardous Event ID':'HE-a','Item ID':'ITEM-a',Item:'Automated braking',
    'Item Definition':'Controller and actuator provide vehicle braking.',Loss:'Human injury',Hazard:'Uncontrolled motion',
    'Unsafe Control Action':'Braking omitted at an occupied crossing.','Safety Constraint':'Stop before occupied crossings.',
    'System Requirement':'The vehicle controller shall command braking.', 'Guide Phrase Applicable':'Yes',
    'Hazardous Event':'The vehicle enters an occupied crossing without stopping.','Potential Harm':'Fatal pedestrian injury.',
    Severity:'S3','Severity Rationale':'Impact can fatally injure a pedestrian.',Exposure:'E4','Exposure Rationale':'Occupied crossings are frequent in intended service.',
    Controllability:'C0','Controllability Rationale':'The pedestrian cannot avoid the impact.',
    'Safety Goal':'The vehicle shall prevent loss of braking at occupied crossings.','Safety Goal Rationale':'Prevent crossing impact.',
    'Safe State':'Stationary outside the crossing.','Fault Tolerant Time Interval':'distance / closing speed',
    'FTTI Rationale':'The fault-to-hazard interval is clearance divided by closing speed; detection plus complete braking must fit inside it.',
    'Functional Safety Requirements':'The vehicle shall preserve emergency braking.',...overrides};
  return refreshProjectHaraSheets({Summary:[headers,headers.map(header=>base[header]||'')]},{practical:true});
};
const value=(sheets,field,row=1)=>sheets.Summary[row][sheets.Summary[0].indexOf(field)];
const patch=(record,changes)=>({id:record.id,hash:record.hash,reason:'Correct the harm avoidance contradiction.',changes});
const fix={'Controllability':'C3','Controllability Rationale':'The exposed pedestrian cannot avoid the impact within the available distance.'};

test('corrects only targeted HARA cells; recomputes ASIL, goals and linked requirements; source remains intact',()=>{
  const source=fixture(),original=JSON.stringify(source),records=haraReviewRecords(source);
  const {sheets}=applyHaraReviewPatches(source,records,[patch(records[0],fix)],{runId:'synthetic'});
  expect(value(sheets,'ASIL')).toBe('ASIL D');expect(value(sheets,'Safety Goal ASIL')).toBe('ASIL D');
  for(const name of ['Raw Analysis Row ID','STPA Source Row ID','Hazardous Event ID','Item','Item ID','Item Definition','Loss','Hazard','Unsafe Control Action','System Requirement','Safety Constraint'])expect(value(sheets,name)).toBe(value(source,name));
  expect(sheets['Functional Safety Requirements'][1][4]).toBe('ASIL D');expect(sheets.HARA).toEqual(sheets.Summary);
  expect(sheets.haraPostReview.changedCells).toBe(2);expect(haraReviewHistorySheet(sheets)).toHaveLength(3);
  expect(JSON.stringify(source)).toBe(original);
});

test('rejects stale/unknown IDs, source rewrites, analyst edits and partial decision patches atomically',()=>{
  const source=fixture(),record=haraReviewRecords(source)[0];
  for(const proposal of [patch(record,{...fix,Hazard:'Changed'}),{...patch(record,fix),hash:'old'},
    {...patch(record,fix),id:'unknown'},patch(record,{Controllability:'C3'}),patch(record,{Controllability:'C9','Controllability Rationale':'Bad class.'}),
    patch(record,{'Safe State':'Needs review'})])expect(validateHaraReviewPatch(record,proposal).length).toBeGreaterThan(0);
  const protectedRecord=haraReviewRecords(source,new Map([['row-a',new Set(['Controllability'])]]))[0];
  expect(validateHaraReviewPatch(protectedRecord,patch(protectedRecord,fix))).toContain('Analyst-owned cell: Controllability.');
  expect(value(applyHaraReviewPatches(source,[record],[patch(record,{...fix,Hazard:'Changed'})]).sheets,'Controllability')).toBe('C0');
});

test('duplicate IDs/patches and changed current snapshots cannot be applied; ordering never determines the target',()=>{
  const source=fixture(),records=haraReviewRecords(source),proposal=patch(records[0],fix);
  expect(applyHaraReviewPatches(source,records,[proposal,proposal]).changedCells).toBe(0);
  const duplicate={...source,Summary:[source.Summary[0],source.Summary[1],source.Summary[1]]};
  expect(haraReviewRecords(duplicate)).toHaveLength(0);expect(applyHaraReviewPatches(duplicate,records,[proposal]).changedCells).toBe(0);
  const changed=fixture({'Potential Harm':'Later analyst change.'});
  expect(applyHaraReviewPatches(changed,records,[proposal]).rejected[0].errors[0]).toContain('snapshot');
  const second=fixture({'Raw Analysis Row ID':'row-b','Hazardous Event ID':'HE-b',Controllability:'C1','Controllability Rationale':'An attentive pedestrian can easily step clear.'});
  const reordered={...source,Summary:[source.Summary[0],second.Summary[1],source.Summary[1]]};
  const result=applyHaraReviewPatches(reordered,haraReviewRecords(reordered),[proposal]).sheets;
  expect(value(result,'Controllability',1)).toBe('C1');expect(value(result,'Controllability',2)).toBe('C3');
});

test('legitimate C0 remains; targeted detectors catch late emergency stopping, invalid units and template events',()=>{
  expect(haraReviewRecords(fixture({Controllability:'C0','Controllability Rationale':'Generally controllable: people can easily step clear with ample available time.'}))[0].findings).toEqual([]);
  expect(unsafeLateStopRule('The controller shall reject stop requests older than 200 ms.')).toBe(true);
  expect(unsafeLateStopRule('Reject stale non-emergency motion requests; preserve emergency braking while the hazard remains.')).toBe(false);
  expect(unsafeLateStopRule('The controller shall not reject stale emergency stop requests while the hazard remains.')).toBe(false);
  expect(invalidHaraTiming('FTTI = stopping distance + network latency.')).toBe(true);
  expect(invalidHaraTiming('FTTI = clearance distance / closing speed; the response must finish before hazard onset.')).toBe(false);
  const row=haraReviewRecords(fixture({'Hazardous Event':'The item performs its dependent operation using an absent, invalid or obsolete result.'}))[0].row;
  expect(haraFinalReviewFindings(row).map(issue=>issue.code)).toContain('EVENT');
});

test('shared goal corrections propagate consistently, preserve protected goals and retain conflicting suggestions',()=>{
  const source=fixture(),second=fixture({'Raw Analysis Row ID':'row-b','Hazardous Event ID':'HE-b'});
  const sheets={...source,Summary:[source.Summary[0],source.Summary[1],second.Summary[1]]},records=haraReviewRecords(sheets);
  const goal='The vehicle shall prevent entry into occupied crossings without sufficient stopping distance.';
  const result=harmonizeHaraReviewGoals(records,[patch(records[0],{'Safety Goal':goal})]);
  expect(result.patches).toHaveLength(2);expect(result.patches[1].changes['Safety Goal']).toBe(goal);
  const locked=haraReviewRecords(sheets,new Map([['row-b',new Set(['Safety Goal'])]]));
  expect(harmonizeHaraReviewGoals(locked,[patch(locked[0],{'Safety Goal':goal})]).patches).toEqual([]);
  expect(harmonizeHaraReviewGoals(records,[patch(records[0],{'Safety Goal':goal}),patch(records[1],{'Safety Goal':'The vehicle shall avoid pedestrian collision.'})]).patches).toEqual([]);
});

test('draft synchronization includes derived cells and undo preserves later edits including linked rationales',()=>{
  const source=fixture(),records=haraReviewRecords(source),reviewed=applyHaraReviewPatches(source,records,[patch(records[0],fix)],{runId:'review'}).sheets;
  const drafts={key:{row:source.Summary[1],generated:true,userPreprocessing:{values:{'Safe State':'Analyst state'}}}};
  expect(haraReviewProtectedCells(source.Summary[0],drafts).get('row-a')).toEqual(new Set(['Safe State']));
  const synced=synchronizeHaraReviewDrafts(source,reviewed,drafts);
  expect(synced.key.row[source.Summary[0].indexOf('ASIL')]).toBe('ASIL D');expect(synced.key.userPreprocessing).toBe(drafts.key.userPreprocessing);
  const undo=undoHaraFinalReview(JSON.parse(JSON.stringify(reviewed)));
  expect(undo.reversed).toBe(2);expect(value(undo.sheets,'Controllability')).toBe('C0');expect(value(undo.sheets,'ASIL')).toBe('Not assigned');
  const edited={...reviewed,Summary:reviewed.Summary.map(row=>[...row])};edited.Summary[1][edited.Summary[0].indexOf('Controllability Rationale')]='Later analyst reasoning.';
  const retained=undoHaraFinalReview(edited);expect(retained.reversed).toBe(0);expect(retained.skipped).toBe(2);expect(value(retained.sheets,'Controllability')).toBe('C3');
  expect(undoHaraFinalReview(reviewed,{protectedCells:new Map([['row-a',new Set(['Controllability'])]])}).reversed).toBe(0);
});
