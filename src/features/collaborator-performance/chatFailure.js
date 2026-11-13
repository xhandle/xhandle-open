const identifier = value => typeof value === 'string' && /^[a-z0-9_.:/-]{1,128}$/i.test(value) ? value : null;
const reasons = new Set(['stop', 'length', 'max_tokens', 'max_output_tokens', 'content_filter', 'refusal', 'tool_calls', 'function_call', 'end_turn', 'pause_turn', 'model_context_window_exceeded']);

export function emptyAssistantResponseError({ headers, finishReason, refused = false, maxTokens, providerAttempts } = {}) {
  const reason = refused ? 'refusal' : reasons.has(finishReason) ? finishReason : 'unknown';
  const error = new Error('assistant_empty_response');
  error.code = 'ASSISTANT_EMPTY_RESPONSE';
  // Read only response metadata, never credentials, prompts or provider text.
  error.diagnostics = {
    provider: identifier(headers?.get?.('x-ai-provider-used')),
    model: identifier(headers?.get?.('x-ai-model-used')),
    effort: identifier(headers?.get?.('x-ai-effort-used')),
    requestId: identifier(headers?.get?.('x-ai-request-id')),
    finishReason: reason,
    requestTokenLimit: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : null,
    ...(Number.isInteger(providerAttempts) && providerAttempts > 0 ? { providerAttempts } : {}),
  };
  return error;
}

export function formatCollaboratorFailure(error) {
  if (error?.code === 'CONTEXT_FORMAT') return 'Collaborator could not prepare the requested lookup because the model returned an unsupported response format twice. Please try again. No saved records were changed.';
  if (error?.code !== 'ASSISTANT_EMPTY_RESPONSE' && error?.message !== 'assistant_empty_response') {
    const detail = String(error?.message || 'unknown error').replace(/^assistant_failed_\d+:?\s*/i, '');
    return `Sorry — I hit an issue generating a reply: ${detail.replace(/[.!]+$/, '')}. Please try again.`;
  }
  const details = error.diagnostics || {};
  const reason = details.finishReason;
  const explanation = ['length', 'max_tokens', 'max_output_tokens'].includes(reason)
    ? 'The AI response reached its output limit before returning an answer. The request could not be completed within the available allowance. Share this message with support.'
    : ['content_filter', 'refusal'].includes(reason)
      ? 'The AI provider filtered or declined the response and returned no answer. Review the request or try a different model.'
      : reason === 'model_context_window_exceeded'
        ? 'The AI model reached its context-window limit before returning an answer. Try a new conversation with a smaller request.'
      : reason === 'pause_turn'
        ? 'The AI provider paused its turn without returning an answer. Please retry and share this message with support if it happens again.'
      : ['tool_calls', 'function_call'].includes(reason)
        ? 'The AI model returned a tool request instead of an answer. Please retry with another model.'
        : 'The AI request completed without returning a readable answer. Please retry. If it happens again, share this message with support.';
  const fields = [['Provider', details.provider], ['Model', details.model], ['Effort', details.effort], ['Completion', reason], ['Request limit', details.requestTokenLimit ? `${details.requestTokenLimit} tokens` : null], ['Provider attempts', details.providerAttempts], ['Request ID', details.requestId]].filter(([, value]) => value);
  return explanation + (fields.length ? '\n\nRequest details: ' + fields.map(([name, value]) => `${name}: ${value}`).join(' · ') : '');
}
