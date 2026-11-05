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
  clientTraceId,
  startedAt: suppliedStartedAt,
  workflow,
  provider,
  model,
  effort,
  stream,
  messages,
  maxOutputTokens,
  now = Date.now,
}) {
  const startedAt = suppliedStartedAt ?? now();
  let providerStartedAt=null;
  let firstTokenAt = null;
  let outputTextChars = 0;
  let completed = false;
  let finalReport = null;
  const base = {
    requestId,
    clientTraceId: typeof clientTraceId==='string'&&/^ct-[a-z0-9-]{10,80}$/i.test(clientTraceId)?clientTraceId:null,
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
    if (completed) return finalReport;
    completed = true;
    const endedAt = now();
    finalReport={
      event: "finished",
      ...base,
      status,
      finishReason,
      errorCode,
      providerStartOffsetMs: providerStartedAt==null?null:providerStartedAt-startedAt,
      providerTimeToFirstTokenMs: firstTokenAt==null||providerStartedAt==null?null:firstTokenAt-providerStartedAt,
      timeToFirstTokenMs: firstTokenAt == null ? null : firstTokenAt - startedAt,
      elapsedMs: endedAt - startedAt,
      outputTextChars,
      approximateOutputTokens: Math.ceil(outputTextChars / 4),
    };
    logger?.info?.(`[ai-request] ${JSON.stringify(finalReport)}`);
    return {...finalReport};
  };

  return { addOutput, finish, markFirstToken, markProviderStarted:()=>{if(providerStartedAt==null)providerStartedAt=now();} };
}

module.exports = {
  createAIRequestMetrics,
  sanitizeWorkflowName,
  summarizeChatInput,
};
