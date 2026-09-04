import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const conversationalWizardModule = require('./ConversationalWizard');
const ConversationalWizard = conversationalWizardModule.default;
const {
  buildConversationalWizardPayload,
  getConversationalAvatarState,
  getConversationalWizardReadiness,
  isConversationalGenerateIntent,
  mergeConversationalWizardFacts,
  parseRealtimeArchitectureBrief,
  parseConversationalWizardTurn,
  personalizeConversationalWizardTurn,
  shouldAutomaticallyGenerateConversationalDraft,
} = conversationalWizardModule;

describe('ConversationalWizard', () => {
  test('parses an adaptive assistant turn with grounded updates and quick replies', () => {
    const turn = parseConversationalWizardTurn(`\`\`\`json
{
  "message": "I captured the mission and system boundary.",
  "updates": {
    "systemName": "Warehouse Mobile Robot",
    "purpose": "Move inventory inside a staffed warehouse.",
    "components": ""
  },
  "question": {
    "text": "Which operating areas must it support?",
    "type": "multi",
    "options": ["Aisles", "Loading bays", "Elevators"]
  },
  "assumptions": ["People may share the operating area."],
  "readiness": { "ready": false, "score": 45, "missing": ["Operating modes"] }
}
\`\`\``);

    expect(turn).toEqual(expect.objectContaining({
      message: 'I captured the mission and system boundary.',
      updates: {
        systemName: 'Warehouse Mobile Robot',
        purpose: 'Move inventory inside a staffed warehouse.',
      },
      question: {
        text: 'Which operating areas must it support?',
        type: 'multi',
        options: ['Aisles', 'Loading bays', 'Elevators'],
      },
      assumptions: ['People may share the operating area.'],
    }));
  });

  test('preserves established facts when a turn omits or empties fields', () => {
    expect(mergeConversationalWizardFacts(
      { systemName: 'Robotaxi', purpose: 'Transport passengers safely.' },
      { systemName: '', interactions: 'Planner provides trajectories to control.' },
    )).toEqual({
      systemName: 'Robotaxi',
      purpose: 'Transport passengers safely.',
      interactions: 'Planner provides trajectories to control.',
    });
  });

  test('captures a provided name and greets the user once when it is learned', () => {
    const turn = parseConversationalWizardTurn(JSON.stringify({
      message: 'I captured the system mission.',
      updates: { userName: 'Nick Peilan', systemName: 'Warehouse Robot' },
      readiness: { ready: false },
    }));
    const personalized = personalizeConversationalWizardTurn(turn, {});

    expect(personalized.updates.userName).toBe('Nick Peilan');
    expect(personalized.message).toBe('Nice to meet you, Nick. I captured the system mission.');
    expect(personalizeConversationalWizardTurn(turn, { userName: 'Nick Peilan' }).message)
      .toBe('I captured the system mission.');
  });

  test('does not duplicate a greeting already written by the model', () => {
    const turn = {
      message: 'Welcome, Nick. I captured the mission.',
      updates: { userName: 'Nick' },
    };
    expect(personalizeConversationalWizardTurn(turn, {}).message).toBe(turn.message);
  });

  test('uses deterministic minimum readiness instead of blocking on every discovery field', () => {
    const partial = getConversationalWizardReadiness({ systemName: 'Autonomy Stack' });
    const draftable = getConversationalWizardReadiness({
      systemName: 'Autonomy Stack',
      purpose: 'Safely navigate a road vehicle to a commanded destination.',
    });

    expect(partial).toEqual(expect.objectContaining({ coreReady: false, score: 20 }));
    expect(draftable).toEqual(expect.objectContaining({ coreReady: true, score: 40 }));
  });

  test('recognizes explicit conversational generation requests without matching ordinary discussion', () => {
    expect(isConversationalGenerateIntent('Generate the functional decomposition now')).toBe(true);
    expect(isConversationalGenerateIntent("That's good, generate it")).toBe(true);
    expect(isConversationalGenerateIntent('How does command generation work?')).toBe(false);
  });

  test('prioritizes speaking pulses and generating state in the avatar', () => {
    expect(getConversationalAvatarState({ isListening: true })).toBe('listening');
    expect(getConversationalAvatarState({ isThinking: true, isListening: true })).toBe('thinking');
    expect(getConversationalAvatarState({ isSpeaking: true, isThinking: true })).toBe('speaking');
    expect(getConversationalAvatarState({ isGenerating: true, isSpeaking: true })).toBe('generating');
  });

  test('automatically hands off only after the model marks a grounded brief ready', () => {
    expect(shouldAutomaticallyGenerateConversationalDraft(
      { readiness: { ready: true } },
      { systemName: 'Humanoid Robot', purpose: 'Perform general manipulation tasks.' },
    )).toBe(true);
    expect(shouldAutomaticallyGenerateConversationalDraft(
      { readiness: { ready: false } },
      { systemName: 'Humanoid Robot' },
    )).toBe(false);
    expect(shouldAutomaticallyGenerateConversationalDraft(
      { readiness: { ready: true } },
      {},
    )).toBe(false);
  });

  test('submits the current structured schema and selected abstraction level', () => {
    const payload = JSON.parse(buildConversationalWizardPayload({
      abstractionLevel: 'detailed-functional',
      facts: {
        userName: 'Nick',
        systemName: 'Autonomy Stack',
        purpose: 'Navigate safely and execute motion.',
        components: 'State estimation\nPlanning\nControl',
        interactions: 'Planning provides trajectories to control.',
        operationalScenarios: 'Nominal\nDegraded\nMinimal-risk stop',
      },
      assumptions: ['The physical platform is outside the software boundary.'],
    }));

    expect(payload).toEqual(expect.objectContaining({
      mode: 'conversational',
      userName: 'Nick',
      systemName: 'Autonomy Stack',
      abstractionLevel: 'detailed-functional',
      systemOverview: 'Navigate safely and execute motion.',
      functionalComponents: 'State estimation\nPlanning\nControl',
      ops: 'Nominal\nDegraded\nMinimal-risk stop',
      assumptions: ['The physical platform is outside the software boundary.'],
    }));
    expect(payload.evidenceProvenance).toEqual(expect.objectContaining({
      aiGeneratedFields: [],
      source: 'guided-conversation',
    }));
  });

  test('normalizes the grounded brief returned by the Realtime tool', () => {
    expect(parseRealtimeArchitectureBrief(JSON.stringify({
      userName: ' Nick Peilan ',
      systemName: 'Humanoid Robot',
      purpose: 'Assist people with indoor manipulation tasks.',
      components: 'Perception\nPlanning\nControl',
      interactions: '',
      operationalScenarios: 'Nominal operation\nDegraded sensing',
      assumptions: ['The robot operates around people.', ''],
      ready: true,
    }))).toEqual({
      updates: {
        userName: 'Nick Peilan',
        systemName: 'Humanoid Robot',
        purpose: 'Assist people with indoor manipulation tasks.',
        components: 'Perception\nPlanning\nControl',
        operationalScenarios: 'Nominal operation\nDegraded sensing',
      },
      assumptions: ['The robot operates around people.'],
      ready: true,
    });
  });

  test('rejects malformed Realtime tool arguments without losing the session', () => {
    expect(parseRealtimeArchitectureBrief('{not-json')).toEqual({
      updates: {},
      assumptions: [],
      ready: false,
    });
  });

  test('renders a voice-first silhouette with unobtrusive accessible fallbacks', () => {
    const markup = renderToStaticMarkup(<ConversationalWizard onSubmit={() => {}} onSkip={() => {}} />);

    expect(markup).toContain('aria-label="Voice architecture conversation"');
    expect(markup).toContain('aria-label="Start voice conversation"');
    expect(markup).toContain('aria-label="Functional decomposition abstraction level"');
    expect(markup).toContain('aria-label="Mute spoken replies"');
    expect(markup).toContain('aria-label="Show keyboard input"');
    expect(markup).toContain('Start conversation');
    expect(markup).toContain('OpenAI Realtime voice (AI-generated)');
  });
});
