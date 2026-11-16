import { artifactWorkflow, applyHelp, assertDesignAnswerControls, isMissingApplyQuestion } from './designWorkflow';

test('workflow distinguishes ready drafts, incomplete drafts and project-managed acceptance', () => {
  const data = { target: { draft: true }, meta: {}, job: { state: 'ready' } };
  expect(artifactWorkflow(data)).toMatchObject({ proposalReady: true, controls: ['Review proposal', 'Accept proposal'] });
  expect(artifactWorkflow({ ...data, job: { state: 'paused' } }).controls).toContain('Generate / resume draft');
  expect(artifactWorkflow({ ...data, meta: { programId: 'project' } }).controls).toEqual(['Artifact actions', 'Review project and traceability']);
  expect(artifactWorkflow({ ...data, job: null }).proposalReady).toBe(false);
});

test.each(["I don't see an apply button", 'Where is the Apply button?', 'there is no Apply button', 'I cannot find the Apply changes button'])('recognizes the missing-control question: %s', text => {
  expect(isMissingApplyQuestion(text)).toBe(true);
});

test.each(['Apply the status changes.', 'Should I apply this requirement?', 'What happens to a button when pressure is applied?'])('does not treat other requests as missing controls: %s', text => {
  expect(isMissingApplyQuestion(text)).toBe(false);
});

test.each([
  "To finalize approval, use the application's **Apply** button on the review panel. This will update the review flags and lock the items against further editing.",
  'Click the Apply changes button below to save these edits.',
  'Accept proposal will move requirements from Proposed to Approved.',
  'This will lock the items against further editing until a new draft cycle.',
  'I have updated these requirements.',
])('rejects fictional controls or workflow claims: %s', text => {
  expect(() => assertDesignAnswerControls(text, { mutationRequested: true })).toThrow('text-only answer');
});

test('permits grounded explanations and actual pending edit-card instructions', () => {
  expect(() => assertDesignAnswerControls(applyHelp({ proposalReady: true }))).not.toThrow();
  expect(() => assertDesignAnswerControls('Click the Apply changes button in the pending review card.', { hasPendingProposal: true })).not.toThrow();
  expect(applyHelp({ proposalReady: true })).toContain('Review proposal');
  expect(applyHelp({ proposalState: 'paused' })).toContain('Generate / resume draft');
  expect(applyHelp({ projectManaged: true })).toContain('accepted together');
});
