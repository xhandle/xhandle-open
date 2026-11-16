import { semanticHash } from './artifactModel';
import { requirementDerivationMode } from './requirementDerivation';

const text = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : value ? [String(value)] : [];
export function hazardRequirementOwners(config) {
  const area = config.templateId === 'system-spec' ? 'functional'
    : config.templateId === 'software-spec' && requirementDerivationMode(config) === 'code-first' ? 'code-architecture' : null;
  return area ? (config.ownerProjects || [{id:config.projectId,workspaceType:config.workspaceType}]).filter(owner=>owner.workspaceType===area) : [];
}
export function requirementSafetyFlag(source) {
  const attributes=source?.attributes || {};
  const value=text(attributes['Safety Significant'] || source?.safetySignificant);
  if (/^yes$/i.test(value)) return 'Yes';
  if (/needs? review|unknown|unresolved/i.test(value)) return 'Needs review';
  if (/^Safety\s*[—–-]\s*(Direct|Related)$/i.test(text(attributes['Safety Classification']))) return 'Yes';
  if (/^no$/i.test(value)) return 'No';
  return 'Not assessed';
}

// Keep only normative safety content and its provenance. Do not copy a full
// hazard table, architecture snapshot or analysis narrative into the document.
export function projectHazardRequirements(cells, provenance) {
  const applicable=text(cells['Guide Phrase Applicable']);
  const classification=text(cells['Safety Classification']);
  const significant=text(cells['Safety Significant']);
  const direct = /^Safety\s*[—–-]\s*(Direct|Related)$/i.test(classification);
  if (/^no$/i.test(applicable) || (!direct && (/^no$/i.test(significant) || /^(Mission\/Reliability|Not Applicable)$/i.test(classification)))) return [];
  const fields = provenance.workspaceType==='code-architecture'
    ? ['Software Safety Requirement','Software Requirement','System Requirement','Safety Constraint','Safety Requirements/Constraints','Safety Goal']
    : ['System Requirement','Safety Requirement','Safety Constraint','Safety Requirements/Constraints','Safety Goal'];
  const unique = new Set();
  return fields.flatMap(field => {
    const requirement = text(cells[field]);
    const normalized = requirement.toLowerCase().replace(/\s+/g, ' ');
    if (!requirement || /^(not applicable|needs review|unresolved|none\b|n\/a\b)/i.test(requirement) || unique.has(normalized)) return [];
    unique.add(normalized);
    const flag = requirementSafetyFlag({ attributes: cells });
    const safety = flag === 'Not assessed' ? (/Safety/.test(field) ? 'Yes' : 'Needs review') : flag;
    const id = `hazard-requirement:${semanticHash([provenance.workspaceType, provenance.projectId, normalized])}`;
    return [{ id, sourceType: 'hazard-derived-requirement', kind: /\bshall\b/i.test(requirement) ? 'requirement' : 'constraint',
      title: `Safety obligation — ${requirement.slice(0, 120)}`, text: requirement,
      ownerProjects: [{ id: provenance.projectId, workspaceType: provenance.workspaceType }],
      attributes: { 'Safety Significant': safety, ...(classification ? { 'Safety Classification': classification } : {}),
        ...(text(cells.ASIL) ? { 'Source ASIL': text(cells.ASIL) } : {}),
        ...(text(cells['Verification Method'] || cells.Verification) ? { 'Verification Method': text(cells['Verification Method'] || cells.Verification) } : {}) },
      hazardReferences: [provenance], status: 'Recorded — review required' }];
  });
}
export function mergeHazardRequirementSources(entries) {
  const unique=new Map();
  for(const entry of entries) {
    const prior=unique.get(entry.id);
    if(!prior){unique.set(entry.id,entry);continue;}
    prior.hazardReferences.push(...entry.hazardReferences);
    if(requirementSafetyFlag(entry)==='Yes') prior.attributes['Safety Significant']='Yes';
    const asils=[...new Set([prior.attributes['Source ASIL'],entry.attributes['Source ASIL']].filter(Boolean).flatMap(value=>value.split(';').map(text)))];
    if(asils.length) prior.attributes['Source ASIL']=asils.sort().join('; ');
  }
  return [...unique.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

export function inheritRequirementSafety(objects, sources) {
  const index=new Map((Array.isArray(sources) ? sources : sources?.entries || []).map(source=>[source.id,source]));
  return objects.map(object=>{
    if(object.kind!=='requirement' && object.proposedKind!=='requirement') return object;
    const parents=(object.sourceIds||[]).map(id=>index.get(id)).filter(Boolean);
    const flags=parents.map(requirementSafetyFlag), current=requirementSafetyFlag(object);
    const flag=current==='Yes'||flags.includes('Yes')?'Yes':current==='Needs review'||flags.includes('Needs review')?'Needs review':flags.length&&flags.every(value=>value==='No')?'No':'Not assessed';
    const safetySources=parents.filter(parent=>['Yes','Needs review'].includes(requirementSafetyFlag(parent)));
    const references=[...new Set([...list(object.attributes?.['Safety Source IDs']), ...safetySources.flatMap(parent=>[parent.id,...list(parent.attributes?.['Safety Source IDs'])])])];
    const asils=[...new Set([...list(object.attributes?.['Source ASIL']), ...safetySources.flatMap(parent=>list(parent.attributes?.['Source ASIL']))].flatMap(value=>value.split(';').map(text)).filter(Boolean))].sort();
    if (flag === 'Not assessed' && !object.attributes?.['Safety Significant']) return object;
    return {...object,attributes:{...object.attributes,'Safety Significant':flag,...(references.length?{'Safety Source IDs':references}:{}),...(asils.length?{'Source ASIL':asils.join('; ')}:{})}};
  });
}

// Retain the exact recorded normative obligations at the entry specification.
// Citation alone is not proof that a model included an existing requirement.
export function includeRecordedSafetyRequirements(objects, sources, artifactId, sectionId) {
  if(sectionId!=='s2') return objects;
  const recorded=sources.entries.filter(source=>source.sourceType==='hazard-derived-requirement' && source.kind==='requirement');
  const result=objects.map(object=>({...object}));
  for(const source of recorded) {
    const same=result.find(object=>object.kind==='requirement' && text(object.text).replace(/\s+/g,' ').toLowerCase()===text(source.text).replace(/\s+/g,' ').toLowerCase());
    if(same){same.sourceIds=[...new Set([...(same.sourceIds||[]),source.id])];continue;}
    const key=`safety-${semanticHash(source.id).slice(0,24)}`;
    result.push({id:`${artifactId}:${sectionId}:${key}`,key,parentId:`${artifactId}:${sectionId}`,sectionId,kind:'requirement',title:'Recorded safety obligations',text:source.text,
      sourceIds:[source.id],attributes:source.attributes,status:'Proposed',manual:false,recordedSafetyRequirement:true});
  }
  return result;
}

// An unresolved allocation is visible instead of silently dropping safety
// content or copying software implementation duties into a hardware spec.
export function requirementSafetyCoverage(sources, sections, artifactId) {
  const addressed = new Set(Object.values(sections).flat().filter(object => !object.deleted && ['requirement', 'gap'].includes(object.kind)).flatMap(object => object.sourceIds || []));
  return sources.entries.filter(source => ['artifact-object', 'hazard-derived-requirement'].includes(source.sourceType) && ['Yes', 'Needs review'].includes(requirementSafetyFlag(source)) && !addressed.has(source.id)).map(source => {
    const key = `safety-allocation-${semanticHash(source.id).slice(0,24)}`;
    return { id: `${artifactId}:s6:${key}`, key, sectionId: 's6', parentId: `${artifactId}:s6`, kind: 'gap', proposedKind: 'requirement',
      title: 'Safety requirement allocation needs review', text: `Determine the applicable allocation of the recorded safety obligation to this specification: ${source.text}`,
      sourceIds: [source.id], attributes: { 'Safety Significant': requirementSafetyFlag(source) }, evidenceIssue: 'unresolved-safety-allocation', manual: false };
  });
}
