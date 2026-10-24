import {createHazardEvidenceChunker as boundedChunker,evidencePieces} from './hazardEvidenceChunking';
import {applicabilityPrompt as baseApplicabilityPrompt} from './fastHazardApplicability';
// Exercise full-evidence escalation; the normal screen now excludes raw code.
const applicabilityPrompt=(method,sources,context)=>baseApplicabilityPrompt(method,sources,context,{includeEvidence:true});
import {resultsFirstPrompt,generateFastHazards} from './resultsFirstHazardPipeline';
import {hazardPromptFits} from './hazardPromptPayload';
import {answer} from './fastHazardTestFixtures';
// Legacy provenance/splitting tests exercise deeper recovery with an explicit budget.
const createHazardEvidenceChunker=options=>boundedChunker({maxPreparationRequests:100,...options});
const source={id:'HA-1',action:'Apply torque',phrase:'Too late',evidence:'unique source\n'.repeat(18000)};
const items=p=>JSON.parse(p.split('\nEvidence pieces: ')[1]);
const summary=pieces=>({coveredRefs:pieces.map(p=>p.ref),facts:[{text:'Explicit source constraint; no concurrency established.',refs:pieces.map(p=>p.ref)}],constraints:[],safeguards:[],conflicts:[],unknowns:[]});
const extract=jest.fn(async p=>summary(items(p)));
const memory=()=>{const values=new Map();return {values,read:jest.fn(async key=>values.get(JSON.stringify(key))),write:jest.fn(async(key,value)=>values.set(JSON.stringify(key),value))};};
beforeEach(()=>{localStorage.clear();extract.mockClear();extract.mockImplementation(async p=>summary(items(p)));});
test('pieces preserve every character, unicode and source pointer/offset',()=>{
 const text='界😀\n'.repeat(3000),pieces=evidencePieces({file:{code:text}},'',1000);
 expect(pieces.map(p=>p.value).join('')).toBe(text);
 expect(pieces.every(p=>p.ref.startsWith('/file/code#'))).toBe(true);
 expect(pieces.every(p=>!/[\uD800-\uDBFF]$/.test(p.value))).toBe(true);
});
test('normal requests do not extract evidence',async()=>{
 const chunker=createHazardEvidenceChunker({request:extract}),send=jest.fn(async()=>[]);
 const p=applicabilityPrompt('STPA',[{...source,evidence:'small'}],{});
 await chunker.run(p,{maxTokens:8000},send);
 expect(send).toHaveBeenCalledWith(p,{maxTokens:8000});expect(extract).not.toHaveBeenCalled();
});
test('oversized inputs retain locked row fields and references, checkpoint and reuse across stages',async()=>{
 const checkpoint=memory(),chunker=createHazardEvidenceChunker({request:extract,checkpoint}),send=jest.fn(async p=>{expect(hazardPromptFits(p,{maxTokens:14000})).toBe(true);return [];});
 await chunker.run(applicabilityPrompt('STPA',[source],{organizationProfile:'Use agreed terminology'}),{maxTokens:8000},send);
 const calls=extract.mock.calls.length;expect(calls).toBeGreaterThan(1);
 const withDecision={...source,screenedApplicability:'Yes',screenedRationale:'Locked decision'};
 await chunker.run(resultsFirstPrompt('STPA',[withDecision],{organizationProfile:'Use agreed terminology'}),{maxTokens:14000},send);
 expect(extract).toHaveBeenCalledTimes(calls);
 expect(send.mock.calls[1][0]).toContain('Locked decision');expect(send.mock.calls[1][0]).toContain('Use agreed terminology');
 expect(send.mock.calls[1][0]).toContain('chunk-');
 const fresh=createHazardEvidenceChunker({request:extract,checkpoint});
 await fresh.run(applicabilityPrompt('STPA',[source],{organizationProfile:'Use agreed terminology'}),{maxTokens:8000},send);
 expect(extract).toHaveBeenCalledTimes(calls);
 expect([...checkpoint.values.keys()].some(k=>k.includes('lineage'))).toBe(true);
});
test('provider context rejection triggers fallback and extraction chunks shrink on rejection',async()=>{
 let rejected=false;
 const request=jest.fn(async p=>{const batch=items(p);if(!rejected){rejected=true;throw new Error('prompt is too long');}return summary(batch);});
 const chunker=createHazardEvidenceChunker({request}),send=jest.fn(async p=>{if(!p.includes('Evidence summaries:'))throw new Error('context_length_exceeded');return ['ok'];});
 expect(await chunker.run(applicabilityPrompt('STPA',[{...source,evidence:'code '.repeat(3000)}],{}),{maxTokens:8000},send)).toEqual(['ok']);
 expect(request.mock.calls.length).toBeGreaterThan(1);expect(send).toHaveBeenCalledTimes(2);
});
test('bad coverage/citations cannot silently become an exclusion',async()=>{
 const request=jest.fn(async()=>({coveredRefs:[],facts:[],constraints:[],safeguards:[],conflicts:[],unknowns:[]}));
 const send=jest.fn(),chunker=createHazardEvidenceChunker({request});
 await expect(chunker.run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},send)).rejects.toMatchObject({code:'HAZARD_EVIDENCE_INVALID'});
 expect(send).not.toHaveBeenCalled();
});
test('stop prevents assessment and further extraction',async()=>{
 const controller=new AbortController(),send=jest.fn();
 const request=jest.fn(async p=>{controller.abort();return summary(items(p));});
 const chunker=createHazardEvidenceChunker({request,signal:controller.signal});
 await expect(chunker.run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},send)).rejects.toMatchObject({name:'AbortError'});
 expect(send).not.toHaveBeenCalled();expect(request.mock.calls.length).toBeLessThanOrEqual(3);
});
test.each(['STPA','HARA','FHA'])('%s uses compact screening then chunks oversized generation evidence',async method=>{
 const request=jest.fn(async p=>p.includes('\nEvidence pieces: ')?summary(items(p)):JSON.parse(p.split('\nRows: ')[1]).map(({id})=>answer(method,id)));
 const applicabilityRequest=jest.fn(async p=>JSON.parse(p.split('\nRows: ')[1]).map(({id})=>({id,applicable:'Yes',rationale:'Meaningful deviation'})));
 const result=await generateFastHazards({method,sources:[{...source,evidence:'unique source\n'.repeat(9000)}],context:{},request,applicabilityRequest,onMetrics:()=>{},onDiagnostic:()=>{}});
 expect(result).toHaveLength(1);expect(result[0].applicable).toBe('Yes');
 expect(applicabilityRequest.mock.calls[0][0]).not.toContain('Evidence summaries:');
 expect(applicabilityRequest.mock.calls[0][0]).not.toContain(source.evidence);
 expect(request.mock.calls.filter(([p])=>p.includes('\nRows: '))[0][0]).toContain('Evidence summaries:');
});
test('reduction retains a trace to original pieces',async()=>{
 const checkpoint=memory();
 const verbose=jest.fn(async p=>{const value=summary(items(p));value.facts[0].text='Qualified observation. '.repeat(140);return value;});
 const chunker=createHazardEvidenceChunker({request:verbose,checkpoint});
 await chunker.run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},async()=>[]);
 const lineage=[...checkpoint.values.entries()].find(([key])=>JSON.parse(key).kind==='lineage')[1];
 expect(Object.keys(lineage.lineage).some(key=>key.startsWith('reduce-'))).toBe(true);
 expect(lineage.summaries.every(item=>item.value.coveredRefs.every(ref=>lineage.lineage[ref]))).toBe(true);
});
test('unknown citations are rejected even with complete coverage',async()=>{
 const request=jest.fn(async p=>({...summary(items(p)),facts:[{text:'Claim',refs:['invented-reference']}]}));
 const chunker=createHazardEvidenceChunker({request});
 await expect(chunker.run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},jest.fn())).rejects.toMatchObject({code:'HAZARD_EVIDENCE_INVALID'});
});
test('a truncated singleton extraction increases output allowance before splitting',async()=>{
 let rejected=false;
 const request=jest.fn(async p=>{if(!rejected){rejected=true;throw Object.assign(new Error('truncated'),{name:'TruncatedResponseError'});}return summary(items(p));});
 const chunker=createHazardEvidenceChunker({request});
 const send=jest.fn(async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return [];});
 await chunker.run(applicabilityPrompt('STPA',[{...source,evidence:'source evidence '.repeat(100)}],{}),{maxTokens:8000},send);
 expect(request.mock.calls).toHaveLength(2);
 expect(request.mock.calls.map(([,o])=>o.maxTokens)).toEqual([8000,16000]);
 expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
 expect(send).toHaveBeenCalledTimes(2);
});
test('extraction concurrency is bounded across simultaneous preparations',async()=>{
 let active=0,peak=0;
 const request=jest.fn(async p=>{peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;return summary(items(p));});
 const chunker=createHazardEvidenceChunker({request});
 await Promise.all([1,2].map(i=>chunker.run(applicabilityPrompt('STPA',[{...source,action:`Action ${i}`}],{}),{maxTokens:8000},async()=>[])));
 expect(peak).toBeLessThanOrEqual(3);
});
test('completed chunks are reused after a later extraction failure',async()=>{
 const checkpoint=memory();let count=0;
 const fail=jest.fn(async p=>{if(++count===4)throw new Error('provider offline');return summary(items(p));});
 await expect(createHazardEvidenceChunker({request:fail,checkpoint}).run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},async()=>[])).rejects.toThrow('provider offline');
 const completed=checkpoint.values.size;expect(completed).toBeGreaterThan(0);
 const resume=jest.fn(async p=>summary(items(p)));
 await createHazardEvidenceChunker({request:resume,checkpoint}).run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},async()=>[]);
 const all=jest.fn(async p=>summary(items(p)));
 await createHazardEvidenceChunker({request:all}).run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},async()=>[]);
 expect(resume.mock.calls.length).toBeLessThan(all.mock.calls.length);
});
test.each([7082,7686])('complete %i-character summary is accepted and reused without regeneration',async size=>{
 const checkpoint=memory(),request=jest.fn(async p=>{const value=summary(items(p));value.facts[0].text='x'.repeat(size);return value;});
 const prompt=applicabilityPrompt('STPA',[{...source,evidence:'small evidence'}],{});
 const send=jest.fn(async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return [];});
 await createHazardEvidenceChunker({request,checkpoint}).run(prompt,{maxTokens:8000},send);
 expect(request).toHaveBeenCalledTimes(1);
 expect(request.mock.calls[0][1]).toMatchObject({maxTokens:8000,workflow:'hazard-evidence-extraction'});
 expect(send.mock.calls[1][0]).toContain('x'.repeat(size));
 await createHazardEvidenceChunker({request,checkpoint}).run(prompt,{maxTokens:8000},send);
 expect(request).toHaveBeenCalledTimes(1);
});
test('long valid extractions are checkpointed then compacted with a distinct workflow',async()=>{
 const checkpoint=memory();
 const request=jest.fn(async(p,options)=>{
  const value=summary(items(p));
  if(options.workflow==='hazard-evidence-extraction')value.facts[0].text='Preserve this qualified fact. '.repeat(260);
  else expect(options.workflow).toBe('hazard-evidence-compaction');
  return value;
 });
 await createHazardEvidenceChunker({request,checkpoint}).run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},async()=>[]);
 expect(request.mock.calls.some(([,o])=>o.workflow==='hazard-evidence-compaction')).toBe(true);
 const entries=[...checkpoint.values.entries()].map(([key,value])=>({basis:JSON.parse(key),value}));
 expect(entries.some(({basis,value})=>basis.kind==='extract' && JSON.stringify(value).length>6000)).toBe(true);
 const lineage=entries.find(({basis})=>basis.kind==='lineage').value;
 expect(lineage.summaries.every(item=>item.value.coveredRefs.every(ref=>lineage.lineage[ref]))).toBe(true);
});
test('persistent output truncation splits only after the larger allowance and children retain it',async()=>{
 let failures=0;
 const request=jest.fn(async p=>{if(failures++<2)throw Object.assign(new Error('truncated'),{name:'TruncatedResponseError'});return summary(items(p));});
 const send=jest.fn(async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return [];});
 await createHazardEvidenceChunker({request}).run(applicabilityPrompt('STPA',[{...source,evidence:'source evidence '.repeat(100)}],{}),{maxTokens:8000},send);
 expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
 expect(request.mock.calls[0][1].maxTokens).toBe(8000);
 expect(request.mock.calls.slice(1).every(([,o])=>o.maxTokens===16000)).toBe(true);
 expect(request.mock.calls[2][0]).not.toBe(request.mock.calls[1][0]);
});
test('default preparation cap prevents repeated extraction across retries and target sizes',async()=>{
 const request=jest.fn(async p=>summary(items(p))),chunker=boundedChunker({request});
 const prompt=applicabilityPrompt('STPA',[source],{}),send=jest.fn();
 await expect(chunker.run(prompt,{maxTokens:8000},send)).rejects.toMatchObject({code:'HAZARD_EVIDENCE_BUDGET',completionOnly:true});
 expect(request).toHaveBeenCalledTimes(12);
 await expect(chunker.run(prompt,{maxTokens:8000,inputByteLimit:10000},send)).rejects.toMatchObject({code:'HAZARD_EVIDENCE_BUDGET'});
 expect(request).toHaveBeenCalledTimes(12);expect(send).not.toHaveBeenCalled();
});
test('independent relationships have independent budgets beyond the former run cap',async()=>{
 const request=jest.fn(async p=>summary(items(p))),chunker=boundedChunker({request});
 const send=async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return ['ok'];};
 for(let i=0;i<30;i++)expect(await chunker.run(applicabilityPrompt('STPA',[{...source,evidence:`small ${i}`,action:`Action ${i}`}],{}),{maxTokens:8000},send)).toEqual(['ok']);
 expect(request).toHaveBeenCalledTimes(30);
});
test('elapsed preparation budget stops new work after in-flight requests finish',async()=>{
 let now=1000;const clock=jest.spyOn(Date,'now').mockImplementation(()=>now);
 try{
  const request=jest.fn(async p=>{now+=1000;return summary(items(p));});
  await expect(boundedChunker({request,maxPreparationMs:500}).run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},jest.fn())).rejects.toMatchObject({code:'HAZARD_EVIDENCE_BUDGET'});
  expect(request).toHaveBeenCalledTimes(1);
 }finally{clock.mockRestore();}
});
test('validated extraction is reused in memory without checkpoint storage',async()=>{
 const request=jest.fn(async p=>summary(items(p))),chunker=boundedChunker({request});
 const prompt=applicabilityPrompt('STPA',[{...source,evidence:'small'}],{});
 let rejections=0;
 const send=jest.fn(async()=>{if(rejections++<2)throw new Error('prompt is too long');return ['ok'];});
 expect(await chunker.run(prompt,{maxTokens:8000},send)).toEqual(['ok']);
 expect(request).toHaveBeenCalledTimes(1);
});
test.each(['STPA','HARA','FHA'])('%s completes exhausted evidence once and preserves reviewed decisions',async method=>{
 const request=jest.fn(async p=>summary(items(p)));
 const applicabilityRequest=jest.fn(async p=>JSON.parse(p.split('\nRows: ')[1]).map(({id})=>({id,applicable:'Yes',rationale:'Meaningful deviation'})));
 const result=await generateFastHazards({method,sources:[{...source,reviewedApplicability:'Yes',reviewedRationale:'Accepted command deviation'},{...source,id:'HA-2',reviewedApplicability:'No'}],context:{},request,applicabilityRequest,onMetrics:()=>{},onDiagnostic:()=>{}});
 expect(result).toHaveLength(2);
 expect(result[0]).toMatchObject({applicable:'Yes',assessmentBasis:expect.stringContaining('Assumption-based')});
 expect(result[1].applicable).toBe('No');
 expect(request).toHaveBeenCalledTimes(12);expect(applicabilityRequest).not.toHaveBeenCalled();
});
test.each(['STPA','HARA','FHA'])('%s does not restart invalid evidence recovery on later passes',async method=>{
 const request=jest.fn(async()=>({coveredRefs:[],facts:[],constraints:[],safeguards:[],conflicts:[],unknowns:[]}));
 const applicabilityRequest=jest.fn(async p=>JSON.parse(p.split('\nRows: ')[1]).map(({id})=>({id,needsEvidence:true,rationale:'Need command deadline'})));
 const result=await generateFastHazards({method,sources:[source],context:{},request,applicabilityRequest,onMetrics:()=>{},onDiagnostic:()=>{}});
 expect(result[0].assessmentBasis).toContain('Assumption-based');
 expect(applicabilityRequest).toHaveBeenCalledTimes(1);
 // Three workers, at most two validation attempts per chunk, no subsequent pass.
 expect(request.mock.calls.length).toBeLessThanOrEqual(6);
});
test('evidence time spent on an earlier relationship does not consume a later allowance',async()=>{
 let now=1000;const clock=jest.spyOn(Date,'now').mockImplementation(()=>now);
 try{
  const request=jest.fn(async p=>{now+=1000;return summary(items(p));});
  const chunker=boundedChunker({request,maxPreparationMs:500});
  const send=async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return [];};
  await chunker.run(applicabilityPrompt('STPA',[{...source,evidence:'small'}],{}),{maxTokens:8000},send);
  await chunker.run(applicabilityPrompt('STPA',[{...source,evidence:'different'}],{}),{maxTokens:8000},send);
  expect(request).toHaveBeenCalledTimes(2);
 }finally{clock.mockRestore();}
});
test('an exhausted relationship cannot force an independent relationship into fallback',async()=>{
 const request=jest.fn(async p=>summary(items(p))),chunker=boundedChunker({request});
 await expect(chunker.run(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000},jest.fn())).rejects.toMatchObject({code:'HAZARD_EVIDENCE_BUDGET',evidenceBudget:{scope:'relationship',requests:12}});
 const send=async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return ['analyzed'];};
 expect(await chunker.run(applicabilityPrompt('STPA',[{...source,id:'HA-next',action:'Independent action',evidence:'small'}],{}),{maxTokens:8000},send)).toEqual(['analyzed']);
 expect(request).toHaveBeenCalledTimes(13);
});
test('guide phrases reuse matching evidence while contexts and changed evidence remain isolated',async()=>{
 const request=jest.fn(async p=>summary(items(p))),chunker=boundedChunker({request});
 const send=async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return [];};
 const small={...source,evidence:'small'};
 await Promise.all(['Too early','Too late'].map((phrase,i)=>chunker.run(applicabilityPrompt('STPA',[{...small,id:`HA-${i}`,phrase}],{operationalContext:'Unattended'}),{maxTokens:8000},send)));
 expect(request).toHaveBeenCalledTimes(1);
 await chunker.run(applicabilityPrompt('STPA',[small],{operationalContext:'Attended'}),{maxTokens:8000},send);
 await chunker.run(applicabilityPrompt('STPA',[{...small,evidence:'changed evidence'}],{operationalContext:'Unattended'}),{maxTokens:8000},send);
 expect(request).toHaveBeenCalledTimes(3);
});
test('changed applicability questions cannot reset the relationship budget or reuse a focused summary',async()=>{
 const request=jest.fn(async p=>summary(items(p))),chunker=boundedChunker({request,maxPreparationRequests:1});
 const prompt=applicabilityPrompt('STPA',[{...source,evidence:'small'}],{});
 const send=async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return [];};
 await chunker.run(prompt,{maxTokens:8000,evidenceFocus:'Is there a deadline?'},send);
 await expect(chunker.run(prompt,{maxTokens:8000,evidenceFocus:'Is there a duration?'},send)).rejects.toMatchObject({code:'HAZARD_EVIDENCE_BUDGET'});
 expect(request).toHaveBeenCalledTimes(1);
});
test('idle time between guide phrases does not consume relationship evidence time',async()=>{
 let now=1000;const clock=jest.spyOn(Date,'now').mockImplementation(()=>now);
 try{
  const request=jest.fn(async(p,o)=>{now+=100;const value=summary(items(p));if(o.workflow==='hazard-evidence-extraction')value.facts[0].text='x'.repeat(13000);return value;});
  const chunker=boundedChunker({request,maxPreparationMs:500});
  const prompt=applicabilityPrompt('STPA',[{...source,evidence:'small'}],{});
  const send=async p=>{if(!p.includes('Evidence summaries:'))throw new Error('prompt is too long');return [];};
  await chunker.run(prompt,{maxTokens:8000},send);now+=100000;
  await chunker.run(prompt,{maxTokens:8000,inputByteLimit:12000},send);
  expect(request).toHaveBeenCalledTimes(2);
 }finally{clock.mockRestore();}
});
test('progress shows identified evidence items as well as chunks and deduplicates guide phrases',async()=>{
 const events=[],chunker=createHazardEvidenceChunker({request:extract,onProgress:e=>events.push(e)});
 const options={maxTokens:8000},send=async()=>[];
 const first=applicabilityPrompt('STPA',[source],{});
 const second=applicabilityPrompt('STPA',[{...source,id:'HA-2',action:'Release torque'}],{});
 chunker.plan(first,options);chunker.plan(second,options);
 chunker.plan(applicabilityPrompt('STPA',[{...source,id:'HA-3',phrase:'Too early'}],{}),options);
 chunker.plan(applicabilityPrompt('STPA',[{...source,evidence:'small'}],{}),options);
 await chunker.run(first,options,send);
 expect(events[0]).toMatchObject({completed:0,evidenceItem:1,evidenceTotal:2});
 expect(events.every(e=>e.evidenceTotal===2)).toBe(true);
 expect(events.at(-1).message).toMatch(/^Preparing oversized evidence: item 1 of 2 identified so far · chunk \d+ of \d+$/);
 events.length=0;await chunker.run(second,options,send);
 expect(events[0]).toMatchObject({evidenceItem:2,evidenceTotal:2});
 const before=events.length;await chunker.run(first,options,send);expect(events).toHaveLength(before);
});
test('unexpected provider input rejection registers an additional identified evidence item',async()=>{
 const events=[],chunker=createHazardEvidenceChunker({request:extract,onProgress:e=>events.push(e)});
 chunker.plan(applicabilityPrompt('STPA',[source],{}),{maxTokens:8000});
 const prompt=applicabilityPrompt('STPA',[{...source,evidence:'small'}],{});
 await chunker.run(prompt,{maxTokens:8000},async p=>{if(!p.includes('Evidence summaries:'))throw new Error('context_length_exceeded');return [];});
 expect(events[0]).toMatchObject({evidenceItem:2,evidenceTotal:2});
});

test('evicted evidence summaries reload checkpoints without repeating provider work',async()=>{
 const checkpoint=memory(),chunker=createHazardEvidenceChunker({request:extract,checkpoint,cacheBytes:1,cacheEntries:0});
 const prompt=applicabilityPrompt('STPA',[source],{}),send=async()=>[];
 await chunker.run(prompt,{maxTokens:8000},send);
 const calls=extract.mock.calls.length;
 expect(calls).toBeGreaterThan(0);
 await chunker.run(prompt,{maxTokens:8000},send);
 expect(extract).toHaveBeenCalledTimes(calls);
 expect(chunker.memoryStats()).toEqual(expect.objectContaining({summaries:expect.objectContaining({entries:0}),prepared:expect.objectContaining({entries:0}),inFlight:0,preparationBudgets:1}));
});
