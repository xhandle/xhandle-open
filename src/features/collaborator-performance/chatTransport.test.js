import {TextEncoder,TextDecoder} from 'util';
import {requestCollaboratorChat,addCollaboratorMetadata} from './chatTransport';
import {createCollaboratorPerformanceTrace,getCollaboratorPerformanceReports,clearCollaboratorPerformanceReports} from './performanceTrace';
import {scheduleIdleTitle} from './titleScheduler';
beforeAll(()=>Object.assign(global,{TextEncoder,TextDecoder}));
afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();clearCollaboratorPerformanceReports();});
const payload=(messages,options)=>addCollaboratorMetadata({messages,stream:options.stream,max_tokens:options.maxTokens,effort:'high'},options);
function response(chunks,headers={}){let i=0;return {ok:true,headers:{get:name=>headers[name]||null},body:{getReader:()=>({read:async()=>i<chunks.length?{value:Buffer.from(chunks[i++]),done:false}:{done:true},cancel:async()=>{},releaseLock:()=>{}})}};}
const send=(fetchImpl,options={})=>requestCollaboratorChat([{role:'user',content:'PRIVATE_PROMPT'}],{fetchImpl,buildPayload:payload,...options});
test('forwards incremental text, metadata and matching trace IDs without storing prompt/response text',async()=>{
 const trace=createCollaboratorPerformanceTrace(),tokens=[];
 const fetchImpl=jest.fn(async()=>response(['data: "first "\n\n','data: "PRIVATE_ANSWER"\n\nevent: metadata\ndata: {"finish_reason":"stop","serverTiming":{"elapsedMs":100,"timeToFirstTokenMs":20,"secret":"PRIVATE_SECRET"}}\n\nevent: done\ndata: [DONE]\n\n'],{'x-ai-request-id':'server-1','x-ai-provider-used':'gemini','x-ai-model-used':'gemini-test','x-ai-effort-used':'high'}));
 const result=await send(fetchImpl,{trace,workflow:'collaborator.answer',onToken:token=>tokens.push(token)});trace.finish();
 expect(result.text).toBe('first PRIVATE_ANSWER');expect(tokens).toEqual(['first ','PRIVATE_ANSWER']);expect(fetchImpl).toHaveBeenCalledTimes(1);
 const sent=JSON.parse(fetchImpl.mock.calls[0][1].body);expect(sent.xhandleTraceId).toBe(trace.traceId);expect(sent.effort).toBe('high');
 const reports=getCollaboratorPerformanceReports();expect(reports[0].requests[0]).toMatchObject({requestId:'server-1',provider:'gemini',model:'gemini-test',effort:'high',server:{elapsedMs:100,timeToFirstTokenMs:20}});expect(JSON.stringify(reports)).not.toMatch(/PRIVATE_/);
});
test('HTTP failures and non-streaming compatibility responses never replay the provider request',async()=>{
 const failed=jest.fn(async()=>({ok:false,status:400,headers:{get:()=>null},clone:()=>({json:async()=>({error:'invalid request'})})}));
 await expect(send(failed)).rejects.toThrow(/invalid request/);expect(failed).toHaveBeenCalledTimes(1);
 const fallback=jest.fn(async()=>({ok:true,headers:{get:name=>name==='content-type'?'application/json':null},json:async()=>({choices:[{message:{content:'Buffered answer'},finish_reason:'stop'}]})}));
 expect((await send(fallback)).text).toBe('Buffered answer');expect(fallback).toHaveBeenCalledTimes(1);
});
test('rejects malformed, empty, truncated and oversized SSE instead of treating them as success',async()=>{
 for(const frame of ['data: {broken}\n\n','data: "partial"\n\n','event: done\ndata: [DONE]\n\n','data: "'+('x'.repeat(1024*1024))+'"\n\n'])await expect(send(async()=>response([frame]))).rejects.toThrow();
});
test('decodes split UTF-8 and multiline JSON SSE events',async()=>{
 const bytes=Buffer.from('data: {"token":\ndata: "α🙂"}\n\nevent: done\ndata: [DONE]\n\n');const index=bytes.indexOf(Buffer.from('🙂'));let i=0;const chunks=[bytes.subarray(0,index+1),bytes.subarray(index+1)];
 const result=await send(async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>i<chunks.length?{value:chunks[i++],done:false}:{done:true},cancel:async()=>{}})}}));expect(result.text).toBe('α🙂');
});
test('stop cancels the active reader and prevents late tokens',async()=>{
 const controller=new AbortController(),tokens=[];let release;
 const cancel=jest.fn(async()=>release?.({done:true}));
 const promise=send(async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:()=>new Promise(resolve=>{release=resolve;}),cancel,releaseLock:()=>{}})}}),{signal:controller.signal,onToken:value=>tokens.push(value)});
 for(let i=0;i<4;i++)await Promise.resolve();controller.abort();await expect(promise).rejects.toHaveProperty('name','AbortError');expect(cancel).toHaveBeenCalled();expect(tokens).toEqual([]);
});
test('traces are bounded and ignore arbitrary text/timing fields',async()=>{
 const clock={tick:0};
 for(let i=0;i<35;i++){const trace=createCollaboratorPerformanceTrace({now:()=>clock.tick});trace.mark('firstProgress');clock.tick+=10;await trace.measure('context',async()=>{clock.tick+=5;});trace.timing({stage:'PRIVATE_STAGE',durationMs:2});trace.finish('completed');trace.finish();}
 const reports=getCollaboratorPerformanceReports();expect(reports).toHaveLength(30);expect(reports[0].durations.context).toBe(5);expect(JSON.stringify(reports)).not.toContain('PRIVATE_STAGE');
});
test('background titles wait for idle, cancel active work and cannot overwrite after cancellation',async()=>{
 jest.useFakeTimers();const generate=jest.fn(async()=> 'Title'),onTitle=jest.fn();
 const busy=scheduleIdleTitle({busy:true,generate,onTitle});jest.advanceTimersByTime(1000);expect(generate).not.toHaveBeenCalled();busy();
 const cancel=scheduleIdleTitle({busy:false,generate,onTitle});jest.advanceTimersByTime(499);expect(generate).not.toHaveBeenCalled();cancel();jest.advanceTimersByTime(1);expect(generate).not.toHaveBeenCalled();
 let resolve;const pending=jest.fn(signal=>new Promise(done=>{resolve=done;expect(signal.aborted).toBe(false);}));
 const stop=scheduleIdleTitle({busy:false,generate:pending,onTitle});jest.advanceTimersByTime(500);stop();resolve('Late title');await Promise.resolve();await Promise.resolve();expect(onTitle).not.toHaveBeenCalled();
});

test('structured-response continuation preserves whitespace inside an unfinished JSON string',async()=>{
 const fragment='{"kind":"answer","text":"Hello ';
 const result=await send(async()=>response(['data: '+JSON.stringify(fragment)+'\n\nevent: metadata\ndata: {"finish_reason":"length"}\n\nevent: done\ndata: [DONE]\n\n']),{preserveWhitespace:true});
 expect(result.text).toBe(fragment);expect(result.finishReason).toBe('length');
});
