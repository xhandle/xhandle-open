export const DRAFT_ITEM_KINDS = Object.freeze(['narrative', 'requirement', 'decision', 'gap', 'interface']);
export const DRAFT_ITEM_KIND_GUIDANCE = 'Use exactly one of these kind values: narrative for source-backed facts or descriptions; requirement for recorded obligations or constraints; decision for recorded design decisions; gap for missing or unresolved evidence; interface for recorded interface contracts. Fact and constraint are descriptions of content, not kind values. Do not use section, fact, constraint, safety-goal, an approval status, or the pipe-separated list as a kind.';

// Accept only unambiguous containers and labels; do not extract arbitrary nested
// documents, invent missing fields, truncate items or repair incomplete JSON.
export function normalizeSectionResponse(value, { evidenceReview = false } = {}) {
  if (Array.isArray(value)) value = { objects: value };
  if (value && typeof value === 'object' && !('objects' in value)
    && ['key', 'kind', 'title', 'text', 'sourceIds'].every(key => Object.prototype.hasOwnProperty.call(value, key))) value = { objects: [value] };
  if (!Array.isArray(value?.objects)) return value;
  return { ...value, objects: value.objects.map(object => {
    if (!object || Array.isArray(object) || typeof object.kind !== 'string') return object;
    let kind = object.kind.trim().toLowerCase();
    // The evidence-review prompt historically called these facts/constraints.
    // Preserve their complete text and references using the existing equivalent
    // types. This does not infer an actor, support, approval or a new obligation.
    if (evidenceReview && kind === 'fact') kind = 'narrative';
    if (evidenceReview && kind === 'constraint') kind = 'requirement';
    return DRAFT_ITEM_KINDS.includes(kind) && kind !== object.kind ? { ...object, kind } : object;
  }) };
}
const issues = {
  format: ['The AI returned an unreadable response for this section.', 'Return one complete JSON object with an objects array. Do not include prose or Markdown fences outside it.'],
  missing: ['The AI returned a different format instead of draft content for this section.', 'The top-level JSON object must have an objects array, not a document, sections list, summary or explanation.'],
  empty: ['The AI returned no draft content for this section.', 'The objects array must not be empty. If the selected evidence cannot support the section, return an explicit gap explaining what evidence is missing, with sourceIds: [].'],
  excess: ['The AI returned too many draft items for one section.', 'Return at most 60 objects for this section only. Consolidate repetitive narrative without omitting distinct requirements or material constraints.'],
  item: ['The AI returned an unreadable draft item.', 'Each objects entry must be an object with key, kind, title, text and sourceIds fields; never null, an array or a string.'],
  key: ['The AI returned invalid or duplicate item identifiers.', 'Use a unique key for each item: 1–80 letters, digits, underscores or hyphens. Preserve previous keys for the same concepts.'],
  kind: ['The AI returned an unsupported type of draft item.', DRAFT_ITEM_KIND_GUIDANCE],
  content: ['The AI returned an invalid draft title or text.', 'Each title must be nonempty text up to 300 characters; text must be plain text up to 16000 characters.'],
  citations: ['The AI returned an invalid supporting-reference list.', 'Each sourceIds must be an array of at most 100 source ID strings. Use [] for explicit evidence gaps.'],
};
export function sectionResponseError(issue, { index, kind } = {}) {
  const [description, instruction] = issues[issue];
  const error = new Error(`${description} Completed sections are saved. Resume to retry.`);
  error.code = 'INVALID_SECTION_RESPONSE';
  error.responseIssue = issue;
  error.retryInstruction = instruction;
  if (issue === 'kind' && Number.isInteger(index)) {
    const label = typeof kind === 'string' ? JSON.stringify(kind.slice(0, 80)) : `a ${kind === null ? 'null' : typeof kind} value`;
    error.retryInstruction += ` objects[${index}].kind was ${label}. Regenerate the complete response with a supported kind for every item, preserving all supported text, obligations, conditions and exact sourceIds. Never drop items to correct their type.`;
  }
  return error;
}
