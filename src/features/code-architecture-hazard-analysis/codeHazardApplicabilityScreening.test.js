jest.mock('../../components/aiAnalysisSTPA', () => ({fetchLLMResponse: jest.fn()}));
import { fetchLLMResponse } from '../../components/aiAnalysisSTPA';
import { screenCodeHazardApplicability } from './codeHazardApplicabilityScreening';
import { getCodeArchitectureHazardGuidePhrases } from './codeArchitectureHazardUtils';
import { generateStandardCodeHazardAnalysisSheets } from '../../components/aiAnalysisCodeHazardStandard';

const phrases = ['Not provided', 'Applied too long'];
function input(actions = ['Set software operating mode'], contexts = ['Operation'], guidePhrases = phrases) {
  const tableRows = actions.flatMap((action, i) => contexts.flatMap(mode => guidePhrases.map(guidePhrase => ({
    traceId: `trace${i}`, fromFunction: 'Controller', controlAction: action, toFunction: 'Worker',
    controlDetails: action, operationalContextId: mode, operationalMode: mode, guidePhrase,
    guidePhraseApplicable: '', guidePhraseApplicabilityRationale: '',
  }))));
  return {projectId: 'p1', repoId: 'r1', architectureSnapshotHash: 'revision1', functionalModelSnapshotHash: 'functional1',
    tableRows, sheets: {'Functional Decomposition': [
      ['Function (From)', 'Control Action', 'Function (To)', 'Guide Phrase', 'Guide Phrase Applicable', 'Guide Phrase Applicability Rationale'],
      ...tableRows.map(row => [row.fromFunction, row.controlAction, row.toFunction, row.guidePhrase, '', '']),
    ]}};
}
function answer(records, qualify = () => 'Control') {
  return records.map(record => ({id: record.id, qualification: qualify(record), controller: record.from,
    recipient: record.to, requestedBehavior: record.action, evidence: record.action,
    decisions: record.phrases.map(phrase => ({phrase,
      value: qualify(record) === 'Unresolved' ? 'Needs Review' : qualify(record) === 'Non-control' ? 'No' : 'Yes',
      rationale: `Evidence for ${phrase}`, evidence: record.action}))}));
}
const recordsFrom = prompt => JSON.parse(prompt.split('\nRecords:\n')[1]);
beforeEach(() => { fetchLLMResponse.mockReset(); fetchLLMResponse.mockImplementation(async prompt => JSON.stringify(answer(recordsFrom(prompt)))); });

test('screens each relationship/context once with a phrase map; software controls are allowed', async () => {
  const result = await screenCodeHazardApplicability(input(['Authorize software access', 'Compute checksum in Python'], ['Startup', 'Operation']));
  expect(recordsFrom(fetchLLMResponse.mock.calls[0][0])).toHaveLength(4);
  expect(result.tableRows).toHaveLength(8);
  expect(result.tableRows.every(row => row.guidePhraseApplicable === 'Yes')).toBe(true);
  expect(result.tableRows.every(row => row.guidePhraseApplicabilityReviewStatus !== 'Reviewed')).toBe(true);
  expect(result.applicabilityScreening.counts).toEqual({yes: 8, no: 0, unresolved: 0});
});

test('non-controls and unresolved relationships remain traceable; no hazard calls for either', async () => {
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify(answer(recordsFrom(prompt), record =>
    record.action.includes('checksum') ? 'Non-control' : 'Unresolved')));
  const screened = await screenCodeHazardApplicability(input(['Compute checksum in Python', 'Unknown interface semantics']));
  expect(screened.applicabilityScreening.counts).toEqual({yes: 0, no: 2, unresolved: 2});
  fetchLLMResponse.mockClear();
  const sheets = await generateStandardCodeHazardAnalysisSheets({sheets: screened.sheets, method: 'STPA', currentFolder: 'test', setFolders: jest.fn()});
  expect(fetchLLMResponse).not.toHaveBeenCalled();
  const headers = sheets.Summary[0];
  const values = sheets.Summary.slice(1).map(row => row[headers.indexOf('Guide Phrase Applicable')]);
  expect(values).toEqual(['No', 'No', 'Needs Review', 'Needs Review']);
  const unresolved = sheets.Summary[3];
  expect(unresolved[headers.indexOf('Unsafe Control Actions')]).toBe('');
  expect(unresolved[headers.indexOf('Guide Phrase Applicability Origin')]).toBe('Automatic screening');
});

test('phrase-specific evidence distinguishes instantaneous and sustained semantics without safety conclusions', async () => {
  fetchLLMResponse.mockImplementation(async prompt => {
    expect(prompt).toContain('Applicability is independent of adverse consequences');
    const rows = recordsFrom(prompt);
    const result = answer(rows);
    result[0].decisions[1].value = 'No';
    result[0].decisions[1].rationale = 'This is an instantaneous transaction, not a maintained command.';
    return JSON.stringify(result);
  });
  const result = await screenCodeHazardApplicability(input(['Authorize single transaction', 'Maintain commanded valve pressure']));
  expect(result.tableRows.map(row => row.guidePhraseApplicable)).toEqual(['Yes', 'No', 'Yes', 'Yes']);
});

test('human decisions and rationales are never sent for rescreening or marked automatic', async () => {
  const source = input();
  source.tableRows.forEach((row, index) => Object.assign(row, {guidePhraseApplicable: index ? 'No' : 'Yes',
    guidePhraseApplicabilityRationale: 'Accepted user decision', guidePhraseApplicabilityReviewStatus: 'Reviewed'}));
  const result = await screenCodeHazardApplicability(source);
  expect(fetchLLMResponse).not.toHaveBeenCalled();
  expect(result.tableRows).toEqual(source.tableRows);
  expect(result.tableRows[0].guidePhraseApplicabilityOrigin).toBeUndefined();
});

test('validated checkpoints resume; scope changes never reuse decisions', async () => {
  const data = new Map();
  const checkpoint = {read: async basis => data.get(JSON.stringify(basis)), write: async (basis, result) => data.set(JSON.stringify(basis), result)};
  await screenCodeHazardApplicability(input(), {checkpoint});
  await screenCodeHazardApplicability(input(), {checkpoint});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  for (const patch of [{projectId: 'p2'}, {repoId: 'r2'}, {architectureSnapshotHash: 'revision2'}, {functionalModelSnapshotHash: 'functional2'}, {operationalContext: 'Changed context'}]) {
    await screenCodeHazardApplicability({...input(), ...patch}, {checkpoint});
  }
  expect(fetchLLMResponse).toHaveBeenCalledTimes(6);
  data.clear(); // explicit regeneration clears the checkpoint scope
  await screenCodeHazardApplicability(input(), {checkpoint});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(7);
});

test('invalid output splits and retries; exhaustion becomes visible Needs Review and is not cached', async () => {
  fetchLLMResponse.mockResolvedValue('bad json');
  const checkpoint = {read: jest.fn(), write: jest.fn()};
  const result = await screenCodeHazardApplicability(input(['Set valve position', 'Compute checksum']), {checkpoint});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(5);
  expect(checkpoint.write).not.toHaveBeenCalled();
  expect(result.applicabilityScreening.counts.unresolved).toBe(4);
});

test('ungrounded exclusion cannot silently skip a row', async () => {
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify(answer(recordsFrom(prompt), () => 'Non-control').map(row => ({...row, evidence: 'Fabricated unsupported evidence'}))));
  const result = await screenCodeHazardApplicability(input());
  expect(result.tableRows.every(row => row.guidePhraseApplicable === 'Needs Review')).toBe(true);
});

test('cancellation stops immediately and never publishes fallback decisions', async () => {
  const controller = new AbortController();
  fetchLLMResponse.mockImplementation(async () => {controller.abort(); throw new DOMException('Cancelled', 'AbortError');});
  await expect(screenCodeHazardApplicability(input(), {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});

test('700-row fixture uses 4 compact screens and 18 generation calls when screening excludes 80 percent', async () => {
  let screens = 0;
  let hazardCalls = 0;
  fetchLLMResponse.mockImplementation(async prompt => {
    if (prompt.includes('\nRecords:\n')) {
      screens += 1;
      return JSON.stringify(answer(recordsFrom(prompt), record => Number(record.action.match(/\d+/)[0]) % 5 === 0 ? 'Control' : 'Non-control'));
    }
    hazardCalls += 1;
    const rows = JSON.parse(prompt.split('\nRows:\n')[1]);
    return JSON.stringify(rows.map(row => ({id: row.id, guidePhraseApplicable: 'Yes',
      guidePhraseApplicabilityRationale: row.guidePhraseApplicabilityRationale,
      hazards: 'Synthetic assessed hazard for scheduling measurement.'})));
  });
  const source = input(Array.from({length: 50}, (_, index) => `Command software mode ${index}`), ['Startup', 'Operation'], getCodeArchitectureHazardGuidePhrases('STPA-Textbook'));
  const result = await screenCodeHazardApplicability(source);
  expect(result.tableRows).toHaveLength(700);
  expect(result.applicabilityScreening.counts).toEqual({yes: 140, no: 560, unresolved: 0});
  await expect(generateStandardCodeHazardAnalysisSheets({sheets: result.sheets, method: 'STPA', provider: 'openai',
    setFolders: jest.fn(), currentFolder: 'test', onStageComplete: () => { throw new Error('Stop diagnostic at generation boundary'); },
  })).rejects.toThrow('Stop diagnostic at generation boundary');
  expect(screens).toBe(4);
  expect(hazardCalls).toBe(18);
});

test('checkpoint write failures surface without repeating AI work or inventing unresolved applicability', async () => {
  const checkpoint = {read: jest.fn(), write: jest.fn().mockRejectedValue(new Error('Storage unavailable'))};
  await expect(screenCodeHazardApplicability(input(), {checkpoint})).rejects.toThrow('Storage unavailable');
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});

test('completed split batches resume without reclassifying their records', async () => {
  const data = new Map();
  const checkpoint = {read: async key => data.get(JSON.stringify(key)), write: async (key, value) => data.set(JSON.stringify(key), value)};
  fetchLLMResponse.mockImplementation(async prompt => {
    const records = recordsFrom(prompt);
    return records.length > 1 ? 'truncated JSON' : JSON.stringify(answer(records));
  });
  const source = input(['Set software mode', 'Maintain valve pressure']);
  await screenCodeHazardApplicability(source, {checkpoint});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(3); // malformed parent splits immediately; two valid children
  fetchLLMResponse.mockClear();
  await screenCodeHazardApplicability(source, {checkpoint});
  expect(fetchLLMResponse).not.toHaveBeenCalled(); // completed split result is reusable as a whole
});

test('source evidence and model changes invalidate automatic decisions', async () => {
  const data = new Map();
  const checkpoint = {read: async key => data.get(JSON.stringify(key)), write: async (key, value) => data.set(JSON.stringify(key), value)};
  const sourceRows = [{traceId: 'trace0', codeEvidence: {sourceFunctions: [{functionName: 'mode', content: 'Set software mode only during startup'}]}}];
  await screenCodeHazardApplicability(input(), {checkpoint, sourceRows, modelContext: {model: 'model-a'}});
  await screenCodeHazardApplicability(input(), {checkpoint, sourceRows, modelContext: {model: 'model-b'}});
  await screenCodeHazardApplicability(input(), {checkpoint, sourceRows: [{...sourceRows[0], codeEvidence: {sourceFunctions: [{content: 'Set software mode during operation'}]}}], modelContext: {model: 'model-b'}});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(3);
});

test('compact indexed decisions retain individual rationales and grounded evidence', async () => {
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify(recordsFrom(prompt).map(record => ({
    id: record.id, qualification: 'Control', controller: record.from, recipient: record.to,
    requestedBehavior: record.action, evidence: record.action,
    decisions: [[1, 'No', 'Instantaneous transaction has no maintained duration.', '$qualification'],
      [0, 'Yes', 'Omission prevents the requested state change.', '$qualification']],
  }))));
  const result = await screenCodeHazardApplicability(input());
  expect(result.tableRows.map(row => row.guidePhraseApplicable)).toEqual(['Yes', 'No']);
  expect(result.tableRows[0].guidePhraseApplicabilityRationale).toContain('Omission');
  expect(result.applicabilityScreening.records[0].decisions[0].evidence).toBe('Set software operating mode');
});

test.each(['Non-control', 'Unresolved'])('compact %s qualification expands without losing rows', async qualification => {
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify(recordsFrom(prompt).map(record => ({
    id: record.id, qualification, evidence: record.action, rationale: 'Relationship qualification evidence.',
  }))));
  const result = await screenCodeHazardApplicability(input());
  expect(result.tableRows).toHaveLength(2);
  expect(result.tableRows.every(row => row.guidePhraseApplicable === (qualification === 'Non-control' ? 'No' : 'Needs Review'))).toBe(true);
});

test('duplicate compact phrase indices are rejected rather than silently misassigned', async () => {
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify(recordsFrom(prompt).map(record => ({
    id: record.id, qualification: 'Control', controller: record.from, recipient: record.to,
    requestedBehavior: record.action, evidence: record.action,
    decisions: [[0, 'Yes', 'Supported.', '$qualification'], [0, 'No', 'Unsupported.', '$qualification']],
  }))));
  const result = await screenCodeHazardApplicability(input());
  expect(result.applicabilityScreening.counts.unresolved).toBe(2);
});

test('large source evidence respects the input budget despite the higher record cap', async () => {
  const source = input(Array.from({length: 32}, (_, i) => `Command operating mode ${i}`));
  await screenCodeHazardApplicability(source, {sourceRows: source.tableRows.map(row => ({...row,
    codeEvidence: {sourceFunctions: [{content: 'e'.repeat(8000)}]},
  }))});
  expect(fetchLLMResponse.mock.calls.length).toBeGreaterThan(1);
  for (const [prompt] of fetchLLMResponse.mock.calls) expect(JSON.stringify(recordsFrom(prompt)).length).toBeLessThanOrEqual(96000);
});

test('phrase-heavy records respect the output decision budget', async () => {
  const source = input(Array.from({length: 32}, (_, i) => `Command operating mode ${i}`), ['Operation'],
    Array.from({length: 14}, (_, i) => `Fixture deviation ${i}`));
  const result = await screenCodeHazardApplicability(source);
  expect(result.tableRows).toHaveLength(448);
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
  for (const [prompt] of fetchLLMResponse.mock.calls) {
    expect(recordsFrom(prompt).reduce((count, record) => count + record.phrases.length, 0)).toBeLessThanOrEqual(224);
  }
});
