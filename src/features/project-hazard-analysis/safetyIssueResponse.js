import { generationError } from '../design-management/artifacts/generationRecovery';

// Reject headings that describe bookkeeping instead of an engineering concern.
// A meaningful title is not invalid merely because it happens to mention a
// number of functions or exceeds a display-length target by a few characters.
export const genericSafetyIssueTitle = title => /^(?:unsafe\s+(?:system\s+)?behavio[u]?r\s+across\s+(?:\d+|many|multiple|all)\s+(?:functional interfaces|functions|assessments|hazards)\b|unsafe\s+(?:system\s+)?behavio[u]?r\s+involving\s+(?:every|all|many|multiple)\b|(?:consolidated|actionable) safety (?:issue|concern)(?:\s*\d+)?$|safety (?:issue|concern) (?:summary|needs)|under the stated premises|(?:specific unsafe condition|short consolidated safety issue title|specific actionable engineering concern|safety issue|safety concern|title)$)/i.test(title);
export function safetyIssueResponseError(problems = []) {
  const details = [...new Set(problems.map(problem => problem.userMessage || problem.message))].slice(0, 3).join(' ');
  const error = generationError('SAFETY_ISSUES_FORMAT', `${details || 'The provider did not return a readable safety-issue list.'} Completed issues and source evidence are saved. Resume to retry only unfinished work.`);
  error.problems = problems;
  return error;
}
const normalizeTitle = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
function familyReference(value, allowed) {
  if (Number.isInteger(value) && allowed.has(`family-${value}`)) return `family-${value}`;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (allowed.has(trimmed)) return trimmed;
  // Only normalize equivalent spellings of an explicitly supplied local ID.
  const alias = trimmed.match(/^family[\s_-]*(\d+)$/i);
  const candidate = alias ? `family-${Number(alias[1])}` : null;
  return candidate && allowed.has(candidate) ? candidate : null;
}
function references(issue, families, allowed) {
  const raw = issue?.sourceFamilyIds ?? issue?.source_family_ids ?? issue?.familyIds;
  if (raw !== undefined) {
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',').map(value => value.trim()) : [raw];
    const ids = values.map(value => familyReference(value, allowed));
    return { ids: [...new Set(ids.filter(Boolean))], unknown: values.filter((_value, index) => !ids[index]).map(value => String(value).slice(0, 80)) };
  }
  // Older provider outputs sometimes return actual worksheet row indexes. Use
  // them only if they identify complete supplied families exactly; never guess
  // a family from one overlapping row or from a positional index.
  if (Array.isArray(issue?.sourceIndexes) && issue.sourceIndexes.length) {
    const indexes = new Set(issue.sourceIndexes.map(Number));
    const matched = families.filter(family => family.sourceIndexes?.length && family.sourceIndexes.every(index => indexes.has(Number(index))));
    const represented = new Set(matched.flatMap(family => family.sourceIndexes.map(Number)));
    if (indexes.size === represented.size && [...indexes].every(index => represented.has(index))) return { ids: matched.map(family => family.familyId), unknown: [] };
  }
  return { ids: [], unknown: [] };
}
export function inspectSafetyIssues(result, families) {
  const allowed = new Set(families.map(family => family.familyId));
  const problems = [], issues = [], owners = new Map();
  const proposed = Array.isArray(result) ? result : result?.issues ?? result?.safetyIssues ?? result?.safety_issues ?? (Array.isArray(result?.groups) && result.groups.every(item => item && !Array.isArray(item) && typeof item === 'object') ? result.groups : undefined);
  if (!Array.isArray(proposed) || !proposed.length) return { issues, pending: families, problems: [{ type: 'structure', familyIds: [...allowed], message: 'The provider returned no readable safety issues.' }] };
  const duplicates = new Set();
  const unique = proposed.filter(issue => {
    const key = JSON.stringify(issue);
    if (duplicates.has(key)) return false;
    duplicates.add(key); return true;
  });
  const candidates = unique.map((issue, index) => {
    const refs = references(issue, families, allowed), reasons = [];
    const title = normalizeTitle(issue?.title), description = typeof issue?.description === 'string' ? issue.description.trim() : '';
    if (title.length < 4) reasons.push('the issue title is missing');
    else if (genericSafetyIssueTitle(title)) reasons.push('the title describes bookkeeping rather than a specific unsafe condition');
    else if (title.length > 500) reasons.push('the title contains an excessive amount of source text');
    if (description.length < 10) reasons.push('the engineering concern description is missing');
    else if (description.length > 12000) reasons.push('the description repeats an excessive amount of source text');
    if (!refs.ids.length) reasons.push('no complete supplied evidence family was referenced');
    if (refs.unknown.length) reasons.push(`unknown evidence references: ${refs.unknown.slice(0, 6).join(', ')}${refs.unknown.length > 6 ? ` and ${refs.unknown.length - 6} others` : ''}`);
    for (const id of refs.ids) { if (!owners.has(id)) owners.set(id, []); owners.get(id).push(index); }
    // Membership is materialized exclusively from validated family references.
    // Ignore unsolicited sourceIndexes and normalized concepts from the model.
    return { issue: { title, description, sourceFamilyIds: refs.ids, likelihood: issue?.likelihood, severity: issue?.severity, tags: issue?.tags, semantic: true }, reasons, index };
  });
  for (const candidate of candidates) {
    const disputed = candidate.issue.sourceFamilyIds.filter(id => owners.get(id).length > 1);
    if (disputed.length) candidate.reasons.push(`evidence assigned to multiple issues: ${disputed.join(', ')}`);
    if (candidate.reasons.length) problems.push({ type: disputed.length ? 'overlap' : candidate.reasons.some(reason => reason.includes('title') || reason.includes('description')) ? 'prose' : 'references', familyIds: candidate.issue.sourceFamilyIds, message: `Issue ${candidate.index + 1}: ${candidate.reasons.join('; ')}.`, userMessage: disputed.length ? 'The provider assigned the same source evidence to multiple issues.' : candidate.reasons.some(reason => reason.includes('bookkeeping')) ? 'The provider returned a bookkeeping heading instead of a specific unsafe condition.' : candidate.reasons.some(reason => reason.includes('title') || reason.includes('description')) ? 'The provider did not supply a usable issue title and engineering description.' : 'The provider did not link an issue to the supplied source evidence.' });
    else issues.push(candidate.issue);
  }
  const covered = new Set(issues.flatMap(issue => issue.sourceFamilyIds));
  const pending = families.filter(family => !covered.has(family.familyId));
  if (pending.length && !problems.length) problems.push({ type: 'coverage', familyIds: pending.map(family => family.familyId), message: `The provider omitted ${pending.length} supplied evidence ${pending.length === 1 ? 'family' : 'families'}.`, userMessage: `The provider omitted ${pending.length} ${pending.length === 1 ? 'group' : 'groups'} of source evidence.` });
  return { issues, pending, problems };
}
export function validateSafetyIssues(result, families) {
  const checked = inspectSafetyIssues(result, families);
  if (checked.pending.length) throw safetyIssueResponseError(checked.problems);
  return checked.issues;
}
