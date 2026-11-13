import { safetyRequirementDraftingSources } from './safetyRequirementDraftingSources';
import { citationContext } from './artifactCitations';
import { needsBrief, briefGroups } from './generationBrief';
import { requestSection } from './artifactGeneration';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
const source = () => ({ id: 'record-source', sourceType: 'hazard-tracking-record', recordId: 'HTR-1', artifactTitle: 'Mission HTL', revision: 2, title: 'HTR-1 — Expired command execution', text: 'Expired commands can cause unintended motion.', objectIds: ['original-assessment'], attributes: {
  HTR: 'HTR-1', 'Safety Constraint': ['The controller shall reject commands older than 200 ms.'],
  Verification: ['VERIFICATION-INVENTORY '.repeat(6000)], Function: ['FUNCTION-INVENTORY '.repeat(1000)],
  'Operational Scenario': ['SCENARIO-INVENTORY '.repeat(1000)], Loss: ['LOSS-INVENTORY'], 'Safety Classification': ['CLASSIFICATION-INVENTORY'],
} });

test('only actionable issue summaries and constraints enter drafting while the complete saved manifest stays intact', () => {
  const saved = { hash: 'immutable-hash', entries: [source()] }, before = JSON.stringify(saved);
  expect(needsBrief(saved)).toBe(true);
  const focused = safetyRequirementDraftingSources(saved);
  expect(focused.hash).toBe(saved.hash);
  expect(focused.entries[0]).toMatchObject({ id: 'record-source', title: saved.entries[0].title, text: saved.entries[0].text, revision: 2 });
  expect(focused.entries[0].attributes).toEqual({ HTR: 'HTR-1', 'Safety Constraint': ['The controller shall reject commands older than 200 ms.'] });
  expect(needsBrief(focused)).toBe(false);
  expect(JSON.stringify(citationContext(focused).sources).length).toBeLessThan(1000);
  expect(JSON.stringify(saved)).toBe(before);
});

test('necessary large constraint sets retain their full content through review pieces', () => {
  const record = source(); record.attributes['Safety Constraint'] = Array.from({ length: 1200 }, (_, index) => `Protective action ${index}: ${'Retain the recorded numeric criteria. '.repeat(8)}`);
  const focused = safetyRequirementDraftingSources({ entries: [record] });
  const pieces = briefGroups(focused).flat();
  expect(pieces.length).toBeGreaterThan(1);
  expect(JSON.stringify(pieces)).not.toContain('VERIFICATION-INVENTORY');
  const details = JSON.parse(pieces.map(piece => piece.content.fragment).join(''));
  expect(details.attributes['Safety Constraint']).toEqual(record.attributes['Safety Constraint']);
  expect(safetyRequirementDraftingSources({ entries: pieces }).entries).toEqual(pieces);
});

test('the actual AI request excludes HTL inventories and preserves the requirement criterion and source citation', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: [{ key: 'expire', kind: 'requirement', title: 'Reject expired commands', text: 'The controller shall reject commands older than 200 ms.', sourceIds: ['S1'] }] }) } }] }) }));
  const response = await requestSection({ meta: { id: 'sr', title: 'Safety Requirements', templateId: 'safety-requirements', config: { system: 'Mission' } }, section: { id: 's2', title: 'Safety requirements' }, sources: { entries: [source()] } });
  const body = JSON.parse(fetch.mock.calls[0][1].body), input = JSON.parse(body.messages[1].content);
  expect(JSON.stringify(input.sources)).not.toMatch(/VERIFICATION-INVENTORY|FUNCTION-INVENTORY|SCENARIO-INVENTORY|LOSS-INVENTORY|CLASSIFICATION-INVENTORY|original-assessment/);
  expect(input.sources[0].attributes['Safety Constraint']).toEqual(['The controller shall reject commands older than 200 ms.']);
  expect(response.objects[0].sourceIds).toEqual(['record-source']);
});
