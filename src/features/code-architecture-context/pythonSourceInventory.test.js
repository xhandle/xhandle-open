import { pythonRelationshipInventory, completeSupportedRelationships, dedupeEvidenceRows, reconcileArchitectureRows } from './codeRelationshipEvidence';
import { classifyCodeArchitectureHazardEligibility as classify } from '../code-architecture-hazard-analysis/codeArchitectureHazardEligibility';
import { ensureCodeArchitectureTraceIds } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
const path = 'src/action_space.py';
const source = `import numpy as np
from scipy.spatial.transform import (
    Rotation as R,
)
class ActionSpace:
    def __init__(
        self,
        config: dict,
    ) -> None:
        self.config = config
    def action_to_traj(
        self,
        x,
    ):
        self.validate(x)
        np.cos(x)
        x.squeeze()
        return R.from_euler('xyz', x)
    def validate(self, x):
        pass
result = np.sin(0)
`;
const facts = () => pythonRelationshipInventory(path, source);
const signature = rows => rows.filter(row => row.canonicalRelationshipId).map(row => [row.canonicalRelationshipId, row.from, row.action, row.to, classify(row)]);
it('inventories multiline methods, aliased library calls, receiver calls and module calls without model assistance', () => {
 const inventory = facts();
 expect(inventory.parseErrors).toEqual([]);
 expect(inventory.definitionCount).toBe(4);
 expect(inventory.callExpressionCount).toBe(5);
 expect(inventory.relationships).toHaveLength(8);
 expect(inventory.relationships).toEqual(expect.arrayContaining([
  expect.objectContaining({from:'ActionSpace',to:'ActionSpace.__init__',kind:'structural_member'}),
  expect.objectContaining({from:'ActionSpace.action_to_traj',to:'ActionSpace.validate',kind:'direct_call'}),
  expect.objectContaining({to:'numpy.cos',kind:'imported_call',targetResolution:'import-reference'}),
  expect.objectContaining({to:'scipy.spatial.transform.Rotation.from_euler',kind:'imported_call'}),
  expect.objectContaining({to:'ActionSpace.action_to_traj::x.squeeze',kind:'call_expression',targetResolution:'unresolved-runtime-target'}),
  expect.objectContaining({from:`${path} (module)`,to:'numpy.sin'}),
 ]));
});
it('converges supported identities, labels, actions and eligibility under missing/aliased/paraphrased model rows', () => {
 const inventory = facts();
 const model = {from:'action_to_traj',to:'np.cos',fromFile:path,toFile:path,action:'Compute cosine',controlActionDetails:'Model wording'};
 const a = completeSupportedRelationships([],inventory);
 const b = dedupeEvidenceRows(completeSupportedRelationships([model,{...model,action:'Invoke cos',controlActionDetails:'Other wording'}],inventory));
 expect(signature(b)).toEqual(signature(a));
 expect(b).toHaveLength(a.length);
 const receiver=b.find(row=>row.relationshipEvidence.kind==='call_expression');
 expect(classify(receiver).hazardAnalysisEligibility).toBe('Include');
 expect(classify({...receiver,classificationPolicyVersion:1}).hazardAnalysisEligibility).toBe('Needs Review');
});
it('does not turn constants, strings, comments or annotations into call evidence', () => {
 const inventory=pythonRelationshipInventory('rotation.py',`import numpy as np

def angle_wrap(x: annotation()):
    # np.cos(x)
    s = 'np.sin(x)'
    return (x + np.pi) % (2 * np.pi)
`);
 expect(inventory.relationships).toEqual([]);
 expect(inventory.callExpressionCount).toBe(0);
});
it('keeps rebound imports, shadowed arguments, lambdas, except aliases and dynamic receivers unresolved', () => {
 for (const body of [
  'def f(np): return np.cos(1)',
  'np = replacement\ndef f(): return np.cos(1)',
  'def f():\n    global np\n    return np.cos(1)',
  'f = lambda np: np.cos(1)',
  'def f():\n    try: pass\n    except Error as np: np.cos(1)',
  'def f(): return [np.cos(1) for np in values]',
 ]) {
  const inventory=pythonRelationshipInventory('a.py',`import numpy as np\n${body}\n`);
  expect(inventory.parseErrors).toEqual([]);
  expect(inventory.relationships.some(e=>e.to==='numpy.cos')).toBe(false);
  expect(inventory.relationships.some(e=>e.kind==='call_expression')).toBe(true);
 }
});
it('does not resolve an unqualified class method as a global function', () => {
 const inventory=pythonRelationshipInventory('a.py','class A:\n    def work(self): other()\n    def other(self): pass\n');
 expect(inventory.relationships.filter(e=>e.kind==='direct_call')).toEqual([]);
});
it('exposes parse failures and unsupported language coverage', () => {
 expect(pythonRelationshipInventory('bad.py','def broken(:\n    value(\n').parseErrors.length).toBeGreaterThan(0);
 expect(pythonRelationshipInventory('a.js','run();')).toMatchObject({supported:false,relationships:[]});
});
it('preserves v1 trace identities and human overrides only for unchanged lexical evidence during the parser upgrade', () => {
 const inventory=pythonRelationshipInventory('control.py','def validate_command(): pass\ndef control_motion(): validate_command()\n');
 inventory.relationships.forEach(e=>{e.textDigest='same-source';});
 const fresh=completeSupportedRelationships([],inventory);
 const saved=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(fresh,[],'project:A'));
 for (const row of saved) { row.relationshipEvidence={...row.relationshipEvidence,version:1}; delete row.relationshipEvidence.targetResolution; }
 saved[0].fromDetails='Reviewed description'; saved[0].hazardAnalysisEligibilitySource='analyst-override'; saved[0].hazardAnalysisEligibility='Exclude';
 const next=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(fresh,saved,'project:A'));
 expect(next).toHaveLength(saved.length);
 expect(next[0]).toMatchObject({traceId:saved[0].traceId,fromDetails:'Reviewed description',hazardAnalysisEligibility:'Exclude',relationshipEvidence:{version:2}});
 const changed=fresh.map(row=>({...row,relationshipEvidence:{...row.relationshipEvidence,textDigest:'changed'}}));
 expect(reconcileArchitectureRows(changed,saved,'project:A').filter(row=>row.lineage.status==='historical')).toHaveLength(saved.length);
});
it('deduplicates paraphrased model calls while retaining alternative descriptions for review', () => {
 const row={from:'f',to:'dynamic',fromFile:'a.py',toFile:'a.py',action:'Call dynamic',controlActionDetails:'First'};
 const rows=dedupeEvidenceRows([row,{...row,action:'Invoke dynamic',controlActionDetails:'Second'}]);
 expect(rows).toHaveLength(1);
 expect(rows[0].modelProposalVariants[0].controlActionDetails).toBe('Second');
});
it('accepts comment-only modules and bare generator yield without hiding real parse errors', () => {
 expect(pythonRelationshipInventory('empty.py','# license\n# comment\n').parseErrors).toEqual([]);
 const inventory=pythonRelationshipInventory('generator.py','def generate():\n    yield\n    publish()\n');
 expect(inventory.parseErrors).toEqual([]);
 expect(inventory.callExpressionCount).toBe(1);
 expect(pythonRelationshipInventory('invalid.py','yield\n').parseErrors.length).toBeGreaterThan(0);
 expect(pythonRelationshipInventory('invalid.py','def generate():\n    yield (\n').parseErrors.length).toBeGreaterThan(0);
});
it('captures explicit inheritance separately from calls and excludes it from operational hazard inputs', () => {
 const inventory=pythonRelationshipInventory('tests/expert.py','import torch\nclass Expert(torch.nn.Module, metaclass=Meta):\n    def forward(self): pass\n');
 const rows=completeSupportedRelationships([],inventory);
 const inheritance=rows.find(row=>row.relationshipEvidence.kind==='structural_inheritance');
 expect(inheritance).toMatchObject({from:'Expert',to:'torch.nn.Module',action:'Extend torch.nn.Module'});
 expect(classify(inheritance)).toMatchObject({hazardAnalysisEligibility:'Exclude',lifecyclePhase:'Static Structure'});
 expect(inventory.relationships.some(e=>e.to.includes('Meta'))).toBe(false);
});
