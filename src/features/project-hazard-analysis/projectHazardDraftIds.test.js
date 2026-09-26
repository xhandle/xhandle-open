import { identifyProjectHazardDraftRow } from './projectHazardDraftIds';
import { normalizeReviewedHazardRowForPersistence } from './hazardRegenerationReview';
import { planHazardAnalysisCsvImport, applyHazardAnalysisCsvImport } from './hazardAnalysisCsv';
import { toCsvText } from '../../lib/csv';

const headers = ['Function (From)', 'Control Action', 'Function (To)', 'Guide Phrase', 'Raw Analysis Row ID', 'Causal Scenario'];
const empty = ['Planner', 'Plan', 'Executor', 'Too late', '', ''];

test('assigns repeatable IDs to untouched drafts and distinguishes duplicate targets', () => {
  const first = identifyProjectHazardDraftRow(headers, empty, null, '0:guide:0');
  expect(first[4]).toMatch(/^RAW-/);
  expect(identifyProjectHazardDraftRow(headers, empty, null, '0:guide:0')).toEqual(first);
  expect(identifyProjectHazardDraftRow(headers, empty, null, '1:guide:0')[4]).not.toBe(first[4]);
  expect(empty[4]).toBe('');
});

test('retains ID across manual edits, generation and CSV import', () => {
  const draft = identifyProjectHazardDraftRow(headers, empty);
  const edited = [...draft]; edited[5] = 'Manually written scenario';
  expect(identifyProjectHazardDraftRow(headers, edited)[4]).toBe(draft[4]);
  const aiRow = [...edited]; aiRow[4] = 'AI-ID';
  const generated = normalizeReviewedHazardRowForPersistence({ headers, sourceRow: draft, regeneratedRow: aiRow }).row;
  expect(generated[4]).toBe(draft[4]);
  const plan = planHazardAnalysisCsvImport([headers, draft], toCsvText([headers, edited]));
  expect(plan.errors).toEqual([]);
  expect(applyHazardAnalysisCsvImport([headers, draft], plan.updates)[1][4]).toBe(draft[4]);
});

test('fills legacy blanks from the draft identity without changing existing IDs', () => {
  const fallback = identifyProjectHazardDraftRow(headers, empty);
  const legacy = [...empty]; legacy[5] = 'Saved scenario';
  expect(identifyProjectHazardDraftRow(headers, legacy, fallback)[4]).toBe(fallback[4]);
  legacy[4] = 'EXISTING-ID';
  expect(identifyProjectHazardDraftRow(headers, legacy, fallback)).toBe(legacy);
});
