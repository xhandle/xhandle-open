// Appended to the Stage 3 native fixture, retaining its real worker and 27,125-row checks.
const {clearWorkspaceReadCache}=require('__REPO__/src/features/workspace-graph/workspaceReadClient.ts');
const {requestCollaboratorChat,addCollaboratorMetadata}=require('__REPO__/src/features/collaborator-performance/chatTransport.js');
const {createCollaboratorPerformanceTrace,getCollaboratorPerformanceReports}=require('__REPO__/src/features/collaborator-performance/performanceTrace.js');
const stage3Audit=window.audit;
window.audit=async()=>{
 const result=await stage3Audit();
 const policy={projectIds:['p0'],projects:[{id:'p0',repos:[]}],types:['requirement'],repoId:null,historyAllowed:false,query:'requirements'};
 const call=[{operation:'aggregate',limit:2}];clearWorkspaceReadCache();
 const timings=[];
 await executeWorkspaceReadPlan(call,policy,{timeoutMs:12000,onTiming:value=>timings.push(value)});
 await executeWorkspaceReadPlan(call,policy,{timeoutMs:12000,onTiming:value=>timings.push(value)});
 assert(timings[1].cacheHit,'Repeated complete read missed cache');
 await repo.upsertArtifact({id:'stage4-new',projectId:'p0',type:'requirement',title:'New requirement',createdAt:'2026-11-04',updatedAt:'2026-11-04'});
 const changed=await executeWorkspaceReadPlan(call,policy,{timeoutMs:12000,onTiming:value=>timings.push(value)});
 assert(changed[0].count===27126&&!timings[2].cacheHit,'Graph revision failed to invalidate count');
 const trace=createCollaboratorPerformanceTrace(),encoder=new TextEncoder();
 let requestCount=0,providerComplete=false,firstOutputMs,completeMs,cancelled=false;
 const started=performance.now();
 const response=await requestCollaboratorChat([{role:'user',content:'SYNTHETIC_PRIVATE_QUESTION'}],{
  trace,buildPayload:(messages,options)=>addCollaboratorMetadata({messages,stream:options.stream,effort:'high'},options),
  fetchImpl:async(_url,options)=>{
   requestCount++;const sent=JSON.parse(options.body);assert(sent.xhandleTraceId===trace.traceId&&sent.effort==='high','Lost trace or preference');
   let timers=[];
   return new Response(new ReadableStream({start(controller){
    timers.push(setTimeout(()=>controller.enqueue(encoder.encode('data: "First α🙂 "\n\n')),30));
    timers.push(setTimeout(()=>{providerComplete=true;controller.enqueue(encoder.encode('data: "answer"\n\nevent: metadata\ndata: {"finish_reason":"stop","serverTiming":{"elapsedMs":150,"timeToFirstTokenMs":30}}\n\nevent: done\ndata: [DONE]\n\n'));controller.close();},150));
   },cancel(){cancelled=true;timers.forEach(clearTimeout);}}),{headers:{'content-type':'text/event-stream','x-ai-request-id':'synthetic-request','x-ai-provider-used':'gemini','x-ai-model-used':'gemini-synthetic','x-ai-effort-used':'high'}});
  },onToken:()=>{if(firstOutputMs==null){firstOutputMs=performance.now()-started;assert(!providerComplete,'Buffered answer');trace.mark('firstVisibleAnswer');}},
 });
 completeMs=performance.now()-started;trace.finish();
 assert(response.text==='First α🙂 answer'&&requestCount===1,'Stream text/replay mismatch');
 const reports=getCollaboratorPerformanceReports();assert(!JSON.stringify(reports).includes('SYNTHETIC_PRIVATE'),'Telemetry leaked question');
 const controller=new AbortController();let lateTokens=0;
 const stopped=requestCollaboratorChat([],{signal:controller.signal,buildPayload:()=>({stream:true}),fetchImpl:async()=>new Response(new ReadableStream({start(){},cancel(){cancelled=true;}})),onToken:()=>lateTokens++});
 await new Promise(resolve=>setTimeout(resolve,20));controller.abort();let aborted=false;try{await stopped;}catch(error){aborted=error.name==='AbortError';}
 assert(aborted&&cancelled&&lateTokens===0,'Stop failed to cancel pending native stream');
 result.stage4={readTimings:timings,firstOutputMs:Math.round(firstOutputMs),completeMs:Math.round(completeMs),requests:requestCount,correlatedTiming:reports.at(-1).requests[0].server,cancellationPassed:true};
 return result;
};
