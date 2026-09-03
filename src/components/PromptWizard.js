import React, { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { backendURL, buildAIAuthOpts } from './backendConfig';
import { EXAMPLES } from './DemoExamples';
import {
  DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
  FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS,
  getFunctionalAbstractionLevelOption,
  getFunctionalAbstractionPromptGuidance,
} from './functionalDecompositionAbstraction';
import { FUNCTIONAL_DECOMPOSITION_SAMPLING } from './functionalDecompositionGeneration';

const AI_COMPLETION_STEPS = new Set(['systemOverview', 'functionalComponents', 'interactions', 'ops']);
const TABLE_STEP_KEYS = new Set(['functionalComponents', 'interactions', 'ops']);
const COMPLETION_TOKEN_BUDGETS = {
  systemOverview: 1800,
  functionalComponents: 5000,
  interactions: 7000,
  ops: 3000,
};

function createClarificationQuestion(raw = {}, index = 0) {
  const options = Array.isArray(raw.options)
    ? raw.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const type = raw.type === 'single' || raw.type === 'multi' || raw.type === 'text'
    ? raw.type
    : options.length ? 'multi' : 'text';
  return {
    id: `clarification-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    question: String(raw.question || raw.prompt || '').trim(),
    type,
    options,
    selectedOptions: [],
    text: '',
  };
}

function parseJsonArrayFromText(text) {
  const raw = String(text || '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try {
      const parsedFence = JSON.parse(fenced);
      if (Array.isArray(parsedFence)) return parsedFence;
    } catch {}
  }
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsedSlice = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsedSlice)) return parsedSlice;
    } catch {}
  }
  return null;
}

function serializeClarificationAnswers(questions = []) {
  return (questions || [])
    .map((item) => {
      const selected = (item.selectedOptions || []).filter(Boolean);
      const text = String(item.text || '').trim();
      if (!item.question || (!selected.length && !text)) return null;
      return {
        question: item.question,
        answer: [...selected, text].filter(Boolean).join('; '),
      };
    })
    .filter(Boolean);
}

function formatClarificationAnswersForPrompt(questions = []) {
  const answered = serializeClarificationAnswers(questions);
  if (!answered.length) return '';
  return answered.map((item) => `- ${item.question}\n  Answer: ${item.answer}`).join('\n');
}

const CLARIFICATION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'be', 'by', 'do', 'does', 'for', 'from', 'how', 'if', 'in',
  'is', 'it', 'of', 'or', 'should', 'the', 'there', 'this', 'to', 'what', 'when', 'where',
  'which', 'who', 'with', 'would', 'you', 'your',
]);

function normalizeClarificationQuestion(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !CLARIFICATION_STOP_WORDS.has(token))
    .join(' ');
}

function clarificationSimilarity(a, b) {
  const aTokens = new Set(normalizeClarificationQuestion(a).split(/\s+/).filter(Boolean));
  const bTokens = new Set(normalizeClarificationQuestion(b).split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  return intersection / Math.min(aTokens.size, bTokens.size);
}

function isSimilarClarificationQuestion(question, priorQuestions = []) {
  const normalized = normalizeClarificationQuestion(question);
  if (!normalized) return true;
  return priorQuestions.some((prior) => {
    const priorNormalized = normalizeClarificationQuestion(prior);
    return priorNormalized === normalized || clarificationSimilarity(normalized, priorNormalized) >= 0.7;
  });
}

function flattenClarificationQuestions(clarificationsByStep = {}, exceptStep = '') {
  return Object.entries(clarificationsByStep)
    .filter(([stepKey]) => stepKey !== exceptStep)
    .flatMap(([, questions]) => (questions || []).map((item) => item.question))
    .filter(Boolean);
}

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

function parseOpsLine(line) {
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
    fieldPairs.mode ||
    fieldPairs.scenario ||
    fieldPairs['scenario / mode'] ||
    fieldPairs.description ||
    fieldPairs.context
  ) {
    return {
      mode: fieldPairs.mode || fieldPairs.scenario || fieldPairs['scenario / mode'] || '',
      description: fieldPairs.description || fieldPairs.context || fieldPairs.details || '',
    };
  }

  const scenarioMatch = clean.match(/^(?:mode|scenario)\s*:\s*(.+?)(?:\s*\|\s*(?:description|context|details)\s*:\s*(.+)|$)/i);
  if (scenarioMatch) {
    return {
      mode: scenarioMatch[1].trim(),
      description: scenarioMatch[2]?.trim() || '',
    };
  }

  return splitNameAndDescription(clean);
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

  return lines
    .map((line) => createArtifactRow(key, key === 'ops' ? parseOpsLine(line) : splitNameAndDescription(line)))
    .filter((row) => isCompleteArtifactRow(row, key));
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
      'Generate a comprehensive but bounded domain-specific function inventory and assign every function to the subsystem that owns the behavior. Treat previously AI-completed wizard content as unverified architecture hypotheses. Infer the capabilities essential to the named system’s mission, environment, embodiment, control problem, and operating modes; do not fall back to a generic sensing-processing-decision-control chain when more precise architecture is warranted. When only a broad system class or name is supplied, create a conservative platform reference architecture centered on intrinsic enabling capabilities, not an invented customer persona, application vertical, companion role, healthcare role, entertainment role, or smart-environment integration. Decompose each major subsystem into multiple cohesive Title Case verb-noun functions at the selected depth; do not merely rename physical components. Separate acquisition, interpretation or estimation, state/world representation, planning, control, execution, and measured feedback where they are distinct responsibilities. Include operator/external interfaces, configuration/mode, health/fault, resource/power, communications, security, degraded operation, recovery, and safety functions only when applicable. For each function, describe its responsibility, primary inputs, outputs, owned or transformed state, constraints, and safety or operational role.',
    format:
      'Use the number and granularity of unique rows appropriate to the selected decomposition depth and system complexity. Format each item exactly as "- Subsystem: subsystem name | Function: verb-noun function name | Description: detailed responsibility; inputs; outputs; state/constraints."',
  },
  interactions: {
    title: 'Control Interactions',
    instruction:
      'Generate a connected, non-duplicate, domain-specific set of interfaces covering every function in the inventory. Trace at least one complete mission flow from a genuine boundary input through acquisition, estimation or interpretation, representation, planning or decision, control, execution, and observable outcome as applicable. Add the purposeful feedback loops required to close control and decision behavior, plus warranted operator, configuration/mode, health/fault, resource, external communication, degraded, recovery, and emergency paths. Check that every payload can actually be produced by its source and consumed by its target, that control actions flow in the operationally correct direction, and that each function remains under one owner. Include reverse status, measurements, constraints, or corrective commands only when they change upstream behavior—never ceremonial acknowledgements. For each interaction, describe source, target, specific payload or command, trigger/context, timing expectation, receiver effect, and relevant safety/quality assumption.',
    format:
      'Use the number and granularity of unique rows appropriate to the selected decomposition depth and system complexity. Format each item exactly as "- From: source function | To: target function | Control Action: specific command/signal/request/data product | Description: trigger, payload, timing, receiver behavior, assumptions." Do not leave any field blank.',
  },
  ops: {
    title: 'Operational Scenarios / Modes of Operation',
    instruction:
      'Generate a comprehensive set of operational scenarios and modes, including startup, initialization, nominal operation, automated/autonomous operation, manual override, degraded/fault operation, communication loss, emergency/abort, maintenance/test, shutdown, and recovery when applicable. These are context only, not nodes or edges.',
    format:
      'Use 8-12 bullet rows. Format each item exactly as "- Mode: scenario or mode name | Description: what changes in control authority, timing, configuration, safety constraints, and recovery expectations." Do not use section headings and do not leave either field blank.',
  },
};

const PromptWizard = ({ onSubmit, onSkip, examples = EXAMPLES }) => {
  const panelRef = useRef(null);
  const [panelHeight, setPanelHeight] = useState(null);
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState({
    systemName: '',
    abstractionLevel: DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
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
  const [aiGeneratedFields, setAiGeneratedFields] = useState({});
  const [clarificationsByStep, setClarificationsByStep] = useState({});

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
  const currentClarifications = clarificationsByStep[current.key] || [];

  const handleChange = (e) => {
    const nextValue = e.target.value;
    setResponses({ ...responses, [current.key]: nextValue });
    setAiGeneratedFields((previous) => ({ ...previous, [current.key]: false }));
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
    setAiGeneratedFields((previous) => ({ ...previous, [current.key]: false }));
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

  const setClarificationsForCurrentStep = (questions) => {
    setClarificationsByStep((prev) => ({
      ...prev,
      [current.key]: questions,
    }));
  };

  const handleClarificationSelection = (questionId, option, checked = true) => {
    const nextQuestions = currentClarifications.map((question) => {
      if (question.id !== questionId) return question;
      if (question.type === 'multi') {
        const currentSelection = new Set(question.selectedOptions || []);
        if (checked) currentSelection.add(option);
        else currentSelection.delete(option);
        return { ...question, selectedOptions: Array.from(currentSelection) };
      }
      return { ...question, selectedOptions: [option] };
    });
    setClarificationsForCurrentStep(nextQuestions);
  };

  const handleClarificationText = (questionId, value) => {
    const nextQuestions = currentClarifications.map((question) => (
      question.id === questionId ? { ...question, text: value } : question
    ));
    setClarificationsForCurrentStep(nextQuestions);
  };

  const buildCompletionPrompt = (targetStep) => {
    const guidance = COMPLETION_GUIDANCE[targetStep.key];
    const existingText = String(responses[targetStep.key] || '').trim();
    const abstractionOption = getFunctionalAbstractionLevelOption(responses.abstractionLevel);
    const aiAuthoredPriorFields = Object.entries(aiGeneratedFields)
      .filter(([field, generated]) => generated && field !== targetStep.key)
      .map(([field]) => field);

    return `
You are helping complete a structured prompt wizard for functional architecture generation.

Target field: ${guidance.title}
Task: ${guidance.instruction}
Expected format: ${guidance.format}
Selected decomposition depth: ${abstractionOption.label} — ${abstractionOption.description}
Depth-specific generation guidance: ${getFunctionalAbstractionPromptGuidance(abstractionOption.value)}
Evidence status: ${aiAuthoredPriorFields.length
    ? `The following prior fields were AI-generated and are hypotheses to verify, not requirements: ${aiAuthoredPriorFields.join(', ')}.`
    : 'The supplied prior fields are user-authored evidence.'}

Prior inputs:
- System Name: ${responses.systemName || '(not provided)'}
- System Overview: ${responses.systemOverview || '(not provided)'}
- Functional Components: ${responses.functionalComponents || '(not provided)'}
- Control Interactions: ${responses.interactions || '(not provided)'}
- Operational Scenarios / Modes: ${responses.ops || '(not provided)'}
- Clarification answers: ${formatClarificationAnswersForPrompt(currentClarifications) || '(none provided)'}

Current target field content:
${existingText || '(empty)'}

Return only the completed field text. Do not include labels, markdown headings, explanations, or quotation marks.
Prefer specific nouns and verbs over generic placeholders. Include enough detail to support rich category, function, and interface descriptions in the generated functional decomposition without inventing unrelated subsystems.
`.trim();
  };

  const callWizardAI = async ({ prompt, system, maxTokens = 2500 }) => {
    const requestBody = {
      model: 'gpt-4o-mini',
      temperature: FUNCTIONAL_DECOMPOSITION_SAMPLING.temperature,
      top_p: FUNCTIONAL_DECOMPOSITION_SAMPLING.topP,
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
        maxTokens: COMPLETION_TOKEN_BUDGETS[current.key] || 2500,
        system: 'You are a senior systems architect. Complete wizard fields with domain-specific, internally consistent, safety-analysis-ready content at the user-selected abstraction level. Silently review coverage and interface semantics before returning the requested field.',
      });

      if (!content) throw new Error('AI completion returned no content.');

      setResponses((prev) => ({ ...prev, [current.key]: content }));
      setAiGeneratedFields((previous) => ({ ...previous, [current.key]: true }));
      if (TABLE_STEP_KEYS.has(current.key)) {
        setReviewTables((prev) => ({
          ...prev,
          [current.key]: parseArtifactRowsFromText(content, current.key),
        }));
      }
      setCompletionState({ loadingKey: `${current.key}:questions`, error: '' });
      await generateClarificationQuestions(content);
    } catch (error) {
      console.error('Prompt wizard AI completion failed:', error);
      setCompletionState({
        loadingKey: null,
        error: error?.message || 'AI completion failed. Check your AI provider settings and try again.',
      });
    }
  };

  const buildFollowUpPrompt = (completedContent = '') => {
    const priorQuestions = flattenClarificationQuestions(clarificationsByStep, current.key);
    return `
You are helping prepare inputs for functional architecture generation.

Review the current wizard content and identify concise follow-up questions only where uncertainty would materially affect the architecture, interfaces, operational modes, subsystem allocation, or later safety analysis.

Current step: ${current.label}
Selected decomposition depth: ${getFunctionalAbstractionLevelOption(responses.abstractionLevel).label}
System Name: ${responses.systemName || '(not provided)'}
System Overview: ${responses.systemOverview || '(not provided)'}
Functional Components: ${responses.functionalComponents || '(not provided)'}
Control Interactions: ${responses.interactions || '(not provided)'}
Operational Scenarios / Modes: ${responses.ops || '(not provided)'}
Latest AI completion for this step:
${completedContent || responses[current.key] || '(not provided)'}

Questions already asked in earlier wizard steps:
${priorQuestions.length ? priorQuestions.map((question) => `- ${question}`).join('\n') : '(none)'}

Return strict JSON only.
Return [] if no clarification is needed.
Otherwise return 1-4 objects using this schema:
[
  {
    "question": "Short clarification question",
    "type": "multi",
    "options": ["Option A", "Option B", "Option C"]
  }
]

Rules:
- Prefer type "multi" with concise options by default so users can choose all applicable answers.
- Use type "single" only when the choices are mutually exclusive and one answer is clearly expected.
- Use type "multi" when multiple choices may apply or when there is any uncertainty about exclusivity.
- Use type "text" when options would be misleading; omit options or return [] for options.
- Keep option labels concise and domain-specific.
- Do not repeat or lightly rephrase any question already asked in an earlier wizard step.
`.trim();
  };

  const generateClarificationQuestions = async (completedContent = '') => {
    try {
      const content = await callWizardAI({
        prompt: buildFollowUpPrompt(completedContent),
        maxTokens: 500,
        system:
          'You are a systems engineering reviewer. Return only strict JSON for high-value clarification questions.',
      });

      if (!content || /no follow-up questions needed/i.test(content)) {
        setCompletionState({ loadingKey: null, error: 'No follow-up questions needed for this step.' });
        setClarificationsForCurrentStep([]);
        return;
      }

      const parsed = parseJsonArrayFromText(content);
      const priorQuestions = flattenClarificationQuestions(clarificationsByStep, current.key);
      const seenQuestions = [...priorQuestions];
      const questions = (parsed || [])
        .map((item, index) => createClarificationQuestion(item, index))
        .filter((item) => item.question)
        .filter((item) => {
          if (isSimilarClarificationQuestion(item.question, seenQuestions)) return false;
          seenQuestions.push(item.question);
          return true;
        })
        .slice(0, 4);

      if (!questions.length) {
        setCompletionState({ loadingKey: null, error: 'No follow-up questions needed for this step.' });
        setClarificationsForCurrentStep([]);
        return;
      }

      setClarificationsForCurrentStep(questions);
      setCompletionState({ loadingKey: null, error: '' });
    } catch (error) {
      console.error('Prompt wizard follow-up question generation failed:', error);
      setCompletionState({
        loadingKey: null,
        error: error?.message || 'AI follow-up generation failed. Check your AI provider settings and try again.',
      });
    }
  };

  const handleAIFollowUpQuestions = async () => {
    if (!AI_COMPLETION_STEPS.has(current.key) || completionState.loadingKey) return;
    setCompletionState({ loadingKey: `${current.key}:questions`, error: '' });
    await generateClarificationQuestions();
  };

  const handleNext = () => {
    if (step < steps.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleFinalSubmit = () => {
    const clarifications = Object.fromEntries(
      Object.entries(clarificationsByStep).map(([key, questions]) => [key, serializeClarificationAnswers(questions)])
    );
    const combinedPrompt = JSON.stringify(
      {
        mode: "structured",
        systemName: responses.systemName,
        abstractionLevel: responses.abstractionLevel,
        systemOverview: responses.systemOverview,
        functionalComponents: responses.functionalComponents,
        interactions: responses.interactions,
        ops: responses.ops,
        clarifications,
        evidenceProvenance: {
          aiGeneratedFields: Object.entries(aiGeneratedFields)
            .filter(([, generated]) => generated)
            .map(([field]) => field),
        },
      },
      null,
      2
    );

    onSubmit(combinedPrompt);
  };

  const hasAICompletionStep = AI_COMPLETION_STEPS.has(current.key);

  useEffect(() => {
    let animationFrameId = null;
    const updatePanelHeight = () => {
      if (!panelRef.current) return;
      const viewport = window.visualViewport;
      const visibleBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight;
      const panelTop = panelRef.current.getBoundingClientRect().top;
      const availableHeight = Math.max(0, Math.floor(visibleBottom - panelTop - 16));
      setPanelHeight(availableHeight);
    };
    const schedulePanelHeightUpdate = () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(updatePanelHeight);
    };

    updatePanelHeight();
    schedulePanelHeightUpdate();
    window.addEventListener('resize', schedulePanelHeightUpdate);
    window.visualViewport?.addEventListener?.('resize', schedulePanelHeightUpdate);
    window.visualViewport?.addEventListener?.('scroll', schedulePanelHeightUpdate);
    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', schedulePanelHeightUpdate);
      window.visualViewport?.removeEventListener?.('resize', schedulePanelHeightUpdate);
      window.visualViewport?.removeEventListener?.('scroll', schedulePanelHeightUpdate);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="mx-auto flex w-full max-w-[min(96vw,1500px)] flex-col overflow-hidden rounded-xl border bg-white p-5 shadow"
      style={{ height: panelHeight === null ? 'calc(100dvh - 340px)' : `${panelHeight}px` }}
    >
      {/* Main wizard step */}
      <div className="shrink-0">
        <h2 className="text-xl font-semibold mb-1">{current.label}</h2>
        <p className="text-gray-600 text-sm mb-2">{current.question}</p>
      </div>
      <div className={`grid min-h-0 flex-1 gap-4 overflow-hidden ${hasAICompletionStep ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        <div className="min-h-0 overflow-auto pr-1">
          <textarea
            rows={4}
            className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring resize-none whitespace-pre-wrap"
            placeholder={current.placeholder}
            value={responses[current.key]}
            onChange={handleChange}
          />
          {current.key === 'systemName' && (
            <fieldset className="mt-5 text-left">
              <legend className="text-sm font-semibold text-gray-900">Functional decomposition depth</legend>
              <p className="mt-1 text-xs text-gray-500">
                This controls the granularity, subsystem coverage, interfaces, and expected detail throughout the wizard.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS.map((option) => {
                  const selected = responses.abstractionLevel === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                        selected
                          ? 'border-[#2D7DFE] bg-[#EEF4FF] ring-1 ring-[#2D7DFE]/20'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="functional-decomposition-depth"
                        value={option.value}
                        checked={selected}
                        onChange={(event) => setResponses((previous) => ({
                          ...previous,
                          abstractionLevel: event.target.value,
                        }))}
                        className="mt-1 h-4 w-4 shrink-0 accent-[#2D7DFE]"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                          {option.label}
                          {option.recommended && (
                            <span className="rounded-full bg-[#2D7DFE] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                              Recommended
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-gray-600">{option.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          {hasAICompletionStep && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAIComplete}
                disabled={Boolean(completionState.loadingKey)}
                className="inline-flex items-center gap-2 rounded border border-[#2D7DFE] bg-white px-3 py-2 text-sm font-medium text-[#1c5fde] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                title="Complete this field using the prior wizard inputs"
              >
                <Sparkles size={16} aria-hidden="true" />
                {completionState.loadingKey === current.key ? 'Completing...' : 'AI Complete'}
              </button>
              <button
                type="button"
                onClick={handleAIFollowUpQuestions}
                disabled={Boolean(completionState.loadingKey)}
                className="inline-flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                title="Refresh clarification questions for this step"
              >
                <RefreshCw size={16} aria-hidden="true" />
                {completionState.loadingKey === `${current.key}:questions` ? 'Reviewing...' : 'Refresh Questions'}
              </button>
              {completionState.error && (
                <p className={`text-xs ${/No follow-up/i.test(completionState.error) ? 'text-gray-500' : 'text-red-600'}`}>{completionState.error}</p>
              )}
            </div>
          )}

          {currentSchema && (
          <div className="mt-4 overflow-hidden rounded-md bg-white text-left shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
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
            <div className="max-h-[calc(100dvh-560px)] min-h-[180px] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 table-fixed text-sm text-left">
              <thead>
                <tr className="text-[#4B5563] text-sm font-medium">
                  {currentSchema.columns.map((column) => (
                    <th key={column.key} className={`${column.width || ''} sticky top-0 z-30 border-b border-gray-200 bg-white px-6 py-3 text-left whitespace-nowrap`}>
                      {column.label}
                    </th>
                  ))}
                  <th className="sticky top-0 z-30 w-24 border-b border-gray-200 bg-white px-6 py-3 text-center whitespace-nowrap">Remove</th>
                </tr>
              </thead>
              <tbody className="text-[#374151] text-sm">
                {currentRows.length === 0 ? (
                  <tr>
                    <td className="px-6 py-8 text-center text-sm text-gray-500" colSpan={currentSchema.columns.length + 1}>
                      {currentSchema.emptyText}
                    </td>
                  </tr>
                ) : currentRows.map((row, rowIndex) => (
                  <tr key={row.id} className={`${rowIndex % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]'} align-top transition-colors`}>
                    {currentSchema.columns.map((column) => (
                      <td key={column.key} className="border-b border-gray-100 px-6 py-4 align-top whitespace-pre-wrap">
                        <textarea
                          value={row[column.key] || ''}
                          onChange={(event) => handleReviewCellChange(row.id, column.key, event.target.value)}
                          rows={2}
                          className="min-h-[44px] w-full resize-none bg-transparent text-sm text-gray-900 focus:outline-none"
                          placeholder={column.placeholder}
                        />
                      </td>
                    ))}
                    <td className="border-b border-gray-100 px-6 py-4 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => handleRemoveReviewRow(row.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:bg-red-50 hover:text-red-600"
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
        </div>

        {hasAICompletionStep && (
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-amber-950">Clarifications</h3>
                <p className="text-xs text-amber-800">Answers are included when you submit.</p>
              </div>
              <MessageSquarePlus size={16} className="shrink-0 text-amber-700" aria-hidden="true" />
            </div>
            {completionState.loadingKey === `${current.key}:questions` ? (
              <div className="rounded border border-amber-200 bg-white/70 px-3 py-4 text-sm text-amber-900">
                Reviewing uncertainty...
              </div>
            ) : currentClarifications.length ? (
              <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
                {currentClarifications.map((question) => (
                  <div key={question.id} className="rounded-md border border-amber-200 bg-white p-3">
                    <p className="text-sm font-medium text-gray-900">{question.question}</p>
                    {question.options.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {question.options.map((option) => {
                          const selected = (question.selectedOptions || []).includes(option);
                          return question.type === 'multi' ? (
                            <label key={option} className="flex items-start gap-2 rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(event) => handleClarificationSelection(question.id, option, event.target.checked)}
                                className="mt-0.5"
                              />
                              <span>{option}</span>
                            </label>
                          ) : (
                            <button
                              key={option}
                              type="button"
                              onClick={() => handleClarificationSelection(question.id, option)}
                              className={`w-full rounded border px-2 py-1.5 text-left text-xs ${
                                selected
                                  ? 'border-amber-500 bg-amber-100 text-amber-950'
                                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <textarea
                      rows={2}
                      value={question.text}
                      onChange={(event) => handleClarificationText(question.id, event.target.value)}
                      className="mt-2 w-full resize-y rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-100"
                      placeholder="Add context if needed"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-amber-200 bg-white/70 px-3 py-4 text-sm text-amber-900">
                AI Complete will add questions here when clarification would improve the generated project.
              </div>
            )}
          </aside>
        )}
      </div>

      <div className="mt-4 flex shrink-0 justify-between border-t border-gray-100 pt-4">
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
