// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
import {reviewFastHazards,createReviewBatchPolicy,semanticReviewPrompt} from './fastHazardSemanticReview';
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';
const entries=n=>Array.from({length:n},(_,i)=>({source:{id:String(i),context:{mode:'Batch'}},assessment:{id:String(i),executionDependency:'None'}}));
const rows=p=>JSON.parse(p.split('\nAssessments: ')[1]);
const approve=p=>rows(p).map(({source})=>({id:source.id,issues:[]}));

test('starts with 24 rows and uses the enlarged input window',async()=>{
 const data=entries(24).map(e=>({...e,assessment:{...e.assessment,causalScenario:'x'.repeat(1600)}}));
 const request=jest.fn(async p=>approve(p));
 await reviewFastHazards({method:'STPA',entries:data,context:{},request});
 expect(request).toHaveBeenCalledTimes(1);
 expect(request.mock.calls[0][0].length).toBeGreaterThan(30000);
 expect(request.mock.calls[0][0].length).toBeLessThanOrEqual(60000);
});

test('truncation reduces subsequent requests, then successful full batches grow cautiously',async()=>{
 const policy=createReviewBatchPolicy(),sizes=[];
 const request=jest.fn(async p=>{
  const size=rows(p).length;sizes.push(size);
  if(sizes.length===1){const e=new Error('output limit');e.name='TruncatedResponseError';throw e;}
  return approve(p);
 });
 const result=await reviewFastHazards({method:'STPA',entries:entries(100),context:{},batchPolicy:policy,request});
 expect(Object.keys(result)).toHaveLength(100);
 expect(sizes.slice(0,3)).toEqual([24,12,12]);
 expect(sizes.some((size,i)=>i>2 && size>12)).toBe(true);
 expect(Math.max(...sizes)).toBeLessThanOrEqual(24);
 expect(policy.chars).toBeLessThanOrEqual(60000);
});

test('missing verdict retries only missing identities and keeps valid findings',async()=>{
 const request=jest.fn(async p=>request.mock.calls.length===1?[{id:'0',issues:['Action drift']}]:approve(p));
 const result=await reviewFastHazards({method:'HARA',entries:entries(4),context:{},request});
 expect(result['0']).toEqual(['Action drift']);
 expect(request.mock.calls.slice(1).flatMap(([p])=>rows(p).map(r=>r.source.id))).not.toContain('0');
 expect(Object.keys(result)).toHaveLength(4);
});

test('old in-flight success cannot immediately restore a concurrently reduced policy',async()=>{
 const policy=createReviewBatchPolicy();let release;
 const held=new Promise(resolve=>{release=resolve;});
 const first=reviewFastHazards({method:'FHA',entries:entries(24),context:{},batchPolicy:policy,request:async p=>{await held;return approve(p);}});
 await reviewFastHazards({method:'FHA',entries:entries(4),context:{},batchPolicy:policy,request:async()=> 'invalid JSON'});
 const snapshot={...policy};release();await first;expect(policy).toEqual(snapshot);
});

test('input budgeting keeps evidence intact including an oversized singleton',async()=>{
 const data=entries(2).map((e,i)=>({...e,source:{...e.source,evidence:{code:String(i)+'x'.repeat(61000)}}}));
 const request=jest.fn(async p=>approve(p));
 await reviewFastHazards({method:'STPA',entries:data,context:{},request});
 expect(request).toHaveBeenCalledTimes(2);
 request.mock.calls.forEach(([p],i)=>{expect(rows(p)).toHaveLength(1);expect(p).toContain(data[i].source.evidence.code);});
 expect(semanticReviewPrompt('STPA',data,{}).length).toBeGreaterThan(60000);
});

test('pipeline reports request counts and wall time per newly accepted row',async()=>{
 const onMetrics=jest.fn();
 await generateFastHazards({method:'STPA',sources:[{id:'a',action:'Apply torque'}],context:{},onMetrics,
  request:async()=>[answer('STPA','a')],reviewRequest:async p=>approve(p)});
 expect(onMetrics).toHaveBeenCalledTimes(1);
 const metrics=onMetrics.mock.calls[0][0];
 expect(metrics.generation.requests).toBe(1);expect(metrics.review.requests).toBe(1);
 expect(metrics.newlyAccepted).toBe(1);expect(metrics.msPerAcceptedRow).toBe(metrics.elapsedMs);
 expect(metrics.review.elapsedMs).toBeGreaterThanOrEqual(0);
});


test('a repeatedly failing singleton does not shrink unrelated review batches',async()=>{
 const policy=createReviewBatchPolicy(),progress=jest.fn();
 await reviewFastHazards({method:'STPA',entries:entries(1),context:{},batchPolicy:policy,onProgress:progress,request:async()=> 'invalid JSON'});
 expect(policy.rows).toBe(24);expect(policy.chars).toBe(60000);
 expect(progress.mock.calls.some(([m])=>m.includes('targeted retry'))).toBe(true);
 const request=jest.fn(async p=>approve(p));
 await reviewFastHazards({method:'STPA',entries:entries(24),context:{},batchPolicy:policy,request});
 expect(request).toHaveBeenCalledTimes(1);expect(rows(request.mock.calls[0][0])).toHaveLength(24);
});

test('progress explains a genuine oversized input singleton',async()=>{
 const progress=jest.fn();
 const data=entries(2).map(e=>({...e,source:{...e.source,evidence:{code:'x'.repeat(61000)}}}));
 await reviewFastHazards({method:'STPA',entries:data,context:{},onProgress:progress,request:async p=>approve(p)});
 expect(progress.mock.calls[0][0]).toContain('1 row · input-size limit');
});

test('semantic correction failures do not reduce later generation batches',async()=>{
 const attempts=new Map(),sizes=[];
 const request=async p=>{
  const input=JSON.parse(p.split('\nRows: ')[1]);
  sizes.push(input.map(r=>Number(r.id)));
  return input.map(({id})=>{attempts.set(id,(attempts.get(id)||0)+1);return {...answer('STPA',id),attempt:attempts.get(id)};});
 };
 const reviewRequest=async p=>rows(p).map(({source,assessment})=>({id:source.id,issues:Number(source.id)<32 && assessment.attempt===1?['Correct the causal reasoning']:[]}));
 const result=await generateFastHazards({method:'STPA',sources:Array.from({length:256},(_,i)=>({id:String(i),action:'Apply torque'})),context:{},request,reviewRequest});
 expect(result).toHaveLength(256);
 expect(sizes.filter(ids=>ids[0]>=192 && ids.at(-1)<255).every(ids=>ids.length>=8)).toBe(true);
});
