// Disposable synthetic provider fixture. No external requests or real keys.
const assert = require('node:assert/strict');
const {PassThrough} = require('node:stream');
const root = require('node:path').resolve(__dirname, '../../..');
const fromApp = require('node:module').createRequire(root + '/server.js');
const axios = fromApp('axios');
// This disposable process sends a capability matrix above the normal 60/min
// limit. Preserve the real limiter with a fixture-only allowance; production
// rate limiting remains unchanged.
const realRateLimit = fromApp('express-rate-limit');
require.cache[fromApp.resolve('express-rate-limit')] = {exports:options=>realRateLimit({...options,max:1000})};
// Fail closed even if provider module resolution changes.
for (const protocol of ['node:http','node:https']) {
  const network = require(protocol), original = network.request;
  network.request = function (...args) {
    const target = args[0];const host = typeof target === 'string' ? new URL(target).hostname : target?.hostname || target?.host;
    assert.ok(['127.0.0.1','localhost','::1'].includes(host), 'External requests blocked in fixture');
    return original.apply(this,args);
  };
}
const calls = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = data => 'data: ' + JSON.stringify(data) + '\n\n';
let providerFinished = false;
let upstreamAborts = 0;
axios.post = async (url, payload, options) => {
  if(url==='https://api.openai.com/v1/realtime/client_secrets'){calls.push({url,payload});return {status:200,data:{value:'synthetic-client-token'}};}
  assert.match(url, /^https:\/\/(generativelanguage.googleapis.com|api.anthropic.com)\//);
  calls.push({url, payload});
  const serialized = JSON.stringify(payload.messages || []);
  const scenario = serialized.match(/CLAUDE_(EMPTY_LIMIT|EMPTY_END|EMPTY_ALWAYS|PARTIAL_LIMIT|HTTP_FAILURE)_FIXTURE_[a-z0-9-]+/)?.[0];
  const attempt = scenario ? calls.filter(call => JSON.stringify(call.payload.messages || []).includes(scenario)).length : 1;
  if (scenario?.includes('HTTP_FAILURE')) {
    const data = {error:{message:'Synthetic provider error'}};
    if (payload.stream) return {status:400,data:require('node:stream').Readable.from([JSON.stringify(data)])};
    throw Object.assign(new Error(data.error.message),{response:{status:400,data}});
  }
  const empty = !!scenario && !scenario.includes('PARTIAL') && (attempt===1 || scenario.includes('EMPTY_ALWAYS'));
  const scenarioReason = empty ? scenario.includes('EMPTY_END') ? 'end_turn' : 'max_tokens' : scenario?.includes('PARTIAL') ? 'max_tokens' : 'end_turn';
  const haikuRefusal = url.includes('anthropic.com') && JSON.stringify(payload).includes('HAIKU_REFUSAL_FIXTURE');
  if (haikuRefusal && !payload.stream) return {status:200,data:{model:'claude-haiku-5-5',content:[],stop_reason:'refusal'}};
  if (url.includes('anthropic.com') && !payload.stream) return {status:200,data:{model:payload.model,content:empty ? [{type:'thinking',thinking:'PRIVATE_THINKING',signature:'PRIVATE_SIGNATURE'}] : [{type:'text',text:scenario ? 'Recovered answer.' : 'first α🙂 last'}],stop_reason:scenarioReason}};
  const stream = new PassThrough();
  options.signal.addEventListener('abort', () => {upstreamAborts++;stream.destroy();}, {once:true});
  const gemini = url.includes('googleapis');
  const mode = JSON.stringify(payload).includes('TRUNCATE_FIXTURE') ? 'truncate' : 'normal';
  (async () => {
    await sleep(serialized.includes('CANCEL_EMPTY_FIXTURE') ? 250 : 25);
    if (stream.destroyed) return;
    if (haikuRefusal) {
      stream.end('event: message_delta\n' + frame({type:'message_delta',delta:{stop_reason:'refusal'}}) + 'event: message_stop\n' + frame({type:'message_stop'}));
      return;
    }
    if (scenario) {
      stream.end('event: content_block_delta\n' + frame(empty ? {type:'content_block_delta',delta:{type:'thinking_delta',thinking:'PRIVATE_THINKING'}} : {type:'content_block_delta',delta:{type:'text_delta',text:'Recovered answer.'}}) + 'event: message_delta\n' + frame({type:'message_delta',delta:{stop_reason:scenarioReason}}) + 'event: message_stop\n' + frame({type:'message_stop'}));
      return;
    }
    stream.write(gemini
      ? frame({candidates:[{content:{parts:[{thought:true,text:'PRIVATE_THOUGHT'},{text:'first α🙂 '}]}}]})
      : 'event: content_block_delta\n' + frame({type:'content_block_delta',delta:{type:'text_delta',text:'first α🙂 '}}));
    await sleep(120);
    if (stream.destroyed) return;
    providerFinished = true;
    stream.end(mode === 'truncate' ? '' : gemini
      ? frame({candidates:[{content:{parts:[{text:'last'}]},finishReason:'STOP'}]})
      : 'event: message_delta\n' + frame({type:'message_delta',delta:{stop_reason:'end_turn'}}) + 'event: message_stop\n' + frame({type:'message_stop'}));
  })().catch(error => stream.destroy(error));
  return {status:200,data:stream};
};
class MockOpenAI {
  constructor() {
    this.chat = {completions:{create:async (payload, options) => {
      calls.push({url:'mock:openai',payload});
      if(!payload.stream)return {choices:[{message:{content:'first α🙂 last'},finish_reason:'stop'}]};
      return (async function* () {
        await sleep(25); if (options.signal.aborted) return;
        yield {choices:[{delta:{content:'first α🙂 '}}]};
        await sleep(120); if (options.signal.aborted) return;
        providerFinished = true;
        if (!JSON.stringify(payload).includes('TRUNCATE_FIXTURE')) yield {choices:[{delta:{content:'last'},finish_reason:'stop'}]};
      })();
    }}};
  }
}
require.cache[fromApp.resolve('openai')] = {exports:{OpenAI:MockOpenAI}};
const {ORGANIZATION_CONTEXT_HEADER,ORGANIZATION_CONTEXT_VERSION,ORGANIZATION_CONTEXT_GUIDANCE}=require(root+'/src/lib/organizationPromptPolicy');
const profileMarker='ORGANIZATION_PROFILE_DELIVERY_FIXTURE';
const profileHeader=Buffer.from(`${ORGANIZATION_CONTEXT_VERSION}\norg-v1:fixture\n${ORGANIZATION_CONTEXT_GUIDANCE}\n${profileMarker}: use customer terminology.`).toString('base64');
const app = require(root + '/server.js');
const server = app.listen(0, '127.0.0.1', async () => {
  const output = [];
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/chat';
    const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:'http://localhost:3000','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':ORGANIZATION_CONTEXT_HEADER}});
    assert.equal(preflight.status,204);assert.ok(preflight.headers.get('access-control-allow-headers').toLowerCase().includes(ORGANIZATION_CONTEXT_HEADER));
    for(const mode of ['wizard','collaborator']){
      const response=await fetch(url.replace('/api/chat','/api/rt/session'),{method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':'openai','x-ai-api-key':'synthetic-local-key',[ORGANIZATION_CONTEXT_HEADER]:profileHeader},body:JSON.stringify({mode})});
      assert.equal(response.status,200);assert.equal((await response.json()).value,'synthetic-client-token');
      assert.ok(calls.at(-1).payload.session.instructions.includes(profileMarker),'Realtime session retains organization context');
      if(mode==='collaborator')assert.ok(calls.at(-1).payload.session.instructions.includes('do not answer'));
    }
    for(const enabled of [false,true]){
      const response=await fetch(url.replace('/api/chat','/api/openai'),{method:'POST',headers:{'Content-Type':'application/json','x-ai-api-key':'synthetic-local-key',...(enabled?{[ORGANIZATION_CONTEXT_HEADER]:profileHeader}:{})},body:JSON.stringify({prompt:'Legacy prompt fixture'})});
      assert.equal(response.status,200);assert.equal((await response.json()).result,'first α🙂 last');
      assert.equal(JSON.stringify(calls.at(-1).payload).includes(profileMarker),enabled,'Legacy prompt endpoint follows the global profile setting');
    }

    for (const [provider, model] of [['gemini','gemini-synthetic'],['claude','claude-synthetic'],['openai','gpt-5']]) for (const profileEnabled of [false,true]) {
      providerFinished = false;
      const before = calls.length, start = performance.now();
      const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':provider,'x-ai-api-key':'synthetic-local-key','x-ai-model':model,'x-ai-effort':'high',...(profileEnabled?{[ORGANIZATION_CONTEXT_HEADER]:profileHeader}:{})},body:JSON.stringify({stream:true,messages:[{role:'user',content:'PRIVATE_PROMPT'}],max_tokens:500,xhandleWorkflow:'collaborator.answer',xhandleTraceId:'ct-route-synthetic-12345'})});
      assert.equal(response.status, 200);assert.equal(response.headers.get('x-ai-model-used'),model);assert.equal(response.headers.get('x-ai-effort-used'),'high');
      const reader = response.body.getReader(), decoder = new TextDecoder();let text = '', firstMs;
      for (;;) {
        const item = await reader.read();if (item.done) break;
        text += decoder.decode(item.value,{stream:true});
        if (firstMs == null && text.includes('first')) {firstMs = performance.now() - start;assert.equal(providerFinished,false,'Answer was buffered until provider completion');}
      }
      assert.ok(firstMs != null,provider+': '+text);assert.doesNotMatch(text,/PRIVATE_/);assert.match(text,/\[DONE\]/);
      const metadata = text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).find(value => value.serverTiming);
      assert.equal(metadata.serverTiming.clientTraceId,'ct-route-synthetic-12345');assert.equal(metadata.serverTiming.provider,provider);assert.equal(metadata.serverTiming.status,'completed');assert.ok(metadata.serverTiming.providerTimeToFirstTokenMs >= 0);
      assert.equal(calls.length-before,1,'Unexpected provider replay');assert.ok(!JSON.stringify(calls.at(-1).payload).includes('xhandleTraceId'));
      assert.equal(JSON.stringify(calls.at(-1).payload).includes(profileMarker),profileEnabled,'Enabled context reaches the actual provider adapter exactly once');
      if(profileEnabled)assert.equal(JSON.stringify(calls.at(-1).payload).split(profileMarker).length-1,1);
      output.push({provider,profileEnabled,firstOutputMs:Math.round(firstMs),completeMs:Math.round(performance.now()-start),serverTiming:metadata.serverTiming});
    }
    // Both real route variants must retain an empty Haiku refusal; collapsing
    // it to "stop" is what previously hid its cause in the renderer.
    for (const stream of [true,false]) {
      const before = calls.length;
      const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':'claude','x-ai-api-key':'synthetic-local-key','x-ai-model':'claude-haiku-5-5'},body:JSON.stringify({stream,messages:[{role:'user',content:'HAIKU_REFUSAL_FIXTURE'}],max_tokens:16000})});
      assert.equal(response.status,200);
      assert.equal(response.headers.get('x-ai-model-used'),'claude-haiku-5-5');
      if (stream) assert.match(await response.text(),/"finish_reason":"refusal"/);
      else {
        const body = await response.json();
        assert.equal(body.choices[0].finish_reason,'refusal');
        assert.equal(body.choices[0].message.content,'');
      }
      assert.equal(calls.length-before,1,'Haiku refusal must not silently replay a request or change models');
    }
    // An explicit Claude selection must not fall through to an account's
    // active OpenAI key when no Claude key is available.
    const stored = await fetch(url.replace('/api/chat','/api/ai-provider/key'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'openai',apiKey:'sk-synthetic-stored-openai-key',activate:true})});
    assert.equal(stored.status,200);
    const state = await (await fetch(url.replace('/api/chat','/api/ai-provider/status'))).json();
    assert.equal(state.activeProvider,'openai');
    const beforeSelection = calls.length;
    const missingClaude = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':'claude','x-ai-model':'claude-haiku-5-5'},body:JSON.stringify({messages:[{role:'user',content:'Respect explicit Claude selection.'}]})});
    assert.equal(missingClaude.status,401);assert.equal(calls.length,beforeSelection);
    const claudeModels = ['claude-haiku-4-5','claude-haiku-5-5','claude-sonnet-4-6','claude-sonnet-5','claude-sonnet-5-5','claude-opus-4-5','claude-opus-4-6','claude-opus-4-7','claude-opus-5-5','claude-fable-5-1'];
    for (const model of claudeModels) for (const effort of ['low','medium','high']) for (const stream of [true,false]) {
      const before = calls.length;
      const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':'claude','x-ai-api-key':'synthetic-local-key','x-ai-model':model,'x-ai-effort':effort},body:JSON.stringify({stream,max_tokens:1800,xhandleWorkflow:'collaborator.functional',messages:[{role:'user',content:'Create a localization decomposition.'}]})});
      assert.equal(response.status,200);assert.equal(response.headers.get('x-ai-model-used'),model);assert.equal(response.headers.get('x-ai-effort-used'),effort);
      const answer = stream ? await response.text() : JSON.stringify(await response.json());
      assert.match(answer,/first α🙂/);assert.doesNotMatch(answer,/PRIVATE_/);
      assert.equal(calls.length-before,1);
      const sent = calls.at(-1).payload;
      assert.equal(sent.model,model);
      if(model!=='claude-haiku-4-5') {assert.equal(sent.output_config.effort,effort);assert.ok(sent.max_tokens>1800);}
    }
    for (const model of ['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5']) for (const effort of ['low','medium','high']) for (const stream of [true,false]) for (const scenario of ['EMPTY_LIMIT','EMPTY_END']) {
      const before = calls.length;
      const marker = `CLAUDE_${scenario}_FIXTURE_${model}-${effort}-${stream}`;
      const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':'claude','x-ai-api-key':'synthetic-local-key','x-ai-model':model,'x-ai-effort':effort},body:JSON.stringify({stream,max_tokens:1800,xhandleWorkflow:'collaborator.functional',messages:[{role:'user',content:marker}]})});
      const answer = stream ? await response.text() : JSON.stringify(await response.json());
      assert.match(answer,/Recovered answer/);assert.doesNotMatch(answer,/PRIVATE_/);assert.equal(calls.length-before,2);
      const [first,second] = calls.slice(before).map(call=>call.payload);
      assert.equal(second.model,model);assert.equal(second.output_config.effort,effort);
      if(scenario==='EMPTY_LIMIT') assert.ok(second.max_tokens>first.max_tokens);
      else assert.match(JSON.stringify(second.messages),/Complete the user/);
      if(stream) assert.equal((answer.match(/\[DONE\]/g)||[]).length,1);
    }
    for (const stream of [true,false]) for (const scenario of ['EMPTY_ALWAYS','PARTIAL_LIMIT','HTTP_FAILURE']) {
      const before = calls.length;
      const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':'claude','x-ai-api-key':'synthetic-local-key','x-ai-model':'claude-haiku-5-5','x-ai-effort':'high'},body:JSON.stringify({stream,max_tokens:1800,xhandleWorkflow:'collaborator.answer',messages:[{role:'user',content:`CLAUDE_${scenario}_FIXTURE_${stream}`}]})});
      const answer = await response.text();
      assert.equal(calls.length-before,scenario==='EMPTY_ALWAYS'?2:1);
      assert.doesNotMatch(answer,/PRIVATE_/);
      if(scenario==='EMPTY_ALWAYS') {assert.match(answer,/"finish_reason":"length"/);assert.match(answer,/"providerAttempts":2|"provider_attempts":2/);}
    }
    // Premature upstream EOF must surface an error rather than a completed answer.
    for (const provider of ['gemini','claude','openai']) {
      const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':provider,'x-ai-api-key':'synthetic-local-key'},body:JSON.stringify({stream:true,messages:[{role:'user',content:'TRUNCATE_FIXTURE'}]})});
      assert.match(await response.text(),/event: error/,provider);
    }
    const controller = new AbortController(), beforeAbort = upstreamAborts;
    const pending = await fetch(url,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-ai-provider':'gemini','x-ai-api-key':'synthetic-local-key'},body:JSON.stringify({stream:true,messages:[{role:'user',content:'Cancel fixture'}]})});
    const reader = pending.body.getReader();await reader.read();controller.abort();await reader.cancel().catch(()=>{});
    await sleep(60);assert.ok(upstreamAborts > beforeAbort,'Client stop did not reach provider');
    // Cancelling while Claude is thinking must not trigger empty-answer recovery.
    const claudeController = new AbortController(), beforeClaudeAbort = upstreamAborts, beforeClaudeCalls = calls.length;
    const claudePending = await fetch(url,{method:'POST',signal:claudeController.signal,headers:{'Content-Type':'application/json','x-ai-provider':'claude','x-ai-api-key':'synthetic-local-key','x-ai-model':'claude-haiku-5-5','x-ai-effort':'high'},body:JSON.stringify({stream:true,xhandleWorkflow:'collaborator.answer',messages:[{role:'user',content:'CLAUDE_EMPTY_LIMIT_FIXTURE_cancel CANCEL_EMPTY_FIXTURE'}]})});
    const claudeReader = claudePending.body.getReader();await claudeReader.read();claudeController.abort();await claudeReader.cancel().catch(()=>{});
    await sleep(300);assert.ok(upstreamAborts > beforeClaudeAbort,'Claude cancellation did not reach provider');
    assert.equal(calls.length-beforeClaudeCalls,1,'Cancelled Claude request was replayed');
    process.send?.({ok:true,output});
  } catch (error) {process.send?.({ok:false,error:error.stack});process.exitCode=1;}
  finally {server.closeAllConnections();server.close(() => process.exit(process.exitCode || 0));}
});
