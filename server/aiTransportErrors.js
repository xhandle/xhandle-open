// No provider response means this is connectivity, not a model validation error.
const connectivityCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EPIPE']);
function classifyAITransportError(error) {
  if (error?.response?.status || error?.status) return null;
  const code = error?.code || error?.cause?.code;
  if (!connectivityCodes.has(code)) return null;
  return { status: 503, code: 'AI_PROVIDER_UNAVAILABLE', retryable: true,
    message: 'Unable to connect to the AI provider. Check the internet connection and try again.' };
}
module.exports = { classifyAITransportError };
