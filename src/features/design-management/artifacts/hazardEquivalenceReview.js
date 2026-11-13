import { semanticHash } from './artifactModel';
import { consolidateHazardRows, hazardGroupValues } from './consolidateHazardRows';
import { hazardEquivalenceSignature } from './hazardTrackingFields';
import { generationError, pauseError, waitForRetry } from './generationRecovery';
import { buildActionableHazardFamilies } from './actionableHazardFamilies';

const VERSION = 1, BATCH_SIZE = 64, INPUT_LIMIT = 48000;
const placeholder = value => !value || /^(?:n\/?a|none|unknown|tbd|not applicable|not specified|—|-)\.?$/i.test(value) || /^(?:hazard|hzd|h|risk|issue)[\s:#_-]*\d+\.?$/i.test(value);
const normalized = value => String(value).toLowerCase().replace(/\s+/g, ' ').trim();
function reviewCatalog(objects, mode) {
  const raw = objects.map(object => object.hazardEquivalence ? { ...object, hazardEquivalence: undefined } : object);
  return consolidateHazardRows(raw).filter(group => group.actionable || !placeholder(group.attributes.Hazard)).map((group, index) => {
    const context = column => {
      const values = hazardGroupValues(group, column).filter(Boolean);
      return { values: values.slice(0, 4), omitted: Math.max(0, values.length - 4) };
    };
    return { id: `H${index + 1}`, hazard: group.summary || group.attributes.Hazard, functions: context('Function'), losses: context('Loss'), scenarios: context('Operational Scenario'), modes: context('Operational Mode'), conditions: context('Operating Conditions'), ...(mode === 'actionable' ? { hazardVariants: { values: (group.values?.Hazard || [group.attributes.Hazard]).filter(Boolean).slice(0, 8), omitted: Math.max(0, (group.values?.Hazard?.length || 1) - 8) } } : {}), rowIds: group.rows.map(row => row.id) };
  });
}
const publicRecord = ({ rowIds, ...record }) => record;
const tokens = record => [
  ...[...new Set(normalized(record.hazard).match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(token => !/^(the|and|with|from|when|that|this|system|hazard|could|may|can)$/.test(token)),
  ...record.functions.values.map(value => `function:${normalized(value)}`),
  ...record.losses.values.map(value => `loss:${normalized(value)}`),
];
function validateGroups(response, records, newIds) {
  if (!response || !Array.isArray(response.groups) || response.groups.length > 4096) throw generationError('HAZARD_GROUPS_INVALID', 'Hazard consolidation returned an invalid grouping. Resume to retry the comparison.');
  const allowed = new Set(records.map(record => record.id)), fresh = new Set(newIds), groups = [];
  for (const group of response.groups) {
    if (!Array.isArray(group) || group.length > 4096 || group.some(id => typeof id !== 'string' || !allowed.has(id))) throw generationError('HAZARD_GROUPS_INVALID', 'The hazard comparison referenced descriptions that were not supplied. Saved work is retained; resume to retry.');
    const members = [...new Set(group)];
    // Singleton groups assert no equivalence. Repeated/overlapping known IDs
    // express the same equivalence relation and are coalesced by union below.
    // Candidate-only groups are outside this batch's new comparisons.
    if (members.length > 1 && members.some(id => fresh.has(id))) groups.push(members);
  }
  return groups;
}

// Review unique descriptions, never the full worksheet. Candidate retrieval is
// bounded; only the model's explicit equivalence groups are applied. Checkpoint
// after each batch so cancellation/provider failures can resume comparisons.
export async function reviewHazardEquivalence({ objects, saved, request, checkpoint, onProgress = () => {}, signal, mode = 'equivalent' }) {
  if (mode === 'actionable') objects = buildActionableHazardFamilies(objects);
  const catalog = reviewCatalog(objects, mode), records = catalog.map(publicRecord);
  const inputHash = semanticHash(mode === 'actionable' ? { mode, records } : records);
  const version = mode === 'actionable' ? 2 : VERSION;
  let state = saved?.version === version && saved.inputHash === inputHash ? saved : { version, inputHash, next: 0, parents: {}, complete: false };
  if (!Number.isInteger(state.next) || state.next < 0 || state.next > records.length) throw new Error('The saved hazard comparison checkpoint is invalid. Start a new update.');
  const parents = new Map(Object.entries(state.parents));
  const known = new Set(records.slice(0, state.next).map(record => record.id));
  if ([...parents].some(([id, parent]) => !known.has(id) || !known.has(parent))) throw new Error('The saved hazard grouping references unavailable descriptions. Start a new update.');
  const root = id => { const visited = new Set(); while (parents.has(id)) { if (visited.has(id)) throw new Error('The saved hazard grouping is invalid. Start a new update.'); visited.add(id); id = parents.get(id); } return id; };
  const index = new Map();
  const add = record => { for (const token of tokens(record)) { if (!index.has(token)) index.set(token, []); const ids = index.get(token); ids.push(record.id); if (ids.length > 256) ids.splice(128, 1); } };
  records.slice(0, state.next).forEach(add);
  const byId = new Map(records.map(record => [record.id, record]));
  const clusterMembers = new Map(records.map(record => [record.id, new Set([record.id])]));
  for (const record of records) {
    const representative = root(record.id);
    if (representative !== record.id) { clusterMembers.get(representative).add(record.id); clusterMembers.delete(record.id); }
  }
  const clusterCache = new Map();
  const representativeRecord = id => {
    if (mode !== 'actionable' || clusterMembers.get(id).size === 1) return byId.get(id);
    if (!clusterCache.has(id)) {
      const members = [...clusterMembers.get(id)].map(member => byId.get(member));
      const aggregate = (field, limit) => {
        const values = [...new Set(members.flatMap(record => record[field]?.values || []))];
        const take = Math.min(limit, values.length);
        return { values: Array.from({ length: take }, (_, index) => values[Math.floor(index * values.length / take)]), omitted: Math.max(0, values.length - take) + members.reduce((sum, record) => sum + (record[field]?.omitted || 0), 0) };
      };
      clusterCache.set(id, { id, hazard: 'Previously consolidated concern — judge the complete member scope below', functionalFamilies: members.length,
        functions: aggregate('functions', 12), losses: aggregate('losses', 4), scenarios: aggregate('scenarios', 4), modes: aggregate('modes', 4), conditions: aggregate('conditions', 4), hazardVariants: aggregate('hazardVariants', 12) });
    }
    return clusterCache.get(id);
  };
  while (state.next < records.length && records.length > 1) {
    if (signal?.aborted) throw pauseError();
    const comparisonSize = Math.max(1, Math.min(BATCH_SIZE, Math.floor(state.comparisonSize || BATCH_SIZE)));
    const batch = []; let bytes = 0;
    for (let offset = state.next; offset < records.length && batch.length < comparisonSize; offset++) {
      const record = records[offset], size = JSON.stringify(record).length;
      if (size > INPUT_LIMIT / 2) throw new Error('A hazard description is too large for a bounded consolidation comparison. Saved assessments are retained.');
      if (batch.length && bytes + size > INPUT_LIMIT / 2) break;
      batch.push(record); bytes += size;
    }
    const scores = new Map();
    for (const record of batch) for (const token of tokens(record)) for (const id of index.get(token) || []) scores.set(id, (scores.get(id) || 0) + (token.startsWith('function:') ? 4 : token.startsWith('loss:') ? 2 : 1));
    // Include recent representatives even without shared words, allowing the
    // semantic comparison to recognize synonyms rather than lexical duplicates.
    records.slice(Math.max(0, state.next - 16), state.next).forEach(record => { if (!scores.has(record.id)) scores.set(record.id, 0); });
    const candidates = [], candidateIds = new Set();
    for (const [id] of [...scores].sort((a, b) => b[1] - a[1])) {
      const representative = root(id);
      if (candidateIds.has(representative)) continue;
      const record = representativeRecord(representative), size = JSON.stringify(record).length;
      if (candidates.length >= comparisonSize || bytes + size > INPUT_LIMIT) continue;
      candidateIds.add(representative); candidates.push(record); bytes += size;
    }
    const supplied = [...batch, ...candidates], newIds = batch.map(record => record.id);
    onProgress(`Comparing ${mode === "actionable" ? "actionable safety concerns" : "equivalent hazards"}: ${state.next} of ${records.length} descriptions…`, { stage: 'reviewing', hazardDescriptionsReviewed: state.next, hazardDescriptionsTotal: records.length });
    if (supplied.length > 1) {
      let groups, formatCorrection = false, outputRetry = false, transportRetries = 0, smaller = false;
      while (!groups) {
        try {
          const response = await request({ records: supplied, newIds, signal, formatCorrection, outputRetry, mode });
          if (signal?.aborted) throw pauseError();
          groups = validateGroups(response, supplied, newIds);
        } catch (error) {
          if (signal?.aborted) throw pauseError();
          if (error.code === 'TRANSIENT_PROVIDER' && transportRetries < 2 && (error.retryAfterMs || 0) <= 30000) {
            await waitForRetry(Math.max(error.retryAfterMs || 0, 1000 * (2 ** transportRetries++)), signal); continue;
          }
          const invalidFormat = ['HAZARD_RESPONSE_FORMAT', 'HAZARD_OUTPUT_LIMIT', 'HAZARD_GROUPS_INVALID'].includes(error.code);
          if (invalidFormat && !formatCorrection) {
            formatCorrection = true; outputRetry = error.code === 'HAZARD_OUTPUT_LIMIT';
            onProgress('Correcting the hazard comparison response format…', { stage: 'retrying', retryReason: 'Correcting the comparison format' }); continue;
          }
          if (invalidFormat && comparisonSize > 1) {
            state = { ...state, comparisonSize: Math.max(1, Math.floor(Math.min(comparisonSize, batch.length) / 2)), successfulComparisons: 0 };
            await checkpoint(state); smaller = true;
            onProgress('Retrying hazard consolidation with a smaller comparison. Completed comparisons are retained.', { stage: 'retrying', retryReason: 'Reducing the comparison size' }); break;
          }
          throw error;
        }
      }
      if (smaller) continue;
      if (signal?.aborted) throw pauseError();
      for (const group of groups) {
        const roots = [...new Set(group.map(root))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
        for (const id of roots.slice(1)) {
          parents.set(id, roots[0]);
          for (const member of clusterMembers.get(id)) clusterMembers.get(roots[0]).add(member);
          clusterMembers.delete(id); clusterCache.delete(id);
        }
        clusterCache.delete(roots[0]);
      }
    }
    batch.forEach(add);
    let successfulComparisons = supplied.length > 1 ? (state.successfulComparisons || 0) + 1 : state.successfulComparisons || 0;
    let nextComparisonSize = comparisonSize;
    if (comparisonSize < BATCH_SIZE && successfulComparisons >= 3) {
      nextComparisonSize = Math.min(BATCH_SIZE, comparisonSize * 2); successfulComparisons = 0;
    }
    state = { ...state, comparisonSize: nextComparisonSize, successfulComparisons, next: state.next + batch.length, parents: Object.fromEntries(parents) };
    await checkpoint(state);
  }
  const members = new Map();
  for (const record of catalog) { const id = root(record.id); if (!members.has(id)) members.set(id, []); members.get(id).push(record); }
  const tags = new Map();
  for (const records of members.values()) if (records.length > 1) {
    // Bind membership to the reviewed meanings, not a reusable source-row ID.
    // Retained manual objects from an earlier revision cannot accidentally join
    // a new group whose representative row now describes a different event.
    const meanings = records.map(({ id, rowIds, ...meaning }) => meaning).sort((a, b) => a.hazard.localeCompare(b.hazard));
    const groupId = `semantic:${semanticHash(meanings)}`;
    for (const record of records) for (const rowId of record.rowIds) tags.set(rowId, { groupId });
  }
  const grouped = objects.map(object => {
    const tag = tags.get(object.id);
    if (tag) return { ...object, hazardEquivalence: { ...tag, signature: hazardEquivalenceSignature(object.attributes), method: mode === 'actionable' ? 'actionable' : 'semantic' } };
    if (object.hazardEquivalence) { const { hazardEquivalence, ...original } = object; return original; }
    return object;
  });
  state = { ...state, mode, next: records.length, complete: true };
  onProgress(`Reviewed ${records.length} hazard descriptions.`, { stage: 'saving', hazardDescriptionsReviewed: records.length, hazardDescriptionsTotal: records.length });
  return { objects: grouped, state };
}
