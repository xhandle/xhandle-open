jest.mock('../../components/backendConfig', () => ({backendURL:'https://example.test',buildAIAuthOpts:()=>({})}));
import { processFunctionalModel } from '../code-architecture-context/testSupport/functionalHierarchyFixture';
import { buildFunctionalModelRows } from '../code-architecture-context/functionalModel';
import { softwareRequirementSource } from './softwareRequirementSource';
import { deriveSoftwareRequirements } from './artifactAI';
import { functionalRowIndexForTraceValue } from './artifactUtils';
const input = [
  { from: 'plan', to: 'list.append', action: 'Call append', fromFile: 'planner.py', toFile: 'planner.py', traceId: 'raw-1', rowRef: 1, relationshipEvidence: { targetResolution: 'unresolved-runtime-target' } },
  { from: 'plan', to: 'publish', action: 'Call publish', fromFile: 'planner.py', toFile: 'output.cpp', traceId: 'raw-2', rowRef: 2 },
  { from: 'publish', to: 'write', action: 'Write command', fromFile: 'output.cpp', toFile: 'transport.hpp', traceId: 'raw-3', rowRef: 3 },
].map(row => ({ ...row, architecture: { subsystem: 'Motion', csci: 'Planner', csc: 'Control', csu: row.from }, hazardAnalysisEligibility: 'Include', hazardAnalysisEligibilitySource: 'user', lifecyclePhase: 'Runtime' }));
const request = async prompt => {
  if (prompt.includes('Consolidation input: ')) {
    const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
    return { responsibilities: functions.map(fn => ({ members: [fn.id], name: fn.name, description: fn.description })) };
  }
  const evidence = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
  return { function: { name: evidence[0].from === 'plan' ? 'Plan Motion' : 'Publish Command', description: 'Responsibility grounded in source.', significance: 'implementation' }, relationships: evidence.map(row => ({ index: row.index,
    significance: (row.sourceDefinedTarget || row.crossFile) ? 'meaningful' : 'implementation', disposition: (row.sourceDefinedTarget || row.crossFile) ? 'interaction' : 'internal', target: (row.sourceDefinedTarget || row.crossFile) ? { name: 'Transmit Command', description: 'Publish the requested command.' } : null,
    action: (row.sourceDefinedTarget || row.crossFile) ? 'Motion command' : '', kind: 'control', description: 'Requested vehicle motion information.', rationale: 'Based on supplied interaction evidence.' })) };
};


test.each(['github','local'])('prefers the complete Functional table for %s sources and preserves reload behavior',async sourceType=>{
 const ready=await processFunctionalModel(input.map(row=>({...row,sourceType})),{request});
 const expected=buildFunctionalModelRows(ready);
 const selected=softwareRequirementSource(ready);
 expect(selected.type).toBe('Functional');
 expect(selected.rows).toEqual(expected);
 expect(selected.rows.some(row=>row.functionalModel.internal)).toBe(true);
 expect(softwareRequirementSource(selected.rows).rows).toBe(selected.rows);
 expect(softwareRequirementSource(JSON.parse(JSON.stringify(ready)))).toEqual(selected);
});
test('missing and stale Functional models use current CSU rows',async()=>{
 expect(softwareRequirementSource(input)).toEqual({type:'CSU',rows:input});
 const ready=await processFunctionalModel(input,{request});
 const stale=ready.map((row,index)=>index===0?{...row,action:'Changed action'}:row);
 expect(softwareRequirementSource(stale)).toEqual({type:'CSU',rows:stale});
 expect(softwareRequirementSource([...input,{...input[0],lineage:{status:'historical'}}]).rows).toEqual(input);
});
test('derivation sends Functional rows to the model and retains supporting CSU trace references',async()=>{
 const ready=await processFunctionalModel(input,{request});
 const projected=buildFunctionalModelRows(ready);
 const previous=global.fetch;
 global.fetch=jest.fn(async(_url,options)=>{
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
  expect(payload.functionalDecomposition.map(row=>row.traceId)).toEqual(projected.map(row=>row.traceId));
  return {ok:true,json:async()=>({answer:JSON.stringify({requirements:projected.map((row,index)=>({
   id:`SWR-${index+1}`,sourceTraceId:row.traceId,requirementText:'The software shall validate the requested motion before transmission.'
  }))})})};
 });
 try {
  const result=await deriveSoftwareRequirements({cbaRows:ready});
  expect(result).toHaveLength(projected.length);
  result.forEach((row,index)=>{
   expect(row.sourceTraceId).toBe(projected[index].traceId);
   expect(row.sourceArchitectureRefs[0].sourceTraceIds).toEqual(projected[index].functionalModel.sourceTraceIds);
   expect(functionalRowIndexForTraceValue(projected,row.sourceTraceId)).toBe(index);
   expect(functionalRowIndexForTraceValue(ready,row.sourceTraceId)).toBe(projected[index].functionalModel.sourceIndices[0]);
  });
 } finally {global.fetch=previous;}
});

test('imported Functional CSV is selected after reload with supporting references',()=>{
 const {parseCodeArchitectureCsv}=require('../code-architecture-context/codeArchitectureCsvImport');
 const {restoreFunctionalCsvSnapshot}=require('../code-architecture-context/functionalModel');
 const csv='Interaction ID,Function (From),Control Action,Function (To),Interaction Type,Supporting Source Trace IDs\ninteraction-1,Evaluate,Decision,Apply,control,raw-1';
 const imported=parseCodeArchitectureCsv(csv).map(row=>({...row,from:row.fromFunction,to:row.toFunction,action:row.controlAction}));
 const restored=JSON.parse(JSON.stringify(restoreFunctionalCsvSnapshot(imported)));
 const selected=softwareRequirementSource(restored);
 expect(selected.type).toBe('Functional');
 expect(selected.rows[0].traceId).toBe('interaction-1');
 expect(selected.rows[0].functionalModel.sourceTraceIds).toEqual(['raw-1']);
});
