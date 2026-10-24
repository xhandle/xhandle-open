import {createHazardEvidenceChunker} from './hazardEvidenceChunking';
import {resultsFirstPrompt} from './resultsFirstHazardPipeline';
import {resilientHazardCheckpoint} from './resilientHazardCheckpoint';

const prompt=id=>resultsFirstPrompt('STPA',[{id,action:id,phrase:'Too late',evidence:'x'.repeat(2000)}],{});
const send=async text=>{if(!text.includes('Evidence summaries:'))throw new Error('context_length_exceeded');return text;};
const extraction=()=>jest.fn(async text=>{
 const refs=JSON.parse(text.split('\nEvidence pieces: ')[1]).map(p=>p.ref);
 return {coveredRefs:refs,facts:[{text:'Preserved evidence',refs}],constraints:[],safeguards:[],conflicts:[],unknowns:[]};
});

test('real checkpoint timeout interrupts evicted preparation and late recovery reuses it',async()=>{
 const stored=new Map();let blocked=false,release;
 const backend={read:async basis=>{if(blocked)await new Promise(resolve=>{release=resolve;});return stored.get(JSON.stringify(basis));},write:async(basis,value)=>{stored.set(JSON.stringify(basis),value);}};
 const checkpoint=resilientHazardCheckpoint(backend,{maxCleanEntries:0,readTimeoutMs:5});
 const request=extraction(),chunker=createHazardEvidenceChunker({request,checkpoint,cacheEntries:1,maxPreparationRequests:1});
 const original=await chunker.run(prompt('A'),{maxTokens:14000},send);await checkpoint.flush();
 await chunker.run(prompt('B'),{maxTokens:14000},send);await checkpoint.flush();
 blocked=true;
 await expect(chunker.run(prompt('A'),{maxTokens:14000},send)).rejects.toMatchObject({code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'});
 expect(request).toHaveBeenCalledTimes(2);
 blocked=false;release();await new Promise(resolve=>setTimeout(resolve,0));
 expect(await chunker.run(prompt('A'),{maxTokens:14000},send)).toBe(original);
 expect(request).toHaveBeenCalledTimes(2);
});

test('cancellation while reloading evicted evidence stays cancellation, not storage failure',async()=>{
 const controller=new AbortController();let blocked=false,release;
 const stored=new Map(),request=extraction();
 const checkpoint={read:async basis=>{if(blocked)await new Promise(resolve=>{release=resolve;});return stored.get(JSON.stringify(basis));},write:async(basis,value)=>stored.set(JSON.stringify(basis),value)};
 const chunker=createHazardEvidenceChunker({request,checkpoint,signal:controller.signal,cacheEntries:1});
 await chunker.run(prompt('A'),{maxTokens:14000},send);await chunker.run(prompt('B'),{maxTokens:14000},send);
 blocked=true;const pending=chunker.run(prompt('A'),{maxTokens:14000},send).catch(e=>e);
 await Promise.resolve();controller.abort();release();
 expect((await pending).name).toBe('AbortError');expect(request).toHaveBeenCalledTimes(2);
});

test.each(['budget-first','storage-first','cancelled'])('parallel evidence failures preserve required evidence: %s',async order=>{
 const controller=new AbortController();
 const stored=new Map();let recovering=false;const releases=[];
 const checkpoint={read:async basis=>{
   if(recovering && (stored.has(JSON.stringify(basis)) === (order!=='storage-first')))await new Promise(resolve=>releases.push(resolve));
   return recovering?undefined:stored.get(JSON.stringify(basis));
 },write:async(basis,value)=>stored.set(JSON.stringify(basis),value)};
 let calls=0;const extract=extraction();
 const request=jest.fn(async text=>{if(++calls>1)throw new Error('Extraction unavailable');return extract(text);});
 const chunker=createHazardEvidenceChunker({request,checkpoint,cacheEntries:0,maxPreparationRequests:2,signal:controller.signal});
 const text=resultsFirstPrompt('STPA',[{id:'partial',action:'partial',phrase:'Too late',evidence:'x'.repeat(18000)}],{});
 await expect(chunker.run(text,{maxTokens:14000},send)).rejects.toThrow('Extraction unavailable');
 expect(stored.size).toBeGreaterThan(0);
 recovering=true;
 const pending=chunker.run(text,{maxTokens:14000},send).catch(e=>e);
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(releases.length).toBeGreaterThan(0);
 if(order==='cancelled')controller.abort();
 releases.forEach(resolve=>resolve());
 const error=await pending;
 expect(error).toMatchObject(order==='cancelled'?{name:'AbortError'}:{code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'});
 expect(error.completionOnly).not.toBe(true);
 expect(request).toHaveBeenCalledTimes(2);
});
