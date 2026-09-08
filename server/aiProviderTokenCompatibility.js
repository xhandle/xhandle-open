function errorMessage(error) {
  const payload = error?.response?.data || error?.error || error?.cause || {};
  return String(
    payload?.error?.message
      || payload?.message
      || error?.message
      || "",
  );
}

const REMOVABLE_SAMPLING_CONTROLS = [
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "logit_bias",
];

function buildChatCompletionCompatibilityRetry(payload = {}, error) {
  const message = errorMessage(error).toLowerCase();
  const unsupported = /unsupported (?:parameter|value)|not supported|unknown parameter|deprecated/.test(message);
  if (!unsupported) return null;

  if (
    payload.max_tokens != null
    && message.includes("max_tokens")
    && (message.includes("max_completion_tokens") || message.includes("not supported"))
  ) {
    const retry = { ...payload, max_completion_tokens: payload.max_tokens };
    delete retry.max_tokens;
    return retry;
  }

  if (
    payload.max_completion_tokens != null
    && message.includes("max_completion_tokens")
    && (message.includes("max_tokens") || message.includes("not supported"))
  ) {
    const retry = { ...payload, max_tokens: payload.max_completion_tokens };
    delete retry.max_completion_tokens;
    return retry;
  }

  for (const field of REMOVABLE_SAMPLING_CONTROLS) {
    if (payload[field] == null || !message.includes(field)) continue;
    const retry = { ...payload };
    delete retry[field];
    return retry;
  }

  return null;
}

async function executeProviderRequestWithCompatibility(create, payload, onRetry = () => {}) {
  let currentPayload = payload;
  const maxCompatibilityRetries = 6;

  for (let attempt = 0; attempt <= maxCompatibilityRetries; attempt += 1) {
    try {
      return await create(currentPayload);
    } catch (error) {
      if (attempt === maxCompatibilityRetries) throw error;
      const retryPayload = buildChatCompletionCompatibilityRetry(currentPayload, error);
      if (!retryPayload) throw error;

      const removed = Object.keys(currentPayload).filter((key) => !(key in retryPayload));
      const added = Object.keys(retryPayload).filter((key) => !(key in currentPayload));
      onRetry({
        model: currentPayload.model,
        attempt: attempt + 1,
        removed,
        added,
      });
      currentPayload = retryPayload;
    }
  }

  throw new Error("Chat completion compatibility retries exhausted.");
}

async function createChatCompletionWithTokenCompatibility(openai, payload, onRetry = () => {}, requestOptions = {}) {
  return executeProviderRequestWithCompatibility(
    (compatiblePayload) => openai.chat.completions.create(compatiblePayload, requestOptions),
    payload,
    onRetry,
  );
}

module.exports = {
  buildChatCompletionCompatibilityRetry,
  buildTokenLimitCompatibilityRetry: buildChatCompletionCompatibilityRetry,
  createChatCompletionWithTokenCompatibility,
  executeProviderRequestWithCompatibility,
};
