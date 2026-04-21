/**
 * xHandle: backend config API configuration helper.
 * This file defines client-side network configuration for talking to the xHandle backend while preserving the local-first frontend architecture.
 * Centralizing backend URL and auth-option logic keeps AI calls, document operations, and licensing requests consistent across features.
 * Related files: server.js, src/features/hazard-analysis/aiAnalysisLite.js, src/components/generateAgenticReport.js.
 */

// backendConfig.js
import { logger } from "../utils/logger";

const isBrowser = typeof window !== "undefined";
const isLocalHost =
  isBrowser &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");
const localBackendDefault = "http://localhost:5001";
const browserOrigin = isBrowser ? window.location.origin : "";
const runtimeBackendURL =
  isBrowser && typeof window.__BACKEND_URL === "string"
    ? window.__BACKEND_URL.trim()
    : "";
const configuredBackendURL = String(process.env.REACT_APP_BACKEND_URL || "").trim();
const shouldSendAccountIdHeader =
  isLocalHost || process.env.REACT_APP_TRUST_X_ACCOUNT_ID === "true";
const LOCAL_AI_PROVIDER_KEY = "xhandle.aiProvider.active";
const LOCAL_AI_PROVIDER_KEYS_KEY = "xhandle.aiProvider.keys";

export const backendURL =
  configuredBackendURL ||
  runtimeBackendURL ||
  (isLocalHost ? localBackendDefault : (browserOrigin || localBackendDefault));
export const ACCOUNT_ID = "xhandle-local";

function normalizeAIProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "anthropic") return "claude";
  if (normalized === "google" || normalized === "google-gemini") return "gemini";
  if (normalized === "openai" || normalized === "claude" || normalized === "gemini") {
    return normalized;
  }
  return "openai";
}

function safeReadProviderMap() {
  if (!isBrowser) return {};
  try {
    const raw = localStorage.getItem(LOCAL_AI_PROVIDER_KEYS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function safeWriteProviderMap(providerMap) {
  if (!isBrowser) return;
  localStorage.setItem(LOCAL_AI_PROVIDER_KEYS_KEY, JSON.stringify(providerMap));
}

function maskProviderKey(apiKey) {
  const normalized = String(apiKey || "").trim();
  if (!normalized) return null;
  return normalized.length <= 8 ? "••••••••" : `${normalized.slice(0, 3)}...${normalized.slice(-4)}`;
}

export function getLocalAIProviderStatus() {
  const providerMap = safeReadProviderMap();
  const activeProvider = normalizeAIProvider(
    (isBrowser && localStorage.getItem(LOCAL_AI_PROVIDER_KEY)) ||
    Object.keys(providerMap)[0] ||
    "openai"
  );

  const savedProviders = Object.entries(providerMap)
    .filter(([, record]) => record?.apiKey)
    .map(([provider, record]) => ({
      provider: normalizeAIProvider(provider),
      label: normalizeAIProvider(provider) === "claude" ? "Claude" : normalizeAIProvider(provider) === "gemini" ? "Gemini" : "OpenAI",
      connected: true,
      verified: true,
      isActive: normalizeAIProvider(provider) === activeProvider,
      maskedKey: maskProviderKey(record.apiKey),
      last4: String(record.apiKey || "").slice(-4) || null,
      updatedAt: record.updatedAt || null,
    }))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

  return {
    ok: true,
    activeProvider: savedProviders.length ? activeProvider : null,
    savedProviders,
    connected: savedProviders.some((provider) => provider.isActive),
  };
}

export function saveLocalAIProviderKey(provider, apiKey, options = {}) {
  if (!isBrowser) return getLocalAIProviderStatus();
  const normalizedProvider = normalizeAIProvider(provider);
  const trimmedKey = String(apiKey || "").trim();
  const providerMap = safeReadProviderMap();
  providerMap[normalizedProvider] = {
    apiKey: trimmedKey,
    updatedAt: new Date().toISOString(),
  };
  safeWriteProviderMap(providerMap);
  if (options.activate !== false) {
    localStorage.setItem(LOCAL_AI_PROVIDER_KEY, normalizedProvider);
  }
  return getLocalAIProviderStatus();
}

export function activateLocalAIProvider(provider) {
  if (!isBrowser) return getLocalAIProviderStatus();
  const normalizedProvider = normalizeAIProvider(provider);
  const providerMap = safeReadProviderMap();
  if (!providerMap[normalizedProvider]?.apiKey) {
    throw new Error("No saved key for that provider");
  }
  localStorage.setItem(LOCAL_AI_PROVIDER_KEY, normalizedProvider);
  return getLocalAIProviderStatus();
}

export function deleteLocalAIProviderKey(provider) {
  if (!isBrowser) return getLocalAIProviderStatus();
  const normalizedProvider = normalizeAIProvider(provider);
  const providerMap = safeReadProviderMap();
  delete providerMap[normalizedProvider];
  safeWriteProviderMap(providerMap);

  const currentActive = normalizeAIProvider(localStorage.getItem(LOCAL_AI_PROVIDER_KEY));
  if (currentActive === normalizedProvider) {
    const nextProvider = Object.keys(providerMap)[0];
    if (nextProvider) localStorage.setItem(LOCAL_AI_PROVIDER_KEY, normalizeAIProvider(nextProvider));
    else localStorage.removeItem(LOCAL_AI_PROVIDER_KEY);
  }

  return getLocalAIProviderStatus();
}

// Debug only. Avoid persisting deployment-specific defaults into localStorage.
if (isBrowser) {
  window.__BACKEND_URL = backendURL;
  logger.info("[xHandle] backendURL =", backendURL);
}

/**
 * buildAuthOpts constructs the derived result needed by the feature for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param extraHeaders Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function buildAuthOpts(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (shouldSendAccountIdHeader && ACCOUNT_ID) {
    headers["x-account-id"] = ACCOUNT_ID;
  }
  return {
    credentials: "include",
    headers,
  };
}

export function buildAIAuthOpts(extraHeaders = {}) {
  const status = getLocalAIProviderStatus();
  const activeProvider = status.activeProvider;
  const activeRecord = status.savedProviders.find((provider) => provider.provider === activeProvider);
  const providerMap = safeReadProviderMap();
  const apiKey = activeProvider ? providerMap[activeProvider]?.apiKey || "" : "";

  return buildAuthOpts({
    ...(activeProvider && activeRecord?.connected ? { "x-ai-provider": activeProvider } : {}),
    ...(apiKey ? { "x-ai-api-key": apiKey } : {}),
    ...extraHeaders,
  });
}
