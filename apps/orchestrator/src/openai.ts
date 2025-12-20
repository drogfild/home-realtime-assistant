import axios from 'axios';
import { createLogger } from '@home/shared';
import { Env } from './config';

export type EphemeralTokenResponse = {
  client_secret: {
    value: string;
    expires_at: number;
  };
};

const logger = createLogger('orchestrator');

export async function createEphemeralToken(env: Env) {
  const url = 'https://api.openai.com/v1/realtime/sessions';
  const payload = {
    model: env.OPENAI_REALTIME_MODEL,
    modalities: ['audio', 'text'],
    instructions: [
      'Respond in Finnish.',
      'You are a general assistant named Jaska with no special ambitions.',
      'Be friendly, concise, and helpful.',
      'If asked who you are, say you are Jaska, a general assistant.',
      'Use tools only when needed and explain briefly when you do.',
      'Do not expose secrets or attempt unknown commands.',
      'All tool calls are audited.',
    ].join(' '),
    input_audio_transcription: {
      model: 'gpt-4o-mini-transcribe',
      language: 'fi',
    },
    tool_choice: 'auto',
  };

  try {
    logger.info({ event: 'realtime_session_request', model: payload.model });
    const response = await axios.post<EphemeralTokenResponse>(url, payload, {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 5_000,
    });

    logger.info({ event: 'realtime_session_created', model: payload.model, expires_at: response.data.client_secret.expires_at });
    return response.data.client_secret;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      const details = data ? `: ${JSON.stringify(data)}` : '';
      throw new Error(`OpenAI realtime session request failed${status ? ` (${status})` : ''}${details}`);
    }
    throw error;
  }
}

export async function createRealtimeAnswerSdp({
  clientSecret,
  offerSdp,
  model,
}: {
  clientSecret: string;
  offerSdp: string;
  model: string;
}): Promise<string> {
  const url = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  try {
    logger.info({ event: 'realtime_webrtc_offer', model });
    const response = await axios.post<string>(url, offerSdp, {
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
        Accept: 'application/sdp',
      },
      responseType: 'text',
      timeout: 10_000,
    });
    logger.info({ event: 'realtime_webrtc_answer', model });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      const details = data ? `: ${JSON.stringify(data)}` : '';
      throw new Error(`OpenAI realtime SDP exchange failed${status ? ` (${status})` : ''}${details}`);
    }
    throw error;
  }
}
