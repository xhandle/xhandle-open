import {hazardContentFingerprint} from './hazardContentFingerprint';
import {haraText,refreshProjectHaraSheets,normalizeHaraRating} from './projectHara';
import {HARA_REVIEW_FIELDS,HARA_REVIEW_ISSUE_FIELDS,HARA_REVIEW_CHANGE_GROUPS,haraFinalReviewFindings,unsafeLateStopRule,invalidHaraTiming} from './haraReviewInspection';
export {haraFinalReviewFindings,unsafeLateStopRule,invalidHaraTiming};

export const HARA_FINAL_REVIEW_VERSION='projects-hara-final-review-v4';
export const HARA_FINAL_REVIEW_FIELDS=HARA_REVIEW_FIELDS;
const sourceFields=['Function (From)','Control Action','Function (To)','Subsystem Allocation','Guide Phrase','Loss','Hazard',
  'Unsafe Control Action','Causal Scenario','Safety Constraint','System Requirement','STPA Source Row ID',
  'Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Context Assumptions'];
const issueFields=HARA_REVIEW_ISSUE_FIELDS;
export const haraReviewSignature=value=>hazardContentFingerprint(value).signature;
const cells=(headers,row)=>Object.fromEntries(headers.map((header,index)=>[header,haraText(row[index])]));

export function haraReviewProtectedCells(headers,drafts={}) {
  const index=headers.indexOf('Raw Analysis Row ID'),protectedCells=new Map();
  if(index<0)return protectedCells;
  for(const draft of Object.values(drafts)){
    const id=haraText(draft?.row?.[index]);if(!id)continue;
    const fields=protectedCells.get(id)||new Set();
    Object.keys(draft.userPreprocessing?.values||{}).forEach(field=>fields.add(field));
    protectedCells.set(id,fields);
  }
  return protectedCells;
}
export function haraReviewRecords(sheets,protectedCells=new Map()) {
  const [headers=[],...rows]=sheets?.Summary||[],all=rows.map(row=>cells(headers,row));
  const counts=new Map();for(const row of all){const id=row['Raw Analysis Row ID'];if(id)counts.set(id,(counts.get(id)||0)+1);}
  return all.filter(row=>!/^no$/i.test(row['Guide Phrase Applicable'])&&row['Raw Analysis Row ID']&&counts.get(row['Raw Analysis Row ID'])===1)
    .map(row=>{
      const id=row['Raw Analysis Row ID'],locked=[...(protectedCells.get(id)||[])].sort();
      return {id,hash:haraReviewSignature({row,locked}),row,locked,findings:haraFinalReviewFindings(row)};
    }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
export function haraReviewInput(record) {
  return {id:record.id,hash:record.hash,goalId:record.row['Safety Goal ID'],locked:record.locked,findings:record.findings,
    source:Object.fromEntries(sourceFields.filter(field=>record.row[field]).map(field=>[field,record.row[field]])),
    assessment:Object.fromEntries([...HARA_FINAL_REVIEW_FIELDS].filter(field=>record.row[field]).map(field=>[field,record.row[field]]))};
}

// Refine a shared objective consistently, preserving every event link and any
// analyst-owned goal. Conflicting suggestions retain the current objective.
export function harmonizeHaraReviewGoals(records,patches) {
  const groups=new Map(),byId=new Map(records.map(record=>[record.id,record])),counts=new Map(),retained=[];
  for(const patch of patches)counts.set(patch.id,(counts.get(patch.id)||0)+1);
  const unique=patches.filter(patch=>byId.has(patch.id)&&counts.get(patch.id)===1);
  const proposed=new Map(unique.map(patch=>[patch.id,{...patch,changes:{...patch.changes}}]));
  for(const record of records){const goalId=record.row['Safety Goal ID'];if(!goalId)continue;if(!groups.has(goalId))groups.set(goalId,[]);groups.get(goalId).push(record);}
  for(const members of groups.values()){
    const changed=members.map(record=>proposed.get(record.id)).filter(patch=>typeof patch?.changes?.['Safety Goal']==='string');
    if(!changed.length)continue;
    const statements=new Set(changed.map(patch=>patch.changes['Safety Goal']));
    if(statements.size!==1||members.some(record=>record.locked.includes('Safety Goal'))){
      for(const patch of changed){delete patch.changes['Safety Goal'];delete patch.changes['Safety Goal Rationale'];retained.push({id:patch.id,errors:['Shared goal retained because suggestions conflict or an analyst owns a linked goal.']});}
      continue;
    }
    const exemplar=changed[0];
    for(const record of members){
      const patch=proposed.get(record.id)||{id:record.id,hash:record.hash,reason:exemplar.reason,changes:{}};
      patch.changes['Safety Goal']=exemplar.changes['Safety Goal'];
      if(exemplar.changes['Safety Goal Rationale']&&!record.locked.includes('Safety Goal Rationale'))patch.changes['Safety Goal Rationale']=exemplar.changes['Safety Goal Rationale'];
      proposed.set(record.id,patch);
    }
  }
  return {patches:[...proposed.values()].filter(patch=>Object.keys(patch.changes).length),retained};
}

export function validateHaraReviewPatch(record,patch,{structuralOnly=false}={}) {
  const errors=[];
  if(!record||patch?.id!==record.id||patch?.hash!==record.hash)return ['Unknown, ambiguous or stale assessment identity.'];
  if(typeof patch.reason!=='string'||!patch.reason.trim()||patch.reason.length>2000)errors.push('Provide a concise correction reason.');
  if(!patch.changes||typeof patch.changes!=='object'||Array.isArray(patch.changes))return [...errors,'Provide field-specific changes.'];
  const entries=Object.entries(patch.changes);
  if(!entries.length||entries.length>HARA_FINAL_REVIEW_FIELDS.size)return [...errors,'Provide a nonempty bounded patch.'];
  for(const [field,value] of entries){
    if(!HARA_FINAL_REVIEW_FIELDS.has(field)||!(field in record.row))errors.push(`Cannot change ${field}.`);
    if(record.locked.includes(field))errors.push(`Analyst-owned cell: ${field}.`);
    if(typeof value!=='string'||!value.trim()||value.length>16000||/^(?:needs review|tbd|unknown|not provided|provisional|incomplete|pending review|assessment incomplete)[.!]?$/i.test(value.trim()))errors.push(`Return a final text decision for ${field}.`);
  }
  if(structuralOnly)return [...new Set(errors)];
  const next={...record.row,...patch.changes};
  for(const [field,prefix,max] of [['Severity','S',3],['Exposure','E',4],['Controllability','C',3]]){
    if(field in patch.changes){
      if(!normalizeHaraRating(next[field],prefix,max)||normalizeHaraRating(next[field],prefix,max)!==next[field])errors.push(`Invalid ${field} class.`);
      if(next[field]!==record.row[field]&&!haraText(patch.changes[`${field} Rationale`]))errors.push(`Changing ${field} requires its rationale in the same patch.`);
    }
  }
  if('Safety Goal' in patch.changes&&!/\bshall\b/i.test(next['Safety Goal']))errors.push('Use a complete shall safety goal.');
  const beforeCodes=new Set(record.findings.map(issue=>issue.code));
  for(const issue of haraFinalReviewFindings(next)){
    if(!beforeCodes.has(issue.code)||(issue.fields||issueFields[issue.code]||[]).some(field=>field in patch.changes))errors.push(`Unresolved correction: ${issue.code}.`);
  }
  return [...new Set(errors)];
}

export function haraReviewChangeGroups(record,patch) {
  const structural=validateHaraReviewPatch(record,patch,{structuralOnly:true});
  if(structural.length)return {groups:[],rejected:[{id:patch?.id,errors:structural}]};
  const groups=[],rejected=[];
  const parts=new Map(Object.entries(HARA_REVIEW_CHANGE_GROUPS).map(([group,fields])=>[group,
    Object.fromEntries(Object.entries(patch.changes).filter(([field,value])=>fields.includes(field)&&haraText(record.row[field])!==value))]));
  // Response deadlines and physical timing form one dependency when both are
  // edited; a verifier cannot approve a deadline using a rejected new FTTI.
  if(Object.keys(parts.get('response')).length&&Object.keys(parts.get('timing')).length){
    parts.set('responseTiming',{...parts.get('response'),...parts.get('timing')});parts.delete('response');parts.delete('timing');
  }
  if(Object.keys(parts.get('event')).length&&Object.keys(parts.get('injury')).length){
    parts.set('eventInjury',{...parts.get('event'),...parts.get('injury')});parts.delete('event');parts.delete('injury');
  }
  for(const [group,changes]of parts){
    if(!Object.keys(changes).length)continue;
    const candidate={...patch,changes},errors=validateHaraReviewPatch(record,candidate);
    if(errors.length){rejected.push({id:record.id,fields:Object.keys(changes),errors});continue;}
    const changeId='change-'+haraReviewSignature({hash:record.hash,group,changes}).slice(-16);
    groups.push({...candidate,changeId,group});
  }
  return {groups,rejected};
}

export function applyHaraReviewPatches(sheets,records,patches,{runId='',retained=[],reviewedRows=records.length}={}) {
  const [headers=[],...sourceRows]=sheets.Summary||[],byId=new Map(records.map(record=>[record.id,record]));
  const idIndex=headers.indexOf('Raw Analysis Row ID'),seen=new Map();
  const rowCounts=new Map();for(const row of sourceRows){const id=haraText(row[idIndex]);rowCounts.set(id,(rowCounts.get(id)||0)+1);}
  for(const patch of patches)seen.set(patch.id,(seen.get(patch.id)||0)+1);
  const accepted=new Map(),rejected=[];
  for(const patch of patches){
    const record=byId.get(patch.id),errors=seen.get(patch.id)!==1?['Duplicate patch identity.']:validateHaraReviewPatch(record,patch);
    if(errors.length){rejected.push({id:patch.id,errors});continue;}
    accepted.set(patch.id,patch);
  }
  const changes=[],rows=sourceRows.map(source=>{
    const id=haraText(source[idIndex]),record=byId.get(id),patch=accepted.get(id);
    if(!patch||!record)return source;
    if(rowCounts.get(id)!==1||haraReviewSignature({row:cells(headers,source),locked:record.locked})!==record.hash){
      rejected.push({id,errors:['Current assessment no longer matches the reviewed snapshot.']});return source;
    }
    const row=[...source];
    for(const [field,after] of Object.entries(patch.changes)){
      const index=headers.indexOf(field),before=haraText(source[index]);
      if(before===after)continue;
      row[index]=after;changes.push({id,field,before,after,reason:patch.reason});
    }
    return row;
  });
  const inputSignature=haraReviewSignature(sheets.Summary),reviewId=haraReviewSignature({runId,inputSignature,version:HARA_FINAL_REVIEW_VERSION}).slice(-20);
  const history=[...(sheets.haraPostReviewHistory||[]).filter(entry=>entry.id!==reviewId)];
  if(changes.length)history.push({id:reviewId,runId,version:HARA_FINAL_REVIEW_VERSION,changes});
  const result=refreshProjectHaraSheets({...sheets,Summary:[headers,...rows]},{practical:true});
  result.haraPostReviewHistory=history.slice(-3);
  result.haraPostReview={version:HARA_FINAL_REVIEW_VERSION,runId,inputSignature,resultSignature:haraReviewSignature(result.Summary),
    reviewedRows,changedRows:new Set(changes.map(change=>change.id)).size,changedCells:changes.length,retained:[...retained,...rejected]};
  return {sheets:result,rejected,changedCells:changes.length};
}

export function synchronizeHaraReviewDrafts(before,after,drafts,headers=after.Summary?.[0]||[]) {
  const input=before.Summary||[],output=after.Summary||[],inputId=input[0]?.indexOf('Raw Analysis Row ID')??-1,outputId=output[0]?.indexOf('Raw Analysis Row ID')??-1;
  const index=headers.indexOf('Raw Analysis Row ID');if(index<0||inputId<0||outputId<0)return drafts;
  const previous=new Map(input.slice(1).map(row=>[haraText(row[inputId]),cells(input[0],row)]));
  const next=new Map(output.slice(1).map(row=>[haraText(row[outputId]),cells(output[0],row)]));
  return Object.fromEntries(Object.entries(drafts||{}).map(([key,draft])=>{
    const id=haraText(draft.row?.[index]),old=previous.get(id),updated=next.get(id);
    if(!old||!updated)return [key,draft];
    const changed=headers.filter(header=>header in updated&&old[header]!==updated[header]);
    if(!changed.length)return [key,draft];
    const row=[...draft.row];for(const header of changed)row[headers.indexOf(header)]=updated[header];
    return [key,{...draft,row}];
  }));
}
export const lastHaraReviewChange=sheets=>[...(sheets?.haraPostReviewHistory||[])].reverse().find(entry=>!entry.undone&&entry.changes?.length);
export function undoHaraFinalReview(sheets,{protectedCells=new Map()}={}) {
  const entry=lastHaraReviewChange(sheets);if(!entry)return {sheets,reversed:0,skipped:0};
  const [headers,...source]=sheets.Summary,idIndex=headers.indexOf('Raw Analysis Row ID'),changes=new Map();let reversed=0,skipped=0;
  for(const change of entry.changes){if(!changes.has(change.id))changes.set(change.id,[]);changes.get(change.id).push(change);}
  const rowCounts=new Map();for(const row of source){const id=haraText(row[idIndex]);rowCounts.set(id,(rowCounts.get(id)||0)+1);}
  const pairs=[['Severity','Severity Rationale'],['Exposure','Exposure Rationale'],['Controllability','Controllability Rationale'],
    ['Safety Goal','Safety Goal Rationale'],['Fault Tolerant Time Interval','FTTI Rationale']];
  const rows=source.map(source=>{
    const row=[...source],id=haraText(row[idIndex]),rowChanges=changes.get(id)||[],blocked=new Set();
    for(const change of rowChanges){const index=headers.indexOf(change.field);
      if(rowCounts.get(id)!==1||index<0||haraText(row[index])!==change.after||protectedCells.get(id)?.has(change.field))blocked.add(change.field);
    }
    for(const pair of pairs)if(pair.some(field=>blocked.has(field)))pair.forEach(field=>blocked.add(field));
    for(const change of rowChanges){if(blocked.has(change.field))continue;row[headers.indexOf(change.field)]=change.before;reversed++;}
    return row;
  });
  skipped=entry.changes.length-reversed;
  const result=refreshProjectHaraSheets({...sheets,Summary:[headers,...rows]},{practical:true});
  result.haraPostReviewHistory=sheets.haraPostReviewHistory.map(item=>item.id===entry.id?{...item,undone:true}:item);
  result.haraPostReview={...sheets.haraPostReview,resultSignature:haraReviewSignature(result.Summary),undone:true};
  return {sheets:result,reversed,skipped};
}
export function haraReviewHistorySheet(sheets) {
  return [['Review','Raw Analysis Row ID','Field','Before','After','Reason','Undone'],...(sheets?.haraPostReviewHistory||[]).flatMap(entry=>entry.changes.map(change=>[entry.id,change.id,change.field,change.before,change.after,change.reason,entry.undone?'Yes':'No']))];
}
