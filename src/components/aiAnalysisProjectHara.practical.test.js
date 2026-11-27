import { fetchLLMResponse } from './aiAnalysisSTPA';
import { runLiteAIAnalysis } from './aiAnalysisLite';
import { completeProjectStpaAssessment } from '../features/project-hazard-analysis/stpaAcceptance';
import { completeProjectHaraAssessment } from '../features/project-hazard-analysis/haraCompletionPolicy';
import { resolveProjectStpaFoundation } from '../features/project-hazard-analysis/projectStpaFoundation';
jest.mock('./aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn()}));
jest.mock('./aiAnalysisHaraConsistency',()=>({reconcileProjectHaraExposure:jest.fn(async()=>false)}));
jest.mock('./aiAnalysisHaraGoals',()=>({consolidateProjectHaraGoals:jest.fn(async()=>false)}));
const headers=['Function (From)','Function (From) Details','Control Action','Control Action Details','Function (To)','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Context Assumptions','Guide Phrase'];
const fd=['Controller','Controls demand','Brake demand','Demand state','Brake actuator','context-1','Urban crossing','Remote driving','Pedestrians nearby','A human operator commands motion.','Not providing the control action causes a hazard'];
const sheets=()=>({'Functional Decomposition':[headers,fd]});
const options=()=>({sheets:sheets(),tableRows:[],currentFolder:'Synthetic',setFolders:async update=>update({}),setProgress:jest.fn(),organizationContext:'Synthetic profile',stpaProfileProvenance:{effectiveContextIdentity:'profile-1'},
 haraItem:{name:'Synthetic braking item',definition:'Vehicle controller and brake actuator supporting occupied crossings.',origin:'user'}});
const cell=(result,name,index=1)=>result.Summary[index][result.Summary[0].indexOf(name)];
const inputs=prompt=>JSON.parse(prompt.slice(prompt.lastIndexOf('Events:\n')+8).split('\nPreserve the supplied STPA')[0]);
beforeEach(()=>{
 jest.clearAllMocks();
 fetchLLMResponse.mockImplementation(async prompt=>{
  if(prompt.startsWith('Identify the HARA Item'))return JSON.stringify({name:'Vehicle motion system',definition:'The modeled vehicle motion functions, with remote operators external and actuation interfaces identified.',rationale:'The complete graph supports a common vehicle motion function.'});
  if(prompt.includes('Events:\n'))return JSON.stringify({assessments:inputs(prompt).map(input=>({...completeProjectHaraAssessment({severity:'S3',exposure:'E4',controllability:'C3'},input),applicabilityDecision:'No',safetySignificant:'No',asil:'QM'}))});
  const records=JSON.parse(prompt.slice(prompt.lastIndexOf('Rows:\n')+6));
  return JSON.stringify(records.map(record=>completeProjectStpaAssessment({}, {id:record.id,from:record.functionFrom,controlAction:record.controlAction,to:record.functionTo,guidePhrase:record.guidePhrase})));
 });
});

test('AI identifies the Item once from the full decomposition, persists it and shares it across HARA outputs without repeating STPA',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});fetchLLMResponse.mockClear();
 const itemFunctionalRows=[{fromFunction:'Controller',controlAction:'Brake demand',toFunction:'Brake actuator',subsystem:'Braking'},
  {fromFunction:'Operator',controlAction:'Authority request',toFunction:'Authority controller',subsystem:'Authority'}];
 const onHaraItem=jest.fn();
 const result=await runLiteAIAnalysis({...options(),haraItem:null,itemFunctionalRows,onHaraItem,hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base}});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
 const itemPrompt=fetchLLMResponse.mock.calls[0][0];expect(itemPrompt).toContain('Authority request');expect(itemPrompt).toContain('Brake demand');
 expect(result.haraItem.name).toBe('Vehicle motion system');expect(cell(result,'Item')).toBe(result.haraItem.name);
 expect(cell(result,'Item ID')).toBe(result.haraItem.id);expect(cell(result,'Item Definition')).toBe(result.haraItem.definition);
 expect(result['HARA Item Definition'][1][2]).toBe(result.haraItem.definition);expect(onHaraItem).toHaveBeenCalledWith(result.haraItem);
 expect(cell(result,'Hazard')).toBe(cell(base,'Hazards'));
 fetchLLMResponse.mockClear();
 await runLiteAIAnalysis({...options(),haraItem:result.haraItem,itemFunctionalRows,hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base}});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);expect(fetchLLMResponse.mock.calls[0][0]).toContain('Do not repeat STPA');
});

test('completed Projects STPA feeds HARA with zero further STPA requests',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);fetchLLMResponse.mockClear();
 const result=await runLiteAIAnalysis({...options(),hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base}});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
 expect(fetchLLMResponse.mock.calls[0][0]).toContain('Events:\n');
 for(const [target,source] of [['Loss','Losses'],['Hazard','Hazards'],['Unsafe Control Action','Unsafe Control Actions'],['Guide Phrase Applicable','Guide Phrase Applicable'],['Safety Significant','Safety Significant']])expect(cell(result,target)).toBe(cell(base,source));
 expect(cell(result,'Guide Phrase Applicable')).toBe('Yes');
 expect(cell(result,'ASIL')).toBe('ASIL D');
 expect(cell(result,'Assessment Status')).toBe('Complete');
 expect(cell(result,'HARA Review Findings')).toBe('');
});
test('without STPA, the same practical STPA engine runs once before HARA',async()=>{
 const onStpaFoundation=jest.fn();
 const result=await runLiteAIAnalysis({...options(),hazardMethod:'HARA',onStpaFoundation});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
 expect(onStpaFoundation).toHaveBeenCalledTimes(1);
 expect(onStpaFoundation.mock.calls[0][0].Summary).toHaveLength(2);
 expect(cell(result,'ASIL')).toBe('ASIL D');
});
test('a missing HARA field completes locally without individual correction requests',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 fetchLLMResponse.mockClear();fetchLLMResponse.mockResolvedValue('{"assessments":[]}');
 const result=await runLiteAIAnalysis({...options(),hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base}});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
 expect(cell(result,'Severity')).toMatch(/^S[0-3]$/);expect(cell(result,'Exposure')).toMatch(/^E[0-4]$/);expect(cell(result,'Controllability')).toMatch(/^C[0-3]$/);
 expect(cell(result,'Safety Goal')).toContain('shall');expect(cell(result,'Assessment Status')).toBe('Complete');
 expect(JSON.stringify(result.Summary)).not.toMatch(/Needs Review|\bTBD\b|Not assessed/);
 expect(cell(result,'Hazard')).toBe(cell(base,'Hazards'));
});
test('changed context regenerates affected STPA; profile and HARA Item edits preserve completed STPA',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 const changedProfile={stpaProfileProvenance:{effectiveContextIdentity:'profile-2'},organizationContext:'Updated synthetic policy'};
 const onStpaFoundation=jest.fn();fetchLLMResponse.mockClear();
 await runLiteAIAnalysis({...options(),...changedProfile,hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base},onStpaFoundation});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);expect(fetchLLMResponse.mock.calls[0][0]).toContain('Updated synthetic policy');
 expect(onStpaFoundation.mock.calls[0][0].stpaFoundationBasis.entries).toEqual(base.stpaFoundationBasis.entries);
 expect(onStpaFoundation.mock.calls[0][0].stpaFoundationBasis.profileIdentities).toEqual(base.stpaFoundationBasis.profileIdentities);
 fetchLLMResponse.mockClear();
 await runLiteAIAnalysis({...options(),sheets:{'Functional Decomposition':[headers,fd.map((v,i)=>i===8?'Ice':v)]},hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base}});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
 fetchLLMResponse.mockClear();await runLiteAIAnalysis({...options(),hazardMethod:'HARA',haraItemDefinition:'New HARA boundary interpretation',stpaFoundationRecord:{analysisResult:base}});expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});
test('partial STPA reuses completed rows and generates only missing rows',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 const second=fd.map((v,i)=>i===2?'Steering demand':v),generate=jest.fn(async input=>{
  const result=await runLiteAIAnalysis({...options(),sheets:input,hazardMethod:'STPA-Textbook'});return result;
 });
 const result=await resolveProjectStpaFoundation({...options(),sheets:{'Functional Decomposition':[headers,fd,second]},stpaFoundationRecord:{analysisResult:base},generate});
 expect(generate.mock.calls[0][0]['Functional Decomposition']).toEqual([headers,second]);
 expect(result.Summary).toHaveLength(3);
});
test('cancellation and storage failures do not become completed HARA results',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 const error=Object.assign(new Error('Interrupted'),{name:'AbortError'});fetchLLMResponse.mockRejectedValue(error);
 await expect(runLiteAIAnalysis({...options(),hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base}})).rejects.toBe(error);
 await expect(runLiteAIAnalysis({...options(),hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base},onStpaFoundation:async()=>{throw Error('Storage unavailable');}})).rejects.toThrow('Storage unavailable');
});

test('legacy completed STPA reuses the saved functional inputs and profile provenance',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 delete base.stpaFoundationBasis;
 const idIndex=base.Summary[0].indexOf('Raw Analysis Row ID');
 const record={analysisResult:base,draftHazardRowsByIndex:{one:{row:base.Summary[1],organizationProfileProvenance:options().stpaProfileProvenance}}};
 expect(idIndex).toBeGreaterThanOrEqual(0);fetchLLMResponse.mockClear();
 await runLiteAIAnalysis({...options(),hazardMethod:'HARA',stpaFoundationRecord:record});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});
test('completed HARA events saved by the earlier three-row implementation require no new provider requests',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 fetchLLMResponse.mockClear();
 const generationCheckpoint={read:jest.fn(async basis=>basis.stage==='projects-hara-practical-v1'
  ? {assessments:inputs(basis.prompt).map(input=>completeProjectHaraAssessment({severity:'S1',exposure:'E2',controllability:'C1',safetyGoal:'The item shall retain the previously derived objective.'},input))} : null),write:jest.fn(async()=>{})};
 const result=await runLiteAIAnalysis({...options(),hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base},generationCheckpoint});
 expect(fetchLLMResponse).not.toHaveBeenCalled();expect(cell(result,'Severity')).toBe('S1');
 expect(cell(result,'Safety Goal')).toBe('The item shall retain the previously derived objective.');
 expect(cell(result,'Functional Safety Requirements')).toBe(cell(base,'System Requirement'));
});

test('HARA progress advances by completed events and retains the source STPA identity',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 const setProgress=jest.fn();
 const result=await runLiteAIAnalysis({...options(),setProgress,hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base},tableRows:[{hazardDraftIdentity:'hara-row'}]});
 expect(cell(result,'STPA Source Row ID')).toBe(cell(base,'Raw Analysis Row ID'));
 expect(cell(result,'Raw Analysis Row ID')).toBe('hara-row');
 const completed=setProgress.mock.calls.map(([patch])=>patch).find(patch=>/Derived HARA outputs for 1 of 1/.test(patch.message));
 expect(completed).toMatchObject({step:95,total:100});
 const ready=setProgress.mock.calls.map(([patch])=>patch).find(patch=>/STPA assessments reused/.test(patch.message));
 expect(ready.step).toBe(0);
 expect(cell(result,'Functional Safety Requirements')).toBe(cell(base,'System Requirement'));
 expect(result['Functional Safety Requirements'][1][2]).toBe(cell(base,'Raw Analysis Row ID'));
});

test('a changed STPA base does not let an old generated draft mask the new Summary or discard analyst inputs',()=>{
 const {reconcileStpaFoundationDrafts}=require('../features/project-hazard-analysis/projectStpaFoundation');
 const headers=['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Guide Phrase','Hazard'];
 const row=['raw-1','Controller','Demand','Actuator','Not provided','Old hazard'];
 const draft={row,generated:true,organizationProfileProvenance:{effectiveContextIdentity:'old'},userPreprocessing:{values:{'Guide Phrase Applicable':'Yes'}}};
 const record={analysisResult:{Summary:[headers,row]},draftHazardRowsByIndex:{one:draft}};
 expect(reconcileStpaFoundationDrafts(record,record.analysisResult).one).toBe(draft);
 const changed=reconcileStpaFoundationDrafts(record,{Summary:[headers,[...row.slice(0,-1),'Updated hazard']]}).one;
 expect(changed.generated).toBe(false);expect(changed.row).toEqual(row);
 expect(changed.userPreprocessing).toMatchObject({pending:true,values:{'Guide Phrase Applicable':'Yes'}});
 expect(changed.organizationProfileProvenance).toBeUndefined();
});

test('a concluded SOTIF event stays complete without an E/E ASIL assignment',async()=>{
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify({assessments:inputs(prompt).map(input=>completeProjectHaraAssessment({evidenceBasis:'SOTIF concern',severity:'Not applicable',exposure:'Not applicable',controllability:'Not applicable'},input))}));
 const result=await runLiteAIAnalysis({...options(),hazardMethod:'HARA',stpaFoundationRecord:{analysisResult:base}});
 expect(cell(result,'ASIL')).toBe('Not assigned');expect(cell(result,'Assessment Status')).toBe('Complete');
});

test('partial STPA generation merges legacy singular and generator plural columns without causing a later rerun',async()=>{
 const {mergeProjectStpaFoundations}=require('../features/project-hazard-analysis/projectStpaFoundation');
 const base=await runLiteAIAnalysis({...options(),hazardMethod:'STPA-Textbook'});
 const aliases={Losses:'Loss',Hazards:'Hazard','Unsafe Control Actions':'Unsafe Control Action','Causal Factors':'Causal Factor','Safety Requirements/Constraints':'Safety Constraint'};
 base.Summary[0]=base.Summary[0].map(header=>aliases[header]||header);
 const second=fd.map((v,i)=>i===10?'The control action is provided too late':v);
 const input={...options(),sheets:{'Functional Decomposition':[headers,fd,second]}};
 const generate=async sheets=>runLiteAIAnalysis({...options(),sheets,hazardMethod:'STPA-Textbook'});
 const partial=await resolveProjectStpaFoundation({...input,stpaFoundationRecord:{analysisResult:base},generate});
 const saved=mergeProjectStpaFoundations(base,partial),retry=jest.fn();
 expect(saved.Summary[0].filter(header=>header==='Loss')).toHaveLength(1);expect(saved.Summary[0]).not.toContain('Losses');
 const reused=await resolveProjectStpaFoundation({...input,stpaFoundationRecord:{analysisResult:saved},generate:retry});
 expect(retry).not.toHaveBeenCalled();expect(reused.Summary).toHaveLength(3);
});
