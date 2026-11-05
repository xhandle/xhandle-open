import {collaboratorWorkflow} from './performanceTrace';
const FRAME_LIMIT=1024*1024,OUTPUT_LIMIT=2*1024*1024;
export function extractChatText(payload){if(typeof payload==='string')return payload;return String(payload?.result||payload?.answer||payload?.content||payload?.message||payload?.choices?.[0]?.message?.content||payload?.choices?.[0]?.text||'');}
const tokenFrom=parsed=>typeof parsed==='string'?parsed:String(parsed?.choices?.[0]?.delta?.content||parsed?.delta?.content||parsed?.content||parsed?.token||'');
export async function requestCollaboratorChat(messages,{stream=true,signal,onToken,onStatus,maxTokens=1800,preserveWhitespace=false,workflow=stream?'collaborator.answer':'collaborator.request',trace,buildPayload,authOptions={},fetchImpl=fetch}={}){
 const controller=new AbortController(),started=Date.now();let timeoutMs=310000,timer,timedOut=false,reader;
 const request=trace?.request(workflow);
 const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1,timeoutMs-(Date.now()-started)));};
 const stop=()=>{controller.abort();try{reader?.cancel?.().catch?.(()=>{});}catch{}};
 if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
 const status=value=>{try{onStatus?.(value);}catch{}};
 try{
  arm();if(controller.signal.aborted)throw new DOMException('Request cancelled.','AbortError');status('waiting');
  const payload=buildPayload(messages,{maxTokens,stream,workflow,traceId:trace?.traceId});
  const response=await fetchImpl('/api/chat',{...authOptions,method:'POST',signal:controller.signal,body:JSON.stringify(payload)});
  request?.headers(response.headers);
  const advertised=Number(response.headers?.get?.('x-ai-request-timeout-ms'));if(Number.isFinite(advertised)&&advertised>=60000)timeoutMs=advertised+10000;arm();
  if(!response.ok){let detail='';try{const data=await response.clone().json();if(typeof data.error==='string')detail=': '+data.error;}catch{}throw Error(`assistant_failed_${response.status}${detail}`);}
  const contentType=String(response.headers?.get?.('content-type')||'');
  if(!stream||contentType.includes('application/json')||(!response.body&&response.json)){
   const data=await response.json(),text=extractChatText(data);request?.server(data?.xhandleMetrics);if(controller.signal.aborted)throw new DOMException('Request cancelled.','AbortError');
   if(!text)throw Error('assistant_empty_response');if(text.length>OUTPUT_LIMIT)throw Error('assistant_output_limit');request?.token();if(stream){status('generating');onToken?.(text,text);}request?.finish('completed');return {text,finishReason:data?.choices?.[0]?.finish_reason||'stop'};
  }
  if(!response.body)throw Error('assistant_missing_stream');
  reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',text='',finishReason='',done=false,first=true;
  const event=block=>{
   const lines=block.split(/\r?\n/),name=lines.find(line=>line.startsWith('event:'))?.slice(6).trim();
   const raw=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
   if(!raw||done)return;if(raw.trim()==='[DONE]'){done=true;return;}
   let parsed;try{parsed=JSON.parse(raw);}catch{throw Error('assistant_malformed_stream');}
   if(name==='error')throw Error('assistant_stream_failed: '+String(parsed?.error||parsed?.message||'Provider stream failed'));
   if(parsed?.serverTiming)request?.server(parsed.serverTiming);
   if(parsed?.finish_reason)finishReason=String(parsed.finish_reason);
   const token=tokenFrom(parsed);if(!token)return;
   if(first){first=false;status('generating');}request?.token();text+=token;if(text.length>OUTPUT_LIMIT)throw Error('assistant_output_limit');onToken?.(token,text);
  };
  while(!done){const item=await reader.read();if(controller.signal.aborted)throw new DOMException('Request cancelled.','AbortError');if(item.done)break;buffer+=decoder.decode(item.value,{stream:true});
   const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()||'';for(const block of blocks){if(block.length>FRAME_LIMIT)throw Error('assistant_stream_frame_limit');event(block);}if(buffer.length>FRAME_LIMIT)throw Error('assistant_stream_frame_limit');}
  buffer+=decoder.decode();if(buffer.trim())event(buffer);
  if(!done)throw Error('assistant_incomplete_stream');if(!text.trim())throw Error('assistant_empty_response');
  request?.finish('completed');return {text:preserveWhitespace?text:text.trim(),finishReason:finishReason||'stop'};
 }catch(error){request?.finish(timedOut?'timeout':signal?.aborted?'canceled':'failed');if(timedOut&&!signal?.aborted)throw Error('assistant_stream_timed_out');throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(reader){try{void reader.cancel?.().catch?.(()=>{});reader.releaseLock?.();}catch{}}}
}
export function addCollaboratorMetadata(payload,{workflow,traceId}={}){return {...payload,xhandleWorkflow:collaboratorWorkflow(workflow),...(typeof traceId==='string'&&/^ct-[a-z0-9-]{10,80}$/i.test(traceId)?{xhandleTraceId:traceId}:{})};}
