import {compactSelectionMetadata} from './selectionMetadata';

test('retains selected diagram subjects without copying heavy diagram data', () => {
  const selectedNodes = [{id:'base',label:'Base Vehicle Platform',description:'HIDDEN_BODY'}, {id:'environment',label:'Operating Environment'}];
  const result = compactSelectionMetadata({activeSelections:[{kind:'functional-canvas',projectId:'p',selectedNodes,selectedRows:[{content:'HIDDEN_BODY'}]}]});
  expect(result[0].selectedNodes.map(node => node.label)).toEqual(['Base Vehicle Platform','Operating Environment']);
  expect(result[0].projectId).toBe('p');
  expect(JSON.stringify(result)).not.toContain('HIDDEN_BODY');
});

test('bounds selections and retains edge endpoints and legacy canvas selections', () => {
  const canvas = {hasSelection:true,selectedNodes:Array.from({length:20},(_,id)=>({id:String(id),label:'x'.repeat(300)})),selectedEdge:{id:'edge',source:'Base Vehicle Platform',target:'Operating Environment'}};
  const result = compactSelectionMetadata({viewedProjectId:'p',functionalCanvasSelection:canvas});
  expect(result[0].selectedNodes).toHaveLength(12);
  expect(result[0].selectedNodes[0].label).toHaveLength(240);
  expect(result[0].selectionTruncated).toBe(true);
  expect(result[0].selectedEdge.target).toBe('Operating Environment');
  expect(compactSelectionMetadata({activeSelections:[{kind:'functional-canvas',...canvas}],functionalCanvasSelection:canvas})).toHaveLength(1);
  expect(compactSelectionMetadata({activeSelections:Array.from({length:20},()=>({kind:'row'}))})).toHaveLength(8);
});


test('selected evidence carries descriptions and rows with a bounded cyclic payload', () => {
  const {boundedSelectionEvidence, selectionEvidenceQuery} = require('./selectionMetadata');
  const selection = {kind:'functional-canvas',projectId:'p', selectedEdge:{id:'motion',label:'Vehicle Motion',source:'Base Vehicle Platform',target:'Operating Environment',description:'Physical motion of the vehicle'},selectedRows:[{controlDetails:'Vehicle motion output'}]};
  const focus = {viewedProjectId:'p',activeSelections:[selection,{kind:'row',projectId:'other',values:{secret:'FOREIGN'}}]};
  const evidence = boundedSelectionEvidence(focus);
  expect(evidence.selections).toHaveLength(1);
  expect(evidence.selections[0].selectedEdge.description).toBe('Physical motion of the vehicle');
  expect(evidence.selections[0].selectedRows[0].controlDetails).toBe('Vehicle motion output');
  const query = selectionEvidenceQuery('Are hazards tracked between these two functions?',focus);
  expect(query).toContain('Base Vehicle Platform');
  expect(query).toContain('Operating Environment');
  expect(selectionEvidenceQuery('Explain recursion',focus)).toBe('Explain recursion');
  selection.values = {large:'x'.repeat(100000)};
  selection.values.self = selection.values;
  const bounded = boundedSelectionEvidence(focus);
  expect(bounded.selectionTruncated).toBe(true);
  expect(JSON.stringify(bounded).length).toBeLessThan(15000);
});
