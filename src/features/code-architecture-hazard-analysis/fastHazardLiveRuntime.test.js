// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {reviewFastHazards} from './fastHazardSemanticReview';
import {createGenerationBudget} from './fastHazardBudgets';
import {storeAIProviderModelPreference} from '../../lib/aiProviderConfig';
import {answer} from './fastHazardTestFixtures';
const input=p=>JSON.parse(p.split('\nRows: ')[1]);
const reviewed=p=>JSON.parse(p.split('\nAssessments: ')[1]);
const approve=p=>reviewed(p).map(({source})=>({id:source.id,issues:[]}));
const sources=n=>Array.from({length:n},(_,i)=>({id:String(i),action:'Apply torque',phrase:'Too late'}));
const checkpoint=()=>{const saved=new Map();return {saved,read:async k=>saved.get(JSON.stringify(k)),write:jest.fn(async(k,v)=>saved.set(JSON.stringify(k),v))};};
const flush=async()=>{for(let i=0;i<150;i++)await Promise.resolve();};
beforeEach(()=>{localStorage.clear();jest.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>jest.restoreAllMocks());

test.each(['STPA','HARA','FHA'])('%s keeps large shared context intact and budgets realistic full answers in batches',async method=>{
 localStorage.setItem('xhandle.aiProvider.active','anthropic');
 storeAIProviderModelPreference('anthropic','claude-haiku-5-5');
 const context={analysisContext:'Context evidence '.repeat(1800),organizationProfile:'Customer profile'};
 const diagnostics=[];
 const request=jest.fn(async (p,options)=>{
  expect(p).toContain(context.analysisContext);expect(p).toContain('Customer profile');
  const response=input(p).map(({id})=>({...answer(method,id),assumptions:'Explicit assumption and verification. '.repeat(85)}));
  // Includes substantial headroom for reasoning, not just visible JSON.
  expect(JSON.stringify(response).length/3+4000).toBeLessThanOrEqual(options.maxTokens);
  return response;
 });
 const result=await generateFastHazards({method,sources:sources(32),context,request,reviewRequest:async p=>approve(p),onDiagnostic:e=>diagnostics.push(e)});
 expect(result).toHaveLength(32);
 expect(request.mock.calls.length).toBeLessThanOrEqual(6);
 expect(request.mock.calls.every(([p])=>input(p).length>1)).toBe(true);
 expect(diagnostics.filter(e=>e.stage==='generation' && e.event==='started').every(e=>e.inputChars>32000 && e.inputChars<=e.inputLimit)).toBe(true);
 expect(JSON.stringify(diagnostics)).not.toContain(context.analysisContext);
});

test('larger measured answers reduce capacity and later short answers cannot undo it',()=>{
 const budget=createGenerationBudget();
 budget.observe([{applicable:'Yes',text:'x'.repeat(11000)}]);const rows=budget.rows;
 expect(rows).toBeLessThan(5);
 budget.observe([{applicable:'No',text:'excluded'},{applicable:'Yes',text:'short'}]);
 expect(budget.rows).toBe(rows);
});

test.each(['STPA','HARA','FHA'])('%s unavailable reviews never regenerate candidates, and Continue reviews saved candidates',async method=>{
 const cache=checkpoint(),request=jest.fn(async p=>input(p).map(({id})=>answer(method,id)));
 const counts=new Map();
 const options={method,sources:sources(16),context:{},checkpoint:cache,request,onDiagnostic:()=>{}};
 await expect(generateFastHazards({...options,reviewRequest:async p=>{reviewed(p).forEach(({source})=>counts.set(source.id,(counts.get(source.id)||0)+1));return 'bad JSON';}})).rejects.toMatchObject({code:'COMPACT_HAZARD_INCOMPLETE',partialResults:[]});
 const generated=request.mock.calls.flatMap(([p])=>input(p).map(r=>r.id));
 expect(generated).toHaveLength(16);expect(new Set(generated).size).toBe(16);
 expect([...counts.values()].every(n=>n===3)).toBe(true);
 expect([...cache.saved.values()].every(v=>v.kind==='pending-narrative-review')).toBe(true);
 request.mockClear();
 const result=await generateFastHazards({...options,reviewRequest:async p=>approve(p)});
 expect(result).toHaveLength(16);expect(request).not.toHaveBeenCalled();
 expect([...cache.saved.values()].every(v=>!v.kind && v.applicable==='Yes')).toBe(true);
});

test('review truncation retries verdicts with more output room, never regenerates the assessment',async()=>{
 const request=jest.fn(async p=>input(p).map(({id})=>answer('STPA',id)));
 const reviewRequest=jest.fn(async(p,options)=>{
  if(reviewRequest.mock.calls.length===1){expect(options.maxTokens).toBe(8000);throw Object.assign(new Error('length'),{name:'TruncatedResponseError'});}
  expect(options.maxTokens).toBe(16000);return approve(p);
 });
 expect(await generateFastHazards({method:'STPA',sources:sources(1),context:{},request,reviewRequest})).toHaveLength(1);
 expect(request).toHaveBeenCalledTimes(1);expect(reviewRequest).toHaveBeenCalledTimes(2);
});

test('missing verdict retains and checkpoints approvals while the targeted retry is still pending',async()=>{
 const cache=checkpoint(),progress=jest.fn();let release,second=false;
 const gate=new Promise(resolve=>{release=resolve;});
 const run=generateFastHazards({method:'STPA',sources:sources(2),context:{},checkpoint:cache,onProgress:progress,
  request:async p=>input(p).map(({id})=>answer('STPA',id)),
  reviewRequest:async p=>{if(!second){second=true;return [{id:'0',issues:[]}];}await gate;expect(reviewed(p).map(r=>r.source.id)).toEqual(['1']);return approve(p);}});
 await flush();
 expect(progress.mock.calls.at(-1)[0].completed).toBe(1);
 expect([...cache.saved.values()].some(v=>v.id==='0' && !v.kind)).toBe(true);
 expect([...cache.saved.values()].some(v=>v.kind==='pending-narrative-review' && v.assessment.id==='1')).toBe(true);
 release();expect(await run).toHaveLength(2);
});

test('cancelled review keeps candidates resumable but never publishes them as approved',async()=>{
 const cache=checkpoint(),controller=new AbortController(),request=jest.fn(async p=>input(p).map(({id})=>answer('STPA',id)));
 const options={method:'STPA',sources:sources(2),context:{},checkpoint:cache,request};
 await expect(generateFastHazards({...options,signal:controller.signal,reviewRequest:async()=>{controller.abort();throw new DOMException('cancelled','AbortError');}})).rejects.toMatchObject({name:'AbortError',partialResults:[]});
 expect([...cache.saved.values()].every(v=>v.kind==='pending-narrative-review')).toBe(true);
 request.mockClear();expect(await generateFastHazards({...options,reviewRequest:async p=>approve(p)})).toHaveLength(2);expect(request).not.toHaveBeenCalled();
});

test('sixteen malformed review verdicts have a global three-attempt bound per row',async()=>{
 const counts=new Map(),request=jest.fn(async p=>{reviewed(p).forEach(({source})=>counts.set(source.id,(counts.get(source.id)||0)+1));return '{}';});
 const result=await reviewFastHazards({method:'STPA',entries:sources(16).map(source=>({source,assessment:answer('STPA',source.id)})),context:{},request});
 expect(request).toHaveBeenCalledTimes(7);expect([...counts.values()]).toEqual(Array(16).fill(3));
 expect(Object.values(result).every(v=>v.unavailable===true)).toBe(true);
});
