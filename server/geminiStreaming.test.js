const test=require('node:test'),assert=require('node:assert/strict');
const {PassThrough,Readable}=require('node:stream');
const {geminiStreamEventValue,requestGeminiMessageStream,pipeGeminiSseToClient}=require('./geminiStreaming');
const frame=value=>'data: '+JSON.stringify(value)+'\n\n';
const token=(text,extra={})=>({candidates:[{index:0,content:{parts:[{text}]},...extra}]});
test('streams visible text before completion and keeps provider thoughts private',async()=>{
 const upstream=new PassThrough(),output=new PassThrough();let data='';output.on('data',chunk=>{data+=chunk;});
 const received=[];const pipe=pipeGeminiSseToClient(upstream,output,{onText:text=>received.push(text)});
 upstream.write(frame({candidates:[{content:{parts:[{text:'PRIVATE_THOUGHT',thought:true},{text:'first '}]}}]}));
 await new Promise(resolve=>setImmediate(resolve));assert.match(data,/first/);assert.doesNotMatch(data,/PRIVATE/);assert.equal(output.writableEnded,false);
 upstream.end(frame(token('second',{finishReason:'MAX_TOKENS'})));
 const result=await pipe;assert.equal(result.finishReason,'length');assert.deepEqual(received,['first ','second']);assert.match(data,/\[DONE\]/);
});
test('preserves UTF-8 across transport chunk boundaries and parses comment-prefixed frames',async()=>{
 const encoded=Buffer.from(': keepalive\n'+frame(token('α🙂',{finishReason:'STOP'})));const pos=encoded.indexOf(Buffer.from('🙂'));
 const upstream=Readable.from([encoded.subarray(0,pos+1),encoded.subarray(pos+1,pos+3),encoded.subarray(pos+3)]),output=new PassThrough();let text='';output.on('data',chunk=>{text+=chunk;});
 await pipeGeminiSseToClient(upstream,output);assert.match(text,/α🙂/);assert.doesNotMatch(text,/�/);
});
test('rejects malformed, blocked and prematurely ended streams instead of reporting success',async()=>{
 for(const data of ['data: {broken}\n\n',frame(token('partial')),frame({promptFeedback:{blockReason:'SAFETY'}})]){
  const output=new PassThrough();output.resume();await assert.rejects(pipeGeminiSseToClient(Readable.from([data]),output));assert.equal(output.writableEnded,false);
 }
 assert.throws(()=>geminiStreamEventValue({data:{candidates:[{finishReason:'SAFETY'}]}}));
});
test('starts the streaming endpoint with unchanged generation settings and cancellation signal',async()=>{
 let captured;const controller=new AbortController();const payload={contents:[],generationConfig:{thinkingConfig:{thinkingLevel:'high'},maxOutputTokens:123}};
 const response=await requestGeminiMessageStream({axiosClient:{post:async(...args)=>{captured=args;return {status:200,data:Readable.from([])};}},apiKey:'PRIVATE_KEY',payload,model:'gemini-test',timeoutMs:300000,signal:controller.signal});
 assert.equal(response.status,200);assert.match(captured[0],/:streamGenerateContent\?alt=sse$/);assert.deepEqual(captured[1],payload);assert.equal(captured[2].signal,controller.signal);assert.equal(captured[2].responseType,'stream');assert.doesNotMatch(captured[0],/PRIVATE_KEY/);
});
test('failed starts destroy the error body without exposing provider credentials or text',async()=>{
 const stream=Readable.from(['PRIVATE_PROVIDER_MESSAGE']);await assert.rejects(requestGeminiMessageStream({axiosClient:{post:async()=>({status:401,data:stream})},payload:{},model:'model',apiKey:'secret'}),error=>error.response.status===401&&!String(error).includes('PRIVATE'));
 assert.equal(stream.destroyed,true);
});
