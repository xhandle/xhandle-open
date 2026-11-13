const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClaudeRequestPayload } = require('./aiProviderPayloads');
const { claudeRecoveryPayload, claudeResponseText } = require('./claudeResponseRecovery');
const models = ['claude-haiku-5-5','claude-sonnet-5','claude-sonnet-5-5','claude-opus-5','claude-opus-5-5','claude-fable-5-1','claude-opus-4-5','claude-opus-4-6','claude-opus-4-7','claude-sonnet-4-6'];

for (const model of models) for (const effort of ['low','medium','high']) test(`${model} ${effort}: answer space, native parameters and bounded empty recovery`, () => {
  const body = { max_tokens:2400, effort, xhandleWorkflow:'collaborator.functional', temperature:0, top_p:0.1, top_k:3 };
  const payload = buildClaudeRequestPayload({ body, model, conversation:[{role:'user',content:'Generate a decomposition.'}] });
  assert.equal(payload.model, model);
  assert.deepEqual(payload.output_config,{effort});
  assert.ok(payload.max_tokens > 2400 && payload.max_tokens <= 64000);
  assert.equal(payload.temperature,undefined);assert.equal(payload.top_p,undefined);assert.equal(payload.top_k,undefined);
  if (model === 'claude-opus-4-5') assert.ok(payload.thinking.budget_tokens < payload.max_tokens);
  else assert.deepEqual(payload.thinking,{type:'adaptive'});
  const recovered = claudeRecoveryPayload(payload,{body,finishReason:'length',hasText:false});
  assert.equal(recovered.model,model);assert.deepEqual(recovered.output_config,{effort});
  assert.ok(recovered.max_tokens > payload.max_tokens && recovered.max_tokens <= 64000);
  assert.equal(claudeRecoveryPayload(recovered,{body,finishReason:'length',hasText:false,attempt:1}),null);
});

test('does not retry visible output, refusals, context limits, tools, unknown completion or unrelated workflows', () => {
  const body = {max_tokens:2400,effort:'high',xhandleWorkflow:'collaborator.answer'};
  const payload = buildClaudeRequestPayload({body,model:'claude-haiku-5-5'});
  assert.equal(claudeRecoveryPayload(payload,{body,finishReason:'length',hasText:true}),null);
  for (const finishReason of ['refusal','model_context_window_exceeded','tool_calls','pause_turn','unknown']) assert.equal(claudeRecoveryPayload(payload,{body,finishReason,hasText:false}),null);
  assert.equal(claudeRecoveryPayload(payload,{body:{...body,xhandleWorkflow:'hazard-analysis'},finishReason:'length',hasText:false}),null);
  assert.equal(claudeRecoveryPayload({...payload,max_tokens:64000},{body,finishReason:'length',hasText:false}),null);
  assert.equal(claudeRecoveryPayload({...payload,model:'claude-opus-4-1',max_tokens:30000},{body,finishReason:'length',hasText:false}).max_tokens,32000);
});

test('empty end_turn adds a real instruction without empty assistant history or corrupting native image blocks', () => {
  const body = {max_tokens:2400,effort:'medium',xhandleWorkflow:'collaborator.request'};
  const payload = buildClaudeRequestPayload({body,model:'claude-haiku-5-5',conversation:[{role:'user',content:[{type:'text',text:'Inspect image.'},{type:'image_url',image_url:{url:'data:image/png;base64,aGVsbG8='}}]}]});
  const snapshot = JSON.stringify(payload);
  const recovered = claudeRecoveryPayload(payload,{body,finishReason:'stop',hasText:false});
  assert.equal(JSON.stringify(payload),snapshot);
  assert.deepEqual(recovered.messages[0].content.slice(0,2),payload.messages[0].content);
  assert.match(recovered.messages[0].content.at(-1).text,/Complete the user/);
  assert.equal(recovered.max_tokens,payload.max_tokens);
  assert.equal(recovered.messages.some(message=>message.role==='assistant'),false);
});

test('legacy Haiku stays a normal nonthinking request and only text blocks count as visible output', () => {
  const payload = buildClaudeRequestPayload({body:{max_tokens:1800,effort:'high',xhandleWorkflow:'collaborator.answer'},model:'claude-haiku-4-5'});
  assert.equal(payload.max_tokens,1800);assert.equal(payload.thinking,undefined);assert.equal(payload.output_config,undefined);
  assert.equal(claudeResponseText({content:[{type:'thinking',thinking:'PRIVATE_THOUGHT'},{type:'text',text:'Visible answer'}]}),'Visible answer');
});
