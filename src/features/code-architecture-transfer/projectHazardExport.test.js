import { webcrypto } from 'crypto';
import { exportHazardRun } from './projectHazardExport';
import { chunkHazardRun } from '../code-architecture-hazard-analysis/hazardRunChunks';
import { createValueAssembler } from './archiveValueStream';
import { createHazardChunkIntegrityCheck } from './hazardChunkIntegrity';
import { readTransferTransaction } from './transferDatabase';
jest.mock('./transferDatabase',()=>({readTransferTransaction:jest.fn()}));
beforeAll(()=>Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true}));
const run=()=>({id:'h1',projectId:'p1',repoId:'r1',architectureRowsSnapshot:[{originalArchitectureRow:{content:'source'.repeat(200000)}}],generatedSheets:{hazards:[{id:'HA1',description:'retained'}]},traceabilityMap:{a:{file:'source.cpp'}},pendingAttempt:{completed:['HA1']},userPreprocessing:{context:'retained'},runState:'partial'});
test.each([false,true])('export drops only the unused duplicate snapshot (chunked=%s)',async chunked=>{
 const original=run();let root=original;const pages=new Map();
 if(chunked) for await(const e of chunkHazardRun(original)){if(e.chunk)pages.set(e.chunk.id,e.chunk);else root=e.run;}
 readTransferTransaction.mockImplementation((db,store,read)=>read({get:key=>pages.get(key)}));
 const assembler=createValueAssembler(),integrity=createHazardChunkIntegrityCheck();let result,bytes=0;
 for await(const e of exportHazardRun({},root)) {
  bytes+=JSON.stringify(e).length;
  if(e.chunk){integrity.add({kind:'record',db:'xhandle-code-architecture-hazard-analysis',store:'hazardRunChunks',key:e.chunk.id,value:e.chunk});for(const t of e.chunk.tokens)assembler.add(t);}
  else {integrity.add({kind:'record',db:'xhandle-code-architecture-hazard-analysis',store:'hazardAnalysisRuns',key:e.run.id,value:e.run});result=e.run.payload?assembler.finish():e.run;}
 }
 integrity.finish();
 const {architectureRowsSnapshot,...expected}=original;
 expect(result).toEqual(expected);expect(bytes).toBeLessThan(10000);
 expect(original.architectureRowsSnapshot[0].originalArchitectureRow.content.length).toBe(1200000);
});
test('corruption in omitted snapshot still fails integrity validation',async()=>{
 const pages=new Map();let root;
 for await(const e of chunkHazardRun(run())){if(e.chunk)pages.set(e.chunk.id,e.chunk);else root=e.run;}
 const page=[...pages.values()].find(p=>p.tokens.some(t=>t[0]==='text'&&t[1].startsWith('sourcesource')));
 page.tokens.find(t=>t[0]==='text'&&t[1].startsWith('sourcesource'))[1]='changed';
 readTransferTransaction.mockImplementation((db,store,read)=>read({get:key=>pages.get(key)}));
 await expect((async()=>{for await(const e of exportHazardRun({},root)){void e;}})()).rejects.toThrow(/checksum/);
});
