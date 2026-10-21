// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
import {compactReviewEntries,reviewFastHazards,semanticReviewPrompt,obviousNarrativeIssues} from './fastHazardSemanticReview';
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';
import fixtures from './__fixtures__/semanticContradictions.json';

const entries=prompt=>{
 const parse=label=>JSON.parse(prompt.split(`\n${label}: `)[1].split('\n')[0]);
 const contexts=parse('Contexts'),evidence=parse('Evidence'),interfaces=parse('Interfaces');
 return parse('Assessments').map(({source,assessment})=>{
   const {interfaceRef,...row}=source;
   const {contextRef,evidenceRef,...definition}=interfaces[interfaceRef];
   return {source:{...definition,...(contextRef!==undefined?{context:contexts[contextRef]}:{}),...(evidenceRef!==undefined?{evidence:evidence[evidenceRef]}:{}),...row},assessment};
 });
};
const approve=jest.fn(async prompt=>entries(prompt).map(({source})=>({id:source.id,issues:[]})));
beforeEach(()=>approve.mockImplementation(async prompt=>entries(prompt).map(({source})=>({id:source.id,issues:[]}))));

test.each(['STPA','HARA','FHA'])('%s review includes actual narrative, action and context rather than trusting None flags',async method=>{
 const request=jest.fn(async prompt=>entries(prompt).map(({source})=>({id:source.id,issues:source.id==='144'?[]:['Narrative contradicts the source action or operational context']})));
 const findings=await reviewFastHazards({method,entries:fixtures,context:{organizationProfile:'Profile A'},request});
 expect(findings['53']).toHaveLength(1);expect(findings['144']).toEqual([]);
 const prompt=semanticReviewPrompt(method,fixtures,{organizationProfile:'Profile A'});
 expect(prompt).toContain('Do NOT accept executionDependency=None');
 expect(prompt).toContain('runs concurrently with output creation');
 expect(prompt).toContain('no engineer interaction');
 expect(prompt).toContain('path-existence check');
 expect(prompt).toContain('proposed/assumed');
 expect(prompt).toContain('Profile A');
 expect(request.mock.calls.flatMap(([p])=>entries(p))).toEqual(fixtures.filter(entry=>!obviousNarrativeIssues(entry.assessment).length));
});

test('review batches have bounded row count and short output contract',async()=>{
 const batch=Array.from({length:25},(_,i)=>({source:{id:String(i)},assessment:answer('STPA',String(i))}));
 await reviewFastHazards({method:'STPA',entries:batch,context:{},request:approve});
 expect(approve.mock.calls.every(([p])=>entries(p).length<=24)).toBe(true);
 expect(approve.mock.calls.flatMap(([p])=>entries(p))).toHaveLength(25);
});

test('malformed and duplicate verdicts never become approval and retries are bounded',async()=>{
 const request=jest.fn(async()=>[{id:'53',issues:[]},{id:'53',issues:[]}]);
 const result=await reviewFastHazards({method:'STPA',entries:[fixtures[0],fixtures[2]],context:{},request});
 expect(request).toHaveBeenCalledTimes(5);
 expect(result['53'].reason).toContain('could not be validated');
 expect(result['106'].reason).toContain('could not be validated');
});

test('semantic failure corrects only failed rows; reviewed work is reused on Continue',async()=>{
 const values=new Map();const checkpoint={read:async k=>values.get(JSON.stringify(k)),write:async(k,v)=>values.set(JSON.stringify(k),v)};
 const request=jest.fn(async prompt=>JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id)));
 let first=true;
 const reviewRequest=jest.fn(async prompt=>{const verdicts=entries(prompt).map(({source})=>({id:source.id,issues:first && source.id==='a'?['UCA shifts from assessed command to a downstream action']:[]}));first=false;return verdicts;});
 const options={method:'STPA',sources:[{id:'a',action:'Apply torque'},{id:'b',action:'Apply torque'}],context:{},request,reviewRequest,checkpoint};
 const result=await generateFastHazards(options);
 expect(result).toHaveLength(2);expect(request).toHaveBeenCalledTimes(2);
 expect(JSON.parse(request.mock.calls[1][0].split('\nRows: ')[1]).map(r=>r.id)).toEqual(['a']);
 expect(request.mock.calls[1][0]).toContain('UCA shifts');
 expect(reviewRequest).toHaveBeenCalledTimes(2);
 await generateFastHazards(options);expect(request).toHaveBeenCalledTimes(2);expect(reviewRequest).toHaveBeenCalledTimes(2);
});

test('persistent semantic rejection preserves other results without publishing rejected content',async()=>{
 const write=jest.fn();
 const request=async prompt=>JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id));
 const reviewRequest=async prompt=>entries(prompt).map(({source})=>({id:source.id,issues:source.id==='a'?['Contradictory execution ordering']:[]}));
 let failure;
 try{await generateFastHazards({method:'STPA',sources:[{id:'a'},{id:'b'}],context:{},request,reviewRequest,checkpoint:{read:async()=>null,write}});}catch(e){failure=e;}
 expect(failure.partialResults.map(r=>r.id)).toEqual(['b']);
 expect(failure.findings.a).toContain('Contradictory execution ordering');
 expect(write.mock.calls.filter(([,r])=>!r.kind).map(([,r])=>r.id)).toEqual(['b']);
});

test('reviewed No is not sent to review; cancellation during review cannot checkpoint approvals',async()=>{
 const controller=new AbortController(),write=jest.fn();
 const request=async prompt=>JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id));
 const reviewRequest=jest.fn(async prompt=>{expect(entries(prompt).map(e=>e.source.id)).toEqual(['a']);controller.abort();return [{id:'a',issues:[]}];});
 await expect(generateFastHazards({method:'STPA',sources:[{id:'n',reviewedApplicability:'No'},{id:'a'}],context:{},request,reviewRequest,signal:controller.signal,checkpoint:{read:async()=>null,write}})).rejects.toHaveProperty('name','AbortError');
 expect(write.mock.calls.every(([,value])=>value.kind==='pending-narrative-review')).toBe(true);
});

test('provider failure is propagated rather than silently accepting',async()=>{
 await expect(reviewFastHazards({method:'STPA',entries:fixtures,context:{},request:async()=>{throw new Error('503');}})).rejects.toThrow('503');
});

// These assertions execute real checks on the customer's CSV, without mocked verdicts.
test('actual CSV concurrency and Boolean-boundary contradictions are rejected locally',()=>{
 expect(obviousNarrativeIssues(fixtures.find(e=>e.source.id==='60').assessment)[0]).toContain('concurrent');
 expect(obviousNarrativeIssues(fixtures.find(e=>e.source.id==='113').assessment)[0]).toContain('existence check');
 expect(obviousNarrativeIssues(fixtures.find(e=>e.source.id==='144').assessment)).toEqual([]);
 expect(obviousNarrativeIssues({...answer('STPA','a'),causalScenario:'The process does not run concurrently with later work.'})).toEqual([]);
});

test('packing serializes each candidate once rather than rescanning growing pools',()=>{
 const entries=Array.from({length:1000},(_,i)=>({source:{id:String(i),action:`Action ${i}`,context:{mode:'auto'},evidence:{text:`Evidence ${i}`}},assessment:{}}));
 const spy=jest.spyOn(JSON,'stringify');
 try{compactReviewEntries(entries);expect(spy).toHaveBeenCalledTimes(3000);}finally{spy.mockRestore();}
});
