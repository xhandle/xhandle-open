// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';
const input=p=>JSON.parse(p.split('\nRows: ')[1]);
const assessments=p=>JSON.parse(p.split('\nAssessments: ')[1]);
const sources=n=>Array.from({length:n},(_,i)=>({id:String(i),action:'Apply torque'}));
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};

test.each(['STPA','HARA','FHA'])('%s corrects valid but rejected assessments as a batch with original content',async method=>{
 const attempts=new Map();
 const request=jest.fn(async p=>input(p).map(row=>{
  attempts.set(row.id,(attempts.get(row.id)||0)+1);
  if(attempts.get(row.id)>1){
   expect(row.corrections.issues).toEqual(['Fix contradictory premise']);
   expect(row.corrections.previousAssessment.id).toBe(row.id);
  }
  return {...answer(method,row.id),attempt:attempts.get(row.id)};
 }));
 const reviewRequest=async p=>assessments(p).map(({source,assessment})=>({id:source.id,issues:assessment.attempt===1?['Fix contradictory premise']:[]}));
 const result=await generateFastHazards({method,sources:sources(8),context:{},request,reviewRequest});
 expect(result).toHaveLength(8);
 expect(request.mock.calls.every(([p])=>input(p).length>1)).toBe(true);
 expect([...attempts.values()]).toEqual(Array(8).fill(2));
});

test('persistent reasoning failures stop after three attempts per row and retain approved rows',async()=>{
 const attempts=new Map();
 const request=async p=>input(p).map(({id})=>{attempts.set(id,(attempts.get(id)||0)+1);return answer('STPA',id);});
 const reviewRequest=async p=>assessments(p).map(({source})=>({id:source.id,issues:source.id==='0'?[]:['Contradiction remains']}));
 let failure;
 try{await generateFastHazards({method:'STPA',sources:sources(8),context:{},request,reviewRequest});}catch(e){failure=e;}
 expect(failure.partialResults.map(r=>r.id)).toEqual(['0']);
 expect(attempts.get('0')).toBe(1);
 expect([...attempts].filter(([id])=>id!=='0').every(([,count])=>count===3)).toBe(true);
 expect(Object.keys(failure.findings)).toHaveLength(7);
});

test.each(['STPA','HARA','FHA'].flatMap(method=>[[method,false],[method,true]]))('%s simulated queue lifecycle for 147 rows (corrections=%s) completes all independent reviews',async (method,corrections)=>{
 jest.useFakeTimers();
 try{
  const reviewed=new Set(),attempts=new Map();let completed=false,failure;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const request=async p=>{await wait(40000);return input(p).map(({id})=>{attempts.set(id,(attempts.get(id)||0)+1);return {...answer(method,id),attempt:attempts.get(id)};});};
  const reviewRequest=async p=>{await wait(15000);return assessments(p).map(({source,assessment})=>{const issues=corrections && Number(source.id)%8===0 && assessment.attempt===1?['Fix contradictory premise']:[];if(!issues.length)reviewed.add(source.id);return {id:source.id,issues};});};
  const pending=generateFastHazards({method,sources:sources(147),context:{},request,reviewRequest}).then(r=>{completed=true;return r;},e=>{failure=e;});
  for(let second=0;second<1000 && !completed && !failure;second++){await flush();jest.advanceTimersByTime(1000);}
  await flush();expect(failure).toBeUndefined();expect(completed).toBe(true);
  expect(await pending).toHaveLength(147);expect(reviewed.size).toBe(147);
  expect(jest.getTimerCount()).toBe(0);
 }finally{jest.useRealTimers();}
});
