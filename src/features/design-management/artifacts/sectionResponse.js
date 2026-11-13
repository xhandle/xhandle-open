// Accept only unambiguous containers; do not extract arbitrary nested documents,
// invent missing fields, truncate excess items or repair incomplete JSON.
export function normalizeSectionResponse(value) {
  if (Array.isArray(value)) return { objects: value };
  if (value && typeof value === 'object' && !('objects' in value)
    && ['key', 'kind', 'title', 'text', 'sourceIds'].every(key => Object.prototype.hasOwnProperty.call(value, key))) return { objects: [value] };
  return value;
}
const issues = {
  format: ['The AI returned an unreadable response for this section.', 'Return one complete JSON object with an objects array. Do not include prose or Markdown fences outside it.'],
  missing: ['The AI returned a different format instead of draft content for this section.', 'The top-level JSON object must have an objects array, not a document, sections list, summary or explanation.'],
  empty: ['The AI returned no draft content for this section.', 'The objects array must not be empty. If the selected evidence cannot support the section, return an explicit gap explaining what evidence is missing, with sourceIds: [].'],
  excess: ['The AI returned too many draft items for one section.', 'Return at most 60 objects for this section only. Consolidate repetitive narrative without omitting distinct requirements or material constraints.'],
  item: ['The AI returned an unreadable draft item.', 'Each objects entry must be an object with key, kind, title, text and sourceIds fields; never null, an array or a string.'],
  key: ['The AI returned invalid or duplicate item identifiers.', 'Use a unique key for each item: 1–80 letters, digits, underscores or hyphens. Preserve previous keys for the same concepts.'],
  kind: ['The AI returned an unsupported type of draft item.', 'Each kind must be exactly narrative, requirement, decision, gap or interface.'],
  content: ['The AI returned an invalid draft title or text.', 'Each title must be nonempty text up to 300 characters; text must be plain text up to 16000 characters.'],
  citations: ['The AI returned an invalid supporting-reference list.', 'Each sourceIds must be an array of at most 100 source ID strings. Use [] for explicit evidence gaps.'],
};
export function sectionResponseError(issue) {
  const [description, instruction] = issues[issue];
  const error = new Error(`${description} Completed sections are saved. Resume to retry.`);
  error.code = 'INVALID_SECTION_RESPONSE';
  error.responseIssue = issue;
  error.retryInstruction = instruction;
  return error;
}
