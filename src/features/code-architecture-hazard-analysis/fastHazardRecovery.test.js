// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
jest.mock('./fastHazardSemanticReview',()=>({createReviewBatchPolicy:()=>({rows:24,chars:60000,successes:0,epoch:0}),reviewFastHazards:async ({entries})=>Object.fromEntries(entries.map(({source})=>[source.id,[]]))}));
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';

const ids=prompt=>JSON.parse(prompt.split('\nRows: ')[1]).map(row=>row.id);
test('one exhausted row preserves all independent work and Continue retries only that row',async()=>{
  const sources=Array.from({length:100},(_,i)=>({id:`HA-${i+1}`,action:'Apply torque',phrase:'Too late'}));
  const data=new Map(),checkpoint={read:async key=>data.get(JSON.stringify(key)),write:async(key,value)=>data.set(JSON.stringify(key),value)};
  const request=jest.fn(async prompt=>ids(prompt).map(id=>id==='HA-1'?{id}:answer('STPA',id)));
  let error;
  try{await generateFastHazards({method:'STPA',sources,context:{},checkpoint,request});}catch(e){error=e;}
  expect(error.partialResults).toHaveLength(99);
  expect(error.failedAssessments).toEqual([expect.objectContaining({id:'HA-1',action:'Apply torque',phrase:'Too late'})]);
  expect(error.message).toContain('HA-1');
  expect(error.findings['HA-1']).toContain('applicable must be Yes or No');
  request.mockClear();request.mockImplementation(async prompt=>ids(prompt).map(id=>answer('STPA',id)));
  expect(await generateFastHazards({method:'STPA',sources,context:{},checkpoint,request})).toHaveLength(100);
  expect(request).toHaveBeenCalledTimes(1);expect(ids(request.mock.calls[0][0])).toEqual(['HA-1']);
});

test('parse diagnostics survive exhausted correction instead of becoming identity errors',async()=>{
  await expect(generateFastHazards({method:'STPA',sources:[{id:'a'}],context:{},request:async()=>'[{'}))
    .rejects.toMatchObject({findings:{a:[expect.stringContaining('Response failed:')]},partialResults:[]});
});

test('systemic failures retain accepted results without requesting queued work',async()=>{
  const sources=Array.from({length:160},(_,i)=>({id:`HA-${i+1}`}));
  let calls=0;
  const request=jest.fn(async prompt=>{calls++;if(calls===2)throw new Error('LLM proxy error (401)');return ids(prompt).map(id=>answer('STPA',id));});
  let error;try{await generateFastHazards({method:'STPA',sources,context:{},request});}catch(e){error=e;}
  expect(error.message).toContain('401');expect(error.partialResults.length).toBeGreaterThan(0);
  expect(request.mock.calls.length).toBeLessThanOrEqual(8); // only already dispatched slots
});

test('checkpoint write failure retains validated in-memory rows for recovery',async()=>{
  const checkpoint={read:async()=>null,write:async(_key,value)=>{if(!value.kind)throw new Error('Storage unavailable');}};
  await expect(generateFastHazards({method:'STPA',sources:[{id:'a'}],context:{},checkpoint,
    request:async()=>[answer('STPA','a')]})).rejects.toMatchObject({
      message:'Storage unavailable',partialResults:[expect.objectContaining({id:'a'})],
    });
});

test.each(['TransactionInactiveError','AbortError'])('native %s cannot mask the original failure or discard accepted rows',async name=>{
  const native=new DOMException('Native checkpoint failure',name);
  Object.freeze(native);
  let failure;
  try{await generateFastHazards({method:'STPA',sources:[{id:'a'}],context:{},
    request:async()=>[answer('STPA','a')],
    checkpoint:{read:async()=>null,write:async(_key,value)=>{if(!value.kind)throw native;}}});}catch(error){failure=error;}
  expect(failure).toMatchObject({name,message:'Native checkpoint failure',code:'COMPACT_HAZARD_INTERRUPTED',partialResults:[expect.objectContaining({id:'a'})],totalAssessments:1});
  expect(failure.cause).toBe(native);expect(failure).not.toBe(native);
  expect(native.partialResults).toBeUndefined();
});
