jest.mock('./aiAnalysisSTPA', () => ({fetchLLMResponse:jest.fn()}));
jest.mock('./backendConfig', () => ({backendURL:'https://example.test',buildAuthOpts:()=>({}),buildAIAuthOpts:()=>({})}));
const {fetchLLMResponse}=require('./aiAnalysisSTPA');
const {generateHaraAnalysisSheets,generateFhaAnalysisSheets}=require('./aiAnalysisHaraFha');
const {buildCodeArchitectureHazardInput}=require('../features/code-architecture-hazard-analysis/codeArchitectureHazardUtils');
const {importHazardSoftwareRequirements}=require('../features/code-architecture-assurance/artifactAI');
const source={from:'Validate brake command',action:'Apply brake torque',to:'Brake controller',traceId:'trace-1',rowRef:'1',hazardAnalysisEligibility:'Include'};
const contexts=[{id:'urban',scenario:'Urban driving',mode:'Automatic'},{id:'service',scenario:'Service depot',mode:'Maintenance'}];
const response=[1,2].map(i=>({id:`FD-${i}`,severityRationale:'Wheel lock can cause a fatal vehicle collision',softwareControlCategoryRationale:'Brake software autonomously commands actuator torque',causalPathType:'Contributory',causalEffect:'Excess torque reaches brake controller',resultingSystemState:'Wheel lock causes collision and injury',intermediateSafetyFunction:'Brake torque limiting',intermediateSafetyEffect:'Torque limiting fails to constrain actuator torque',protectionAssessment:'No independent protection evidenced',protectionStatus:'Absent',safetyClassificationRule:'R1',classificationEvidence:'Brake controller torque path',guidePhraseApplicable:'Yes',guidePhraseApplicabilityRationale:'Brake torque deviation is meaningful',controlActionType:'Command',causalFactorCategory:'Logic',mitigationStrategy:'Validate brake torque',systemRequirement:'The system shall limit braking torque.',acceptanceCriteria:'Output torque does not exceed validated request',safetyClassification:'Safety — Related',itemFunction:'Validate brake command',functionName:'Validate brake command',malfunction:'Brake torque exceeds requested torque',hazard:'Brake controller applies excess torque on a wet road and vehicle loses traction',operationalSituation:'Urban wet-road braking',hazardousEvent:'Excess brake torque locks the wheel during a turn',harm:'Vehicle occupants injured',severity:'S3',exposure:'E4',controllability:'C3',asil:'ASIL D',safetyGoal:'The system shall limit brake torque to the validated request.',functionalDegradationOrLoss:'Excess brake torque',mishap:'Vehicle collision',effect:'Wheel locks during a turn',severityCategory:'I - Catastrophic',softwareControlCategory:'1 - Autonomous',causalFactors:'Brake command limit omitted',controls:'Validate brake torque request',safetyRequirement:'The software shall validate the brake torque request.',verification:'Test brake torque limits',rationale:'Brake controller controls wheel torque',safetySignificant:'Yes',safetySignificanceRationale:'Excess brake torque can cause occupant injury',proposedSafetyAssessment:'Safety Related'}));
beforeEach(()=>{fetchLLMResponse.mockReset();jest.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>jest.restoreAllMocks());

const methods = [['HARA',generateHaraAnalysisSheets],['FHA',generateFhaAnalysisSheets]];
// Focused engine tests use one guide phrase across two contexts. Full expansion
// and all-phrase publication are verified separately below.
const inputFor = method => {
 const input=buildCodeArchitectureHazardInput({cbaRows:[source],method,projectId:'p',repoMeta:{repoId:'repo'},operationalContexts:contexts});
 input.tableRows=input.tableRows.slice(0,2);
 input.sheets['Functional Decomposition']=input.sheets['Functional Decomposition'].slice(0,3);
 return input;
};
test.each(methods)('%s preserves contexts and produces traceable software requirements', async(method,generate)=>{
 const input=inputFor(method);
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response));
 const result=await generate({sheets:input.sheets,setFolders:jest.fn(),currentFolder:'cba',codeArchitectureWorkflow:true});
 const headers=result.Summary[0];
 expect(result.Summary.slice(1).map(row=>row[headers.indexOf('Operational Context ID')])).toEqual(['urban','service']);
 expect(fetchLLMResponse.mock.calls[0][0]).toContain('Service depot');
 const requirements=importHazardSoftwareRequirements({hazardAnalysis:{id:'run',hazardMethod:method,generatedSheets:result}});
 expect(requirements).toHaveLength(2);
 expect(requirements[0]).toMatchObject({hazardAnalysisMethod:method,hazardAnalysisRunId:'run',linkedVerification:'Test brake torque limits'});
 expect(requirements[0].requirementText).toBe('The software shall validate the brake torque request.');
});
test.each(methods)('%s does not publish missing or incomplete responses',async(method,generate)=>{
 const publish=jest.fn();
 fetchLLMResponse.mockResolvedValue(JSON.stringify([{id:'FD-1',hazard:'Partial hazard'}]));
 await expect(generate({sheets:inputFor(method).sheets,setFolders:publish,currentFolder:'cba',codeArchitectureWorkflow:true})).rejects.toThrow('generation incomplete');
 expect(publish).not.toHaveBeenCalled();
 expect(fetchLLMResponse.mock.calls.length).toBeGreaterThan(1);
});
test.each(methods)('%s cancels an in-flight request without publishing or retrying',async(method,generate)=>{
 const controller=new AbortController();
 const publish=jest.fn();
 fetchLLMResponse.mockImplementation(async (...args)=>{expect(args[4].signal).toBe(controller.signal);controller.abort();return JSON.stringify(response);});
 await expect(generate({sheets:inputFor(method).sheets,setFolders:publish,currentFolder:'cba',codeArchitectureWorkflow:true,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
 expect(publish).not.toHaveBeenCalled();
});
test.each(methods)('%s resumes validated generation with matching context',async(method,generate)=>{
 const data=new Map();const checkpoint={read:jest.fn(async basis=>data.get(JSON.stringify(basis))),write:jest.fn(async(basis,value)=>data.set(JSON.stringify(basis),value))};
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response));
 const args={sheets:inputFor(method).sheets,setFolders:jest.fn(),currentFolder:'cba',codeArchitectureWorkflow:true,generationCheckpoint:checkpoint};
 await generate(args);const first=fetchLLMResponse.mock.calls.length;fetchLLMResponse.mockClear();
 await generate(args);expect(fetchLLMResponse.mock.calls.length).toBeLessThan(first);
 expect(checkpoint.write).toHaveBeenCalled();
});
test.each(methods)('%s legacy Projects invocation retains original sheet shape',async(method,generate)=>{
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response));
 const result=await generate({sheets:inputFor(method).sheets,setFolders:jest.fn(),currentFolder:'project'});
 expect(result.Summary[0]).not.toContain('Operational Context ID');
});
test('placeholder requirements are not imported even when classification says Yes',()=>{
 expect(importHazardSoftwareRequirements({generatedSheets:{Summary:[['Software Safety Requirement','Safety Significant'],['The software shall prevent Needs review: hazard not generated','Yes']]}})).toEqual([]);
});
test.each(methods)('%s provider failure never publishes fabricated hazards',async(method,generate)=>{
 fetchLLMResponse.mockRejectedValue(new Error('provider unavailable'));
 const publish=jest.fn();
 await expect(generate({sheets:inputFor(method).sheets,setFolders:publish,codeArchitectureWorkflow:true})).rejects.toThrow('generation incomplete');
 expect(publish).not.toHaveBeenCalled();
});
test('unresolved FHA ratings do not become a default SwCI or software requirement',async()=>{
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response.map(row=>({...row,severity:'Needs review: missing evidence',severityCategory:'Needs review: missing evidence'}))));
 const result=await generateFhaAnalysisSheets({sheets:inputFor('FHA').sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true});
 expect(result.Summary[1][result.Summary[0].indexOf('Software Criticality Index')]).toMatch(/Needs review/);
 expect(importHazardSoftwareRequirements({hazardAnalysis:{hazardMethod:'FHA',generatedSheets:result}})).toEqual([]);
});
test.each(methods)('%s rejects invalid risk ratings rather than assigning defaults',async(method,generate)=>{
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response.map(row=>({...row,severity:'unknown',severityCategory:'unknown'}))));
 await expect(generate({sheets:inputFor(method).sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true})).rejects.toThrow('generation incomplete');
});
test('repeated HARA runs do not mutate shared headers or the Projects schema',async()=>{
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response));
 const args={sheets:inputFor('HARA').sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true};
 await generateHaraAnalysisSheets(args);
 const result=await generateHaraAnalysisSheets(args);
 expect(result.Summary[0].filter(header=>header==='Software Safety Requirement')).toHaveLength(1);
 expect(result.Summary[1]).toHaveLength(result.Summary[0].length);
 const legacy=await generateHaraAnalysisSheets({...args,codeArchitectureWorkflow:false});
 expect(legacy.Summary[0]).not.toContain('Software Safety Requirement');
});
test.each(methods)('%s retains successful chunks after failure and bounds concurrent work',async(method,generate)=>{
 const input=inputFor(method);
 const sheet=input.sheets['Functional Decomposition'];
 input.sheets['Functional Decomposition']=[sheet[0],...Array.from({length:11},()=>[...sheet[1]])];
 const data=new Map();
 const checkpoint={read:async basis=>data.get(JSON.stringify(basis)),write:async(basis,value)=>data.set(JSON.stringify(basis),value)};
 let fail=true,active=0,peak=0;
 const requested=[];
 fetchLLMResponse.mockImplementation(async prompt=>{
  const ids=[...new Set(prompt.match(/FD-\d+/g)||[])];
  const generation=prompt.includes('You are performing a');
  if(generation) requested.push(ids);
  active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,1));active--;
  if(generation&&fail&&ids.includes('FD-11')) return '[]';
  return JSON.stringify(ids.map(id=>({...response[0],id})));
 });
 const args={sheets:input.sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true,generationCheckpoint:checkpoint};
 await expect(generate(args)).rejects.toThrow('generation incomplete');
 expect(data.size).toBe(1);expect(peak).toBeLessThanOrEqual(2);
 fail=false;requested.length=0;
 const result=await generate(args);
 expect(requested).toEqual([['FD-11']]);
 expect(result.Summary).toHaveLength(12);
});
test.each(methods)('%s includes enabled organization guidance in generation and classification',async(method,generate)=>{
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response));
 await generate({sheets:inputFor(method).sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true,organizationContext:'ORG-CALIBRATION-MARKER'});
 expect(fetchLLMResponse.mock.calls.length).toBeGreaterThan(1);
 for(const [prompt] of fetchLLMResponse.mock.calls) expect(prompt).toContain('ORG-CALIBRATION-MARKER');
 fetchLLMResponse.mockClear();
 await generate({sheets:inputFor(method).sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true,organizationContext:''});
 for(const [prompt] of fetchLLMResponse.mock.calls) expect(prompt).not.toContain('ORG-CALIBRATION-MARKER');
});

test.each(methods)('%s preserves reviewed decisions, excludes No from model calls, and round trips CSV', async(method,generate)=>{
 const {toCsvText}=require('../lib/csv');
 const {planHazardAnalysisCsvImport,applyHazardAnalysisCsvImport}=require('../features/project-hazard-analysis/hazardAnalysisCsv');
 const input=inputFor(method); const sheet=input.sheets['Functional Decomposition'];
 ['Yes','No'].forEach((value,i)=>{
  sheet[i+1][sheet[0].indexOf('Guide Phrase Applicable')]=value;
  sheet[i+1][sheet[0].indexOf('Guide Phrase Applicability Rationale')]='Explicit human decision';
  sheet[i+1][sheet[0].indexOf('Guide Phrase Applicability Review Status')]='Reviewed';
 });
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response.map(row=>({...row,guidePhraseApplicable:'Needs Review',safetyClassification:'Needs Review'}))));
 const args={sheets:input.sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true};
 for(let run=0;run<2;run++) {
  const result=await generate(args);const headers=result.Summary[0];
  expect(result.Summary.slice(1).map(row=>row[headers.indexOf('Guide Phrase Applicable')])).toEqual(['Yes','No']);
  expect(result.Summary[1][headers.indexOf('Safety Classification')]).toBe('Needs Review');
  expect(result.Summary[2][headers.indexOf('Hazard')]).toBe('Not applicable');
  const {ensureHazardAnalysisRowIds}=require('../features/project-hazard-analysis/classificationResolutionStatus');
  result.Summary=ensureHazardAnalysisRowIds(result.Summary);
  const plan=planHazardAnalysisCsvImport(result.Summary,toCsvText(result.Summary));
  expect(plan.errors).toEqual([]);
  const roundtrip=applyHazardAnalysisCsvImport(result.Summary,plan.updates);
  expect(roundtrip.slice(1).map(row=>row[headers.indexOf('Guide Phrase Applicable')])).toEqual(['Yes','No']);
 }
 expect(fetchLLMResponse.mock.calls.every(([prompt])=>!prompt.includes('"id":"FD-2"'))).toBe(true);
});

test.each(methods)('%s generates shared fields and retains method-specific risk outputs',async(method,generate)=>{
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response));
 const result=await generate({sheets:inputFor(method).sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true});
 const value=label=>result.Summary[1][result.Summary[0].indexOf(label)];
 expect(value('Acceptance Criteria')).toBe('Output torque does not exceed validated request');
 expect(value('System Requirement')).toBe('The system shall limit braking torque.');
 expect(value('Software Safety Requirement')).toBe('The software shall validate the brake torque request.');
 expect(value('Safety Classification')).toBe('Safety — Related');
 if(method==='HARA') {expect(value('ASIL')).toBe('ASIL D');expect(value('Safety Goal')).toContain('limit brake torque');}
 else {expect(value('Software Criticality Index')).toBe('SwCI 1');expect(value('Software Control Category')).toContain('Autonomous');}
});

test.each(methods)('%s all-No runs make no model calls and publish excluded rows',async(method,generate)=>{
 const input=inputFor(method);const sheet=input.sheets['Functional Decomposition'];
 sheet.slice(1).forEach(row=>{row[sheet[0].indexOf('Guide Phrase Applicable')]='No';});
 const result=await generate({sheets:input.sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true});
 expect(fetchLLMResponse).not.toHaveBeenCalled();
 expect(result.Summary).toHaveLength(3);
 expect(importHazardSoftwareRequirements({hazardAnalysis:{hazardMethod:method,generatedSheets:result}})).toEqual([]);
});

test.each(methods)('%s draft schema contains genuine method fields and shared workflow fields',method=>{
 const {getCbaMethodDraftHeaders}=require('./haraFhaSharedWorkflow');
 const headers=getCbaMethodDraftHeaders(method,['Function (From)','Control Action','Function (To)']);
 expect(headers).toEqual(expect.arrayContaining(['Guide Phrase Applicable','Acceptance Criteria','Software Safety Requirement','Safety Classification']));
 expect(headers).toEqual(expect.arrayContaining(method==='HARA'?['ASIL','Safety Goal','Exposure','Controllability']:['Software Control Category','Software Criticality Index','LOR Tasks']));
 expect(new Set(headers).size).toBe(headers.length);
});

test.each(methods)('%s publishes every guide phrase independently for every context',async(method,generate)=>{
 const input=buildCodeArchitectureHazardInput({cbaRows:[source],method,projectId:'p',repoMeta:{repoId:'repo'},operationalContexts:contexts});
 fetchLLMResponse.mockImplementation(async prompt=>{
  const ids=[...new Set(prompt.match(/FD-\d+/g)||[])];
  return JSON.stringify(ids.map(id=>({...response[0],id})));
 });
 const result=await generate({sheets:input.sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true});
 const headers=result.Summary[0];
 expect(result.Summary).toHaveLength(15);
 for(const context of contexts) {
  const rows=result.Summary.slice(1).filter(row=>row[headers.indexOf('Operational Context ID')]===context.id);
  expect(rows.map(row=>row[headers.indexOf('Guide Phrase')])).toEqual(input.tableRows.filter(row=>row.operationalContextId===context.id).map(row=>row.guidePhrase));
  expect(rows).toHaveLength(7);
  expect(new Set(rows.map(row=>row[headers.indexOf('Guide Phrase')])).size).toBe(7);
 }
 expect(fetchLLMResponse.mock.calls.filter(([prompt])=>prompt.includes('You are performing a')).every(([prompt])=>prompt.includes('Never merge these rows'))).toBe(true);
});

test.each(methods)('%s retries unsupported classification and prevents safety requirement import',async(method,generate)=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(prompt.includes('You are reviewing generated') ? response.map(row=>({id:row.id,safetyClassification:'Safety — Direct'})) : response));
 const result=await generate({sheets:inputFor(method).sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true});
 const h=result.Summary[0];
 expect(result.Summary[1][h.indexOf('Safety Classification')]).toBe('Needs Review');
 expect(result.Summary[1][h.indexOf('Guide Phrase Applicable')]).toBe('Yes');
 expect(fetchLLMResponse.mock.calls.filter(([p])=>p.includes('You are reviewing generated'))).toHaveLength(2);
 expect(importHazardSoftwareRequirements({hazardAnalysis:{hazardMethod:method,generatedSheets:result}})).toEqual([]);
});
test('FHA persists separate rating rationales and computed SwCI derivation',async()=>{
 fetchLLMResponse.mockResolvedValue(JSON.stringify(response));
 const result=await generateFhaAnalysisSheets({sheets:inputFor('FHA').sheets,setFolders:jest.fn(),codeArchitectureWorkflow:true});
 for(const sheet of [result.Summary,result.FHA]) {
  expect(sheet[1][sheet[0].indexOf('Severity Rationale')]).toBe(response[0].severityRationale);
  expect(sheet[1][sheet[0].indexOf('Software Control Category Rationale')]).toBe(response[0].softwareControlCategoryRationale);
  expect(sheet[1][sheet[0].indexOf('SWCI Rationale / Derivation')]).toContain('map to SwCI 1');
 }
});
