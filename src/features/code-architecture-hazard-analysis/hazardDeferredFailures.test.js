import {generateFastHazards} from './resultsFirstHazardPipeline';
import {screenFastApplicability} from './fastHazardApplicability';
import {answer} from './fastHazardTestFixtures';
const batch=p=>JSON.parse(p.split('\nRows: ')[1]);
const source=(i,reviewed=true)=>({id:`HA-${i}`,action:'Apply torque',phrase:'Too late',...(reviewed?{reviewedApplicability:'Yes',reviewedRationale:'Reviewed'}:{})});
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
beforeEach(()=>localStorage.clear());
test.each(['STPA','HARA','FHA'])('%s defers provider failure, completes independent work, then retries only unfinished rows',async method=>{
 const events=[];let first=true;
 const request=jest.fn(async p=>{
  const rows=batch(p);events.push(rows.map(r=>r.id));
  if(first && rows.some(r=>r.id==='HA-1')){first=false;throw Object.assign(new Error('Provider retries exhausted'),{code:'HAZARD_RECOVERY_EXHAUSTED'});}
  return rows.map(({id})=>answer(method,id));
 });
 const result=await generateFastHazards({method,sources:Array.from({length:10},(_,i)=>source(i+1)),context:{},request,...quiet});
 expect(result.map(r=>r.id)).toEqual(Array.from({length:10},(_,i)=>`HA-${i+1}`));
 const retry=events.findIndex((ids,index)=>index>0 && ids.includes('HA-1'));
 expect(events.findIndex(ids=>ids.includes('HA-9'))).toBeLessThan(retry);
 expect(events.filter(ids=>ids.includes('HA-9'))).toHaveLength(1);
 expect(events[retry]).toEqual(['HA-1']);
});
test('screening defers a failed subchunk and continues sibling rows without inventing No',async()=>{
 const onDeferred=jest.fn(),request=jest.fn(async p=>{
  const rows=batch(p);if(rows.some(r=>r.id==='HA-1'))throw new Error('Provider unavailable');
  return rows.map(({id})=>({id,applicable:'No',rationale:'Not a command'}));
 });
 const decisions=await screenFastApplicability({method:'STPA',sources:[source(1,false),source(2,false)],context:{},request,maxBatchRows:1,onDeferred});
 expect(decisions.has('HA-1')).toBe(false);expect(decisions.get('HA-2').applicable).toBe('No');
 expect(onDeferred).toHaveBeenCalledTimes(1);
});
test('invalid evidence uses assumption completion while independent decisions remain intact',async()=>{
 const events=[];let fail=true;
 const request=jest.fn(async p=>{
  if(p.includes('\nEvidence pieces: ')){
   if(fail){fail=false;events.push('extraction-failed');throw Object.assign(new Error('Invalid evidence summary'),{code:'HAZARD_EVIDENCE_INVALID'});}
   events.push('extraction-retry');const pieces=JSON.parse(p.split('\nEvidence pieces: ')[1]),refs=pieces.map(item=>item.ref);
   return {coveredRefs:refs,facts:[{text:'Constraint',refs}],constraints:[],safeguards:[],conflicts:[],unknowns:[]};
  }
  return batch(p).map(({id})=>answer('STPA',id));
 });
 const applicabilityRequest=jest.fn(async p=>batch(p).map(({id})=>{if(id==='HA-1' && !p.includes('Additional evidence was requested'))return {id,needsEvidence:true,rationale:'Need source evidence'};events.push(`screened-${id}`);return {id,applicable:'No',rationale:'Out of scope'};}));
 const result=await generateFastHazards({method:'STPA',sources:[{...source(1,false),evidence:'evidence '.repeat(30000)},source(2,false)],context:{},request,applicabilityRequest,...quiet,onProgress:patch=>{if(patch.message?.startsWith("Revisiting"))events.push("end-retry");}});
 expect(result.map(r=>r.applicable)).toEqual(['Yes','No']);
 expect(result[0].assessmentBasis).toContain('Assumption-based');
 expect(events).toContain('screened-HA-2');
 expect(events).not.toContain('end-retry');
 expect(applicabilityRequest.mock.calls.filter(([p])=>batch(p).some(r=>r.id==='HA-1'))).toHaveLength(1);
 expect(applicabilityRequest.mock.calls.filter(([p])=>batch(p).some(r=>r.id==='HA-2'))).toHaveLength(1);
});
test('persistent failures do not prevent other rows from being completed and finish with explicit premises',async()=>{
 const request=jest.fn(async p=>{
  const rows=batch(p);if(rows.some(r=>r.id==='HA-1'))throw new Error('Provider unavailable');
  return rows.map(({id})=>answer('STPA',id));
 });
 await expect(generateFastHazards({method:'STPA',sources:[source(1),source(2)],context:{},request,...quiet})).resolves.toMatchObject([
  {id:'HA-1',assessmentBasis:expect.stringContaining('Assumption-based')},{id:'HA-2',uca:answer('STPA','HA-2').uca},
 ]);
 expect(request.mock.calls.filter(([p])=>batch(p).some(r=>r.id==='HA-1'))).toHaveLength(3);
 expect(request.mock.calls.filter(([p])=>batch(p).length===1 && batch(p)[0].id==='HA-2')).toHaveLength(1);
});
test('structurally invalid rows recover in end-of-run passes without rerunning accepted rows',async()=>{
 let calls=0;
 const request=jest.fn(async p=>batch(p).map(({id})=>id==='HA-1' && ++calls<=3?{id}:answer('STPA',id)));
 const result=await generateFastHazards({method:'STPA',sources:[source(1),source(2)],context:{},request,...quiet});
 expect(result).toHaveLength(2);
 expect(request.mock.calls.filter(([p])=>batch(p).some(r=>r.id==='HA-2'))).toHaveLength(1);
});
test.each([401,403])('authentication failure %s uses local assumptions without repeated requests',async status=>{
 const request=jest.fn(async()=>{throw new Error(`LLM proxy error (${status}): denied`);});
 await expect(generateFastHazards({method:'STPA',sources:[source(1)],context:{},request,...quiet})).resolves.toMatchObject([{assessmentBasis:expect.stringContaining('Assumption-based')}]);
 expect(request).toHaveBeenCalledTimes(1);
});
test('explicit Stop is never deferred',async()=>{
 const controller=new AbortController();const request=jest.fn(async()=>{controller.abort();throw new DOMException('Stopped','AbortError');});
 await expect(generateFastHazards({method:'STPA',sources:[source(1)],context:{},request,signal:controller.signal,...quiet})).rejects.toMatchObject({name:'AbortError'});
 expect(request).toHaveBeenCalledTimes(1);
});

test.each(['screening','generation'])('%s preserves storage failure over concurrent provider failure in either order',async stage=>{
 for(const storageFirst of [true,false]){
  const storage=Object.assign(new Error('Required evidence unavailable'),{code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'});
  const provider=Object.assign(new Error('Denied'),{status:403});
  const pending=[];
  const request=jest.fn(()=>new Promise((resolve,reject)=>pending.push(reject)));
  const diagnostic=jest.fn();
  const run=stage==='screening'
   ?screenFastApplicability({method:'STPA',sources:[source(1,false),source(2,false)],context:{},request,maxBatchRows:1})
   :generateFastHazards({method:'STPA',sources:Array.from({length:9},(_,i)=>source(i+1)),context:{},request,...quiet,onDiagnostic:diagnostic});
  const outcome=run.catch(e=>e);
  for(let i=0;i<100 && pending.length<2;i++)await new Promise(resolve=>setTimeout(resolve,0));
  expect(pending).toHaveLength(2);
  pending[0](storageFirst?storage:provider);
  await new Promise(resolve=>setTimeout(resolve,0));
  pending[1](storageFirst?provider:storage);
  expect(await outcome).toMatchObject({code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'});
  expect(diagnostic.mock.calls.some(([e])=>e.event==='assumption-based-completion')).toBe(false);
 }
});
