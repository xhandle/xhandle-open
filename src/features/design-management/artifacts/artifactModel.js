import { DRAFT_ITEM_KINDS, normalizeSectionResponse, sectionResponseError } from './sectionResponse';
import { validateArchitectureSelection } from './architectureSources';
import { sha256 } from 'hash.js';
import { isSafetyArtifact } from './safetyArtifactTypes';
import { hazardTrackingText } from './hazardTrackingFields';
import { upstreamRequirementTemplate } from './requirementDerivation';

const template = (id, name, scope, sections) => ({ id, name, scope, version: 1, sections: sections.map((title, i) => ({ id: `s${i + 1}`, title })) });
// Keep saved template identities and section IDs readable, including document
// families retired from the creation menus. Do not rewrite existing artifacts.
export const ARTIFACT_TEMPLATES = [
  template('conops', 'ConOps', 'system', ['Purpose and scope', 'Stakeholders and operational needs', 'Operational context', 'Operational scenarios', 'Modes and transitions', 'Constraints and open questions']),
  template('system-spec', 'System Requirements Specification', 'system', ['Scope and system boundary', 'Functional requirements', 'Performance requirements', 'External interfaces', 'Constraints and quality attributes', 'Verification approach and gaps']),
  template('subsystem-spec', 'Subsystem Specification', 'subsystem', ['Scope and allocation', 'Functional requirements', 'Performance and budgets', 'Subsystem interfaces', 'Constraints and dependencies', 'Verification approach and gaps']),
  template('software-spec', 'Software Requirements Specification', 'system', ['Scope and software allocation', 'Software functional requirements', 'Software performance and resource requirements', 'Software interfaces and data requirements', 'Software quality and design constraints', 'Verification criteria and gaps']),
  template('hardware-spec', 'Hardware Requirements Specification', 'system', ['Scope and hardware allocation', 'Hardware functional requirements', 'Performance and physical requirements', 'Electrical, mechanical and data interfaces', 'Environmental, reliability and design constraints', 'Verification criteria and gaps']),
  template('system-design', 'System Design Document', 'system', ['Design context', 'Architecture and responsibilities', 'Behavior and data flows', 'Interfaces and integration', 'Design decisions and rationale', 'Risks and open decisions']),
  template('subsystem-design', 'Subsystem Design Document', 'subsystem', ['Subsystem context', 'Component design', 'Behavior and states', 'Data and interfaces', 'Design decisions and rationale', 'Integration and open decisions']),
  template('interface-spec', 'Interface Specification', 'interface', ['Interface scope and endpoints', 'Interactions and direction', 'Data definitions and units', 'Timing and protocols', 'Failures and compatibility', 'Verification approach and unresolved contracts']),
];
ARTIFACT_TEMPLATES.push(template('architecture', 'Architecture', 'architecture', ['Architecture diagrams and elements']));
ARTIFACT_TEMPLATES.push(
  // Preserve s2 for compatibility with existing saved table rows and drafts.
  { ...template('hazard-tracking-list', 'Hazard Tracking List', 'system', []), sections: [{ id: 's2', title: 'Hazard tracking list' }] },
  template('safety-requirements', 'Safety Requirements', 'system', ['Scope and source analyses', 'Safety requirements', 'Safety constraints', 'Hazard traceability', 'Verification methods', 'Gaps and analysis coverage']),
);
// A matrix is evaluated deterministically after its sources exist; it is not
// an AI-generated member of the engineering document generation sequence.
export const MATRIX_TEMPLATE = { id: 'traceability-matrix', name: 'Traceability Matrix', scope: 'system', version: 1, sections: [], deterministic: true };
export const CREATABLE_ARTIFACT_TEMPLATES = ['conops', 'architecture', 'system-spec', 'software-spec', 'hardware-spec'].map(id => ARTIFACT_TEMPLATES.find(template => template.id === id));
export const ENGINEERING_ARTIFACT_TYPES = [...CREATABLE_ARTIFACT_TEMPLATES, MATRIX_TEMPLATE];
export const getTemplate = id => { const t = [...ARTIFACT_TEMPLATES, MATRIX_TEMPLATE].find(t => t.id === id); if (!t) throw new Error('Unknown artifact template.'); return t; };
export const newId = () => crypto.randomUUID();
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJSON(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
// hash.js expands each update into a JavaScript byte array. A whole repository
// snapshot can exceed the browser's allocation limit even though its individual
// rows fit comfortably. Stream the SAME canonical JSON bytes in bounded updates;
// existing source hashes and saved checkpoint identities must not change.
export function semanticHash(value) {
  const hash = sha256(), chunkSize = 16384;
  let pending = '';
  const write = text => {
    if (text === undefined) return;
    for (let offset = 0; offset < text.length;) {
      const take = Math.min(chunkSize - pending.length, text.length - offset);
      pending += text.slice(offset, offset + take); offset += take;
      if (pending.length === chunkSize) {
        // Keep UTF-16 surrogate pairs together so chunk boundaries do not change
        // hash.js's UTF-8 encoding of supplementary Unicode characters.
        const last = pending.charCodeAt(pending.length - 1);
        const end = last >= 0xD800 && last <= 0xDBFF ? pending.length - 1 : pending.length;
        hash.update(pending.slice(0, end)); pending = pending.slice(end);
      }
    }
  };
  const visit = item => {
    if (Array.isArray(item)) {
      write('[');
      for (let index = 0; index < item.length; index++) {
        if (index) write(',');
        // Match stableJSON's sparse-array and undefined-entry behavior.
        if (Object.prototype.hasOwnProperty.call(item, index)) visit(item[index]);
      }
      write(']');
    } else if (item && typeof item === 'object') {
      write('{');
      const keys = Object.keys(item).filter(key => item[key] !== undefined).sort();
      keys.forEach((key, index) => { if (index) write(','); write(JSON.stringify(key)); write(':'); visit(item[key]); });
      write('}');
    } else write(JSON.stringify(item));
  };
  visit(value);
  if (pending) hash.update(pending);
  return hash.digest('hex');
}
export function validateConfig(config) {
  const t = getTemplate(config.templateId);
  validateArchitectureSelection(config);
  for (const key of ['projectId', 'workspaceType', 'folderId', 'title', 'system']) if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`${key} is required.`);
  if (!['functional', 'code-architecture'].includes(config.workspaceType)) throw new Error('Invalid workspace.');
  if (t.scope === 'subsystem' && !config.subsystem?.trim()) throw new Error('Select the subsystem scope.');
  if (t.scope === 'interface' && (!config.endpointA?.trim() || !config.endpointB?.trim())) throw new Error('Both interface endpoints are required.');
  if ((config.notes || '').length > 20000 || config.title.length > 200) throw new Error('Title or source notes are too long.');
  if (!Array.isArray(config.sources) || config.sources.length > 30) throw new Error('Select up to 30 source modules.');
  if (!isSafetyArtifact(config.templateId) && !upstreamRequirementTemplate(config) && !config.architectureSources?.length && !config.sources.length && !config.notes?.trim() && !Object.values(config.projectNotes || {}).some(text => text?.trim())) throw new Error('Select source diagrams, a source module, or provide source notes.');
  return t;
}
// One canonical object tree drives all four presentations and exports.
export function validateSection(response, section, artifactId, sourceIds, { maxSourceIds = 100, indexOffset = 0 } = {}) {
  response = normalizeSectionResponse(response);
  if (!response || !Array.isArray(response.objects)) throw sectionResponseError('missing');
  if (!response.objects.length) throw sectionResponseError('empty');
  if (response.objects.length > 60) throw sectionResponseError('excess');
  const seen = new Set();
  const objects = response.objects.map((o, index) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw sectionResponseError('item');
    if (typeof o.key !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(o.key) || seen.has(o.key)) throw sectionResponseError('key');
    seen.add(o.key);
    if (!DRAFT_ITEM_KINDS.includes(o.kind)) throw sectionResponseError('kind', { index: indexOffset + index, kind: o.kind });
    if (typeof o.title !== 'string' || !o.title.trim() || o.title.length > 300 || typeof o.text !== 'string' || o.text.length > 16000) throw sectionResponseError('content');
    if (!Array.isArray(o.sourceIds) || o.sourceIds.length > maxSourceIds || o.sourceIds.some(id => typeof id !== 'string')) throw sectionResponseError('citations');
    if (o.sourceIds.some(id => !sourceIds.has(id))) { const error = new Error('The response cites an unknown source.'); error.code = 'UNKNOWN_SOURCE_CITATION'; throw error; }
    const missingCitation = o.kind !== 'gap' && !o.sourceIds.length;
    // A missing citation is a reviewable evidence gap, not a failed section.
    // Keep the original wording and type for review without inventing support.
    return { id: `${artifactId}:${section.id}:${o.key}`, key: o.key, parentId: `${artifactId}:${section.id}`, sectionId: section.id, title: o.title, text: o.text, kind: missingCitation ? 'gap' : o.kind, sourceIds: [...new Set(o.sourceIds)], manual: false,
      ...(missingCitation ? { evidenceIssue: 'missing-citation', proposedKind: o.kind } : {}),
    };
  });
  return [{ id: `${artifactId}:${section.id}`, sectionId: section.id, parentId: null, title: section.title, text: '', kind: 'section', sourceIds: [], manual: false }, ...objects];
}

// Evidence reviews are intermediate facts, not document sections. Retain every
// valid item in a complete provider response, then consolidate in later rounds.
// The parser's response-size limit and each item's schema limits still apply.
export function validateEvidenceReview(response, section, artifactId, sourceIds, options = {}) {
  response = normalizeSectionResponse(response, { evidenceReview: true });
  if (!Array.isArray(response?.objects) || !response.objects.length) return validateSection(response, section, artifactId, sourceIds, options);
  const keys = new Set();
  for (const object of response.objects) {
    if (object && typeof object.key === 'string' && keys.has(object.key)) throw sectionResponseError('key');
    keys.add(object?.key);
  }
  const objects = [];
  for (let start = 0; start < response.objects.length; start += 60) {
    const checked = validateSection({ objects: response.objects.slice(start, start + 60) }, section, artifactId, sourceIds, { ...options, indexOffset: start });
    objects.push(...(start ? checked.slice(1) : checked));
  }
  return objects;
}
export function artifactObjectText(object) {
  if (['missing-parent-requirement', 'missing-system-requirement'].includes(object.evidenceIssue)) return `Requirement needs a parent requirement. Review the source link before accepting this statement.\n\nProposed wording:\n${object.text}`;
  if (object.hazardTrackingRow && !object.text) return hazardTrackingText(object.attributes);
  if (object.evidenceIssue === 'requirement-writing') return `Requirement wording needs review: ${(object.requirementWritingIssues || []).join(' ')}\n\nProposed wording:\n${object.text}`;
  if (object.evidenceIssue === 'unknown-citation') return `Unresolved: a supporting reference in this generated item could not be matched to the selected sources. Review the claim and supply evidence before treating it as an established fact.\n\nUnverified generated text:\n${object.text}`;
  if (object.evidenceIssue === 'unresolved-upstream') return `Unresolved: this item depends on upstream content that still requires evidence.\n\nUnverified generated text:\n${object.text}`;
  if (object.evidenceIssue === 'missing-citation') {
    return `Unresolved: this generated item has no supporting source citation. Verify it or supply evidence before treating it as an established fact.\n\nUnverified generated text:\n${object.text}`;
  }
  return object.text;
}
export function mergeProposal(current, proposed) {
  const manual = new Map(current.filter(o => o.manual).map(o => [o.id, o]));
  const merged = proposed.map(o => o.manual ? o : manual.get(o.id) || o);
  const ids = new Set(merged.map(o => o.id));
  current.filter(o => o.manual && !ids.has(o.id)).forEach(o => merged.push(o));
  // Preserve ancestors needed by manually edited/moved children even if regeneration omits them.
  const byId = new Map(current.map(o => [o.id, o]));
  const retained = new Set(merged.map(o => o.id));
  for (let i = 0; i < merged.length; i++) {
    const parent = byId.get(merged[i].parentId);
    if (parent && !retained.has(parent.id)) { merged.push(parent); retained.add(parent.id); }
  }
  return merged;
}
export function compareObjects(before = [], after = []) {
  const old = new Map(before.map(o => [o.id, o]));
  const remaining = new Set(after.map(o => o.id));
  return [...after.filter(o => !old.has(o.id) || (old.get(o.id) !== o && semanticHash(old.get(o.id)) !== semanticHash(o))).map(o => ({ id: o.id, title: o.title, change: old.has(o.id) ? 'changed' : 'added', before: old.get(o.id)?.text || '', after: o.text })), ...before.filter(o => !remaining.has(o.id)).map(o => ({ id: o.id, title: o.title, change: 'removed', before: o.text, after: '' }))];
}
