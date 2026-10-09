jest.mock('./aiAnalysisSTPA', () => ({ fetchLLMResponse: jest.fn() }));
import { fetchLLMResponse } from './aiAnalysisSTPA';
import { getStandardConfig, runStandardHazardAnalysisStages } from './aiAnalysisCodeHazardStandard';

// Scheduling diagnostic only: mocked answers are not a semantic-quality evaluation.
const actions = ['Command valve position', 'Compute checksum in Python',
  'Authorize software mode change in C++', 'Write diagnostic log', 'Read cached count'];
const phrases = ['Not provided', 'Provided incorrectly', 'Too early', 'Too late',
  'Wrong order', 'Stopped too soon', 'Applied too long'];
const fixture = (screened) => Array.from({ length: 50 }, (_, relationship) =>
  phrases.flatMap(guidePhrase => ['startup', 'operation'].map(mode => ({
    id: `R${relationship}-${phrases.indexOf(guidePhrase)}-${mode}`,
    from: 'Source', to: 'Recipient', controlAction: actions[relationship % actions.length],
    guidePhrase, operationalMode: mode,
    ...(screened && relationship % 5 !== 0 ? {
      guidePhraseApplicable: 'No', guidePhraseApplicabilityRationale: 'Fixture exclusion.',
    } : {}),
  })))).flat();

test.each([['openai', 88, 18], ['claude', 175, 35]])(
  '%s: measures full-generation scheduling before versus after supplied No decisions',
  async (provider, unfilteredCalls, filteredCalls) => {
    for (const [screened, expectedRows, expectedCalls] of [[false, 700, unfilteredCalls], [true, 140, filteredCalls]]) {
      const scheduled = [];
      fetchLLMResponse.mockReset();
      fetchLLMResponse.mockImplementation(async prompt => {
        const rows = JSON.parse(prompt.slice(prompt.lastIndexOf('\nRows:\n') + 7));
        scheduled.push(...rows);
        return JSON.stringify(rows.map(row => ({ id: row.id, guidePhraseApplicable: 'No',
          guidePhraseApplicabilityRationale: 'Synthetic response for scheduling measurement.' })));
      });
      await expect(runStandardHazardAnalysisStages({
        config: getStandardConfig('STPA'), items: fixture(screened), provider,
        onStageComplete: () => { throw new Error('Diagnostic stops after generation'); },
      })).rejects.toThrow('Diagnostic stops after generation');
      expect(scheduled).toHaveLength(expectedRows);
      expect(fetchLLMResponse).toHaveBeenCalledTimes(expectedCalls);
      if (!screened) expect(JSON.stringify(scheduled)).toContain('Compute checksum in Python');
    }
  },
);
