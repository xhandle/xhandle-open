// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {compactReviewEntries,semanticReviewPrompt} from './fastHazardSemanticReview';
import {answer} from './fastHazardTestFixtures';
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('review references preserve distinct context/evidence and row-specific decisions losslessly',()=>{
 const entries=Array.from({length:12},(_,i)=>({source:{id:String(i),action:'Apply torque',phrase:String(i),reviewedApplicability:i===0?'Yes':'',context:{mode:i===11?'Parked':'Driving'},evidence:{code:'e'.repeat(3000)}},assessment:answer('STPA',String(i))}));
 const packed=compactReviewEntries(entries);
 expect(packed.contexts).toHaveLength(2);expect(packed.evidence).toHaveLength(1);expect(packed.interfaces).toHaveLength(2);
 const restored=packed.assessments.map(({source,assessment})=>{
  const {interfaceRef,...row}=source;const {contextRef,evidenceRef,...def}=packed.interfaces[interfaceRef];
  return {source:{...def,...row,context:packed.contexts[contextRef],evidence:packed.evidence[evidenceRef]},assessment};
 });
 expect(JSON.parse(JSON.stringify(restored))).toEqual(entries);
 const compact=semanticReviewPrompt('STPA',entries,{});
 const raw=compact.slice(0,compact.indexOf('\nContexts:'))+'\nAssessments: '+JSON.stringify(entries);
 expect(compact.length).toBeLessThan(raw.length*0.65);
});

test.each(['STPA','HARA','FHA'])('%s starts later generation while earlier review waits, bounded by shared concurrency',async method=>{
 const gate=deferred();let active=0,max=0,generated=0,reviewed=0,activeReviews=0,generatedDuringReview=false;
 const enter=()=>{active++;max=Math.max(max,active);};
 const request=jest.fn(async p=>{enter();generated++;if(activeReviews)generatedDuringReview=true;const delay=generated===1?1:20;for(let i=0;i<delay;i++)await Promise.resolve();active--;return JSON.parse(p.split('\nRows: ')[1]).map(({id})=>answer(method,id));});
 const reviewRequest=jest.fn(async p=>{enter();reviewed++;activeReviews++;await gate.promise;activeReviews--;active--;return JSON.parse(p.split('\nAssessments: ')[1]).map(({source})=>({id:source.id,issues:[]}));});
 const checkpoint={read:async()=>null,write:jest.fn()},progress=jest.fn();
 const pending=generateFastHazards({method,sources:Array.from({length:224},(_,i)=>({id:String(i),action:'Apply torque'})),context:{},request,reviewRequest,checkpoint,onProgress:progress});
 await flush();
 expect(reviewed).toBeGreaterThan(0);expect(generated).toBeGreaterThan(3);
 expect(generatedDuringReview).toBe(true);
 expect(generated).toBeLessThanOrEqual(12); // bounded pending assessments
 expect(checkpoint.write.mock.calls.every(([,v])=>v.kind==='pending-narrative-review')).toBe(true);
 expect(progress.mock.calls.at(-1)[0].completed).toBe(0);
 expect(max).toBeLessThanOrEqual(8);
 gate.resolve();expect(await pending).toHaveLength(224);expect(max).toBeLessThanOrEqual(8);
});
