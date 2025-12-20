import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

const ORCHESTRATOR_BASE_URL = import.meta.env.VITE_ORCHESTRATOR_BASE_URL as string;

type Status = 'idle' | 'listening' | 'thinking' | 'speaking';

type EventLogItem = { ts: number; message: string };

function useEventLog() {
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const push = (message: string) => setEvents((prev) => [...prev.slice(-50), { ts: Date.now(), message }]);
  return { events, push };
}

async function fetchToken(sharedSecret: string) {
  const headers: Record<string, string> = { 'x-shared-secret': sharedSecret };
  const response = await axios.post(`${ORCHESTRATOR_BASE_URL}/api/realtime/token`, {}, { headers });
  return response.data;
}

export default function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [pushToTalk, setPushToTalk] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sharedSecret, setSharedSecret] = useState<string>(() => localStorage.getItem('sharedSecret') || '');
  const { events, push } = useEventLog();
  const rtcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  }, []);

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
          const token = await fetchToken(sharedSecret);
          push('Fetched ephemeral token');
          const rtc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          rtcRef.current = rtc;

          const dc = rtc.createDataChannel('events');
          dataChannelRef.current = dc;
          dc.onmessage = (event) => push(`Event: ${event.data}`);

          rtc.onconnectionstatechange = () => push(`RTC state: ${rtc.connectionState}`);

          const offer = await rtc.createOffer();
          await rtc.setLocalDescription(offer);

          push('Created SDP offer');

          // TODO: Complete full WebRTC negotiation with OpenAI Realtime API using the ephemeral token.
          // The token should be exchanged with the Realtime endpoint that returns an answer SDP.
          push('Ephemeral token ready; complete negotiation against Realtime API backend');
          setStatus('listening');
        } catch (error) {
          console.error(error);
          push('Failed to start listening');
          setStatus('idle');
        } finally {
          setConnecting(false);
        }
      },
    [push]
  );

  const stop = () => {
    rtcRef.current?.close();
    rtcRef.current = null;
    dataChannelRef.current = null;
    setStatus('idle');
    push('Stopped listening');
  };

  const toggleMute = () => setIsMuted((prev) => !prev);

  const handlePushToTalk = async () => {
    if (!pushToTalk) return;
    if (status === 'idle') await connect();
    setStatus('listening');
    push('Push-to-talk engaged');
  };

  return (
    <main className="app">
      <header>
        <h1>Home Realtime Assistant</h1>
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
        <button className="primary" disabled={connecting} onClick={status === 'idle' ? connect : stop}>
          {status === 'idle' ? 'Start listening' : 'Stop'}
        </button>
        <button onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>
        <label className="toggle">
          <input type="checkbox" checked={pushToTalk} onChange={(e) => setPushToTalk(e.target.checked)} />
          Push-to-talk
        </label>
        {pushToTalk && (
          <button disabled={connecting} onClick={handlePushToTalk}>
            Hold to Talk
          </button>
        )}
      </section>

      <section className="status">
        <div className={`pill pill-${status}`}>{status.toUpperCase()}</div>
        {connecting && <p>Establishing WebRTC session…</p>}
        {isMuted && <p>Microphone muted</p>}
      </section>

      <section className="log">
        <h2>Event log</h2>
        <div className="log-entries">
          {events.map((event) => (
            <div key={event.ts} className="log-row">
              <span>{new Date(event.ts).toLocaleTimeString()}</span>
              <span>{event.message}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
