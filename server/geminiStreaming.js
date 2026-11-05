const {StringDecoder}=require('node:string_decoder');
const {parseAnthropicSseEvent,writeWithBackpressure}=require('./anthropicStreaming');
const MAX_FRAME=1024*1024;
function geminiStreamEventValue({data}={}){
 if(!data||typeof data!=='object')throw Error('Gemini returned a malformed stream frame.');
 if(data.error)throw Object.assign(Error('Gemini provider stream failed.'),{status:502});
 if(data.promptFeedback?.blockReason)throw Object.assign(Error('Gemini blocked this request.'),{status:422});
 const candidate=(data.candidates||[]).find(item=>item.index===0)||data.candidates?.[0];
 if(!candidate)return {};
 const reason=candidate.finishReason;
 if(reason&&!['STOP','MAX_TOKENS'].includes(reason))throw Object.assign(Error('Gemini stopped without a complete text answer.'),{status:502});
 return {text:(candidate.content?.parts||[]).filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join(''),finishReason:reason==='MAX_TOKENS'?'length':reason==='STOP'?'stop':null};
}
async function requestGeminiMessageStream({axiosClient,apiKey,payload,model,timeoutMs,signal}){
 const response=await axiosClient.post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,payload,{
  headers:{'x-goog-api-key':apiKey,'content-type':'application/json',accept:'text/event-stream'},responseType:'stream',timeout:timeoutMs,signal,validateStatus:()=>true,
 });
 if(response.status>=200&&response.status<300)return response;
 // Error bodies can include prompt/credential text. Do not forward or log them.
 response.data?.destroy?.();
 throw Object.assign(Error(`Gemini request failed (${response.status}).`),{response:{status:response.status,data:{error:{message:`Gemini request failed (${response.status}).`}}}});
}
async function pipeGeminiSseToClient(providerStream,res,{onText,completionMetadata}={}){
 const decoder=new StringDecoder('utf8');let buffer='',finishReason=null;
 const process=async block=>{
  if(!block.trim())return;
  const event=parseAnthropicSseEvent(block);if(event.data==null)return;
  const value=geminiStreamEventValue(event);if(value.finishReason)finishReason=value.finishReason;
  if(value.text){onText?.(value.text);await writeWithBackpressure(res,`data: ${JSON.stringify(value.text)}\n\n`);}
 };
 try{
  for await(const chunk of providerStream){
   if(res.destroyed||res.writableEnded)break;
   buffer+=Buffer.isBuffer(chunk)?decoder.write(chunk):String(chunk);buffer=buffer.replace(/^\uFEFF/,'');const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()||'';
   for(const block of blocks){if(block.length>MAX_FRAME)throw Error('Gemini stream frame exceeded the safe size.');await process(block);}
   if(buffer.length>MAX_FRAME)throw Error('Gemini stream frame exceeded the safe size.');
  }
  buffer+=decoder.end();if(buffer.trim())await process(buffer);
  if(res.destroyed||res.writableEnded)return {clientClosed:true,finishReason};
  if(!finishReason)throw Error('Gemini stream ended before a completion reason.');
  await writeWithBackpressure(res,`event: metadata\ndata: ${JSON.stringify({finish_reason:finishReason,...(completionMetadata?.({finishReason})||{})})}\n\n`);
  await writeWithBackpressure(res,'event: done\ndata: [DONE]\n\n');res.end();return {clientClosed:false,finishReason};
 }finally{if(!providerStream.readableEnded)providerStream.destroy?.();}
}
module.exports={geminiStreamEventValue,requestGeminiMessageStream,pipeGeminiSseToClient};
