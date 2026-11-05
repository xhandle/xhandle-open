import {prepareWorkspaceReadEvidence,compactAggregateContext} from './workspaceReadSession';
import {listProjects} from './workspaceGraphRepository';
import {executeWorkspaceReadPlan} from './workspaceReadClient';
jest.mock('./workspaceGraphRepository',()=>({listProjects:jest.fn()}));
jest.mock('./workspaceReadClient',()=>({executeWorkspaceReadPlan:jest.fn()}));
beforeEach(()=>{listProjects.mockResolvedValue([{id:'p',name:'Project',sourceData:{repos:[]}}]);executeWorkspaceReadPlan.mockResolvedValue([{operation:'aggregate',count:100,coverage:{complete:true}}]);});
const context={scope:{projectId:'p'},relevantArtifacts:[],diagnostics:{migration:{errors:[]}}};
test('simple counts use direct local reads without a planner model call',async()=>{
 const requestPlan=jest.fn();const result=await prepareWorkspaceReadEvidence({query:'How many requirements are there?',context,areas:['requirements'],requestPlan});
 expect(requestPlan).not.toHaveBeenCalled();expect(executeWorkspaceReadPlan).toHaveBeenCalledTimes(1);expect(result.results[0].count).toBe(100);
});

test('ordinary unfiltered lists use local reads without a serial planner model request',async()=>{
 const requestPlan=jest.fn();const result=await prepareWorkspaceReadEvidence({query:'Show all software requirements',context,areas:['requirements'],requestPlan});
 expect(requestPlan).not.toHaveBeenCalled();expect(executeWorkspaceReadPlan.mock.calls[0][0]).toEqual([{operation:'query',types:['code_architecture_software_requirement'],limit:12}]);expect(result.results).toHaveLength(1);
});

test('focused indexing constrains evidence to completed domains and cannot invoke a broader planner',async()=>{
 const scoped={...context,diagnostics:{indexScope:{types:['code_architecture_software_requirement']},migration:{errors:[]}}};
 const result=await prepareWorkspaceReadEvidence({query:'Show all software requirements',context:scoped});
 expect(result.results[0].coverage.complete).toBe(true);
 const requestPlan=jest.fn();
 const other=await prepareWorkspaceReadEvidence({query:'Which software requirements have missing hazards?',context:scoped,requestPlan});
 expect(other.coverage.state).toBe('not-searched');expect(requestPlan).not.toHaveBeenCalled();
 executeWorkspaceReadPlan.mockClear();
 const outside=await prepareWorkspaceReadEvidence({query:'Show all software requirements',context:scoped,areas:['risk']});
 expect(outside.coverage.state).toBe('not-searched');expect(executeWorkspaceReadPlan).not.toHaveBeenCalled();
});
test('complex requests use a validated read plan and never dispatch writes or expanded scopes',async()=>{
 const requestPlan=jest.fn(async()=>' {"calls":[{"operation":"delete","projectId":"foreign"}]}');
 const result=await prepareWorkspaceReadEvidence({query:'Which requirements have no linked hazards?',context,areas:['requirements'],requestPlan});
 expect(requestPlan).toHaveBeenCalledTimes(1);expect(executeWorkspaceReadPlan).not.toHaveBeenCalled();expect(result.coverage.state).toBe('not-searched');
});
test('index failures downgrade exact counts and preserve coverage warnings',async()=>{
 const result=await prepareWorkspaceReadEvidence({query:'How many requirements are there?',context:{...context,diagnostics:{migration:{errors:[{step:'requirements',error:'failed'}]}}},areas:['requirements']});
 expect(result.results[0].count).toBeNull();expect(result.results[0].coverage.state).toBe('stale');
});
test('ambiguous projects clarify before a model or source read',async()=>{
 listProjects.mockResolvedValue([{id:'a',name:'Same'},{id:'b',name:'Same'}]);const requestPlan=jest.fn();
 const result=await prepareWorkspaceReadEvidence({query:'Count requirements in Same',context,areas:['requirements'],requestPlan});
 expect(result.clarification).toMatch(/Which project/);expect(requestPlan).not.toHaveBeenCalled();expect(executeWorkspaceReadPlan).not.toHaveBeenCalled();
});
test('general definitions do not require choosing a project or running a read planner',async()=>{
 const requestPlan=jest.fn();const result=await prepareWorkspaceReadEvidence({query:'What is a software requirement?',context,areas:['requirements'],requestPlan});expect(result).toBeNull();expect(requestPlan).not.toHaveBeenCalled();expect(executeWorkspaceReadPlan).not.toHaveBeenCalled();
});

test('complete aggregates keep scope and citations without sending redundant sampled bodies',()=>{
 const context={scope:{projectId:'p'},projects:[{id:'p'}],citations:[{artifactId:'a'}],relevantArtifacts:[{id:'a',content:'private sample'}],sourceFiles:[{content:'unneeded source'}],relationships:[{id:'r'}]};
 const aggregate={results:[{operation:'aggregate',count:0,coverage:{complete:true}}]};
 const compact=compactAggregateContext(context,aggregate);
 expect(compact.relevantArtifacts).toEqual([]);expect(compact.scope).toBe(context.scope);expect(compact.citations).toBe(context.citations);expect(compact.projects).toBe(context.projects);
 for(const results of [[{operation:'aggregate',count:null,coverage:{complete:false}}],[{operation:'read',coverage:{complete:true}}]])expect(compactAggregateContext(context,{results})).toBe(context);
});

test('semantic domain reads can use a validated plan instead of the aggregate-only fast path',async()=>{
 const requestPlan=jest.fn(async()=>JSON.stringify({calls:[{operation:'search',query:'WeatherEstimator',types:['code_architecture_edge']}]}));
 const scoped={...context,diagnostics:{indexScope:{types:['code_architecture_edge'],deterministic:false},migration:{errors:[]}}};
 await prepareWorkspaceReadEvidence({query:'What does WeatherEstimator do?',policyQuery:'What does WeatherEstimator do?',context:scoped,areas:['functional'],force:true,requestPlan});
 expect(requestPlan).toHaveBeenCalledTimes(1);
 expect(executeWorkspaceReadPlan.mock.calls[0][0][0]).toMatchObject({operation:'search',query:'WeatherEstimator',types:['code_architecture_edge']});
});

test('failed context preparation does not turn stale cached counts into an exact answer',async()=>{
 const result=await prepareWorkspaceReadEvidence({query:'Count requirements',context:{...context,diagnostics:{workspaceGraphContextError:'unavailable'}},force:true});
 expect(result.coverage).toMatchObject({state:'inaccessible',complete:false});
 expect(executeWorkspaceReadPlan).not.toHaveBeenCalled();
});

test('reference query does not expand projects or history authorized by the current prompt',async()=>{
 const requestPlan=jest.fn(async()=>JSON.stringify({calls:[{operation:'versions',history:'all',projectId:'other',types:['generated_report']}]}));
 const result=await prepareWorkspaceReadEvidence({query:'Show all previous versions across all projects',policyQuery:'Explain the report',context,areas:['reports'],force:true,requestPlan});
 expect(result.coverage.state).toBe('not-searched');expect(executeWorkspaceReadPlan).not.toHaveBeenCalled();
});
