const USD_PER_MILLION = 1000000;

export const CODE_ARCHITECTURE_METRICS_STORAGE_KEY = "xhandle.codeArchitectureMetrics.v1";

export const DEFAULT_MODEL_TOKEN_PRICES_USD_PER_MILLION = {
  "openai:gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai:gpt-4o": { input: 2.5, output: 10 },
  "openai:gpt-4.1": { input: 2, output: 8 },
  "openai:gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "openai:gpt-5-mini": { input: 0.25, output: 2 },
  "anthropic:claude-haiku-4-5": { input: 1, output: 5 },
  "anthropic:claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "anthropic:claude-sonnet-5": { input: 3, output: 15 },
  "anthropic:claude-opus-5": { input: 5, output: 25 },
  "anthropic:claude-fable-5": { input: 10, output: 50 },
  "anthropic:claude-opus-4-1-20250805": { input: 15, output: 75 },
  "anthropic:claude-opus-4-20250514": { input: 15, output: 75 },
  "anthropic:claude-sonnet-4-20250514": { input: 3, output: 15 },
  "anthropic:claude-3-7-sonnet-20250219": { input: 3, output: 15 },
  "anthropic:claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "anthropic:claude-3-5-haiku-latest": { input: 0.8, output: 4 },
  "gemini:gemini-3.6-flash": { input: 0.3, output: 2.5 },
  "gemini:gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "gemini:gemini-3.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini:gemini-3.1-pro-preview": { input: 1.25, output: 10 },
  "gemini:gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "gemini:gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini:gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini:gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini:gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsage(usage = {}) {
  const inputTokens = Number(
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.cache_creation_input_tokens ??
    usage.promptTokenCount ??
    0
  ) || 0;
  const outputTokens = Number(
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.candidatesTokenCount ??
    0
  ) || 0;
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokenCount ?? 0) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function pricingKey(provider, model) {
  return `${String(provider || "openai").trim().toLowerCase()}:${String(model || "").trim().toLowerCase()}`;
}

export function estimateModelCostUsd({ provider = "openai", model = "", usage = {}, priceTable = DEFAULT_MODEL_TOKEN_PRICES_USD_PER_MILLION } = {}) {
  const key = pricingKey(provider, model);
  const price = priceTable[key];
  if (!price) return null;
  const normalizedUsage = normalizeUsage(usage);
  const inputCost = (normalizedUsage.inputTokens / USD_PER_MILLION) * Number(price.input || 0);
  const outputCost = (normalizedUsage.outputTokens / USD_PER_MILLION) * Number(price.output || 0);
  return inputCost + outputCost;
}

export function createFunctionalDecompositionMetricsRun({ projectId = "", repoId = "", owner = "", repo = "" } = {}) {
  const startedAtMs = Date.now();
  return {
    id: `cba-metrics-${projectId || "project"}-${repoId || repo || "repo"}-${startedAtMs}`,
    projectId,
    repoId,
    owner,
    repo,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    completedAt: null,
    durationMs: 0,
    aiCallCount: 0,
    failedAiCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    estimatedCostAvailable: false,
    models: {},
    calls: [],
  };
}

export function recordFunctionalDecompositionAiCall(run, call = {}) {
  if (!run) return run;
  const usage = normalizeUsage(call.usage || {});
  const provider = call.provider || "openai";
  const model = call.model || "";
  const cost = estimateModelCostUsd({ provider, model, usage: call.usage || usage });
  const modelKey = pricingKey(provider, model || "unknown");
  const nextModel = run.models[modelKey] || {
    provider,
    model,
    aiCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    estimatedCostAvailable: false,
  };

  nextModel.aiCallCount += 1;
  nextModel.inputTokens += usage.inputTokens;
  nextModel.outputTokens += usage.outputTokens;
  nextModel.totalTokens += usage.totalTokens;
  if (typeof cost === "number") {
    nextModel.estimatedCostUsd += cost;
    nextModel.estimatedCostAvailable = true;
    run.estimatedCostUsd += cost;
    run.estimatedCostAvailable = true;
  }

  run.models[modelKey] = nextModel;
  run.aiCallCount += 1;
  run.inputTokens += usage.inputTokens;
  run.outputTokens += usage.outputTokens;
  run.totalTokens += usage.totalTokens;
  run.calls.push({
    label: call.label || "AI call",
    provider,
    model,
    durationMs: Number(call.durationMs || 0),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: typeof cost === "number" ? cost : null,
    createdAt: nowIso(),
  });
  return run;
}

export function finishFunctionalDecompositionMetricsRun(run, patch = {}) {
  if (!run) return null;
  const completedAtMs = Date.now();
  return {
    ...run,
    ...patch,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - (run.startedAtMs || completedAtMs),
    models: run.models,
    calls: run.calls,
  };
}

export function saveFunctionalDecompositionMetricsRun(run) {
  if (typeof localStorage === "undefined" || !run) return;
  try {
    const existing = JSON.parse(localStorage.getItem(CODE_ARCHITECTURE_METRICS_STORAGE_KEY) || "[]");
    const list = Array.isArray(existing) ? existing : [];
    const next = [run, ...list.filter((entry) => entry?.id !== run.id)].slice(0, 100);
    localStorage.setItem(CODE_ARCHITECTURE_METRICS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

export function formatDuration(durationMs = 0) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "cost unavailable";
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
