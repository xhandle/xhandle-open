import {
  getStoredAIProviderApiKey,
  getStoredActiveAIProvider,
  getStoredAIProviderModelPreference,
} from "./aiProviderConfig";

const AI_ENDPOINT_RE = /\/api\/(?:chat|chatgpt|openai)(?:$|[/?#])/;

function isLocalAIRequest(input) {
  const raw = typeof input === "string" ? input : input?.url;
  if (!raw) return false;
  try {
    const url = new URL(raw, window.location.origin);
    const configuredBackend =
      window.__BACKEND_URL ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("backendURL") : null) ||
      "";
    const configuredOrigin = configuredBackend ? new URL(configuredBackend, window.location.origin).origin : "";
    const isSameOrigin = url.origin === window.location.origin;
    const isConfiguredBackend = configuredOrigin && url.origin === configuredOrigin;
    const isLoopbackBackend = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
    return (isSameOrigin || isConfiguredBackend || isLoopbackBackend) && AI_ENDPOINT_RE.test(url.pathname);
  } catch {
    return AI_ENDPOINT_RE.test(String(raw));
  }
}

function mergeAIHeaders(init = {}) {
  const headers = new Headers(init.headers || {});
  const provider = getStoredActiveAIProvider();
  const apiKey = getStoredAIProviderApiKey(provider);
  const selectedModel = getStoredAIProviderModelPreference(provider, { includeDefault: true });

  if (provider && !headers.has("x-ai-provider")) headers.set("x-ai-provider", provider);
  if (apiKey && !headers.has("x-ai-api-key")) headers.set("x-ai-api-key", apiKey);
  if (selectedModel && !headers.has("x-ai-model")) headers.set("x-ai-model", selectedModel);

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
      const mergedInit = mergeAIHeaders({
        method: input.method,
        headers: input.headers,
        body: init.body ?? input.body,
        mode: input.mode,
        credentials: init.credentials ?? input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: init.signal ?? input.signal,
        ...init,
      });
      return nativeFetch(new Request(input, mergedInit));
    }

    return nativeFetch(input, mergeAIHeaders(init));
  };

  window.__xhandleAIRequestAuthShimInstalled = true;
}
