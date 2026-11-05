const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAIRequestMetrics,
  sanitizeWorkflowName,
  summarizeChatInput,
} = require("./aiRequestMetrics");

test("summarizes request size without retaining prompt or image contents", () => {
  const summary = summarizeChatInput([
    { role: "system", content: "abcd" },
    { role: "user", content: [{ type: "text", text: "12345678" }, { type: "image_url", image_url: { url: "secret" } }] },
  ]);
  assert.deepEqual(summary, {
    messageCount: 2,
    inputTextChars: 12,
    approximateInputTokens: 3,
    imageCount: 1,
  });
});

test("normalizes workflow labels for safe structured logs", () => {
  assert.equal(sanitizeWorkflowName(" Hazard Row Generation "), "hazard-row-generation");
  assert.equal(sanitizeWorkflowName(""), "unspecified");
});

test("records timing and output counts without logging response text", () => {
  const lines = [];
  const ticks = [100, 125, 190];
  const metrics = createAIRequestMetrics({
    logger: { info: (line) => lines.push(line) },
    requestId: "req-1",
    workflow: "collaborator",
    provider: "claude",
    model: "claude-sonnet-5",
    effort: "low",
    stream: true,
    messages: [{ role: "user", content: "private prompt" }],
    maxOutputTokens: 100,
    now: () => ticks.shift(),
  });
  metrics.addOutput("private response");
  metrics.finish({ finishReason: "stop" });

  const finished = JSON.parse(lines[1].replace(/^\[ai-request\] /, ""));
  assert.equal(finished.timeToFirstTokenMs, 25);
  assert.equal(finished.elapsedMs, 90);
  assert.equal(finished.outputTextChars, 16);
  assert.doesNotMatch(lines.join("\n"), /private prompt|private response/);
});

test('correlates client traces with provider first output without recording private input',()=>{
 const lines=[];let tick=100;
 const metrics=createAIRequestMetrics({logger:{info:line=>lines.push(line)},requestId:'server-1',clientTraceId:'ct-1234567890-local',workflow:'collaborator.answer',messages:[{role:'user',content:'PRIVATE_INPUT'}],startedAt:90,now:()=>tick});
 tick=110;metrics.markProviderStarted();tick=150;metrics.addOutput('PRIVATE_OUTPUT');tick=200;metrics.finish();metrics.finish();
 const result=JSON.parse(lines[1].replace(/^\[ai-request\] /,''));assert.equal(result.clientTraceId,'ct-1234567890-local');assert.equal(result.providerStartOffsetMs,20);assert.equal(result.providerTimeToFirstTokenMs,40);assert.equal(result.elapsedMs,110);assert.equal(lines.length,2);assert.doesNotMatch(lines.join('\n'),/PRIVATE_INPUT|PRIVATE_OUTPUT/);
});
