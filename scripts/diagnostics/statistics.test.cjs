const {test}=require('node:test'),assert=require('node:assert/strict');
const {median}=require('./statistics.cjs'),{summarizeComparison}=require('./comparisonSummary.cjs');
test('median handles odd, even, zero and negative observations without mutating samples',()=>{
 const values=[7,1,5,3];assert.equal(median(values),4);assert.deepEqual(values,[7,1,5,3]);assert.equal(median([9,1,3]),3);assert.equal(median([0]),0);assert.equal(median([-8,-2]),-5);
 assert.throws(()=>median([]),/finite/);assert.throws(()=>median([1,NaN]),/finite/);
});
test('even comparison groups cannot pass a memory gate by choosing their upper middle observations',()=>{
 const row=(pair,enabled,mib)=>({pair,enabled,count:15000,scrollCount:120,measuredMountedNodes:1504,elapsedMs:100,cpuSeconds:1,rendererRetainedHeapMiB:20,maxEventLoopDelayMs:10,diagram:{rows:1500,wheelEvents:360,p95FrameGapMs:20},nativeMemory:{totalFootprintBytes:mib*1048576,byRole:{Browser:mib*1048576}},nativeBaseline:{totalFootprintBytes:50*1048576,byRole:{Browser:50*1048576}},diagnosticStats:{bytesWritten:enabled?100:0}});
 const cases=[row(0,false,100),row(0,true,850),row(1,true,900),row(1,false,1000)],summary=summarizeComparison(cases);
 assert.deepEqual(summary.medians.nativeFootprintMiB,{disabled:550,enabled:875,delta:325});assert.equal(summary.gates.nativeFootprintIncreaseUnder16MiB,false);
 assert.equal(summary.paired.nativeFootprintMiB.median,325);assert.equal(summary.paired.nativeFootprintMiB.mean,325);assert.ok(summary.paired.nativeFootprintMiB.bootstrap95Mean.every(Number.isFinite));
 assert.throws(()=>summarizeComparison(cases.slice(1)),/complete/);
});
