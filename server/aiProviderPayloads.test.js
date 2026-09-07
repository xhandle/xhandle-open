const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildClaudeRequestPayload,
  buildGeminiRequestPayload,
  normalizeClaudeConversation,
} = require("./aiProviderPayloads");

test("Claude retains Anthropic max_tokens and provider-compatible sampling controls", () => {
  const payload = buildClaudeRequestPayload({
    body: { max_tokens: 2400, temperature: 0, top_p: 0.1 },
    model: "claude-sonnet-test",
    system: "Be precise.",
    conversation: [{ role: "user", content: "Hello" }],
  });

  assert.deepEqual(payload, {
    model: "claude-sonnet-test",
    max_tokens: 2400,
    messages: [{ role: "user", content: "Hello" }],
    system: "Be precise.",
    temperature: 0,
  });
  assert.equal(payload.max_completion_tokens, undefined);
});

test("Claude converts a cross-provider completion limit back to max_tokens", () => {
  const payload = buildClaudeRequestPayload({
    body: { max_completion_tokens: 1800 },
    model: "claude-haiku-test",
  });

  assert.equal(payload.max_tokens, 1800);
  assert.equal(payload.max_completion_tokens, undefined);
});

test("Claude conversations never use an assistant-message prefill", () => {
  const messages = normalizeClaudeConversation([
    { role: "user", content: "Create a functional decomposition for a humanoid robot." },
    { role: "assistant", content: "What level of abstraction should I use?" },
  ]);

  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.match(messages[2].content, /continue with the user's latest request/i);
});

test("Claude combines consecutive roles into an alternating conversation", () => {
  const messages = normalizeClaudeConversation([
    { role: "user", content: "Original request" },
    { role: "user", content: "Multi-level selected" },
    { role: "assistant", content: "Prior response" },
    { role: "assistant", content: "Prior follow-up" },
  ]);

  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.match(messages[0].content, /Original request[\s\S]*Multi-level selected/);
  assert.match(messages[1].content, /Prior response[\s\S]*Prior follow-up/);
});

test("Claude converts OpenAI-compatible image parts to Anthropic image blocks", () => {
  const payload = buildClaudeRequestPayload({
    body: { max_tokens: 1200 },
    model: "claude-vision-test",
    conversation: [{
      role: "user",
      content: [
        { type: "text", text: "Inspect this diagram." },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      ],
    }],
  });

  assert.deepEqual(payload.messages[0].content[1], {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: "aGVsbG8=",
    },
  });
});

test("Gemini maps shared request controls to Gemini field names", () => {
  const payload = buildGeminiRequestPayload({
    body: { max_tokens: 1600, temperature: 0.2, top_p: 0.8 },
    system: "Be precise.",
    conversation: [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ],
  });

  assert.deepEqual(payload.generationConfig, {
    temperature: 0.2,
    topP: 0.8,
    maxOutputTokens: 1600,
  });
  assert.equal(payload.contents[0].role, "user");
  assert.equal(payload.contents[1].role, "model");
  assert.equal(payload.system_instruction.parts[0].text, "Be precise.");
});

test("Gemini converts image attachments to native inline data", () => {
  const payload = buildGeminiRequestPayload({
    body: { max_tokens: 1200 },
    conversation: [{
      role: "user",
      content: [
        { type: "text", text: "Inspect this diagram." },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,aGVsbG8=" } },
      ],
    }],
  });

  assert.deepEqual(payload.contents[0].parts[1], {
    inlineData: {
      mimeType: "image/jpeg",
      data: "aGVsbG8=",
    },
  });
});
