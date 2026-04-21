/**
 * xHandle: prompt wizard functional-architecture workflow.
 * This file supports xHandle's functional-architecture flow, where users describe a system, generate functional decomposition rows, and turn those rows into diagram-ready structure.
 * Functional decomposition is the upstream model that later feeds hazard analysis, reporting, traceability, and other AI-assisted engineering workflows throughout the application.
 * Related files: src/App.js, src/components/diagrams/LiteSummaryDiagramReactFlow.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

import React, { useState } from 'react';
import { EXAMPLES } from './DemoExamples'; // ← adjust path if needed

const PromptWizard = ({ onSubmit, onSkip, examples = EXAMPLES }) => {
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState({
    systemName: '',
    systemOverview: '',
    functionalComponents: '',
    interactions: '',
    ops: '', // Operational Scenarios / Modes of Operation (context only)
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
      placeholder: 'e.g., AI processes sensor data → sends flight commands → controller adjusts heading',
      question: 'How do components interact or influence each other?',
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

  const handleNext = () => {
    if (step < steps.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleFinalSubmit = () => {
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const combinedPrompt = `
You are turning a system description into a clean list of control interactions.

Inputs:
System Name: ${responses.systemName}
System Overview: ${responses.systemOverview}
Functional Components: ${responses.functionalComponents}
Control Interactions: ${responses.interactions}
Operational Scenarios / Modes of Operation (Context Only): ${responses.ops}

Requirements:
- Use ONLY components that appear in "Functional Components" (exact names). Do not invent new nodes.
- Operational scenarios / modes are context ONLY to clarify when/why interactions occur.
  • DO NOT create nodes or edges named after scenarios/modes.
  • DO NOT include scenario/mode names in the From/To columns.
- If text says a component interfaces with "all components" (or synonyms: "all modules", "all subsystems", "everything", "rest of system", "others", "all of the above"):
  • DO NOT create a node named "All Components".
  • Instead, create one interaction per actual component in the list, excluding the source component itself.

Output format (markdown table):
| Function (From) | Control Action | Function (To) |
|---|---|---|
| ... | ... | ... |
`.trim();

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
