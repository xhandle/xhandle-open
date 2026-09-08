import {
  buildAIAuthOpts,
} from "./backendConfig";
import {
  saveUserAIProviderSettings,
  storeAIProviderEffortPreference,
  storeAIProviderModelPreference,
} from "../aiProviderConfig";

describe("global AI workflow routing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ["openai", "gpt-5.5", "high", "openai"],
    ["anthropic", "claude-sonnet-5", "low", "claude"],
    ["gemini", "gemini-3.6-flash", "medium", "gemini"],
  ])("routes every workflow through the selected %s model and effort", async (provider, model, effort, expectedHeaderProvider) => {
    const key = provider === "anthropic"
      ? "sk-ant-test-provider-key-1234567890"
      : provider === "gemini"
        ? "AIza-test-provider-key-1234567890"
        : "sk-test-provider-key-1234567890";
    await saveUserAIProviderSettings(provider, key, {
      selectedModel: model,
      selectedEffort: effort,
    });

    const request = buildAIAuthOpts({ "Content-Type": "application/json" });

    expect(request.headers).toEqual(expect.objectContaining({
      "Content-Type": "application/json",
      "x-ai-provider": expectedHeaderProvider,
      "x-ai-api-key": key,
      "x-ai-model": model,
      "x-ai-effort": effort,
    }));
  });

  it("keeps the selected provider and model when credentials are backend-managed", () => {
    localStorage.setItem("xhandle.aiProvider.active", "anthropic");
    storeAIProviderModelPreference("anthropic", "claude-sonnet-5");
    storeAIProviderEffortPreference("anthropic", "high");

    const request = buildAIAuthOpts();

    expect(request.headers).toEqual(expect.objectContaining({
      "x-ai-provider": "claude",
      "x-ai-model": "claude-sonnet-5",
      "x-ai-effort": "high",
    }));
    expect(request.headers["x-ai-api-key"]).toBeUndefined();
  });

  it("does not send an unsupported effort parameter", async () => {
    await saveUserAIProviderSettings("openai", "sk-test-provider-key-1234567890", {
      selectedModel: "gpt-4o",
      selectedEffort: "high",
    });

    const request = buildAIAuthOpts();

    expect(request.headers["x-ai-model"]).toBe("gpt-4o");
    expect(request.headers["x-ai-effort"]).toBeUndefined();
  });
});
