const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildChatCompletionCompatibilityRetry,
  buildTokenLimitCompatibilityRetry,
  createChatCompletionWithTokenCompatibility,
  executeProviderRequestWithCompatibility,
} = require("./aiProviderTokenCompatibility");

test("converts max_tokens when a discovered model requires max_completion_tokens", () => {
  const retry = buildTokenLimitCompatibilityRetry({
    model: "provider-discovered-model",
    max_tokens: 2400,
    messages: [{ role: "user", content: "Hello" }],
  }, {
    response: {
      data: {
        error: {
          message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        },
      },
    },
  });

  assert.equal(retry.max_tokens, undefined);
  assert.equal(retry.max_completion_tokens, 2400);
  assert.equal(retry.model, "provider-discovered-model");
});

test("can fall back in the other direction for older models", () => {
  const retry = buildTokenLimitCompatibilityRetry({
    model: "legacy-model",
    max_completion_tokens: 900,
  }, new Error("Unsupported parameter: max_completion_tokens; use max_tokens instead."));

  assert.equal(retry.max_completion_tokens, undefined);
  assert.equal(retry.max_tokens, 900);
});

test("removes temperature when a model only supports its default", () => {
  const retry = buildChatCompletionCompatibilityRetry({
    model: "astra",
    max_completion_tokens: 900,
    temperature: 0,
  }, new Error("Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported."));

  assert.equal(retry.temperature, undefined);
  assert.equal(retry.max_completion_tokens, 900);
});

test("removes a sampling control when a provider deprecates it for one model", async () => {
  const calls = [];
  const result = await executeProviderRequestWithCompatibility(async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      throw new Error("temperature is deprecated for this model.");
    }
    return { ok: true };
  }, {
    model: "claude-provider-discovered-model",
    max_tokens: 1200,
    temperature: 0,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].temperature, undefined);
  assert.equal(calls[1].max_tokens, 1200);
  assert.equal(calls[1].max_completion_tokens, undefined);
});

test("performs bounded sequential compatibility retries and preserves streaming options", async () => {
  const calls = [];
  const openai = {
    chat: {
      completions: {
        create: async (payload) => {
          calls.push(payload);
          if (calls.length === 1) {
            throw new Error("Unsupported parameter: max_tokens is not supported; use max_completion_tokens instead.");
          }
          if (calls.length === 2) {
            throw new Error("Unsupported value: temperature does not support 0 with this model. Only the default (1) value is supported.");
          }
          if (calls.length === 3) {
            throw new Error("Unsupported value: top_p does not support 0.1 with this model. Only the default (1) value is supported.");
          }
          return { ok: true };
        },
      },
    },
  };

  const result = await createChatCompletionWithTokenCompatibility(openai, {
    model: "provider-discovered-model",
    max_tokens: 1200,
    temperature: 0,
    top_p: 0.1,
    stream: true,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].stream, true);
  assert.equal(calls[3].max_completion_tokens, 1200);
  assert.equal(calls[3].max_tokens, undefined);
  assert.equal(calls[3].temperature, undefined);
  assert.equal(calls[3].top_p, undefined);
});

test("does not retry unrelated provider failures", async () => {
  let calls = 0;
  const openai = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          throw new Error("Rate limit exceeded");
        },
      },
    },
  };

  await assert.rejects(
    createChatCompletionWithTokenCompatibility(openai, { model: "any", max_tokens: 1200 }),
    /Rate limit exceeded/,
  );
  assert.equal(calls, 1);
});
