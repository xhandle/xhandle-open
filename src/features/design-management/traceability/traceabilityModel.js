import { semanticHash } from '../artifacts/artifactModel';

export const MATRIX_TYPE = 'traceability-matrix';
export const DEFAULT_PROFILE_ID = 'xhandle-systems-engineering';
export const STAGES = ['definition', 'design', 'verification'];
export const RELATIONSHIPS = {
  'derived-from': ['Derived from', 'Origin of'], satisfies: ['Satisfies', 'Satisfied by'],
  mitigates: ['Mitigates', 'Mitigated by'], verifies: ['Verifies', 'Verified by'],
  'allocated-to': ['Allocated to', 'Receives allocation'], 'related-to': ['Related to', 'Related to'],
};
const role = (id, label, templates, kinds) => ({ id, label, templates, kinds });
const rule = (id, from, to, type, minSource = 1, minTarget = 0, stage = 'definition') => ({ id, from, to, type, allowed: true, minSource, minTarget, maxSource: null, maxTarget: null, stage, severity: 'warning' });
export const DEFAULT_PROFILE = {
  id: DEFAULT_PROFILE_ID, version: 1, name: 'xHandle Systems Engineering', strict: true,
  roles: [
    role('need', 'Operational need', ['conops'], ['narrative', 'requirement', 'decision']),
    role('system', 'System requirement', ['system-spec'], ['requirement']),
    role('subsystem', 'Subsystem requirement', ['subsystem-spec'], ['requirement']),
    role('software', 'Software requirement', ['software-spec'], ['requirement']),
    role('hardware', 'Hardware requirement', ['hardware-spec'], ['requirement']),
    role('safety', 'Safety requirement', ['safety-requirements'], ['requirement']),
    role('htr', 'Consolidated HTR', ['hazard-tracking-list'], ['htr']),
    role('interface', 'Interface requirement', ['interface-spec'], ['requirement', 'interface']),
    role('design', 'Design / architecture element', ['architecture', 'system-design', 'subsystem-design'], ['design', 'narrative', 'decision', 'interface']),
    role('verification', 'Verification item', [], ['verification']),
  ],
  rules: [rule('system-origin', 'system', ['need'], 'derived-from'), rule('subsystem-origin', 'subsystem', ['system'], 'derived-from'),
    rule('software-origin', 'software', ['system', 'subsystem', 'safety'], 'derived-from'),
    rule('hardware-origin', 'hardware', ['system', 'subsystem', 'safety'], 'derived-from'),
    rule('interface-origin', 'interface', ['system', 'subsystem'], 'derived-from'),
    rule('safety-mitigation', 'safety', ['htr'], 'mitigates', 1, 1),
    rule('requirement-design', 'design', ['system', 'subsystem', 'software', 'hardware', 'safety', 'interface'], 'satisfies', 0, 1, 'design'),
    rule('requirement-verification', 'verification', ['system', 'subsystem', 'software', 'hardware', 'safety', 'interface'], 'verifies', 0, 1, 'verification')],
};
export const clone = value => JSON.parse(JSON.stringify(value));
export const referenceKey = (artifactId, objectId) => JSON.stringify([artifactId, objectId]);
export const profileKey = profile => `${profile.id}@${profile.version}`;
export function validateProfile(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw Error('Enter a profile name of 1–200 characters.');
  if (!Array.isArray(input.roles) || !input.roles.length || input.roles.length > 40 || !Array.isArray(input.rules) || input.rules.length > 200) throw Error('Use 1–40 roles and up to 200 rules.');
  const roles = new Set(), ids = new Set();
  for (const role of input.roles) {
    if (!/^[a-z][a-z0-9_-]{0,59}$/.test(role.id) || roles.has(role.id) || !role.label?.trim() || role.label.length > 100 || !Array.isArray(role.kinds) || !role.kinds.length || role.kinds.some(kind => !['narrative', 'requirement', 'interface', 'decision', 'htr', 'design', 'verification'].includes(kind)) || !Array.isArray(role.templates) || role.templates.some(t => typeof t !== 'string')) throw Error('Each role needs a unique ID, label and supported object kinds.');
    roles.add(role.id);
  }
  const signatures = new Map();
  for (const rule of input.rules) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(rule.id) || ids.has(rule.id) || !roles.has(rule.from) || !Array.isArray(rule.to) || !rule.to.length || rule.to.some(id => !roles.has(id)) || new Set(rule.to).size !== rule.to.length || !Object.hasOwn(RELATIONSHIPS, rule.type)) throw Error('Each rule needs a unique ID, known roles and a supported relationship.');
    ids.add(rule.id);
    if (typeof rule.allowed !== 'boolean' || !STAGES.includes(rule.stage) || !['warning', 'error'].includes(rule.severity)) throw Error('Select rule permission, stage and severity.');
    for (const side of ['Source', 'Target']) {
      const min = rule[`min${side}`], max = rule[`max${side}`];
      if (!Number.isInteger(min) || min < 0 || min > 10000 || (max !== null && (!Number.isInteger(max) || max < min || max > 10000)) || (!rule.allowed && min > 0)) throw Error('Cardinality must have a nonnegative minimum and a maximum at least as large; prohibited rules cannot require coverage.');
    }
    for (const target of rule.to) {
      const key = JSON.stringify([rule.from, target, rule.type]);
      if (signatures.has(key)) throw Error('Overlapping rules are ambiguous. Use one rule per source role, target role and relationship.');
      signatures.set(key, rule);
    }
  }
  if (typeof input.strict !== 'boolean') throw Error('Select whether unlisted relationships are prohibited.');
  return input;
}
export function matchingRules(profile, source, target, type) {
  return profile.rules.filter(rule => rule.type === type && source.roles.includes(rule.from) && rule.to.some(role => target.roles.includes(role)));
}
export function checkRelationship(profile, nodes, input) {
  const byId = nodes instanceof Map ? nodes : new Map(nodes.map(node => [node.id, node]));
  const source = byId.get(input.from), target = byId.get(input.to);
  if (!source || !target) throw Error('Both relationship endpoints must exist in the selected scope.');
  if (source.id === target.id) throw Error('An object cannot trace to itself.');
  if (!Object.hasOwn(RELATIONSHIPS, input.type)) throw Error('Select a supported relationship.');
  const rules = matchingRules(profile, source, target, input.type);
  if (rules.some(rule => !rule.allowed) || (profile.strict && !rules.some(rule => rule.allowed))) throw Error('This relationship type or direction is not allowed by the selected profile.');
  return { source, target, rules };
}
export function engineeringIdentity(object) {
  return semanticHash({ title: object.title || '', text: object.text || '', kind: object.kind, attributes: object.attributes || {}, content: object.content || null, sourceIds: object.sourceIds || [], evidenceHash: object.evidenceHash || null, evidenceIssue: object.evidenceIssue || null });
}
