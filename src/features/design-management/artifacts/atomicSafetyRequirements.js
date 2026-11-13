import { semanticHash } from './artifactModel';
import { completeRequirementSentence, requirementSentences, reviewRequirementWriting } from './requirementWriting';

function outsideQuotes(text) {
  let quote = null;
  return [...text].map((character, index, characters) => {
    if (quote) {
      if (character === quote && characters[index - 1] !== '\\') quote = null;
      return ' '.repeat(character.length);
    }
    if (['"', '“', '`'].includes(character)) { quote = character === '“' ? '”' : character; return ' '; }
    return character;
  }).join('');
}
const shalls = text => [...outsideQuotes(text).matchAll(/\bshall\b/gi)];
function condition(prefix) {
  if (!/^(?:if|when|whenever|while|unless|until|before|after|during|under|provided that|where)\b/i.test(prefix.trim())) return '';
  const masked = outsideQuotes(prefix);
  let depth = 0;
  for (let index = 0; index < masked.length; index++) {
    if ('([{'.includes(masked[index])) depth++;
    else if (')]}'.includes(masked[index])) depth--;
    else if (masked[index] === ',' && !depth) return prefix.slice(0, index + 1).trim() + ' ';
  }
  return '';
}
const standalone = text => {
  const cleaned = text.trim().replace(/^[•*-]\s+/, '').replace(/[,;]\s*$/, '').trim();
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
};

function sentenceClauses(sentence) {
  const modal = shalls(sentence);
  if (modal.length < 2) return [sentence.trim()];
  const masked = outsideQuotes(sentence), prefix = sentence.slice(0, modal[0].index).trim();
  const boundaries = [];
  for (let index = 1; index < modal.length; index++) {
    const start = modal[index - 1].index + 5, between = masked.slice(start, modal[index].index);
    // An OR is one alternative obligation; splitting it would require both.
    if (/\bor\s*$/i.test(between)) return [sentence.trim()];
    const strong = [...between.matchAll(/;\s*|,\s*(?:and|but)\s+/gi)];
    const shared = [...between.matchAll(/\b(?:and|but)\s*$/gi)];
    const explicit = [...between.matchAll(/\b(?:and|but)\s+(?=(?:the|a|an|each|every|all|only|no|any)\b)/gi)];
    // Prefer the separator nearest the next obligation. Earlier semicolons
    // can belong to a list or code expression inside the first obligation.
    const boundary = [...strong, ...shared, ...explicit].sort((a, b) => b.index - a.index)[0];
    if (!boundary) return [sentence.trim()];
    boundaries.push({ from: start + boundary.index, to: start + boundary.index + boundary[0].length });
  }
  const clauses = [];
  let start = 0, sharedPrefix = prefix;
  for (const boundary of [...boundaries, { from: sentence.length, to: sentence.length }]) {
    let clause = sentence.slice(start, boundary.from).trim();
    if (start) {
      if (/^shall\b/i.test(clause)) clause = `${sharedPrefix} ${clause}`;
      else if (!/^otherwise\b/i.test(clause) && condition(prefix) && !condition(clause.slice(0, shalls(clause)[0]?.index))) clause = `${condition(prefix)}${clause}`;
    }
    sharedPrefix = clause.slice(0, shalls(clause)[0]?.index).trim().replace(/^otherwise\s*[,;]?\s*/i, '');
    clauses.push(standalone(clause)); start = boundary.to;
  }
  return clauses;
}

export function splitShallStatements(text) {
  const sentences = requirementSentences(text);
  const requirements = [], context = [], origins = [];
  for (const [sentenceIndex, sentence] of sentences.entries()) {
    if (shalls(sentence).length) sentenceClauses(sentence).forEach((clause, clauseIndex) => {
      requirements.push(completeRequirementSentence(clause, requirements, { inheritCondition: clauseIndex > 0 }));
      origins.push({ requirementSentenceIndex: sentenceIndex, requirementClauseIndex: clauseIndex, ...(requirements.at(-1) !== clause ? { writingOriginalText: clause } : {}) });
    });
    else if (sentence.trim()) context.push(sentence.trim());
  }
  return { requirements, origins, context: context.join('\n\n') };
}

export function organizeAtomicSafetyRequirements(objects) {
  const usedIds = new Set(objects.map(object => object.id));
  const result = [];
  for (const object of objects) {
    // A rejected new draft remains a review gap. Splitting that response must
    // not make it appear that the model produced conforming requirements.
    if (object.evidenceIssue === 'requirement-writing' && !object.requirementGroupId) { result.push(object); continue; }
    if (object.deleted || (object.atomicRequirement && object.atomicTextHash === semanticHash(object.text).slice(0, 20)) || !['requirement', 'narrative', 'gap', 'section'].includes(object.kind) || shalls(object.text || '').length < 2) { result.push(object); continue; }
    const { requirements, origins, context } = splitShallStatements(object.text);
    if (requirements.length < 2) { result.push(object); continue; }
    const { Description, ...attributes } = object.attributes || {};
    // Keep the topic identity and evidence; children receive deterministic IDs
    // so regeneration can retain individually edited requirements.
    result.push({ ...object, kind: 'section', text: context, requirementGroup: true, requirementSourceText: object.requirementSourceText || object.text });
    requirements.forEach((text, index) => {
      const hash = semanticHash(text).slice(0, 20);
      let id = `${object.id}:shall:${hash}`, suffix = 1;
      while (usedIds.has(id)) id = `${object.id}:shall:${hash}:${++suffix}`;
      usedIds.add(id);
      const { content, ...base } = object;
      const unresolved = object.kind === 'gap' || !!object.evidenceIssue;
      const title = text.replace(/\s+/g, ' ').trim();
      result.push({ ...base, id, key: `shall-${hash}-${index + 1}`, parentId: object.id, order: index,
        title: title.length <= 140 ? title : `${title.slice(0, 137).replace(/\s+\S*$/, '')}…`, text,
        kind: unresolved ? 'gap' : 'requirement', ...(unresolved ? { proposedKind: 'requirement' } : {}),
        attributes, atomicRequirement: true, atomicTextHash: hash, requirementGroupId: object.id, ...origins[index],
      });
    });
  }
  return reviewRequirementWriting(result).map(object => object.atomicRequirement && object.atomicTextHash !== semanticHash(object.text).slice(0, 20) ? { ...object, atomicTextHash: semanticHash(object.text).slice(0, 20) } : object);
}
