/**
 * The backend spreads the whole chat request body into the upstream provider
 * call (server.js: `body: { temperature: 0.2, ...body }`), so any key the
 * provider API does not recognise is rejected. Adding a field here silently
 * breaks every AI proposal, which no other test would catch: the review just
 * degrades to "the model did not return a usable structured proposal".
 */

import {
  HAZARD_REVIEW_RETRY_TOKEN_BUDGET,
  HAZARD_REVIEW_TOKEN_BUDGET,
  callHazardReviewProvider,
  describeProviderFormatFailure,
  isTruncatedCompletion,
} from "./vibeReviewProposal";

const ALLOWED_REQUEST_KEYS = new Set([
  "provider", "model", "effort", "reasoning_effort",
  "xhandleWorkflow", "messages", "temperature", "max_tokens",
]);

function captureRequest(responsePayload = { content: "{}" }) {
  const calls = [];
  global.fetch = jest.fn(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => responsePayload };
  });
  return calls;
}

afterEach(() => { delete global.fetch; });

describe("hazard review provider requests", () => {
  it("sends only keys the provider API understands", async () => {
    const calls = captureRequest();
    const call = callHazardReviewProvider({
      label: "Test review", workflow: "hazard-vibe-review",
      provider: "claude", model: "claude-opus-5", effort: "high",
    });
    await call([{ role: "user", content: "hello" }]);

    const unexpected = Object.keys(calls[0].body).filter((key) => !ALLOWED_REQUEST_KEYS.has(key));
    expect(unexpected).toEqual([]);
  });

  it("carries the workflow, model and messages through", async () => {
    const calls = captureRequest();
    const call = callHazardReviewProvider({
      label: "Test review", workflow: "hazard-vibe-review",
      provider: "claude", model: "claude-opus-5", effort: "high",
    });
    await call([{ role: "user", content: "hello" }]);

    expect(calls[0].body).toMatchObject({
      provider: "claude",
      model: "claude-opus-5",
      xhandleWorkflow: "hazard-vibe-review",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("honours a per-call token budget", async () => {
    const calls = captureRequest();
    const call = callHazardReviewProvider({
      label: "Test review", workflow: "hazard-vibe-review", provider: "claude", maxTokens: 1500,
    });
    await call([{ role: "user", content: "a" }]);
    await call([{ role: "user", content: "b" }], 4000);

    expect(calls[0].body.max_tokens).toBe(1500);
    expect(calls[1].body.max_tokens).toBe(4000);
  });

  it("reports a failed response with its status", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => "bad request" }));
    const call = callHazardReviewProvider({ label: "Vibe review proposal", workflow: "w", provider: "claude" });
    await expect(call([{ role: "user", content: "x" }]))
      .rejects.toThrow(/Vibe review proposal failed \(400\)/);
  });

  it("times out instead of hanging the review forever", async () => {
    global.fetch = jest.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const call = callHazardReviewProvider({
      label: "Vibe review proposal", workflow: "w", provider: "claude", timeoutMs: 20,
    });
    await expect(call([{ role: "user", content: "x" }]))
      .rejects.toThrow(/timed out/);
  });
});

describe("truncated completions", () => {
  const completion = (content, finishReason) => ({
    choices: [{ message: { content }, finish_reason: finishReason }],
  });

  it("reports the finish reason alongside the text", async () => {
    captureRequest(completion('{"normalizedDecision":"Mission/Reliability"}', "stop"));
    const call = callHazardReviewProvider({ label: "t", workflow: "w", provider: "claude" });

    await expect(call([{ role: "user", content: "x" }])).resolves.toMatchObject({
      finishReason: "stop",
    });
  });

  it("recognises every truncation signal the providers use", () => {
    expect(isTruncatedCompletion("length")).toBe(true);
    expect(isTruncatedCompletion("max_tokens")).toBe(true);
    expect(isTruncatedCompletion("MAX_OUTPUT_TOKENS")).toBe(true);
    expect(isTruncatedCompletion("stop")).toBe(false);
    expect(isTruncatedCompletion(undefined)).toBe(false);
  });

  it("explains a cut-off answer differently from a malformed one", () => {
    // These need different remedies, so the reviewer must be told which happened.
    expect(describeProviderFormatFailure({ text: '{"partial"', finishReason: "length" }))
      .toContain("cut off");
    expect(describeProviderFormatFailure({ text: "", finishReason: "stop" }))
      .toContain("empty response");
    expect(describeProviderFormatFailure({ text: "Sure! Here is my analysis.", finishReason: "stop" }))
      .toContain("required structured fields");
  });

  it("gives the schema enough room by default to avoid gratuitous truncation", () => {
    expect(HAZARD_REVIEW_TOKEN_BUDGET).toBeGreaterThan(1800);
    expect(HAZARD_REVIEW_RETRY_TOKEN_BUDGET).toBeGreaterThan(HAZARD_REVIEW_TOKEN_BUDGET);
  });
});
