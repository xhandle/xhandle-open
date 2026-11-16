import { ORGANIZATION_PROFILE_STORAGE_KEY, createOrganizationProfileRecord, validateOrganizationProfile, organizationProfileContextIdentity } from './organizationProfile';
import { ORGANIZATION_CONTEXT_HEADER, ORGANIZATION_CONTEXT_VERSION, ORGANIZATION_CONTEXT_MAX_BYTES, ORGANIZATION_HEADER_MAX_CHARS, ORGANIZATION_CONTEXT_GUIDANCE } from '../../lib/organizationPromptPolicy';

const encoder = () => new TextEncoder();
const byteLength = text => encoder().encode(text).length;
const contexts = new Map();
let serializedProfile, compiledProfile, scopeResolver;
const EMPTY = Object.freeze({ context: '', identity: '', header: '' });

// Installed by App, evaluated only when an AI request needs context. Never read
// diagrams, repositories or the workspace from a render or a chat keystroke.
export function setOrganizationPromptScopeResolver(resolver) {
  scopeResolver = resolver;
  return () => { if (scopeResolver === resolver) scopeResolver = undefined; };
}
export function clearOrganizationPromptCache() {
  serializedProfile = undefined; compiledProfile = undefined; contexts.clear();
}
function compileProfile(storage) {
  const raw = storage?.getItem(ORGANIZATION_PROFILE_STORAGE_KEY) || '';
  if (raw === serializedProfile) return compiledProfile;
  serializedProfile = raw; contexts.clear(); compiledProfile = null;
  let record; try { record = createOrganizationProfileRecord(JSON.parse(raw || '{}')); } catch { return null; }
  if (!record.enabled) return null;
  const parsed = validateOrganizationProfile(record.markdown);
  if (!parsed.valid) return null;
  const top = new Set([...record.markdown.matchAll(/^#\s+(.+?)\s*$/gm)].map(match => match[1]));
  const sections = Object.entries(parsed.sections).filter(([name]) => !top.size || top.has(name));
  compiledProfile = {
    identity: organizationProfileContextIdentity(record.markdown),
    label: `${String(parsed.metadata.organization).slice(0, 200)} v${String(parsed.metadata.profile_version).slice(0, 40)} (${String(parsed.metadata.status || 'advisory').slice(0, 40)})`,
    approved: /^(approved|active)$/i.test(parsed.metadata.status),
    sections: sections.length ? sections : [['Organization guidance', record.markdown.replace(/^---[\s\S]*?---\s*/, '')]],
  };
  return compiledProfile;
}
// Preserve complete lines/sentences when possible. Mark an excerpt explicitly;
// never turn a shortened policy into an apparent statement of complete coverage.
function excerpt(value, limit) {
  const source = String(value || '').trim();
  if (byteLength(source) <= limit) return source;
  const suffix = ' [excerpt shortened]';
  let text = new TextDecoder().decode(encoder().encode(source).slice(0, Math.max(0, limit - byteLength(suffix))), {stream: true});
  const boundary = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('. '));
  if (boundary > text.length / 2) text = text.slice(0, boundary + (text[boundary] === '.' ? 1 : 0));
  else text = text.slice(0, Math.max(0, text.lastIndexOf(' ')));
  return text.trim() + suffix;
}
const words = text => new Set(String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []);
function selectSections(sections, hint) {
  const terms = words(hint);
  const core = ['organization and products', 'engineering rules', 'safety philosophy', 'glossary'];
  return sections.map(([name, body], index) => {
    const heading = name.toLowerCase();
    const common = core.indexOf(heading);
    const tokens = words(name);
    const matches = [...tokens].filter(term => terms.has(term) || [...terms].some(word => word.startsWith(term) || term.startsWith(word))).length;
    return { name, body, index, score: matches * 30 + (common >= 0 ? 20 - common : 0) };
  }).sort((a,b) => b.score - a.score || a.index - b.index).slice(0, 6);
}
export function getOrganizationPromptContext({ storage, projectId, workflow = '', hint = '' } = {}) {
  try {
    const profile = compileProfile(storage || (typeof window !== 'undefined' ? window.localStorage : null));
    // Disabled is a cheap no-op: no project lookup, serialization or scan of a
    // potentially large request body or project-data map.
    if (!profile) return EMPTY;
    const scope = scopeResolver?.({projectId}) || {};
    const project = scope.projectProfile;
    if (String(project?.mode || '').toLowerCase() === 'disabled') return EMPTY;
    const id = scope.projectId ?? projectId ?? '';
    const override = String(project?.overrideMarkdown || '').trim();
    const selected = selectSections(profile.sections, `${workflow} ${scope.hint || ''} ${String(hint).slice(0, 1600)}`);
    const key = JSON.stringify([profile.identity, id, override, selected.map(section => section.index)]);
    if (contexts.has(key)) { const cached = contexts.get(key); contexts.delete(key); contexts.set(key, cached); return cached; }
    const prefix = `${ORGANIZATION_CONTEXT_GUIDANCE}\nProfile: ${profile.label}.${profile.approved ? '' : ' Unapproved guidance is advisory.'}`;
    const overrideBlock = override ? `\nProject ${id || 'current'} override:\n${excerpt(override, 900)}` : '';
    const remaining = ORGANIZATION_CONTEXT_MAX_BYTES - byteLength(prefix + overrideBlock) - 180;
    const sectionBudget = Math.max(80, Math.floor(remaining / Math.max(1, selected.length)));
    const blocks = selected.map(section => excerpt(`# ${section.name}\n${section.body}`, sectionBudget));
    const context = excerpt([prefix, ...blocks, overrideBlock].filter(Boolean).join('\n\n'), ORGANIZATION_CONTEXT_MAX_BYTES);
    const identity = organizationProfileContextIdentity(JSON.stringify([ORGANIZATION_CONTEXT_VERSION, profile.identity, id, override]));
    // Avoid JSON-escaping the profile again; keep Unicode/quote-heavy profiles
    // inside the header budget without parsing large request bodies.
    const data = encoder().encode(`${ORGANIZATION_CONTEXT_VERSION}\n${identity}\n${context}`);
    let binary = ''; for (const byte of data) binary += String.fromCharCode(byte);
    const header = btoa(binary);
    if (header.length > ORGANIZATION_HEADER_MAX_CHARS) return EMPTY;
    const result = Object.freeze({context, identity, header});
    contexts.set(key, result); if (contexts.size > 32) contexts.delete(contexts.keys().next().value);
    return result;
  } catch { return EMPTY; }
}
export function organizationPromptHeaders(options) {
  const context = getOrganizationPromptContext(options);
  return context.header || options?.projectId !== undefined ? {[ORGANIZATION_CONTEXT_HEADER]: context.header} : {};
}
