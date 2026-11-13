// INCOSE GtWR: complete statements, active voice, singularity, explicit
// conditions and measurable criteria. These checks catch known defects;
// passing them is not a certification of engineering correctness.
// https://www.incose.org/wp-content/uploads/2026/01/INCOSEContent-411.pdf
export const REQUIREMENT_WRITING_GUIDANCE = 'Follow INCOSE Guide to Writing Requirements principles. Each requirement is ONE complete, grammatically correct, standalone sentence containing an explicitly named responsible system or component, shall, one observable action, its object, and every applicable condition and recorded acceptance criterion. Use active voice. Repeat the full subject and condition in each requirement; a parent heading or neighboring row must never be needed to understand it. Do not start a requirement with otherwise, then, and, or a bare shall. Replace pronouns and references such as it, this, that limit, the same condition, or the above with the exact named entity, condition or value supported by the evidence. Write the alternative branch as an explicit condition, preserving the exact logical complement (NOT(A AND B) is NOT A OR NOT B). Do not turn alternatives into simultaneous obligations or drop conditions when separating actions. Preserve numeric values, units, tolerances, exclusions and timing. Use one sentence and one independently verifiable obligation per object. Keep rationale and explanatory prose separate. Do not invent actors, thresholds or design decisions: if the evidence does not define the responsible entity, a referenced limit, or measurable acceptance criteria, return an explicit gap identifying what must be defined. Before returning, read each requirement in isolation and check that it is complete, unambiguous, singular and verifiable.';

export function requirementSentences(text) {
  return typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(item => item.segment.trim()).filter(Boolean)
    : text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(value => value.trim()).filter(Boolean);
}
export function requirementCondition(text) {
  if (!/^(?:if|when|whenever|while|unless|until|before|after|during|under|provided that|where)\b/i.test(text.trim())) return '';
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if ('([{'.includes(text[index])) depth++;
    else if (')]}'.includes(text[index])) depth--;
    else if (text[index] === ',' && !depth) return text.slice(0, index + 1).trim() + ' ';
  }
  return '';
}
const bodyOf = text => text.slice(requirementCondition(text).length).trim();
const passive = /^(not\s+)?be\s+(?:\w+(?:ed|en)|built|held|kept|set|sent|shown|written|read|made|done|run|given|known)\b/i;
const actorOf = text => {
  const match = bodyOf(text).match(/^(.+?)\s+shall\s+(.+)/i);
  return match && !passive.test(match[2]) && !/^(?:otherwise|it|they|this|that|these|those|there|only|no)\b/i.test(match[1]) ? match[1] : null;
};
const participles = { built: 'build', published: 'publish', generated: 'generate', produced: 'produce', emitted: 'emit', flagged: 'flag', applied: 'apply', propagated: 'propagate', established: 'establish', returned: 'return', provided: 'provide', recorded: 'record', rejected: 'reject', retained: 'retain' };
const lowerArticle = text => text.replace(/^(?:The|A|An|Each|Every|Only|No)\b/, article => article.toLowerCase());
const endSentence = text => {
  const clean = text.trim().replace(/^[•*-]\s+/, '').replace(/[,;.]\s*$/, '');
  return clean ? clean[0].toUpperCase() + clean.slice(1) + (/[!?]$/.test(clean) ? '' : '.') : '';
};

// Only expand context that is present verbatim. Never guess a numeric limit,
// an engineering allocation, or what an ambiguous pronoun was meant to mean.
export function completeRequirementSentence(text, previous = [], { inheritCondition = false } = {}) {
  let value = text.trim();
  const prior = [...previous].reverse();
  const actor = prior.map(actorOf).find(Boolean);
  if (/^otherwise\b/i.test(value)) {
    const reference = prior.find(item => /\bonly when\s+.+[.!]?$/i.test(item) || /^(?:if|when)\b/i.test(requirementCondition(item)));
    const expression = reference?.match(/\bonly when\s+(.+?)[.!]?$/i)?.[1] || requirementCondition(reference || '').replace(/^(?:if|when)\s+/i, '').replace(/,\s*$/, '');
    if (expression) value = `If NOT (${expression.replace(/[.]$/, '')}), ${value.replace(/^otherwise\s*[,;]?\s*/i, '')}`;
  }
  // A coordinated clause following the alternative branch has that same
  // condition, rather than becoming an unconditional new obligation.
  const inherited = requirementCondition(previous.at(-1) || '');
  if (inheritCondition && !requirementCondition(value) && /^If NOT \(/.test(inherited)) value = inherited + value;
  const prefix = requirementCondition(value), body = value.slice(prefix.length);
  const match = body.match(/^(.+?)\s+shall\s+(not\s+)?be\s+(\w+)\b([\s\S]*)/i);
  if (match && actor && participles[match[3].toLowerCase()] && !(/^no\s+/i.test(match[1]) && match[2])) {
    const no = /^no\s+/i.test(match[1]);
    const object = lowerArticle(match[1].replace(/^no\s+/i, 'a '));
    value = `${prefix}${prefix ? lowerArticle(actor) : actor} shall ${no || match[2] ? 'not ' : ''}${participles[match[3].toLowerCase()]} ${object}${match[4]}`;
  }
  return endSentence(value);
}

export function requirementWritingIssues(text) {
  const issues = [], clean = text.trim(), body = bodyOf(clean);
  const match = body.match(/^(.+?)\s+shall\s+(.+)/i);
  if (!match || !/^(?:not\s+)?[a-z]/i.test(match[2]) || /^(?:otherwise|then|and|but|shall|it|they|this|that|these|those|there)\b/i.test(body)) issues.push('Name the responsible entity and state its obligation in a complete sentence.');
  if ((clean.match(/\bshall\b/gi) || []).length !== 1 || requirementSentences(clean).length !== 1) issues.push('Use one complete sentence with one independently verifiable obligation.');
  const action = match?.[2].split(/\b(?:if|when|unless|until|before|after|while|provided that)\b/i)[0] || '';
  if (/\b(?:and|but|as well as)\s+(?:also\s+)?(?:build|publish|generate|produce|emit|flag|apply|propagate|establish|return|provide|record|reject|retain|log|report|notify|stop|start|validate|verify|register|send|store|accept|prevent|disable|enable|display|update)\b/i.test(action)) issues.push('Separate independently verifiable actions into individual complete requirements.');
  if (match && passive.test(match[2])) issues.push('Identify the responsible entity and use active voice.');
  if (/\b(?:otherwise|that limit|this limit|the same (?:limit|condition|ordering)|above|aforementioned|the former|the latter)\b/i.test(clean)) issues.push('Replace references to neighboring statements with the explicit entity, condition or limit.');
  if (/\b(?:a|an|the)\s+(?:validated|acceptable|appropriate|reasonable|sufficient|suitable)\s+(?:(?:latency|time|speed|covariance|safety)\s+)?(?:limit|threshold|range)\b/i.test(clean)) issues.push('Specify the measurable limit or a uniquely identified source parameter; do not invent its value.');
  if (!/[.!?]$/.test(clean)) issues.push('End the complete sentence with punctuation.');
  return issues;
}

export function reviewRequirementWriting(objects) {
  const groups = new Map();
  // Context may be carried only between children produced from the same
  // original paragraph, never between unrelated requirement topics.
  objects.forEach((object, index) => {
    if (object.requirementGroupId) {
      const group = groups.get(object.requirementGroupId) || [];
      group.push({ object, index }); groups.set(object.requirementGroupId, group);
    }
  });
  const context = new Map();
  for (const siblings of groups.values()) {
    const previous = [];
    let preceding;
    siblings.sort((a, b) => (a.object.order ?? a.index) - (b.object.order ?? b.index)).forEach(({ object }) => {
      const inheritCondition = object.requirementSentenceIndex !== undefined && object.requirementSentenceIndex === preceding?.requirementSentenceIndex;
      const texts = previous.map(item => item.text);
      context.set(object.id, { previous: texts, inheritCondition });
      previous.push({ id: object.id, text: completeRequirementSentence(object.text, texts, { inheritCondition }) });
      preceding = object;
    });
  }
  return objects.map(object => {
    if (object.deleted || (object.kind !== 'requirement' && object.proposedKind !== 'requirement')) return object;
    const scope = context.get(object.id);
    const text = object.manual ? object.text : completeRequirementSentence(object.text, scope?.previous, scope);
    const issues = requirementWritingIssues(text);
    if (object.requirementSentenceIndex === undefined && /^If NOT \(/.test(scope?.previous.at(-1) || '') && /^[a-z]/.test(object.writingOriginalText || object.text)) issues.push('Confirm the explicit condition for this continuation; the original clause boundary was not retained.');
    const writingGap = object.evidenceIssue === 'requirement-writing';
    const kindChanged = issues.length ? !object.evidenceIssue && object.kind !== 'gap' : writingGap;
    if (!kindChanged && text === object.text && JSON.stringify(issues) === JSON.stringify(object.requirementWritingIssues || [])) return object;
    return { ...object, text, requirementWritingIssues: issues,
      ...(text !== object.text ? { writingOriginalText: object.writingOriginalText || object.text } : {}),
      ...(!object.evidenceIssue || writingGap ? issues.length ? { kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'requirement-writing' } : writingGap ? { kind: 'requirement', evidenceIssue: null } : {} : {}),
    };
  });
}
