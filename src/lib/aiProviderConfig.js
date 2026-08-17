export const AI_PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Claude" },
  { value: "gemini", label: "Gemini" },
];

export const AI_PROVIDER_MODEL_OPTIONS = {
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o mini", description: "Current xHandle default for existing OpenAI workflows.", speed: "High", intelligence: "Medium", bestFor: "Fast drafts, routine summaries, lightweight extraction, and lower-cost iterative work." },
    { value: "gpt-4o", label: "GPT-4o", description: "General-purpose model used by existing analysis workflows.", speed: "Medium", intelligence: "High", bestFor: "Balanced architecture, hazard, requirements, and report workflows." },
    { value: "gpt-5.5", label: "GPT-5.5", description: "Newest frontier OpenAI model for complex professional work.", speed: "Low", intelligence: "High", bestFor: "Hard analysis, nuanced safety reasoning, large refactors, and complex synthesis." },
    { value: "gpt-5.4", label: "GPT-5.4", description: "Frontier model for coding and professional work.", speed: "Medium", intelligence: "High", bestFor: "Deep coding, traceability analysis, technical planning, and detailed reviews." },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Lower-latency, lower-cost GPT-5.4 model.", speed: "High", intelligence: "Medium", bestFor: "Day-to-day analysis, drafting, classification, and quick code assistance." },
    { value: "gpt-5.4-nano", label: "GPT-5.4 nano", description: "Smallest GPT-5.4 option for lightweight work.", speed: "High", intelligence: "Low", bestFor: "Very fast labeling, formatting, short extraction, and simple assistant tasks." },
    { value: "gpt-5.1", label: "GPT-5.1", description: "Previous GPT-5 reasoning model.", speed: "Medium", intelligence: "High", bestFor: "Careful reasoning, technical decomposition, and complex document work." },
    { value: "gpt-5", label: "GPT-5", description: "Earlier GPT-5 reasoning model.", speed: "Medium", intelligence: "High", bestFor: "General reasoning, safety analysis, and structured technical writing." },
    { value: "gpt-5-mini", label: "GPT-5 mini", description: "Cost-sensitive GPT-5 model.", speed: "High", intelligence: "Medium", bestFor: "Lower-cost bulk analysis, summaries, and first-pass decomposition." },
    { value: "gpt-4.1", label: "GPT-4.1", description: "Strong instruction-following and tool-calling model.", speed: "Medium", intelligence: "High", bestFor: "Instruction-heavy workflows, tool use, code edits, and structured outputs." },
  ],
  anthropic: [
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Current xHandle default for Claude workflows.", speed: "High", intelligence: "Medium", bestFor: "Fast summaries, classification, extraction, and lower-cost assistant work." },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Balanced Claude model for speed and intelligence.", speed: "Medium", intelligence: "High", bestFor: "Architecture analysis, requirements writing, hazard review, and code understanding." },
    { value: "claude-opus-5", label: "Claude Opus 5", description: "High-capability Claude model for complex technical work.", speed: "Low", intelligence: "High", bestFor: "Complex safety cases, long-form reasoning, difficult architecture reviews, and writing polish." },
    { value: "claude-fable-5", label: "Claude Fable 5", description: "Anthropic's most capable widely released Claude model.", speed: "Low", intelligence: "High", bestFor: "Hard reasoning, large-context synthesis, and demanding agentic work." },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 Snapshot", description: "Pinned Claude Haiku 4.5 API snapshot.", speed: "High", intelligence: "Medium", bestFor: "Stable low-latency Claude workflows that need a pinned model id." },
  ],
  gemini: [
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", description: "Current xHandle default for Gemini workflows.", speed: "High", intelligence: "High", bestFor: "General Copilot, architecture, coding, and multi-document technical analysis." },
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "Stable Gemini Flash model for scaled production use.", speed: "High", intelligence: "High", bestFor: "Agentic workflows, coding tasks, and long-context synthesis." },
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", description: "Fast, cost-efficient Gemini model.", speed: "High", intelligence: "Medium", bestFor: "Low-cost summaries, classification, extraction, and iterative workflows." },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", description: "Preview model for complex reasoning tasks.", speed: "Low", intelligence: "High", bestFor: "Difficult architecture reviews, broad synthesis, and high-complexity analysis." },
    { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", description: "Preview workhorse for cost-sensitive high-volume tasks.", speed: "High", intelligence: "Medium", bestFor: "Bulk extraction, repo triage, labeling, and fast drafts." },
  ],
};

export function normalizeAIProvider(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "claude") return "anthropic";
  if (value === "google" || value === "google-gemini") return "gemini";
  if (AI_PROVIDER_OPTIONS.some((option) => option.value === value)) return value;
  return "openai";
}

export function getAIProviderLabel(provider) {
  const normalized = normalizeAIProvider(provider);
  return AI_PROVIDER_OPTIONS.find((option) => option.value === normalized)?.label || "OpenAI";
}

export function getProviderModelOptions(provider) {
  return AI_PROVIDER_MODEL_OPTIONS[normalizeAIProvider(provider)] || AI_PROVIDER_MODEL_OPTIONS.openai;
}

export function getProviderModelProfile(provider, model) {
  const normalizedProvider = normalizeAIProvider(provider);
  const normalizedModel = normalizeProviderModel(normalizedProvider, model);
  return getProviderModelOptions(normalizedProvider).find((option) => option.value === normalizedModel) || null;
}

export function getDefaultProviderModel(provider) {
  return getProviderModelOptions(provider)[0]?.value || "gpt-4o-mini";
}

export function normalizeProviderModel(provider, model) {
  const normalizedProvider = normalizeAIProvider(provider);
  const value = String(model || "").trim();
  if (value) return value;
  const options = getProviderModelOptions(normalizedProvider);
  return options[0]?.value || getDefaultProviderModel(normalizedProvider);
}

export function storeAIProviderModelPreference(provider, model, options = {}) {
  if (typeof localStorage === "undefined") return;
  const normalizedProvider = normalizeAIProvider(provider);
  const normalizedModel = normalizeProviderModel(normalizedProvider, model);
  localStorage.setItem(`xhandle.aiProviderModel.${normalizedProvider}`, normalizedModel);
  if (options.setActive === false) return;
  localStorage.setItem("xhandle.aiProvider.active", normalizedProvider);
  localStorage.setItem("xhandle.aiProvider.activeModel", normalizedModel);
}

export function getStoredAIProviderModelPreference(provider, options = {}) {
  const normalizedProvider = normalizeAIProvider(provider);
  if (typeof localStorage === "undefined") {
    return options.includeDefault ? getDefaultProviderModel(normalizedProvider) : null;
  }
  const stored =
    localStorage.getItem(`xhandle.aiProviderModel.${normalizedProvider}`) ||
    localStorage.getItem("xhandle.aiProvider.activeModel");
  if (!stored) return options.includeDefault ? getDefaultProviderModel(normalizedProvider) : null;
  return normalizeProviderModel(normalizedProvider, stored);
}

export function getStoredActiveAIProvider() {
  if (typeof localStorage === "undefined") return "openai";
  return normalizeAIProvider(localStorage.getItem("xhandle.aiProvider.active") || "openai");
}

export function normalizeProviderApiKey(provider, apiKey) {
  const trimmed = String(apiKey || "").replace(/^Bearer\s+/i, "").trim();
  if (normalizeAIProvider(provider) === "anthropic") return trimmed.replace(/^Anthropic\s+/i, "").trim();
  return trimmed;
}

export function isPlaceholderProviderApiKey(apiKey) {
  const key = String(apiKey || "").trim().toLowerCase();
  if (!key) return true;
  return (
    key.includes("your-") ||
    key.includes("your_") ||
    key.includes("placeholder") ||
    key.includes("example") ||
    key === "sk-your-openai-key" ||
    key === "sk-your-api-key" ||
    key === "sk-your-key"
  );
}

export function getProviderKeyPlaceholder(provider) {
  const normalized = normalizeAIProvider(provider);
  if (normalized === "anthropic") return "sk-ant-...";
  if (normalized === "gemini") return "AIza...";
  return "sk-... or sk-proj-...";
}

export function getProviderKeyHelpText(provider) {
  const normalized = normalizeAIProvider(provider);
  if (normalized === "anthropic") {
    return "Claude keys usually start with sk-ant-.";
  }
  if (normalized === "gemini") {
    return "Gemini API keys are issued from Google AI Studio or Google Cloud.";
  }
  return "OpenAI keys usually start with sk- or sk-proj-.";
}

export function validateProviderApiKey(provider, apiKey) {
  const normalized = normalizeAIProvider(provider);
  const key = normalizeProviderApiKey(normalized, apiKey);
  if (!key) return "API key is required.";

  if (normalized === "openai") {
    if (!/^(sk-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,})$/.test(key)) {
      return "OpenAI keys must start with sk- or sk-proj-.";
    }
    return null;
  }

  if (normalized === "anthropic") {
    if (!/^sk-ant-[A-Za-z0-9\-_]{16,}$/i.test(key)) {
      return "Claude keys must start with sk-ant-.";
    }
    return null;
  }

  if (normalized === "gemini") {
    if (!(key.startsWith("AIza") && key.length >= 20) && key.length < 20) {
      return "Enter a valid Gemini API key.";
    }
    return null;
  }

  return "Unsupported AI provider.";
}

function buildProviderSettings(rows) {
  const savedProviders = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.last4 || row?.apiKey)
    .map((row) => ({
      provider: normalizeAIProvider(row.provider || "openai"),
      last4: row.last4 || (row.apiKey ? String(row.apiKey).slice(-4) : null),
      hasApiKey: !!row.apiKey && !isPlaceholderProviderApiKey(row.apiKey),
      verified: !!row.verified,
      updatedAt: row.updated_at || null,
      isActive: !!row.is_active,
      selectedModel: getStoredAIProviderModelPreference(row.provider || "openai"),
    }))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

  if (!savedProviders.length) return null;

  const active = savedProviders.find((row) => row.isActive) || savedProviders[0];
  return {
    provider: active.provider,
    last4: active.last4,
    verified: active.verified,
    updatedAt: active.updatedAt,
    selectedModel: active.selectedModel,
    savedProviders,
  };
}

function readLocalProviderRows() {
  if (typeof localStorage === "undefined") return [];
  const rowsByProvider = new Map();
  try {
    const rows = JSON.parse(localStorage.getItem("xhandle.localAIProviderSettings") || "[]");
    if (Array.isArray(rows)) {
      rows.forEach((row) => {
        const provider = normalizeAIProvider(row?.provider || "openai");
        rowsByProvider.set(provider, { ...row, provider });
      });
    }
  } catch {
    // Continue with legacy provider-key storage below.
  }
  try {
    const legacyMap = JSON.parse(localStorage.getItem("xhandle.aiProvider.keys") || "{}");
    if (legacyMap && typeof legacyMap === "object" && !Array.isArray(legacyMap)) {
      Object.entries(legacyMap).forEach(([providerKey, record]) => {
        const provider = normalizeAIProvider(providerKey || record?.provider || "openai");
        const apiKey = record?.apiKey || "";
        if (!apiKey || rowsByProvider.get(provider)?.apiKey) return;
        rowsByProvider.set(provider, {
          provider,
          apiKey,
          last4: String(apiKey).slice(-4),
          verified: true,
          updated_at: record?.updatedAt || null,
          is_active: getStoredActiveAIProvider() === provider,
        });
      });
    }
  } catch {
    // Ignore malformed legacy settings.
  }
  return Array.from(rowsByProvider.values());
}

export async function fetchUserAIProviderSettings() {
  if (typeof localStorage === "undefined") return null;
  const rows = readLocalProviderRows();
  const settings = buildProviderSettings(rows);
  if (settings?.provider && typeof localStorage !== "undefined") {
    localStorage.setItem("xhandle.aiProvider.active", settings.provider);
  }
  return settings;
}

export function getFallbackProviderModelRecords(provider) {
  const normalizedProvider = normalizeAIProvider(provider);
  return getProviderModelOptions(normalizedProvider).map((option) => ({
    id: option.value,
    value: option.value,
    label: option.label || option.value,
    provider: normalizedProvider,
    source: "fallback",
  }));
}

export async function fetchProviderModelRecords(provider, options = {}) {
  const normalizedProvider = normalizeAIProvider(provider);
  const baseUrl = String(options.backendURL || "").replace(/\/$/, "");
  if (!baseUrl) return getFallbackProviderModelRecords(normalizedProvider);

  const params = new URLSearchParams({ provider: normalizedProvider });
  if (options.refresh) params.set("refresh", "true");
  const headers = {
    "Content-Type": "application/json",
    "x-ai-provider": normalizedProvider,
  };
  const apiKey = getStoredAIProviderApiKey(normalizedProvider);
  if (apiKey) headers["x-ai-api-key"] = apiKey;
  if (options.accountId) headers["x-account-id"] = options.accountId;
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  const response = await fetch(`${baseUrl}/api/ai-provider/models?${params.toString()}`, {
    credentials: "include",
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load provider models.");
  }
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return models.map((model) => ({
    id: model.id || model.value,
    value: model.value || model.id,
    label: model.label || model.displayName || model.id || model.value,
    provider: normalizeAIProvider(model.provider || normalizedProvider),
    source: model.source || payload.source || "provider",
    description: model.description || "",
  })).filter((model) => model.value);
}

export function getStoredAIProviderApiKey(provider = null) {
  if (typeof localStorage === "undefined") return "";
  const requestedProvider = provider ? normalizeAIProvider(provider) : getStoredActiveAIProvider();
  const row = readLocalProviderRows().find(
    (entry) => normalizeAIProvider(entry?.provider || "openai") === requestedProvider
  );
  const key = normalizeProviderApiKey(requestedProvider, row?.apiKey || "");
  return isPlaceholderProviderApiKey(key) ? "" : key;
}

export async function saveUserAIProviderSettings(provider, apiKey, options = {}) {
  const normalizedProvider = normalizeAIProvider(provider);
  const normalizedKey = normalizeProviderApiKey(normalizedProvider, apiKey);
  const activateOnly = !!options.activateOnly || !normalizedKey;
  if (!activateOnly) {
    const validationError = validateProviderApiKey(normalizedProvider, normalizedKey);
    if (validationError) throw new Error(validationError);
  }

  const selectedModel = Object.prototype.hasOwnProperty.call(options, "selectedModel")
    ? normalizeProviderModel(normalizedProvider, options.selectedModel)
    : null;
  const now = new Date().toISOString();
  const existingRows = readLocalProviderRows();
  const existingSettings = buildProviderSettings(existingRows);
  const existingProviderRow = existingRows.find((row) => normalizeAIProvider(row?.provider || "openai") === normalizedProvider);
  if (activateOnly && !getStoredAIProviderApiKey(normalizedProvider)) {
    throw new Error(`Re-enter your ${getAIProviderLabel(normalizedProvider)} API key to use it locally.`);
  }
  const rows = existingRows.filter((row) => normalizeAIProvider(row?.provider || "openai") !== normalizedProvider);
  const nextRow = {
    provider: normalizedProvider,
    last4: activateOnly ? existingProviderRow?.last4 || existingSettings?.last4 || null : normalizedKey.slice(-4),
    apiKey: activateOnly ? existingProviderRow?.apiKey || "" : normalizedKey,
    verified: activateOnly ? !!existingProviderRow?.verified : true,
    updated_at: now,
    is_active: true,
  };
  const savedProviders = [nextRow, ...rows.map((row) => ({ ...row, is_active: false }))];
  localStorage.setItem("xhandle.localAIProviderSettings", JSON.stringify(savedProviders));
  localStorage.setItem("xhandle.aiProvider.active", normalizedProvider);
  if (selectedModel) storeAIProviderModelPreference(normalizedProvider, selectedModel);
  return {
    ok: true,
    provider: normalizedProvider,
    last4: nextRow.last4,
    verified: nextRow.verified,
    updatedAt: now,
    selectedModel,
    savedProviders: buildProviderSettings(savedProviders)?.savedProviders || [],
  };
}

export async function clearUserAIProviderSettings(provider) {
  const normalizedProvider = normalizeAIProvider(provider);
  const rows = readLocalProviderRows().filter((row) => normalizeAIProvider(row?.provider || "openai") !== normalizedProvider);
  const normalizedRows = rows.map((row, index) => ({ ...row, is_active: index === 0 }));
  localStorage.setItem("xhandle.localAIProviderSettings", JSON.stringify(normalizedRows));
  const settings = buildProviderSettings(normalizedRows);
  if (settings?.provider) localStorage.setItem("xhandle.aiProvider.active", settings.provider);
  return settings;
}
