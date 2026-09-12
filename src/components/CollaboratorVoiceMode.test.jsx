jest.mock('lucide-react', () => {
  const Icon = () => null;
  return new Proxy({}, { get: () => Icon });
});

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  buildCollaboratorSpokenResponse,
  getCollaboratorVoiceState,
  stripCollaboratorMarkdownForSpeech,
} = require('./CollaboratorVoiceMode');
const { getNaturalSpeechFailureMessage } = require('./ConversationalWizard');
const CollaboratorVoiceMode = require('./CollaboratorVoiceMode').default;

describe('CollaboratorVoiceMode', () => {
  test('turns a normal Collaborator answer into natural spoken text', () => {
    expect(stripCollaboratorMarkdownForSpeech('## Result\n- [Open row](#row)\n- **Updated** safely.'))
      .toBe('Result Open row Updated safely.');
    expect(buildCollaboratorSpokenResponse({ content: 'The review is complete.' }))
      .toBe('The review is complete.');
  });

  test('does not read a large table aloud', () => {
    const spoken = buildCollaboratorSpokenResponse({
      content: 'I generated the decomposition.\n\n| From | Action | To |\n|---|---|---|\n| A | State | B |',
    });
    expect(spoken).toContain('I generated the decomposition.');
    expect(spoken).toContain('The full result is available in the Collaborator thread.');
  });

  test('prioritizes speaking and working states for the faceless visualization', () => {
    expect(getCollaboratorVoiceState({ isListening: true })).toBe('listening');
    expect(getCollaboratorVoiceState({ isProcessing: true, isListening: true })).toBe('thinking');
    expect(getCollaboratorVoiceState({ isSpeaking: true, isProcessing: true })).toBe('speaking');
  });

  test('presents natural OpenAI voice as an open-ended work partnership', () => {
    const markup = renderToStaticMarkup(
      <CollaboratorVoiceMode active={false} onClose={() => {}} onSubmitTranscript={() => {}} />,
    );
    expect(markup).toContain('Natural OpenAI voice');
    expect(markup).toContain('design and work partner');
    expect(markup).toContain('brainstorm');
    expect(markup).not.toContain('prompt cookbook');
  });

  test('shows the workspace references being used by voice requests', () => {
    const markup = renderToStaticMarkup(
      <CollaboratorVoiceMode
        active={false}
        activeReferences={['Hazard Analysis, row 4, Control Action']}
        onClose={() => {}}
        onSubmitTranscript={() => {}}
      />,
    );
    expect(markup).toContain('Using selection');
    expect(markup).toContain('Hazard Analysis, row 4, Control Action');
  });

  test('surfaces the real OpenAI speech error instead of assuming the key is invalid', () => {
    expect(getNaturalSpeechFailureMessage(new Error('You exceeded your current quota.')))
      .toBe('You exceeded your current quota.');
    expect(getNaturalSpeechFailureMessage({ name: 'NotAllowedError', message: 'Playback blocked.' }))
      .toContain('browser blocked voice playback');
  });
});
