import { hazardContentFingerprint } from './hazardContentFingerprint';

const text=value=>String(value&&typeof value==='object'&&'value' in value?value.value??'':value??'').trim();
const fields={from:['fromFunction','Function (From)'],fromDetails:['fromDetails','fromFunctionDetails','Function (From) Details'],
  action:['controlAction','Control Action'],actionDetails:['controlDetails','controlActionDetails','Control Action Details'],
  to:['toFunction','Function (To)'],toDetails:['toDetails','toFunctionDetails','Function (To) Details'],
  subsystem:['subsystem','Subsystem','Subsystem Allocation']};

// Ignore guide/context expansion and row order. Item scope comes from the full
// functional graph, not the subset of hazard rows currently being generated.
export function projectHaraItemDecomposition(sheets={},functionalRows=[]) {
  const [headers=[],...rows]=sheets?.['Functional Decomposition']||[];
  const source=functionalRows.length?functionalRows:rows.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]])));
  const unique=new Map();
  for(const row of source){
    const entry=Object.fromEntries(Object.entries(fields).map(([key,aliases])=>[key,text(aliases.map(alias=>row[alias]).find(value=>text(value)))]));
    if(!entry.from&&!entry.to&&!entry.action)continue;
    unique.set(JSON.stringify(entry),entry);
  }
  return [...unique.values()].sort((a,b)=>{const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0;});
}

export const projectHaraItemBasis=(decomposition,organizationContext='')=>hazardContentFingerprint({version:1,decomposition,organizationContext}).signature;
export function createProjectHaraItem(input={},basis='',origin='ai') {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  if(typeof input.name!=='string'||typeof input.definition!=='string')return null;
  const name=text(input.name),definition=text(input.definition);
  if(!name||!definition||name.length>180||definition.length>12000||/^(?:unknown|needs review|tbd|not provided)\b/i.test(name))return null;
  const digest=hazardContentFingerprint({name,definition}).signature.split(':').pop();
  return {id:/^ITEM-[A-F0-9]{12}$/.test(text(input.id))?text(input.id):`ITEM-${digest.slice(0,12).toUpperCase()}`,name,definition,
    rationale:typeof input.rationale==='string'?input.rationale.trim():'',basis,origin,revision:digest};
}
export function projectHaraItemDefinitionSheet(sheets={},legacyDefinition='') {
  const item=sheets?.haraItem;
  if(item?.name&&item?.definition)return [['Item ID','Item','Item Definition','Selection Rationale'],[item.id,item.name,item.definition,item.rationale||'']];
  if(sheets?.['HARA Item Definition']?.length>1)return sheets['HARA Item Definition'];
  const summary=sheets?.Summary||[],index=summary[0]?.indexOf('Item Definition')??-1;
  const definitions=[...new Set([text(legacyDefinition),...summary.slice(1).map(row=>text(row[index]))].filter(Boolean))];
  return [['Item Definition'],...definitions.map(value=>[value])];
}
