import { pythonRelationshipInventory, completeSupportedRelationships, reconcileArchitectureRows } from './codeRelationshipEvidence';
import { scopeFunctionalDecomposition, decompositionRowsAllowed, decompositionTableEntries } from './functionalDecompositionScope';
import { ensureCodeArchitectureTraceIds, buildCodeArchitectureHazardInput } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
import { architectureCoverageSheets } from '../code-architecture-assurance/codeArchitectureCoverageWorkbook';

function fixture(source, path='src/control.py', proposals=[]) {
  const inventory=pythonRelationshipInventory(path,source);
  inventory.textDigest='unchanged';
  inventory.relationships.forEach(e=>{e.textDigest='unchanged';});
  const rows=completeSupportedRelationships(proposals,inventory);
  const ledger={[path]:{...inventory,modelOnly:proposals.length}};
  return {rows,ledger,scoped:scopeFunctionalDecomposition(rows,ledger)};
}
it('publishes behavioral calls, not static relationships, without erasing the inventory', () => {
  const f=fixture('import numpy as np\nclass Controller(Base):\n    def forward(self,x):\n        np.cos(x)\n        x.squeeze()\n        self.validate(x)\n    def validate(self,x): pass');
  expect(f.rows).toHaveLength(6);
  expect(f.scoped).toHaveLength(3);
  expect(f.scoped.map(r=>r.relationshipEvidence.kind).sort()).toEqual(['call_expression','direct_call','imported_call']);
  expect(f.ledger['src/control.py'].relationships).toHaveLength(6);
  expect(f.ledger['src/control.py'].publishedCalls).toBe(3);
  expect(f.ledger['src/control.py'].relationships.filter(e=>e.decompositionDisposition==='hierarchy-evidence')).toHaveLength(3);
});
it('excludes test and example call sites but keeps calls into shared production utilities', () => {
  for (const path of ['tests/control.py','src/test_control.py','src/control_test.py','examples/control.py','benchmarks/control.py']) {
    expect(fixture('def forward(x): x.run()',path).scoped).toHaveLength(0);
  }
  expect(fixture('from shared.utils import compute\ndef forward(x): compute(x)').scoped).toHaveLength(1);
});
it('excludes only evidenced language helpers and raised built-in exceptions', () => {
  const f=fixture('def forward(x):\n    n=len(x)\n    isinstance(x,list)\n    for i in range(n): x.run()\n    raise ValueError("bad")');
  expect(f.scoped.map(row=>row.relationshipEvidence.expression)).toEqual(['x.run']);
  const dispositions=f.ledger['src/control.py'].relationships.map(e=>e.decompositionDisposition);
  expect(dispositions.filter(d=>d==='excluded-language-helper')).toHaveLength(3);
  expect(dispositions).toContain('excluded-exception-construction');
});
it('preserves meaningful constructors, casts, computation, super-method and I/O calls', () => {
  const f=fixture('import numpy as np\nclass Controller:\n    def __init__(self,x):\n        super().__init__()\n        self.model=Model(x)\n        float(x)\n        np.zeros(x)\n        open(x)\n        print(x)');
  const expressions=f.scoped.map(row=>row.relationshipEvidence.expression);
  expect(expressions).toEqual(expect.arrayContaining(['super().__init__','Model','float','np.zeros','open','print']));
  expect(expressions).not.toContain('super');
});
it('never treats shadowed, rebound, conditional or wildcard names as known built-ins', () => {
  for (const text of [
    'def len(x): return x\ndef forward(x): len(x)',
    'def forward(len,x): len(x)',
    'len=custom\ndef forward(x): len(x)',
    'if enabled:\n    from other import len\ndef forward(x): len(x)',
    'from other import *\ndef forward(x): len(x)',
    'class ValueError:\n    pass\ndef forward(): raise ValueError()',
  ]) expect(fixture(text).scoped).toHaveLength(1);
});
it('keeps an exception factory relationship if any occurrence is used outside raise', () => {
  for (const body of ['    x=ValueError()\n    raise ValueError()', '    raise ValueError()\n    x=ValueError()']) {
    expect(fixture(`def forward():\n${body}`).scoped).toHaveLength(1);
  }
});
it('retains unmatched proposals for audit, including files with no relationships, and blocks reinsertion', () => {
  const path='src/empty.py',proposal={from:'guess',to:'unknown',fromFile:path,toFile:path,action:'Call unknown'};
  const f=fixture('# license',path,[proposal]);
  expect(f.scoped).toEqual([]);
  expect(f.ledger[path].reviewProposals[0]).toMatchObject({...proposal,decompositionDisposition:'review-model-proposal'});
  expect(decompositionRowsAllowed({...proposal,sourceAuditGenerated:true},f.ledger)).toBe(false);
  const sheets=architectureCoverageSheets([{selectionManifest:[{path}],relationshipLedger:f.ledger}]);
  expect(sheets.proposals).toHaveLength(1);
  expect(sheets.files[0]).toMatchObject({'Published Calls':0,'Proposals Held for Review':1});
});
it('does not silently remove non-Python extraction support or claim syntax coverage', () => {
  const proposal={from:'a',to:'b',fromFile:'src/a.js',toFile:'src/a.js',action:'Call b'};
  const f=fixture('a();','src/a.js',[proposal]);
  expect(f.scoped).toHaveLength(1);
  expect(f.ledger['src/a.js'].supported).toBe(false);
});
it('retains reviewed calls and historical evidence while keeping new downstream inputs scoped', () => {
  const f=fixture('class Controller(Base):\n    def forward(self,x): x.run()');
  const old=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(f.rows,[],'scope'));
  const call=old.find(r=>r.relationshipEvidence.kind==='call_expression');
  Object.assign(call,{fromDetails:'Reviewed description',hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'analyst-override'});
  const next=ensureCodeArchitectureTraceIds(reconcileArchitectureRows(f.scoped,old,'scope'));
  expect(next.find(r=>r.traceId===call.traceId)).toMatchObject({fromDetails:'Reviewed description',hazardAnalysisEligibilitySource:'analyst-override'});
  expect(next.filter(r=>r.lineage.status==='historical')).toHaveLength(2);
  const hazard=buildCodeArchitectureHazardInput({cbaRows:next});
  expect(hazard.tableRows.length).toBeGreaterThan(0);
  expect(hazard.tableRows.every(r=>r.traceId===call.traceId)).toBe(true);
  expect(decompositionTableEntries(next)).toHaveLength(1);
  expect(decompositionTableEntries(next,true)).toHaveLength(3);
  expect(decompositionTableEntries(next,false,2).map(entry=>entry.sourceIndex)).toEqual([0,2]);
});
