import {
  AI_PROVIDER_PREFERENCE_CHANGED_EVENT,
  getDefaultProviderModel,
  getStoredAIProviderEffortPreference,
  getStoredAIProviderModelPreference,
  normalizeAIProviderEffort,
  normalizeProviderModel,
  saveUserAIProviderSettings,
  storeAIProviderEffortPreference,
  storeAIProviderModelPreference,
  supportsAIProviderEffort,
  supportsConversationalProjectMode,
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

  it("exposes conversational project mode only for the OpenAI provider", () => {
    expect(supportsConversationalProjectMode("openai")).toBe(true);
    expect(supportsConversationalProjectMode("chatgpt")).toBe(true);
    expect(supportsConversationalProjectMode("anthropic")).toBe(false);
    expect(supportsConversationalProjectMode("claude")).toBe(false);
    expect(supportsConversationalProjectMode("gemini")).toBe(false);
    expect(supportsConversationalProjectMode(null)).toBe(false);
  });

  it("stores and reloads custom model ids", () => {
    storeAIProviderModelPreference("gemini", "gemini-next-flash");
    expect(getStoredAIProviderModelPreference("gemini")).toBe("gemini-next-flash");
  });

  it("stores effort preferences and exposes the control for supported provider models", () => {
    expect(normalizeAIProviderEffort("HIGH")).toBe("high");
    expect(getStoredAIProviderEffortPreference("anthropic")).toBe("medium");
    storeAIProviderEffortPreference("anthropic", "low");
    expect(getStoredAIProviderEffortPreference("anthropic")).toBe("low");
    expect(supportsAIProviderEffort("anthropic", "claude-sonnet-5")).toBe(true);
    expect(supportsAIProviderEffort("anthropic", "claude-fable-5-1")).toBe(true);
    expect(supportsAIProviderEffort("anthropic", "claude-haiku-4-5")).toBe(false);
    expect(supportsAIProviderEffort("openai", "gpt-5.5")).toBe(true);
    expect(supportsAIProviderEffort("openai", "gpt-4o")).toBe(false);
    expect(supportsAIProviderEffort("gemini", "gemini-3.6-flash")).toBe(true);
    expect(supportsAIProviderEffort("gemini", "gemini-2.0-flash")).toBe(false);
  });

  it("persists effort with provider settings", async () => {
    const saved = await saveUserAIProviderSettings(
      "anthropic",
      "sk-ant-test-provider-key-1234567890",
      { selectedModel: "claude-sonnet-5", selectedEffort: "high" },
    );

    expect(saved.selectedModel).toBe("claude-sonnet-5");
    expect(saved.selectedEffort).toBe("high");
    expect(saved.savedProviders[0]).toEqual(expect.objectContaining({
      selectedModel: "claude-sonnet-5",
      selectedEffort: "high",
    }));
    expect(getStoredAIProviderEffortPreference("anthropic")).toBe("high");
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
