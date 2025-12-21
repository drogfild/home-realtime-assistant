import axios from 'axios';
import { createLogger, signHmac } from '@home/shared';
import { Env } from './config';

export type EphemeralTokenResponse = {
  client_secret: {
    value: string;
    expires_at: number;
  };
};

const logger = createLogger('orchestrator');

type ToolListResponse = {
  tools?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
};

const TOOL_CACHE_TTL_MS = 60_000;
let cachedTools: ToolListResponse['tools'] | null = null;
let cachedAt = 0;

async function fetchToolList(env: Env) {
  const body = JSON.stringify({});
  const signature = signHmac({ secret: env.INTERNAL_HMAC_SECRET, body });
  const response = await axios.get<ToolListResponse>(`${env.TOOL_GATEWAY_URL}/v1/tools/list`, {
    headers: {
      'x-internal-signature': signature.signature,
      'x-internal-timestamp': signature.timestamp,
    },
    timeout: 3_000,
  });
  return response.data.tools ?? [];
}

async function getToolList(env: Env) {
  const now = Date.now();
  const cacheFresh = cachedTools && now - cachedAt < TOOL_CACHE_TTL_MS;
  if (cacheFresh) return cachedTools ?? [];
  try {
    const tools = await fetchToolList(env);
    cachedTools = tools;
    cachedAt = now;
    return tools;
  } catch (error) {
    logger.warn({ event: 'tool_list_fetch_failed', error: error instanceof Error ? error.message : error });
    if (cachedTools) {
      logger.info({ event: 'tool_list_cache_fallback', age_ms: now - cachedAt });
      return cachedTools;
    }
    return [];
  }
}

export async function createEphemeralToken(env: Env, options?: { enableTranscription?: boolean }) {
  const url = 'https://api.openai.com/v1/realtime/sessions';
  const tools = await getToolList(env);
  const toolDefinitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.parameters ?? { type: 'object', properties: {}, additionalProperties: false },
  }));
  const enableTranscription = options?.enableTranscription ?? true;
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
    ...(enableTranscription
      ? {
          input_audio_transcription: {
            model: 'gpt-4o-mini-transcribe',
            language: 'fi',
          },
        }
      : {}),
    tools: toolDefinitions,
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
