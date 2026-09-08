const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Readable } = require("node:stream");
const {
  anthropicStreamEventValue,
  createRequestCancellation,
  parseAnthropicSseEvent,
  pipeAnthropicSseToClient,
  requestAnthropicMessageStream,
} = require("./anthropicStreaming");

test("parses Anthropic text deltas and maps output-limit completion", () => {
  const delta = parseAnthropicSseEvent([
    "event: content_block_delta",
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
  ].join("\n"));
  assert.deepEqual(anthropicStreamEventValue(delta), { text: "hello" });

  const completion = parseAnthropicSseEvent([
    "event: message_delta",
    'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}',
  ].join("\n"));
  assert.deepEqual(anthropicStreamEventValue(completion), { finishReason: "length" });
});

test("forwards chunked native Anthropic SSE as incremental xHandle SSE", async () => {
  const providerStream = Readable.from([
    "event: message_start\ndata: {\"type\":\"message_start\"}\n\nevent: content_block_delta\nda",
    "ta: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"first \"}}\n\n",
    "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"second\"}}\n\n",
    "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n",
    "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
  ]);
  const response = new PassThrough();
  let output = "";
  response.on("data", (chunk) => { output += chunk.toString("utf8"); });

  const result = await pipeAnthropicSseToClient(providerStream, response);
  assert.equal(result.finishReason, "stop");
  assert.equal(result.providerDone, true);
  assert.match(output, /data: "first "/);
  assert.match(output, /data: "second"/);
  assert.match(output, /event: metadata\ndata: \{"finish_reason":"stop"\}/);
  assert.match(output, /event: done\ndata: \[DONE\]/);
});

test("rejects an incomplete provider stream instead of silently returning truncated text", async () => {
  const providerStream = Readable.from([
    "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"partial\"}}\n\n",
  ]);
  const response = new PassThrough();
  response.resume();
  await assert.rejects(
    pipeAnthropicSseToClient(providerStream, response),
    /ended before message_stop/,
  );
});

test("preserves compatibility retries when starting an Anthropic stream", async () => {
  const calls = [];
  const axiosClient = {
    post: async (_url, payload, config) => {
      calls.push({ payload, config });
      if (calls.length === 1) {
        return {
          status: 400,
          data: Readable.from(['{"error":{"message":"temperature is deprecated for this model"}}']),
        };
      }
      return { status: 200, data: Readable.from([]) };
    },
  };
  const executeWithCompatibility = async (create, initialPayload) => {
    try {
      return await create(initialPayload);
    } catch (error) {
      const retryPayload = { ...initialPayload };
      delete retryPayload.temperature;
      return create(retryPayload);
    }
  };
  const signal = new AbortController().signal;

  const response = await requestAnthropicMessageStream({
    axiosClient,
    apiKey: "test-key",
    payload: { model: "claude-test", max_tokens: 100, temperature: 0 },
    timeoutMs: 300_000,
    signal,
    executeWithCompatibility,
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.stream, true);
  assert.equal(calls[1].payload.temperature, undefined);
  assert.equal(calls[1].config.signal, signal);
  assert.equal(calls[1].config.timeout, 300_000);
  assert.equal(calls[1].config.responseType, "stream");
});

test("aborts the upstream request when the browser connection closes", () => {
  const request = new EventEmitter();
  const response = new EventEmitter();
  response.writableEnded = false;
  const cancellation = createRequestCancellation(request, response);

  response.emit("close");
  assert.equal(cancellation.signal.aborted, true);
  cancellation.dispose();
});

test("enforces an absolute request deadline even when transport activity continues", async () => {
  const request = new EventEmitter();
  const response = new EventEmitter();
  response.writableEnded = false;
  const cancellation = createRequestCancellation(request, response, { timeoutMs: 5 });

  await new Promise((resolve) => cancellation.signal.addEventListener("abort", resolve, { once: true }));
  assert.equal(cancellation.signal.aborted, true);
  assert.equal(cancellation.timedOut, true);
  assert.match(String(cancellation.signal.reason?.message), /provider_request_timed_out/);
  cancellation.dispose();
});
