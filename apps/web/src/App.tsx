import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

const ORCHESTRATOR_BASE_URL = import.meta.env.VITE_ORCHESTRATOR_BASE_URL as string;
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const PRICE_INPUT_USD_PER_1M = Number.parseFloat(import.meta.env.VITE_PRICE_INPUT_USD_PER_1M ?? '0');
const PRICE_OUTPUT_USD_PER_1M = Number.parseFloat(import.meta.env.VITE_PRICE_OUTPUT_USD_PER_1M ?? '0');
const EUR_PER_USD = Number.parseFloat(import.meta.env.VITE_EUR_PER_USD ?? '1');

type Status = 'idle' | 'listening' | 'thinking' | 'speaking';

type EventLogItem = { ts: number; message: string };
type TranscriptItem = { ts: number; text: string };
type UsageSnapshot = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

type ToolCallBuffer = {
  name: string;
  argsText: string;
};

const EMPTY_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTextTokens: 0,
  outputTextTokens: 0,
  inputAudioTokens: 0,
  outputAudioTokens: 0,
};

function useEventLog() {
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const push = useCallback((message: string) => {
    setEvents((prev) => [...prev.slice(-200), { ts: Date.now(), message }]);
  }, []);
  return { events, push };
}

async function fetchToken(sharedSecret: string, enableTranscription: boolean) {
  const headers: Record<string, string> = { 'x-shared-secret': sharedSecret };
  const response = await axios.post(
    `${ORCHESTRATOR_BASE_URL}/api/realtime/token`,
    { enableTranscription },
    { headers },
  );
  return response.data;
}

async function exchangeOfferForAnswer(offerSdp: string, clientSecret: string, sharedSecret: string) {
  const headers: Record<string, string> = { 'x-shared-secret': sharedSecret };
  const response = await axios.post(
    `${ORCHESTRATOR_BASE_URL}/api/realtime/webrtc`,
    { offerSdp, clientSecret },
    { headers },
  );
  return response.data as { answerSdp: string };
}

export default function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [pushToTalk, setPushToTalk] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sharedSecret, setSharedSecret] = useState<string>(() => localStorage.getItem('sharedSecret') || '');
  const [enableTranscription, setEnableTranscription] = useState<boolean>(
    () => localStorage.getItem('enableTranscription') !== 'false',
  );
  const [userDraft, setUserDraft] = useState('');
  const [assistantDraft, setAssistantDraft] = useState('');
  const [userTranscripts, setUserTranscripts] = useState<TranscriptItem[]>([]);
  const [assistantTranscripts, setAssistantTranscripts] = useState<TranscriptItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [usage, setUsage] = useState(() => ({ ...EMPTY_USAGE }));
  const [audioEnhancements, setAudioEnhancements] = useState({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [loadingDevices, setLoadingDevices] = useState(false);
  const userDraftRef = useRef('');
  const assistantDraftRef = useRef('');
  const sessionUpdateSentRef = useRef(false);
  const lastAppliedAudioSettingsRef = useRef(JSON.stringify(audioEnhancements));
  const { events, push } = useEventLog();
  const rtcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const audioTrackSeenRef = useRef(false);
  const countedUsageRef = useRef<Set<string>>(new Set());
  const toolArgsRef = useRef<Map<string, ToolCallBuffer>>(new Map());
  const toolCallsInFlightRef = useRef<Set<string>>(new Set());
  const toolSessionIdRef = useRef<string>(crypto.randomUUID());
  const tokenFormatter = useMemo(() => new Intl.NumberFormat('fi-FI'), []);
  const eurFormatter = useMemo(
    () =>
      new Intl.NumberFormat('fi-FI', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 4,
      }),
    []
  );

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }, [isMuted]);

  const appendUserDraft = (delta: string) => {
    const next = `${userDraftRef.current}${delta}`;
    userDraftRef.current = next;
    setUserDraft(next);
  };

  const appendAssistantDraft = (delta: string) => {
    const next = `${assistantDraftRef.current}${delta}`;
    assistantDraftRef.current = next;
    setAssistantDraft(next);
  };

  const refreshDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      push('enumerateDevices is unavailable in this browser.');
      return;
    }
    try {
      setLoadingDevices(true);
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAvailableMics(devices.filter((device) => device.kind === 'audioinput'));
    } catch (error) {
      console.error(error);
      push('Failed to list microphones');
    } finally {
      setLoadingDevices(false);
    }
  }, [push]);

  const resetUsage = useCallback(() => {
    setUsage({ ...EMPTY_USAGE });
    countedUsageRef.current.clear();
  }, []);

  const dispatchToolCall = useCallback(
    async (tool: string, args: unknown) => {
      if (!sharedSecret) {
        throw new Error('Shared secret required to dispatch tools');
      }
      const headers: Record<string, string> = {
        'x-shared-secret': sharedSecret,
        'x-request-id': crypto.randomUUID(),
        'x-session-id': toolSessionIdRef.current,
        'x-user-id': 'web-client',
      };
      const response = await axios.post(
        `${ORCHESTRATOR_BASE_URL}/api/tools/dispatch`,
        { tool, args },
        { headers },
      );
      return response.data as { result?: unknown };
    },
    [sharedSecret]
  );

  const sendToolResponse = useCallback((callId: string, output: string) => {
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') {
      push('Data channel not ready for tool response');
      return;
    }
    dc.send(JSON.stringify({ type: 'tool.response', tool_call_id: callId, output }));
  }, [push]);

  const invokeToolCall = useCallback(
    async (name: string, callId: string, argsText: string) => {
      if (toolCallsInFlightRef.current.has(callId)) return;
      toolCallsInFlightRef.current.add(callId);
      let args: unknown = {};
      if (argsText) {
        try {
          args = JSON.parse(argsText);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'invalid_json';
          sendToolResponse(callId, JSON.stringify({ error: 'invalid_tool_args', message }));
          push(`Tool args invalid: ${name}`);
          toolCallsInFlightRef.current.delete(callId);
          return;
        }
      }
      push(`Tool call: ${name}`);
      try {
        const response = await dispatchToolCall(name, args);
        const payload = response?.result ?? response;
        sendToolResponse(callId, JSON.stringify(payload ?? {}));
        push(`Tool result: ${name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'tool_call_failed';
        sendToolResponse(callId, JSON.stringify({ error: 'tool_call_failed', message }));
        push(`Tool failed: ${name}`);
      } finally {
        toolCallsInFlightRef.current.delete(callId);
      }
    },
    [dispatchToolCall, push, sendToolResponse]
  );

  const bufferToolArgs = (callId: string, name: string, delta: string) => {
    const existing = toolArgsRef.current.get(callId);
    const next = {
      name,
      argsText: `${existing?.argsText ?? ''}${delta}`,
    };
    toolArgsRef.current.set(callId, next);
  };

  const flushToolArgs = (callId: string, name?: string, argsText?: string) => {
    const buffered = toolArgsRef.current.get(callId);
    const resolvedName = name ?? buffered?.name ?? 'unknown_tool';
    const resolvedArgs = argsText ?? buffered?.argsText ?? '';
    toolArgsRef.current.delete(callId);
    void invokeToolCall(resolvedName, callId, resolvedArgs);
  };

  useEffect(() => {
    refreshDeviceList();
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => refreshDeviceList();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshDeviceList]);

  const finalizeUserDraft = (text?: string) => {
    const finalText = (text ?? userDraftRef.current).trim();
    if (!finalText) return;
    setUserTranscripts((prev) => [...prev.slice(-19), { ts: Date.now(), text: finalText }]);
    userDraftRef.current = '';
    setUserDraft('');
  };

  const finalizeAssistantDraft = (text?: string) => {
    const finalText = (text ?? assistantDraftRef.current).trim();
    if (!finalText) return;
    setAssistantTranscripts((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].text === finalText) {
        return prev;
      }
      return [...prev.slice(-19), { ts: Date.now(), text: finalText }];
    });
    assistantDraftRef.current = '';
    setAssistantDraft('');
  };

  const buildAudioConstraints = useCallback(
    (deviceId?: string) => ({
      audio: {
        deviceId: deviceId ?? (selectedMicId || undefined),
        echoCancellation: audioEnhancements.echoCancellation,
        noiseSuppression: audioEnhancements.noiseSuppression,
        autoGainControl: audioEnhancements.autoGainControl,
      },
    }),
    [audioEnhancements, selectedMicId]
  );

  const createLocalStream = useCallback(
    async (deviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia is unavailable (requires HTTPS or localhost).');
      }
      const constraints = buildAudioConstraints(deviceId);
      return navigator.mediaDevices.getUserMedia(constraints);
    },
    [buildAudioConstraints]
  );

  const applyNewLocalStream = useCallback(
    async (deviceId?: string) => {
      const rtc = rtcRef.current;
      const media = await createLocalStream(deviceId);
      media.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      if (rtc) {
        const [newTrack] = media.getAudioTracks();
        const audioSender = rtc.getSenders().find((sender) => sender.track?.kind === 'audio');
        if (audioSender && newTrack) {
          await audioSender.replaceTrack(newTrack);
        } else if (newTrack) {
          rtc.addTrack(newTrack, media);
        }
      }
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = media;
    },
    [createLocalStream, isMuted]
  );

  const audioSettingsKey = JSON.stringify(audioEnhancements);

  useEffect(() => {
    if (lastAppliedAudioSettingsRef.current === audioSettingsKey) return;
    if (status === 'idle' || !rtcRef.current) {
      lastAppliedAudioSettingsRef.current = audioSettingsKey;
      return;
    }
    lastAppliedAudioSettingsRef.current = audioSettingsKey;
    let cancelled = false;
    (async () => {
      try {
        await applyNewLocalStream();
        if (!cancelled) {
          push('Applied updated audio settings');
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          push('Failed to apply audio settings');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyNewLocalStream, audioSettingsKey, push, status]);

  const handleMicChange = useCallback(
    async (deviceId: string) => {
      setSelectedMicId(deviceId);
      if (status === 'idle') return;
      try {
        await applyNewLocalStream(deviceId || undefined);
        push('Switched microphone');
      } catch (error) {
        console.error(error);
        push('Failed to switch microphone');
      }
    },
    [applyNewLocalStream, push, status]
  );

  const recordUsage = (payload: { [key: string]: unknown }) => {
    const response = payload.response as { id?: unknown; usage?: UsageSnapshot } | undefined;
    const usageSnapshot = (response?.usage ?? (payload.usage as UsageSnapshot | undefined)) ?? null;
    if (!usageSnapshot || typeof usageSnapshot !== 'object') return;

    const responseId = response?.id ?? payload.response_id ?? payload.id;
    const usageKey = typeof responseId === 'string' ? responseId : null;
    if (usageKey) {
      if (countedUsageRef.current.has(usageKey)) return;
      countedUsageRef.current.add(usageKey);
    }

    const inputTokens = usageSnapshot.input_tokens ?? 0;
    const outputTokens = usageSnapshot.output_tokens ?? 0;
    const totalTokens = usageSnapshot.total_tokens ?? inputTokens + outputTokens;
    const inputTextTokens = usageSnapshot.input_token_details?.text_tokens ?? 0;
    const outputTextTokens = usageSnapshot.output_token_details?.text_tokens ?? 0;
    const inputAudioTokens = usageSnapshot.input_token_details?.audio_tokens ?? 0;
    const outputAudioTokens = usageSnapshot.output_token_details?.audio_tokens ?? 0;

    setUsage((prev) => ({
      inputTokens: prev.inputTokens + inputTokens,
      outputTokens: prev.outputTokens + outputTokens,
      totalTokens: prev.totalTokens + totalTokens,
      inputTextTokens: prev.inputTextTokens + inputTextTokens,
      outputTextTokens: prev.outputTextTokens + outputTextTokens,
      inputAudioTokens: prev.inputAudioTokens + inputAudioTokens,
      outputAudioTokens: prev.outputAudioTokens + outputAudioTokens,
    }));
  };

  const handleRealtimeEvent = (raw: string) => {
    let parsed: { type?: string; [key: string]: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    recordUsage(parsed);

    const callIdFrom = (payload: { [key: string]: unknown }) => {
      const callId = payload.call_id ?? payload.tool_call_id ?? payload.id;
      return typeof callId === 'string' ? callId : null;
    };

    const nameFrom = (payload: { [key: string]: unknown }) => {
      const name = payload.name ?? payload.tool_name;
      return typeof name === 'string' ? name : null;
    };

    if (
      parsed.type === 'response.function_call_arguments.delta' ||
      parsed.type === 'response.tool_call_arguments.delta'
    ) {
      const callId = callIdFrom(parsed);
      const name = nameFrom(parsed);
      const delta = typeof parsed.arguments === 'string' ? parsed.arguments : typeof parsed.delta === 'string' ? parsed.delta : '';
      if (callId && name && delta) {
        bufferToolArgs(callId, name, delta);
      }
      return;
    }

    if (
      parsed.type === 'response.function_call_arguments.done' ||
      parsed.type === 'response.tool_call_arguments.done'
    ) {
      const callId = callIdFrom(parsed);
      const name = nameFrom(parsed);
      const argsText =
        typeof parsed.arguments === 'string'
          ? parsed.arguments
          : parsed.arguments && typeof parsed.arguments === 'object'
            ? JSON.stringify(parsed.arguments)
            : '';
      if (callId) {
        flushToolArgs(callId, name ?? undefined, argsText || undefined);
      }
      return;
    }

    if (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done') {
      const item = parsed.item as { type?: string; name?: string; arguments?: unknown; call_id?: string } | undefined;
      if (item?.type === 'function_call') {
        const callId = typeof item.call_id === 'string' ? item.call_id : null;
        if (callId) {
          const argsText =
            typeof item.arguments === 'string'
              ? item.arguments
              : item.arguments && typeof item.arguments === 'object'
                ? JSON.stringify(item.arguments)
                : undefined;
          flushToolArgs(callId, item.name, argsText);
        }
      }
      return;
    }

    const extractResponseId = (payload: { [key: string]: unknown }) => {
      const response = payload.response as { id?: unknown } | undefined;
      if (response && typeof response.id === 'string') return response.id;
      if (typeof payload.response_id === 'string') return payload.response_id;
      if (typeof payload.id === 'string') return payload.id;
      return null;
    };

    if (parsed.type === 'response.created') {
      const responseId = extractResponseId(parsed);
      setActiveResponseId(responseId);
      push(`Assistant response started${responseId ? ` (${responseId})` : ''}`);
      return;
    }

    if (parsed.type === 'response.completed' || parsed.type === 'response.canceled' || parsed.type === 'response.error') {
      setActiveResponseId(null);
      push('Assistant response finished');
      return;
    }

    if (parsed.type === 'response.audio_transcript.delta' && typeof parsed.delta === 'string') {
      appendAssistantDraft(parsed.delta);
      return;
    }

    if (parsed.type === 'response.audio_transcript.done') {
      const transcript = typeof parsed.transcript === 'string' ? parsed.transcript : undefined;
      finalizeAssistantDraft(transcript);
      return;
    }

    if (parsed.type === 'response.content_part.done') {
      return;
    }

    if (parsed.type === 'input_audio_transcript.delta' && typeof parsed.delta === 'string') {
      appendUserDraft(parsed.delta);
      return;
    }

    if (parsed.type === 'input_audio_transcript.done' || parsed.type === 'input_audio_transcription.completed') {
      const transcript = typeof parsed.transcript === 'string' ? parsed.transcript : undefined;
      finalizeUserDraft(transcript);
      return;
    }

    if (parsed.type === 'conversation.item.input_audio_transcription.delta') {
      const delta = typeof parsed.delta === 'string' ? parsed.delta : undefined;
      if (delta) {
        appendUserDraft(delta);
      }
      return;
    }

    if (parsed.type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = typeof parsed.transcript === 'string' ? parsed.transcript : undefined;
      finalizeUserDraft(transcript);
      return;
    }

    if (parsed.type === 'conversation.item.created') {
      const item = parsed.item as { role?: string; content?: Array<{ type?: string; transcript?: string }> } | undefined;
      if (item?.role === 'user' && Array.isArray(item.content)) {
        const transcript = item.content.find((entry) => entry.type === 'input_audio')?.transcript;
        if (typeof transcript === 'string') {
          finalizeUserDraft(transcript);
        }
      }
    }

    if (parsed.type === 'session.updated') {
      const session = parsed.session as { input_audio_transcription?: { model?: string; language?: string } } | undefined;
      if (session?.input_audio_transcription?.model) {
        push(`Session updated: transcription=${session.input_audio_transcription.model}`);
      }
    }
  };

  const connect = useMemo(
    () =>
      async function startListening() {
        setConnecting(true);
        toolSessionIdRef.current = crypto.randomUUID();
        toolArgsRef.current.clear();
        toolCallsInFlightRef.current.clear();
        resetUsage();
        try {
          if (!sharedSecret) {
            push('Shared secret required to request token');
            return;
          }
          localStorage.setItem('sharedSecret', sharedSecret);
          const token = await fetchToken(sharedSecret, enableTranscription);
          push('Fetched ephemeral token');
          const rtc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          rtcRef.current = rtc;
          const audioElement = audioRef.current;
          if (audioElement) {
            const remoteStream = remoteStreamRef.current ?? new MediaStream();
            remoteStreamRef.current = remoteStream;
            if (audioElement.srcObject !== remoteStream) {
              audioElement.srcObject = remoteStream;
            }
            audioElement.play().catch(() => {
              push('Audio playback blocked. Tap to allow audio.');
            });
          }

          const media = await createLocalStream();
          localStreamRef.current = media;
          media.getAudioTracks().forEach((track) => {
            track.enabled = !isMuted;
          });
          media.getTracks().forEach((track) => rtc.addTrack(track, media));

          const dc = rtc.createDataChannel('events');
          dataChannelRef.current = dc;
          dc.onmessage = (event) => {
            const raw = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
            handleRealtimeEvent(raw);
            push(`Event: ${raw}`);
          };
          const sendSessionUpdate = () => {
            if (sessionUpdateSentRef.current) return;
            if (dc.readyState !== 'open') return;
            if (!enableTranscription) {
              sessionUpdateSentRef.current = true;
              push('Skipped session.update (transcription disabled)');
              return;
            }
            const update = {
              type: 'session.update',
              session: {
                input_audio_transcription: { model: TRANSCRIBE_MODEL, language: 'fi' },
              },
            };
            dc.send(JSON.stringify(update));
            sessionUpdateSentRef.current = true;
            push(`Sent session.update (transcription: ${TRANSCRIBE_MODEL})`);
          };
          dc.onopen = sendSessionUpdate;

          rtc.onconnectionstatechange = () => {
            push(`RTC state: ${rtc.connectionState}`);
            if (rtc.connectionState === 'connected') {
              sendSessionUpdate();
            }
          };

          rtc.ontrack = (event) => {
            const audioElement = audioRef.current;
            if (!audioElement) return;
            if (event.streams && event.streams[0]) {
              if (audioElement.srcObject !== event.streams[0]) {
                audioElement.srcObject = event.streams[0];
              }
            } else {
              const remoteStream = remoteStreamRef.current ?? new MediaStream();
              remoteStreamRef.current = remoteStream;
              remoteStream.addTrack(event.track);
              if (audioElement.srcObject !== remoteStream) {
                audioElement.srcObject = remoteStream;
              }
            }
            if (!audioTrackSeenRef.current) {
              audioTrackSeenRef.current = true;
              push('Received remote audio');
            }
            audioElement.play().catch(() => {
              push('Audio playback blocked. Tap to allow audio.');
            });
          };

          const offer = await rtc.createOffer();
          await rtc.setLocalDescription(offer);

          push('Created SDP offer');

          const clientSecret = token?.value as string | undefined;
          if (!clientSecret) {
            throw new Error('Missing client secret for WebRTC exchange');
          }
          const { answerSdp } = await exchangeOfferForAnswer(offer.sdp ?? '', clientSecret, sharedSecret);
          await rtc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
          push('Applied SDP answer');
          setStatus('listening');
        } catch (error) {
          console.error(error);
          push('Failed to start listening');
          setStatus('idle');
        } finally {
          setConnecting(false);
        }
      },
    [createLocalStream, enableTranscription, isMuted, push, resetUsage, sharedSecret]
  );

  const stop = () => {
    rtcRef.current?.close();
    rtcRef.current = null;
    dataChannelRef.current = null;
    sessionUpdateSentRef.current = false;
    setActiveResponseId(null);
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    audioTrackSeenRef.current = false;
    userDraftRef.current = '';
    assistantDraftRef.current = '';
    setUserDraft('');
    setAssistantDraft('');
    setStatus('idle');
    push('Stopped listening');
  };

  const interruptResponse = () => {
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') {
      push('Data channel not ready to interrupt response');
      return;
    }
    const payload: Record<string, unknown> = { type: 'response.cancel' };
    if (activeResponseId) {
      payload.response_id = activeResponseId;
    }
    dc.send(JSON.stringify(payload));
    push('Sent response.cancel to interrupt assistant');
  };

  const toggleMute = () => setIsMuted((prev) => !prev);
  const toggleTranscription = (enabled: boolean) => {
    setEnableTranscription(enabled);
    localStorage.setItem('enableTranscription', enabled ? 'true' : 'false');
  };

  const canInterrupt = Boolean(activeResponseId && dataChannelRef.current?.readyState === 'open');
  const hasPricing = PRICE_INPUT_USD_PER_1M > 0 || PRICE_OUTPUT_USD_PER_1M > 0;
  const inputCostUsd = (usage.inputTokens / 1_000_000) * (Number.isFinite(PRICE_INPUT_USD_PER_1M) ? PRICE_INPUT_USD_PER_1M : 0);
  const outputCostUsd = (usage.outputTokens / 1_000_000) * (Number.isFinite(PRICE_OUTPUT_USD_PER_1M) ? PRICE_OUTPUT_USD_PER_1M : 0);
  const totalCostEur = (inputCostUsd + outputCostUsd) * (Number.isFinite(EUR_PER_USD) ? EUR_PER_USD : 1);

  const handlePushToTalk = async () => {
    if (!pushToTalk) return;
    if (status === 'idle') await connect();
    setStatus('listening');
    push('Push-to-talk engaged');
  };

  return (
    <main className="app">
      <audio ref={audioRef} autoPlay playsInline />
      <header>
        <h1>Jaska Realtime Assistant</h1>
        <p>Optimized for iOS Safari / PWA. Start listening to begin voice control.</p>
      </header>

      <section className="controls">
        <label className="secret">
          Shared secret
          <input
            type="password"
            value={sharedSecret}
            onChange={(e) => setSharedSecret(e.target.value)}
            placeholder="Required to fetch token"
          />
        </label>
        <button
          className="primary listen-button"
          data-state={status}
          disabled={connecting}
          onClick={status === 'idle' ? connect : stop}
        >
          {status === 'idle' ? 'Start listening' : 'Stop'}
        </button>
        <button disabled={!canInterrupt || connecting} onClick={interruptResponse}>
          Interrupt response
        </button>
        <button onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={enableTranscription}
            onChange={(e) => toggleTranscription(e.target.checked)}
            disabled={connecting || status !== 'idle'}
          />
          Transcribe speech
        </label>
        <label className="toggle">
          <input type="checkbox" checked={pushToTalk} onChange={(e) => setPushToTalk(e.target.checked)} />
          Push-to-talk
        </label>
        {pushToTalk && (
          <button disabled={connecting} onClick={handlePushToTalk}>
            Hold to Talk
          </button>
        )}
        <button onClick={() => setShowSettings((prev) => !prev)}>{showSettings ? 'Hide settings' : 'Settings'}</button>
        <button
          className="dropdown-toggle"
          aria-expanded={showLog}
          onClick={() => setShowLog((prev) => !prev)}
        >
          Event log
        </button>
      </section>

      {showSettings && (
        <section className="settings">
          <div className="settings-header">
            <h2>Audio settings</h2>
            <button onClick={refreshDeviceList} disabled={loadingDevices}>
              {loadingDevices ? 'Refreshing…' : 'Refresh devices'}
            </button>
          </div>
          <div className="settings-grid">
            <label className="toggle">
              <input
                type="checkbox"
                checked={audioEnhancements.echoCancellation}
                onChange={(e) =>
                  setAudioEnhancements((prev) => ({ ...prev, echoCancellation: e.target.checked }))
                }
              />
              Echo cancellation
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={audioEnhancements.noiseSuppression}
                onChange={(e) =>
                  setAudioEnhancements((prev) => ({ ...prev, noiseSuppression: e.target.checked }))
                }
              />
              Noise suppression
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={audioEnhancements.autoGainControl}
                onChange={(e) =>
                  setAudioEnhancements((prev) => ({ ...prev, autoGainControl: e.target.checked }))
                }
              />
              Automatic gain control
            </label>
          </div>
          <label className="device-picker">
            Microphone
            <select value={selectedMicId} onChange={(e) => void handleMicChange(e.target.value)}>
              <option value="">System default</option>
              {availableMics.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone (${device.deviceId.slice(0, 6)})`}
                </option>
              ))}
            </select>
            <p className="hint">Grant microphone permission to see device names.</p>
          </label>
        </section>
      )}

      <section className="status">
        <div className={`pill pill-${status}`}>{status.toUpperCase()}</div>
        {connecting && <p>Establishing WebRTC session…</p>}
        {isMuted && <p>Microphone muted</p>}
      </section>

      <section className="usage">
        <h2>Session usage</h2>
        <div className="usage-grid">
          <div>
            <span className="usage-label">Input tokens</span>
            <strong>{tokenFormatter.format(usage.inputTokens)}</strong>
          </div>
          <div>
            <span className="usage-label">Output tokens</span>
            <strong>{tokenFormatter.format(usage.outputTokens)}</strong>
          </div>
          <div>
            <span className="usage-label">Total tokens</span>
            <strong>{tokenFormatter.format(usage.totalTokens)}</strong>
          </div>
          <div>
            <span className="usage-label">Input audio tokens</span>
            <strong>{tokenFormatter.format(usage.inputAudioTokens)}</strong>
          </div>
          <div>
            <span className="usage-label">Output audio tokens</span>
            <strong>{tokenFormatter.format(usage.outputAudioTokens)}</strong>
          </div>
        </div>
        <div className="usage-cost">
          <span>Estimated cost</span>
          {hasPricing ? (
            <strong>{eurFormatter.format(totalCostEur)}</strong>
          ) : (
            <span className="muted">Set pricing in .env</span>
          )}
        </div>
      </section>

      <section className="transcripts">
        <div className="transcript-card">
          <h2>Your speech</h2>
          <div className="transcript-draft">{userDraft || '…'}</div>
          <div className="transcript-history">
            {userTranscripts.map((entry, index) => (
              <p key={`${entry.ts}-${index}`}>{entry.text}</p>
            ))}
          </div>
        </div>
        <div className="transcript-card">
          <h2>Assistant</h2>
          <div className="transcript-draft">{assistantDraft || '…'}</div>
          <div className="transcript-history">
            {assistantTranscripts.map((entry, index) => (
              <p key={`${entry.ts}-${index}`}>{entry.text}</p>
            ))}
          </div>
        </div>
      </section>

      {showLog && (
        <section className="log log-collapsible">
          <h2>Event log</h2>
          <div className="log-entries">
            {events.map((event, index) => (
              <div key={`${event.ts}-${index}`} className="log-row">
                <span>{new Date(event.ts).toLocaleTimeString()}</span>
                <span>{event.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
