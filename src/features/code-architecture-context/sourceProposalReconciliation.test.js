import { pythonRelationshipInventory, createPythonModuleIndex, evidenceForRow, completeSupportedRelationships, dedupeEvidenceRows, reconcileSourceProposals, updatePublishedProposalCounts, reconcileArchitectureRows } from './codeRelationshipEvidence';
import { classifyCodeArchitectureHazardEligibility as classify } from '../code-architecture-hazard-analysis/codeArchitectureHazardEligibility';
import { ensureCodeArchitectureTraceIds } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';

const caller = 'src/alpamayo_r1/action_space/unicycle_accel_curvature.py';
const target = 'src/alpamayo_r1/action_space/utils.py';
const source = 'from alpamayo_r1.action_space.utils import solve_xs_eq_y\nclass UnicycleAccelCurvatureActionSpace:\n    def _v_to_a(self): return solve_xs_eq_y(1)\n';
const proposal = {from:'_v_to_a',to:'solve_xs_eq_y',fromFile:caller,toFile:target,action:'Solve',controlActionDetails:'Enriched description'};
function inventory(text = source, paths = [caller,target]) {
  const inv = pythonRelationshipInventory(caller,text);
  inv.moduleIndex = createPythonModuleIndex(paths);
  return inv;
}
it('reconciles the observed imported destination proposal without changing canonical evidence or IDs', () => {
  const inv = inventory();
  const before = completeSupportedRelationships([], inv);
  const after = completeSupportedRelationships([proposal], inv);
  expect(after).toHaveLength(before.length);
  expect(after.map(r=>r.relationshipEvidence)).toEqual(before.map(r=>r.relationshipEvidence));
  expect(after.find(r=>r.relationshipEvidence.kind==='imported_call')).toMatchObject({toFile:caller,controlActionDetails:'Enriched description'});
});
it('requires a unique repository module, exact caller, import binding and endpoint', () => {
  for (const inv of [inventory(source,[caller]), inventory(source,[caller,target,'other/alpamayo_r1/action_space/utils.py']), inventory(source.replace('def _v_to_a(self)', 'def _v_to_a(self, solve_xs_eq_y)')), inventory(source.replace('from alpamayo', 'if enabled:\n    from alpamayo'))]) {
    expect(evidenceForRow(proposal,inv)).toBeNull();
    expect(completeSupportedRelationships([proposal],inv).some(r=>!r.canonicalRelationshipId)).toBe(true);
  }
  expect(evidenceForRow({...proposal,toFile:'other/utils.py'},inventory())).toBeNull();
  expect(evidenceForRow({...proposal,fromFile:target},inventory())).toBeNull();
  expect(evidenceForRow({...proposal,to:'different'},inventory())).toBeNull();
});
it('resolves relative imports within their actual package and refuses ambiguous short callers', () => {
  const inv=inventory(source.replace('alpamayo_r1.action_space.utils','.utils'));
  expect(evidenceForRow(proposal, inv)?.kind).toBe('imported_call');
  const duplicate=inventory(source+'class Other:\n    def _v_to_a(self): return solve_xs_eq_y(2)\n');
  expect(evidenceForRow(proposal,duplicate)).toBeNull();
  const packagePath='src/alpamayo_r1/action_space/__init__.py';
  const packageInventory=inventory(source.replace('alpamayo_r1.action_space.utils','.'),[caller,packagePath]);
  expect(evidenceForRow({...proposal,toFile:packagePath},packageInventory)?.kind).toBe('imported_call');
});
it('rejects empty-file placeholders at completion and deduplication', () => {
  const inv=pythonRelationshipInventory('src/diffusion/__init__.py','# license only\n');
  for (const label of ['N/A','n / a','Not applicable','None','-']) {
    const row={...proposal,from:label,to:label,action:'none'};
    expect(completeSupportedRelationships([row],inv)).toEqual([]);
    expect(dedupeEvidenceRows([row])).toEqual([]);
  }
});
it('counts published proposals separately from pre-dedup totals, including zero', () => {
  const ledger={[caller]:{modelOnly:2},[target]:{modelOnly:0}};
  const rows=dedupeEvidenceRows([proposal,proposal]);
  updatePublishedProposalCounts(ledger,rows);
  expect(ledger[caller]).toMatchObject({modelOnly:1,modelOnlyBeforeDedup:2,proposalCountBasis:'published-after-deduplication'});
  updatePublishedProposalCounts(ledger,[]);
  expect(ledger[caller]).toMatchObject({modelOnly:0,modelOnlyBeforeDedup:2});
});
it('includes operational imported/receiver calls while retaining uncertainty and excluding tests', () => {
  for (const path of ['src/geometry/rotation.py','src/action_space/utils.py','src/inference/expert.py']) {
    const rows=completeSupportedRelationships([],pythonRelationshipInventory(path,'import numpy as np\ndef compute(x):\n    np.cos(x)\n    x.squeeze()\n'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(classify(row).hazardAnalysisEligibility).toBe('Include');
      expect(classify({...row,fromDetails:'test fixture',action:'Define member'})).toEqual(classify(row));
      expect(classify({...row,classificationPolicyVersion:1}).hazardAnalysisEligibility).toBe('Needs Review');
    }
    expect(classify(rows.find(row=>row.relationshipEvidence.kind==='call_expression')).hazardAnalysisEligibilityRationale).toMatch(/remains unresolved/);
  }
  for (const path of ['tests/inference.py','src/test_inference.py','src/inference_test.py','examples/control.py']) {
    const [row]=completeSupportedRelationships([],pythonRelationshipInventory(path,'import numpy as np\ndef control(): np.cos(1)'));
    expect(classify(row).hazardAnalysisEligibility).toBe('Exclude');
  }
  const [utility]=completeSupportedRelationships([],pythonRelationshipInventory('src/utils.py','import numpy as np\ndef compute(): np.cos(1)'));
  expect(classify(utility).hazardAnalysisEligibility).toBe('Include');
});
it('retains trace links, row references and analyst overrides across a policy-only rerun', () => {
  const fresh=completeSupportedRelationships([],inventory());
  const saved=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(fresh,[],'scope'));
  saved.forEach(row=>{row.classificationPolicyVersion=1;row.hazardAnalysisEligibilitySource='analyst-override';row.hazardAnalysisEligibility='Exclude';});
  const next=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(fresh,saved,'scope'));
  expect(next.map(r=>[r.traceId,r.rowRef,r.edgeId,r.fromNodeId,r.toNodeId])).toEqual(saved.map(r=>[r.traceId,r.rowRef,r.edgeId,r.fromNodeId,r.toNodeId]));
  expect(next.every(r=>r.classificationPolicyVersion===3 && classify(r).hazardAnalysisEligibility==='Exclude')).toBe(true);
});

it('reconciles imported calls proposed while analyzing the destination file', () => {
 const inv=inventory();
 const calls=completeSupportedRelationships([],inv);
 const targetInventory=pythonRelationshipInventory(target,'def solve_xs_eq_y(x): return x');
 const proposals=completeSupportedRelationships([proposal],targetInventory);
 expect(proposals.some(row=>!row.canonicalRelationshipId)).toBe(true);
 const result=reconcileSourceProposals([...calls,...proposals],inv.moduleIndex);
 expect(result).toHaveLength(calls.length);
 expect(result.find(row=>row.relationshipEvidence.kind==='imported_call').controlActionDetails).toBe('Enriched description');
 expect(result.map(row=>row.canonicalRelationshipId)).toEqual(calls.map(row=>row.canonicalRelationshipId));
});
