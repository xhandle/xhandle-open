// Disposable synthetic provider fixture. No external requests or real keys.
const assert = require('node:assert/strict');
const {PassThrough} = require('node:stream');
const root = require('node:path').resolve(__dirname, '../../..');
const fromApp = require('node:module').createRequire(root + '/server.js');
const axios = fromApp('axios');
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
  assert.match(url, /^https:\/\/(generativelanguage.googleapis.com|api.anthropic.com)\//);
  calls.push({url, payload});
  const stream = new PassThrough();
  options.signal.addEventListener('abort', () => {upstreamAborts++;stream.destroy();}, {once:true});
  const gemini = url.includes('googleapis');
  const mode = JSON.stringify(payload).includes('TRUNCATE_FIXTURE') ? 'truncate' : 'normal';
  (async () => {
    await sleep(25);
    if (stream.destroyed) return;
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
const app = require(root + '/server.js');
const server = app.listen(0, '127.0.0.1', async () => {
  const output = [];
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/chat';
    for (const [provider, model] of [['gemini','gemini-synthetic'],['claude','claude-synthetic'],['openai','gpt-5']]) {
      providerFinished = false;
      const before = calls.length, start = performance.now();
      const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json','x-ai-provider':provider,'x-ai-api-key':'synthetic-local-key','x-ai-model':model,'x-ai-effort':'high'},body:JSON.stringify({stream:true,messages:[{role:'user',content:'PRIVATE_PROMPT'}],max_tokens:500,xhandleWorkflow:'collaborator.answer',xhandleTraceId:'ct-route-synthetic-12345'})});
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
      output.push({provider,firstOutputMs:Math.round(firstMs),completeMs:Math.round(performance.now()-start),serverTiming:metadata.serverTiming});
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
    process.send?.({ok:true,output});
  } catch (error) {process.send?.({ok:false,error:error.stack});process.exitCode=1;}
  finally {server.closeAllConnections();server.close(() => process.exit(process.exitCode || 0));}
});
