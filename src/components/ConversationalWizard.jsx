import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { backendURL, buildAIAuthOpts } from './backendConfig';
import {
  DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
  FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS,
  getFunctionalAbstractionLevelOption,
  getFunctionalAbstractionPromptGuidance,
} from './functionalDecompositionAbstraction';

const FACT_FIELDS = [
  { key: 'systemName', label: 'System name', shortLabel: 'Name', rows: 1 },
  { key: 'purpose', label: 'Mission and system boundary', shortLabel: 'Mission', rows: 3 },
  { key: 'components', label: 'Known functions or components', shortLabel: 'Functions', rows: 4 },
  { key: 'interactions', label: 'Known interfaces and interactions', shortLabel: 'Interfaces', rows: 4 },
  { key: 'operationalScenarios', label: 'Operational scenarios and modes', shortLabel: 'Operations', rows: 3 },
];

const INITIAL_MESSAGE = {
  role: 'assistant',
  content: 'Tell me what you are building and what it needs to accomplish. Start wherever you have the most context—you can use a sentence, rough notes, or paste an existing description.',
};

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanUserName(value) {
  return cleanText(value).replace(/\s+/g, ' ').slice(0, 80);
}

function getGreetingName(value) {
  return cleanUserName(value).split(' ')[0] || '';
}

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
  return candidates.map(cleanText).find(Boolean) || '';
}

function parseJsonObjectFromText(value) {
  const raw = cleanText(value);
  if (!raw) return null;
  const candidates = [raw, raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function normalizeQuestion(value) {
  if (!value || typeof value !== 'object') return null;
  const text = cleanText(value.text || value.question || value.prompt);
  if (!text) return null;
  const options = Array.isArray(value.options)
    ? value.options.map(cleanText).filter(Boolean).slice(0, 5)
    : [];
  const requestedType = cleanText(value.type).toLowerCase();
  const type = requestedType === 'multi'
    ? 'multi'
    : requestedType === 'single' && options.length
      ? 'single'
      : options.length
        ? 'single'
        : 'text';
  return { text, type, options };
}

export function parseConversationalWizardTurn(value) {
  const raw = cleanText(value);
  const parsed = parseJsonObjectFromText(raw);
  if (!parsed) {
    return {
      message: raw || 'I captured that. What else should the architecture account for?',
      updates: {},
      question: null,
      assumptions: [],
      readiness: {},
    };
  }
  const updates = {};
  const sourceUpdates = parsed.updates && typeof parsed.updates === 'object' ? parsed.updates : {};
  const userName = cleanUserName(sourceUpdates.userName);
  if (userName) updates.userName = userName;
  FACT_FIELDS.forEach(({ key }) => {
    const nextValue = cleanText(sourceUpdates[key]);
    if (nextValue) updates[key] = nextValue;
  });
  const readiness = parsed.readiness && typeof parsed.readiness === 'object'
    ? {
        ready: Boolean(parsed.readiness.ready),
        score: Number.isFinite(Number(parsed.readiness.score))
          ? Math.max(0, Math.min(100, Number(parsed.readiness.score)))
          : undefined,
        missing: Array.isArray(parsed.readiness.missing)
          ? parsed.readiness.missing.map(cleanText).filter(Boolean).slice(0, 5)
          : [],
      }
    : {};
  return {
    message: cleanText(parsed.message || parsed.response) || 'I updated the working brief.',
    updates,
    question: normalizeQuestion(parsed.question),
    assumptions: Array.isArray(parsed.assumptions)
      ? parsed.assumptions.map(cleanText).filter(Boolean).slice(0, 6)
      : [],
    readiness,
  };
}

export function mergeConversationalWizardFacts(current = {}, updates = {}) {
  const next = { ...current };
  const userName = cleanUserName(updates.userName);
  if (userName) next.userName = userName;
  FACT_FIELDS.forEach(({ key }) => {
    const value = cleanText(updates[key]);
    if (value) next[key] = value;
  });
  return next;
}

export function personalizeConversationalWizardTurn(turn = {}, currentFacts = {}) {
  const userName = cleanUserName(turn?.updates?.userName);
  if (!userName || cleanUserName(currentFacts.userName)) return turn;
  const greetingName = getGreetingName(userName);
  const message = cleanText(turn.message);
  const alreadyGreetsUser = greetingName && message.toLocaleLowerCase().includes(greetingName.toLocaleLowerCase());
  return {
    ...turn,
    message: alreadyGreetsUser
      ? message
      : `Nice to meet you, ${greetingName}. ${message}`.trim(),
  };
}

export function getConversationalWizardReadiness(facts = {}) {
  const completed = FACT_FIELDS.filter(({ key }) => cleanText(facts[key])).map(({ key }) => key);
  const missing = FACT_FIELDS.filter(({ key }) => !completed.includes(key)).map(({ label }) => label);
  const coreReady = Boolean(cleanText(facts.systemName) && cleanText(facts.purpose));
  return {
    completed,
    missing,
    score: Math.round((completed.length / FACT_FIELDS.length) * 100),
    coreReady,
  };
}

export function isConversationalGenerateIntent(value) {
  return /^(?:(?:that(?:'s| is) (?:enough|good)|looks good)[,!. ]*)?(?:please\s+)?(?:generate|create|build|make)(?:\s+(?:it|the draft|the decomposition|the functional decomposition))?(?:\s+now)?[.!]?$/i
    .test(cleanText(value));
}

export function buildConversationalWizardPayload({
  facts = {},
  abstractionLevel = DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL,
  assumptions = [],
} = {}) {
  return JSON.stringify({
    mode: 'conversational',
    userName: cleanUserName(facts.userName),
    systemName: cleanText(facts.systemName),
    abstractionLevel,
    systemOverview: cleanText(facts.purpose),
    functionalComponents: cleanText(facts.components),
    interactions: cleanText(facts.interactions),
    ops: cleanText(facts.operationalScenarios),
    clarifications: {},
    assumptions: assumptions.map(cleanText).filter(Boolean),
    evidenceProvenance: {
      aiGeneratedFields: [],
      userGroundedFields: FACT_FIELDS
        .filter(({ key }) => cleanText(facts[key]))
        .map(({ key }) => key),
      source: 'guided-conversation',
    },
  }, null, 2);
}

export function parseRealtimeArchitectureBrief(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { updates: {}, assumptions: [], ready: false };
  }

  const updates = {};
  const userName = cleanUserName(parsed.userName);
  if (userName) updates.userName = userName;
  FACT_FIELDS.forEach(({ key }) => {
    const nextValue = cleanText(parsed[key]);
    if (nextValue) updates[key] = nextValue;
  });
  return {
    updates,
    assumptions: Array.isArray(parsed.assumptions)
      ? parsed.assumptions.map(cleanText).filter(Boolean).slice(0, 6)
      : [],
    ready: Boolean(parsed.ready),
  };
}

async function ensureMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return true;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
  return true;
}

async function requestNaturalSpeechAudio(text, signal) {
  const response = await fetch(`${backendURL}/api/audio/speech`, {
    method: 'POST',
    ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
    signal,
    body: JSON.stringify({ input: text }),
  });
  if (!response.ok) {
    const responseText = await response.text();
    let detail = responseText;
    try {
      const payload = JSON.parse(responseText);
      detail = cleanText(payload?.error || payload?.message);
    } catch {}
    throw new Error(detail || `Natural voice request failed (${response.status}).`);
  }
  return response.blob();
}

function useSpeech({ onInterim, onFinal }) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  const callbackRef = useRef({ onInterim, onFinal });
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef('');
  const audioContextRef = useRef(null);
  const animationFrameRef = useRef(null);
  const speechRequestRef = useRef(null);
  const speechBurstTimerRef = useRef(null);
  const speechResolveRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechBurst, setSpeechBurst] = useState(0);
  const [error, setError] = useState('');
  const [voiceMode, setVoiceMode] = useState('natural');
  const [voiceNotice, setVoiceNotice] = useState('');

  useEffect(() => {
    callbackRef.current = { onInterim, onFinal };
  }, [onFinal, onInterim]);

  useEffect(() => {
    if (!SpeechRecognition) return undefined;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      callbackRef.current.onInterim?.(interimText);
      if (finalText.trim()) {
        callbackRef.current.onFinal?.(finalText.trim());
        callbackRef.current.onInterim?.('');
      }
    };
    recognition.onerror = (event) => {
      setError(event?.error || 'Voice input failed.');
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => {
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, [SpeechRecognition]);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current || isListening) return;
    setError('');
    try {
      await ensureMicPermission();
      if (document.visibilityState !== 'visible') throw new Error('Open this tab before starting voice input.');
      recognitionRef.current.start();
    } catch (voiceError) {
      setError(voiceError?.message || 'Unable to start voice input.');
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
  }, []);

  const releaseAudioResources = useCallback(() => {
    speechRequestRef.current?.abort();
    speechRequestRef.current = null;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load?.();
    }
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = '';
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close?.().catch?.(() => {});
    }
    audioContextRef.current = null;
  }, []);

  const speak = useCallback((text) => new Promise((resolve) => {
    const spokenText = cleanText(text);
    if (!spokenText) {
      resolve();
      return;
    }

    speechResolveRef.current?.();
    try { synth?.cancel(); } catch {}
    releaseAudioResources();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (speechBurstTimerRef.current) clearTimeout(speechBurstTimerRef.current);
      releaseAudioResources();
      setSpeechBurst(0);
      setIsSpeaking(false);
      if (speechResolveRef.current === finish) speechResolveRef.current = null;
      resolve();
    };
    speechResolveRef.current = finish;

    const speakWithDeviceVoice = () => {
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
        setVoiceNotice('Natural voice is unavailable. Add an OpenAI API key in Settings.');
        finish();
        return;
      }
      setVoiceMode('device');
      setVoiceNotice('Natural OpenAI voice is unavailable; using this device’s voice.');
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onboundary = () => {
        setSpeechBurst(0.7);
        if (speechBurstTimerRef.current) clearTimeout(speechBurstTimerRef.current);
        speechBurstTimerRef.current = setTimeout(() => setSpeechBurst(0), 240);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      synth.speak(utterance);
    };

    (async () => {
      if (typeof window === 'undefined' || typeof window.Audio === 'undefined') {
        speakWithDeviceVoice();
        return;
      }
      const controller = new AbortController();
      speechRequestRef.current = controller;
      try {
        const blob = await requestNaturalSpeechAudio(spokenText, controller.signal);
        if (finished || controller.signal.aborted) return;
        speechRequestRef.current = null;
        const objectUrl = URL.createObjectURL(blob);
        const audio = new window.Audio(objectUrl);
        audioRef.current = audio;
        audioUrlRef.current = objectUrl;
        audio.preload = 'auto';
        audio.onplay = () => {
          setVoiceMode('natural');
          setVoiceNotice('');
          setIsSpeaking(true);
        };
        audio.onended = finish;
        audio.onerror = finish;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.88;
          const source = context.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(context.destination);
          audioContextRef.current = context;
          const levels = new Uint8Array(analyser.fftSize);
          let smoothedEnergy = 0;
          let lastVisualUpdate = 0;
          const updateSpeechPulse = (timestamp = 0) => {
            if (finished) return;
            analyser.getByteTimeDomainData(levels);
            const meanSquare = levels.reduce((sum, level) => {
              const normalized = (level - 128) / 128;
              return sum + (normalized * normalized);
            }, 0) / levels.length;
            const targetEnergy = Math.min(1, Math.sqrt(meanSquare) * 4.8);
            const easing = targetEnergy > smoothedEnergy ? 0.2 : 0.075;
            smoothedEnergy += (targetEnergy - smoothedEnergy) * easing;
            if (timestamp - lastVisualUpdate > 32) {
              setSpeechBurst(Number(smoothedEnergy.toFixed(3)));
              lastVisualUpdate = timestamp;
            }
            animationFrameRef.current = requestAnimationFrame(updateSpeechPulse);
          };
          await context.resume();
          updateSpeechPulse();
        }
        await audio.play();
      } catch (voiceError) {
        if (finished || voiceError?.name === 'AbortError') return;
        releaseAudioResources();
        speakWithDeviceVoice();
      }
    })();
  }), [releaseAudioResources, synth]);

  const stopSpeaking = useCallback(() => {
    try { synth?.cancel(); } catch {}
    speechResolveRef.current?.();
    speechResolveRef.current = null;
    releaseAudioResources();
    if (speechBurstTimerRef.current) clearTimeout(speechBurstTimerRef.current);
    setSpeechBurst(0);
    setIsSpeaking(false);
  }, [releaseAudioResources, synth]);

  return {
    supported: Boolean(SpeechRecognition),
    speakingSupported: Boolean(synth || (typeof window !== 'undefined' && window.Audio)),
    isListening,
    isSpeaking,
    speechBurst,
    error,
    voiceMode,
    voiceNotice,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}

function useRealtimeVoice({
  audioEnabled,
  onAssistantTranscript,
  onAssistantTranscriptDelta,
  onBrief,
  onReady,
  onUserTranscript,
  onUserTranscriptDelta,
}) {
  const callbackRef = useRef({
    onAssistantTranscript,
    onAssistantTranscriptDelta,
    onBrief,
    onReady,
    onUserTranscript,
    onUserTranscriptDelta,
  });
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationFrameRef = useRef(null);
  const pendingToolCallRef = useRef(null);
  const readyAfterPlaybackRef = useRef(false);
  const assistantTranscriptRef = useRef('');
  const userTranscriptRef = useRef('');
  const inputMutedRef = useRef(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [speechBurst, setSpeechBurst] = useState(0);
  const [inputMuted, setInputMuted] = useState(false);
  const [error, setError] = useState('');

  const supported = Boolean(
    typeof window !== 'undefined'
    && window.RTCPeerConnection
    && navigator.mediaDevices?.getUserMedia
  );

  useEffect(() => {
    callbackRef.current = {
      onAssistantTranscript,
      onAssistantTranscriptDelta,
      onBrief,
      onReady,
      onUserTranscript,
      onUserTranscriptDelta,
    };
  }, [
    onAssistantTranscript,
    onAssistantTranscriptDelta,
    onBrief,
    onReady,
    onUserTranscript,
    onUserTranscriptDelta,
  ]);

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !audioEnabled;
  }, [audioEnabled]);

  const releaseResources = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    try { dataChannelRef.current?.close(); } catch {}
    dataChannelRef.current = null;
    try { peerConnectionRef.current?.close(); } catch {}
    peerConnectionRef.current = null;
    microphoneStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause?.();
      remoteAudioRef.current.srcObject = null;
    }
    remoteAudioRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close?.().catch?.(() => {});
    }
    audioContextRef.current = null;
    pendingToolCallRef.current = null;
    readyAfterPlaybackRef.current = false;
    assistantTranscriptRef.current = '';
    userTranscriptRef.current = '';
  }, []);

  const disconnect = useCallback(() => {
    releaseResources();
    inputMutedRef.current = false;
    setInputMuted(false);
    setIsConnecting(false);
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setIsThinking(false);
    setSpeechBurst(0);
  }, [releaseResources]);

  const sendEvent = useCallback((event) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);

  const setMicrophoneMuted = useCallback((muted) => {
    inputMutedRef.current = muted;
    microphoneStreamRef.current?.getAudioTracks?.().forEach((track) => {
      track.enabled = !muted;
    });
    setInputMuted(muted);
    setIsListening(!muted);
  }, []);

  const startAudioMeter = useCallback((stream) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream) return;
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.9;
      context.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = context;
      const levels = new Uint8Array(analyser.fftSize);
      let smoothedEnergy = 0;
      let lastVisualUpdate = 0;
      const updateSpeechPulse = (timestamp = 0) => {
        if (!audioContextRef.current) return;
        analyser.getByteTimeDomainData(levels);
        const meanSquare = levels.reduce((sum, level) => {
          const normalized = (level - 128) / 128;
          return sum + (normalized * normalized);
        }, 0) / levels.length;
        const targetEnergy = Math.min(1, Math.sqrt(meanSquare) * 4.8);
        const easing = targetEnergy > smoothedEnergy ? 0.2 : 0.075;
        smoothedEnergy += (targetEnergy - smoothedEnergy) * easing;
        if (timestamp - lastVisualUpdate > 32) {
          setSpeechBurst(Number(smoothedEnergy.toFixed(3)));
          lastVisualUpdate = timestamp;
        }
        animationFrameRef.current = requestAnimationFrame(updateSpeechPulse);
      };
      context.resume?.().catch?.(() => {});
      updateSpeechPulse();
    } catch {
      // Audio remains fully functional when visualization metering is unavailable.
    }
  }, []);

  const completeToolCall = useCallback(async (toolCall) => {
    if (!toolCall || toolCall.name !== 'capture_architecture_brief') return;
    const brief = parseRealtimeArchitectureBrief(toolCall.arguments);
    let outcome = { ready: brief.ready };
    try {
      outcome = await callbackRef.current.onBrief?.(brief) || outcome;
    } catch {
      outcome = { ready: false };
    }
    const ready = Boolean(outcome?.ready ?? brief.ready);
    readyAfterPlaybackRef.current = ready;
    sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: toolCall.call_id,
        output: JSON.stringify({
          accepted: true,
          ready,
          next: ready
            ? 'Tell the user generation is starting.'
            : 'Continue with one concise, high-value discovery question.',
        }),
      },
    });
    sendEvent({
      type: 'response.create',
      response: {
        output_modalities: ['audio'],
        tool_choice: 'none',
        instructions: ready
          ? 'Tell the user naturally and briefly that you have enough context and are starting the functional decomposition now. Do not ask another question.'
          : 'Continue the discovery conversation naturally. Briefly reflect the useful context and ask exactly one highest-value question. Stay under 55 words.',
      },
    });
  }, [sendEvent]);

  const handleServerEvent = useCallback((event) => {
    switch (event?.type) {
      case 'session.created':
      case 'session.updated':
        setError('');
        break;
      case 'input_audio_buffer.speech_started':
        userTranscriptRef.current = '';
        setIsListening(true);
        setIsSpeaking(false);
        setIsThinking(false);
        callbackRef.current.onUserTranscriptDelta?.('');
        break;
      case 'input_audio_buffer.speech_stopped':
        setIsListening(false);
        setIsThinking(true);
        break;
      case 'conversation.item.input_audio_transcription.delta': {
        userTranscriptRef.current += event.delta || '';
        callbackRef.current.onUserTranscriptDelta?.(userTranscriptRef.current);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = cleanText(event.transcript || userTranscriptRef.current);
        userTranscriptRef.current = '';
        callbackRef.current.onUserTranscriptDelta?.('');
        if (transcript) callbackRef.current.onUserTranscript?.(transcript);
        break;
      }
      case 'response.created':
        assistantTranscriptRef.current = '';
        setIsThinking(true);
        break;
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') pendingToolCallRef.current = event.item;
        break;
      case 'response.output_audio_transcript.delta':
        assistantTranscriptRef.current += event.delta || '';
        callbackRef.current.onAssistantTranscriptDelta?.(assistantTranscriptRef.current);
        break;
      case 'response.output_audio_transcript.done': {
        const transcript = cleanText(event.transcript || assistantTranscriptRef.current);
        assistantTranscriptRef.current = '';
        if (transcript) callbackRef.current.onAssistantTranscript?.(transcript);
        break;
      }
      case 'output_audio_buffer.started':
        setIsThinking(false);
        setIsListening(false);
        setIsSpeaking(true);
        break;
      case 'output_audio_buffer.stopped': {
        setIsSpeaking(false);
        setSpeechBurst(0);
        setIsListening(!inputMutedRef.current);
        if (readyAfterPlaybackRef.current) {
          readyAfterPlaybackRef.current = false;
          callbackRef.current.onReady?.();
        }
        break;
      }
      case 'response.done': {
        const toolCall = pendingToolCallRef.current;
        pendingToolCallRef.current = null;
        if (toolCall) completeToolCall(toolCall);
        else setIsThinking(false);
        if (event.response?.status === 'failed') {
          setError(event.response?.status_details?.error?.message || 'Realtime voice could not complete that response.');
        }
        break;
      }
      case 'error':
        setIsThinking(false);
        setError(event.error?.message || 'The Realtime voice session encountered an error.');
        break;
      default:
        break;
    }
  }, [completeToolCall]);

  const connect = useCallback(async ({ abstractionLabel } = {}) => {
    if (!supported) throw new Error('Realtime voice is not supported in this browser.');
    disconnect();
    setError('');
    setIsConnecting(true);
    try {
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      microphoneStreamRef.current = microphoneStream;

      const tokenResponse = await fetch(`${backendURL}/api/rt/session`, {
        method: 'POST',
        ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ abstractionLabel }),
      });
      const tokenPayload = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenPayload?.value) {
        throw new Error(cleanText(tokenPayload?.error?.message || tokenPayload?.error) || `Realtime session failed (${tokenResponse.status}).`);
      }

      const peerConnection = new window.RTCPeerConnection();
      peerConnectionRef.current = peerConnection;
      const remoteAudio = document.createElement('audio');
      remoteAudio.autoplay = true;
      remoteAudio.muted = !audioEnabled;
      remoteAudioRef.current = remoteAudio;
      peerConnection.ontrack = (trackEvent) => {
        const [remoteStream] = trackEvent.streams || [];
        if (!remoteStream) return;
        remoteAudio.srcObject = remoteStream;
        remoteAudio.play?.().catch?.(() => {});
        startAudioMeter(remoteStream);
      };
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          setError('The Realtime voice connection was interrupted.');
          setIsConnected(false);
          setIsListening(false);
          setIsSpeaking(false);
        }
      };
      microphoneStream.getTracks().forEach((track) => peerConnection.addTrack(track, microphoneStream));

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.addEventListener('message', (messageEvent) => {
        try {
          handleServerEvent(JSON.parse(messageEvent.data));
        } catch {
          // Ignore malformed diagnostic events while keeping the audio session alive.
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${tokenPayload.value}`,
          'Content-Type': 'application/sdp',
        },
      });
      const answerSdp = await sdpResponse.text();
      if (!sdpResponse.ok) throw new Error(answerSdp || `Realtime WebRTC connection failed (${sdpResponse.status}).`);
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      await new Promise((resolve, reject) => {
        if (dataChannel.readyState === 'open') {
          resolve();
          return;
        }
        const timeout = setTimeout(() => reject(new Error('Realtime voice connection timed out.')), 12000);
        dataChannel.addEventListener('open', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });

      setIsConnecting(false);
      setIsConnected(true);
      setIsListening(true);
      sendEvent({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          tool_choice: 'none',
          instructions: `Open this architecture discovery conversation warmly. Say: "${INITIAL_MESSAGE.content}" Keep the delivery natural and do not call a tool for this opening greeting.`,
        },
      });
      return true;
    } catch (connectionError) {
      const message = connectionError?.message || 'Unable to start Realtime voice.';
      releaseResources();
      setIsConnecting(false);
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
      setIsThinking(false);
      setSpeechBurst(0);
      setError(message);
      throw connectionError;
    }
  }, [audioEnabled, disconnect, handleServerEvent, releaseResources, sendEvent, startAudioMeter, supported]);

  const sendText = useCallback((text) => {
    const cleaned = cleanText(text);
    if (!cleaned) return false;
    setIsListening(false);
    setIsThinking(true);
    return sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: cleaned }],
      },
    }) && sendEvent({ type: 'response.create' });
  }, [sendEvent]);

  const interruptAndListen = useCallback(() => {
    sendEvent({ type: 'response.cancel' });
    sendEvent({ type: 'output_audio_buffer.clear' });
    setMicrophoneMuted(false);
    setIsSpeaking(false);
    setSpeechBurst(0);
  }, [sendEvent, setMicrophoneMuted]);

  useEffect(() => () => releaseResources(), [releaseResources]);

  return {
    supported,
    isConnecting,
    isConnected,
    isListening,
    isSpeaking,
    isThinking,
    speechBurst,
    inputMuted,
    error,
    connect,
    disconnect,
    interruptAndListen,
    sendText,
    setMicrophoneMuted,
  };
}

function buildConversationPrompt({ userMessage, facts, messages, abstractionLevel }) {
  const abstraction = getFunctionalAbstractionLevelOption(abstractionLevel);
  return `
Continue an adaptive discovery conversation for a functional decomposition.

Selected abstraction: ${abstraction.label} — ${abstraction.description}
Depth guidance: ${getFunctionalAbstractionPromptGuidance(abstraction.value)}

Current user-grounded brief:
${JSON.stringify(facts, null, 2)}

Recent conversation:
${messages.slice(-8).map((message) => `${message.role}: ${message.content}`).join('\n')}

Latest user message:
${userMessage}

Return one strict JSON object with this shape:
{
  "message": "A concise reflection of what changed or why the next detail matters. Do not repeat the question.",
  "updates": {
    "userName": "the user's name only when they explicitly provide it",
    "systemName": "complete replacement value only when directly supported by the user",
    "purpose": "complete replacement value only when directly supported by the user",
    "components": "concise newline-separated inventory only when directly supported by the user",
    "interactions": "concise newline-separated interfaces only when directly supported by the user",
    "operationalScenarios": "concise newline-separated scenarios or modes only when directly supported by the user"
  },
  "question": {
    "text": "one highest-value next question, or omit when ready",
    "type": "text | single | multi",
    "options": ["2-5 concise choices when useful"]
  },
  "assumptions": ["important assumption that must remain visible to the user"],
  "readiness": {
    "ready": false,
    "score": 0,
    "missing": ["material missing information"]
  }
}

Rules:
- Extract and normalize only facts supported by the user's words. Never silently invent a use case, subsystem, interface, operating mode, or constraint.
- When the user explicitly provides their name, include it in updates.userName and greet them naturally by their first name in this turn. Greet them once when learned, not on every subsequent turn.
- Treat a correction as authoritative and replace the affected value.
- Ask one question at a time. Ask only when the answer would materially change scope, decomposition depth, subsystem ownership, interfaces, operating context, or safety-relevant behavior.
- Prefer a natural text question. Offer concise single- or multi-select options only when they reduce effort without constraining legitimate answers.
- Do not march through a fixed checklist. Use what is already known, skip irrelevant topics, and mark the brief ready as soon as it can support a useful draft.
- Set readiness.ready to true when the system identity or boundary, mission, and selected abstraction are clear enough to generate a useful draft and no unanswered question would materially change the architecture. Functions, interfaces, and modes may be inferred during generation; do not require every brief field to be populated.
- The user can say skip, use reasonable assumptions, or generate now. Respect those instructions and list any consequential assumption explicitly.
- Keep the message under 45 words and the question under 30 words.
- Include only changed fields in updates. Use an empty object when nothing changed.
- Return JSON only, without markdown fences.
`.trim();
}

async function requestConversationTurn({ userMessage, facts, messages, abstractionLevel, signal }) {
  const response = await fetch(`${backendURL}/api/chat`, {
    method: 'POST',
    ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
    signal,
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content: 'You are a concise, collaborative systems architect conducting adaptive discovery. Return only the requested JSON. Ask the minimum number of questions needed for a useful architecture draft and distinguish user evidence from assumptions.',
        },
        {
          role: 'user',
          content: buildConversationPrompt({ userMessage, facts, messages, abstractionLevel }),
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `AI request failed (${response.status}).`);
  }
  const content = extractAIText(await response.json());
  if (!content) throw new Error('The selected AI model returned an empty response.');
  return parseConversationalWizardTurn(content);
}

export function getConversationalAvatarState({
  isGenerating = false,
  isSpeaking = false,
  isThinking = false,
  isListening = false,
} = {}) {
  if (isGenerating) return 'generating';
  if (isSpeaking) return 'speaking';
  if (isThinking) return 'thinking';
  if (isListening) return 'listening';
  return 'idle';
}

export function shouldAutomaticallyGenerateConversationalDraft(turn = {}, facts = {}) {
  return Boolean(
    turn?.readiness?.ready &&
    FACT_FIELDS.some(({ key }) => cleanText(facts[key]))
  );
}

const AVATAR_STATE_LABELS = {
  idle: 'Tap the silhouette to speak',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  generating: 'Creating the functional decomposition…',
};

function HeadSilhouette({ state, speechBurst }) {
  const speaking = state === 'speaking';
  const energy = typeof speechBurst === 'number'
    ? Math.max(0, Math.min(1, speechBurst))
    : speechBurst ? 0.7 : 0;
  const visualEnergy = speaking ? energy : 0;
  return (
    <div className="relative flex h-[min(48vh,390px)] w-[min(78vw,390px)] items-center justify-center" aria-hidden="true">
      {!speaking && (
        <div className="pointer-events-none absolute -inset-[5%] overflow-visible opacity-100 saturate-150">
          <div className="xhandle-avatar-fog xhandle-avatar-fog-one absolute left-[10%] top-[12%] h-[50%] w-[62%] rounded-full bg-blue-400/40 blur-[42px]" />
          <div className="xhandle-avatar-fog xhandle-avatar-fog-two absolute bottom-[9%] right-[6%] h-[54%] w-[65%] rounded-full bg-indigo-500/35 blur-[46px]" />
          <div className="xhandle-avatar-fog xhandle-avatar-fog-three absolute left-[19%] top-[22%] h-[61%] w-[58%] rounded-full bg-blue-600/30 blur-[50px]" />
        </div>
      )}
      <div
        className="absolute inset-[2%] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,.42)_0%,rgba(79,70,229,.26)_38%,transparent_72%)] blur-[34px] transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none"
        style={{
          opacity: 0.64 + (visualEnergy * 0.32),
          transform: `scale(${1 + (visualEnergy * 0.08)})`,
        }}
      />
      <div
        className="absolute left-[8%] top-[20%] h-[54%] w-[54%] rounded-full bg-blue-500/25 blur-[46px] transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none"
        style={{
          opacity: 0.46 + (visualEnergy * 0.34),
          transform: `translate3d(${visualEnergy * -8}px, ${visualEnergy * 4}px, 0) scale(${1.02 + (visualEnergy * 0.12)})`,
        }}
      />
      <div
        className="absolute bottom-[14%] right-[5%] h-[48%] w-[58%] rounded-full bg-indigo-500/25 blur-[52px] transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none"
        style={{
          opacity: 0.42 + (visualEnergy * 0.3),
          transform: `translate3d(${visualEnergy * 9}px, ${visualEnergy * -5}px, 0) scale(${1 + (visualEnergy * 0.14)})`,
        }}
      />
      <svg
        viewBox="0 0 320 360"
        className="relative h-[82%] w-[82%] transition-[transform,filter,opacity] duration-300 ease-out motion-reduce:transform-none motion-reduce:transition-none"
        style={{
          transform: `scale(${1.05 + (visualEnergy * 0.026)})`,
          filter: `drop-shadow(0 0 ${28 + (visualEnergy * 34)}px rgba(37, 99, 235, ${0.42 + (visualEnergy * 0.3)})) drop-shadow(0 18px 28px rgba(49, 46, 129, 0.24))`,
          opacity: 1,
        }}
      >
        <defs>
          <radialGradient id="xhandle-mask-surface" cx="38%" cy="27%" r="82%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="36%" stopColor="#eff6ff" />
            <stop offset="68%" stopColor="#93c5fd" />
            <stop offset="88%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#4f46e5" />
          </radialGradient>
          <filter id="xhandle-mask-fog" x="-35%" y="-30%" width="170%" height="165%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <ellipse
          cx="160"
          cy="180"
          rx="99"
          ry="155"
          fill="#3b82f6"
          opacity={0.16 + (visualEnergy * 0.24)}
          filter="url(#xhandle-mask-fog)"
        />
        <ellipse
          cx="160"
          cy="180"
          rx="91"
          ry="149"
          fill="url(#xhandle-mask-surface)"
          opacity={0.9 + (visualEnergy * 0.1)}
          stroke="#2563eb"
          strokeOpacity=".76"
          strokeWidth="2.2"
        />
      </svg>
    </div>
  );
}

export default function ConversationalWizard({ onSubmit, onSkip }) {
  const [facts, setFacts] = useState({});
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [interim, setInterim] = useState('');
  const [abstractionLevel, setAbstractionLevel] = useState(DEFAULT_FUNCTIONAL_ABSTRACTION_LEVEL);
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [selectedReplies, setSelectedReplies] = useState([]);
  const [assumptions, setAssumptions] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [lastFailedInput, setLastFailedInput] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [caption, setCaption] = useState(INITIAL_MESSAGE.content);
  const abortRef = useRef(null);
  const submitTurnRef = useRef(null);
  const voiceSessionRef = useRef('idle');
  const realtimeFactsRef = useRef({});
  const realtimeReadyPayloadRef = useRef(null);
  const startGenerationRef = useRef(null);

  const handleRealtimeBrief = useCallback((brief) => {
    const nextAssumptions = brief.assumptions || [];
    const nextFacts = mergeConversationalWizardFacts(realtimeFactsRef.current, brief.updates);
    const ready = Boolean(brief.ready && getConversationalWizardReadiness(nextFacts).coreReady);
    realtimeFactsRef.current = nextFacts;
    setAssumptions(nextAssumptions);
    setFacts(nextFacts);
    if (ready) {
      realtimeReadyPayloadRef.current = { facts: nextFacts, assumptions: nextAssumptions };
    }
    return { ready };
  }, []);

  const {
    supported: realtimeSupported,
    isConnecting: realtimeIsConnecting,
    isConnected: realtimeIsConnected,
    isListening: realtimeIsListening,
    isSpeaking: realtimeIsSpeaking,
    isThinking: realtimeIsThinking,
    speechBurst: realtimeSpeechBurst,
    error: realtimeError,
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    interruptAndListen: interruptRealtimeAndListen,
    sendText: sendRealtimeText,
    setMicrophoneMuted: setRealtimeMicrophoneMuted,
  } = useRealtimeVoice({
    audioEnabled,
    onUserTranscriptDelta: setInterim,
    onUserTranscript: (text) => {
      setInterim('');
      setInput('');
      setCaption(text);
      setMessages((previous) => [...previous, { role: 'user', content: text }]);
    },
    onAssistantTranscriptDelta: setCaption,
    onAssistantTranscript: (text) => {
      setCaption(text);
      setMessages((previous) => [...previous, { role: 'assistant', content: text }]);
    },
    onBrief: handleRealtimeBrief,
    onReady: () => {
      const payload = realtimeReadyPayloadRef.current;
      realtimeReadyPayloadRef.current = null;
      if (payload) startGenerationRef.current?.(payload.facts, '', payload.assumptions, { skipAnnouncement: true });
    },
  });

  const {
    supported: fallbackSpeechSupported,
    speakingSupported: fallbackSpeakingSupported,
    isListening: fallbackIsListening,
    isSpeaking: fallbackIsSpeaking,
    speechBurst: fallbackSpeechBurst,
    error: fallbackSpeechError,
    voiceMode: fallbackVoiceMode,
    voiceNotice: fallbackVoiceNotice,
    startListening: startFallbackListening,
    stopListening: stopFallbackListening,
    speak: speakWithFallback,
    stopSpeaking: stopFallbackSpeaking,
  } = useSpeech({
    onInterim: setInterim,
    onFinal: (text) => {
      setInput('');
      setInterim('');
      submitTurnRef.current?.(text);
    },
  });

  const realtimeActive = realtimeIsConnecting || realtimeIsConnected;
  const speechSupported = realtimeSupported || fallbackSpeechSupported;
  const isListening = realtimeActive ? realtimeIsListening : fallbackIsListening;
  const isSpeaking = realtimeActive ? realtimeIsSpeaking : fallbackIsSpeaking;
  const speechBurst = realtimeActive ? realtimeSpeechBurst : fallbackSpeechBurst;
  const combinedIsThinking = isThinking || realtimeIsConnecting || realtimeIsThinking;
  const speechError = realtimeIsConnected ? realtimeError : fallbackSpeechError;
  const voiceMode = realtimeIsConnected ? 'realtime' : fallbackVoiceMode;
  const voiceNotice = voiceSessionRef.current === 'fallback' && realtimeError
    ? `Realtime voice was unavailable; ${fallbackVoiceNotice || 'using the compatible voice fallback.'}`
    : fallbackVoiceNotice;

  const startListening = useCallback(async () => {
    if (realtimeIsConnected) {
      setRealtimeMicrophoneMuted(false);
      return;
    }
    await startFallbackListening();
  }, [realtimeIsConnected, setRealtimeMicrophoneMuted, startFallbackListening]);

  const stopListening = useCallback(() => {
    if (realtimeIsConnected) setRealtimeMicrophoneMuted(true);
    else stopFallbackListening();
  }, [realtimeIsConnected, setRealtimeMicrophoneMuted, stopFallbackListening]);

  const stopSpeaking = useCallback(() => {
    if (realtimeIsConnected) interruptRealtimeAndListen();
    stopFallbackSpeaking();
  }, [interruptRealtimeAndListen, realtimeIsConnected, stopFallbackSpeaking]);

  const hasDraftContext = FACT_FIELDS.some(({ key }) => cleanText(facts[key]));
  const avatarState = getConversationalAvatarState({
    isGenerating,
    isSpeaking,
    isThinking: combinedIsThinking,
    isListening,
  });
  const abstraction = getFunctionalAbstractionLevelOption(abstractionLevel);

  useEffect(() => () => {
    abortRef.current?.abort();
    disconnectRealtime();
    stopFallbackListening();
    stopFallbackSpeaking();
  }, [disconnectRealtime, stopFallbackListening, stopFallbackSpeaking]);

  const appendMessage = useCallback((role, content) => {
    setMessages((previous) => [...previous, { role, content }]);
  }, []);

  const announce = useCallback(async (text) => {
    setCaption(text);
    if (audioEnabled && fallbackSpeakingSupported) await speakWithFallback(text);
  }, [audioEnabled, fallbackSpeakingSupported, speakWithFallback]);

  const startGeneration = useCallback(async (
    nextFacts,
    announcement,
    nextAssumptions = assumptions,
    { skipAnnouncement = false } = {},
  ) => {
    setPendingQuestion(null);
    setSelectedReplies([]);
    setError('');
    if (!skipAnnouncement) {
      await announce(announcement || 'I have enough context. I’ll create the functional decomposition now.');
    }
    disconnectRealtime();
    stopFallbackListening();
    setIsGenerating(true);
    try {
      await onSubmit?.(buildConversationalWizardPayload({
        facts: nextFacts,
        abstractionLevel,
        assumptions: nextAssumptions,
      }));
    } catch (generationError) {
      setError(generationError?.message || 'Unable to start functional decomposition generation.');
      setCaption('I could not start generation. You can retry when you are ready.');
      setIsGenerating(false);
    }
  }, [
    abstractionLevel,
    announce,
    assumptions,
    onSubmit,
    disconnectRealtime,
    stopFallbackListening,
  ]);

  startGenerationRef.current = startGeneration;

  const submitTurn = useCallback(async (value) => {
    const cleaned = cleanText(value);
    if (!cleaned || combinedIsThinking || isGenerating || isSpeaking) return;

    const nextUserMessage = { role: 'user', content: cleaned };
    const conversationForRequest = [...messages, nextUserMessage];
    appendMessage('user', cleaned);
    setCaption(cleaned);
    setInput('');
    setInterim('');
    setSelectedReplies([]);
    setPendingQuestion(null);
    setError('');
    setLastFailedInput('');
    stopListening();
    stopSpeaking();

    if (isConversationalGenerateIntent(cleaned) && hasDraftContext) {
      appendMessage('assistant', 'I have enough context. I’ll create the functional decomposition now.');
      await startGeneration(facts, 'I have enough context. I’ll create the functional decomposition now.');
      return;
    }

    setIsThinking(true);
    setCaption('I’m considering what matters most for the architecture.');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const rawTurn = await requestConversationTurn({
        userMessage: cleaned,
        facts,
        messages: conversationForRequest,
        abstractionLevel,
        signal: controller.signal,
      });
      const turn = personalizeConversationalWizardTurn(rawTurn, facts);
      const nextFacts = mergeConversationalWizardFacts(facts, turn.updates);
      const responseText = [turn.message, turn.question?.text].filter(Boolean).join(' ');
      setFacts(nextFacts);
      setAssumptions(turn.assumptions);
      setMessages((previous) => [...previous, { role: 'assistant', content: responseText }]);

      if (shouldAutomaticallyGenerateConversationalDraft(turn, nextFacts)) {
        const readyAnnouncement = [responseText, 'I have enough context. I’ll create the functional decomposition now.']
          .filter(Boolean)
          .join(' ');
        await startGeneration(nextFacts, readyAnnouncement, turn.assumptions);
        return;
      }

      setPendingQuestion(turn.question);
      await announce(responseText || 'Tell me a little more about the system.');
      if (voiceSessionRef.current === 'fallback' && speechSupported && !controller.signal.aborted) {
        await startListening();
      }
    } catch (turnError) {
      if (turnError?.name !== 'AbortError') {
        setError(turnError?.message || 'The selected AI provider could not continue the conversation.');
        setLastFailedInput(cleaned);
        setCaption('I lost the thread for a moment. Please try that again.');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsThinking(false);
    }
  }, [
    abstractionLevel,
    announce,
    appendMessage,
    facts,
    hasDraftContext,
    isGenerating,
    isSpeaking,
    combinedIsThinking,
    messages,
    speechSupported,
    startGeneration,
    startListening,
    stopListening,
    stopSpeaking,
  ]);

  submitTurnRef.current = submitTurn;

  const startVoiceSession = useCallback(async () => {
    setSessionStarted(true);
    setError('');
    realtimeReadyPayloadRef.current = null;
    if (realtimeSupported) {
      try {
        await connectRealtime({ abstractionLabel: abstraction.label });
        voiceSessionRef.current = 'realtime';
        return;
      } catch {
        // Continue below with the existing compatible browser/TTS path.
      }
    }
    voiceSessionRef.current = 'fallback';
    await announce(INITIAL_MESSAGE.content);
    if (fallbackSpeechSupported) await startFallbackListening();
    else setShowKeyboard(true);
  }, [
    abstraction.label,
    announce,
    fallbackSpeechSupported,
    connectRealtime,
    realtimeSupported,
    startFallbackListening,
  ]);

  const handleAvatarClick = async () => {
    if (isGenerating) return;
    if (!sessionStarted) {
      await startVoiceSession();
      return;
    }
    if (isSpeaking) {
      stopSpeaking();
      if (speechSupported) await startListening();
      return;
    }
    if (isListening) {
      stopListening();
      return;
    }
    if (realtimeIsConnected) {
      setRealtimeMicrophoneMuted(false);
      return;
    }
    voiceSessionRef.current = 'fallback';
    if (speechSupported) await startListening();
    else setShowKeyboard(true);
  };

  const resetConversation = () => {
    abortRef.current?.abort();
    disconnectRealtime();
    stopFallbackListening();
    stopFallbackSpeaking();
    voiceSessionRef.current = 'idle';
    realtimeFactsRef.current = {};
    realtimeReadyPayloadRef.current = null;
    setFacts({});
    setMessages([INITIAL_MESSAGE]);
    setInput('');
    setInterim('');
    setPendingQuestion(null);
    setSelectedReplies([]);
    setAssumptions([]);
    setError('');
    setLastFailedInput('');
    setIsThinking(false);
    setIsGenerating(false);
    setSessionStarted(false);
    setCaption(INITIAL_MESSAGE.content);
  };

  const submitUserInput = useCallback((value) => {
    const cleaned = cleanText(value);
    if (!cleaned) return;
    if (realtimeIsConnected) {
      setInput('');
      setInterim('');
      setSelectedReplies([]);
      setPendingQuestion(null);
      setError('');
      setCaption(cleaned);
      appendMessage('user', cleaned);
      sendRealtimeText(cleaned);
      return;
    }
    submitTurn(cleaned);
  }, [appendMessage, realtimeIsConnected, sendRealtimeText, submitTurn]);

  const handleQuickReply = (option) => {
    if (pendingQuestion?.type === 'multi') {
      setSelectedReplies((previous) => (
        previous.includes(option)
          ? previous.filter((item) => item !== option)
          : [...previous, option]
      ));
      return;
    }
    submitUserInput(option);
  };

  return (
    <div className="mx-auto w-full max-w-5xl text-left">
      <section
        className="relative flex min-h-[min(720px,calc(100vh-260px))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_50%_35%,#eff6ff_0%,#f8fafc_42%,#ffffff_78%)] shadow-sm"
        aria-label="Voice architecture conversation"
      >
        <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-between gap-3">
          <label className="rounded-full border border-white/80 bg-white/75 px-3 py-1.5 text-xs text-slate-600 shadow-sm backdrop-blur">
            <span className="sr-only">Functional decomposition abstraction level</span>
            <select
              value={abstractionLevel}
              onChange={(event) => setAbstractionLevel(event.target.value)}
              disabled={combinedIsThinking || isGenerating || sessionStarted}
              className="bg-transparent font-medium text-slate-700 outline-none"
              aria-label="Functional decomposition abstraction level"
            >
              {FUNCTIONAL_ABSTRACTION_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1 rounded-full border border-white/80 bg-white/75 p-1 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => {
                setAudioEnabled((enabled) => !enabled);
                if (audioEnabled && !realtimeIsConnected) stopSpeaking();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
              aria-label={audioEnabled ? 'Mute spoken replies' : 'Enable spoken replies'}
              title={audioEnabled ? 'Mute spoken replies' : 'Enable spoken replies'}
            >
              {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setShowKeyboard((visible) => !visible)}
              className={"inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 " + (showKeyboard ? 'bg-blue-50 text-blue-600' : '')}
              aria-label={showKeyboard ? 'Hide keyboard input' : 'Show keyboard input'}
              title={showKeyboard ? 'Hide keyboard input' : 'Show keyboard input'}
            >
              <Keyboard size={16} />
            </button>
            <button type="button" onClick={resetConversation} disabled={isGenerating} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40" aria-label="Start conversation over" title="Start over">
              <RotateCcw size={16} />
            </button>
            <button type="button" onClick={() => onSkip?.()} disabled={isGenerating} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40" aria-label="Cancel conversation" title="Cancel">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-5 pb-6 pt-20 text-center">
          <button
            type="button"
            onClick={handleAvatarClick}
            disabled={combinedIsThinking || isGenerating}
            className="group rounded-full outline-none focus-visible:ring-4 focus-visible:ring-blue-300/60 disabled:cursor-default"
            aria-label={
              !sessionStarted
                ? 'Start voice conversation'
                : isListening
                  ? 'Stop listening'
                  : isSpeaking
                    ? 'Interrupt and speak'
                    : 'Start speaking'
            }
          >
            <HeadSilhouette state={avatarState} speechBurst={speechBurst} />
          </button>

          <div className="mt-1 flex min-h-7 items-center justify-center gap-2 text-sm font-semibold tracking-wide text-slate-700">
            {(avatarState === 'thinking' || avatarState === 'generating') && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {avatarState === 'listening' && <Mic size={16} className="text-blue-600" aria-hidden="true" />}
            {avatarState === 'speaking' && <Volume2 size={16} className="text-blue-600" aria-hidden="true" />}
            <span>{sessionStarted ? AVATAR_STATE_LABELS[avatarState] : 'Start conversation'}</span>
          </div>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600" aria-live="polite">
            {interim || caption}
          </p>

          {!sessionStarted && (
            <button type="button" onClick={startVoiceSession} className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-300 hover:bg-slate-800">
              <Mic size={16} aria-hidden="true" />
              Begin
            </button>
          )}

          {!combinedIsThinking && !isSpeaking && pendingQuestion?.options?.length > 0 && (
            <div className="mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
              {pendingQuestion.options.map((option) => {
                const selected = selectedReplies.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleQuickReply(option)}
                    className={"rounded-full border px-3 py-1.5 text-xs font-medium transition " + (selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white/85 text-slate-700 hover:border-blue-400')}
                  >
                    {option}
                  </button>
                );
              })}
              {pendingQuestion.type === 'multi' && selectedReplies.length > 0 && (
                <button type="button" onClick={() => submitUserInput(selectedReplies.join('; '))} className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
                  Continue
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50/90 px-4 py-2 text-sm text-red-700" role="alert">
              {error}
              {lastFailedInput && <button type="button" onClick={() => submitTurn(lastFailedInput)} className="ml-2 font-semibold underline">Retry</button>}
            </div>
          )}
          {speechError && <div className="mt-3 text-xs text-amber-700">{speechError}</div>}
          {voiceNotice && sessionStarted && (
            <div className="mt-3 text-xs text-amber-700" role="status">{voiceNotice}</div>
          )}
        </div>

        {showKeyboard && (
          <div className="border-t border-slate-200/80 bg-white/80 p-4 backdrop-blur">
            <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
              <textarea
                value={interim ? input + (input ? ' ' : '') + interim : input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setInterim('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitUserInput(input || interim);
                  }
                }}
                rows={2}
                disabled={combinedIsThinking || isGenerating || isSpeaking}
                placeholder="Type a response or correction…"
                className="min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => submitUserInput(input || interim)}
                disabled={!cleanText(input || interim) || combinedIsThinking || isGenerating || isSpeaking}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
                aria-label="Send message"
              >
                <Send size={17} />
              </button>
            </div>
          </div>
        )}

        <div className="sr-only" aria-live="assertive">
          {AVATAR_STATE_LABELS[avatarState]}. {caption}
        </div>
        <div className="absolute bottom-3 left-4 text-[11px] text-slate-400">
          {abstraction.label} · {!sessionStarted || voiceMode === 'realtime'
            ? 'OpenAI Realtime voice (AI-generated)'
            : voiceMode === 'natural'
              ? 'OpenAI natural voice fallback (AI-generated)'
              : 'device voice fallback'}
        </div>
        {sessionStarted && !isListening && !combinedIsThinking && !isSpeaking && !isGenerating && (
          <button type="button" onClick={handleAvatarClick} className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-600">
            {speechSupported ? <Mic size={13} /> : <Keyboard size={13} />}
            {speechSupported ? 'Tap to speak' : 'Type a response'}
          </button>
        )}
      </section>
    </div>
  );
}
