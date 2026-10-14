import {applicabilityPrompt,screenFastApplicability} from './fastHazardApplicability';
const rows=p=>JSON.parse(p.split('\nRows: ')[1]);
const interfaces=p=>JSON.parse(p.split('\nInterfaces: ')[1].split('\nRows: ')[0]);
const source=(id='HA-1')=>({id,from:'Planner',action:'Set speed',to:'Controller',details:['Commands a speed setpoint'],interfaceType:'Command',lifecycle:'Operation',context:{scenario:'Driving',mode:'Autonomous',conditions:'Rain',assumptions:'No operator intervention'},phrase:'Too late'});
const decisions=p=>rows(p).map(({id})=>({id,applicable:'Yes',rationale:'Setpoint timing matters in this scenario.'}));
const cache=()=>{const values=new Map();return {read:async key=>values.get(JSON.stringify(key)),write:async(key,value)=>values.set(JSON.stringify(key),value)};};
beforeEach(()=>localStorage.clear());
test('compact payload excludes megabytes of raw evidence, attachments and bookkeeping while preserving decision inputs',()=>{
 const s={...source(),evidence:{code:'RAW_SOURCE'.repeat(150000)},allocation:{internalId:'BOOKKEEPING'},reviewedValues:{field:'REVIEW_VALUES'}};
 const context={repository:'repo',organizationProfile:'Organization criteria',operationalContext:{mode:'Autonomous'},analysisContext:{text:'FULL_PROJECT_CONTEXT',files:['ATTACHMENT']},contextSources:['CONTEXT_SOURCE']};
 const p=applicabilityPrompt('STPA',[s],context);
 expect(p.length).toBeLessThan(4000);
 for(const text of ['RAW_SOURCE','BOOKKEEPING','REVIEW_VALUES','FULL_PROJECT_CONTEXT','ATTACHMENT','CONTEXT_SOURCE'])expect(p).not.toContain(text);
 for(const text of ['Planner','Set speed','Controller','Rain','No operator intervention','Organization criteria','Autonomous','repo'])expect(p).toContain(text);
 expect(interfaces(p)[0]).toEqual(expect.objectContaining({details:s.details,context:s.context,interfaceType:'Command'}));
});
test('interleaved phrases are grouped by interface and kept together across bounded batches',async()=>{
 const sources=Array.from({length:7},(_,i)=>['A','B'].map(action=>({...source(`${action}-${i}`),action,phrase:`phrase-${i}`}))).flat();
 const request=jest.fn(async p=>decisions(p));
 const result=await screenFastApplicability({method:'STPA',sources,context:{},request,maxBatchRows:10});
 expect(result.size).toBe(14);expect(request).toHaveBeenCalledTimes(2);
 for(const [p] of request.mock.calls){expect(interfaces(p)).toHaveLength(1);expect(rows(p)).toHaveLength(7);}
 expect([...result.keys()].sort()).toEqual(sources.map(s=>s.id).sort());
});
test('screen batches execute in parallel with a three-request ceiling',async()=>{
 let active=0,peak=0;
 const request=jest.fn(async p=>{peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return decisions(p);});
 const sources=Array.from({length:8},(_,i)=>source(`HA-${i}`));
 expect((await screenFastApplicability({method:'STPA',sources,context:{},request,maxBatchRows:1})).size).toBe(8);
 expect(peak).toBe(3);
});
test.each(['STPA','HARA','FHA'])('%s escalates only explicitly ambiguous rows, then checkpoints final decisions',async method=>{
 const sources=[{...source(),evidence:'TARGETED_CODE'}, {...source('HA-2'),evidence:'UNRELATED_CODE'}];
 const checkpoint=cache();
 const request=jest.fn(async(p,o)=>{
  if(o.screeningMode==='compact'){
   expect(p).not.toContain('TARGETED_CODE');expect(p).not.toContain('UNRELATED_CODE');
   return [{id:'HA-1',needsEvidence:true,rationale:'Need precise operation'},...decisions(p).filter(row=>row.id!=='HA-1')];
  }
  expect(o.screeningMode).toBe('evidence');expect(rows(p).map(r=>r.id)).toEqual(['HA-1']);
  expect(p).toContain('TARGETED_CODE');expect(p).not.toContain('UNRELATED_CODE');
  expect(p).toContain('FULL_CONTEXT');return decisions(p);
 });
 const options={method,sources,context:{analysisContext:{text:'FULL_CONTEXT'}},checkpoint,request};
 const result=await screenFastApplicability(options);
 expect(result.size).toBe(2);expect(result.get('HA-1').applicable).toBe('Yes');expect(request).toHaveBeenCalledTimes(2);
 await screenFastApplicability(options);expect(request).toHaveBeenCalledTimes(2);
});
test('unresolved evidence requests are bounded and never cached as No',async()=>{
 const request=jest.fn(async p=>rows(p).map(({id})=>({id,needsEvidence:true,rationale:'Missing prerequisite evidence'}))),onDecision=jest.fn();
 await expect(screenFastApplicability({method:'STPA',sources:[source()],context:{},request,onDecision})).rejects.toThrow('needs additional information');
 expect(request).toHaveBeenCalledTimes(2);expect(onDecision).not.toHaveBeenCalled();
 expect(request.mock.calls.slice(1).every(([,o])=>o.screeningMode==='evidence')).toBe(true);
});
test('governed applicability bypasses both compact and evidence assessment',async()=>{
 const request=jest.fn();
 const sources=['Yes','No'].map((value,i)=>({...source(`HA-${i}`),reviewedApplicability:value,reviewedRationale:`Reviewed ${value}`,evidence:'x'.repeat(200000)}));
 const result=await screenFastApplicability({method:'STPA',sources,context:{},request});
 expect([...result.values()].map(r=>r.applicable)).toEqual(['Yes','No']);expect(request).not.toHaveBeenCalled();
});
test('Stop cancels queued compact batches without deferred decisions',async()=>{
 const controller=new AbortController(),onDeferred=jest.fn();
 const request=jest.fn(async()=>{controller.abort();throw new DOMException('Stopped','AbortError');});
 await expect(screenFastApplicability({method:'STPA',sources:Array.from({length:8},(_,i)=>source(`HA-${i}`)),context:{},request,maxBatchRows:1,signal:controller.signal,onDeferred})).rejects.toMatchObject({name:'AbortError'});
 expect(request.mock.calls.length).toBeLessThanOrEqual(3);expect(onDeferred).not.toHaveBeenCalled();
});
