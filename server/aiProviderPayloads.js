function resolveOutputTokenLimit(body = {}, fallback = 1200) {
  const value = Number(body.max_tokens ?? body.max_completion_tokens);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function asContentParts(content) {
  if (Array.isArray(content)) return content;
  return [{ type: "text", text: String(content || "") }];
}

function mergeTurnContent(left, right) {
  if (typeof left === "string" && typeof right === "string") {
    return [left, right].filter(Boolean).join("\n\n");
  }
  return [...asContentParts(left), ...asContentParts(right)];
}

function parseDataImageUrl(value = "") {
  const match = String(value).match(/^data:([^;,]+);base64,(.+)$/s);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

function toClaudeContent(content) {
  if (!Array.isArray(content)) return String(content || "");
  return content.map((part) => {
    if (part?.type === "text") {
      return { type: "text", text: String(part.text || "") };
    }
    if (part?.type === "image_url") {
      const url = String(part.image_url?.url || "");
      const dataImage = parseDataImageUrl(url);
      if (dataImage) {
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: dataImage.mediaType,
            data: dataImage.data,
          },
        };
      }
      return {
        type: "image",
        source: { type: "url", url },
      };
    }
    return { type: "text", text: JSON.stringify(part) };
  }).filter((part) => (
    part.type === "image"
      ? Boolean(part.source?.data || part.source?.url)
      : Boolean(part.text)
  ));
}

function normalizeClaudeConversation(conversation = [], fallbackPrompt = "Continue.") {
  const normalized = [];
  conversation.forEach((message) => {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = toClaudeContent(message?.content);
    if (
      (typeof content === "string" && !content.trim())
      || (Array.isArray(content) && content.length === 0)
    ) return;
    const previous = normalized[normalized.length - 1];
    if (previous?.role === role) {
      previous.content = mergeTurnContent(previous.content, content);
    } else {
      normalized.push({ role, content });
    }
  });

  if (!normalized.length) {
    normalized.push({ role: "user", content: fallbackPrompt || "Continue." });
  } else if (normalized[0].role === "assistant") {
    normalized.unshift({
      role: "user",
      content: "Use the following prior assistant context to continue the requested task.",
    });
  }
  if (normalized[normalized.length - 1].role === "assistant") {
    normalized.push({
      role: "user",
      content: "Continue with the user's latest request using all choices and context already provided.",
    });
  }
  return normalized;
}

function buildClaudeRequestPayload({ body = {}, model, system = "", conversation = [] }) {
  const payload = {
    model,
    max_tokens: resolveOutputTokenLimit(body),
    messages: normalizeClaudeConversation(conversation, body.prompt || "Continue."),
  };

  if (system) payload.system = system;
  if (typeof body.temperature === "number") {
    payload.temperature = body.temperature;
  } else if (typeof body.top_p === "number") {
    payload.top_p = body.top_p;
  }
  if (typeof body.top_k === "number") payload.top_k = body.top_k;
  if (Array.isArray(body.stop_sequences)) payload.stop_sequences = body.stop_sequences;
  return payload;
}

function toGeminiParts(content) {
  if (!Array.isArray(content)) return [{ text: String(content || "") }];
  return content.map((part) => {
    if (part?.type === "text") return { text: String(part.text || "") };
    if (part?.type === "image_url") {
      const dataImage = parseDataImageUrl(part.image_url?.url);
      if (dataImage) {
        return {
          inlineData: {
            mimeType: dataImage.mediaType,
            data: dataImage.data,
          },
        };
      }
      return { fileData: { fileUri: String(part.image_url?.url || "") } };
    }
    return { text: JSON.stringify(part) };
  }).filter((part) => Boolean(
    part.text || part.inlineData?.data || part.fileData?.fileUri
  ));
}

function buildGeminiRequestPayload({ body = {}, system = "", conversation = [] }) {
  const payload = {
    contents: (conversation.length
      ? conversation
      : [{ role: "user", content: body.prompt || "Continue." }]
    ).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(message.content),
    })),
  };

  if (system) {
    payload.system_instruction = {
      parts: [{ text: system }],
    };
  }

  const generationConfig = {};
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  if (typeof body.top_p === "number") generationConfig.topP = body.top_p;
  const maxOutputTokens = Number(body.max_tokens ?? body.max_completion_tokens);
  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = maxOutputTokens;
  }
  if (Array.isArray(body.stop_sequences)) generationConfig.stopSequences = body.stop_sequences;
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;
  return payload;
}

module.exports = {
  buildClaudeRequestPayload,
  buildGeminiRequestPayload,
  normalizeClaudeConversation,
  resolveOutputTokenLimit,
  toClaudeContent,
  toGeminiParts,
};
