const { ORGANIZATION_CONTEXT_VERSION, ORGANIZATION_CONTEXT_MAX_BYTES, ORGANIZATION_HEADER_MAX_CHARS, ORGANIZATION_CONTEXT_GUIDANCE } = require('../src/lib/organizationPromptPolicy');

function decodeOrganizationContext(header) {
  if (typeof header !== 'string' || !header || header.length > ORGANIZATION_HEADER_MAX_CHARS || !/^[A-Za-z0-9+/]*={0,2}$/.test(header)) return '';
  try {
    const value = Buffer.from(header, 'base64').toString('utf8');
    const first = value.indexOf('\n'), second = value.indexOf('\n', first + 1);
    const context = value.slice(second + 1);
    if (first < 0 || second < 0 || value.slice(0, first) !== ORGANIZATION_CONTEXT_VERSION || second - first > 140 || !context.startsWith(ORGANIZATION_CONTEXT_GUIDANCE) || Buffer.byteLength(context, 'utf8') > ORGANIZATION_CONTEXT_MAX_BYTES) return '';
    return context;
  } catch { return ''; }
}
function hasGovernedOrganizationContext(messages) {
  return messages.some(message => {
    const parts = typeof message.content === 'string' ? [message.content] : (Array.isArray(message.content) ? message.content.filter(part => part?.type === 'text').map(part => part.text || '') : []);
    return parts.some(text => text.includes(ORGANIZATION_CONTEXT_GUIDANCE) || (text.includes('# xHandle Organization Calibration Context') && text.includes('Apply this profile as governed contextual guidance.')));
  });
}
function withOrganizationPromptContext(messages, header) {
  const context = decodeOrganizationContext(header);
  if (!context || hasGovernedOrganizationContext(messages)) return messages;
  // Keep the task's schema/system instructions after this contextual bias.
  return [{role: 'system', content: context}, ...messages];
}
module.exports = {decodeOrganizationContext, withOrganizationPromptContext};
