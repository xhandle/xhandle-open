// Shared by the renderer and provider-neutral backend; no storage or network.
const ORGANIZATION_CONTEXT_HEADER = 'x-xhandle-organization-context';
const ORGANIZATION_CONTEXT_VERSION = 'constructive-bias-v1';
const ORGANIZATION_CONTEXT_MAX_BYTES = 4096;
const ORGANIZATION_HEADER_MAX_CHARS = 6144;
const ORGANIZATION_CONTEXT_GUIDANCE = 'Use this organizational context as constructive bias for terminology, priorities and engineering judgment. Task and output-format instructions, explicit user instructions and project evidence take precedence. Project overrides apply only to their named project. This guidance does not establish implementation, compliance or safety evidence; do not invent facts or suppress material uncertainty.';
module.exports = { ORGANIZATION_CONTEXT_HEADER, ORGANIZATION_CONTEXT_VERSION, ORGANIZATION_CONTEXT_MAX_BYTES, ORGANIZATION_HEADER_MAX_CHARS, ORGANIZATION_CONTEXT_GUIDANCE };
