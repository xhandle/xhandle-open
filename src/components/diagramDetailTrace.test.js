import {resolveDiagramDetailRows, diagramDetailLinkTarget} from './diagramDetailTrace';
import {computeArchitectureByFunction} from './diagramArchitectureIndexes';

const rows = [
  {rowRef:1,traceId:'functional-relationship:a',edgeId:'functional-relationship:a',fromNodeId:'function:a',toNodeId:'function:b',fromFunction:'Initialize',toFunction:'Query',fromArchitecture:{subsystem:'Runtime'},architecture:{subsystem:'Runtime'},codeEvidence:{rowRefs:[2,900]},functionalModel:{sourceTraceIds:['csu-original']}},
  {rowRef:2,traceId:'functional-relationship:b',edgeId:'functional-relationship:b',fromNodeId:'function:other',toNodeId:'function:c',fromFunction:'Initialize',toFunction:'Return'},
];

test('Functional node evidence survives endpoint allocation and stays scoped to its stable node identity',()=>{
  const byNode=computeArchitectureByFunction(rows,{useNodeIds:true});
  expect(rows[0].fromArchitecture.evidence).toBeUndefined();
  expect(byNode.get('function:a').evidence.rowRefs).toEqual([1]);
  expect(byNode.get('function:other').evidence.rowRefs).toEqual([2]);
  const target={type:'node',id:'function:a',label:'Initialize',codeEvidence:byNode.get('function:a').evidence};
  expect(resolveDiagramDetailRows(rows,target).map(entry=>entry.rowIndex)).toEqual([0]);
});

test('Functional edge resolves its own row rather than coincident CSU evidence row numbers',()=>{
  const target={type:'edge',id:rows[0].edgeId,rowRef:1,codeEvidence:rows[0].codeEvidence};
  const entries=resolveDiagramDetailRows(rows,target);
  expect(entries.map(entry=>entry.rowIndex)).toEqual([0]);
  const linked=diagramDetailLinkTarget(target,entries);
  expect(linked.codeEvidence.rowRefs).toEqual(['1','functional-relationship:a','csu-original']);
  expect(linked.rowRefs).not.toContain(2);
  expect(rows[0].codeEvidence.rowRefs).toEqual([2,900]);
});

test('aggregated edges use explicit diagram row references without adding CSU row numbers',()=>{
  expect(resolveDiagramDetailRows(rows,{type:'edge',id:'aggregate',rowRefs:[1],codeEvidence:{rowRefs:[2,900]}}).map(entry=>entry.rowIndex)).toEqual([0]);
});

test('group boxes resolve explicit row refs and stale refs never become positional links',()=>{
  expect(resolveDiagramDetailRows(rows,{type:'architectureBox',codeEvidence:{rowRefs:[1,2]}})).toHaveLength(2);
  expect(resolveDiagramDetailRows([{rowRef:50,traceId:'saved'}],{type:'edge',rowRef:1})).toEqual([]);
  expect(resolveDiagramDetailRows(rows,null)).toEqual([]);
});

test('CSU rows without stable IDs retain label-derived node and row-ref navigation',()=>{
  const legacy=[{fromFunction:'Read',toFunction:'Send',rowRef:17}];
  expect(resolveDiagramDetailRows(legacy,{type:'node',id:'n:Send'})[0].row).toBe(legacy[0]);
  expect(resolveDiagramDetailRows(legacy,{type:'edge',rowRef:17})[0].rowIndex).toBe(0);
  expect(resolveDiagramDetailRows([{fromFunction:'Read'}],{type:'node',id:'n:Read'})[0].ref).toBe('1');
});
