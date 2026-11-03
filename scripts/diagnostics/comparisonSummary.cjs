const {median}=require('./statistics.cjs');
function summarizeComparison(results){
 const pairIds=[...new Set(results.map(r=>r.pair))].sort((a,b)=>a-b);
 if(!pairIds.length||pairIds.some(pair=>results.filter(r=>r.pair===pair&&r.enabled===true).length!==1||results.filter(r=>r.pair===pair&&r.enabled===false).length!==1))throw Error('Comparison requires complete independent run pairs');
 const fields=['elapsedMs','cpuSeconds','rendererRetainedHeapMiB','maxEventLoopDelayMs'];
 const summary={cases:results.length,workload:{functionalRows:results[0].count,diagramRows:results[0].diagram.rows,mountedNodesAtMeasurement:results.map(r=>r.measuredMountedNodes),scrollUpdates:results[0].scrollCount,wheelEvents:results[0].diagram.wheelEvents},medians:{}};
 for(const key of fields){const off=median(results.filter(r=>!r.enabled).map(r=>r[key])),on=median(results.filter(r=>r.enabled).map(r=>r[key]));summary.medians[key]={disabled:off,enabled:on,delta:on-off,percent:off?(on/off-1)*100:null};}
 for(const [key,get]of [['diagramFrameP95Ms',r=>r.diagram.p95FrameGapMs],['nativeFootprintMiB',r=>r.nativeMemory.totalFootprintBytes/1048576],['diagnosticBytesWritten',r=>r.diagnosticStats.bytesWritten]]){const off=median(results.filter(r=>!r.enabled).map(get)),on=median(results.filter(r=>r.enabled).map(get));summary.medians[key]={disabled:off,enabled:on,delta:on-off};}
 // Resample independent run pairs, not repeated samples inside each process.
 const estimate=get=>{
  const differences=pairIds.map(pair=>get(results.find(r=>r.pair===pair&&r.enabled))-get(results.find(r=>r.pair===pair&&!r.enabled)));
  if(differences.some(n=>!Number.isFinite(n)))return {availability:'unavailable'};
  let seed=81723;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const boot=Array.from({length:20000},()=>differences.reduce(sum=>sum+differences[Math.floor(random()*differences.length)],0)/differences.length).sort((a,b)=>a-b);
  return {differences,mean:differences.reduce((n,v)=>n+v,0)/differences.length,median:median(differences),bootstrap95Mean:[boot[500],boot[19499]]};
 };
 summary.paired={nativeFootprintMiB:estimate(r=>r.nativeMemory.totalFootprintBytes/1048576),nativeWorkloadGrowthMiB:estimate(r=>(r.nativeMemory.totalFootprintBytes-r.nativeBaseline?.totalFootprintBytes)/1048576),roles:{}};
 const roles=[...new Set(results.flatMap(r=>Object.keys(r.nativeMemory.byRole||{})))];
 for(const role of roles)summary.paired.roles[role]={settledMiB:estimate(r=>(r.nativeMemory.byRole?.[role]||0)/1048576),workloadGrowthMiB:estimate(r=>((r.nativeMemory.byRole?.[role]||0)-(r.nativeBaseline?.byRole?.[role]||0))/1048576)};
 summary.gates={elapsedUnderFivePercent:summary.medians.elapsedMs.percent<=5,retainedHeapIncreaseUnder16MiB:summary.medians.rendererRetainedHeapMiB.delta<=16,nativeFootprintIncreaseUnder16MiB:summary.medians.nativeFootprintMiB.delta<=16,frameP95IncreaseUnder5ms:summary.medians.diagramFrameP95Ms.delta<=5};
 return summary;
}
module.exports={summarizeComparison};
