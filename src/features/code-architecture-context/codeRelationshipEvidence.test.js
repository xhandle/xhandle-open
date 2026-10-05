import { pythonRelationshipInventory, completeSupportedRelationships, dedupeEvidenceRows, reconcileArchitectureRows } from './codeRelationshipEvidence';
import { ensureCodeArchitectureTraceIds } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
import { classifyCodeArchitectureHazardEligibility as classify } from '../code-architecture-hazard-analysis/codeArchitectureHazardEligibility';
const source = 'def validate_command():\n    pass\ndef control_motion():\n    validate_command()\n    validate_command()\nclass Controller:\n    def update(self):\n        self.health()\n    def health(self):\n        pass\n';
const inventory=pythonRelationshipInventory('src/__init__.py',source);
const canonical=rows=>[...new Set(rows.map(r=>r.canonicalRelationshipId).filter(Boolean))].sort();
it('accounts for labeled relationships under omission, wording, duplicates and reordered model proposals',()=>{
 expect(inventory.relationships.map(e=>[e.from,e.kind,e.to])).toEqual(expect.arrayContaining([
 ['control_motion','direct_call','validate_command'],['Controller.update','direct_call','Controller.health'],
 ['Controller','structural_member','Controller.update'],['Controller','structural_member','Controller.health']]));
 expect(inventory.relationships).toHaveLength(4);
 expect(inventory.relationships.find(e=>e.from==='control_motion').lines).toEqual([4,5]);
 const proposal={from:'control_motion',to:'validate_command',fromFile:'src/__init__.py',toFile:'src/__init__.py',action:'Validate input'};
 const omitted=completeSupportedRelationships([],inventory);
 const duplicate=dedupeEvidenceRows(completeSupportedRelationships([{...proposal,action:'Check input'},proposal],inventory));
 expect(canonical(duplicate)).toEqual(canonical(omitted)); expect(duplicate).toHaveLength(4);
 expect(duplicate.filter(r=>classify(r).hazardAnalysisEligibility==='Include')).toHaveLength(2);
 expect(duplicate.filter(r=>classify(r).hazardAnalysisEligibility==='Exclude')).toHaveLength(2);
 for(const row of omitted) expect(classify({...row,from:'Different display',action:'Import unsafe test fake',fromDetails:'static relationship'})).toEqual(classify(row));
});
it('does not resolve comments, strings, parameter shadowing or ambiguous short names',()=>{
 const input='def target():\n    pass\ndef caller(target):\n    target()\n    # target()\n    text="target()"\nclass A:\n    def work(self):\n        pass\nclass B:\n    def work(self):\n        pass\n';
 const facts=pythonRelationshipInventory('A.py',input);
 expect(facts.relationships.filter(e=>e.kind==='direct_call')).toHaveLength(0);
 expect(facts.relationships.filter(e=>e.kind==='structural_member')).toHaveLength(2);
 expect(facts.relationships.filter(e=>e.kind==='call_expression')).toHaveLength(1);
 const other=pythonRelationshipInventory('a.py',source);
 expect(canonical(completeSupportedRelationships([],other))).not.toEqual(canonical(completeSupportedRelationships([],inventory)));
});
it('retains trace IDs, manual edits and overrides only in the owning scope with unchanged evidence',()=>{
 const original=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(completeSupportedRelationships([],inventory),[],'project:A'));
 original[0].fromDetails='Manual description'; original[0].hazardAnalysisEligibility='Include';original[0].hazardAnalysisEligibilitySource='analyst-override';
 const next=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(completeSupportedRelationships([],inventory).reverse(),original,'project:A'));
 expect(next.find(r=>r.traceId===original[0].traceId)).toMatchObject({fromDetails:'Manual description',hazardAnalysisEligibilitySource:'analyst-override'});
 const other=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(completeSupportedRelationships([],inventory),original,'project:B'));
 expect(other.some(r=>r.traceId===original[0].traceId)).toBe(false);
 const changed=completeSupportedRelationships([],inventory).map(row=>({...row,relationshipEvidence:{...row.relationshipEvidence,textDigest:'changed'}}));
 const changedResult=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(changed,original,'project:A'));
 expect(changedResult.filter(r=>r.lineage.status==='historical')).toHaveLength(4);
 expect(changedResult.filter(r=>r.lineage.status==='current').some(r=>original.some(old=>old.traceId===r.traceId))).toBe(false);
 expect(new Set(changedResult.map(r=>r.rowRef)).size).toBe(changedResult.length);
});
it('keeps unclassified new model-only proposals explicit and stored legacy decisions stable',()=>{
 const model=completeSupportedRelationships([{from:'Missing',to:'Unknown',action:'Runtime safety motion'}],inventory).find(r=>!r.canonicalRelationshipId);
 expect(classify(model).hazardAnalysisEligibility).toBe('Needs Review');
 expect(classify({action:'new display',hazardAnalysisEligibility:'Exclude',hazardAnalysisEligibilitySource:'deterministic'}).hazardAnalysisEligibility).toBe('Exclude');
});
it('does not carry model-only overrides into changed or unverified source contents', () => {
 const proposal = {from:'caller',to:'external',action:'Call',fromFile:'a.js',toFile:'b.js'};
 const rows = digest => completeSupportedRelationships([proposal], {relationships:[],textDigest:digest});
 const saved = ensureCodeArchitectureTraceIds(reconcileArchitectureRows(rows('old'), [], 'project:A'));
 saved[0].hazardAnalysisEligibilitySource = 'analyst-override';
 saved[0].hazardAnalysisEligibility = 'Include';
 for (const digest of ['changed', null]) {
   const next = reconcileArchitectureRows(rows(digest), saved, 'project:A');
   expect(next.find(row => row.lineage.status === 'current').hazardAnalysisEligibilitySource).toBeUndefined();
   expect(next.find(row => row.lineage.status === 'historical').traceId).toBe(saved[0].traceId);
 }
 expect(reconcileArchitectureRows(rows('old'), saved, 'project:A')[0].traceId).toBe(saved[0].traceId);
});
it('leaves decorated, imported and rebound call targets outside verified lexical coverage', () => {
 for (const text of [
   'def target(): pass\ntarget = replacement\ndef caller(): target()',
   '@wrapper\ndef target(): pass\ndef caller(): target()',
   'def target(): pass\nfrom other import target\ndef caller(): target()',
   'if enabled:\n    def target(): pass\ndef caller(): target()',
 ]) expect(pythonRelationshipInventory('source.py', text).relationships.filter(row => row.kind === 'direct_call')).toEqual([]);
});
it('classifies labeled evidence rather than action wording across supported lifecycle cases', () => {
 const examples = [
   ['src/__init__.py','initialize_control','configure_sensor','Include','Initialization'],
   ['src/control.py','publish_feedback','read_sensor','Include','Runtime'],
   ['src/control.py','protect_motion','clamp_command','Include','Runtime'],
   ['tests/control.py','control_motion','validate_command','Exclude','Test/Verification'],
   ['src/utils.py','alpha','beta','Needs Review','Needs Review'],
 ];
 for (const [path,from,to,eligibility,lifecycle] of examples) {
   const row = completeSupportedRelationships([], pythonRelationshipInventory(path,`def ${to}(): pass\ndef ${from}(): ${to}()`))[0];
   expect(classify(row)).toMatchObject({hazardAnalysisEligibility:eligibility,lifecyclePhase:lifecycle});
   expect(classify({...row,from:'Display changed',action:'Not a runtime call',architecture:{subsystem:'Tests'}})).toEqual(classify(row));
   expect(classify({...row,hazardAnalysisEligibilitySource:'analyst-override',hazardAnalysisEligibility:'Exclude',hazardAnalysisEligibilityRationale:'Reviewed scope'})).toMatchObject({hazardAnalysisEligibility:'Exclude',hazardAnalysisEligibilityRationale:'Reviewed scope'});
 }
});
