import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

const ORCHESTRATOR_BASE_URL = import.meta.env.VITE_ORCHESTRATOR_BASE_URL as string;
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

type Status = 'idle' | 'listening' | 'thinking' | 'speaking';

type EventLogItem = { ts: number; message: string };
type TranscriptItem = { ts: number; text: string };

function useEventLog() {
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const push = (message: string) => setEvents((prev) => [...prev.slice(-200), { ts: Date.now(), message }]);
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

  const handleRealtimeEvent = (raw: string) => {
    let parsed: { type?: string; [key: string]: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
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
    [createLocalStream, enableTranscription, isMuted, push, sharedSecret]
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

      <section className="log">
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
    </main>
  );
}
