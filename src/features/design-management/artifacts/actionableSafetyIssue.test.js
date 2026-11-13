import { buildActionableHazardFamilies } from './actionableHazardFamilies';
import { consolidateHazardRows, hazardGroupValues } from './consolidateHazardRows';
import { artifactSearchEntries } from '../designQuickSearch';
import { hazardColumnOptions, filterHazardGroups } from './hazardTableControls';
import { actionableSafetyIssue } from './actionableSafetyIssue';
import { buildDeterministicConsolidatedSafetyIssues } from '../../project-hazard-analysis/safetyIssueConsolidation';
import { projectHazardTrackingFields } from './hazardTrackingFields';

const row = (id, attributes) => ({ id, hazardTrackingRow: true, attributes });
test('one source-based issue describes the associated hazards without replacing hazard wording or source fields', () => {
  const rows = buildActionableHazardFamilies([
    row('lost', { Hazard: 'Missing brake command', Function: 'Brake control', 'Guide Phrase': 'Not provided', Loss: 'Collision' }),
    row('late', { Hazard: 'Braking response delayed', Function: 'Brake control', 'Guide Phrase': 'Too late', Loss: 'Collision' }),
  ]);
  const [group] = consolidateHazardRows(rows);
  expect(hazardGroupValues(group, 'Actionable Safety Issue Title')).toEqual([group.issueTitle]);
  expect(hazardGroupValues(group, 'Actionable Safety Issue Description')).toEqual([group.issueBody]);
  expect(group.issueDescription).toContain('Safety issue summary pending');
  expect(hazardGroupValues(group, 'Loss')).toEqual(['Collision']);
  expect(hazardGroupValues(group, 'Hazard')).toEqual(['Missing brake command', 'Braking response delayed']);
  expect(rows[0].attributes.Hazard).toBe('Missing brake command');
  for (const [column, value] of [['Actionable Safety Issue Title', group.issueTitle], ['Actionable Safety Issue Description', group.issueBody]]) {
    expect(hazardColumnOptions([group], column)).toEqual([value]);
    expect(filterHazardGroups([group], { [column]: { mode: 'include', values: [value] } })).toEqual([group]);
    expect(filterHazardGroups([group], { [column]: { mode: 'exclude', values: [value] } })).toEqual([]);
  }
  const entries = artifactSearchEntries({ id: 'table', title: 'HTL', templateId: 'hazard-tracking-list' }, rows, false, () => {});
  expect(entries.filter(entry => entry.kind === 'Actionable Safety Issue').map(entry => entry.text)).toEqual([group.issueDescription]);
});


test('HTL matches the concise Projects title and description for the remote-support example', () => {
  const hazards = ['The controlled system has unsafe or uncontrolled motion while people, property, or the environment are exposed.', 'The controlled system applies an unintended or incorrect physical action.', 'The system or an exposed entity occupies an unsafe location or lacks required separation or clearance.'];
  const phrases = ['Not provided', 'Provided incorrectly', 'Provided too late', 'Stopped too soon'];
  const sourceRows = phrases.map((phrase, index) => ({ sourceIndex: index + 1, cells: {
    'Function (From)': 'Fleet / Mission Management', 'Control Action': 'Remote Support Task', 'Function (To)': 'Qibus',
    'Operational Scenario': 'Curbside stop', 'Operational Mode': 'Remote support', 'Guide Phrase': phrase, Hazard: hazards[index % hazards.length],
  } }));
  const projectIssue = buildDeterministicConsolidatedSafetyIssues(sourceRows)[0];
  const objects = buildActionableHazardFamilies(sourceRows.map(source => row(`remote-${source.sourceIndex}`, projectHazardTrackingFields(source.cells))));
  const [group] = consolidateHazardRows(objects);
  const issue = actionableSafetyIssue(group);
  expect(issue.title).toBe('Unsafe Remote Support Task involving Fleet / Mission Management');
  expect(issue.description).toBe('Fleet / Mission Management → Remote Support Task → Qibus presents a consolidated safety concern across one operational context and 4 unsafe-action variations. Documented hazardous outcomes include ' + hazards.join('; ') + '.');
  expect(issue).toEqual({ title: projectIssue.title, description: projectIssue.description });
  expect(issue.title.length).toBeLessThanOrEqual(110); expect(issue.description.length).toBeLessThanOrEqual(700);
  expect(group.issueDescription).toBe(`${issue.title}\n${issue.description}`);
  expect(group.rows).toHaveLength(4); expect(hazardGroupValues(group, 'Hazard')).toEqual(hazards);
});

test('an HTR combining multiple interfaces describes the entire concern rather than only the first interface', () => {
  const rows = [row('planner', { Function: 'Planner → Trajectory → Controller', Hazard: 'Late trajectory', 'Operational Scenario': 'Urban', 'Guide Phrase': 'Too late' }), row('localization', { Function: 'Localization → Position → Planner', Hazard: 'Incorrect position', 'Operational Scenario': 'Highway', 'Guide Phrase': 'Incorrect' })];
  const issue = actionableSafetyIssue({ rows });
  expect(issue.title).toBe('Safety issue summary pending');
  expect(issue.title).not.toContain('2 functional interfaces');
  expect(issue.description).toContain('resume consolidation');
});

test('missing operational contexts are not inferred from assessment row counts', () => {
  const issue = actionableSafetyIssue({ rows: [row('a', { Function: 'Brake', Hazard: 'Late command' }), row('b', { Function: 'Brake', Hazard: 'Lost command' })] });
  expect(issue.description).not.toContain('2 operational contexts');
});
