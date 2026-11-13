// Shared by the browser and Node proxy. Keep model capability decisions in one
// place; effort support does not imply that legacy manual thinking is valid.
// https://platform.claude.com/docs/en/build-with-claude/effort
function supportsClaudeEffort(model = '') {
  return /^claude-(?:(?:sonnet|opus|fable|mythos)-5(?:[.-]|$)|haiku-5-5(?:[.-]|$)|opus-4-[5678](?:[.-]|$)|sonnet-4-6(?:[.-]|$)|mythos-preview(?:[.-]|$))/i.test(String(model));
}
function usesAdaptiveClaudeThinking(model = '') {
  return supportsClaudeEffort(model) && !/^claude-(?:opus-4-5|mythos-preview)(?:[.-]|$)/i.test(String(model));
}
function isClaudeCollaboratorRequest(body = {}) {
  return /^collaborator\.[a-z-]+$/.test(String(body.xhandleWorkflow || ''));
}
function claudeThinkingAllowance(effort = 'medium') {
  return { low: 4096, medium: 8192, high: 16384 }[effort] || 8192;
}
function claudeAppOutputCeiling(model = '') {
  return /^claude-opus-4(?:-1)?(?:-\d{8})?$/i.test(model) ? 32000 : 64000;
}
function claudeCollaboratorOutputLimit(body, model, requested) {
  if (!isClaudeCollaboratorRequest(body) || !supportsClaudeEffort(model)) return requested;
  const defaultEffort = /^claude-(?:haiku-5-5|opus-5[.-]5)(?:[.-]|$)/i.test(model) ? 'medium' : 'high';
  return Math.min(claudeAppOutputCeiling(model), Math.ceil(requested) + claudeThinkingAllowance(body.effort || defaultEffort));
}
module.exports = { supportsClaudeEffort, usesAdaptiveClaudeThinking, isClaudeCollaboratorRequest, claudeThinkingAllowance, claudeCollaboratorOutputLimit, claudeAppOutputCeiling };
