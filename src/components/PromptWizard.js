import React, { useState } from 'react';
import { MessageSquarePlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { backendURL, buildAIAuthOpts } from './backendConfig';
import { EXAMPLES } from './DemoExamples';

const AI_COMPLETION_STEPS = new Set(['systemOverview', 'functionalComponents', 'interactions', 'ops']);
const TABLE_STEP_KEYS = new Set(['functionalComponents', 'interactions', 'ops']);

function createArtifactRow(key, values = {}) {
  const defaults = {
    functionalComponents: { subsystem: '', name: '', description: '' },
    interactions: { fromFunction: '', toFunction: '', controlAction: '', controlDetails: '' },
    ops: { mode: '', description: '' },
  };
  return {
    id: `wizard-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(defaults[key] || {}),
    ...values,
  };
}

function stripListMarker(line) {
  return String(line || '').replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim();
}

function splitNameAndDescription(line) {
  const clean = stripListMarker(line);
  const colonIndex = clean.indexOf(':');
  if (colonIndex > 0) {
    return {
      name: clean.slice(0, colonIndex).trim(),
      description: clean.slice(colonIndex + 1).trim(),
    };
  }
  const dashMatch = clean.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) {
    return { name: dashMatch[1].trim(), description: dashMatch[2].trim() };
  }
  return { name: clean, description: '' };
}

function parseInteractionLine(line) {
  const clean = stripListMarker(line);
  const fieldPairs = {};
  clean.split('|').forEach((part) => {
    const colonIndex = part.indexOf(':');
    if (colonIndex <= 0) return;
    const key = part.slice(0, colonIndex).trim().toLowerCase();
    const value = part.slice(colonIndex + 1).trim();
    fieldPairs[key] = value;
  });
  if (
    fieldPairs.from ||
    fieldPairs['from function'] ||
    fieldPairs.to ||
    fieldPairs['to function'] ||
    fieldPairs['control action'] ||
    fieldPairs.description ||
    fieldPairs['control action description']
  ) {
    return {
      fromFunction: fieldPairs.from || fieldPairs['from function'] || fieldPairs.source || '',
      toFunction: fieldPairs.to || fieldPairs['to function'] || fieldPairs.target || '',
      controlAction: fieldPairs['control action'] || fieldPairs.action || '',
      controlDetails: fieldPairs.description || fieldPairs['control action description'] || fieldPairs.details || '',
    };
  }

  const arrowMatch = clean.match(/^(.+?)\s*(?:->|→)\s*(.+?)(?::|-)\s*(.+)$/);
  if (arrowMatch) {
    const actionParts = splitNameAndDescription(arrowMatch[3]);
    return {
      fromFunction: arrowMatch[1].trim(),
      toFunction: arrowMatch[2].trim(),
      controlAction: actionParts.name || arrowMatch[3].trim(),
      controlDetails: actionParts.description || arrowMatch[3].trim(),
    };
  }

  const sentenceMatch = clean.match(/^(.+?)\s+(send|sends|provide|provides|request|requests|command|commands|report|reports|return|returns|transmit|transmits|pass|passes|publish|publishes|receive|receives|notify|notifies|alert|alerts|update|updates|stream|streams|forward|forwards|deliver|delivers)\s+(.+?)\s+to\s+(.+?)(?:\s+when\s+|\s+so\s+|\s+for\s+|\s+after\s+|\s+during\s+|$)(.*)$/i);
  if (sentenceMatch) {
    return {
      fromFunction: sentenceMatch[1].trim(),
      toFunction: sentenceMatch[4].trim().replace(/[,.]$/, ''),
      controlAction: `${sentenceMatch[2]} ${sentenceMatch[3]}`.trim(),
      controlDetails: sentenceMatch[5]?.trim() || clean,
    };
  }

  return {
    fromFunction: '',
    toFunction: '',
    controlAction: '',
    controlDetails: clean,
  };
}

function isCompleteArtifactRow(row, key) {
  if (key === 'functionalComponents') {
    return Boolean(String(row.subsystem || '').trim() && String(row.name || '').trim() && String(row.description || '').trim());
  }
  if (key === 'interactions') {
    return Boolean(
      String(row.fromFunction || '').trim() &&
      String(row.toFunction || '').trim() &&
      String(row.controlAction || '').trim() &&
      String(row.controlDetails || '').trim()
    );
  }
  if (key === 'ops') {
    return Boolean(String(row.mode || '').trim() && String(row.description || '').trim());
  }
  return true;
}

function parseComponentLine(line) {
  const clean = stripListMarker(line);
  const fieldPairs = {};
  clean.split('|').forEach((part) => {
    const colonIndex = part.indexOf(':');
    if (colonIndex <= 0) return;
    const key = part.slice(0, colonIndex).trim().toLowerCase();
    const value = part.slice(colonIndex + 1).trim();
    fieldPairs[key] = value;
  });
  if (fieldPairs.subsystem || fieldPairs.function || fieldPairs.component || fieldPairs.description) {
    return {
      subsystem: fieldPairs.subsystem || '',
      name: fieldPairs.function || fieldPairs.component || fieldPairs.name || '',
      description: fieldPairs.description || fieldPairs.role || '',
    };
  }

  const parsed = splitNameAndDescription(clean);
  return { subsystem: '', name: parsed.name, description: parsed.description };
}

function parseArtifactRowsFromText(text, key) {
  const rawText = String(text || '').trim();
  if (!TABLE_STEP_KEYS.has(key) || !rawText) return [];

  const lines = rawText
    .split(/\n+/)
    .map((line) => stripListMarker(line))
    .filter(Boolean)
    .filter((line) => !/^clarifying question:/i.test(line));

  if (key === 'interactions') {
    return lines
      .map((line) => createArtifactRow(key, parseInteractionLine(line)))
      .filter((row) => isCompleteArtifactRow(row, key));
  }

  if (key === 'functionalComponents') {
    return lines
      .map((line) => createArtifactRow(key, parseComponentLine(line)))
      .filter((row) => isCompleteArtifactRow(row, key));
  }

  return lines.map((line) => {
    const parsed = splitNameAndDescription(line);
    return createArtifactRow(key, key === 'ops'
      ? { mode: parsed.name, description: parsed.description }
      : parsed);
  }).filter((row) => isCompleteArtifactRow(row, key));
}

function serializeArtifactRows(rows, key) {
  if (key === 'functionalComponents') {
    return (rows || [])
      .map((row) => ({
        subsystem: String(row.subsystem || '').trim(),
        name: String(row.name || '').trim(),
        description: String(row.description || '').trim(),
      }))
      .filter((row) => row.subsystem || row.name || row.description)
      .map((row) => `- Subsystem: ${row.subsystem || 'Unspecified subsystem'} | Function: ${row.name || 'Unnamed component'} | Description: ${row.description}`)
      .join('\n');
  }

  if (key === 'interactions') {
    return (rows || [])
      .map((row) => ({
        fromFunction: String(row.fromFunction || '').trim(),
        toFunction: String(row.toFunction || '').trim(),
        controlAction: String(row.controlAction || '').trim(),
        controlDetails: String(row.controlDetails || '').trim(),
      }))
      .filter((row) => row.fromFunction || row.toFunction || row.controlAction || row.controlDetails)
      .map((row) => {
        const from = row.fromFunction || 'Unspecified source';
        const to = row.toFunction || 'Unspecified target';
        const action = row.controlAction || 'control/data interaction';
        return `- ${from} sends ${action} to ${to}${row.controlDetails ? `: ${row.controlDetails}` : ''}`;
      })
      .join('\n');
  }

  if (key === 'ops') {
    return (rows || [])
      .map((row) => ({
        mode: String(row.mode || '').trim(),
        description: String(row.description || '').trim(),
      }))
      .filter((row) => row.mode || row.description)
      .map((row) => `- ${row.mode || 'Operational mode'}: ${row.description}`)
      .join('\n');
  }

  return '';
}

function emptyWizardTables() {
  return {
    functionalComponents: [],
    interactions: [],
    ops: [],
  };
}

const TABLE_STEP_SCHEMAS = {
  functionalComponents: {
    title: 'Functional decomposition preview',
    emptyText: 'No functions or components yet. Add a row or use AI Complete.',
    columns: [
      { key: 'subsystem', label: 'Subsystem', width: 'w-56', placeholder: 'e.g., Guidance and Control' },
      { key: 'name', label: 'Function / Component', width: 'w-64', placeholder: 'e.g., Flight Controller' },
      { key: 'description', label: 'Description', placeholder: 'Purpose, responsibilities, inputs, outputs, constraints' },
    ],
  },
  interactions: {
    title: 'Interface preview',
    emptyText: 'No interfaces yet. Add a row or use AI Complete.',
    columns: [
      { key: 'fromFunction', label: 'From Function', width: 'w-52', placeholder: 'Source function' },
      { key: 'toFunction', label: 'To Function', width: 'w-52', placeholder: 'Target function' },
      { key: 'controlAction', label: 'Control Action', width: 'w-56', placeholder: 'Command, signal, request, data flow' },
      { key: 'controlDetails', label: 'Control Action Description', placeholder: 'Trigger, payload, timing, receiver behavior, assumptions' },
    ],
  },
  ops: {
    title: 'Operational context preview',
    emptyText: 'No operational modes yet. Add a row or use AI Complete.',
    columns: [
      { key: 'mode', label: 'Scenario / Mode', width: 'w-64', placeholder: 'e.g., Lost-link recovery' },
      { key: 'description', label: 'Description', placeholder: 'Control authority, configuration, timing, safety constraints' },
    ],
  },
};

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
      'Generate a comprehensive but bounded list of functional components/modules and assign each one to the most appropriate subsystem grouping. Include controllers, sensors, actuators, compute/AI elements, communications, user/operator interfaces, power/support functions, data stores, external actors, and safety/monitoring functions when they are implied by the prior inputs. For each component, describe its role, primary inputs, primary outputs, owned state/data, and safety or operational responsibility when applicable.',
    format:
      'Use 8-14 bullet rows. Format each item exactly as "- Subsystem: subsystem name | Function: component/function name | Description: detailed responsibility; inputs; outputs; state/constraints."',
  },
  interactions: {
    title: 'Control Interactions',
    instruction:
      'Generate comprehensive control/data interactions that cover nominal command flow, sensing/feedback, operator input, automation decisions, actuator commands, external communications, health monitoring, alerts, fallback behavior, and closed-loop feedback. Use only named or strongly implied components. For each interaction, describe the source component, target component, trigger/context, payload or signal, timing expectation, receiver action, and relevant safety/quality assumption when applicable. Use natural language sentences rather than arrow notation.',
    format:
      'Use 10-18 bullet rows when supported. Format each item exactly as "- From: source function | To: target function | Control Action: command/signal/request/data flow | Description: trigger, payload, timing, receiver behavior, assumptions." Do not leave any field blank.',
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
  const [reviewTables, setReviewTables] = useState(() => emptyWizardTables());

  const [completionState, setCompletionState] = useState({
    loadingKey: null,
    error: '',
  });
  const [followUpQuestions, setFollowUpQuestions] = useState({});

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
  const currentSchema = TABLE_STEP_SCHEMAS[current.key] || null;
  const currentRows = currentSchema
    ? (reviewTables[current.key]?.length
      ? reviewTables[current.key]
      : parseArtifactRowsFromText(responses[current.key], current.key))
    : [];

  const handleChange = (e) => {
    const nextValue = e.target.value;
    setResponses({ ...responses, [current.key]: nextValue });
    if (TABLE_STEP_KEYS.has(current.key)) {
      setReviewTables((prev) => ({
        ...prev,
        [current.key]: parseArtifactRowsFromText(nextValue, current.key),
      }));
    }
  };

  const syncRowsForCurrentStep = (nextRows) => {
    if (!currentSchema) return;
    const nextText = serializeArtifactRows(nextRows, current.key);
    setReviewTables((prev) => ({ ...prev, [current.key]: nextRows }));
    setResponses((prev) => ({ ...prev, [current.key]: nextText }));
  };

  const handleReviewCellChange = (rowId, field, value) => {
    const nextRows = currentRows.map((row) => (
      row.id === rowId ? { ...row, [field]: value } : row
    ));
    syncRowsForCurrentStep(nextRows);
  };

  const handleAddReviewRow = () => {
    syncRowsForCurrentStep([...currentRows, createArtifactRow(current.key)]);
  };

  const handleRemoveReviewRow = (rowId) => {
    const nextRows = currentRows.filter((row) => row.id !== rowId);
    syncRowsForCurrentStep(nextRows);
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

  const callWizardAI = async ({ prompt, system, maxTokens = 1100 }) => {
    const requestBody = {
      model: 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    };
    const response = await fetch(`${backendURL}/api/chat`, {
      method: 'POST',
      ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `AI request failed (${response.status})`);
    }

    let content = extractAIText(await response.json());

    if (!content) {
      const fallbackResponse = await fetch(`${backendURL}/api/chat`, {
        method: 'POST',
        ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...requestBody,
          xhandleModelLocked: true,
        }),
      });

      if (!fallbackResponse.ok) {
        const message = await fallbackResponse.text();
        throw new Error(message || `AI request failed (${fallbackResponse.status})`);
      }
      content = extractAIText(await fallbackResponse.json());
    }

    return content;
  };

  const handleAIComplete = async () => {
    if (!AI_COMPLETION_STEPS.has(current.key) || completionState.loadingKey) return;

    setCompletionState({ loadingKey: current.key, error: '' });

    try {
      const prompt = buildCompletionPrompt(current);
      const content = await callWizardAI({
        prompt,
        system: 'You are a concise systems engineering assistant. Complete wizard fields with technically plausible, safety-analysis-ready content.',
      });

      if (!content) throw new Error('AI completion returned no content.');

      setResponses((prev) => ({ ...prev, [current.key]: content }));
      if (TABLE_STEP_KEYS.has(current.key)) {
        setReviewTables((prev) => ({
          ...prev,
          [current.key]: parseArtifactRowsFromText(content, current.key),
        }));
      }
      setCompletionState({ loadingKey: null, error: '' });
    } catch (error) {
      console.error('Prompt wizard AI completion failed:', error);
      setCompletionState({
        loadingKey: null,
        error: error?.message || 'AI completion failed. Check your AI provider settings and try again.',
      });
    }
  };

  const buildFollowUpPrompt = () => `
You are helping prepare inputs for functional architecture generation.

Review the current wizard content and identify concise follow-up questions only where uncertainty would materially affect the architecture, interfaces, operational modes, or later safety analysis.

Current step: ${current.label}
System Name: ${responses.systemName || '(not provided)'}
System Overview: ${responses.systemOverview || '(not provided)'}
Functional Components: ${responses.functionalComponents || '(not provided)'}
Control Interactions: ${responses.interactions || '(not provided)'}
Operational Scenarios / Modes: ${responses.ops || '(not provided)'}

Return 0-5 questions as plain bullet lines. Do not include headings or explanations. If no clarification is needed, return "No follow-up questions needed."
`.trim();

  const handleAIFollowUpQuestions = async () => {
    if (!AI_COMPLETION_STEPS.has(current.key) || completionState.loadingKey) return;

    setCompletionState({ loadingKey: `${current.key}:questions`, error: '' });

    try {
      const content = await callWizardAI({
        prompt: buildFollowUpPrompt(),
        maxTokens: 500,
        system:
          'You are a systems engineering reviewer. Ask only high-value clarification questions that improve functional architecture generation.',
      });

      if (!content || /no follow-up questions needed/i.test(content)) {
        setCompletionState({ loadingKey: null, error: 'No follow-up questions needed for this step.' });
        return;
      }

      const questions = content
        .split(/\n+/)
        .map((line) => stripListMarker(line))
        .filter(Boolean)
        .slice(0, 5);

      if (!questions.length) throw new Error('AI returned no follow-up questions.');

      setFollowUpQuestions((prev) => ({
        ...prev,
        [current.key]: questions,
      }));
      setCompletionState({ loadingKey: null, error: '' });
    } catch (error) {
      console.error('Prompt wizard follow-up question generation failed:', error);
      setCompletionState({
        loadingKey: null,
        error: error?.message || 'AI follow-up generation failed. Check your AI provider settings and try again.',
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
    <div className="max-w-5xl mx-auto mb-10 p-4 bg-white rounded-xl border shadow">
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
          <button
            type="button"
            onClick={handleAIFollowUpQuestions}
            disabled={completionState.loadingKey === `${current.key}:questions`}
            className="inline-flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            title="Ask AI to identify clarification questions for this step"
          >
            <MessageSquarePlus size={16} aria-hidden="true" />
            {completionState.loadingKey === `${current.key}:questions` ? 'Reviewing...' : 'AI Questions'}
          </button>
          {completionState.error && (
            <p className={`text-xs ${/No follow-up/i.test(completionState.error) ? 'text-gray-500' : 'text-red-600'}`}>{completionState.error}</p>
          )}
        </div>
      )}

      {followUpQuestions[current.key]?.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
          <h3 className="text-sm font-semibold text-amber-900">Follow-up questions</h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {followUpQuestions[current.key].map((question, index) => (
              <li key={`${current.key}-question-${index}`}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      {currentSchema && (
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{currentSchema.title}</h3>
            <p className="text-xs text-gray-500">Edit cells before moving on; these values feed project generation.</p>
          </div>
          <button
            type="button"
            onClick={() => handleAddReviewRow()}
            className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus size={14} aria-hidden="true" />
            Add row
          </button>
        </div>
        <div className="max-h-72 overflow-auto">
            <table className="min-w-full table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-semibold uppercase text-gray-500 shadow-sm">
                <tr>
                  {currentSchema.columns.map((column) => (
                    <th key={column.key} className={`${column.width || ''} border-b border-gray-200 px-3 py-2 text-left`}>
                      {column.label}
                    </th>
                  ))}
                  <th className="w-16 border-b border-gray-200 px-3 py-2 text-center">Remove</th>
                </tr>
              </thead>
              <tbody>
                {currentRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={currentSchema.columns.length + 1}>
                      {currentSchema.emptyText}
                    </td>
                  </tr>
                ) : currentRows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 align-top last:border-b-0">
                    {currentSchema.columns.map((column) => (
                      <td key={column.key} className="px-3 py-2">
                        <textarea
                          value={row[column.key] || ''}
                          onChange={(event) => handleReviewCellChange(row.id, column.key, event.target.value)}
                          rows={2}
                          className="min-h-[44px] w-full resize-y rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          placeholder={column.placeholder}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveReviewRow(row.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600"
                        title="Remove row"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
