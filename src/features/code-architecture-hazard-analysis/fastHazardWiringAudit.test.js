// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
jest.mock('./fastHazardSemanticReview',()=>({createReviewBatchPolicy:()=>({rows:24,chars:60000,successes:0,epoch:0}),reviewFastHazards:async ({entries})=>Object.fromEntries(entries.map(({source})=>[source.id,[]]))}));
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';

test('shared evidence is budgeted once per output-bounded request', async () => {
  const sources = Array.from({length:32}, (_, index) => ({
    id:`HA-${index + 1}`, from:'Controller', action:'Command actuator', to:'Actuator',
    phrase:'Too late', evidence:{content:'x'.repeat(12000)},
  }));
  const request = jest.fn(async prompt => JSON.parse(prompt.split('\nRows: ')[1])
    .map(({id}) => answer('STPA', id, 'Command actuator')));
  const results = await generateFastHazards({method:'STPA', sources, context:{}, request});
  expect(results).toHaveLength(32);
  // Preserve all evidence; split for response capacity, not input duplication.
  expect(request.mock.calls.length).toBeLessThanOrEqual(7);
});

test('recoverable malformed responses report retries without artificial progress', async () => {
  const progress = jest.fn();
  const request = jest.fn(async prompt => request.mock.calls.length === 1 ? '[{' :
    JSON.parse(prompt.split('\nRows: ')[1]).map(({id}) => answer('STPA', id, 'Command actuator')));
  await generateFastHazards({method:'STPA', sources:[{id:'HA-1', phrase:'Too late'}],
    context:{}, request, onProgress:progress});
  expect(request).toHaveBeenCalledTimes(2);
  expect(progress.mock.calls.some(([event]) => event.message.includes('Correcting'))).toBe(true);
  expect(progress.mock.calls.filter(([event])=>event.message.includes('Correcting')).every(([event])=>event.completed===0)).toBe(true);
});

test('batch budget includes organization context and preserves distinct evidence',async()=>{
  const sources=Array.from({length:8},(_,index)=>({id:`HA-${index+1}`, evidence:'e'.repeat(3000)+index}));
  const request=jest.fn(async prompt=>{
    expect(prompt.length).toBeLessThanOrEqual(120000);
    expect(prompt).toContain('Organization policy');
    return JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id));
  });
  const results=await generateFastHazards({method:'STPA',sources,context:{profile:'Organization policy'+'p'.repeat(15000)},request});
  expect(request.mock.calls.length).toBeGreaterThan(1);
  expect(results.map(row=>row.id)).toEqual(sources.map(row=>row.id));
  const definitions=request.mock.calls.flatMap(([prompt])=>JSON.parse(prompt.split('\nInterfaces: ')[1].split('\nRows: ')[0]));
  expect(definitions.map(row=>row.evidence).sort()).toEqual(sources.map(row=>row.evidence).sort());
});

test('waiting heartbeat never advances completion and is cleared after response',async()=>{
  jest.useFakeTimers();
  try {
    let resolve;
    const request=()=>new Promise(done=>{resolve=done;});
    const progress=jest.fn();
    const pending=generateFastHazards({method:'STPA',sources:[{id:'HA-1'}],context:{},request,onProgress:progress});
    // The checkpoint fallback completes before the request begins.
    for(let i=0;i<5;i++)await Promise.resolve();
    jest.advanceTimersByTime(10000);
    expect(progress.mock.calls.at(-1)[0]).toMatchObject({completed:0,step:20});
    expect(progress.mock.calls.at(-1)[0].message).toContain('10s');
    resolve([answer('STPA','HA-1')]);await pending;
    expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});
