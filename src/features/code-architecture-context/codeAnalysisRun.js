import { FUNCTIONAL_RECOVERY_POLICY, FUNCTIONAL_OUTPUT_TOKENS, FUNCTIONAL_MAX_OUTPUT_TOKENS } from './functionalAnalysisPolicy';
import { digestText } from './codeSourceAcquisition';
export const ANALYSIS_VERSION = 'source-equivalence-v5-domain-neutral';
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export function settingsFromAuth(options = {}) {
  const h = options.headers || {};
  const get = key => typeof h.get === 'function' ? h.get(key) : h[key];
  return { provider: get('x-ai-provider') || '', model: get('x-ai-model') || '', effort: get('x-ai-effort') || '', temperature: 0.2, maxTokens: FUNCTIONAL_OUTPUT_TOKENS, recoveryMaxTokens: FUNCTIONAL_MAX_OUTPUT_TOKENS, recoveryPolicy: FUNCTIONAL_RECOVERY_POLICY };
}
export function runChanged(message) { const error = new Error(message); error.code = 'SOURCE_RUN_CHANGED'; return error; }
export function createRunGuard(readSettings) {
  const settings = readSettings();
  let actual = null, invalid = null;
  return {
    settings,
    get actual() { return actual; },
    check() {
      if (invalid) throw invalid;
      if (stableJson(settings) !== stableJson(readSettings())) {
        invalid = runChanged('AI settings changed during analysis. Previous results were preserved; restart with the new settings.');
        throw invalid;
      }
    },
    observe(response) {
      this.check();
      const provider = response.headers?.get?.('X-AI-Provider-Used');
      const model = response.headers?.get?.('X-AI-Model-Used');
      if (!provider || !model) { invalid = runChanged('The AI response did not identify its effective provider/model. Analysis was not published.'); throw invalid; }
      const next = { provider, model, effort: response.headers?.get?.('X-AI-Effort-Used') || 'automatic' };
      if ((actual && stableJson(actual) !== stableJson(next)) || (settings.provider && provider !== settings.provider) || (settings.model && model !== settings.model) || (settings.effort && settings.effort !== 'automatic' && next.effort !== settings.effort)) {
        invalid = runChanged('AI response settings differ from this run. Previous results were preserved.'); throw invalid;
      }
      actual = next;
    },
    restore(actualSettings) { actual = actualSettings || null; },
  };
}
export function runFingerprint(input) { return digestText(stableJson({ version: ANALYSIS_VERSION, ...input })); }
