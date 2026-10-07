import { processFunctionalModel as process } from '../functionalModel';
// Existing abstraction/UI tests exercise their provider fixtures unchanged;
// hierarchy behavior and provider failures have dedicated integration tests.
export const hierarchyResponse = prompt => {
  const { functions } = JSON.parse(prompt.split('Functional hierarchy input: ')[1]);
  return { allocations: functions.map(unit => ({ id: unit.id, subsystem: unit.existing?.subsystem || 'Product',
    csci: unit.existing?.csci || 'Application', csc: unit.existing?.csc || 'Processing', rationale: 'Fixture ownership.' })) };
};
export const processFunctionalModel = (rows, options) => process(rows, { ...options,
  request: (prompt, ...args) => prompt.includes('Functional hierarchy input: ') ? hierarchyResponse(prompt) : options.request(prompt, ...args) });
