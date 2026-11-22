import {functionalViewCsv,hydrateFunctionalViewSnapshot} from './functionalViewSnapshot';
import {functionalModelIsReady,buildFunctionalModelRows} from '../code-architecture-context/functionalModel';
import {functionalHierarchyIsReady} from '../code-architecture-context/functionalHierarchy';
import {toCsvText} from '../../lib/csv';

const headers=['Interaction ID','Function (From) ID','Function (To) ID','Hazard Analysis Eligibility','Eligibility Source','Eligibility Rationale','Interaction Type',
  'Function (From)','Function (From) Details','Control Action','Control Action Details','Function (To)','Function (To) Details',
  'Subsystem (From)','CSCI (From)','CSC (From)','Subsystem (To)','CSCI (To)','CSC (To)','Supporting Source Rows','Supporting Source Trace IDs'];
const cells=['interaction-1','function-a','function-b','Include','analyst-override','Explicit snapshot','control','Evaluate request','Validate request',
  'Send permitted target','Zero target during explicit reset','apply_target','Apply target','Control','Controller','Decision','Actuation','Adapter','Output','1','RAW-1'];
const rawRows=[{traceId:'RAW-1',from:'evaluate',to:'apply',fromFile:'control.py',toFile:'motion.py',lifecyclePhase:'Runtime',interfaceType:'Function Call',
  codeEvidence:{files:[{filePath:'control.py',content:'def evaluate():\n    return apply()\n'}],sourceFunctions:[{functionName:'evaluate',filePath:'control.py',startLine:1,endLine:2}]},
  sourceEvidence:{functions:[{functionName:'apply',filePath:'motion.py',content:'def apply():\n    return 0\n'}]}}];

test('restores a supplied Functional view with exact IDs, allocations and joined source evidence',()=>{
  const modeled=hydrateFunctionalViewSnapshot({text:toCsvText([headers,cells]),rawRows});
  expect(functionalModelIsReady(modeled)).toBe(true);
  expect(functionalHierarchyIsReady(modeled)).toBe(true);
  const rows=buildFunctionalModelRows(modeled);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({traceId:'interaction-1',fromNodeId:'function-a',toNodeId:'function-b',from:'Evaluate request',to:'apply_target'});
  expect(rows[0].functionalModel.sourceTraceIds).toEqual(['RAW-1']);
  expect(rows[0].codeEvidence.files).toContainEqual(rawRows[0].codeEvidence.files[0]);
  expect(rows[0].fromArchitecture).toMatchObject({subsystem:'Control',csci:'Controller',csc:'Decision'});
  expect(rows[0].controlActionDetails).toBe(cells[10]);
});
test('rendered Markdown preserves literal underscores and escaped pipes',()=>{
  const markdown='| '+headers.join(' | ')+' |\n| '+headers.map(()=> '---').join(' | ')+' |\n| '+cells.map(value=>value==='apply_target'?'apply\\_target':value==='Validate request'?'Validate \\| request':value).join(' | ')+' |';
  const modeled=hydrateFunctionalViewSnapshot({text:markdown,rawRows});
  expect(modeled[0].to).toBe('apply_target');expect(modeled[0].fromDetails).toBe('Validate | request');
});
test('missing source IDs or incomplete Markdown fail before a provider can be called',()=>{
  expect(()=>hydrateFunctionalViewSnapshot({text:toCsvText([headers,cells.map(value=>value==='RAW-1'?'UNKNOWN':value)]),rawRows})).toThrow('missing source');
  expect(()=>functionalViewCsv('| A | B |\n| --- | --- |\n| one |')).toThrow('inconsistent');
});
test('separate imports retain identical canonical functional inputs despite temporary parser edge IDs',()=>{
  const text=toCsvText([headers,cells]);
  const first=hydrateFunctionalViewSnapshot({text,rawRows}),second=hydrateFunctionalViewSnapshot({text,rawRows});
  expect(buildFunctionalModelRows(first)).toEqual(buildFunctionalModelRows(second));
  expect(buildFunctionalModelRows(first)[0].edgeId).toBe('interaction-1');
});
