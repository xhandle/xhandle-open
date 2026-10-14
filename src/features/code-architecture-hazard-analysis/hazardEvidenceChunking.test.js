import {createHazardEvidenceChunker,evidencePieces} from './hazardEvidenceChunking';
import {applicabilityPrompt} from './fastHazardApplicability';
import {resultsFirstPrompt,generateFastHazards} from './resultsFirstHazardPipeline';
import {hazardPromptFits} from './hazardPromptPayload';
import {answer} from './fastHazardTestFixtures';
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
test.each(['STPA','HARA','FHA'])('%s completes oversized screening and generation using compact evidence',async method=>{
 const request=jest.fn(async p=>p.includes('\nEvidence pieces: ')?summary(items(p)):JSON.parse(p.split('\nRows: ')[1]).map(({id})=>answer(method,id)));
 const applicabilityRequest=jest.fn(async p=>JSON.parse(p.split('\nRows: ')[1]).map(({id})=>({id,applicable:'Yes',rationale:'Meaningful deviation'})));
 const result=await generateFastHazards({method,sources:[source],context:{},request,applicabilityRequest,onMetrics:()=>{},onDiagnostic:()=>{}});
 expect(result).toHaveLength(1);expect(result[0].applicable).toBe('Yes');
 expect(applicabilityRequest.mock.calls[0][0]).toContain('Evidence summaries:');
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
