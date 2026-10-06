import { pythonRelationshipInventory, completeSupportedRelationships, reconcileArchitectureRows } from './codeRelationshipEvidence';
import { scopeFunctionalDecomposition } from './functionalDecompositionScope';
import { classifyCodeArchitectureHazardEligibility as classify, isCodeArchitectureHazardEligible } from '../code-architecture-hazard-analysis/codeArchitectureHazardEligibility';
import { buildCodeArchitectureHazardInput, ensureCodeArchitectureTraceIds, ensureHazardSummaryEvidenceColumns } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
import { summarizeCodeAnalysisCoverage } from './codeAnalysisCoverage';
import { architectureCoverageSheets } from '../code-architecture-assurance/codeArchitectureCoverageWorkbook';

function extract(path, content, proposals = []) {
  const inventory = pythonRelationshipInventory(path, content);
  const ledger = { [path]: { ...inventory, modelOnly: proposals.length } };
  const rows = scopeFunctionalDecomposition(completeSupportedRelationships(proposals, inventory), ledger);
  return { rows, ledger };
}

it.each([
  ['src/localization/estimator.py', 'update_pose', 'combine'],
  ['src/billing/settlement.py', 'settle_invoice', 'allocate'],
  ['src/medical/infusion.py', 'deliver_dose', 'compute'],
  ['src/helpers.py', 'alpha', 'beta'],
  ['src/alpamayo1_5/models/token_utils.py', 'extract_traj_tokens', 'decode'],
])('screens equivalent call structures in %s without domain vocabulary', (path, caller, callee) => {
  const { rows } = extract(path, `def ${callee}(x): return x\ndef ${caller}(x):\n    len(x)\n    return ${callee}(x)\n`);
  expect(rows).toHaveLength(1); // Ordinary builtins remain outside the call view.
  expect(rows[0]).toMatchObject({from: caller, to: callee, action: `Call ${callee}`, classificationPolicyVersion: 3});
  expect(classify(rows[0])).toMatchObject({hazardAnalysisEligibility: 'Include', interfaceType: 'Function Call'});
  expect(classify(rows[0]).hazardAnalysisEligibilityRationale).toMatch(/independent of domain/);
  const identified = ensureCodeArchitectureTraceIds(rows);
  const downstream = buildCodeArchitectureHazardInput({ cbaRows: identified });
  expect(downstream.tableRows).toHaveLength(7); // Existing seven STPA guide phrases per call.
  expect(downstream.tableRows[0].traceId).toBe(identified[0].traceId);
  expect(downstream.tableRows[0].relationshipEvidence).toEqual(rows[0].relationshipEvidence);
  const reviewed = ensureHazardSummaryEvidenceColumns({Summary: [['Architecture Row Ref', 'Hazards'], [downstream.tableRows[0].rowRef, 'Assess loss in the operational context.']]}, downstream.tableRows);
  expect(reviewed.Summary[1][reviewed.Summary[0].indexOf('Code Evidence')]).toMatch(/Call syntax at/);
});

it('keeps every real call for renamed token functions, without redirecting where to clamp', () => {
  for (const caller of ['extract_traj_tokens', 'normalize_values']) {
    const { rows } = extract('src/helpers.py', `import torch\ndef ${caller}(x):\n    torch.where(x, x, x)\n    return torch.clamp(x, min=0)`);
    expect(rows.map(row => row.to).sort()).toEqual(['torch.clamp', 'torch.where']);
    expect(rows.every(row => !row.syntheticHazardSummaryRow && !row.sourceAuditGenerated)).toBe(true);
  }
});

it('preserves mixed-language calls while explicitly distinguishing model-only and empty coverage', () => {
  const py = extract('src/math.py', 'def b(x): return x\ndef a(x): return b(x)');
  const proposal = { from: 'Estimator::step', to: 'combine', fromFile: 'src/estimator.cpp', toFile: 'src/math.cpp', action: 'Call combine' };
  const cpp = extract(proposal.fromFile, 'void Estimator::step() { combine(); }', [proposal]);
  const empty = extract('src/empty.hpp', '// Model response contained no rows');
  expect(cpp.rows).toHaveLength(1);
  expect(cpp.rows[0].relationshipEvidence).toMatchObject({ supported: false, extractionMethod: 'model-only' });
  expect(classify(cpp.rows[0]).hazardAnalysisEligibility).toBe('Include');
  expect(classify(cpp.rows[0]).hazardAnalysisEligibilityRationale).toMatch(/completeness.*unverified/);
  const hazard = buildCodeArchitectureHazardInput({ cbaRows: ensureCodeArchitectureTraceIds([...py.rows, ...cpp.rows]) });
  expect(hazard.tableRows).toHaveLength(14);
  const ledger = {...py.ledger, ...cpp.ledger, ...empty.ledger};
  const coverage = summarizeCodeAnalysisCoverage(ledger);
  expect(coverage).toMatchObject({files: 3, syntaxFiles: 1, modelOnlyFiles: 2, emptyModelFiles: 1});
  const sheets = architectureCoverageSheets([{relationshipLedger: ledger, inputManifest: Object.keys(ledger).map(path => ({path}))}]);
  expect(sheets.runs[0]['Files With Model Extraction Only']).toBe(2);
  expect(sheets.files.find(file => file.Path === proposal.fromFile)).toMatchObject({'Source Relationships': '', 'Published Calls': '', 'Model-only Proposals': 1});
});

it('does not convert unmatched Python model proposals, structural evidence or test code into hazard inputs', () => {
  const path = 'src/empty.py';
  const proposal = {from: 'run', to: 'guess', fromFile: path, toFile: path, action: 'Call guess'};
  const unmatched = completeSupportedRelationships([proposal], pythonRelationshipInventory(path, '# empty'))[0];
  expect(classify(unmatched).hazardAnalysisEligibility).toBe('Needs Review');
  for (const testPath of ['tests/control.py', 'src/test_main.cpp', 'src/main_test.cc', 'src/main.test.js']) {
    const row = {...unmatched, fromFile: testPath, grounding: {currentFile: testPath}, relationshipEvidence: {...unmatched.relationshipEvidence, extractionMethod: 'model-only'}};
    expect(classify(row).hazardAnalysisEligibility).toBe('Exclude');
  }
  const structure = completeSupportedRelationships([], pythonRelationshipInventory('src/a.py', 'class A(B):\n    def run(self): pass'));
  expect(structure.every(row => classify(row).hazardAnalysisEligibility === 'Exclude')).toBe(true);
});

it('preserves existing assessments on load and analyst decisions plus identities on policy-only reruns', () => {
  const { rows } = extract('src/helpers.py', 'def b(x): return x\ndef a(x): return b(x)');
  const saved = ensureCodeArchitectureTraceIds(reconcileArchitectureRows(rows, [], 'scope'));
  Object.assign(saved[0], {classificationPolicyVersion: 2, hazardAnalysisEligibility: 'Exclude', hazardAnalysisEligibilitySource: 'analyst-override', hazardAnalysisEligibilityRationale: 'Reviewed nonhazardous scope', fromDetails: 'Reviewed details'});
  const next = ensureCodeArchitectureTraceIds(reconcileArchitectureRows(rows, saved, 'scope'));
  for (const field of ['traceId','rowRef','fromNodeId','toNodeId','edgeId','fromDetails']) expect(next[0][field]).toBe(saved[0][field]);
  expect(classify(next[0])).toMatchObject({hazardAnalysisEligibility: 'Exclude', hazardAnalysisEligibilitySource: 'analyst-override'});
  expect(isCodeArchitectureHazardEligible({...rows[0], lineage: {status: 'historical'}})).toBe(false);
  expect(classify({...rows[0], classificationPolicyVersion: 2}).hazardAnalysisEligibility).toBe('Needs Review');
});

it('reports parse failures and missing records without promising complete coverage', () => {
  expect(summarizeCodeAnalysisCoverage({'a.py': {supported: true, parseErrors: [{line: 2}]}, 'b.cpp': {supported: false, modelOnly: 0}}, [{path: 'missing.py'}]))
    .toMatchObject({files: 3, syntaxFiles: 1, modelOnlyFiles: 1, parseErrorFiles: 1, emptyModelFiles: 1, unrecordedFiles: 1});
});

it.each(['rotation', 'settle_payment', 'deliver_dose', 'helper'])('does not infer safety significance or rewrite findings from %s symbols', caller => {
  const { rows } = extract(`src/${caller}.py`, `def target(x): return x\ndef ${caller}(x): return target(x)`);
  const row = {...rows[0], rowRef: '1'};
  for (const significant of ['', 'Yes', 'No']) {
    const sheets = ensureHazardSummaryEvidenceColumns({Summary: [['Architecture Row Ref', 'Hazards', 'Safety Significant'], ['1', 'The assessed operational loss.', significant]]}, [row]);
    const result = Object.fromEntries(sheets.Summary[0].map((header, i) => [header, sheets.Summary[1][i]]));
    expect(result.Hazards).toBe('The assessed operational loss.');
    expect(result['Safety Significant']).toBe(significant);
    expect(result['Proposed Safety Assessment']).toBe(significant === 'Yes' ? 'Safety' : significant === 'No' ? 'Mission/Reliability' : 'Needs Review');
    expect(result['Evidence Classification']).toBe('Plausible but not evidenced');
    expect(result['Mitigation Evidence']).toMatch(/No mitigation is inferred/);
  }
});
