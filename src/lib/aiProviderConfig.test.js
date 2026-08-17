import {
  getDefaultProviderModel,
  getStoredAIProviderModelPreference,
  normalizeProviderModel,
  storeAIProviderModelPreference,
} from "./aiProviderConfig";

describe("AI provider model preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves custom model ids instead of forcing static fallback options", () => {
    expect(normalizeProviderModel("openai", "gpt-next-custom")).toBe("gpt-next-custom");
    expect(normalizeProviderModel("gemini", "gemini-next-flash")).toBe("gemini-next-flash");
    expect(normalizeProviderModel("anthropic", "claude-next-sonnet")).toBe("claude-next-sonnet");
  });

  it("falls back only when a model id is blank", () => {
    expect(normalizeProviderModel("openai", "")).toBe(getDefaultProviderModel("openai"));
  });

  it("stores and reloads custom model ids", () => {
    storeAIProviderModelPreference("gemini", "gemini-next-flash");
    expect(getStoredAIProviderModelPreference("gemini")).toBe("gemini-next-flash");
  });
});
