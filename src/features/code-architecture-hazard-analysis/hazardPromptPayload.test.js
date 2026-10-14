import {compactHazardPromptPayload,assertHazardPromptFits} from './hazardPromptPayload';
import {screenFastApplicability} from './fastHazardApplicability';
import {generateFastHazards} from './resultsFirstHazardPipeline';
import {answer} from './fastHazardTestFixtures';
const rows=p=>JSON.parse(p.split('\nRows: ')[1]);
const source=(id='HA-1')=>({id,action:'Apply torque',phrase:'Too late'});
test('repeated multi-megabyte evidence is losslessly represented once',()=>{
 const fn={filePath:'controller.py',content:'evidence '.repeat(2000)};
 const context={text:'Context'},interfaces=[{evidence:{code:{sourceFunctions:Array(100).fill(fn)},source:{functions:Array(100).fill(fn)}}}];
 const packed=compactHazardPromptPayload(context,interfaces);
 const expand=value=>{
  if(value?.$evidenceRef)return expand(packed.evidence[value.$evidenceRef]);
  if(Array.isArray(value))return value.map(expand);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v)]));return value;
 };
 expect(expand(packed.interfaces)).toEqual(interfaces);expect(expand(packed.context)).toEqual(context);
 expect(JSON.stringify(packed).length).toBeLessThan(30000);
});
test('invalid evidence escalation cannot silently become No',async()=>{
 const request=jest.fn(async p=>p.includes('Evidence pieces: ')?undefined:rows(p).map(({id})=>({id,needsEvidence:true,rationale:'Need implementation details'})));
 await expect(screenFastApplicability({method:'STPA',sources:[{...source(),evidence:'x'.repeat(130000)}],context:{},request})).rejects.toMatchObject({code:'HAZARD_EVIDENCE_INVALID'});
 expect(request.mock.calls.some(([p])=>p.includes('Evidence pieces: '))).toBe(true);
});
test('oversized shared context requires valid extraction',async()=>{
 const request=jest.fn();
 await expect(screenFastApplicability({method:'FHA',sources:[source()],context:{organizationProfile:'x'.repeat(130000)},request})).rejects.toMatchObject({code:'HAZARD_EVIDENCE_INVALID'});expect(request).toHaveBeenCalled();
 expect(request.mock.calls.every(([p])=>p.includes("Evidence pieces: "))).toBe(true);
});
test.each(['STPA','HARA','FHA'])('%s generation requires valid extraction even when applicability is reviewed',async method=>{
 const request=jest.fn();
 await expect(generateFastHazards({method,sources:[{...source(),reviewedApplicability:'Yes',reviewedRationale:'Reviewed',evidence:'x'.repeat(130000)}],context:{},request,onDiagnostic:()=>{},onMetrics:()=>{}})).rejects.toMatchObject({code:'HAZARD_DEFERRED_REMAINING',partialResults:[]});expect(request).toHaveBeenCalled();
 expect(request.mock.calls.every(([p])=>p.includes("Evidence pieces: "))).toBe(true);
});
test('provider input rejection splits screening rather than repeating the same request',async()=>{
 const request=jest.fn(async p=>{const batch=rows(p);if(batch.length>1)throw new Error('LLM proxy error (400): prompt is too long');return batch.map(({id})=>({id,applicable:'No',rationale:'Excluded'}));});
 expect((await screenFastApplicability({method:'STPA',sources:[source(),source('HA-2')],context:{},request})).size).toBe(2);
 expect(request.mock.calls.map(([p])=>rows(p).length)).toEqual([2,1,1]);
});
test('provider input rejection splits generation and retains successful answers',async()=>{
 const request=jest.fn(async p=>{const batch=rows(p);if(batch.length>1)throw new Error('LLM proxy error (400): prompt is too long');return batch.map(({id})=>answer('STPA',id));});
 const sources=[source(),source('HA-2')].map(s=>({...s,reviewedApplicability:'Yes',reviewedRationale:'Reviewed'}));
 const result=await generateFastHazards({method:'STPA',sources,context:{},request,onDiagnostic:()=>{},onMetrics:()=>{}});
 expect(result).toHaveLength(2);expect(request.mock.calls.map(([p])=>rows(p).length)).toEqual([2,1,1]);
});
test('hard ceiling includes all characters, not just row count',()=>{
 expect(()=>assertHazardPromptFits('x'.repeat(120000))).not.toThrow();
 expect(()=>assertHazardPromptFits('x'.repeat(120001))).toThrow('too large');
});
test('failed extraction preserves already resolved rows in the recovery error',async()=>{
 const request=jest.fn();
 const sources=[{...source(),reviewedApplicability:'No',reviewedRationale:'Human exclusion'},
  {...source('HA-2'),reviewedApplicability:'Yes',reviewedRationale:'Human inclusion',evidence:'x'.repeat(130000)}];
 await expect(generateFastHazards({method:'STPA',sources,context:{},request,onDiagnostic:()=>{},onMetrics:()=>{}})).rejects.toMatchObject({code:'HAZARD_DEFERRED_REMAINING',partialResults:[{id:'HA-1',applicable:'No'}]});
 expect(request).toHaveBeenCalled();
 expect(request.mock.calls.every(([p])=>p.includes("Evidence pieces: "))).toBe(true);
});
test('duplicated oversized source is absent from the compact screen',async()=>{
 const fn={file:'source.py',content:'evidence '.repeat(2000)};
 const request=jest.fn(async p=>{expect(p.length).toBeLessThan(120000);return [{id:'HA-1',applicable:'No',rationale:'Not applicable'}];});
 await screenFastApplicability({method:'STPA',sources:[{...source(),evidence:{code:Array(100).fill(fn),source:Array(100).fill(fn)}}],context:{},request});
 expect(request).toHaveBeenCalledTimes(1);
});

describe('large individual inputs use a separate request allowance',()=>{
 beforeEach(()=>localStorage.clear());
 afterEach(()=>localStorage.clear());
 const claude=()=>{localStorage.setItem('xhandle.aiProvider.active','anthropic');localStorage.setItem('xhandle.aiProviderModel.anthropic','claude-haiku-5-5');};
 test.each(['STPA','HARA','FHA'])('%s screens and generates a 156,337-character source without evidence loss',async method=>{
  claude();
  const evidence='unique evidence '.repeat(10423).slice(0,156337);
  const applicabilityRequest=jest.fn(async p=>{
   expect(p).not.toContain(evidence);
   return rows(p).map(({id})=>({id,applicable:'Yes',rationale:'Meaningful deviation'}));
  });
  const request=jest.fn(async p=>{expect(p).toContain(evidence);return rows(p).map(({id})=>answer(method,id));});
  const result=await generateFastHazards({method,sources:[{...source(),evidence}],context:{},applicabilityRequest,request,onDiagnostic:()=>{},onMetrics:()=>{}});
  expect(result).toHaveLength(1);expect(result[0].applicable).toBe('Yes');
  expect(applicabilityRequest).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(1);
 });
 test('large shared context is summarized with coverage before screening',async()=>{
  claude();const profile='context '.repeat(19542);
  const request=jest.fn(async p=>{if(p.includes('Evidence pieces: ')){const refs=JSON.parse(p.split('Evidence pieces: ')[1]).map(x=>x.ref);return {coveredRefs:refs,facts:[{text:'Organization context',refs}],constraints:[],safeguards:[],conflicts:[],unknowns:[]};}expect(p).toContain('Evidence summaries:');expect(p.length).toBeLessThan(60000);return rows(p).map(({id})=>({id,applicable:'No',rationale:'Outside scope'}));});
  await screenFastApplicability({method:'STPA',sources:[source(),source('HA-2')],context:{organizationProfile:profile},request});
  expect(request.mock.calls.filter(([p])=>p.includes('Rows: ')).map(([p])=>rows(p).length)).toEqual([1,1]);
 });
 test('missing IDs receive structural feedback without increasing output allowance',async()=>{
  claude();const request=jest.fn(async()=>[]);
  await screenFastApplicability({method:'STPA',sources:[{...source(),evidence:'x'.repeat(156337)}],context:{},request}).catch(error=>expect(error.message).toContain('missing-id'));
  expect(request.mock.calls.map(([,o])=>o.maxTokens)).toEqual([8000,8000,8000]);
 });
 test('invalid extraction for oversized Claude input retains partial results',async()=>{
  claude();const request=jest.fn();
  await expect(generateFastHazards({method:'STPA',sources:[{...source(),reviewedApplicability:'No'},
   {...source('HA-2'),reviewedApplicability:'Yes',evidence:'x'.repeat(210000)}],context:{},request,onDiagnostic:()=>{},onMetrics:()=>{}}))
   .rejects.toMatchObject({code:'HAZARD_DEFERRED_REMAINING',partialResults:[{id:'HA-1',applicable:'No'}]});
  expect(request).toHaveBeenCalled();
 expect(request.mock.calls.every(([p])=>p.includes("Evidence pieces: "))).toBe(true);
 });
 test('unknown models do not inherit the Claude allowance',()=>{
  expect(()=>assertHazardPromptFits('x'.repeat(156337),{preferences:{provider:'anthropic',model:'custom-model'}})).toThrow('too large');
 });
 test('UTF-8 size and output reservation are enforced independently of character count',()=>{
  const preferences={provider:'anthropic',model:'claude-haiku-5-5'};
  expect(()=>assertHazardPromptFits('x'.repeat(167808),{preferences,maxTokens:24000})).not.toThrow();
  expect(()=>assertHazardPromptFits('x'.repeat(167809),{preferences,maxTokens:24000})).toThrow('too large');
  expect(()=>assertHazardPromptFits('界'.repeat(60000),{preferences,maxTokens:24000})).toThrow('too large');
 });
});
