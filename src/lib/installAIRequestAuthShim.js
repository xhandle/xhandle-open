import {
  getStoredAIProviderApiKey,
  getStoredActiveAIProvider,
  getStoredAIProviderEffortPreference,
  getStoredAIProviderModelPreference,
  supportsAIProviderEffort,
} from "./aiProviderConfig";
import { organizationPromptHeaders } from '../features/organization-profile/organizationPromptContext';

const AI_ENDPOINT_RE = /^(?:\/api\/(?:chat|chatgpt|openai)|\/api\/rt\/session|\/chat)\/?$/;

function isLocalAIRequest(input) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  if (!raw) return false;
  try {
    const current = new URL(window.location.href);
    const url = new URL(raw, current);
    const configuredBackend =
      window.__BACKEND_URL ||
      process.env.REACT_APP_BACKEND_URL ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("backendURL") : null) ||
      "";
    const configured = configuredBackend ? new URL(configuredBackend, current) : null;
    // Registered Electron schemes can report a null URL.origin. Compare their
    // protocol/host explicitly; never equate unrelated null-origin URLs.
    const same = target => target && url.protocol === target.protocol && url.host === target.host;
    const isSameOrigin = same(current);
    const isConfiguredBackend = same(configured);
    const isLoopbackBackend = /^https?:$/.test(url.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
    return (isSameOrigin || isConfiguredBackend || isLoopbackBackend) && AI_ENDPOINT_RE.test(url.pathname);
  } catch {
    return AI_ENDPOINT_RE.test(String(raw));
  }
}

function mergeAIHeaders(init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [name, value] of Object.entries(organizationPromptHeaders({hint: typeof init.body === 'string' ? init.body.slice(0, 1600) : ''}))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const provider = getStoredActiveAIProvider();
  const apiKey = getStoredAIProviderApiKey(provider);
  const selectedModel = getStoredAIProviderModelPreference(provider, { includeDefault: true });
  const selectedEffort = supportsAIProviderEffort(provider, selectedModel)
    ? getStoredAIProviderEffortPreference(provider)
    : "";

  if (provider && !headers.has("x-ai-provider")) headers.set("x-ai-provider", provider);
  if (apiKey && !headers.has("x-ai-api-key")) headers.set("x-ai-api-key", apiKey);
  if (selectedModel && !headers.has("x-ai-model")) headers.set("x-ai-model", selectedModel);
  if (selectedEffort && !headers.has("x-ai-effort")) headers.set("x-ai-effort", selectedEffort);

  return {
    ...init,
    headers,
  };
}

export function installAIRequestAuthShim() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__xhandleAIRequestAuthShimInstalled) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!isLocalAIRequest(input)) return nativeFetch(input, init);

    if (input instanceof Request) {
      // Let Request inherit its own body, signal and fetch options. Supplying
      // input.body explicitly turns it into a new streaming body in Chromium,
      // which requires duplex and can break otherwise valid POST requests.
      const mergedInit = mergeAIHeaders({
        ...init,
        headers: init.headers ?? input.headers,
      });
      return nativeFetch(new Request(input, mergedInit));
    }

    return nativeFetch(input, mergeAIHeaders(init));
  };

  window.__xhandleAIRequestAuthShimInstalled = true;
}
