/**
 * Privacy-safe timing and size telemetry for AI provider requests.
 * Prompt/response contents and credentials must never be recorded here.
 */

function sanitizeWorkflowName(value) {
  const normalized = String(value || "unspecified")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "unspecified";
}

function summarizeChatInput(messages = []) {
  let inputTextChars = 0;
  let imageCount = 0;

  const visitContent = (content) => {
    if (typeof content === "string") {
      inputTextChars += content.length;
      return;
    }
    if (!Array.isArray(content)) return;
    content.forEach((part) => {
      if (typeof part === "string") {
        inputTextChars += part.length;
      } else if (part?.type === "text" || part?.type === "input_text") {
        inputTextChars += String(part.text || "").length;
      } else if (part?.type === "image_url" || part?.type === "image" || part?.type === "input_image") {
        imageCount += 1;
      }
    });
  };

  (Array.isArray(messages) ? messages : []).forEach((message) => visitContent(message?.content));
  return {
    messageCount: Array.isArray(messages) ? messages.length : 0,
    inputTextChars,
    approximateInputTokens: Math.ceil(inputTextChars / 4),
    imageCount,
  };
}

function createAIRequestMetrics({
  logger,
  requestId,
  workflow,
  provider,
  model,
  effort,
  stream,
  messages,
  maxOutputTokens,
  now = Date.now,
}) {
  const startedAt = now();
  let firstTokenAt = null;
  let outputTextChars = 0;
  let completed = false;
  const base = {
    requestId,
    workflow: sanitizeWorkflowName(workflow),
    provider,
    model,
    effort: effort || "automatic",
    stream: Boolean(stream),
    maxOutputTokens: Number(maxOutputTokens) || null,
    ...summarizeChatInput(messages),
  };

  logger?.info?.(`[ai-request] ${JSON.stringify({ event: "started", ...base })}`);

  const markFirstToken = () => {
    if (firstTokenAt == null) firstTokenAt = now();
  };
  const addOutput = (value) => {
    const length = String(value || "").length;
    if (!length) return;
    markFirstToken();
    outputTextChars += length;
  };
  const finish = ({ status = "completed", finishReason = "stop", errorCode = null } = {}) => {
    if (completed) return;
    completed = true;
    const endedAt = now();
    logger?.info?.(`[ai-request] ${JSON.stringify({
      event: "finished",
      ...base,
      status,
      finishReason,
      errorCode,
      timeToFirstTokenMs: firstTokenAt == null ? null : firstTokenAt - startedAt,
      elapsedMs: endedAt - startedAt,
      outputTextChars,
      approximateOutputTokens: Math.ceil(outputTextChars / 4),
    })}`);
  };

  return { addOutput, finish, markFirstToken };
}

module.exports = {
  createAIRequestMetrics,
  sanitizeWorkflowName,
  summarizeChatInput,
};
