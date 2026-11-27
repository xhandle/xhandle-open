import {generateFastHazards} from './resultsFirstHazardPipeline';
import {syntheticStpaCases} from './stpaSyntheticFixtures';
import {STPA_COMPLETION_POLICY,stpaMinimumAssessmentIssues,prepareStpaDraft} from './stpaCompletionPolicy';
jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:()=>{throw Error('Live provider calls are forbidden');}}));
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
const rows=prompt=>JSON.parse(prompt.split('\nRows: ')[1]);
const memory=()=>{const data=new Map();return {read:async key=>data.get(JSON.stringify(key)),write:async(key,value)=>data.set(JSON.stringify(key),value)};};
function fixture(){
 const cases=syntheticStpaCases().slice(0,2),sources=cases.map(item=>item.source),checkpoint=memory();
 const applicabilityRequest=jest.fn(async prompt=>rows(prompt).map(({id})=>id===sources[1].id
  ?{id,needsEvidence:true,rationale:'The receiver contract is not supplied.'}
  :{id,applicable:'Yes',rationale:'The command governs the modeled process.'}));
 const request=jest.fn(async prompt=>rows(prompt).map(({id})=>({...cases.find(item=>item.source.id===id).assessment})));
 return {cases,sources,checkpoint,request,applicabilityRequest,options:{method:'STPA',completionPolicy:'practical',sources,context:{},checkpoint,request,applicabilityRequest,...quiet}};
}
test('missing substantiation completes ordinary assessment rows and accepted work is not regenerated',async()=>{
 const f=fixture(),result=await generateFastHazards(f.options);
 expect(result).toHaveLength(2);expect(result[1]).toMatchObject({id:f.sources[1].id,completionPolicy:STPA_COMPLETION_POLICY});
 expect(result[1].uca).toBe(f.cases[1].assessment.uca);expect(result[1].assumptions).toBe(f.cases[1].assessment.assumptions);
 expect(result[1].assessmentResolution).toBeUndefined();expect(result[1].assessmentQualification).toBeUndefined();
 expect(f.request).toHaveBeenCalledTimes(2);
 f.request.mockClear();f.applicabilityRequest.mockClear();
 expect(await generateFastHazards(f.options)).toMatchObject(result);
 expect(f.request).not.toHaveBeenCalled();expect(f.applicabilityRequest).not.toHaveBeenCalled();
});
test('the practical bar accepts substantive drafts without imposing linguistic or substantiation checks',()=>{
 const {source,assessment}=syntheticStpaCases()[0];
 const candidate={...assessment,softwareRequirement:'The software shall return a zero-filled buffer.',assumptions:'The receiving contract is to be confirmed during integration.'};
 expect(stpaMinimumAssessmentIssues(candidate,source)).toEqual([]);
 expect(stpaMinimumAssessmentIssues({...candidate,loss:''},source)).toContain('Provide loss');
 const draft=prepareStpaDraft({...candidate,causalBasis:'Source-supported',evidenceQuote:'An invented excerpt that does not appear in the source.'},source);
 expect(draft.causalBasis).toBe('Hypothesis');expect(draft.evidenceQuote).toBe('');expect(draft.uca).toBe(candidate.uca);
});
test('analyst significance is preserved and actual supplied source quotations retain their provenance',()=>{
 const {source,assessment}=syntheticStpaCases()[0],quote='return command is not None';
 const draft=prepareStpaDraft({...assessment,classification:'Mission/Reliability',causalBasis:'Source-supported',evidenceQuote:quote},
  {...source,reviewedValues:{'Safety Significant':'Yes'}},{sharedSourceCorpus:[{filePath:'alpha.py',content:quote}]});
 expect(draft.classification).toBe('Safety — Related');expect(draft.causalBasis).toBe('Source-supported');expect(draft.evidenceQuote).toBe(quote);
});
test('unusable model output receives bounded repairs and an action-specific ordinary draft',async()=>{
 const f=fixture(),valid=f.request.getMockImplementation();
 f.request.mockImplementation(async prompt=>(await valid(prompt)).map(row=>row.id===f.sources[1].id?{...row,assessedAction:'An unrelated task'}:row));
 const result=await generateFastHazards(f.options);
 expect(f.request.mock.calls.filter(([prompt])=>rows(prompt).some(row=>row.id===f.sources[1].id))).toHaveLength(2);
 expect(result[1]).toMatchObject({assessedAction:f.sources[1].action,fallbackAssessment:{kind:'best-effort-draft'}});
 expect(result[1].uca).toContain(f.sources[1].action);expect(stpaMinimumAssessmentIssues(result[1],f.sources[1])).toEqual([]);
 expect(result[1].loss).not.toMatch(/fatal|injury/i);expect(result[1].evidenceQuote).toBe('');
});
test('missing evidence does not force additional caveat text or a new assumptions declaration',async()=>{
 const f=fixture(),valid=f.request.getMockImplementation();
 f.request.mockImplementation(async prompt=>(await valid(prompt)).map(row=>({...row,assumptions:'No additional assumptions.'})));
 const result=await generateFastHazards(f.options);expect(result[1].assumptions).toBe('No additional assumptions.');
});
test('cancellation remains an operational interruption and cannot accept a late row',async()=>{
 const f=fixture(),valid=f.request.getMockImplementation(),controller=new AbortController();
 f.request.mockImplementation(async prompt=>{const value=await valid(prompt);if(rows(prompt).some(row=>row.id===f.sources[1].id))controller.abort();return value;});
 await expect(generateFastHazards({...f.options,signal:controller.signal})).rejects.toMatchObject({name:'AbortError',partialResults:[expect.objectContaining({id:f.sources[0].id})]});
});
test('malformed responses do not cause assessment-level failure or unbounded refinement',async()=>{
 const f=fixture(),source={...f.sources[0],reviewedApplicability:'Yes',reviewedRationale:'Analyst retained this action.'};
 f.request.mockResolvedValue('invalid JSON');
 const result=await generateFastHazards({...f.options,sources:[source]});
 expect(f.request).toHaveBeenCalledTimes(4);expect(result).toHaveLength(1);
 expect(result[0]).toMatchObject({applicable:'Yes',applicabilityRationale:source.reviewedRationale});
 expect(stpaMinimumAssessmentIssues(result[0],source)).toEqual([]);
});
test('provider account failures remain operational errors rather than fabricated successful requests',async()=>{
 const f=fixture();f.request.mockRejectedValue(Object.assign(Error('Provider rejected the request'),{status:401}));
 await expect(generateFastHazards({...f.options,sources:[{...f.sources[0],reviewedApplicability:'Yes'}]})).rejects.toMatchObject({partialResults:[]});
 expect(f.request).toHaveBeenCalledTimes(1);
});
test('accepted drafts require no mandatory semantic review and are reused with their source reading aid',async()=>{
 const f=fixture(),valid=f.request.getMockImplementation();
 const context={sharedSourceCorpus:[{filePath:'alpha.py',content:'def ready(command):\n    return command is not None\n'},{filePath:'beta.py',content:'def consume(value):\n    return value\n'}]};
 f.request.mockImplementation(async(prompt,options)=>{
  if(options.workflow==='hazard-evidence-extraction')return [{filePath:'alpha.py',fact:'The helper checks whether a command is present.',quote:'return command is not None'}];
  if(options.workflow==='hazard-semantic-review')throw Error('No mandatory review may reroll an accepted draft');
  return valid(prompt);
 });
 const options={...f.options,sources:[f.sources[0]],context};
 const result=await generateFastHazards(options);expect(result[0].uca).toBe(f.cases[0].assessment.uca);
 expect(f.request).toHaveBeenCalledTimes(2);f.request.mockClear();
 expect(await generateFastHazards(options)).toMatchObject(result);expect(f.request).not.toHaveBeenCalled();
});
