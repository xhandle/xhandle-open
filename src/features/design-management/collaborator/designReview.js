import { designReference, targetKey } from './designContext';

// Only route a straightforward current-view list request here. Engineering
// audits, comparisons and explicitly named alternative targets use the model's
// normal evidence reads. The list itself needs no probabilistic generation.
export function currentReviewListIntent(text, state, history = []) {
  if (!state.target || !['artifact', 'module', 'sysml'].includes(state.target.kind)) return null;
  const value = String(text || '').trim();
  const previous = [...history].reverse().find(row => row.role === 'assistant');
  const prior = previous?.designReviewResult;
  if (/^(?:please\s+)?(?:show\s+)?(?:the\s+)?next(?:\s+(?:page|review items|items|requirements))?[.!]?$/i.test(value)
    && prior && targetKey(prior.target) === targetKey(state.target) && prior.nextOffset !== null
    && (!prior.selectedIds || JSON.stringify(prior.selectedIds) === JSON.stringify((state.selectedIds || []).slice(0, 24)))) return { offset: prior.nextOffset, previousVersion: prior.version, selectedIds: prior.selectedIds };
  if (!/\b(?:which|what|show|list|find|identify)\b/i.test(value) || !/\b(?:needs?|requires?|requiring|needing|awaiting|pending)\s+(?:a\s+)?review\b/i.test(value)) return null;
  if (/\b(?:compare|across|other|another|versus|why|how|fix|rewrite|update|edit|change|only|approved|rejected|audit)\b/i.test(value)) return null;
  // An explicit named scope still needs normal catalog resolution. For
  // example, "these ... in Concept of Operations" is not the open draft.
  if (/\b(?:in|from|within|for)\s+(?!(?:a\s+table\b|(?:the\s+)?(?:this|current|open|selected|these|those)\b))/i.test(value) || /["“”]/.test(value)) return null;
  const deictic = /\b(?:these|those|selected|this\s+(?:document|artifact|draft|table|model|module)|(?:current|open)\s+(?:document|artifact|draft|table|model|module))\b/i.test(value);
  const generic = /^(?:please\s+)?(?:show(?:\s+me)?|list|find|identify)\s+(?:the\s+|all\s+)?(?:items|objects|requirements|gaps)(?:\s+(?:that|still))?\s+(?:need|require|needing|requiring|awaiting)\s+review[.!]?$/i.test(value);
  if (!deictic && !generic) return null;
  const wholeDocument = /\b(?:this|current|open|entire|whole)\s+(?:document|artifact|draft|table|model|module)\b/i.test(value);
  return { offset: 0, selectedIds: !wholeDocument && state.selectedIds?.length ? state.selectedIds.slice(0, 24) : undefined };
}

const cell = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '\\\\').replace(/([\[\]*_`])/g, '\\$1').replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ');
const excerpt = (value, limit) => value.length > limit ? `${value.slice(0, limit)}…` : value;

export async function answerCurrentReviewList(intent, state, read) {
  const readPage = offset => read({ operation: 'review', target: state.target, ids: intent.selectedIds, offset, limit: 24 });
  let result = await readPage(intent.offset);
  const changed = intent.previousVersion && intent.previousVersion !== result.version;
  if (changed) result = await readPage(0);
  const label = `${result.title}${result.target.draft ? ' · Draft' : ''}`;
  const scope = intent.selectedIds ? 'selected objects' : 'document objects';
  const lines = [`[${cell(label)}](${designReference(result.target)}) — ${result.total} ${scope} need review: ${result.flaggedCount} have recorded gaps or review flags; ${result.approvalOnlyCount} only await approval.`];
  if (changed) lines.push('The content changed since the previous page; this list starts again from the current saved version.');
  if (state.selectionTruncated && intent.selectedIds) lines.push(`Selection coverage: ${intent.selectedIds.length} of ${state.selectedCount} selected objects. This list covers only those supplied identities.`);
  if (result.items.length) {
    lines.push(`Showing ${result.offset + 1}–${result.offset + result.items.length} of ${result.total}.`);
    const table = ['| Object | Requirement / content | Reason for review | Status |', '| --- | --- | --- | --- |'];
    for (const row of result.items) table.push(`| [${cell(row.title || row.parentTitle || row.id)}](${row.reference}) | ${cell(excerpt(row.text || '', 700))} | ${cell(row.review.reasons.join(' '))}${row.review.reasonsTruncated ? '… (open object for all details)' : ''} | ${cell(row.review.status || 'Not recorded')} |`);
    lines.push(table.join('\n'));
    if (result.nextOffset !== null) lines.push('Ask “show the next review items” to continue.');
  } else lines.push('No items in this scope have saved review flags or a pending approval status.');
  lines.push('Based on saved review flags and approval status.');
  return { content: lines.join('\n\n'), designReviewResult: { target: result.target, version: result.version,
    selectedIds: intent.selectedIds, offset: result.offset, nextOffset: result.nextOffset } };
}
