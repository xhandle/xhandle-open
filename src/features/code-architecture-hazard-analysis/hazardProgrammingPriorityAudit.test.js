import {preferredHazardFailure,canCompleteHazardWithAssumptions} from './hazardDeferredFailures';
import {generateFastHazards} from './resultsFirstHazardPipeline';

const permutations=values=>values.length?values.flatMap((v,i)=>permutations(values.filter((_,j)=>j!==i)).map(rest=>[v,...rest])):[[]];

test('all concurrent error permutations select the highest-priority original error',()=>{
 const errors=[new Error('Budget'),Object.assign(new Error('Denied'),{status:403}),new ReferenceError('Missing dependency'),Object.assign(new Error('Missing saved evidence'),{code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'}),new DOMException('Stopped','AbortError')].map(Object.freeze);
 for(let count=2;count<=errors.length;count++){
  for(const order of permutations(errors.slice(0,count))){
   const selected=order.reduce(preferredHazardFailure,undefined);
   expect(selected).toBe(errors[count-1]);
   if(count>=3)expect(canCompleteHazardWithAssumptions(selected)).toBe(false);
  }
 }
});

const quiet={onMetrics:()=>{},onDiagnostic:()=>{}};
const checkpoint=()=>({readMany:async bases=>bases.map(()=>undefined),writeMany:async()=>{}});
const source=(id,reviewed='Yes')=>({id,action:'Apply torque',phrase:'Too late',reviewedApplicability:reviewed,reviewedRationale:'Reviewed'});

test.each(['STPA','HARA','FHA'].flatMap(method=>[401,402,403,404,429].map(status=>({method,status}))))('$method ordinary provider $status still completes explicitly marked assumptions',async({method,status})=>{
 const request=jest.fn(async()=>{throw Object.assign(new Error('Provider unavailable'),{response:{status}});});
 const rows=await generateFastHazards({method,sources:[source('accepted','No'),source('pending')],context:{},checkpoint:checkpoint(),request,...quiet});
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({id:'accepted',applicable:'No'});
 expect(rows[1].assessmentBasis).toContain('Assumption-based');
 expect(request).toHaveBeenCalledTimes(1);
});

test.each(['screening','generation'])('%s cancellation wins after a concurrent provider failure and preserves accepted work',async stage=>{
 const controller=new AbortController(),pending=[],events=[];
 const request=()=>new Promise((resolve,reject)=>pending.push(reject));
 const sources=Array.from({length:stage==='screening'?49:9},(_,i)=>stage==='screening'?{id:`HA-${i}`,action:'Apply torque',phrase:'Too late'}:source(`HA-${i}`));
 sources.unshift(source('accepted','No'));
 const outcome=generateFastHazards({method:'STPA',sources,context:{},checkpoint:checkpoint(),request,applicabilityRequest:request,signal:controller.signal,...quiet,onDiagnostic:event=>events.push(event)}).catch(error=>error);
 for(let i=0;i<100 && pending.length<2;i++)await new Promise(resolve=>setTimeout(resolve,0));
 expect(pending).toHaveLength(2);
 pending[0](Object.assign(new Error('Denied'),{status:403}));
 await new Promise(resolve=>setTimeout(resolve,0));
 controller.abort();
 pending[1](new ReferenceError('Missing dependency'));
 const error=await outcome;
 expect(error.name).toBe('AbortError');
 expect(error.partialResults.map(row=>row.id)).toEqual(['accepted']);
 expect(events.some(event=>event.event==='assumption-based-completion')).toBe(false);
});
