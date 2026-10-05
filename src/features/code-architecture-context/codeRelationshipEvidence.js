// Bounded source-syntax evidence, separate from proof of runtime dispatch.
import { stableJson } from './codeAnalysisRun';
export const EVIDENCE_VERSION = 2;
const tuple = (fromFile, from, kind, toFile, to) => [fromFile, from, kind, toFile, to];
export const comparisonId = evidence => `rel:v1:${stableJson(tuple(evidence.fromFile, evidence.from, evidence.kind, evidence.toFile, evidence.to))}`;
export const currentArchitectureRows = rows => (rows || []).filter(row => row?.lineage?.status !== 'historical');
// Mask comments/strings while preserving offsets, indentation and newlines.
export function maskPython(source) {
  let result = '', quote = '', triple = false, comment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (comment) { if (ch === '\n') comment = false; result += ch === '\n' ? ch : ' '; continue; }
    if (quote) {
      if (ch === '\\') { result += ' '; if (i + 1 < source.length) result += source[++i] === '\n' ? '\n' : ' '; continue; }
      if (triple && source.slice(i, i + 3) === quote.repeat(3)) { result += '   '; i += 2; quote = ''; continue; }
      if (!triple && ch === quote) quote = '';
      result += ch === '\n' ? ch : ' '; continue;
    }
    if (ch === '#') { comment = true; result += ' '; }
    else if (ch === '"' || ch === "'") { quote = ch; triple = source.slice(i, i + 3) === ch.repeat(3); result += triple ? '   ' : ' '; if (triple) i += 2; }
    else result += ch;
  }
  return result;
}
export { buildPythonSourceInventory as pythonRelationshipInventory } from './pythonSourceInventory';
export function isPlaceholderRelationship(row = {}) {
  // Check raw labels: tokenizing N/A first turns it into "n a".
  return [row.from, row.to].some(value => /^(?:n\s*[/.-]?\s*a|not[ _-]+applicable|null|undefined|none|-)$/i.test(String(value || '').trim()));
}

// A repository module index is matching context only; it must not change the
// persisted call-site evidence or its canonical identity.
export function createPythonModuleIndex(files = []) {
  const index = new Map();
  for (const entry of files) {
    const path = typeof entry === 'string' ? entry : entry.path;
    if (!path?.endsWith('.py') || (entry.entryKind && entry.entryKind !== 'file')) continue;
    const parts = path.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/');
    for (let i = 0; i < parts.length; i++) {
      const name = parts.slice(i).join('.');
      if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(name)) continue;
      const paths = index.get(name) || new Set();
      paths.add(path); index.set(name, paths);
    }
  }
  return index;
}
function importedDestination(e, index) {
  if (e.targetResolution !== 'import-reference' || !index) return null;
  const symbol = e.to || '';
  const relative = symbol.match(/^(\.+)(.*)$/);
  if (relative) {
    const parent = e.fromFile.split('/').slice(0, -1);
    if (relative[1].length > parent.length) return null;
    const prefix = parent.slice(0, parent.length - relative[1].length + 1);
    const parts = relative[2].split('.');
    for (let i = parts.length - 1; i >= 0; i--) {
      const stem = [...prefix, ...parts.slice(0, i)].join('/');
      const moduleName = i ? parts.slice(0, i).join('.') : prefix.join('.');
      const candidates = [...(index.get(moduleName) || [])]
        .filter(path => (i > 0 && path === `${stem}.py`) || path === `${stem}/__init__.py`);
      if (candidates.length) return candidates.length === 1 ? candidates[0] : null;
    }
    return null;
  }
  const parts = symbol.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const candidates = index.get(parts.slice(0, i).join('.'));
    if (candidates?.size) return candidates.size === 1 ? [...candidates][0] : null;
  }
  return null;
}
export function evidenceForRow(row, inventory) {
  const moduleAlias = value => /(?:\(module(?: script)?\)|\.py)$/.test(value || '');
  const candidates = (inventory?.relationships || []).filter(e => row.fromFile === e.fromFile &&
    (row.toFile === e.toFile || row.toFile === importedDestination(e, inventory.moduleIndex)) &&
    (row.from === e.from || row.from === e.fromName || (e.fromName === '<module>' && moduleAlias(row.from))) &&
    (row.to === e.to || row.to === e.toName || row.to === e.expression));
  return candidates.length === 1 ? candidates[0] : null;
}
function sourceRow(e) {
  const member = e.kind === 'structural_member', inheritance = e.kind === 'structural_inheritance';
  return { from:e.from,to:e.to,fromFile:e.fromFile,toFile:e.toFile,
    action:`${member ? 'Define' : inheritance ? 'Extend' : 'Call'} ${e.to}`,
    fromDetails:`Source-defined ${e.from}.`,
    toDetails: e.targetResolution === 'import-reference' ? `Imported callable reference ${e.to}; runtime dispatch is not proven.` : e.targetResolution === 'unresolved-runtime-target' ? `Call expression ${e.expression}; runtime target is unresolved.` : `Source-defined ${e.to}.`,
    controlActionDetails:`${member ? 'Class membership' : inheritance ? 'Base-class expression' : 'Call expression'} evidenced at ${e.fromFile}:${e.lines.join(', ')}.`,
    canonicalRelationshipId:e.canonicalId, relationshipEvidence:e, classificationPolicyVersion:2,
    grounding:{evidenceConfidence:'high',relationshipType:e.kind,currentFile:e.fromFile}, evidenceGenerated:true };
}
export function completeSupportedRelationships(rows, inventory) {
  const enriched = new Map(), proposals = [];
  for (const row of rows) {
    if (isPlaceholderRelationship(row)) continue;
    const evidence = evidenceForRow(row, inventory);
    if (evidence) {
      // Model output enriches descriptions; source evidence owns identity and action.
      if (!enriched.has(evidence.canonicalId)) enriched.set(evidence.canonicalId, row);
    } else proposals.push({ ...row, canonicalRelationshipId: undefined, classificationPolicyVersion:2,
      relationshipEvidence:{version:2,supported:false,kind:'unresolved',textDigest:inventory.textDigest || null} });
  }
  return [...(inventory.relationships || []).map(e => {
    const generated = sourceRow(e), model = enriched.get(e.canonicalId);
    return model ? { ...model, ...generated,
      fromDetails:model.fromDetails || generated.fromDetails, toDetails:model.toDetails || generated.toDetails,
      controlActionDetails:model.controlActionDetails || generated.controlActionDetails,
    } : generated;
  }), ...proposals];
}
const proposalKey = row => stableJson([row.fromFile,row.from,row.toFile,row.to,
  row.grounding?.relationshipType || (/^(?:call|invoke)\b/i.test(row.action || '') ? 'call' : row.action)]);
export function dedupeEvidenceRows(rows) {
  const result=[], map=new Map();
  for(const row of rows) {
    if (isPlaceholderRelationship(row)) continue;
    const key=row.canonicalRelationshipId || proposalKey(row);
    if(!map.has(key)) { const copy={...row}; result.push(copy);map.set(key,copy); }
    else if(row.relationshipEvidence?.lines) {
      const previous=map.get(key); previous.relationshipEvidence={...previous.relationshipEvidence,lines:[...new Set([...(previous.relationshipEvidence?.lines||[]),...row.relationshipEvidence.lines])].sort((a,b)=>a-b)};
    } else {
      const previous=map.get(key);
      const variant = { action:row.action, controlActionDetails:row.controlActionDetails, fromDetails:row.fromDetails, toDetails:row.toDetails };
      previous.modelProposalVariants = [...(previous.modelProposalVariants || []), variant];
    }
  }
  return result;
}
export function reconcileSourceProposals(rows, moduleIndex) {
  const canonical = new Map(), byFile = new Map();
  for (const row of rows) if (row.canonicalRelationshipId && row.relationshipEvidence?.supported) {
    canonical.set(row.canonicalRelationshipId, {...row});
    const e = row.relationshipEvidence;
    const relationships = byFile.get(e.fromFile) || [];
    relationships.push(e); byFile.set(e.fromFile, relationships);
  }
  const unmatched = [];
  for (const row of rows) {
    if (canonical.has(row.canonicalRelationshipId)) continue;
    if (isPlaceholderRelationship(row)) continue;
    const evidence = evidenceForRow(row, {relationships:byFile.get(row.fromFile) || [], moduleIndex});
    const target = evidence && canonical.get(evidence.canonicalId);
    if (!target) { unmatched.push(row); continue; }
    const defaults = sourceRow(evidence);
    for (const key of ['fromDetails','toDetails','controlActionDetails']) {
      if (row[key] && target[key] === defaults[key]) target[key] = row[key];
    }
    target.modelProposalVariants = [...(target.modelProposalVariants || []), {
      action:row.action,fromDetails:row.fromDetails,toDetails:row.toDetails,controlActionDetails:row.controlActionDetails,
    }];
  }
  return [...canonical.values(), ...unmatched];
}
export function updatePublishedProposalCounts(ledger, rows) {
  for (const file of Object.values(ledger)) {
    file.modelOnlyBeforeDedup = file.modelOnlyBeforeDedup ?? file.modelOnly ?? 0;
    file.modelOnly = 0;
    file.proposalCountBasis = 'published-after-deduplication';
  }
  for (const row of rows) {
    if (row.canonicalRelationshipId) continue;
    const origin = row.grounding?.currentFile || row.fromFile;
    if (ledger[origin]) ledger[origin].modelOnly += 1;
  }
}
// A parser upgrade can preserve v1 lexical evidence only with the same source
// digest, endpoints, kind and source lines. Changed/ambiguous evidence stays historical.
export function relationshipEvidenceUnchanged(a, b) {
  if (!a || !b) return false;
  if (stableJson(a) === stableJson(b)) return a.supported || !!a.textDigest;
  if (!a.supported || !b.supported || !a.textDigest || a.textDigest !== b.textDigest) return false;
  if (![a.version,b.version].every(version => version === 1 || version === 2)) return false;
  if (!['direct_call','structural_member'].includes(a.kind)) return false;
  const facts = e => [e.fromFile,e.from,e.kind,e.toFile,e.to,e.fromLine,e.toLine,[...(e.lines || [])].sort((x,y)=>x-y)];
  return stableJson(facts(a)) === stableJson(facts(b));
}
const legacyEvidenceUnchanged = (a,b) => {
  const facts = row => (row.sourceEvidence?.functions || []).map(fn=>[fn.filePath || fn.path,fn.functionName,fn.content]).filter(tuple=>tuple[2]).sort((a,b)=>stableJson(a).localeCompare(stableJson(b)));
  return facts(a).length > 0 && stableJson(facts(a)) === stableJson(facts(b));
};
const exactLegacyKey = row => stableJson([row.fromFile,row.from,row.action,row.toFile,row.to]);
export function reconcileArchitectureRows(incoming, previous, scope) {
  previous = (previous || []).filter(row => !row.lineage?.scope || row.lineage.scope === scope);
  const used=new Set(), result=[];
  let nextRowRef = Math.max(0,...(previous || []).map(row=>Number(row.rowRef)||0));
  const nodeIdentity = (row,side) => row.relationshipEvidence?.supported ? stableJson([row.relationshipEvidence[`${side}File`],row.relationshipEvidence[side]]) : null;
  const previousNodes = new Map();
  for (const row of previous || []) for (const side of ['from','to']) {
    const key=nodeIdentity(row,side), id=row[`${side}NodeId`];
    if(key && id) { const ids=previousNodes.get(key)||new Set(); ids.add(id);previousNodes.set(key,ids); }
  }
  for(const row of incoming) {
    const matches=(previous||[]).filter(old=> !used.has(old) && old.lineage?.status !== "historical" && (!old.lineage?.scope || old.lineage.scope===scope) &&
      (row.canonicalRelationshipId && old.canonicalRelationshipId ? row.canonicalRelationshipId===old.canonicalRelationshipId : exactLegacyKey(row)===exactLegacyKey(old)));
    const candidate=matches.length===1?matches[0]:null;
    // A new revision/policy or ambiguous mapping must not inherit an old assessment.
    const old=candidate && (candidate.relationshipEvidence ? relationshipEvidenceUnchanged(candidate.relationshipEvidence,row.relationshipEvidence) : legacyEvidenceUnchanged(candidate,row)) ? candidate : null;
    const copy={...row,lineage:{version:1,scope,status:'current'}};
    for (const key of ['traceId','rowRef','edgeId','fromNodeId','toNodeId']) delete copy[key];
    if(old) {
      used.add(old);
      // Preserve display edits and user decisions; new immutable evidence stays separate.
      for(const key of ['traceId','rowRef','fromNodeId','toNodeId','edgeId','from','to','action','fromDetails','toDetails','controlActionDetails','controlDetails','architecture']) if(old[key]!==undefined) copy[key]=old[key];
      if(old.hazardAnalysisEligibilitySource==='analyst-override' && (relationshipEvidenceUnchanged(old.relationshipEvidence,row.relationshipEvidence) || legacyEvidenceUnchanged(old,row))) {
        for(const key of ['lifecyclePhase','interfaceType','hazardAnalysisEligibility','hazardAnalysisEligibilityRationale','hazardAnalysisEligibilitySource']) copy[key]=old[key];
      } else if(old.hazardAnalysisEligibilitySource==='analyst-override') { copy.lineage.decisionNeedsReview=true; copy.lineage.previousDecision={value:old.hazardAnalysisEligibility,rationale:old.hazardAnalysisEligibilityRationale}; }
    }
    if (!copy.rowRef) copy.rowRef = ++nextRowRef;
    for (const side of ['from','to']) if (!copy[`${side}NodeId`]) {
      const ids = previousNodes.get(nodeIdentity(copy,side));
      if (ids?.size === 1) copy[`${side}NodeId`] = [...ids][0];
    }
    result.push(copy);
  }
  // Historical rows retain their old IDs/evidence. They are not new generation inputs.
  for(const old of previous||[]) if(!used.has(old)) result.push({...old,lineage:{...old.lineage,version:1,scope,status:'historical'}});
  return result;
}

export function uniqueTopLevelPythonBody(source, name) {
  if (!/^[A-Za-z_]\w*$/.test(name)) return '';
  const lines=maskPython(source).split('\n');
  const starts=lines.map((line,index)=>new RegExp(`^(?:async\\s+)?def\\s+${name}\\s*\\(`).test(line)?index:-1).filter(index=>index>=0);
  if(starts.length!==1) return '';
  let end=starts[0]+1;
  while(end<lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end++;
  return lines.slice(starts[0],end).join('\n');
}
