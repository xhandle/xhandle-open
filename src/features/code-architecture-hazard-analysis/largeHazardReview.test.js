import {createHazardEvidenceChunker} from './hazardEvidenceChunking';
import {resultsFirstPrompt,generateFastHazards} from './resultsFirstHazardPipeline';
import {resilientHazardCheckpoint} from './resilientHazardCheckpoint';

// Regression coverage for findings from the large-hazard reliability review.
test('evicted preparation stops recoverably instead of consuming its budget again when storage is unavailable',async()=>{
 const request=jest.fn(async prompt=>{
  const pieces=JSON.parse(prompt.split('\nEvidence pieces: ')[1]),refs=pieces.map(p=>p.ref);
  return {coveredRefs:refs,facts:[{text:'Preserved fact',refs}],constraints:[],safeguards:[],conflicts:[],unknowns:[]};
 });
 const chunker=createHazardEvidenceChunker({request,checkpoint:{read:async()=>undefined,write:async()=>{}},cacheEntries:1,maxPreparationRequests:1});
 const send=async prompt=>{if(!prompt.includes('Evidence summaries:'))throw new Error('context_length_exceeded');return ['ok'];};
 const prompt=id=>resultsFirstPrompt('STPA',[{id,action:id,phrase:'Too late',evidence:'x'.repeat(2000)}],{});
 expect(await chunker.run(prompt('A'),{maxTokens:14000},send)).toEqual(['ok']);
 expect(await chunker.run(prompt('B'),{maxTokens:14000},send)).toEqual(['ok']);
 await expect(chunker.run(prompt('A'),{maxTokens:14000},send)).rejects.toMatchObject({code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'});
 expect(request).toHaveBeenCalledTimes(2);
 const retained=createHazardEvidenceChunker({request,checkpoint:{read:async()=>undefined,write:async()=>{}},cacheEntries:2,maxPreparationRequests:1});
 await retained.run(prompt('A'),{maxTokens:14000},send);
 await retained.run(prompt('B'),{maxTokens:14000},send);
 expect(await retained.run(prompt('A'),{maxTokens:14000},send)).toEqual(['ok']);
 expect(request).toHaveBeenCalledTimes(4);
});

test('review: storage exhaustion leaves a capacity-blocked producer unable to resume when backend recovers',async()=>{
 const controller=new AbortController();let available=false;
 const write=jest.fn(async()=>{if(!available)throw new DOMException('full','QuotaExceededError');});
 const cache=resilientHazardCheckpoint({write},{signal:controller.signal,maxPendingEntries:1});
 await cache.write({id:1},'first');await new Promise(r=>setTimeout(r,0));
 available=true;let completed=false;
 const second=cache.write({id:2},'second').then(()=>{completed=true;},()=>{});
 await new Promise(r=>setTimeout(r,20));await cache.flush();
 expect(completed).toBe(false);expect(write).toHaveBeenCalledTimes(1);
 controller.abort();await second;
});

test('paused status clears when production resumes with other writes pending',async()=>{
 let releaseFirst,releaseRest,calls=0;
 const first=new Promise(r=>{releaseFirst=r;}),rest=new Promise(r=>{releaseRest=r;});
 const states=[];
 const cache=resilientHazardCheckpoint({writeMany:()=>++calls===1?first:rest},{maxPendingEntries:3,onStorageState:s=>states.push(s)});
 await cache.write({id:1},'one');await cache.write({id:2},'two');await cache.write({id:3},'three');
 let completed=false;const fourth=cache.write({id:4},'four').then(()=>{completed=true;});
 await new Promise(r=>setTimeout(r,0));
 expect(completed).toBe(false);expect(states.at(-1).message).toContain('Analysis paused');
 releaseFirst();await fourth;
 expect(completed).toBe(true);expect(cache.memoryStats().pending).toBeGreaterThan(0);
 expect(states.at(-1)).toMatchObject({unsaved:true,status:'pending',message:'Analysis resumed. Progress is still being saved.'});
 releaseRest();await cache.flush();
});

test.each(['missing','invalid','rejected'])('evicted evidence recovers after %s checkpoint reads without more provider work',async failure=>{
 const stored=new Map();let mode='healthy';
 const checkpoint={
  read:async basis=>{if(mode==='missing')return undefined;if(mode==='invalid')return {};if(mode==='rejected')throw new Error('Storage unavailable');return stored.get(JSON.stringify(basis));},
  write:async(basis,value)=>{stored.set(JSON.stringify(basis),value);},
 };
 const request=jest.fn(async prompt=>{
  const refs=JSON.parse(prompt.split('\nEvidence pieces: ')[1]).map(p=>p.ref);
  return {coveredRefs:refs,facts:[{text:'Original evidence retained',refs}],constraints:[],safeguards:[],conflicts:[],unknowns:[]};
 });
 const chunker=createHazardEvidenceChunker({request,checkpoint,cacheEntries:1,maxPreparationRequests:1});
 const send=async prompt=>{if(!prompt.includes('Evidence summaries:'))throw new Error('context_length_exceeded');return prompt;};
 const prompt=id=>resultsFirstPrompt('STPA',[{id,action:id,phrase:'Too late',evidence:'x'.repeat(2000)}],{});
 const original=await chunker.run(prompt('A'),{maxTokens:14000},send);
 await chunker.run(prompt('B'),{maxTokens:14000},send);
 mode=failure;
 await expect(chunker.run(prompt('A'),{maxTokens:14000},send)).rejects.toMatchObject({code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'});
 expect(request).toHaveBeenCalledTimes(2);
 mode='healthy';
 expect(await chunker.run(prompt('A'),{maxTokens:14000},send)).toBe(original);
 expect(request).toHaveBeenCalledTimes(2);
});

test.each(['STPA','HARA','FHA'])('%s preserves accepted work and never converts missing prepared evidence into assumptions',async method=>{
 const error=Object.assign(new Error('Previously prepared evidence unavailable; continue after storage recovery.'),{code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'});
 const request=jest.fn(),diagnostic=jest.fn();
 const outcome=await generateFastHazards({method,sources:[
  {id:'accepted',action:'Earlier action',phrase:'Too late',reviewedApplicability:'No',reviewedRationale:'Manually excluded'},
  {id:'pending',action:'Pending action',phrase:'Too late'},
 ],context:{},checkpoint:{readMany:async bases=>bases.map(()=>undefined),writeMany:async()=>{}},
 applicabilityRequest:async()=>{throw error;},request,onDiagnostic:diagnostic,onMetrics:()=>{}}).catch(e=>e);
 expect(outcome).toMatchObject({code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE',totalAssessments:2});
 expect(outcome.partialResults.map(row=>row.id)).toEqual(['accepted']);
 expect(request).not.toHaveBeenCalled();
 expect(diagnostic.mock.calls.some(([event])=>event.event==='assumption-based-completion')).toBe(false);
});
