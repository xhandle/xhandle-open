const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const MAX_PROVIDER_ERROR_BYTES = 1_000_000;

function parseAnthropicSseEvent(block = "") {
  let event = "message";
  const dataLines = [];

  String(block).split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith(":")) return;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  });

  if (!dataLines.length) return { event, data: null };
  const rawData = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
}

function anthropicStopReasonToOpenAI(stopReason = "") {
  return stopReason === "max_tokens" ? "length" : "stop";
}

function anthropicStreamEventValue({ event, data } = {}) {
  const eventType = data?.type || event;
  if (eventType === "content_block_start" && data?.content_block?.type === "text") {
    return { text: String(data.content_block.text || "") };
  }
  if (eventType === "content_block_delta" && data?.delta?.type === "text_delta") {
    return { text: String(data.delta.text || "") };
  }
  if (eventType === "message_delta") {
    return {
      finishReason: data?.delta?.stop_reason
        ? anthropicStopReasonToOpenAI(data.delta.stop_reason)
        : undefined,
    };
  }
  if (eventType === "message_stop") return { done: true };
  if (eventType === "ping") return { keepAlive: true };
  if (eventType === "error") {
    const message = data?.error?.message || data?.message || "Anthropic stream failed.";
    const error = new Error(String(message));
    error.status = 502;
    return { error };
  }
  return {};
}

async function readNodeStreamText(stream, maxBytes = MAX_PROVIDER_ERROR_BYTES) {
  let value = "";
  for await (const chunk of stream) {
    value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
      value = value.slice(0, maxBytes);
      break;
    }
  }
  return value;
}

function parseProviderErrorPayload(value = "") {
  try {
    return JSON.parse(value);
  } catch {
    return { error: { message: String(value || "Anthropic request failed.") } };
  }
}

async function requestAnthropicMessageStream({
  axiosClient,
  apiKey,
  payload,
  timeoutMs,
  signal,
  executeWithCompatibility,
  onRetry,
}) {
  return executeWithCompatibility(async (compatiblePayload) => {
    const response = await axiosClient.post(
      ANTHROPIC_MESSAGES_URL,
      { ...compatiblePayload, stream: true },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        responseType: "stream",
        signal,
        timeout: timeoutMs,
        validateStatus: () => true,
      },
    );

    if (response.status >= 200 && response.status < 300) return response;

    const data = parseProviderErrorPayload(await readNodeStreamText(response.data));
    const error = new Error(data?.error?.message || data?.message || `Anthropic request failed (${response.status}).`);
    error.response = { status: response.status, data };
    throw error;
  }, payload, onRetry);
}

async function writeWithBackpressure(res, value) {
  if (res.destroyed || res.writableEnded) return false;
  if (res.write(value)) return true;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.removeListener("drain", handleDrain);
      res.removeListener("close", handleClose);
      res.removeListener("error", handleError);
    };
    const handleDrain = () => { cleanup(); resolve(); };
    const handleClose = () => { cleanup(); resolve(); };
    const handleError = (error) => { cleanup(); reject(error); };
    res.once("drain", handleDrain);
    res.once("close", handleClose);
    res.once("error", handleError);
  });
  return !(res.destroyed || res.writableEnded);
}

async function pipeAnthropicSseToClient(providerStream, res) {
  let buffer = "";
  let finishReason = "stop";
  let providerDone = false;

  const processBlock = async (block) => {
    if (!block.trim()) return;
    const value = anthropicStreamEventValue(parseAnthropicSseEvent(block));
    if (value.error) throw value.error;
    if (value.finishReason) finishReason = value.finishReason;
    if (value.text) await writeWithBackpressure(res, `data: ${JSON.stringify(value.text)}\n\n`);
    if (value.keepAlive) await writeWithBackpressure(res, ": ping\n\n");
    if (value.done) providerDone = true;
  };

  for await (const chunk of providerStream) {
    if (res.destroyed || res.writableEnded) break;
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) await processBlock(block);
  }

  if (buffer.trim() && !res.destroyed && !res.writableEnded) await processBlock(buffer);
  if (res.destroyed || res.writableEnded) return { finishReason, providerDone, clientClosed: true };
  if (!providerDone) throw new Error("Anthropic stream ended before message_stop.");

  await writeWithBackpressure(
    res,
    `event: metadata\ndata: ${JSON.stringify({ finish_reason: finishReason })}\n\n`,
  );
  await writeWithBackpressure(res, "event: done\ndata: [DONE]\n\n");
  res.end();
  return { finishReason, providerDone, clientClosed: false };
}

function createRequestCancellation(req, res, { timeoutMs = 0 } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new Error("client_disconnected"));
  };
  const abortForTimeout = () => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort(new Error("provider_request_timed_out"));
  };
  const handleResponseClose = () => {
    if (!res.writableEnded) abort();
  };
  const timeoutId = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(abortForTimeout, timeoutMs)
    : null;

  req.once("aborted", abort);
  res.once("close", handleResponseClose);

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      if (timeoutId) clearTimeout(timeoutId);
      req.removeListener("aborted", abort);
      res.removeListener("close", handleResponseClose);
    },
  };
}

module.exports = {
  anthropicStopReasonToOpenAI,
  anthropicStreamEventValue,
  createRequestCancellation,
  parseAnthropicSseEvent,
  pipeAnthropicSseToClient,
  requestAnthropicMessageStream,
};
