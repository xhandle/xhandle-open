import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { backendURL, buildAIAuthOpts } from './backendConfig';
import { EXAMPLES } from './DemoExamples';

const AI_COMPLETION_STEPS = new Set(['systemOverview', 'functionalComponents', 'interactions', 'ops']);

function extractAIText(payload) {
  const candidates = [
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.result,
    payload?.answer,
    payload?.content,
    payload?.message,
    payload?.text,
    payload?.data?.result,
    payload?.data?.content,
  ];
  return candidates
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean) || '';
}

const COMPLETION_GUIDANCE = {
  systemOverview: {
    title: 'System Overview',
    instruction:
      'Generate a concise but complete system overview that explains the system mission, primary users or operators, operating environment, major capabilities, key external dependencies, and important safety/operational constraints. Use the system name and any existing overview text as anchors, and avoid prematurely listing detailed components unless they are essential to the mission.',
    format:
      'Use 1-2 compact paragraphs. Include the mission/purpose, operating context, major capabilities, external interfaces or dependencies, and safety or performance priorities.',
  },
  functionalComponents: {
    title: 'Functional Components',
    instruction:
      'Generate a comprehensive but bounded list of functional components/modules. Include controllers, sensors, actuators, compute/AI elements, communications, user/operator interfaces, power/support functions, data stores, external actors, and safety/monitoring functions when they are implied by the prior inputs. For each component, describe its role, primary inputs, primary outputs, owned state/data, and safety or operational responsibility when applicable.',
    format:
      'Use grouped bullets with 8-14 total components. Format each item as "- Component Name: detailed responsibility; inputs; outputs; state/constraints."',
  },
  interactions: {
    title: 'Control Interactions',
    instruction:
      'Generate comprehensive control/data interactions that cover nominal command flow, sensing/feedback, operator input, automation decisions, actuator commands, external communications, health monitoring, alerts, fallback behavior, and closed-loop feedback. Use only named or strongly implied components. For each interaction, describe the source component, target component, trigger/context, payload or signal, timing expectation, receiver action, and relevant safety/quality assumption when applicable. Use natural language sentences rather than arrow notation.',
    format:
      'Use one sentence-style bullet per interaction. Format each item as "- Source component sends/provides/requests [specific command, data, signal, or material] to the target component when [trigger/context], so the target can [receiver effect]." Do not use "->" or arrow symbols. Include 10-18 interactions when supported by the context.',
  },
  ops: {
    title: 'Operational Scenarios / Modes of Operation',
    instruction:
      'Generate a comprehensive set of operational scenarios and modes, including startup, initialization, nominal operation, automated/autonomous operation, manual override, degraded/fault operation, communication loss, emergency/abort, maintenance/test, shutdown, and recovery when applicable. These are context only, not nodes or edges.',
    format:
      'Use grouped bullets. For each mode, include a brief phrase describing what changes in control authority, timing, configuration, or safety constraints.',
  },
};

const PromptWizard = ({ onSubmit, onSkip, examples = EXAMPLES }) => {
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState({
    systemName: '',
    systemOverview: '',
    functionalComponents: '',
    interactions: '',
    ops: '', // Operational Scenarios / Modes of Operation (context only)
  });

  const [completionState, setCompletionState] = useState({
    loadingKey: null,
    error: '',
  });

  const steps = [
    {
      key: 'systemName',
      label: 'System Name',
      placeholder: 'e.g., Autonomous Target Tracking Drone',
      question: 'What is the name of your system?',
    },
    {
      key: 'systemOverview',
      label: 'System Overview',
      placeholder: 'e.g., Provides real-time surveillance and autonomous target tracking in contested airspace.',
      question: 'What does your system do? What is its main purpose or mission?',
    },
    {
      key: 'functionalComponents',
      label: 'Functional Components',
      placeholder: 'e.g., EO/IR sensor, flight controller, onboard AI, comms module, ground station',
      question: 'What are the key components or modules?',
    },
    {
      key: 'interactions',
      label: 'Control Interactions',
      placeholder: 'e.g., The onboard AI sends guidance commands to the flight controller after classifying tracked objects, so the controller can adjust heading and speed.',
      question: 'How do components interact or influence each other? Use natural language interface descriptions instead of arrows.',
    },
    {
      key: 'ops',
      label: 'Operational Scenarios / Modes of Operation',
      placeholder: 'e.g., Takeoff, cruise, autonomous tracking, handoff to ground, return-to-base, lost-link',
      question: 'List key operational scenarios or modes. (Used only as context — not as nodes or edges.)',
    },
  ];

  const current = steps[step];

  const handleChange = (e) => {
    setResponses({ ...responses, [current.key]: e.target.value });
  };

  const buildCompletionPrompt = (targetStep) => {
    const guidance = COMPLETION_GUIDANCE[targetStep.key];
    const existingText = String(responses[targetStep.key] || '').trim();

    return `
You are helping complete a structured prompt wizard for functional architecture generation.

Target field: ${guidance.title}
Task: ${guidance.instruction}
Expected format: ${guidance.format}

Prior inputs:
- System Name: ${responses.systemName || '(not provided)'}
- System Overview: ${responses.systemOverview || '(not provided)'}
- Functional Components: ${responses.functionalComponents || '(not provided)'}
- Control Interactions: ${responses.interactions || '(not provided)'}
- Operational Scenarios / Modes: ${responses.ops || '(not provided)'}

Current target field content:
${existingText || '(empty)'}

Return only the completed field text. Do not include labels, markdown headings, explanations, or quotation marks.
Prefer specific nouns and verbs over generic placeholders. Include enough detail to support rich category, function, and interface descriptions in the generated functional decomposition without inventing unrelated subsystems.
`.trim();
  };

  const handleAIComplete = async () => {
    if (!AI_COMPLETION_STEPS.has(current.key) || completionState.loadingKey) return;

    setCompletionState({ loadingKey: current.key, error: '' });

    try {
      const prompt = buildCompletionPrompt(current);
      const response = await fetch(`${backendURL}/api/chat`, {
        method: 'POST',
        ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.35,
          max_tokens: 1100,
          messages: [
            {
              role: 'system',
              content:
                'You are a concise systems engineering assistant. Complete wizard fields with technically plausible, safety-analysis-ready content.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `AI completion failed (${response.status})`);
      }

      const json = await response.json();
      let content = extractAIText(json);

      if (!content) {
        const fallbackResponse = await fetch(`${backendURL}/api/chat`, {
          method: 'POST',
          ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            xhandleModelLocked: true,
            temperature: 0.35,
            max_tokens: 1100,
            messages: [
              {
                role: 'system',
                content:
                  'You are a concise systems engineering assistant. Complete wizard fields with technically plausible, safety-analysis-ready content.',
              },
              { role: 'user', content: prompt },
            ],
          }),
        });

        if (!fallbackResponse.ok) {
          const message = await fallbackResponse.text();
          throw new Error(message || `AI completion failed (${fallbackResponse.status})`);
        }
        content = extractAIText(await fallbackResponse.json());
      }

      if (!content) throw new Error('AI completion returned no content.');

      setResponses((prev) => ({ ...prev, [current.key]: content }));
      setCompletionState({ loadingKey: null, error: '' });
    } catch (error) {
      console.error('Prompt wizard AI completion failed:', error);
      setCompletionState({
        loadingKey: null,
        error: error?.message || 'AI completion failed. Check your AI provider settings and try again.',
      });
    }
  };

  const handleNext = () => {
    if (step < steps.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleFinalSubmit = () => {
    const combinedPrompt = JSON.stringify(
      {
        mode: "structured",
        systemName: responses.systemName,
        systemOverview: responses.systemOverview,
        functionalComponents: responses.functionalComponents,
        interactions: responses.interactions,
        ops: responses.ops,
      },
      null,
      2
    );

    onSubmit(combinedPrompt);
  };

  return (
    <div className="max-w-2xl mx-auto mb-10 p-4 bg-white rounded-xl border shadow">
      {/* Main wizard step */}
      <h2 className="text-xl font-semibold mb-1">{current.label}</h2>
      <p className="text-gray-600 text-sm mb-2">{current.question}</p>
      <textarea
        rows={4}
        className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring resize-none whitespace-pre-wrap"
        placeholder={current.placeholder}
        value={responses[current.key]}
        onChange={handleChange}
      />
      {AI_COMPLETION_STEPS.has(current.key) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleAIComplete}
            disabled={completionState.loadingKey === current.key}
            className="inline-flex items-center gap-2 rounded border border-[#2D7DFE] bg-white px-3 py-2 text-sm font-medium text-[#1c5fde] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            title="Complete this field using the prior wizard inputs"
          >
            <Sparkles size={16} aria-hidden="true" />
            {completionState.loadingKey === current.key ? 'Completing...' : 'AI Complete'}
          </button>
          {completionState.error && (
            <p className="text-xs text-red-600">{completionState.error}</p>
          )}
        </div>
      )}

      <div className="flex justify-between mt-4">
        <button
          onClick={handleBack}
          disabled={step === 0}
          className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-800 disabled:opacity-50 hover:bg-gray-300"
        >
          Back
        </button>

        <div className="flex gap-2">
          <button
            onClick={onSkip}
            className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            Skip Wizard
          </button>

          {step < steps.length - 1 ? (
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm rounded text-white bg-[#2D7DFE] hover:bg-[#1c5fde]"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleFinalSubmit}
              className="px-4 py-2 text-sm rounded text-white bg-[#7A37FF] hover:bg-[#5c2bd4]"
            >
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PromptWizard;
