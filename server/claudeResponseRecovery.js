const { isClaudeCollaboratorRequest, claudeAppOutputCeiling } = require('../src/lib/claudeModelCapabilities');

function claudeResponseText(data) {
  return (Array.isArray(data?.content) ? data.content : []).filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('');
}

// Only replay an empty, completed Collaborator request once. Never change the
// chosen model/effort, replay a partial answer, or retry a refusal/HTTP failure.
function claudeRecoveryPayload(payload, { body, finishReason, hasText, attempt = 0 } = {}) {
  if (!isClaudeCollaboratorRequest(body) || attempt || hasText) return null;
  if (finishReason === 'length') {
    const maxTokens = Math.min(claudeAppOutputCeiling(payload.model), payload.max_tokens * 2);
    return maxTokens > payload.max_tokens ? { ...payload, max_tokens: maxTokens } : null;
  }
  if (finishReason !== 'stop') return null;
  const instruction = 'The previous request completed without a user-facing answer. Complete the user’s latest requested task now, using the choices and evidence already supplied. Return the requested answer or structured output; do not repeat setup questions. If the request cannot be fulfilled, provide a clear explanation.';
  const messages = payload.messages.map(message => ({ ...message }));
  const last = messages.at(-1);
  if (last?.role === 'user') last.content = typeof last.content === 'string' ? `${last.content}\n\n${instruction}` : [...last.content, { type: 'text', text: instruction }];
  else messages.push({ role: 'user', content: instruction });
  return { ...payload, messages };
}

module.exports = { claudeResponseText, claudeRecoveryPayload };
