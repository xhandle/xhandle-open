const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAITransportError } = require('./aiTransportErrors');
for (const code of ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH']) {
  test(`classifies ${code} without exposing request data`, () => {
    const result = classifyAITransportError({ code, config: { apiKey: 'secret' } });
    assert.equal(result.status, 503);
    assert.equal(result.code, 'AI_PROVIDER_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });
}
test('does not turn HTTP errors, cancellation or slow responses into indefinite connectivity waits', () => {
  for (const error of [{ response: { status: 401 }, code: 'ECONNRESET' }, { status: 520 }, { code: 'ERR_CANCELED' }, { code: 'ECONNABORTED' }, new Error('bug')]) {
    assert.equal(classifyAITransportError(error), null);
  }
});

test('chat route returns a structured offline error and handles a subsequent request', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const parser = require('@babel/parser');
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'unambiguous' });
  const fn = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'extractProviderErrorMessage');
  const route = ast.program.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.callee.property?.name === 'post' && n.expression.arguments[0]?.type === 'ArrayExpression'
    && n.expression.arguments[0].elements.some(e => e.value === '/api/chat'));
  const handler = route.expression.arguments.at(-1);
  let failure = Object.assign(new Error('DNS offline'), { code: 'ENOTFOUND' }), disposed = 0;
  const context = { Buffer, ArrayBuffer, AI_PROVIDER_LONG_REQUEST_TIMEOUT_MS: 300000, classifyAITransportError,
    createRequestCancellation: () => ({ signal: { aborted: false }, dispose: () => disposed++ }),
    resolveAIConfigForRequest: async () => ({ provider: 'claude', apiKey: 'fixture', model: 'fixture' }),
    resolveAIRequestEffort: () => null, createAIRequestMetrics: () => ({ addOutput() {}, finish() {} }),
    normalizeAIProvider: x => x, logger: { error() {} },
    callClaudeChat: async () => { if (failure) throw failure; return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }; },
  };
  vm.createContext(context); vm.runInContext(source.slice(fn.start, fn.end), context);
  const run = vm.runInContext(`(${source.slice(handler.start, handler.end)})`, context);
  const send = async () => {
    const result = { status: 200 };
    const response = { set() {}, status(code) { result.status = code; return this; }, json(body) { result.body = body; }, headersSent: false };
    await run({ body: { prompt: 'fixture' }, header: () => 'claude' }, response);
    return result;
  };
  const offline = await send();
  assert.equal(offline.status, 503); assert.equal(offline.body.code, 'AI_PROVIDER_UNAVAILABLE');
  failure = null;
  assert.equal((await send()).status, 200); assert.equal(disposed, 2);
});
