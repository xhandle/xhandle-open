import { deduplicateFacts } from './generationBrief';
import { semanticHash } from './artifactModel';
import { SECTION_PARTS } from './artifactContentGuidance';
import { splitGenerationPart } from './generationSourceBatches';
import { pauseError } from './generationRecovery';
import { candidateConsolidationPlan, mergeIdenticalCandidates, reviewedCandidates } from './consolidationCandidates';

const facts = objects => objects.filter(object => object.kind !== 'section').map(({ key, kind, title, text, sourceIds, evidenceIssue, proposedKind }) => ({ key, kind, title, text, sourceIds, ...(evidenceIssue ? { evidenceIssue, proposedKind } : {}) }));
function materialize(meta, section, candidates, reviewRequired = false) {
  if (reviewRequired) candidates = [...candidates, { key: 'consolidation-review', kind: 'gap', title: 'Review remaining statement overlap', text: `Automatic consolidation retained ${candidates.length} proposed statements to preserve their recorded criteria and source links. Review remaining overlap before approval. Statements were not discarded to meet a fixed item count.`, sourceIds: [...new Set(candidates.flatMap(candidate => candidate.sourceIds))] }];
  const keys = new Set();
  return [{ id: `${meta.id}:${section.id}`, sectionId: section.id, parentId: null, title: section.title, text: '', kind: 'section', sourceIds: [], manual: false }, ...candidates.map(fact => {
    let key = fact.key;
    let suffix = 0;
    while (keys.has(key)) key = `${fact.key.slice(0, 40)}-${semanticHash(fact).slice(0, 24)}-${++suffix}`;
    keys.add(key);
    return { ...fact, key, id: `${meta.id}:${section.id}:${key}`, sectionId: section.id, parentId: `${meta.id}:${section.id}`, manual: false };
  })];
}

// A complete oversized response is useful draft work, not a failed section.
// Save every validated candidate, then request a concise synthesis of those
// candidates. Only the final concise set becomes document content.
export async function generateConciseSection(args, { saved, sourceHash, generate, checkpoint, onProgress }) {
  const { meta, section, signal } = args;
  let state = saved;
  const persist = async patch => { state = { ...state, version: 1, sourceHash, ...patch }; await checkpoint(state); };
  if (state && (state.version !== 1 || state.sourceHash !== sourceHash)) throw new Error('Saved section synthesis inputs changed. Start a fresh update.');
  if (!state) {
    try {
      const candidates = facts(await generate({ ...args, retainOverflow: true }));
      if (candidates.length <= 60) return materialize(meta, section, candidates);
      await persist({ candidates, round: 0, completed: {} });
    } catch (error) {
      if (signal?.aborted) throw pauseError();
      if (error.code !== 'OUTPUT_LIMIT') throw error;
      await persist({ work: SECTION_PARTS, completed: {} });
    }
  }
  if (state.work) {
    for (let index = 0; index < state.work.length; index++) {
      const part = state.work[index];
      if (signal?.aborted) throw pauseError();
      if (state.completed[part.id]) continue;
      const selected = part.sourceIds && new Set(part.sourceIds);
      const sources = selected ? { ...args.sources, entries: args.sources.entries.filter(entry => selected.has(entry.id)) } : args.sources;
      try {
        const candidates = facts(await generate({ ...args, sources, part, completed: Object.values(state.completed).flat(), retainOverflow: true }));
        await persist({ completed: { ...state.completed, [part.id]: candidates } });
      } catch (error) {
        if (signal?.aborted) throw pauseError();
        if (error.code !== 'OUTPUT_LIMIT') throw error;
        const children = splitGenerationPart(part, args.sources);
        if (!children) throw error;
        await persist({ work: [...state.work.slice(0, index), ...children, ...state.work.slice(index + 1)] });
        index--;
      }
    }
    await persist({ candidates: deduplicateFacts(state.work.flatMap(part => state.completed[part.id])), round: 0, completed: {}, work: null });
  }
  if (state.strategy !== 2) {
    // Upgrade old eight-pass checkpoints in place, retaining both their latest
    // candidates and any completed partial synthesis instead of restarting.
    await persist({ candidates: mergeIdenticalCandidates([...state.candidates, ...Object.values(state.completed || {}).flat()]), strategy: 2, round: 0, completed: {}, finished: false });
  }
  if (state.finished) return materialize(meta, section, state.candidates, state.reviewRequired);
  for (; state.round < 3;) {
    if (signal?.aborted) throw pauseError();
    if (state.candidates.length <= 60) return materialize(meta, section, state.candidates);
    const { inputs, citations, byId, groups } = candidateConsolidationPlan(state.candidates);
    const before = state.candidates;
    onProgress(`Consolidating ${state.candidates.length} candidate statements for ${section.title}…`, { stage: 'synthesizing', synthesisRound: state.round + 1 });
    for (let index = 0; index < groups.length; index++) {
      if (signal?.aborted) throw pauseError();
      if (state.completed[index]) continue;
      const rows = await generate({ ...args, sources: { ...inputs, entries: groups[index] }, citationMap: citations,
        task: 'section-consolidation', retainOverflow: true,
        part: { id: `consolidation-${state.round}-${index}`, title: `Consolidate candidate statements ${index + 1} of ${groups.length}`, targetItems: Math.max(1, Math.min(state.stagnantPasses ? 4 : 8, Math.ceil(groups[index].length / 3))), focus: 'Consolidate the supplied candidate statements for this same section. Merge repetitive explanations and requirements with the same protective action. Preserve distinct requirements, recorded numeric criteria, every relevant citation and unresolved gaps. Cite EVERY candidate statement covered by each merged result using its supplied short source ID. If a candidate is distinct, retain it separately; never omit it to reach the target. Do not create an item for every source or repeat other sections. Draft statements are proposals, not new engineering evidence. Use the smallest complete set of concise statements.' },
      });
      const { omitted } = reviewedCandidates(rows, groups[index], byId);
      await persist({ completed: { ...state.completed, [index]: [...facts(rows), ...omitted] } });
    }
    const completed = state.completed;
    const candidates = mergeIdenticalCandidates(groups.flatMap((_, index) => completed[index]));
    const shrinking = candidates.length < before.length;
    const finished = (!shrinking && state.stagnantPasses >= 1) || state.round >= 2 || candidates.length <= 60;
    const retained = candidates.length > before.length ? mergeIdenticalCandidates([...before, ...candidates.filter(candidate => candidate.kind === 'gap')]) : candidates;
    await persist({ candidates: retained, completed: {}, round: state.round + 1, stagnantPasses: shrinking ? 0 : (state.stagnantPasses || 0) + 1, finished, reviewRequired: finished && retained.length > 60 });
    if (finished) return materialize(meta, section, state.candidates, state.reviewRequired);
  }
  return materialize(meta, section, state.candidates, state.candidates.length > 60);
}
