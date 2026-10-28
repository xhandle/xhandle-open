import {beginHazardLoadDiagnostic} from './hazardLoadDiagnostics';
test('keeps only eight metadata-only traces with phase timings and progress',()=>{
 window.__xhandleHazardLoadDiagnostics=[];
 for(let i=0;i<12;i++){
  const trace=beginHazardLoadDiagnostic();trace.phase('hydrate-and-verify');trace.progress({completed:8,total:20});trace.finish('complete');
 }
 expect(window.__xhandleHazardLoadDiagnostics).toHaveLength(8);
 const last=window.__xhandleHazardLoadDiagnostics[7];
 expect(last).toMatchObject({status:'complete',chunksRead:8,chunksTotal:20,phase:'finished'});
 expect(last.phases.map(p=>p.name)).toEqual(['open-storage','hydrate-and-verify']);
 expect(last.elapsedMs).toBeGreaterThanOrEqual(0);
});
