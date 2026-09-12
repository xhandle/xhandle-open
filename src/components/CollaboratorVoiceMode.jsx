import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { backendURL, buildAIAuthOpts } from './backendConfig';
import { HeadSilhouette, primeNaturalSpeechPlayback, useSpeech } from './ConversationalWizard';

export { primeNaturalSpeechPlayback };

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function stripCollaboratorMarkdownForSpeech(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' The full code or table is available in the Collaborator thread. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[|*_~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCollaboratorSpokenResponse(message = {}) {
  const content = stripCollaboratorMarkdownForSpeech(message?.content || '');
  if (!content) return 'I completed that request. You can review the result in the Collaborator thread.';
  const source = String(message?.content || '');
  const containsLargeArtifact = source.includes('|') || source.includes('```') || content.length > 1200;
  if (!containsLargeArtifact) return content.slice(0, 1800);

  const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
  const summary = sentences.slice(0, 3).join(' ').trim() || content.slice(0, 650).trim();
  return `${summary} The full result is available in the Collaborator thread.`.slice(0, 1800);
}

export function getCollaboratorVoiceState({ isConnecting, isProcessing, isSpeaking, isListening } = {}) {
  if (isSpeaking) return 'speaking';
  if (isProcessing) return 'thinking';
  if (isConnecting) return 'thinking';
  if (isListening) return 'listening';
  return 'idle';
}

function useCollaboratorRealtimeTranscription({ active, disabled, onTranscript }) {
  const callbackRef = useRef(onTranscript);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const transcriptRef = useRef('');
  const mutedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [inputMuted, setInputMutedState] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState('');

  const supported = Boolean(
    typeof window !== 'undefined'
    && window.RTCPeerConnection
    && navigator.mediaDevices?.getUserMedia
  );

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    disabledRef.current = Boolean(disabled);
  }, [disabled]);

  const applyMicrophoneState = useCallback(() => {
    const enabled = Boolean(active && isConnected && !disabled && !mutedRef.current);
    microphoneStreamRef.current?.getAudioTracks?.().forEach((track) => {
      track.enabled = enabled;
    });
    setIsListening(enabled);
  }, [active, disabled, isConnected]);

  const disconnect = useCallback(() => {
    try { dataChannelRef.current?.close(); } catch {}
    dataChannelRef.current = null;
    try { peerConnectionRef.current?.close(); } catch {}
    peerConnectionRef.current = null;
    microphoneStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    transcriptRef.current = '';
    setInterimTranscript('');
    setIsConnecting(false);
    setIsConnected(false);
    setIsListening(false);
  }, []);

  const setInputMuted = useCallback((muted) => {
    mutedRef.current = Boolean(muted);
    setInputMutedState(Boolean(muted));
    microphoneStreamRef.current?.getAudioTracks?.().forEach((track) => {
      track.enabled = Boolean(active && isConnected && !disabled && !muted);
    });
    setIsListening(Boolean(active && isConnected && !disabled && !muted));
  }, [active, disabled, isConnected]);

  useEffect(() => {
    applyMicrophoneState();
  }, [applyMicrophoneState]);

  useEffect(() => {
    if (!active || !supported) return undefined;
    let cancelled = false;

    const handleServerEvent = (event) => {
      switch (event?.type) {
        case 'session.created':
        case 'session.updated':
          setError('');
          break;
        case 'input_audio_buffer.speech_started':
          transcriptRef.current = '';
          setInterimTranscript('');
          break;
        case 'conversation.item.input_audio_transcription.delta':
          transcriptRef.current += event.delta || '';
          setInterimTranscript(transcriptRef.current);
          break;
        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = cleanText(event.transcript || transcriptRef.current);
          transcriptRef.current = '';
          setInterimTranscript('');
          if (transcript && !disabledRef.current && !mutedRef.current) callbackRef.current?.(transcript);
          break;
        }
        case 'error':
          setError(event.error?.message || 'The Realtime voice session encountered an error.');
          break;
        default:
          break;
      }
    };

    const connect = async () => {
      setError('');
      setIsConnecting(true);
      try {
        const microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
          },
        });
        if (cancelled) {
          microphoneStream.getTracks().forEach((track) => track.stop());
          return;
        }
        microphoneStreamRef.current = microphoneStream;

        const tokenResponse = await fetch(`${backendURL}/api/rt/session`, {
          method: 'POST',
          ...buildAIAuthOpts({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ mode: 'collaborator' }),
        });
        const tokenPayload = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokenPayload?.value) {
          throw new Error(cleanText(tokenPayload?.error?.message || tokenPayload?.error) || `Realtime session failed (${tokenResponse.status}).`);
        }

        const peerConnection = new window.RTCPeerConnection();
        peerConnectionRef.current = peerConnection;
        microphoneStream.getTracks().forEach((track) => peerConnection.addTrack(track, microphoneStream));
        peerConnection.onconnectionstatechange = () => {
          if (!['failed', 'disconnected'].includes(peerConnection.connectionState)) return;
          setError('The Realtime voice connection was interrupted.');
          setIsConnected(false);
          setIsListening(false);
        };

        const dataChannel = peerConnection.createDataChannel('oai-events');
        dataChannelRef.current = dataChannel;
        dataChannel.addEventListener('message', (messageEvent) => {
          try { handleServerEvent(JSON.parse(messageEvent.data)); } catch {}
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
          if (dataChannel.readyState === 'open') return resolve();
          const timeout = setTimeout(() => reject(new Error('Realtime voice connection timed out.')), 12000);
          dataChannel.addEventListener('open', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
        if (cancelled) return;
        setIsConnecting(false);
        setIsConnected(true);
      } catch (connectionError) {
        if (cancelled) return;
        disconnect();
        setError(connectionError?.message || 'Unable to start Realtime voice.');
      }
    };

    connect();
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [active, disconnect, supported]);

  return {
    supported,
    isConnecting,
    isConnected,
    isListening,
    inputMuted,
    interimTranscript,
    error,
    setInputMuted,
  };
}

export default function CollaboratorVoiceMode({
  active,
  busy = false,
  docked = false,
  greeting = 'Hi. What would you like to think through together?',
  onClose,
  onSubmitTranscript,
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [caption, setCaption] = useState(greeting);
  const [lastUserTranscript, setLastUserTranscript] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const greetedRef = useRef(false);
  const {
    isSpeaking,
    speechBurst,
    error: speechError,
    voiceNotice,
    speak,
    stopSpeaking,
  } = useSpeech({ allowDeviceFallback: false });

  const handleTranscript = useCallback(async (transcript) => {
    const cleaned = cleanText(transcript);
    if (!cleaned || isProcessing || busy || isSpeaking) return;
    setLastUserTranscript(cleaned);
    setCaption(cleaned);
    setIsProcessing(true);
    try {
      const response = await onSubmitTranscript?.(cleaned);
      const spokenResponse = cleanText(response) || 'I completed that request. You can review the result in the Collaborator thread.';
      setCaption(spokenResponse);
      if (audioEnabled) await speak(spokenResponse);
    } catch (submissionError) {
      setCaption(submissionError?.message || 'I could not complete that request.');
    } finally {
      window.setTimeout(() => setIsProcessing(false), 550);
    }
  }, [audioEnabled, busy, isProcessing, isSpeaking, onSubmitTranscript, speak]);

  const realtime = useCollaboratorRealtimeTranscription({
    active,
    disabled: busy || isProcessing || isSpeaking,
    onTranscript: handleTranscript,
  });

  useEffect(() => {
    if (!active) greetedRef.current = false;
  }, [active]);

  useEffect(() => {
    if (!active || !realtime.isConnected || greetedRef.current) return undefined;
    greetedRef.current = true;
    setCaption(greeting);
    setIsProcessing(true);
    let cancelled = false;
    speak(greeting).finally(() => {
      window.setTimeout(() => {
        if (!cancelled) setIsProcessing(false);
      }, 550);
    });
    return () => {
      cancelled = true;
    };
  }, [active, greeting, realtime.isConnected, speak]);

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  const state = getCollaboratorVoiceState({
    isConnecting: realtime.isConnecting,
    isProcessing: busy || isProcessing,
    isSpeaking,
    isListening: realtime.isListening,
  });
  const stateLabel = useMemo(() => {
    if (realtime.isConnecting) return 'Connecting to ChatGPT voice…';
    if (isSpeaking) return 'Collaborator is speaking…';
    if (busy || isProcessing) return 'Collaborator is working…';
    if (realtime.inputMuted) return 'Microphone muted';
    if (realtime.isListening) return 'Listening…';
    return 'Voice conversation ready';
  }, [busy, isProcessing, isSpeaking, realtime.inputMuted, realtime.isConnecting, realtime.isListening]);
  const visibleCaption = realtime.interimTranscript || caption;

  return (
    <section
      className="absolute inset-0 z-[60] flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_38%,rgba(219,234,254,.9),rgba(255,255,255,.98)_58%,rgba(238,242,255,.96))]"
      aria-label="Collaborator voice conversation"
    >
      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/70 bg-white/70 px-4 py-3 backdrop-blur-xl">
        <div>
          <div className="text-sm font-semibold text-neutral-900">Conversation with Collaborator</div>
          <div className="text-xs text-neutral-500">Natural OpenAI voice · your xHandle design and work partner</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-neutral-700 shadow-sm hover:bg-white"
          aria-label="Return to text Collaborator"
          title="Return to text Collaborator"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto px-5 py-4 text-center">
        <button
          type="button"
          onClick={() => realtime.setInputMuted(!realtime.inputMuted)}
          disabled={!realtime.isConnected || busy || isProcessing || isSpeaking}
          className="group relative flex items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-wait"
          aria-label={realtime.inputMuted ? 'Unmute voice conversation' : 'Mute voice conversation'}
          title={realtime.inputMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <HeadSilhouette
            state={state}
            speechBurst={speechBurst}
            className={docked ? 'h-[min(44vh,310px)] w-[min(88vw,310px)]' : 'h-[min(52vh,430px)] w-[min(70vw,430px)]'}
          />
          <span className="absolute bottom-[7%] right-[9%] inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/85 text-indigo-700 shadow-lg backdrop-blur-md">
            {realtime.inputMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </span>
        </button>

        <div className="relative z-10 mt-1 max-w-2xl">
          <div className="text-sm font-semibold text-indigo-800">{stateLabel}</div>
          <p className="mt-2 max-h-28 overflow-auto text-sm leading-6 text-neutral-700" aria-live="polite">
            {visibleCaption}
          </p>
          {lastUserTranscript && visibleCaption !== lastUserTranscript && (
            <p className="mt-2 text-xs text-neutral-400">You said: “{lastUserTranscript}”</p>
          )}
          {(realtime.error || speechError) && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {realtime.error || speechError}
            </p>
          )}
          {!realtime.supported && (
            <p className="mt-2 text-xs text-amber-700">Realtime voice requires a browser with microphone and WebRTC support.</p>
          )}
          {voiceNotice && <p className="mt-2 text-xs text-amber-700">{voiceNotice}</p>}
          <p className="mt-3 text-[11px] leading-4 text-neutral-400">
            Talk naturally—brainstorm, challenge an assumption, explore a tradeoff, or ask Collaborator to work in the active project.
          </p>
        </div>
      </div>

      <footer className="relative z-10 flex shrink-0 items-center justify-center gap-2 border-t border-white/70 bg-white/70 px-4 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => realtime.setInputMuted(!realtime.inputMuted)}
          disabled={!realtime.isConnected || busy || isProcessing || isSpeaking}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {realtime.inputMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {realtime.inputMuted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (isSpeaking) stopSpeaking();
            else if (!audioEnabled) primeNaturalSpeechPlayback();
            setAudioEnabled((current) => !current);
          }}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
          aria-label={audioEnabled ? 'Mute spoken Collaborator replies' : 'Enable spoken Collaborator replies'}
        >
          {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          {audioEnabled ? 'OpenAI voice on' : 'Voice off'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
        >
          <Keyboard className="h-4 w-4" />
          Type instead
        </button>
      </footer>
    </section>
  );
}
