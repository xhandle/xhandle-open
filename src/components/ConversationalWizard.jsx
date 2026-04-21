/**
 * xHandle: conversational wizard shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// =============================================
// ConversationalWizard.jsx — Turn-Taking + Voice (TTS + ASR)
// =============================================

import React, { useEffect, useMemo, useRef, useState } from 'react';

// ----------------------- helpers -----------------------
async function ensureMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return true; // older browsers: nothing to do
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // immediately stop tracks; we only wanted the permission prompt
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    // surfaces in UI
    throw new Error(e?.name || e?.message || 'microphone_permission_denied');
  }
}

// ----------------------- Speech Hook -----------------------
function useSpeech({ onInterim, onFinal, onListeningChange, onBargeIn }) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const SR =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const recognitionRef = useRef(null);
  const keepAliveRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [supported] = useState({ tts: !!synth, asr: !!SR });
  const [error, setError] = useState(null);

  const interimBuffer = useRef('');
  const speakingRef = useRef(false);

  useEffect(() => {
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setIsListening(true);
      onListeningChange?.(true);
      if (speakingRef.current) onBargeIn?.(); // barge-in stops TTS
    };

    rec.onresult = (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (interimText && interimText !== interimBuffer.current) {
        interimBuffer.current = interimText;
        onInterim?.(interimText);
      }
      if (finalText) {
        onFinal?.(finalText.trim());
        interimBuffer.current = '';
        onInterim?.('');
      }
    };

    rec.onerror = (e) => {
      // common values: 'not-allowed', 'service-not-allowed', 'aborted', 'no-speech'
      setIsListening(false);
      onListeningChange?.(false);
      setError(e?.error || 'speech_error');
    };

    rec.onend = () => {
      setIsListening(false);
      onListeningChange?.(false);
      if (keepAliveRef.current) {
        try { rec.start(); } catch {}
      }
    };

    recognitionRef.current = rec;
    return () => {
      try { rec.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, [SR, onBargeIn, onFinal, onInterim, onListeningChange]);

  const speak = (text) => {
    if (!synth) return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.0;
      speakingRef.current = true;
      u.onend = () => { speakingRef.current = false; };
      synth.speak(u);
    } catch {}
  };

  const stopSpeaking = () => {
    try { synth?.cancel(); speakingRef.current = false; } catch {}
  };

  // keepAlive = true => continuous restart; false => one-shot (PTT)
  const startListening = async (keepAlive = true) => {
    const rec = recognitionRef.current; if (!rec) return;
    if (isListening) return;
    keepAliveRef.current = keepAlive;
    setError(null);
    try {
      // Prime explicit mic permission to avoid "not-allowed"
      await ensureMicPermission();
      // Visibility guards help avoid silent failures
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        throw new Error('tab_not_visible');
      }
      rec.start();
    } catch (e) {
      setError(e?.message || 'start_failed');
    }
  };

  const stopListening = () => {
    const rec = recognitionRef.current; if (!rec) return;
    keepAliveRef.current = false;
    try { rec.stop(); } catch {}
  };

  return { speak, stopSpeaking, startListening, stopListening, isListening, supported, error };
}

// ----------------------- Conversational Model -----------------------
const REQUIRED_SLOTS = [
  { id: 'systemName', label: 'What is the name of your system?' },
  { id: 'purpose', label: 'What does your system do? What is its main purpose or mission?' },
  { id: 'components', label: 'What are the key components or modules?' },
  { id: 'interactions', label: 'How do components interact or influence each other?' },
  { id: 'operationalScenarios', label: 'List key operational scenarios or modes.' },
];

const OPTIONAL_ENRICHERS = [];

/**
 * pickNextQuestion renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param facts Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function pickNextQuestion(facts) {
  const missing = REQUIRED_SLOTS.find((s) => !(s.id in facts));
  if (missing) {
    const text = missing.label.endsWith('?') ? missing.label : missing.label;
    return { slotId: missing.id, text };
  }
  return null;
}


/**
 * buildCombinedPrompt renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param facts Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function buildCombinedPrompt(facts) {
  const method = (facts.method || 'STPA').toUpperCase(); // fallback stays for the rest of your pipeline
  const payload = {
    mode: 'conversational',
    method,
    system: facts.systemName || '',
    objective: facts.purpose || '',
    components: facts.components || '',
    interactions: facts.interactions || '',
    optional: {
      operationalScenarios: facts.operationalScenarios || '',
    },
    outputFormat: { decompositionTableColumns: ['Function (From)', 'Control Action', 'Function (To)'] },
  };
  return JSON.stringify(payload, null, 2);
}


/**
 * renderPreview renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param facts Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function renderPreview(facts) {
  const lines = [];
  for (const slot of REQUIRED_SLOTS) {
    if (slot.id in facts) {
      const val = (facts[slot.id] || '').toString().trim();
      lines.push(`- ${slot.label}: ${val || '(skipped)'}`);
    }
  }
  return lines.join('\n');
}


// ----------------------- UI -----------------------
export default function ConversationalWizard({ onSubmit, onSkip }) {
  const [facts, setFacts] = useState({});
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Let\'s talk through your system. I\'ll ask a few questions and we\'ll build the prompt together. Ready when you are!' },
  ]);
  const [input, setInput] = useState('');
  const [interim, setInterim] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ptt, setPtt] = useState(false);
  const lastAskedRef = useRef(null);

  const currentQ = useMemo(() => pickNextQuestion(facts), [facts]);

  const { speak, stopSpeaking, startListening, stopListening, isListening, supported, error } = useSpeech({
    onInterim: (text) => setInterim(text),
    onFinal: (text) => setInput((prev) => (prev ? prev + ' ' : '') + text),
    onListeningChange: () => {},
    onBargeIn: () => { stopSpeaking(); },
  });

  const isSecure = typeof window !== 'undefined'
    ? window.isSecureContext || window.location.hostname === 'localhost'
    : false;

  const append = (role, content) => setMessages((m) => [...m, { role, content }]);

  useEffect(() => {
    if (!currentQ) return;
    if (lastAskedRef.current === currentQ.slotId) return;
    lastAskedRef.current = currentQ.slotId;
    append('assistant', currentQ.text);
    if (ttsEnabled && supported.tts) speak(currentQ.text);
  }, [currentQ, ttsEnabled, supported.tts, speak]);

  const send = (text) => {
    const cleaned = (text ?? input).trim();
    if (!cleaned && currentQ) {
      if (OPTIONAL_ENRICHERS.some((s) => s.id === currentQ.slotId)) {
        setFacts((f) => ({ ...f, [currentQ.slotId]: '' }));
        lastAskedRef.current = null;
      }
      return;
    }
    if (!cleaned) return;

    append('user', cleaned);
    if (currentQ?.slotId) {
      if (/^skip$/i.test(cleaned)) setFacts((f) => ({ ...f, [currentQ.slotId]: '' }));
      else setFacts((f) => ({ ...f, [currentQ.slotId]: cleaned }));
    }
    setInput('');
    setInterim('');
    lastAskedRef.current = null;
  };

  const handleFinish = () => {
    const combinedPrompt = buildCombinedPrompt(facts);
    append('assistant', 'Great. I\'ll generate the decomposition and risk profile from what we\'ve captured.');
    if (ttsEnabled && supported.tts) speak('Great. I will generate the decomposition and risk profile now.');
    onSubmit?.(combinedPrompt);
  };

  const canFinish = !pickNextQuestion(facts);
  const previewText = renderPreview(facts);

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Header / Controls */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-semibold">Conversational Wizard</h3>
        <div className="flex items-center gap-2">
          <label className="text-xs inline-flex items-center gap-1">
            <input type="checkbox" checked={ttsEnabled} onChange={(e)=>setTtsEnabled(e.target.checked)} />
            Voice replies
          </label>
          <label className="text-xs inline-flex items-center gap-1">
            <input type="checkbox" checked={ptt} onChange={(e)=>setPtt(e.target.checked)} />
            Push-to-talk
          </label>
          <button className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm" onClick={() => onSkip?.()}>Cancel</button>
          <button className={`px-3 py-1.5 rounded-lg text-sm ${canFinish ? 'bg-black text-white hover:bg-gray-800' : 'bg-gray-300 text-gray-600 cursor-not-allowed'}`} onClick={handleFinish} disabled={!canFinish}>Finish & Generate</button>
        </div>
      </div>

      {/* Transcript */}
      <div className="border rounded-2xl p-4 mb-3 bg-white/70 shadow-sm">
        <div className="h-64 overflow-y-auto space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.role === 'assistant' ? 'bg-gray-100' : 'bg-black text-white'}`}>{m.content}</div>
            </div>
          ))}
          {!currentQ && (
            <div className="flex justify-start"><div className="max-w-[80%] rounded-2xl px-3 py-2 text-sm bg-gray-100">We&apos;re ready to generate.</div></div>
          )}
        </div>

        {/* Input Row */}
        <div className="mt-3 flex items-center gap-2">
          <input
            className="flex-1 border rounded-xl px-3 py-2 text-sm"
            placeholder={currentQ ? 'Answer here…' : 'All set — press Finish & Generate'}
            value={input || (interim ? `${interim}…` : '')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          {/* Mic */}
          <button
            className={`px-3 py-2 rounded-xl text-sm border ${supported.asr && isSecure ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'}`}
            onPointerDown={async (e) => { // PTT hold: one-shot, no auto-restart
              if (ptt && supported.asr && isSecure) {
                e.preventDefault();
                try { await ensureMicPermission(); await startListening(false); } catch {}
              }
            }}
            onPointerUp={(e) => {
              if (ptt && supported.asr && isSecure) { e.preventDefault(); stopListening(); }
            }}
            onPointerLeave={(e) => {
              if (ptt && supported.asr && isSecure && isListening) { e.preventDefault(); stopListening(); }
            }}
            onClick={async (e) => { // Toggle: continuous with auto-restart
              if (!ptt && supported.asr && isSecure) {
                e.preventDefault();
                if (isListening) stopListening();
                else {
                  try { await ensureMicPermission(); await startListening(true); } catch {}
                }
              }
            }}
            disabled={!supported.asr || !isSecure}
            title={
              !supported.asr ? 'Voice input not supported in this browser'
              : !isSecure ? 'Mic requires HTTPS or http://localhost'
              : (isListening ? 'Listening…' : (ptt ? 'Hold to talk' : 'Click to toggle mic'))
            }
          >
            {isListening ? '🛑 Stop' : (ptt ? '🎤 Hold' : '🎤 Mic')}
          </button>
          <button className="px-3 py-2 rounded-xl text-sm border hover:bg-gray-100" onClick={() => send()}>Send</button>
          <button className="px-3 py-2 rounded-xl text-sm border hover:bg-gray-100" onClick={() => {
            if (supported.tts && messages.length) {
              const last = messages.filter(m=>m.role==='assistant').pop();
              if (last) { stopSpeaking(); speak(last.content); }
            }
          }}>🔊 Replay</button>
        </div>

        {/* Debug/status line */}
        <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${isListening ? 'bg-green-500' : 'bg-gray-300'}`}></span>
          <span>
            {supported.asr
              ? (isListening ? (ptt ? 'Listening (hold)…' : 'Listening…') : 'Mic off — tap Mic to start')
              : 'ASR unsupported in this browser'}
          </span>
          {!isSecure && <span className="text-orange-600"> • Use HTTPS or http://localhost</span>}
          {error && <span className="text-red-500"> • {String(error)}</span>}
          <span className="ml-auto text-[10px] text-gray-400">
            ctx:{String(isSecure)} asr:{String(supported.asr)}
          </span>
        </div>
      </div>

      {/* Prompt Preview */}
      <div className="border rounded-2xl p-4 bg-white/70">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Prompt preview</h4>
          <span className="text-xs text-gray-500">Same shape your pipeline expects</span>
        </div>
        <pre className="mt-2 text-xs whitespace-pre-wrap">
{previewText || 'We\'ll show a running summary here as you answer.'}
        </pre>
      </div>
    </div>
  );
}
