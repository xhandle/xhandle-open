import { fetchLLMResponse } from "./aiAnalysisSTPA";

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
});
