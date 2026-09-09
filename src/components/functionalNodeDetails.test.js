import { buildFunctionalNodeDetails, getFunctionalNodeDetails } from './functionalNodeDetails';

describe('functional node details', () => {
  test('prefers source-function details over receiver-oriented target details', () => {
    const details = buildFunctionalNodeDetails([
      {
        fromFunction: 'Mission Assignment',
        fromDetails: 'Assigns a mission.',
        toFunction: 'Mission Goal Interpretation',
        toDetails: 'Receives a mission for parsing.',
      },
      {
        fromFunction: 'Mission Goal Interpretation',
        fromDetails: 'Parses and validates the mission goal and constraints.',
        toFunction: 'Route Planning',
        toDetails: 'Computes a route.',
      },
    ]);

    expect(getFunctionalNodeDetails(details, 'Mission Goal Interpretation')).toEqual(expect.objectContaining({
      label: 'Mission Goal Interpretation',
      description: 'Parses and validates the mission goal and constraints.',
    }));
  });

  test('uses target details when a function never appears as a source', () => {
    const details = buildFunctionalNodeDetails([
      {
        fromFunction: 'Actuation Command Transmission',
        fromDetails: 'Transmits validated commands.',
        toFunction: 'Vehicle Platform',
        toDetails: 'Executes steering, propulsion, and braking commands.',
      },
    ]);

    expect(getFunctionalNodeDetails(details, 'vehicle platform')?.description).toBe(
      'Executes steering, propulsion, and braking commands.'
    );
  });

  test('does not overwrite a populated description with a blank occurrence', () => {
    const details = buildFunctionalNodeDetails([
      { fromFunction: 'Pose Estimation', fromDetails: 'Estimates pose.' },
      { fromFunction: 'Pose Estimation', fromDetails: '' },
    ]);

    expect(getFunctionalNodeDetails(details, 'Pose Estimation')?.description).toBe('Estimates pose.');
  });
});
