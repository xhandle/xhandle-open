import {
  AI_PROVIDER_PREFERENCE_CHANGED_EVENT,
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

  it("notifies same-tab consumers when the active model changes", () => {
    const listener = jest.fn();
    window.addEventListener(AI_PROVIDER_PREFERENCE_CHANGED_EVENT, listener);

    storeAIProviderModelPreference("openai", "gpt-4o");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual(expect.objectContaining({
      provider: "openai",
      model: "gpt-4o",
      active: true,
    }));
    window.removeEventListener(AI_PROVIDER_PREFERENCE_CHANGED_EVENT, listener);
  });
});
