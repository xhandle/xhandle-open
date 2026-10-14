jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn()}));
jest.mock('./codeHazardGenerationCheckpoint',()=>({createCodeHazardCheckpoint:async()=>undefined}));
jest.mock('./codeArchitectureHazardStore',()=>({saveCodeArchitectureHazardRun:async()=>undefined}));
jest.mock('./fastHazardSemanticReview',()=>({...jest.requireActual('./fastHazardSemanticReview'),createReviewBatchPolicy:()=>({}),reviewFastHazards:async({entries,request})=>{await request('review');return Object.fromEntries(entries.map(({source})=>[source.id,[]]));}}));
import {screenFastApplicability,applicabilityPrompt} from './fastHazardApplicability';
import {generateFastHazards} from './fastHazardPipeline';
import {fetchLLMResponse} from '../../components/aiAnalysisSTPA';
import {runFastCodeArchitectureHazardAnalysis,fastHazardSheets} from './fastHazardRunner';
import {answer} from './fastHazardTestFixtures';
const sources=n=>Array.from({length:n},(_,i)=>({id:`HA-${i+1}`,action:'Apply torque',phrase:'Too late',context:{mode:'Driving'}}));
const rows=p=>JSON.parse(p.split('\nRows: ')[1]);
const cache=()=>{const values=new Map();return {read:async k=>values.get(JSON.stringify(k)),write:async(k,v)=>values.set(JSON.stringify(k),v)};};

test.each(['STPA','HARA','FHA'])('%s screens first and excludes No from generation and review',async method=>{
 const events=[],checkpoint=cache(),input=sources(3);
 input[2].reviewedApplicability='Yes';input[2].reviewedRationale='Human accepted';
 const screen=jest.fn(async p=>{events.push('screen');return rows(p).map(({id})=>({id,applicable:id==='HA-1'?'No':'Yes',rationale:'Action-specific decision'}));});
 const request=jest.fn(async p=>{events.push('generate');return rows(p).map(({id})=>answer(method,id));});
 const reviewRequest=jest.fn(async()=>{events.push('review');return [];});
 const options={method,sources:input,context:{organizationProfile:'Profile A'},checkpoint,applicabilityRequest:screen,request,reviewRequest};
 const result=await generateFastHazards(options);
 expect(result.map(r=>r.applicable)).toEqual(['No','Yes','Yes']);
 expect(events[0]).toBe('screen');
 expect(rows(screen.mock.calls[0][0]).map(r=>r.id)).toEqual(['HA-1','HA-2']);
 expect(request.mock.calls.flatMap(([p])=>rows(p).map(r=>r.id))).toEqual(['HA-2','HA-3']);
 expect(result[2].applicabilityRationale).toBe('Human accepted');
 screen.mockClear();request.mockClear();reviewRequest.mockClear();
 await generateFastHazards(options);
 expect(screen).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();expect(reviewRequest).not.toHaveBeenCalled();
});
test('147 rows use four compact screen batches and all-No makes zero detailed requests',async()=>{
 const screen=jest.fn(async p=>rows(p).map(({id})=>({id,applicable:'No',rationale:'This phrase does not describe the action.'})));
 const request=jest.fn(),reviewRequest=jest.fn();
 const result=await generateFastHazards({method:'STPA',sources:sources(147),context:{},applicabilityRequest:screen,request,reviewRequest});
 expect(result).toHaveLength(147);expect(screen).toHaveBeenCalledTimes(4);
 expect(request).not.toHaveBeenCalled();expect(reviewRequest).not.toHaveBeenCalled();
});
test('missing decisions retry only missing IDs; profile changes invalidate cached decisions',async()=>{
 const checkpoint=cache(),request=jest.fn(async p=>rows(p).slice(request.mock.calls.length===1?1:0).map(({id})=>({id,applicable:'Yes',rationale:'Meaningful timing deviation'})));
 const options={method:'STPA',sources:sources(4),context:{profile:'A'},checkpoint,request};
 expect((await screenFastApplicability(options)).size).toBe(4);
 expect(rows(request.mock.calls[1][0]).map(r=>r.id)).toEqual(['HA-1']);
 request.mockClear();await screenFastApplicability(options);expect(request).not.toHaveBeenCalled();
 await screenFastApplicability({...options,context:{profile:'B'}});expect(request).toHaveBeenCalled();
});
test('truncated screening is bounded and never silently excludes',async()=>{
 const request=jest.fn(async()=>{const e=new Error('length');e.name='TruncatedResponseError';throw e;});
 await expect(screenFastApplicability({method:'FHA',sources:sources(1),context:{},request})).rejects.toThrow('could not validate');
 expect(request).toHaveBeenCalledTimes(3);
});
test('a generated No cannot overwrite screened Yes',async()=>{
 const request=jest.fn(async()=>[{...answer('STPA','HA-1'),applicable:'No'}]);
 await expect(generateFastHazards({method:'STPA',sources:sources(1),context:{},applicabilityRequest:async()=>[{id:'HA-1',applicable:'Yes',rationale:'Meaningful command timing'}],request})).rejects.toHaveProperty('code','COMPACT_HAZARD_INCOMPLETE');
 expect(request).toHaveBeenCalledTimes(3);
});
test('governed No requires no screening and retains rationale',async()=>{
 const request=jest.fn();const source={...sources(1)[0],reviewedApplicability:'No',reviewedRationale:'Human excluded'};
 const result=await generateFastHazards({method:'STPA',sources:[source],context:{},applicabilityRequest:request});
 expect(result[0].applicabilityRationale).toBe('Human excluded');expect(request).not.toHaveBeenCalled();
});
test('prompt includes organization context and method-specific criteria',()=>{
 const prompt=applicabilityPrompt('HARA',sources(2),{organizationProfile:'Customer profile'});
 expect(prompt).toContain('Customer profile');expect(prompt).toContain('do not impose the STPA command-only gate');
});
test.each(['STPA','HARA','FHA'])('%s excluded rows retain identity and mark assessment cells not applicable',method=>{
 const input={tableRows:[{fromFunction:'Planner',controlAction:'Apply torque',toFunction:'Actuator',guidePhrase:'Too late',operationalScenario:'Driving'}],sheets:{'Functional Decomposition':[]}};
 const sheet=fastHazardSheets(method,input,[{id:'HA-1',applicable:'No',applicabilityRationale:'User exclusion',classification:'Not applicable',classificationRationale:'Excluded',assumptions:'None'}]).Summary;
 const row=Object.fromEntries(sheet[0].map((h,i)=>[h,sheet[1][i]]));
 expect(row['Control Action']).toBe('Apply torque');expect(row['Guide Phrase Applicable']).toBe('No');
 for(const name of ['Verification','Software Safety Requirement','Safety Classification','Assumptions','Execution Evidence Quote'])expect(row[name]).toMatch(/^Not applicable/);
 for(const name of method==='STPA'?['Unsafe Control Action','Loss','Hazard']:method==='HARA'?['Severity','Exposure','Controllability','ASIL','Safety Goal']:['Mishap','Severity Category','Software Control Category','Software Criticality Index'])expect(row[name]).toMatch(/^Not applicable/);
});
test('screen failure retains decisions and resumes only missing work',async()=>{
 const checkpoint=cache(),request=jest.fn(async p=>{
   if(request.mock.calls.length>1)throw new Error('Provider unavailable');
   return [{id:'HA-1',applicable:'No',rationale:'Not a meaningful deviation'}];
 });
 const options={method:'STPA',sources:sources(2),context:{},checkpoint,applicabilityRequest:request};
 await expect(generateFastHazards(options)).rejects.toMatchObject({partialResults:[{id:'HA-1',applicable:'No'}]});
 request.mockClear();request.mockImplementation(async p=>rows(p).map(({id})=>({id,applicable:'No',rationale:'No meaningful deviation'})));
 expect(await generateFastHazards(options)).toHaveLength(2);
 expect(rows(request.mock.calls[0][0]).map(r=>r.id)).toEqual(['HA-2']);
});
test.each(['STPA-Textbook','HARA','FHA'])('%s runner wires the applicability workflow and persists excluded rows',async method=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(rows(prompt).map(({id})=>({id,applicable:'No',rationale:'Not meaningful for this action in this context.'}))));
 const run=await runFastCodeArchitectureHazardAnalysis({method,projectId:'project',repoMeta:{repoId:'repo'},organizationContext:'Customer profile',cbaRows:[{from:'Planner',action:'Apply torque',to:'Actuator',traceId:'functional-1',rowRef:1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}]});
 expect(run.runState).toBe('complete');
 expect(fetchLLMResponse.mock.calls.length).toBeGreaterThan(0);
 expect(fetchLLMResponse.mock.calls.every(call=>call[4].workflow==='hazard-applicability-screen')).toBe(true);
 const sheet=run.generatedSheets.Summary;
 expect(sheet.length).toBeGreaterThan(1);
 expect(sheet.slice(1).every(row=>row[sheet[0].indexOf('Guide Phrase Applicable')]==='No')).toBe(true);
});
