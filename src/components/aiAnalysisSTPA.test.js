import {
  fetchLLMResponse,
  getHazardAnalysisRequestTimeoutMs,
} from "./aiAnalysisSTPA";

function pendingFetchThatRejectsOnAbort() {
  return jest.fn((_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }));
}

describe("hazard analysis LLM request lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("uses a long request window for Claude hazard analysis", () => {
    expect(getHazardAnalysisRequestTimeoutMs({
      provider: "anthropic",
      model: "claude-fable-5-1",
    })).toBe(290_000);
    expect(getHazardAnalysisRequestTimeoutMs({
      provider: "claude",
      model: "claude-sonnet-5",
    })).toBe(290_000);
  });

  test("keeps an explicit request timeout for targeted callers", () => {
    expect(getHazardAnalysisRequestTimeoutMs({
      provider: "anthropic",
      timeoutMs: 75,
    })).toBe(75);
  });

  test("rejects a provider request that exceeds its timeout", async () => {
    global.fetch = pendingFetchThatRejectsOnAbort();

    const request = fetchLLMResponse("analyze", {}, [], "", { timeoutMs: 50 });
    jest.advanceTimersByTime(51);

    await expect(request).rejects.toMatchObject({ name: "TimeoutError" });
  });

  test("propagates user cancellation instead of converting it to a fallback response", async () => {
    global.fetch = pendingFetchThatRejectsOnAbort();
    const controller = new AbortController();

    const request = fetchLLMResponse("analyze", {}, [], "", {
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
  test("keeps the timeout active while downloading the response body", async () => {
    global.fetch = jest.fn(async (_url, options) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("body aborted"), {name: "AbortError"}));
      })),
    }));
    const request = fetchLLMResponse("analyze", {}, [], "", {timeoutMs: 50});
    await Promise.resolve();
    jest.advanceTimersByTime(51);
    await expect(request).rejects.toMatchObject({name: "TimeoutError"});
  });

  test("an unsolicited body abort is recoverable rather than user cancellation", async () => {
    global.fetch = jest.fn(async () => ({ok: true, json: async () => {
      throw Object.assign(new Error("body aborted"), {name: "AbortError"});
    }}));
    await expect(fetchLLMResponse("analyze", {}, [], "", {})).rejects.toMatchObject({name: "NetworkError"});
  });

  test.each(["hazard-row-generation", "hazard-semantic-review", "hazard-applicability-screen", "hazard-evidence-extraction", "hazard-evidence-compaction"])("preserves proxy failures for %s instead of returning non-JSON placeholders", async workflow => {
    global.fetch = jest.fn(async () => ({ok: false, status: 502, text: async () => "upstream unavailable"}));
    await expect(fetchLLMResponse("analyze", {}, [], "", {workflow}))
      .rejects.toThrow("LLM proxy error (502)");
  });

  test("caller cancellation still stops a response body download", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(async (_url, options) => ({ok: true,
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("body aborted"), {name: "AbortError"}));
      })),
    }));
    const request = fetchLLMResponse("analyze", {}, [], "", {signal: controller.signal});
    await Promise.resolve();
    controller.abort();
    await expect(request).rejects.toMatchObject({name: "AbortError"});
  });

});

test.each(['hazard-row-generation','hazard-semantic-review','hazard-applicability-screen','hazard-evidence-extraction','hazard-evidence-compaction'])('%s propagates explicit truncation even for parseable JSON and reports actual usage',async workflow=>{
 const metadata=jest.fn();
 global.fetch=jest.fn(async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'[]'}}],raw:{usage:{output_tokens:8000,input_tokens:10000}}})}));
 await expect(fetchLLMResponse('assess',{},[],'',{workflow,onResponseMetadata:metadata})).rejects.toHaveProperty('name','TruncatedResponseError');
 expect(metadata).toHaveBeenCalledWith({finishReason:'length',usage:{output_tokens:8000,input_tokens:10000}});
});

test('legacy callers retain string responses; compact successful responses also return strings',async()=>{
 global.fetch=jest.fn(async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:' [] '}}]})}));
 expect(await fetchLLMResponse('assess',{},[],'',{workflow:'hazard-semantic-review'})).toBe('[]');
 expect(await fetchLLMResponse('assess',{},[],'',{})).toBe('[]');
});
