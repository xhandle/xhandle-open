import { generationError } from './generationRecovery';

export const hazardResponseError = (incomplete = false) => generationError(incomplete ? 'HAZARD_OUTPUT_LIMIT' : 'HAZARD_RESPONSE_FORMAT', incomplete
  ? 'The hazard consolidation response was incomplete. Saved assessments and comparisons are retained; resume to retry.'
  : 'The AI provider returned an unreadable hazard consolidation result. Saved assessments and comparisons are retained; resume to retry.');

const normalized = value => Array.isArray(value) ? { groups: value } : value;

// Accept a complete JSON result with optional prose/fences, but never repair
// JSON, extract a nested fragment from a truncated result, or choose between
// multiple results. Membership is validated separately against supplied IDs.
export function parseHazardEquivalenceResponse(content) {
  if (Array.isArray(content) && content.every(part => part && typeof part === 'object' && ['text', 'output_text'].includes(part.type))) content = content.map(part => part.text || '').join('\n');
  if (content && typeof content === 'object') return normalized(content);
  if (typeof content !== 'string' || content.length > 200000 || !content.trim()) throw hazardResponseError();
  const text = content.trim().replace(/^\uFEFF/, '').replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  try { return normalized(JSON.parse(text)); } catch {}
  const candidates = [], stack = [];
  let start = -1, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start < 0) {
      if (char === '{' || char === '[') { start = index; stack.push(char); }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) throw hazardResponseError();
      if (!stack.length) {
        try { candidates.push(normalized(JSON.parse(text.slice(start, index + 1)))); } catch { throw hazardResponseError(); }
        start = -1;
      }
    }
  }
  if (start >= 0 || candidates.length !== 1) throw hazardResponseError();
  return candidates[0];
}
